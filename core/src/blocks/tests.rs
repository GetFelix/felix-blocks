use std::path::Path;

use super::*;

/// The stored format: a chunk holds these ids. Changing this list on purpose means every saved
/// world changes meaning, so it is spelled out here and not derived from the table.
const STORED_IDS: [&str; 16] = [
    "Air",
    "Grass",
    "Dirt",
    "Stone",
    "Sand",
    "Water",
    "Oak log",
    "Leaves",
    "Oak planks",
    "Glass",
    "Brick",
    "Gravel",
    "Coal ore",
    "Iron ore",
    "Cobblestone",
    "Red planks",
];

#[test]
fn ids_never_move() {
    for (i, name) in STORED_IDS.iter().enumerate() {
        assert_eq!(BLOCKS[i].name, *name, "id {i} changed");
    }
    assert!(BLOCKS.len() >= STORED_IDS.len());
}

#[test]
fn ids_are_their_index() {
    for (i, b) in BLOCKS.iter().enumerate() {
        assert_eq!(usize::from(b.id), i, "{} is out of place", b.name);
    }
}

#[test]
fn every_tile_is_a_file_in_the_voxel_pack() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/assets/voxel-pack/tiles");
    for tile in tile_names() {
        assert!(
            dir.join(format!("{tile}.png")).is_file(),
            "missing tile {tile}"
        );
    }
}

#[test]
fn tiles_are_listed_once() {
    let names = tile_names();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(names.len(), sorted.len());
}

#[test]
fn every_tile_file_is_used() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/assets/voxel-pack/tiles");
    let names = tile_names();
    for entry in std::fs::read_dir(dir).unwrap() {
        let file = entry.unwrap().file_name().into_string().unwrap();
        let Some(stem) = file.strip_suffix(".png") else {
            continue;
        };
        assert!(
            names.contains(&stem),
            "{file} is shipped but no block uses it"
        );
    }
}

#[test]
fn json_names_every_block() {
    let json = table_json();
    for b in BLOCKS.iter().skip(1) {
        assert!(
            json.contains(&format!("\"name\":\"{}\"", b.name)),
            "{} missing",
            b.name
        );
    }
    assert!(json.starts_with(r#"{"blocks":[{"id":1,"#));
}

#[test]
fn names_need_no_json_escaping() {
    for b in BLOCKS.iter() {
        for text in std::iter::once(b.name).chain(b.tiles) {
            assert!(
                !text.contains(['"', '\\']) && text.is_ascii(),
                "{text} needs escaping"
            );
        }
    }
}

#[test]
fn the_named_ids_point_at_their_blocks() {
    for (id, name) in [
        (AIR, "Air"),
        (GRASS, "Grass"),
        (DIRT, "Dirt"),
        (STONE, "Stone"),
        (SAND, "Sand"),
        (WATER, "Water"),
        (OAK_LOG, "Oak log"),
        (LEAVES, "Leaves"),
        (GRAVEL, "Gravel"),
        (COAL_ORE, "Coal ore"),
        (IRON_ORE, "Iron ore"),
    ] {
        assert_eq!(BLOCKS[id as usize].name, name);
    }
}
