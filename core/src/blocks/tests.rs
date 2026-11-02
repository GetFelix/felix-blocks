use std::path::Path;

use super::*;

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
        let stem = file.strip_suffix(".png").unwrap();
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
