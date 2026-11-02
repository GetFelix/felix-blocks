use super::*;
use crate::blocks::BLOCKS;
use std::collections::BTreeMap;

const GOLDEN: &str = "testdata/worldgen.golden";

/// A spread of chunks: both world corners, the middle, and places in between, at heights from bedrock to sky.
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
    let heights = [0, 2, 4, 5, 6, 7, 8];
    let mut out = Vec::new();
    for seed in seeds {
        for (cx, cz) in columns {
            for cy in heights {
                out.push((seed, cx, cy, cz));
            }
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
fn nothing_grows_above_the_highest_ground_and_the_bottom_is_never_hollow() {
    let sky = generate_chunk(1, 3, 50, 8, 50).unwrap();
    assert!(sky.iter().all(|b| *b == AIR));
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

/// A tree on a chunk's edge has to be whole in both chunks, or the seam would show a trunk with half a crown.
#[test]
fn trees_are_whole_across_chunk_edges() {
    let mut checked = 0;
    for cx in 100..160 {
        let here = generate_chunk(1, 21, cx, 4, 100).unwrap();
        let next = generate_chunk(1, 21, cx + 1, 4, 100).unwrap();
        for z in 0..16 {
            for y in 0..15 {
                // The top log of a tree has leaves on all four sides of it.
                if here[cell(15, y, z)] == OAK_LOG && here[cell(15, y + 1, z)] != OAK_LOG {
                    assert!(
                        matches!(next[cell(0, y, z)], LEAVES | OAK_LOG),
                        "no crown at {cx}, {y}, {z}"
                    );
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 0, "no tree stood on a chunk edge to check");
}
