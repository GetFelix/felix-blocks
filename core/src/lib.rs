//! The rules the browser and `blocks-tool` share. Nothing here does I/O.
//!
//! - [`blocks`]: the block table and the texture tiles it draws from.
//! - `wasm`: the browser's view of the crate (WebAssembly builds only).

pub mod blocks;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use blocks::{BLOCKS, Block, PLANT_TILES, Pass};
