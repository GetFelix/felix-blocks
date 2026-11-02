//! The block table. A block is one byte in a chunk, an index into [`BLOCKS`], so the order
//! and ids here are part of the stored format: add to the end, never renumber.

/// How a block is drawn. The mesher keeps one mesh per pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pass {
    /// Solid and fully covering: hides the faces behind it.
    Opaque,
    /// Solid with holes, drawn with an alpha test (leaves).
    Cutout,
    /// Blended, drawn after everything else (glass).
    Glass,
    /// Blended and lowered below the block top (water).
    Water,
}

impl Pass {
    pub const fn name(self) -> &'static str {
        match self {
            Pass::Opaque => "opaque",
            Pass::Cutout => "cutout",
            Pass::Glass => "glass",
            Pass::Water => "water",
        }
    }
}

/// One entry of the block table. `tiles` are the Voxel Pack tile names for the top,
/// side and bottom faces.
#[derive(Clone, Copy, Debug)]
pub struct Block {
    pub id: u8,
    pub name: &'static str,
    pub tiles: [&'static str; 3],
    pub pass: Pass,
}

const fn block(id: u8, name: &'static str, tiles: [&'static str; 3], pass: Pass) -> Block {
    Block {
        id,
        name,
        tiles,
        pass,
    }
}

/// Every block, indexed by id. Id 0 is air and has no faces.
pub const BLOCKS: [Block; 16] = [
    block(0, "Air", ["", "", ""], Pass::Opaque),
    block(
        1,
        "Grass",
        ["grass_top", "dirt_grass", "dirt"],
        Pass::Opaque,
    ),
    block(2, "Dirt", ["dirt", "dirt", "dirt"], Pass::Opaque),
    block(3, "Stone", ["stone", "stone", "stone"], Pass::Opaque),
    block(4, "Sand", ["sand", "sand", "sand"], Pass::Opaque),
    block(5, "Water", ["water", "water", "water"], Pass::Water),
    block(
        6,
        "Oak log",
        ["trunk_top", "trunk_side", "trunk_top"],
        Pass::Opaque,
    ),
    block(7, "Leaves", ["leaves_transparent"; 3], Pass::Cutout),
    block(8, "Oak planks", ["wood", "wood", "wood"], Pass::Opaque),
    block(9, "Glass", ["glass", "glass", "glass"], Pass::Glass),
    block(
        10,
        "Brick",
        ["brick_red", "brick_red", "brick_red"],
        Pass::Opaque,
    ),
    block(
        11,
        "Gravel",
        ["gravel_stone", "gravel_stone", "gravel_stone"],
        Pass::Opaque,
    ),
    block(
        12,
        "Coal ore",
        ["stone_coal", "stone_coal", "stone_coal"],
        Pass::Opaque,
    ),
    block(
        13,
        "Iron ore",
        ["stone_iron", "stone_iron", "stone_iron"],
        Pass::Opaque,
    ),
    block(
        14,
        "Cobblestone",
        ["greystone", "greystone", "greystone"],
        Pass::Opaque,
    ),
    block(
        15,
        "Red planks",
        ["wood_red", "wood_red", "wood_red"],
        Pass::Opaque,
    ),
];

/// Tiles drawn as crossed quads on top of the ground: grass tufts and a wheat crop.
/// They are decoration, not blocks.
pub const PLANT_TILES: [&str; 5] = ["grass1", "grass2", "grass3", "grass4", "wheat_stage4"];

/// Every tile name the game draws, in the order the atlas lays them out, without repeats.
pub fn tile_names() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = Vec::new();
    let blocks = BLOCKS.iter().skip(1).flat_map(|b| b.tiles);
    for tile in blocks.chain(PLANT_TILES) {
        if !names.contains(&tile) {
            names.push(tile);
        }
    }
    names
}

/// The table as JSON for the page: `{"blocks": [...], "plants": [...], "tiles": [...]}`.
pub fn table_json() -> String {
    fn list(items: impl Iterator<Item = String>) -> String {
        items.collect::<Vec<_>>().join(",")
    }
    let quoted = |s: &str| format!("\"{s}\"");
    let blocks = list(BLOCKS.iter().skip(1).map(|b| {
        format!(
            r#"{{"id":{},"name":{},"top":{},"side":{},"bottom":{},"pass":{}}}"#,
            b.id,
            quoted(b.name),
            quoted(b.tiles[0]),
            quoted(b.tiles[1]),
            quoted(b.tiles[2]),
            quoted(b.pass.name()),
        )
    }));
    let plants = list(PLANT_TILES.iter().map(|t| quoted(t)));
    let tiles = list(tile_names().iter().map(|t| quoted(t)));
    format!(r#"{{"blocks":[{blocks}],"plants":[{plants}],"tiles":[{tiles}]}}"#)
}

#[cfg(test)]
mod tests;
