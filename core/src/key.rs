//! The cache key of a chunk. The key puts the chunk's region first, in fixed width, so a prefix watch on
//! `R8000_8003-` is exactly that region's chunks and never a neighbour's:
//!
//! ```text
//! R<rx:4 hex>_<rz:4 hex>-<lx:1 hex><lz:1 hex><cy:1 hex>
//! R8000_8003-365          region (0x8000, 0x8003), chunk (3, 6) in it, height 5
//! ```
//!
//! A region is 8 x 8 chunks across the full height. Region coordinates are offset by `0x8000` so they stay
//! unsigned. Keys are 14 characters of letters, digits and `_` or `-`, which is what the gateway accepts.

use crate::worldgen::WORLD_CHUNKS;

/// Chunks along each side of a region.
pub const REGION_CHUNKS: i32 = 8;
const REGION_OFFSET: i32 = 0x8000;
/// Characters in a region's prefix, `R8000_8003-`.
pub const PREFIX_LEN: usize = 11;
/// Characters in a chunk's key.
pub const KEY_LEN: usize = PREFIX_LEN + 3;

/// A chunk's place in the world, in chunk coordinates: x and z across, y up.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ChunkPos {
    pub cx: i32,
    pub cy: i32,
    pub cz: i32,
}

impl ChunkPos {
    /// Whether the chunk is inside a world.
    pub fn in_world(self) -> bool {
        let inside = |c, max| (0..max).contains(&c);
        inside(self.cx, WORLD_CHUNKS[0])
            && inside(self.cy, WORLD_CHUNKS[1])
            && inside(self.cz, WORLD_CHUNKS[2])
    }

    /// The region this chunk is in, as `(rx, rz)` from 0.
    pub fn region(self) -> (i32, i32) {
        (
            self.cx.div_euclid(REGION_CHUNKS),
            self.cz.div_euclid(REGION_CHUNKS),
        )
    }

    /// The chunk's key, or `None` for a chunk outside the world.
    pub fn key(self) -> Option<String> {
        if !self.in_world() {
            return None;
        }
        let (rx, rz) = self.region();
        let (lx, lz) = (self.cx % REGION_CHUNKS, self.cz % REGION_CHUNKS);
        Some(format!(
            "{}{lx:x}{lz:x}{:x}",
            region_prefix(rx, rz)?,
            self.cy
        ))
    }

    /// The chunk a key names, or `None` for a key that [`ChunkPos::key`] would not have made.
    pub fn from_key(key: &str) -> Option<ChunkPos> {
        let b = key.as_bytes();
        if b.len() != KEY_LEN || b[0] != b'R' || b[5] != b'_' || b[10] != b'-' {
            return None;
        }
        let rx = hex(&key[1..5])? - REGION_OFFSET;
        let rz = hex(&key[6..10])? - REGION_OFFSET;
        let (lx, lz, cy) = (hex(&key[11..12])?, hex(&key[12..13])?, hex(&key[13..14])?);
        if lx >= REGION_CHUNKS || lz >= REGION_CHUNKS {
            return None;
        }
        let pos = ChunkPos {
            cx: rx * REGION_CHUNKS + lx,
            cy,
            cz: rz * REGION_CHUNKS + lz,
        };
        // Reading back through `key` rejects an uppercase digit and anything else that is not the canonical spelling.
        (pos.key().as_deref() == Some(key)).then_some(pos)
    }
}

/// The prefix shared by every key in region `rx`, `rz`, or `None` for a region outside the world.
pub fn region_prefix(rx: i32, rz: i32) -> Option<String> {
    let regions = [
        WORLD_CHUNKS[0] / REGION_CHUNKS,
        WORLD_CHUNKS[2] / REGION_CHUNKS,
    ];
    if !(0..regions[0]).contains(&rx) || !(0..regions[1]).contains(&rz) {
        return None;
    }
    Some(format!(
        "R{:04x}_{:04x}-",
        rx + REGION_OFFSET,
        rz + REGION_OFFSET
    ))
}

/// A lowercase hex number of one to four digits.
fn hex(digits: &str) -> Option<i32> {
    if !digits
        .bytes()
        .all(|d| d.is_ascii_digit() || (b'a'..=b'f').contains(&d))
    {
        return None;
    }
    i32::from_str_radix(digits, 16).ok()
}

#[cfg(test)]
mod tests;
