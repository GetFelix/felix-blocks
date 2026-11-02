//! The value stored in a world's info cache: what a client needs to start generating the world.
//!
//! ```text
//! byte 0      format, 1
//! byte 1      generator version the world was created with
//! bytes 2-5   seed, u32
//! bytes 6-11  size in chunks: x, y, z, each u16
//! bytes 12-23 spawn point in blocks: x, y, z, each i32
//! ```
//!
//! Integers are little endian. `blocks-tool` writes it once, when the world is created, and players only read it.

use crate::blocks::AIR;
use crate::chunk::{SIZE, cell};
use crate::worldgen::{GENERATOR_VERSION, SEA_LEVEL, WORLD_CHUNKS, generate_chunk, ground_height};
use std::fmt;

const FORMAT: u8 = 1;
/// Bytes in an encoded info value.
pub const LEN: usize = 24;
/// The cache key the info is stored under. The cache holds nothing else.
pub const KEY: &str = "info";

/// How far from the middle of the world [`WorldInfo::new`] looks for dry ground, in blocks.
const SPAWN_SEARCH: i32 = 512;
const SPAWN_STEP: i32 = 8;

/// What a world is made of.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorldInfo {
    pub seed: u32,
    pub generator_version: u8,
    /// Size in chunks: x, y (up) and z.
    pub size: [u16; 3],
    /// Where players start, in blocks: x, y (up) and z. `y` is the first air block above the ground.
    pub spawn: [i32; 3],
}

/// Why an info value could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// Not [`LEN`] bytes.
    WrongLength,
    /// A format byte this code does not know.
    UnknownFormat(u8),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecodeError::WrongLength => write!(f, "the world info is not {LEN} bytes"),
            DecodeError::UnknownFormat(format) => {
                write!(
                    f,
                    "the world info has format {format}, which this build does not know"
                )
            }
        }
    }
}

impl std::error::Error for DecodeError {}

impl WorldInfo {
    /// The info of a new world made with the newest generator. The spawn point is dry ground near the
    /// middle of the world, so nobody starts in a lake.
    pub fn new(seed: u32) -> WorldInfo {
        let version = GENERATOR_VERSION;
        let size = WORLD_CHUNKS.map(|n| n as u16);
        let middle = [WORLD_CHUNKS[0] * 8, WORLD_CHUNKS[2] * 8];
        WorldInfo {
            seed,
            generator_version: version,
            size,
            spawn: spawn_point(version, seed, middle),
        }
    }

    /// The 24 bytes to store.
    pub fn encode(&self) -> [u8; LEN] {
        let mut out = [0u8; LEN];
        out[0] = FORMAT;
        out[1] = self.generator_version;
        out[2..6].copy_from_slice(&self.seed.to_le_bytes());
        for (i, n) in self.size.iter().enumerate() {
            out[6 + 2 * i..8 + 2 * i].copy_from_slice(&n.to_le_bytes());
        }
        for (i, n) in self.spawn.iter().enumerate() {
            out[12 + 4 * i..16 + 4 * i].copy_from_slice(&n.to_le_bytes());
        }
        out
    }

    /// Reads a stored value.
    pub fn decode(value: &[u8]) -> Result<WorldInfo, DecodeError> {
        let value: &[u8; LEN] = value.try_into().map_err(|_| DecodeError::WrongLength)?;
        if value[0] != FORMAT {
            return Err(DecodeError::UnknownFormat(value[0]));
        }
        let u16_at = |at: usize| u16::from_le_bytes([value[at], value[at + 1]]);
        let i32_at = |at: usize| i32::from_le_bytes(value[at..at + 4].try_into().unwrap());
        Ok(WorldInfo {
            generator_version: value[1],
            seed: u32::from_le_bytes(value[2..6].try_into().unwrap()),
            size: [u16_at(6), u16_at(8), u16_at(10)],
            spawn: [i32_at(12), i32_at(16), i32_at(20)],
        })
    }
}

/// Whether the block at `y - 1` is solid and the two at `y` and above in the column are air, so a player stands there
/// and no tree is in the way. Ground height is taken before caves, so a cave can open under the spawn.
fn standing_room(version: u8, seed: u32, x: i32, y: i32, z: i32) -> bool {
    let size = SIZE as i32;
    let chunk = |y: i32| {
        generate_chunk(
            version,
            seed,
            x.div_euclid(size),
            y.div_euclid(size),
            z.div_euclid(size),
        )
    };
    let block = |y: i32| {
        chunk(y).map(|blocks| {
            blocks[cell(
                x.rem_euclid(size) as usize,
                y.rem_euclid(size) as usize,
                z.rem_euclid(size) as usize,
            )]
        })
    };
    block(y - 1).is_some_and(|b| b != AIR) && block(y) == Some(AIR) && block(y + 1) == Some(AIR)
}

/// The first dry column found walking outwards in squares from `middle`, standing on top of its ground. A world
/// with no dry ground in range spawns at the middle, above the water.
fn spawn_point(version: u8, seed: u32, middle: [i32; 2]) -> [i32; 3] {
    let column = |x: i32, z: i32| ground_height(version, seed, x, z).map(|h| (x, z, h));
    for ring in (0..=SPAWN_SEARCH).step_by(SPAWN_STEP as usize) {
        for dz in (-ring..=ring).step_by(SPAWN_STEP as usize) {
            for dx in (-ring..=ring).step_by(SPAWN_STEP as usize) {
                if dx.abs().max(dz.abs()) != ring {
                    continue;
                }
                if let Some((x, z, h)) = column(middle[0] + dx, middle[1] + dz)
                    && h >= SEA_LEVEL
                    && standing_room(version, seed, x, h + 1, z)
                {
                    return [x, h + 1, z];
                }
            }
        }
    }
    [middle[0], SEA_LEVEL + 1, middle[1]]
}

#[cfg(test)]
mod tests;
