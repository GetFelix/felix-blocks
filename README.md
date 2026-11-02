<p align="center"><img src="docs/brand/felix-blocks-mark.png" alt="Felix Blocks" width="200"></p>

# Felix Blocks

A voxel building game for the browser, alone or with friends, whose only
backend is [Felix](https://github.com/GetFelix/felix).

Felix Blocks is a first-person world of blocks that you dig and build in. You
can play alone, open your world to friends and build together, or let people
visit without being able to change anything. There is no game server: the
browsers write the world, and Felix stores it, orders the writes and tells
everyone what changed.

> **Status:** design stage. The [style frame](prototype/style-frame.html) shows
> the look, day and night; nothing is playable yet. The project's code is
> started: the block table and the asset pipeline. The plan is in
> [docs/design.md](docs/design.md) and the work is tracked in
> [milestones](https://github.com/GetFelix/felix-blocks/milestones).

| Day | Night |
|---|---|
| ![Felix Blocks style frame, first person by day](docs/screenshots/style-frame-first-person.jpg) | ![Felix Blocks style frame, first person at night](docs/screenshots/style-frame-night.jpg) |

## Run it

There is nothing to play yet. What runs today is the asset page, which loads
every block texture and character the game uses, the way the game loads them,
the atlas page, which packs the textures into one atlas and shows each at a
distance, and the chunks page, which draws a made-up world meshed in Web Workers
while the camera walks through it.

You need Node 22, Rust 1.97 with the `wasm32-unknown-unknown` target (`rustup`
installs both from `rust-toolchain.toml`), and `wasm-bindgen-cli` 0.2.129
(`cargo install wasm-bindgen-cli --version 0.2.129`).

```bash
cd web
npm ci
npm run core    # build core/ to WebAssembly into src/core
npm run dev     # the asset page at http://localhost:5173, then /atlas.html and /chunks.html
```

The checks CI runs are `npm run format:check`, `npm run typecheck`, `npm test`
and `npm run build` in `web/`, and `cargo fmt --check`, `cargo clippy` and
`cargo test` at the root. `npm run assets -- <url>` opens a served page in
headless Chromium and fails if a texture or model does not load, and
`npm run atlas -- <url>` fails if an atlas tile shows a neighbour's colour at a
distance. `npm run chunks -- <url of chunks.html>` meshes and draws the made-up
world, and fails if the page does any of the meshing itself or if a merged quad
does not look like the separate blocks it replaces.

The [style frame](prototype/style-frame.html) is a single page: serve the
repository root with `python3 -m http.server` and open
`/prototype/style-frame.html`.

## What it shows about Felix

[felix-arena](https://github.com/GetFelix/felix-arena) uses a log as a live feed
and a replay, and [felix-metro](https://github.com/GetFelix/felix-metro) seeks
back through a long history. Felix Blocks is about keyed state that many people
change at once:

- **Concurrent edits resolve cleanly.** Two players digging in the same chunk
  at the same moment both keep their blocks. Each write is conditional on the
  version the client last saw, so the second one is refused and rebased, never
  applied over the first.
- **You see the world as soon as you join.** A retained cache watch delivers
  every edited chunk around you, then each change as it lands.
- **Storage is what was built.** Untouched terrain is generated from the seed
  and never stored, and compaction keeps the world at its current blocks no
  matter how many edits it has seen.
- **Solo and shared worlds are the same thing.** Opening your world to a friend
  is a grant, not an export.
- **Felix enforces permissions.** A visitor's browser cannot change a world,
  whatever it sends.

## What you will be able to do

- Walk around a world generated from a seed, dig blocks out and place new ones
- Play alone in a private world that is saved in Felix and opens on any device
- Open that world to friends and build together, seeing each other and each other's blocks as they land
- Dig in the same spot as someone else at the same moment without either of you losing a block
- Let people visit a world without being able to change it
- Try it offline, with no server at all

## Felix features it uses

| Need | Felix feature |
|---|---|
| The world, one value per chunk | A log-backed cache |
| Two players editing one chunk | Conditional writes (`cache_put_if` at the version read) |
| Seeing the world on join, then every change | A retained cache watch |
| Catching up after a dropped connection | Resuming a watch from an offset |
| The world stays the size of what is built | Cache compaction |
| Where everyone is | An in-memory stream |
| Who is online | A cache with a TTL |
| Builders and visitors | RBAC on the world's cache |
| Browsers | [felix-gateway](https://github.com/GetFelix/felix-gateway) |

Some of these are not yet reachable through the gateway. The biggest is
conditional writes, which multiplayer needs
([felix-gateway#31](https://github.com/GetFelix/felix-gateway/issues/31)). The
design lists the rest under "Felix gaps", and each one has an issue labelled
[`felix-gap`](https://github.com/GetFelix/felix-blocks/labels/felix-gap).

## How it works

A world is split into chunks of 16 × 16 × 16 blocks. Every client generates
the terrain from the world's seed, so a chunk nobody has touched is not stored
anywhere. A chunk somebody changed is one key in the world's Felix cache,
holding its difference from the generated terrain.

To place a block, the client writes the chunk's new value only if the chunk is
still at the version it last saw. If someone else got there first, the write
is refused, the client takes their version, puts its own change on top and
tries again. Every client watches the chunks around it, so changes show up for
everyone as they land. Player positions go on an in-memory stream ten times a
second. [docs/design.md](docs/design.md) has the details.

## Status

| Milestone | What it proves | State |
|---|---|---|
| The look, locked | It looks good, day and night, before Felix is involved | In progress: style frame, asset pipeline, atlas, chunk mesher and meshing in workers done |
| A world you can edit, solo | Your world is saved in Felix and opens anywhere | Planned |
| Multiplayer | Two players in one chunk never overwrite each other | Planned, needs conditional writes in the gateway |
| A world that lasts | Compaction keeps the world at its current blocks; rejoin picks up where you left | Planned |
| Worlds with owners | Builders and visitors, enforced by Felix | Planned |
| Region watches | Joining costs what you can see, not the whole world | Planned |
| Scale and failover | 50 players, broker restarts and failover | Planned |
| Self-hosting | Anyone can run it | Planned |

## Repository layout

| Path | What is in it |
|---|---|
| `core/` | Rust crate with the rules the browser and `blocks-tool` share. Today: the block table and the chunk mesher. Built to WebAssembly for the page |
| `web/` | The browser client: TypeScript and Three.js, built with Vite |
| `web/assets/` | The art, with `CREDITS.md` listing each pack's source and licence |
| `prototype/` | The style frame, the look the client is built to match |
| `docs/` | Design and art direction |

## Documentation

- [docs/design.md](docs/design.md): the design, data model and build order
- [docs/art.md](docs/art.md): art direction, day and night, the asset packs and the style frame
- [Felix docs](https://docs.getfelix.dev/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
