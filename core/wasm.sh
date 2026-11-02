#!/usr/bin/env bash
# Build core/ to WebAssembly with its JavaScript bindings into $1. Needs the
# wasm32-unknown-unknown target and wasm-bindgen-cli at the version core/ pins.
set -euo pipefail
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")/.."
target="${CARGO_TARGET_DIR:-$PWD/target}"
cargo build --locked --release -p felix-blocks-core --lib --target wasm32-unknown-unknown
wasm-bindgen --target web --weak-refs --out-dir "$out" \
  "$target/wasm32-unknown-unknown/release/felix_blocks_core.wasm"
