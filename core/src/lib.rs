//! The rules the browser and `blocks-tool` share. Nothing here does I/O.
//!
//! - [`blocks`]: the block table and the texture tiles it draws from.
//! - [`chunk`]: how a chunk's cells are numbered, and a chunk with its neighbours' border cells.
//! - [`mesh`]: greedy meshing of a chunk into quads per draw pass.
//! - `wasm`: the browser's view of the crate (WebAssembly builds only).

pub mod blocks;
pub mod chunk;
pub mod mesh;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use blocks::{BLOCKS, Block, PLANT_TILES, Pass};
