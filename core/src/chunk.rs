//! Chunk geometry: how cells are numbered, and a chunk with a one-cell border of its neighbours.

/// Cells along each edge of a chunk.
pub const SIZE: usize = 16;
/// Cells in a chunk.
pub const CELLS: usize = SIZE * SIZE * SIZE;
/// Cells along each edge of a [`Padded`] chunk: the chunk and one cell of each neighbour.
pub const PADDED: usize = SIZE + 2;
/// Marks a padding cell whose chunk is not loaded. It is never a block id.
pub const UNLOADED: u8 = 255;

/// The position of a cell in a chunk's 4,096 bytes. Layers of one height are contiguous.
pub const fn cell(x: usize, y: usize, z: usize) -> usize {
    (y << 8) | (z << 4) | x
}

/// A chunk and the cells of its 26 neighbours that touch it, so meshing can look one cell past each edge
/// (for hidden faces and ambient occlusion) without knowing about other chunks.
pub struct Padded(Box<[u8; PADDED * PADDED * PADDED]>);

impl Default for Padded {
    fn default() -> Self {
        Self::new()
    }
}

impl Padded {
    /// Every cell [`UNLOADED`].
    pub fn new() -> Self {
        Padded(Box::new([UNLOADED; PADDED * PADDED * PADDED]))
    }

    /// Fills the cells that `chunk` contributes: all of it for the chunk itself (`offset` 0, 0, 0), a face of cells
    /// for a neighbour across a face, an edge or a corner for one across those. Each `offset` is -1, 0 or 1.
    ///
    /// # Panics
    /// If `chunk` is not [`CELLS`] bytes or an offset is out of range.
    pub fn set_chunk(&mut self, offset: [i32; 3], chunk: &[u8]) {
        assert_eq!(chunk.len(), CELLS, "a chunk is {CELLS} bytes");
        assert!(
            offset.iter().all(|o| (-1..=1).contains(o)),
            "offset is -1, 0 or 1"
        );
        let range = |o: i32| match o {
            -1 => -1..0,
            0 => 0..SIZE as i32,
            _ => SIZE as i32..SIZE as i32 + 1,
        };
        for y in range(offset[1]) {
            for z in range(offset[2]) {
                for x in range(offset[0]) {
                    let src = |c: i32, o: i32| (c - o * SIZE as i32) as usize;
                    let from = cell(src(x, offset[0]), src(y, offset[1]), src(z, offset[2]));
                    self.0[Self::index(x, y, z)] = chunk[from];
                }
            }
        }
    }

    /// The block at `x`, `y`, `z`, each from -1 to 16. Outside that is [`UNLOADED`].
    pub fn at(&self, x: i32, y: i32, z: i32) -> u8 {
        let inside = |c: i32| (-1..=SIZE as i32).contains(&c);
        if inside(x) && inside(y) && inside(z) {
            self.0[Self::index(x, y, z)]
        } else {
            UNLOADED
        }
    }

    fn index(x: i32, y: i32, z: i32) -> usize {
        ((y + 1) as usize * PADDED + (z + 1) as usize) * PADDED + (x + 1) as usize
    }
}

#[cfg(test)]
mod tests;
