//! The browser's view of the crate.

use wasm_bindgen::prelude::*;

/// [`crate::blocks::table_json`]: the block table and the tiles it needs.
#[wasm_bindgen(js_name = blockTable)]
pub fn block_table() -> String {
    crate::blocks::table_json()
}

/// [`crate::worldgen::GENERATOR_VERSION`]: the generator new worlds use.
#[wasm_bindgen(js_name = generatorVersion)]
pub fn generator_version() -> u8 {
    crate::worldgen::GENERATOR_VERSION
}

/// [`crate::worldgen::SEA_LEVEL`].
#[wasm_bindgen(js_name = seaLevel)]
pub fn sea_level() -> i32 {
    crate::worldgen::SEA_LEVEL
}

/// [`crate::worldgen::WORLD_CHUNKS`]: x, y (up) and z.
#[wasm_bindgen(js_name = worldChunks)]
pub fn world_chunks() -> Vec<i32> {
    crate::worldgen::WORLD_CHUNKS.to_vec()
}

/// [`crate::worldgen::TERRAIN_LAYERS`].
#[wasm_bindgen(js_name = terrainLayers)]
pub fn terrain_layers() -> i32 {
    crate::worldgen::TERRAIN_LAYERS
}

/// [`crate::worldgen::generate_chunk`]: 4,096 block ids. Throws for a generator version that does not exist and for a
/// chunk outside the world.
#[wasm_bindgen(js_name = generateChunk)]
pub fn generate_chunk(
    version: u8,
    seed: u32,
    cx: i32,
    cy: i32,
    cz: i32,
) -> Result<Vec<u8>, JsError> {
    crate::worldgen::generate_chunk(version, seed, cx, cy, cz)
        .ok_or_else(|| JsError::new("no such generator version or chunk outside the world"))
}

/// [`crate::worldgen::ground_height`]. Throws for a generator version that does not exist.
#[wasm_bindgen(js_name = groundHeight)]
pub fn ground_height(version: u8, seed: u32, x: i32, z: i32) -> Result<i32, JsError> {
    crate::worldgen::ground_height(version, seed, x, z)
        .ok_or_else(|| JsError::new("no such generator version"))
}

fn pass(index: u8) -> Result<crate::Pass, JsError> {
    match index {
        0 => Ok(crate::Pass::Opaque),
        1 => Ok(crate::Pass::Cutout),
        2 => Ok(crate::Pass::Glass),
        3 => Ok(crate::Pass::Water),
        _ => Err(JsError::new(
            "pass is 0 (opaque), 1 (cutout), 2 (glass) or 3 (water)",
        )),
    }
}

/// A chunk and the cells of its neighbours that touch it. Fill it with [`Neighbourhood::set_chunk`], then mesh.
#[wasm_bindgen]
pub struct Neighbourhood(crate::chunk::Padded);

#[wasm_bindgen]
impl Neighbourhood {
    /// Every cell starts out not loaded.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Neighbourhood {
        Neighbourhood(crate::chunk::Padded::new())
    }

    /// See [`crate::chunk::Padded::set_chunk`]. Throws if `chunk` is not 4,096 bytes or an offset is not -1, 0 or 1.
    #[wasm_bindgen(js_name = setChunk)]
    pub fn set_chunk(&mut self, dx: i32, dy: i32, dz: i32, chunk: &[u8]) -> Result<(), JsError> {
        let in_range = |o: i32| (-1..=1).contains(&o);
        if chunk.len() != crate::chunk::CELLS || !(in_range(dx) && in_range(dy) && in_range(dz)) {
            return Err(JsError::new(
                "a chunk is 4096 bytes and each offset is -1, 0 or 1",
            ));
        }
        self.0.set_chunk([dx, dy, dz], chunk);
        Ok(())
    }

    /// [`crate::mesh::mesh_chunk`] on the middle chunk.
    pub fn mesh(&self) -> ChunkMesh {
        ChunkMesh(crate::mesh::mesh_chunk(&self.0))
    }
}

impl Default for Neighbourhood {
    fn default() -> Self {
        Self::new()
    }
}

/// The meshes of one chunk. Each getter copies the array for one draw pass: 0 opaque, 1 cutout, 2 glass, 3 water.
#[wasm_bindgen]
pub struct ChunkMesh(crate::mesh::ChunkMesh);

#[wasm_bindgen]
impl ChunkMesh {
    pub fn quads(&self, pass_index: u8) -> Result<usize, JsError> {
        Ok(self.0.pass(pass(pass_index)?).quads())
    }

    pub fn positions(&self, pass_index: u8) -> Result<Vec<f32>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).positions.clone())
    }

    pub fn normals(&self, pass_index: u8) -> Result<Vec<i8>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).normals.clone())
    }

    pub fn uvs(&self, pass_index: u8) -> Result<Vec<f32>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).uvs.clone())
    }

    pub fn tiles(&self, pass_index: u8) -> Result<Vec<u8>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).tiles.clone())
    }

    pub fn ao(&self, pass_index: u8) -> Result<Vec<u8>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).ao.clone())
    }

    pub fn indices(&self, pass_index: u8) -> Result<Vec<u32>, JsError> {
        Ok(self.0.pass(pass(pass_index)?).indices.clone())
    }
}
