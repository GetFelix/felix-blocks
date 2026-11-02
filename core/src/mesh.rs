//! Greedy meshing: a chunk's blocks become quads, one mesh per draw pass.
//!
//! A face is drawn only where it can be seen, and neighbouring faces of the same block with the same shading
//! merge into one quad. Each corner of a quad carries an ambient occlusion level, 0 (darkest) to 3, from the
//! three cells that touch it, which gives the blocks their depth. See docs/art.md for the look.

use std::sync::OnceLock;

use crate::blocks::{BLOCKS, Pass, tile_names};
use crate::chunk::{PADDED, Padded, SIZE, UNLOADED};

/// Water's top face sits this far below the top of its block, so shorelines read.
const WATER_DIP: f32 = 0.12;

/// One draw pass of a chunk, as flat arrays ready to become vertex buffers. Four vertices and six indices per
/// quad.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    /// x, y, z per vertex, in blocks from the chunk's minimum corner.
    pub positions: Vec<f32>,
    /// The face's outward direction per vertex, as x, y, z in -1, 0 or 1.
    pub normals: Vec<i8>,
    /// Position on the tile per vertex, in tiles. A merged quad runs past 1, so the shader repeats it.
    pub uvs: Vec<f32>,
    /// The tile per vertex, an index into [`tile_names`].
    pub tiles: Vec<u8>,
    /// Ambient occlusion per vertex, 0 to 3.
    pub ao: Vec<u8>,
    pub indices: Vec<u32>,
}

impl Mesh {
    pub fn quads(&self) -> usize {
        self.indices.len() / 6
    }
}

/// A chunk's meshes, one per [`Pass`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChunkMesh {
    pub opaque: Mesh,
    pub cutout: Mesh,
    pub glass: Mesh,
    pub water: Mesh,
}

impl ChunkMesh {
    pub fn pass(&self, pass: Pass) -> &Mesh {
        match pass {
            Pass::Opaque => &self.opaque,
            Pass::Cutout => &self.cutout,
            Pass::Glass => &self.glass,
            Pass::Water => &self.water,
        }
    }

    fn pass_mut(&mut self, pass: Pass) -> &mut Mesh {
        match pass {
            Pass::Opaque => &mut self.opaque,
            Pass::Cutout => &mut self.cutout,
            Pass::Glass => &mut self.glass,
            Pass::Water => &mut self.water,
        }
    }

    pub fn quads(&self) -> usize {
        self.opaque.quads() + self.cutout.quads() + self.glass.quads() + self.water.quads()
    }
}

/// A face direction: the axis it is perpendicular to, which way it points, and the two axes along it. `u` cross `v`
/// points out of the face, which sets the winding.
struct Face {
    axis: usize,
    positive: bool,
    u: usize,
    v: usize,
}

const FACES: [Face; 6] = [
    Face {
        axis: 0,
        positive: true,
        u: 1,
        v: 2,
    },
    Face {
        axis: 0,
        positive: false,
        u: 2,
        v: 1,
    },
    Face {
        axis: 1,
        positive: true,
        u: 2,
        v: 0,
    },
    Face {
        axis: 1,
        positive: false,
        u: 0,
        v: 2,
    },
    Face {
        axis: 2,
        positive: true,
        u: 0,
        v: 1,
    },
    Face {
        axis: 2,
        positive: false,
        u: 1,
        v: 0,
    },
];

/// What a block does to the faces and shading around it, by id. Unknown ids and [`UNLOADED`] act as air.
struct Kinds {
    pass: [Option<Pass>; 256],
    /// Tile for the top, side and bottom faces.
    tiles: [[u8; 3]; 256],
}

impl Kinds {
    fn new() -> Self {
        let names = tile_names();
        let mut kinds = Kinds {
            pass: [None; 256],
            tiles: [[0; 3]; 256],
        };
        for b in BLOCKS.iter().skip(1) {
            kinds.pass[usize::from(b.id)] = Some(b.pass);
            for (slot, tile) in b.tiles.iter().enumerate() {
                kinds.tiles[usize::from(b.id)][slot] =
                    names.iter().position(|n| n == tile).unwrap() as u8;
            }
        }
        kinds
    }

    fn is_air(&self, b: u8) -> bool {
        self.pass[usize::from(b)].is_none() && b != UNLOADED
    }

    /// Hides the faces behind it, and darkens corners next to it.
    fn is_opaque(&self, b: u8) -> bool {
        self.pass[usize::from(b)] == Some(Pass::Opaque)
    }

    /// Shades the corners next to it. Leaves do, though light gets through them.
    fn occludes(&self, b: u8) -> bool {
        matches!(self.pass[usize::from(b)], Some(Pass::Opaque | Pass::Cutout))
    }

    /// Whether a face of `b` with `next` on the other side can be seen. A cell that is not loaded shows nothing, so
    /// a chunk does not draw a wall against a neighbour that may turn out to be solid.
    fn shows(&self, b: u8, next: u8) -> bool {
        if next == UNLOADED {
            return false;
        }
        if self.is_air(next) {
            return true;
        }
        match self.pass[usize::from(b)] {
            // Water is only seen against air.
            Some(Pass::Water) => false,
            // Leaves show their faces against each other so the inside of a tree is not hollow.
            Some(Pass::Cutout) => !self.is_opaque(next),
            _ => !self.is_opaque(next) && next != b,
        }
    }
}

static KINDS: OnceLock<Kinds> = OnceLock::new();

/// What must be equal for two faces to merge: the block, its tile and the four corner levels.
type Key = u32;

fn key(block: u8, tile: u8, ao: [u8; 4]) -> Key {
    let packed = ao.iter().fold(0u32, |k, l| k << 2 | u32::from(*l));
    u32::from(block) << 16 | u32::from(tile) << 8 | packed
}

/// Meshes the chunk inside `padded`.
pub fn mesh_chunk(padded: &Padded) -> ChunkMesh {
    let kinds = KINDS.get_or_init(Kinds::new);
    let mut out = ChunkMesh::default();
    let mut mask = [0 as Key; SIZE * SIZE];
    for face in &FACES {
        for slice in 0..SIZE as i32 {
            mask.fill(0);
            for iv in 0..SIZE as i32 {
                for iu in 0..SIZE as i32 {
                    let at = cell_at(face, slice, iu, iv);
                    let b = padded.at(at[0], at[1], at[2]);
                    if kinds.is_air(b) || b == UNLOADED {
                        continue;
                    }
                    let out_of = step(at, face.axis, if face.positive { 1 } else { -1 });
                    if !kinds.shows(b, padded.at(out_of[0], out_of[1], out_of[2])) {
                        continue;
                    }
                    let tile = kinds.tiles[usize::from(b)][slot(face)];
                    mask[iv as usize * SIZE + iu as usize] =
                        key(b, tile, corner_levels(kinds, padded, face, out_of, b));
                }
            }
            merge(kinds, face, slice, &mut mask, &mut out);
        }
    }
    out
}

/// The cell at `iu`, `iv` of one slice of a face direction, as x, y, z.
fn cell_at(face: &Face, slice: i32, iu: i32, iv: i32) -> [i32; 3] {
    let mut c = [0; 3];
    c[face.axis] = slice;
    c[face.u] = iu;
    c[face.v] = iv;
    c
}

fn step(mut c: [i32; 3], axis: usize, by: i32) -> [i32; 3] {
    c[axis] += by;
    c
}

/// 0 for top faces, 1 for sides and 2 for bottoms, the order of a block's tiles.
fn slot(face: &Face) -> usize {
    match (face.axis, face.positive) {
        (1, true) => 0,
        (1, false) => 2,
        _ => 1,
    }
}

/// Ambient occlusion at the four corners of the face of `b` whose outside cell is `out_of`, in the order (0,0),
/// (1,0), (1,1), (0,1) along `u` and `v`. Water and glass are never shaded.
fn corner_levels(kinds: &Kinds, padded: &Padded, face: &Face, out_of: [i32; 3], b: u8) -> [u8; 4] {
    if matches!(kinds.pass[usize::from(b)], Some(Pass::Water | Pass::Glass)) {
        return [3; 4];
    }
    let occludes = |c: [i32; 3]| u8::from(kinds.occludes(padded.at(c[0], c[1], c[2])));
    let mut levels = [0; 4];
    for (i, (a, c)) in [(0, 0), (1, 0), (1, 1), (0, 1)].into_iter().enumerate() {
        let (su, sv) = (if a == 1 { 1 } else { -1 }, if c == 1 { 1 } else { -1 });
        let side_u = occludes(step(out_of, face.u, su));
        let side_v = occludes(step(out_of, face.v, sv));
        let corner = occludes(step(step(out_of, face.u, su), face.v, sv));
        levels[i] = if side_u == 1 && side_v == 1 {
            0
        } else {
            3 - (side_u + side_v + corner)
        };
    }
    levels
}

/// Turns the faces in `mask` into quads: runs along `u`, then as many matching rows along `v` as fit.
fn merge(
    kinds: &Kinds,
    face: &Face,
    slice: i32,
    mask: &mut [Key; SIZE * SIZE],
    out: &mut ChunkMesh,
) {
    for iv in 0..SIZE {
        let mut iu = 0;
        while iu < SIZE {
            let k = mask[iv * SIZE + iu];
            if k == 0 {
                iu += 1;
                continue;
            }
            let mut w = 1;
            while iu + w < SIZE && mask[iv * SIZE + iu + w] == k {
                w += 1;
            }
            let mut h = 1;
            while iv + h < SIZE && (0..w).all(|d| mask[(iv + h) * SIZE + iu + d] == k) {
                h += 1;
            }
            for dv in 0..h {
                mask[(iv + dv) * SIZE + iu..(iv + dv) * SIZE + iu + w].fill(0);
            }
            let pass = kinds.pass[(k >> 16) as usize].unwrap();
            quad(
                out.pass_mut(pass),
                face,
                slice,
                [iu, iv],
                [w, h],
                k,
                pass == Pass::Water,
            );
            iu += w;
        }
    }
}

fn quad(
    mesh: &mut Mesh,
    face: &Face,
    slice: i32,
    at: [usize; 2],
    size: [usize; 2],
    k: Key,
    water: bool,
) {
    let tile = (k >> 8 & 0xff) as u8;
    let ao = [
        (k >> 6 & 3) as u8,
        (k >> 4 & 3) as u8,
        (k >> 2 & 3) as u8,
        (k & 3) as u8,
    ];
    let base = (mesh.positions.len() / 3) as u32;
    let plane = slice + i32::from(face.positive);
    let mut normal = [0i8; 3];
    normal[face.axis] = if face.positive { 1 } else { -1 };
    let water_top = water && face.axis == 1 && face.positive;
    for (i, (a, c)) in [(0, 0), (1, 0), (1, 1), (0, 1)].into_iter().enumerate() {
        let mut p = [0f32; 3];
        p[face.axis] = plane as f32;
        p[face.u] = (at[0] + a * size[0]) as f32;
        p[face.v] = (at[1] + c * size[1]) as f32;
        // Offsets from the quad's minimum corner, which is what the texture orientation depends on.
        let mut d = [0f32; 3];
        d[face.axis] = if face.positive { 1.0 } else { 0.0 };
        d[face.u] = (a * size[0]) as f32;
        d[face.v] = (c * size[1]) as f32;
        if water_top {
            p[1] -= WATER_DIP;
        }
        mesh.positions.extend(p);
        mesh.normals.extend(normal);
        let (s, t) = tile_uv(normal, d);
        mesh.uvs.extend([s, t]);
        mesh.tiles.push(tile);
        mesh.ao.push(ao[i]);
    }
    // Split along the diagonal that keeps the brighter corners together.
    let flip = ao[0] + ao[2] < ao[1] + ao[3];
    let order: [u32; 6] = if flip {
        [1, 2, 3, 1, 3, 0]
    } else {
        [0, 1, 2, 0, 2, 3]
    };
    mesh.indices.extend(order.map(|o| base + o));
}

/// Tile coordinates of a corner at offset `d` from the quad's minimum corner. Tops and bottoms run along x and z;
/// sides run along the horizontal axis they face away from, with up as the tile's up.
fn tile_uv(n: [i8; 3], d: [f32; 3]) -> (f32, f32) {
    match n {
        [_, 1, _] => (d[0], 1.0 - d[2]),
        [_, -1, _] => (d[0], d[2]),
        [_, _, 1] => (d[0], d[1]),
        [_, _, -1] => (1.0 - d[0], d[1]),
        [1, _, _] => (1.0 - d[2], d[1]),
        _ => (d[2], d[1]),
    }
}

const _: () = assert!(PADDED == SIZE + 2);

#[cfg(test)]
mod tests;
