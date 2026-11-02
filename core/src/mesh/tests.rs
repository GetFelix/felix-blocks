use super::*;
use crate::chunk::{CELLS, cell};

const AIR: u8 = 0;
const GRASS: u8 = 1;
const STONE: u8 = 3;
const WATER: u8 = 5;
const LEAVES: u8 = 7;
const GLASS: u8 = 9;

/// A chunk from `f(x, y, z)`, with every neighbour loaded as air.
fn world(f: impl Fn(usize, usize, usize) -> u8) -> Padded {
    let mut p = Padded::new();
    let air = vec![AIR; CELLS];
    for dy in -1..=1 {
        for dz in -1..=1 {
            for dx in -1..=1 {
                p.set_chunk([dx, dy, dz], &air);
            }
        }
    }
    let mut chunk = vec![AIR; CELLS];
    for y in 0..SIZE {
        for z in 0..SIZE {
            for x in 0..SIZE {
                chunk[cell(x, y, z)] = f(x, y, z);
            }
        }
    }
    p.set_chunk([0, 0, 0], &chunk);
    p
}

fn at(blocks: &[(usize, usize, usize, u8)]) -> Padded {
    world(|x, y, z| {
        blocks
            .iter()
            .find(|b| (b.0, b.1, b.2) == (x, y, z))
            .map_or(AIR, |b| b.3)
    })
}

/// Cheap deterministic noise.
fn rng(seed: u32) -> impl FnMut() -> u32 {
    let mut s = seed;
    move || {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        s
    }
}

fn busy_chunk(seed: u32) -> Padded {
    let mut next = rng(seed);
    let blocks: Vec<u8> = (0..CELLS)
        .map(|_| [0, 0, 1, 3, 3, 5, 7, 9][next() as usize % 8])
        .collect();
    world(|x, y, z| blocks[cell(x, y, z)])
}

#[test]
fn an_empty_chunk_has_no_quads() {
    assert_eq!(mesh_chunk(&at(&[])).quads(), 0);
}

#[test]
fn one_block_is_six_quads() {
    let mesh = mesh_chunk(&at(&[(5, 5, 5, STONE)]));
    assert_eq!(mesh.quads(), 6);
    assert_eq!(mesh.opaque.positions.len(), 6 * 4 * 3);
    assert_eq!(mesh.opaque.indices.len(), 36);
}

#[test]
fn a_solid_chunk_is_one_quad_per_side() {
    assert_eq!(mesh_chunk(&world(|_, _, _| STONE)).quads(), 6);
}

#[test]
fn a_solid_chunk_beside_unloaded_chunks_shows_nothing() {
    let mut p = Padded::new();
    p.set_chunk([0, 0, 0], &vec![STONE; CELLS]);
    assert_eq!(mesh_chunk(&p).quads(), 0);
}

#[test]
fn a_flat_layer_is_six_quads() {
    assert_eq!(
        mesh_chunk(&world(|_, y, _| if y == 0 { STONE } else { AIR })).quads(),
        6
    );
}

#[test]
fn a_3d_checkerboard_cannot_merge_and_has_every_face() {
    let mesh = mesh_chunk(&world(
        |x, y, z| if (x + y + z) % 2 == 0 { STONE } else { AIR },
    ));
    assert_eq!(mesh.quads(), CELLS / 2 * 6);
}

#[test]
fn two_blocks_touching_hide_the_faces_between_them() {
    assert_eq!(
        mesh_chunk(&at(&[(4, 4, 4, STONE), (5, 4, 4, STONE)])).quads(),
        6
    );
}

#[test]
fn different_blocks_do_not_merge() {
    assert_eq!(
        mesh_chunk(&at(&[(4, 4, 4, STONE), (5, 4, 4, GRASS)])).quads(),
        5 + 5
    );
}

#[test]
fn faces_land_in_the_pass_of_their_block() {
    let mesh = mesh_chunk(&at(&[
        (1, 1, 1, STONE),
        (4, 1, 1, LEAVES),
        (7, 1, 1, GLASS),
        (10, 1, 1, WATER),
    ]));
    assert_eq!(mesh.opaque.quads(), 6);
    assert_eq!(mesh.cutout.quads(), 6);
    assert_eq!(mesh.glass.quads(), 6);
    assert_eq!(mesh.water.quads(), 6);
}

#[test]
fn water_only_shows_against_air_and_its_top_is_lowered() {
    let mesh = mesh_chunk(&at(&[(4, 1, 4, WATER), (5, 1, 4, STONE), (4, 0, 4, STONE)]));
    // Water touches stone to the east and below: four faces left.
    assert_eq!(mesh.water.quads(), 4);
    let top = (0..16)
        .find(|v| mesh.water.normals[v * 3 + 1] == 1)
        .unwrap();
    assert!((mesh.water.positions[top * 3 + 1] - (2.0 - WATER_DIP)).abs() < 1e-6);
}

#[test]
fn a_face_looking_at_an_unloaded_cell_is_not_drawn() {
    let mut p = Padded::new();
    let mut chunk = vec![AIR; CELLS];
    chunk[cell(15, 3, 3)] = STONE;
    p.set_chunk([0, 0, 0], &chunk);
    // Everything around is unloaded, so the stone has no visible face except into its own chunk's air.
    let mesh = mesh_chunk(&p);
    assert_eq!(mesh.quads(), 5);
}

#[test]
fn a_loaded_neighbour_decides_the_border_face() {
    let mut chunk = vec![AIR; CELLS];
    chunk[cell(15, 3, 3)] = STONE;
    let build = |east: u8| {
        let mut p = Padded::new();
        p.set_chunk([0, 0, 0], &chunk);
        p.set_chunk([1, 0, 0], &vec![east; CELLS]);
        mesh_chunk(&p).quads()
    };
    assert_eq!(build(STONE), 5);
    assert_eq!(build(AIR), 6);
}

/// The corner levels of the top face of the single-cell quad at x, z on the y = 1 plane, sorted.
fn top_levels(mesh: &ChunkMesh, x: f32, z: f32) -> Vec<u8> {
    let m = &mesh.opaque;
    let mut levels: Vec<u8> = (0..m.quads() * 4)
        .filter(|&v| {
            let p = &m.positions[v * 3..v * 3 + 3];
            m.normals[v * 3 + 1] == 1
                && p[1] == 1.0
                && (x..=x + 1.0).contains(&p[0])
                && (z..=z + 1.0).contains(&p[2])
        })
        .map(|v| m.ao[v])
        .collect();
    levels.sort_unstable();
    levels
}

#[test]
fn a_block_beside_a_pillar_is_shaded_at_the_corners_that_touch_it() {
    let mesh = mesh_chunk(&at(&[(5, 0, 5, STONE), (6, 1, 5, STONE)]));
    assert_eq!(top_levels(&mesh, 5.0, 5.0), [2, 2, 3, 3]);
}

#[test]
fn a_corner_between_two_walls_is_darkest() {
    let mesh = mesh_chunk(&at(&[(5, 0, 5, STONE), (6, 1, 5, STONE), (5, 1, 6, STONE)]));
    assert_eq!(top_levels(&mesh, 5.0, 5.0), [0, 2, 2, 3]);
}

#[test]
fn a_diagonal_block_shades_one_corner() {
    let mesh = mesh_chunk(&at(&[(5, 0, 5, STONE), (6, 1, 6, STONE)]));
    assert_eq!(top_levels(&mesh, 5.0, 5.0), [2, 3, 3, 3]);
}

/// The quads facing up on the y = 1 plane, the top of a one-block-high floor.
fn floor_tops(mesh: &ChunkMesh) -> usize {
    let m = &mesh.opaque;
    (0..m.quads())
        .filter(|&q| {
            (q * 4..q * 4 + 4).all(|v| m.normals[v * 3 + 1] == 1 && m.positions[v * 3 + 1] == 1.0)
        })
        .count()
}

#[test]
fn merging_needs_equal_shading() {
    // A row of ground with a pillar beside it: the shaded cells must not merge with the lit rest.
    let floor = |pillar: bool| {
        mesh_chunk(&world(|x, y, z| match (x, y, z) {
            (x, 0, 0) if x < 8 => STONE,
            (4, 1, 0) if pillar => STONE,
            _ => AIR,
        }))
    };
    assert_eq!(floor_tops(&floor(false)), 1);
    // Left of the pillar, the cell beside it, the pillar's own cell, the cell on the other side, the rest.
    assert_eq!(floor_tops(&floor(true)), 4);
}

#[test]
fn a_merged_quad_repeats_the_tile() {
    let mesh = mesh_chunk(&at(&[
        (2, 3, 3, STONE),
        (3, 3, 3, STONE),
        (4, 3, 3, STONE),
        (5, 3, 3, STONE),
    ]));
    let span = |f: fn(&[f32]) -> f32| mesh.opaque.uvs.chunks(2).map(f).fold(0.0, f32::max);
    assert_eq!(span(|uv| uv[0]), 4.0);
}

#[test]
fn side_faces_have_the_tile_the_right_way_up() {
    let mesh = mesh_chunk(&at(&[(5, 5, 5, GRASS)]));
    for v in 0..mesh.opaque.quads() * 4 {
        if mesh.opaque.normals[v * 3 + 1] != 0 {
            continue;
        }
        let low = mesh.opaque.positions[v * 3 + 1] == 5.0;
        assert_eq!(
            mesh.opaque.uvs[v * 2 + 1],
            if low { 0.0 } else { 1.0 },
            "vertex {v}"
        );
    }
}

#[test]
fn faces_use_the_tiles_of_their_direction() {
    let names = tile_names();
    let mesh = mesh_chunk(&at(&[(5, 5, 5, GRASS)]));
    let tile = |normal: [i8; 3]| {
        let v = (0..mesh.opaque.quads() * 4)
            .find(|v| mesh.opaque.normals[v * 3..v * 3 + 3] == normal)
            .unwrap();
        names[usize::from(mesh.opaque.tiles[v])]
    };
    assert_eq!(tile([0, 1, 0]), "grass_top");
    assert_eq!(tile([0, -1, 0]), "dirt");
    assert_eq!(tile([1, 0, 0]), "dirt_grass");
}

#[test]
fn winding_matches_the_normal_and_indices_are_in_range() {
    let mesh = mesh_chunk(&busy_chunk(7));
    for m in [&mesh.opaque, &mesh.cutout, &mesh.glass, &mesh.water] {
        let verts = m.positions.len() / 3;
        assert!(m.indices.iter().all(|i| (*i as usize) < verts));
        for tri in m.indices.chunks(3) {
            let p = |i: u32| {
                let i = i as usize * 3;
                [m.positions[i], m.positions[i + 1], m.positions[i + 2]]
            };
            let (a, b, c) = (p(tri[0]), p(tri[1]), p(tri[2]));
            let (e1, e2) = (
                [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
                [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
            );
            let cross = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let n = &m.normals[tri[0] as usize * 3..tri[0] as usize * 3 + 3];
            let dot: f32 = (0..3).map(|k| cross[k] * f32::from(n[k])).sum();
            assert!(dot > 0.0, "a triangle faces away from its normal");
        }
    }
}

/// The occlusion levels of the up-facing vertices at x, y, z.
fn up_ao_at(mesh: &ChunkMesh, at: [f32; 3]) -> Vec<u8> {
    let m = &mesh.opaque;
    (0..m.quads() * 4)
        .filter(|&v| m.normals[v * 3 + 1] == 1 && m.positions[v * 3..v * 3 + 3] == at)
        .map(|v| m.ao[v])
        .collect()
}

#[test]
fn a_diagonal_neighbour_chunk_shades_the_matching_corner() {
    let mut p = at(&[(15, 0, 15, STONE)]);
    let mut across = vec![AIR; CELLS];
    across[cell(0, 1, 0)] = STONE;
    p.set_chunk([1, 0, 1], &across);
    let mesh = mesh_chunk(&p);
    assert_eq!(up_ao_at(&mesh, [16.0, 1.0, 16.0]), [2]);
    for corner in [[15.0, 1.0, 15.0], [16.0, 1.0, 15.0], [15.0, 1.0, 16.0]] {
        assert_eq!(up_ao_at(&mesh, corner), [3], "{corner:?}");
    }
}

#[test]
fn a_face_neighbour_chunk_shades_the_corners_beside_it() {
    let mut p = at(&[(15, 0, 5, STONE)]);
    let mut east = vec![AIR; CELLS];
    east[cell(0, 1, 5)] = STONE;
    p.set_chunk([1, 0, 0], &east);
    let mesh = mesh_chunk(&p);
    for z in [5.0, 6.0] {
        assert_eq!(up_ao_at(&mesh, [16.0, 1.0, z]), [2]);
        assert_eq!(up_ao_at(&mesh, [15.0, 1.0, z]), [3]);
    }
}

#[test]
fn a_lone_dark_corner_is_on_the_split_diagonal() {
    let mesh = mesh_chunk(&at(&[(5, 0, 5, STONE), (6, 1, 6, STONE)]));
    let m = &mesh.opaque;
    let q = (0..m.quads())
        .find(|&q| {
            (q * 4..q * 4 + 4).all(|v| m.normals[v * 3 + 1] == 1 && m.positions[v * 3 + 1] == 1.0)
                && m.positions[q * 12] < 6.0
                && m.positions[q * 12 + 2] < 6.0
        })
        .unwrap();
    let dark = (q * 4..q * 4 + 4).find(|&v| m.ao[v] == 2).unwrap() as u32;
    let tri = |i: usize| &m.indices[q * 6 + i * 3..q * 6 + i * 3 + 3];
    assert!(tri(0).contains(&dark) && tri(1).contains(&dark));
}

#[test]
fn water_sides_follow_the_lowered_surface() {
    let top = |mesh: &ChunkMesh| {
        mesh.water
            .positions
            .chunks(3)
            .map(|p| p[1])
            .fold(0.0, f32::max)
    };
    let pond = mesh_chunk(&at(&[(4, 1, 4, WATER), (4, 0, 4, STONE)]));
    assert_eq!(top(&pond), 2.0 - WATER_DIP);
    // Under more water the side runs to the block top and only the upper block is lowered.
    let deep = mesh_chunk(&at(&[(4, 1, 4, WATER), (4, 2, 4, WATER), (4, 0, 4, STONE)]));
    assert_eq!(top(&deep), 3.0 - WATER_DIP);
    assert!(deep.water.positions.chunks(3).any(|p| p[1] == 2.0));
}

#[test]
fn faces_between_different_kinds_follow_the_rules() {
    let pair = |a: u8, b: u8| mesh_chunk(&at(&[(4, 1, 4, a), (5, 1, 4, b)]));
    // Glass hides glass, but leaves keep their faces against leaves.
    assert_eq!(pair(GLASS, GLASS).glass.quads(), 6);
    assert_eq!(pair(LEAVES, LEAVES).cutout.quads(), 8);
    // Water only shows against air, so glass, leaves and stone each cost it a face.
    assert_eq!(pair(WATER, GLASS).water.quads(), 5);
    assert_eq!(pair(WATER, LEAVES).water.quads(), 5);
    assert_eq!(pair(WATER, STONE).water.quads(), 5);
    // The other side of the pair is still drawn against water.
    assert_eq!(pair(WATER, GLASS).glass.quads(), 6);
    assert_eq!(pair(WATER, LEAVES).cutout.quads(), 6);
    assert_eq!(pair(WATER, STONE).opaque.quads(), 6);
}

/// Every face a solid, non-water cell could show, counted one cell at a time. Water is left out because its
/// lowered surface makes its faces shorter than a block.
fn visible_faces(p: &Padded) -> usize {
    let kinds = Kinds::new();
    let mut n = 0;
    for y in 0..16 {
        for z in 0..16 {
            for x in 0..16 {
                let b = p.at(x, y, z);
                if kinds.is_air(b) || b == WATER {
                    continue;
                }
                for (dx, dy, dz) in [
                    (1, 0, 0),
                    (-1, 0, 0),
                    (0, 1, 0),
                    (0, -1, 0),
                    (0, 0, 1),
                    (0, 0, -1),
                ] {
                    n += usize::from(kinds.shows(b, p.at(x + dx, y + dy, z + dz)));
                }
            }
        }
    }
    n
}

fn area(m: &Mesh) -> f32 {
    m.positions
        .chunks(12)
        .map(|q| {
            let d = |a: usize, b: usize| {
                (0..3)
                    .map(|k| (q[b * 3 + k] - q[a * 3 + k]).powi(2))
                    .sum::<f32>()
                    .sqrt()
            };
            d(0, 1) * d(0, 3)
        })
        .sum()
}

#[test]
fn merged_quads_cover_exactly_the_visible_faces() {
    for seed in [1, 2, 3, 99] {
        let p = busy_chunk(seed);
        let mesh = mesh_chunk(&p);
        let covered = area(&mesh.opaque) + area(&mesh.cutout) + area(&mesh.glass);
        assert_eq!(covered.round() as usize, visible_faces(&p), "seed {seed}");
        assert!(
            mesh.quads() - mesh.water.quads() < visible_faces(&p),
            "nothing merged for seed {seed}"
        );
    }
}

#[test]
fn meshing_is_deterministic() {
    assert_eq!(mesh_chunk(&busy_chunk(5)), mesh_chunk(&busy_chunk(5)));
}
