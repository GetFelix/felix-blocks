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
> the look, day and night. The project's code is started: the block table,
> the asset pipeline, meshing, terrain generated from a seed, the keys and
> values chunks are stored under, `blocks-tool`, which creates a world in
> Felix, walking around that terrain in first person, and digging and placing
> blocks that are saved to a Felix world. The plan is in
> [docs/design.md](docs/design.md) and the work is tracked in
> [milestones](https://github.com/GetFelix/felix-blocks/milestones).

| Day                                                                                             | Night                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Felix Blocks style frame, first person by day](docs/screenshots/style-frame-first-person.jpg) | ![Felix Blocks style frame, first person at night](docs/screenshots/style-frame-night.jpg) |

## Run it

You can walk around a generated world and change it. The play page
(`/play.html`) drops you into a world made from a seed (`?seed=7` by default) and starts you on dry ground near its middle.
Click it to look around with the mouse, walk with WASD or the arrows, jump with
space, sprint with shift, and fly with F or a double tap of space (space rises,
shift sinks, and landing ends the flight). You walk on the generated terrain,
swim in water, and cannot pass through blocks. Left click digs the block you
look at (up to 6 blocks away), right click places the block picked with 1 to 9
or the mouse wheel next to it.

By default nothing is saved. To build in a world kept in Felix, start the
[Felix stack](#the-felix-stack), make a world with `blocks-tool` (see there),
and open the page with the gateway, the world and an ID token for a player of
that world:

```bash
TOKEN=$(curl -s 'http://127.0.0.1:9400/token?sub=ana&aud=felix-blocks' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id_token')
echo "http://localhost:5173/play.html?gateway=ws://127.0.0.1:8787/ws&world=play&token=$TOKEN"
```

The page reads the world's info, which has the seed, the terrain generator and
where to start, so there is no `?seed=` for a saved world. It then takes in the
chunks players already changed before it draws the first frame, and shows
the world as they were left. A world without info (such as `demo`, which
`blocks-tool` has not touched) is refused with a message saying so.

Edits show at once and are written to the world's chunk cache every 100 ms,
one write per changed chunk. The page also watches the cache, so it shows what
other players build while you play. There is no sign-in page yet, so the token
comes from the development provider.

The rest of what runs is the asset page, which loads
every block texture and character the game uses, the way the game loads them,
the atlas page, which packs the textures into one atlas and shows each at a
distance, and the chunks page, which draws a generated world meshed in Web Workers
while the camera walks through it (add `?adapt=1` to let the frame time pick the
view distance, `?tier=8` to hold it at 8 chunks, and `?debug=1` for the panel with
the frame rate; see [docs/art.md](docs/art.md#view-distance-and-the-debug-panel)).

You need Node 22, Rust 1.97 with the `wasm32-unknown-unknown` target (`rustup`
installs both from `rust-toolchain.toml`), and `wasm-bindgen-cli` 0.2.129
(`cargo install wasm-bindgen-cli --version 0.2.129`).

```bash
cd web
npm ci
npm run core    # build core/ to WebAssembly into src/core
npm run dev     # the asset page at http://localhost:5173, then /play.html, /atlas.html and /chunks.html
```

The checks CI runs are `npm run format:check`, `npm run typecheck`, `npm test`
and `npm run build` in `web/`, `cargo fmt --check`, `cargo clippy` and
`cargo test` at the root, and the Felix stack below. `npm run assets -- <url>` opens a served page in
headless Chromium and fails if a texture or model does not load, and
`npm run atlas -- <url>` fails if an atlas tile shows a neighbour's colour at a
distance. `npm run chunks -- <url of chunks.html>` meshes and draws the generated
world, and fails if the page does any of the meshing itself, if a merged quad
does not look like the separate blocks it replaces, or if the view distance does
not step down under 40 ms frames. It does not show the controller following the
frame time in both directions; the unit tests cover that. `npm run play -- <url
of play.html>` presses the keys: the player must land, walk, fly up and come
back down. The physics itself (walls, steps, ceilings, water, chunks that have
not arrived, and a long walk over real terrain that never ends inside a block)
is in `web/src/player.test.ts`. With the Felix stack up, `npm run edits -- <url of
play.html> <world>` opens two players in two pages and checks that a placed block
is saved, that the other player sees it on joining and sees the next edit live,
and that both are there after a reload. `npm run load -- <url of play.html>
<world>` has one player edit 500 chunks and a second one join: every edit must
be there, and reading the world's info and receiving the 500 chunks, plus the
page taking them in, must fit in two seconds. It prints the time of the first
frame but does not judge it, because headless Chromium draws in software.

### The Felix stack

`dev/up.sh` starts Felix on your machine: a broker, the control plane, a
stand-in sign-in provider and [felix-gateway](https://github.com/GetFelix/felix-gateway)
0.8.0, the first gateway that relays conditional cache writes. It needs Docker
or Podman with Compose v2 (or podman-compose 1.4 or later), Node 22 for the
check, and these ports free on localhost: 5000/udp, 8080, 8443, 8787 and 9400.
It also creates one world, `demo`, that the players `ana` and `ben` may join.
The world starts empty: its info cache holds nothing until `blocks-tool` writes
it, and the play page needs the info, so build in a world made with `blocks-tool`. The stack also leaves an administrator's tokens in `dev/state/` for
`blocks-tool`.

```bash
dev/up.sh                  # start the stack and wait until the gateway serves
node dev/check-join.mjs    # sign in, join the demo world, write a chunk key conditionally
dev/down.sh                # stop it and delete its data
```

To make a world of your own, build the tool and point it at the stack. Sign in
as `ana` or `ben`, or any other name you give `--owner`; the stand-in provider
lets anyone pick one.

```bash
cargo build -p blocks-tool
export BLOCKS_ISSUER=http://127.0.0.1:9400 \
  BLOCKS_FELIX_TOKEN_FILE=dev/state/admin.token \
  BLOCKS_FELIX_DATA_TOKEN_FILE=dev/state/admin-data.token \
  BLOCKS_FELIX_CA_FILE=dev/state/broker-cert.pem
target/debug/blocks-tool create play --owner ana --seed 7
target/debug/blocks-tool create play --owner ben
BLOCKS_WORLD=play node dev/check-join.mjs   # joins as ana and ben
```

`create` registers the world's caches and streams with the control plane,
writes the world's info (its seed, generator version, size and spawn point) to
the info cache, and lets the owner in. It does these in that order, so nobody
can join a world that has no info yet. Run it again with another `--owner` to
let a second player in. Running it again for the same owner changes nothing.
Leave `--seed` out for a random one; giving a seed that differs from the
world's stored one is refused, because the seed cannot change once chunks are
stored. A name is 1 to 32 lowercase letters, digits and hyphens. `blocks-tool
create --help` lists the other options, and each also reads an environment
variable (`BLOCKS_FELIX_CONTROL_PLANE`, `BLOCKS_FELIX_BROKER`,
`BLOCKS_FELIX_SERVER_NAME`, `BLOCKS_TENANT`, `BLOCKS_NAMESPACE`). The tokens
are for the tenant's administrator; the data token is the one the broker
checks for cache reads and writes, so the administrator needs `cache.read` and
`cache.write` on the world's caches (`dev/seed.mjs` grants them for the dev
stack, where the tokens last 24 hours).

The browser connects to `ws://127.0.0.1:8787/ws`, and signs in at
`http://127.0.0.1:9400`, which lets anyone pick a name. The stand-in provider
is for development only. The control plane keeps its state in memory, so
`dev/up.sh` always starts from nothing. `dev/scope.toml` is the list of
resources a session in a world can reach, and `dev/seed.mjs` creates them; real
worlds are made with `blocks-tool`.

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

| Need                                        | Felix feature                                              |
| ------------------------------------------- | ---------------------------------------------------------- |
| The world, one value per chunk              | A log-backed cache                                         |
| Two players editing one chunk               | Conditional writes (`cache_put_if` at the version read)    |
| Seeing the world on join, then every change | A retained cache watch                                     |
| Catching up after a dropped connection      | Resuming a watch from an offset                            |
| The world stays the size of what is built   | Cache compaction                                           |
| Where everyone is                           | An in-memory stream                                        |
| Who is online                               | A cache with a TTL                                         |
| Builders and visitors                       | RBAC on the world's cache                                  |
| Browsers                                    | [felix-gateway](https://github.com/GetFelix/felix-gateway) |

Some of these are not yet reachable through the gateway, such as watching one
region of a cache and resuming a watch. Conditional writes are, since
felix-gateway 0.8.0. The design lists the gaps under "Felix gaps", and each one
has an issue labelled
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

| Milestone                  | What it proves                                                                   | State                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The look, locked           | It looks good, day and night, before Felix is involved                           | In progress: style frame, asset pipeline, atlas, chunk mesher, meshing in workers done; view distance tiers built, still to be timed on a laptop GPU |
| A world you can edit, solo | Your world is saved in Felix and opens anywhere                                  | In progress: digging and placing saved to a world through the gateway, a world loaded from its info on join; offline mode to do                      |
| Multiplayer                | Two players in one chunk never overwrite each other                              | Planned. The gateway relays conditional writes since 0.8.0                                                                                           |
| A world that lasts         | Compaction keeps the world at its current blocks; rejoin picks up where you left | Planned                                                                                                                                              |
| Worlds with owners         | Builders and visitors, enforced by Felix                                         | Planned                                                                                                                                              |
| Region watches             | Joining costs what you can see, not the whole world                              | Planned                                                                                                                                              |
| Scale and failover         | 50 players, broker restarts and failover                                         | Planned                                                                                                                                              |
| Self-hosting               | Anyone can run it                                                                | Planned                                                                                                                                              |

## Repository layout

| Path          | What is in it                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`       | Rust crate with the rules the browser and `blocks-tool` share. Today: the block table, the chunk mesher, world generation, the chunk encoding and keys, and the world info. Built to WebAssembly for the page |
| `tool/`       | `blocks-tool`, the command line that creates a world in Felix                                                                                                                                                 |
| `dev/`        | The Felix stack for development: compose file, sign-in stand-in, seed, and the check that joins through the gateway                                                                                           |
| `web/`        | The browser client: TypeScript and Three.js, built with Vite                                                                                                                                                  |
| `web/assets/` | The art, with `CREDITS.md` listing each pack's source and licence                                                                                                                                             |
| `prototype/`  | The style frame, the look the client is built to match                                                                                                                                                        |
| `docs/`       | Design and art direction                                                                                                                                                                                      |

## Documentation

- [docs/design.md](docs/design.md): the design, data model and build order
- [docs/art.md](docs/art.md): art direction, day and night, the asset packs and the style frame
- [Felix docs](https://docs.getfelix.dev/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
