//! The rules the browser and `blocks-tool` share. Nothing here does I/O.
//!
//! - [`blocks`]: the block table and the texture tiles it draws from.
//! - [`chunk`]: how a chunk's cells are numbered, and a chunk with its neighbours' border cells.
//! - [`delta`]: the value stored for an edited chunk, as a difference from the generated one.
//! - [`key`]: the cache key of a chunk, region first.
//! - [`mesh`]: greedy meshing of a chunk into quads per draw pass.
//! - [`worldgen`]: terrain from a seed, the same in every build.
//! - `wasm`: the browser's view of the crate (WebAssembly builds only).

pub mod blocks;
pub mod chunk;
pub mod delta;
pub mod key;
pub mod mesh;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
pub mod worldgen;

pub use blocks::{BLOCKS, Block, PLANT_TILES, Pass};
