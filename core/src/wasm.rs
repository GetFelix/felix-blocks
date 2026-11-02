//! The browser's view of the crate.

use wasm_bindgen::prelude::*;

/// [`crate::blocks::table_json`]: the block table and the tiles it needs.
#[wasm_bindgen(js_name = blockTable)]
pub fn block_table() -> String {
    crate::blocks::table_json()
}
