//! Terrain from a seed. A world stores only what players changed, as a difference from this, so the
//! generator has to give every client the same blocks for the same seed. It uses integers only (see
//! [`noise`]) and is versioned: a change to what it produces is a new version, and a world keeps the
//! version it was created with.
//!
//! Version 1 is rolling hills and lakes, sand at the water's edge, caves that mostly stay underground,
//! scattered ore and trees that gather into woods.

mod noise;

use crate::blocks::{
    AIR, COAL_ORE, DIRT, GRASS, GRAVEL, IRON_ORE, LEAVES, OAK_LOG, SAND, STONE, WATER,
};
use crate::chunk::{CELLS, SIZE, cell};
use noise::{hash, noise2, noise3};

/// The newest generator. Worlds made today use it.
pub const GENERATOR_VERSION: u8 = 1;

/// A world's size in chunks: x, y (up) and z.
pub const WORLD_CHUNKS: [i32; 3] = [256, 16, 256];

/// Water fills a column up to and including the block at this height, where the ground is lower.
pub const SEA_LEVEL: i32 = 70;

const MIN_HEIGHT: i32 = 40;
/// The highest ground any seed makes. Chunks starting more than a tree above it are air.
const MAX_HEIGHT: i32 = MIN_HEIGHT + 75;
const MAX_TREE: i32 = 9;

/// Chunks from the bottom that can hold anything but air: layer 8 and above are always air.
pub const TERRAIN_LAYERS: i32 = (MAX_HEIGHT + MAX_TREE) / SIZE as i32 + 1;

// Salts keep the noises of one seed independent of each other.
const CONTINENT: u32 = 1;
const HILLS: u32 = 2;
const BUMPS: u32 = 3;
const SEABED: u32 = 4;
const CAVE_A: u32 = 5;
const CAVE_B: u32 = 6;
const OPENING: u32 = 7;
const ORE: u32 = 8;
const WOODS: u32 = 9;
const TREE: u32 = 10;
const TREE_HEIGHT: u32 = 11;

/// The chunk at `cx`, `cy`, `cz` (chunk coordinates) as 4,096 block ids in the order of [`cell`]. `None` for
/// a generator version that does not exist and for a chunk outside the world.
pub fn generate_chunk(version: u8, seed: u32, cx: i32, cy: i32, cz: i32) -> Option<Vec<u8>> {
    let in_world = |c, max| (0..max).contains(&c);
    if version != 1
        || !in_world(cx, WORLD_CHUNKS[0])
        || !in_world(cy, WORLD_CHUNKS[1])
        || !in_world(cz, WORLD_CHUNKS[2])
    {
        return None;
    }
    let mut blocks = vec![AIR; CELLS];
    let (x0, y0, z0) = (cx * SIZE as i32, cy * SIZE as i32, cz * SIZE as i32);
    if cy >= TERRAIN_LAYERS {
        return Some(blocks);
    }
    fill_ground(&mut blocks, seed, x0, y0, z0);
    grow_trees(&mut blocks, seed, x0, y0, z0);
    Some(blocks)
}

/// The height of the highest ground block in the column at `x`, `z` (block coordinates), before caves and trees.
/// `None` for a generator version that does not exist.
pub fn ground_height(version: u8, seed: u32, x: i32, z: i32) -> Option<i32> {
    (version == 1).then(|| height(seed, x, z))
}

fn height(seed: u32, x: i32, z: i32) -> i32 {
    let continent = noise2(seed, CONTINENT, x, z, 8) as i64;
    let hills = noise2(seed, HILLS, x, z, 6) as i64;
    let bumps = noise2(seed, BUMPS, x, z, 4) as i64;
    MIN_HEIGHT + ((continent * 44 + hills * 24 + bumps * 8) >> 16) as i32
}

fn fill_ground(blocks: &mut [u8], seed: u32, x0: i32, y0: i32, z0: i32) {
    for lz in 0..SIZE as i32 {
        for lx in 0..SIZE as i32 {
            let (x, z) = (x0 + lx, z0 + lz);
            let ground = height(seed, x, z);
            let top = ground_cover(seed, x, z, ground);
            let cave_top = if cave_opens(seed, x, z, ground) {
                ground
            } else {
                ground - 5
            };
            for ly in 0..SIZE as i32 {
                let y = y0 + ly;
                let block = if y > ground.max(SEA_LEVEL) {
                    continue;
                } else if y > ground {
                    WATER
                } else if (3..=cave_top).contains(&y) && in_cave(seed, x, y, z) {
                    continue;
                } else if y == ground {
                    top.0
                } else if y >= ground - 3 {
                    top.1
                } else {
                    ore(seed, x, y, z, ground)
                };
                blocks[cell(lx as usize, ly as usize, lz as usize)] = block;
            }
        }
    }
}

/// The top block of a column and the three below it.
fn ground_cover(seed: u32, x: i32, z: i32, ground: i32) -> (u8, u8) {
    if ground < SEA_LEVEL - 1 {
        let seabed = if noise2(seed, SEABED, x, z, 4) > 38_000 {
            GRAVEL
        } else {
            SAND
        };
        (seabed, seabed)
    } else if ground <= SEA_LEVEL + 1 {
        (SAND, SAND)
    } else {
        (GRASS, DIRT)
    }
}

/// Caves reach the surface only inside the zones where an entrance is allowed, and never under water.
fn cave_opens(seed: u32, x: i32, z: i32, ground: i32) -> bool {
    ground > SEA_LEVEL + 1 && noise2(seed, OPENING, x, z, 6) > 52_000
}

/// Tunnels are where two independent noises are both near their middle.
fn in_cave(seed: u32, x: i32, y: i32, z: i32) -> bool {
    const BAND: i32 = 4_200;
    let near_middle = |salt| (noise3(seed, salt, x, y, z, 5, 4) - 32_768).abs() < BAND;
    near_middle(CAVE_A) && near_middle(CAVE_B)
}

fn ore(seed: u32, x: i32, y: i32, z: i32, ground: i32) -> u8 {
    if y > ground - 5 {
        return STONE;
    }
    match hash(seed, ORE, x, y, z) % 1000 {
        0..=11 => COAL_ORE,
        12..=17 if y < 60 => IRON_ORE,
        _ => STONE,
    }
}

/// How many trees per thousand columns grow at `x`, `z`: a few anywhere, many inside a wood.
fn trees_per_thousand(seed: u32, x: i32, z: i32) -> u32 {
    let wood = noise2(seed, WOODS, x, z, 6) as u64;
    3 + ((wood * wood * 90) >> 32) as u32
}

/// The trunk height of the tree rooted in the column at `x`, `z`, if there is one.
fn tree_at(seed: u32, x: i32, z: i32, ground: i32) -> Option<i32> {
    if ground <= SEA_LEVEL + 1
        || cave_opens(seed, x, z, ground)
        || hash(seed, TREE, x, 0, z) % 1000 >= trees_per_thousand(seed, x, z)
    {
        return None;
    }
    Some(4 + (hash(seed, TREE_HEIGHT, x, 0, z) % 3) as i32)
}

/// Trees are drawn into every chunk they touch, so one that stands on a chunk edge is whole on both sides. Leaves
/// only fill air and logs overwrite, which makes the result the same whichever tree comes first.
fn grow_trees(blocks: &mut [u8], seed: u32, x0: i32, y0: i32, z0: i32) {
    // Ground is never lower than MIN_HEIGHT, so a chunk entirely below it has no trunk or leaf.
    if y0 + (SIZE as i32) < MIN_HEIGHT {
        return;
    }
    let reach = 2;
    let mut trees = Vec::new();
    for z in z0 - reach..z0 + SIZE as i32 + reach {
        for x in x0 - reach..x0 + SIZE as i32 + reach {
            let ground = height(seed, x, z);
            if let Some(trunk) = tree_at(seed, x, z, ground) {
                trees.push((x, z, ground, trunk));
            }
        }
    }
    let local = |x: i32, y: i32, z: i32| {
        let inside = |v: i32, origin: i32| (origin..origin + SIZE as i32).contains(&v);
        (inside(x, x0) && inside(y, y0) && inside(z, z0))
            .then(|| cell((x - x0) as usize, (y - y0) as usize, (z - z0) as usize))
    };
    for &(x, z, ground, trunk) in &trees {
        let crown = ground + trunk;
        for dy in -1..=2i32 {
            for dz in -2..=2i32 {
                for dx in -2..=2i32 {
                    if dx * dx + dy * dy + dz * dz > 6 {
                        continue;
                    }
                    if let Some(i) = local(x + dx, crown + dy, z + dz)
                        && blocks[i] == AIR
                    {
                        blocks[i] = LEAVES;
                    }
                }
            }
        }
    }
    for &(x, z, ground, trunk) in &trees {
        for y in ground + 1..=ground + trunk {
            if let Some(i) = local(x, y, z) {
                blocks[i] = OAK_LOG;
            }
        }
    }
}

#[cfg(test)]
mod tests;
