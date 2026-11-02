use super::*;
use crate::blocks::BLOCKS;
use std::collections::BTreeMap;

const GOLDEN: &str = "testdata/worldgen.golden";

/// The highest ground of each golden seed, as a chunk column (found by scanning the whole world). The tallest
/// trees stand here, with tops near y 120.
const PEAKS: [(u32, i32, i32); 7] = [
    (0, 159, 183),
    (1, 116, 175),
    (42, 63, 207),
    (12345, 112, 223),
    (0xDEAD_BEEF, 72, 188),
    (u32::MAX, 223, 161),
    (777, 96, 79),
];

/// A spread of chunks: both world corners, the middle, and places in between, in every layer that can hold
/// anything (0 to 7), plus the two top layers over each seed's highest ground.
fn golden_chunks() -> Vec<(u32, i32, i32, i32)> {
    let seeds = [0, 1, 42, 12345, 0xDEAD_BEEF, u32::MAX, 777];
    let columns = [
        (0, 0),
        (255, 255),
        (128, 128),
        (37, 201),
        (100, 3),
        (15, 16),
    ];
    let mut out = Vec::new();
    for seed in seeds {
        for (cx, cz) in columns {
            for cy in 0..TERRAIN_LAYERS {
                out.push((seed, cx, cy, cz));
            }
        }
    }
    for (seed, cx, cz) in PEAKS {
        for cy in [TERRAIN_LAYERS - 2, TERRAIN_LAYERS - 1] {
            out.push((seed, cx, cy, cz));
        }
    }
    out
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ *b as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn golden_lines() -> String {
    let mut out = String::from(
        "# seed cx cy cz fnv1a64 of the chunk's 4096 bytes, generator version 1.\n\
         # web/src/worldgen.test.ts checks the WebAssembly build against this same file.\n\
         # A change here is a change to the generator: give it a new version instead.\n",
    );
    for (seed, cx, cy, cz) in golden_chunks() {
        let chunk = generate_chunk(1, seed, cx, cy, cz).unwrap();
        out += &format!("{seed} {cx} {cy} {cz} {:016x}\n", fnv1a64(&chunk));
    }
    out
}

#[test]
fn version_one_still_makes_the_chunks_it_always_made() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN);
    let now = golden_lines();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &now).unwrap();
    }
    let stored = std::fs::read_to_string(&path).unwrap();
    assert!(
        stored == now,
        "generator version 1 changed; saved worlds would shift. Add a new version instead"
    );
}

#[test]
fn unknown_versions_and_chunks_outside_the_world_have_no_blocks() {
    assert!(generate_chunk(0, 1, 0, 0, 0).is_none());
    assert!(generate_chunk(2, 1, 0, 0, 0).is_none());
    assert!(generate_chunk(1, 1, -1, 0, 0).is_none());
    assert!(generate_chunk(1, 1, 256, 0, 0).is_none());
    assert!(generate_chunk(1, 1, 0, 16, 0).is_none());
    assert!(generate_chunk(1, 1, 0, 0, 256).is_none());
    assert!(generate_chunk(1, 1, 255, 15, 255).is_some());
    assert!(ground_height(2, 1, 0, 0).is_none());
}

#[test]
fn a_chunk_is_the_same_every_time_and_a_seed_changes_it() {
    let a = generate_chunk(1, 7, 100, 4, 100).unwrap();
    assert_eq!(a.len(), CELLS);
    assert_eq!(a, generate_chunk(1, 7, 100, 4, 100).unwrap());
    assert_ne!(a, generate_chunk(1, 8, 100, 4, 100).unwrap());
}

#[test]
fn only_blocks_in_the_table_are_made() {
    for (seed, cx, cy, cz) in golden_chunks() {
        let chunk = generate_chunk(1, seed, cx, cy, cz).unwrap();
        assert!(chunk.iter().all(|b| (*b as usize) < BLOCKS.len()));
    }
}

/// Counts every block in a patch of world, `radius` chunks around a middle chunk, over the whole height.
fn census(seed: u32, middle: i32, radius: i32) -> BTreeMap<u8, usize> {
    let mut seen = BTreeMap::new();
    for cz in middle - radius..=middle + radius {
        for cx in middle - radius..=middle + radius {
            for cy in 0..WORLD_CHUNKS[1] {
                for b in generate_chunk(1, seed, cx, cy, cz).unwrap() {
                    *seen.entry(b).or_insert(0) += 1;
                }
            }
        }
    }
    seen
}

#[test]
fn the_world_has_ground_water_caves_ore_and_trees() {
    let seen = census(5, 128, 6);
    for (name, id) in [
        ("grass", GRASS),
        ("dirt", DIRT),
        ("stone", STONE),
        ("sand", SAND),
        ("water", WATER),
        ("log", OAK_LOG),
        ("leaves", LEAVES),
        ("gravel", GRAVEL),
        ("coal", COAL_ORE),
        ("iron", IRON_ORE),
        ("air", AIR),
    ] {
        assert!(seen.contains_key(&id), "no {name} in 13 x 13 chunks");
    }
}

/// Below 40 every column is solid ground, so air there is a cave.
#[test]
fn caves_are_a_few_percent_of_the_rock() {
    let mut air = 0;
    let mut cells = 0;
    for cz in 120..136 {
        for cx in 120..136 {
            for cy in 0..2 {
                let chunk = generate_chunk(1, 5, cx, cy, cz).unwrap();
                air += chunk.iter().filter(|b| **b == AIR).count();
                cells += CELLS;
            }
        }
    }
    let share = air as f64 / cells as f64;
    assert!(
        (0.02..0.15).contains(&share),
        "{share:.3} of the deep rock is air"
    );
}

#[test]
fn the_ground_is_where_ground_height_says() {
    for (x, z) in [(2048, 2048), (100, 3000), (4000, 40), (17, 17), (3333, 777)] {
        let ground = ground_height(1, 9, x, z).unwrap();
        let (cx, cz) = (x / 16, z / 16);
        let at = |y: i32| {
            let chunk = generate_chunk(1, 9, cx, y / 16, cz).unwrap();
            chunk[cell((x % 16) as usize, (y % 16) as usize, (z % 16) as usize)]
        };
        let tops = [GRASS, SAND, GRAVEL, AIR];
        assert!(
            tops.contains(&at(ground)),
            "({x}, {z}) ground {ground} is {}",
            at(ground)
        );
        assert!(matches!(at(ground + 1), AIR | WATER | OAK_LOG | LEAVES));
        assert_ne!(at(1), AIR);
        assert!((40..=115).contains(&ground));
    }
}

#[test]
fn layer_8_and_above_are_always_air_and_the_bottom_is_never_hollow() {
    assert_eq!(TERRAIN_LAYERS, 8);
    let sky = generate_chunk(1, 3, 50, 8, 50).unwrap();
    assert!(sky.iter().all(|b| *b == AIR));
    // The shortcut in generate_chunk has to agree with the generator itself, over the highest ground.
    for (seed, cx, cz) in PEAKS {
        for cy in TERRAIN_LAYERS..WORLD_CHUNKS[1] {
            assert!(
                generate_chunk(1, seed, cx, cy, cz)
                    .unwrap()
                    .iter()
                    .all(|b| *b == AIR)
            );
            let mut raw = vec![AIR; CELLS];
            let (x0, y0, z0) = (cx * SIZE as i32, cy * SIZE as i32, cz * SIZE as i32);
            fill_ground(&mut raw, seed, x0, y0, z0);
            grow_trees(&mut raw, seed, x0, y0, z0);
            assert!(raw.iter().all(|b| *b == AIR), "{seed} {cx} {cy} {cz}");
        }
    }
    for cz in 0..6 {
        let floor = generate_chunk(1, 3, 40 + cz, 0, 40).unwrap();
        for z in 0..16 {
            for x in 0..16 {
                for y in 0..3 {
                    assert_ne!(floor[cell(x, y, z)], AIR);
                }
            }
        }
    }
}

#[test]
fn water_reaches_the_sea_level_block_and_iron_stays_below_60() {
    let (mut top_water, mut iron_top) = (0, 0);
    for cz in 120..130 {
        for cx in 120..130 {
            for cy in 0..TERRAIN_LAYERS {
                let chunk = generate_chunk(1, 5, cx, cy, cz).unwrap();
                for (i, b) in chunk.iter().enumerate() {
                    let y = cy * SIZE as i32 + ((i >> 8) & 15) as i32;
                    match *b {
                        WATER => top_water = top_water.max(y),
                        IRON_ORE => iron_top = iron_top.max(y),
                        _ => {}
                    }
                }
            }
        }
    }
    assert_eq!(top_water, SEA_LEVEL);
    assert!((1..60).contains(&iron_top), "iron up to {iron_top}");
}

/// Ground sits around 77 and a column only reaches the 115 limit in theory.
#[test]
fn typical_ground_is_near_77() {
    let mut heights = Vec::new();
    for seed in [1, 42, 777] {
        for cz in (0..256).step_by(3) {
            for cx in (0..256).step_by(3) {
                heights.push(ground_height(1, seed, cx * 16 + 8, cz * 16 + 8).unwrap());
            }
        }
    }
    heights.sort();
    let median = heights[heights.len() / 2];
    assert!((75..=79).contains(&median), "median ground {median}");
    assert!(*heights.last().unwrap() < MAX_HEIGHT);
}

/// A tree on a chunk's edge has to be whole in both chunks, or the seam would show a trunk with half a crown.
/// Checks both ways: a trunk on the left chunk's last column and on the right chunk's first.
#[test]
fn trees_are_whole_across_chunk_edges() {
    // Cell in the first chunk, the cell beside it in the second, along an axis, for a position along the edge.
    type Seam = fn(usize, usize) -> (usize, usize, usize, usize, usize, usize);
    let seams: [(&str, (i32, i32), Seam); 2] = [
        ("x", (1, 0), |y, k| (15, y, k, 0, y, k)),
        ("z", (0, 1), |y, k| (k, y, 15, k, y, 0)),
    ];
    let mut checked = [0; 4];
    for (n, (axis, (dx, dz), seam)) in seams.into_iter().enumerate() {
        for i in 100..160 {
            let (cx, cz) = if axis == "x" { (i, 100) } else { (100, i) };
            let a = generate_chunk(1, 21, cx, 4, cz).unwrap();
            let b = generate_chunk(1, 21, cx + dx, 4, cz + dz).unwrap();
            for k in 0..16 {
                for y in 0..15 {
                    let (ax, ay, az, bx, by, bz) = seam(y, k);
                    // The top log of a tree has leaves on all four sides of it.
                    let top = |c: &[u8], x, y, z| {
                        c[cell(x, y, z)] == OAK_LOG && c[cell(x, y + 1, z)] != OAK_LOG
                    };
                    let crown = |c: &[u8], x, y, z| matches!(c[cell(x, y, z)], LEAVES | OAK_LOG);
                    if top(&a, ax, ay, az) {
                        assert!(
                            crown(&b, bx, by, bz),
                            "no crown past {axis} edge at {i}, {y}, {k}"
                        );
                        checked[n * 2] += 1;
                    }
                    if top(&b, bx, by, bz) {
                        assert!(
                            crown(&a, ax, ay, az),
                            "no crown before {axis} edge at {i}, {y}, {k}"
                        );
                        checked[n * 2 + 1] += 1;
                    }
                }
            }
        }
    }
    assert!(
        checked.iter().all(|c| *c > 0),
        "an edge went unchecked: {checked:?}"
    );
}
