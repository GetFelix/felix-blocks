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

/// [`crate::key::ChunkPos::key`]. Throws for a chunk outside the world.
#[wasm_bindgen(js_name = chunkKey)]
pub fn chunk_key(cx: i32, cy: i32, cz: i32) -> Result<String, JsError> {
    crate::key::ChunkPos { cx, cy, cz }
        .key()
        .ok_or_else(|| JsError::new("the chunk is outside the world"))
}

/// [`crate::key::ChunkPos::from_key`] as `[cx, cy, cz]`, or an empty array for a key that names no chunk.
#[wasm_bindgen(js_name = parseChunkKey)]
pub fn parse_chunk_key(key: &str) -> Vec<i32> {
    crate::key::ChunkPos::from_key(key)
        .map(|p| vec![p.cx, p.cy, p.cz])
        .unwrap_or_default()
}

/// [`crate::key::region_prefix`]. Throws for a region outside the world.
#[wasm_bindgen(js_name = regionPrefix)]
pub fn region_prefix(rx: i32, rz: i32) -> Result<String, JsError> {
    crate::key::region_prefix(rx, rz).ok_or_else(|| JsError::new("the region is outside the world"))
}

fn whole_chunk(chunk: &[u8]) -> Result<(), JsError> {
    if chunk.len() == crate::chunk::CELLS {
        Ok(())
    } else {
        Err(JsError::new("a chunk is 4096 bytes"))
    }
}

/// [`crate::delta::encode`]. Throws if a chunk is not 4,096 bytes or `current` holds 255.
#[wasm_bindgen(js_name = encodeChunk)]
pub fn encode_chunk(version: u8, generated: &[u8], current: &[u8]) -> Result<Vec<u8>, JsError> {
    whole_chunk(generated)?;
    whole_chunk(current)?;
    if current.contains(&crate::chunk::UNLOADED) {
        return Err(JsError::new("255 is not a block"));
    }
    Ok(crate::delta::encode(version, generated, current))
}

/// [`crate::delta::apply`]. `version` is the generator version `generated` was made with. Throws if `generated` is
/// not 4,096 bytes, the value is malformed, or it is sparse and was written on another generator version.
#[wasm_bindgen(js_name = applyChunk)]
pub fn apply_chunk(value: &[u8], version: u8, generated: &[u8]) -> Result<Vec<u8>, JsError> {
    whole_chunk(generated)?;
    crate::delta::apply(value, version, generated).map_err(|e| JsError::new(&e.to_string()))
}

/// [`crate::delta::generator_version`]. Throws for a value that is not a chunk value.
#[wasm_bindgen(js_name = valueGeneratorVersion)]
pub fn value_generator_version(value: &[u8]) -> Result<u8, JsError> {
    crate::delta::generator_version(value).map_err(|e| JsError::new(&e.to_string()))
}

/// [`crate::info::KEY`]: the key the world info is stored under.
#[wasm_bindgen(js_name = worldInfoKey)]
pub fn world_info_key() -> String {
    crate::info::KEY.to_string()
}

/// A world's info as read from its stored value.
#[wasm_bindgen]
pub struct WorldInfo(crate::info::WorldInfo);

#[wasm_bindgen]
impl WorldInfo {
    /// [`crate::info::WorldInfo::decode`]. Throws for a value that is not world info.
    #[wasm_bindgen(js_name = decode)]
    pub fn decode(value: &[u8]) -> Result<WorldInfo, JsError> {
        crate::info::WorldInfo::decode(value)
            .map(WorldInfo)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// [`crate::info::WorldInfo::new`]: the info of a new world.
    #[wasm_bindgen(js_name = create)]
    pub fn create(seed: u32) -> WorldInfo {
        WorldInfo(crate::info::WorldInfo::new(seed))
    }

    /// The 24 bytes to store.
    pub fn encode(&self) -> Vec<u8> {
        self.0.encode().to_vec()
    }

    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> u32 {
        self.0.seed
    }

    #[wasm_bindgen(getter, js_name = generatorVersion)]
    pub fn generator_version(&self) -> u8 {
        self.0.generator_version
    }

    /// Size in chunks: x, y (up) and z.
    #[wasm_bindgen(getter)]
    pub fn size(&self) -> Vec<i32> {
        self.0.size.iter().map(|&n| i32::from(n)).collect()
    }

    /// Where players start, in blocks: x, y (up) and z.
    #[wasm_bindgen(getter)]
    pub fn spawn(&self) -> Vec<i32> {
        self.0.spawn.to_vec()
    }
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
