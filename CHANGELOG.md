# Changelog

## [Unreleased]

## [0.1.0] - 2026-11-02

The first release. You can walk around a generated voxel world in the browser, dig and place blocks, and keep the
world either in a Felix world or in your own browser. Seeing other players in the world is not in this release.

### The look

- A style frame (`prototype/style-frame.html`) and the art direction in `docs/art.md`, by day and by night.
- An asset pipeline: the block table, the textures and the characters, each loaded the way the game loads them, with
  the licence of every pack in `web/assets/CREDITS.md`.
- A texture atlas with padded mipmaps, so a block seen from far away never shows its neighbour's colour.
- A chunk mesher that merges faces into larger quads, written in Rust and run in the browser as WebAssembly. Meshing
  happens in a pool of Web Workers, and a shader repeats a texture across a merged quad without seams.
- A view distance that follows the frame time, with a debug panel (`?debug=1`). It has not been timed on a laptop
  GPU yet.

### A world you can edit

- World generation from a `u32` seed, the same in the browser and in `blocks-tool`. Untouched terrain is generated
  and never stored.
- The storage format: one Felix cache key per chunk that was changed, holding its difference from the generated
  terrain, and a small info value (seed, generator version, size, spawn point) per world.
- `blocks-tool create`, which registers a world's caches and streams in Felix, writes its info and lets its owner in.
- A first-person player: walking, sprinting, jumping, swimming, flying, and collision with the terrain.
- Digging and placing blocks. Edits show at once and are written to the world's chunk cache every 100 ms, one
  conditional write per changed chunk, through felix-gateway 0.8.0. A write that is refused is rebased onto the
  newer chunk and tried again.
- Joining loads the world from its info and takes in every changed chunk before the first frame.
- Offline worlds (`play.html?offline=NAME`): the world is kept in the browser's IndexedDB and needs no Felix, no
  network and no server beyond whatever serves the page.
- A development stack (`dev/up.sh`): Felix 0.6.2, its control plane, a stand-in sign-in provider and the gateway.

### Not yet

- No sign-in page: a player's token goes in the URL of the play page.
- Players do not see each other: no positions on screen, no names, no chat. Two players can open one world and each
  sees the other's blocks as they are placed, but the world needs `blocks-tool create` run once per player.
- A world is read whole on join; watching only the chunks near you comes later.

### Release files

- `felix-blocks-web-v0.1.0.tar.gz`: the built web client, for any static file server.
- `blocks-tool-v0.1.0-linux-x86_64.tar.gz` and `blocks-tool-v0.1.0-macos-arm64.tar.gz`.
- `felix-blocks-compose-v0.1.0.tar.gz`: the Felix development stack, pinned to Felix 0.6.2 and felix-gateway 0.8.0.
