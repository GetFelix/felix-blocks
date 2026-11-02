use super::*;
use std::collections::HashSet;

fn pos(cx: i32, cy: i32, cz: i32) -> ChunkPos {
    ChunkPos { cx, cy, cz }
}

/// The gateway accepts keys of 1 to 64 letters, digits, `-` and `_`.
fn gateway_accepts(key: &str) -> bool {
    (1..=64).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[test]
fn a_key_names_the_region_then_the_chunk_in_it() {
    assert_eq!(pos(3, 5, 3).key().unwrap(), "R8000_8000-335");
    // Region (0, 3), chunk (3, 6) in it: chunk x 3, chunk z 3 * 8 + 6.
    assert_eq!(pos(3, 5, 30).key().unwrap(), "R8000_8003-365");
    assert_eq!(pos(255, 15, 255).key().unwrap(), "R801f_801f-77f");
    assert_eq!(region_prefix(0, 3).unwrap(), "R8000_8003-");
}

#[test]
fn chunks_outside_the_world_have_no_key() {
    for p in [
        pos(-1, 0, 0),
        pos(256, 0, 0),
        pos(0, -1, 0),
        pos(0, 16, 0),
        pos(0, 0, 256),
        pos(0, 0, -1),
    ] {
        assert_eq!(p.key(), None, "{p:?}");
    }
    assert_eq!(region_prefix(32, 0), None);
    assert_eq!(region_prefix(0, -1), None);
}

/// Every chunk of the world, with all that the design says about its key.
#[test]
fn every_key_fits_the_gateway_and_reads_back() {
    let mut prefixes = HashSet::new();
    let mut keys = HashSet::new();
    for cz in 0..WORLD_CHUNKS[2] {
        for cx in 0..WORLD_CHUNKS[0] {
            for cy in 0..WORLD_CHUNKS[1] {
                let p = pos(cx, cy, cz);
                let key = p.key().unwrap();
                assert!(gateway_accepts(&key), "{key}");
                assert_eq!(key.len(), KEY_LEN);
                assert_eq!(ChunkPos::from_key(&key), Some(p), "{key}");
                let (rx, rz) = p.region();
                assert!(key.starts_with(&region_prefix(rx, rz).unwrap()));
                assert!(keys.insert(key));
            }
        }
    }
    for rz in 0..32 {
        for rx in 0..32 {
            assert!(prefixes.insert(region_prefix(rx, rz).unwrap()));
        }
    }
    assert_eq!(keys.len(), 256 * 16 * 256);
}

/// A region's prefix matches the 8 x 8 x 16 keys of that region and none of any other: every prefix has the same
/// length and ends in `-`, so no prefix can start another key.
#[test]
fn a_region_prefix_matches_only_its_own_chunks() {
    let prefix = region_prefix(5, 9).unwrap();
    assert_eq!(prefix.len(), PREFIX_LEN);
    let mut matches = 0;
    for (rx, rz) in [(5, 9), (5, 8), (4, 9), (6, 9), (5, 10), (21, 9), (5, 25)] {
        for lz in 0..REGION_CHUNKS {
            for lx in 0..REGION_CHUNKS {
                for cy in 0..16 {
                    let key = pos(rx * 8 + lx, cy, rz * 8 + lz).key().unwrap();
                    if key.starts_with(&prefix) {
                        assert_eq!((rx, rz), (5, 9));
                        matches += 1;
                    }
                }
            }
        }
    }
    assert_eq!(matches, 8 * 8 * 16);
}

#[test]
fn keys_that_are_not_canonical_are_not_chunks() {
    for key in [
        "",
        "R8000_8003-36",
        "R8000_8003-3655",
        "r8000_8003-365",
        "R8000-8003-365",
        "R8000_8003_365",
        "R801F_801f-77f",
        "R801f_801f-77F",
        // Chunk x 8 does not fit in a region 8 chunks wide.
        "R8000_8003-865",
        "R8000_8003-385",
        // Regions 32 and up, and below the offset, are outside the world.
        "R8020_8000-000",
        "R7fff_8000-000",
        "R+000_8000-000",
        "R8000_8000-00g",
    ] {
        assert_eq!(ChunkPos::from_key(key), None, "{key}");
    }
}
