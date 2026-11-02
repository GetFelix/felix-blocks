# Felix Blocks design

A voxel building game that runs in the browser, alone or with friends, whose
only backend is [Felix](https://github.com/GetFelix/felix). You walk around a
generated world, dig blocks out and place new ones, and everyone in the same
world sees each change as it lands. The world is stored in a Felix log-backed
cache, one key per chunk, so it survives every restart and stays the size of
what has been built, not the size of everything that ever happened.

[felix-arena](https://github.com/GetFelix/felix-arena) shows a log as the live
feed and the replay. [felix-metro](https://github.com/GetFelix/felix-metro)
shows seeking back through a long history. Felix Blocks shows the other half
of Felix: keyed state that many writers change concurrently, that clients
watch by region, and that compacts down to its current value.

**In scope**

- Worlds generated from a seed: terrain, water, caves and trees
- Digging and placing blocks from a small palette, in first person
- Single player worlds that are private, durable, and can later be opened to friends
- Multiplayer: other players drawn where they are, with names, and their edits showing up live
- Joining a world and seeing its current state at once, from any device
- Worlds with builders and visitors: who may edit and who may only look
- An offline mode with no Felix at all, for trying the game

**Out of scope**

- Survival mechanics: health, hunger, mobs, crafting recipes, inventories beyond a block palette
- Redstone or any block that runs logic
- Physics beyond walking, jumping and simple collision. Sand does not fall, water does not flow
- Infinite worlds. A world has a fixed size (see [Data model](#data-model))
- Anything that needs a second datastore or a game server. If a feature cannot be expressed in Felix caches, streams and counters reached through felix-gateway, it is out

## What it has to demonstrate

1. **Concurrent edits resolve cleanly.** Two players digging in the same chunk at the same moment both see both changes, and neither overwrites the other.
2. **Join and see the world at once.** A player joining a world gets every edited chunk around them in one round trip, and draws the first frame in under two seconds.
3. **An untouched world costs nothing.** Storage grows with the blocks people changed, not with the world's size or the number of edits.
4. **Compaction keeps the world at current state.** After a million edits to a small area, the stored world is the size of that area's current blocks.
5. **Solo and shared worlds are the same thing.** A single player world is a world with one grant holder. Opening it to a friend is a grant, with no export or copy.
6. **Permissions are enforced by Felix.** A visitor's browser cannot change a world, whatever it sends.

## Architecture

```mermaid
flowchart LR
    P1["Player browser<br/>render + edit"] --> GW["felix-gateway<br/>WebSocket to QUIC"]
    P2["Player browser"] --> GW
    V["Visitor browser<br/>read only"] --> GW
    GW -->|QUIC| BR["Felix brokers<br/>chunk cache, presence"]
    GW -->|token exchange| CP["Control plane<br/>OIDC + metadata"]
    T["blocks-tool<br/>create worlds, grants"] -->|REST| CP
```

| Component     | Language                                                   | Holds state?                           | Responsibility                                                                                                  |
| ------------- | ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Client        | TypeScript, Three.js, `core` as WebAssembly                | A view of the chunks around the player | Generate terrain, apply stored chunk edits, mesh, render, edit, presence                                        |
| Gateway       | [felix-gateway](https://github.com/GetFelix/felix-gateway) | No                                     | Browser transport, token narrowing to one world, write limits                                                   |
| Brokers       | Felix                                                      | Yes, authoritative                     | The chunk cache, the presence stream, the online list                                                           |
| Control plane | Felix                                                      | Yes, metadata                          | Token exchange, world resources, roles                                                                          |
| `blocks-tool` | Rust, `core`, control plane REST and `felix-client`        | No                                     | Create a world's caches and streams and write its info, grant builders and visitors, inspect and export a world |

There is no game server. The browsers write the world, Felix stores and
orders it, and the gateway decides which world a browser may reach.

### Shared rules in `core`

World generation from a seed, the block table, the chunk encoding, meshing and
the key scheme live in one Rust crate with no I/O. The browser loads it as
WebAssembly and `blocks-tool` links it natively, as in felix-arena and
felix-metro. Generation uses integer noise so the native and WebAssembly builds
produce the same blocks bit for bit; a stored edit only means something if
every client generates the same chunk underneath it.

## Data model

### Worlds and chunks

- A **block** is one byte, an index into the block table (air, grass, dirt, stone, sand, water, wood, leaves, planks, glass, and a few coloured blocks, up to 256).
- A **chunk** is 16 × 16 × 16 blocks, 4,096 bytes uncompressed.
- A **region** is 8 × 8 chunks across and the full world height, 128 × 128 blocks.
- A **world** is 32 × 32 regions across (4,096 × 4,096 blocks) and 16 chunks (256 blocks) tall. Its name and seed are fixed when it is created.

**Why 16³ chunks and not 32³.** A chunk is the unit of a conditional write, so
it is also the unit of contention: two players a few blocks apart should not
usually be racing for the same key. A 32³ chunk holds eight times the blocks
and is eight times as likely to collide. Size matters too: a dense 32³ chunk is
32 KiB raw, half the gateway's default 64 KiB payload limit before a header or
a second byte per block. A 16³ chunk tops out at 4 KiB. The
cost of the smaller chunk is more keys and more meshes, which greedy meshing
and a bounded view distance keep cheap.

### World generation

`core` builds the terrain of a chunk from the world's seed, a 32 bit number,
and a generator version. The same three inputs give the same 4,096 bytes in the
browser and in `blocks-tool`, because the generator uses integers only: a hash
of the seed and position feeds value noise that is blended with fixed-point
arithmetic. `cargo test` and the web tests both check a list of chunks from
seven seeds against one file of hashes, `core/testdata/worldgen.golden`, so
the native and WebAssembly builds are known to agree.

Version 1 makes:

- **Ground.** Three noises of different widths set a column's height. It is at
  least 40 and 115 is the possible maximum, but typical ground sits around 77
  and the highest in a world is near 111. Where the ground is below 70, the
  column fills with water up to and including y = 70, the water surface. Grass
  covers dry ground over three layers of dirt, with stone below. Sand lines the
  water's edge and covers the seabed, with patches of gravel.
- **Caves.** Tunnels where two independent 3D noises are both near their
  middle. They stay five blocks below the surface, except in a few zones where
  they open to it. The bottom three layers are never hollow.
- **Ore.** Single coal and iron blocks scattered through the stone. Iron
  appears only below y = 60.
- **Trees.** A tree grows on dry ground, with a trunk of four to six logs and a
  rounded crown. They are rare in open country and common in woods. A tree
  on the edge of a chunk is drawn by both chunks, so it is whole on each side.

Layer 8 and above are always air, since the highest ground plus a tree stays
under 128 blocks.

A saved world depends on the exact blocks of its generator, so a change to
what version 1 makes is not allowed. The golden file fails the tests if it
happens. A better generator is a new version, and a world keeps the version
written in its info and chunk values.

### Only edits are stored

A chunk that nobody has changed has no key. Its blocks come from the seed. A
chunk somebody has changed stores its **delta from the generated chunk**, and
a client draws it by generating the chunk and applying the delta.

The delta has two encodings and the writer picks the smaller:

| Encoding | Layout                                                                             | Size                                        |
| -------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| Sparse   | count, then `(cell index u16, block u8)` per changed cell, in ascending cell order | 3 bytes per changed cell                    |
| Dense    | the chunk's whole 4,096 blocks, run-length encoded                                 | 4,130 bytes at worst, usually a few hundred |

A stored value starts with two bytes, the format (1 sparse, 2 dense) and the
generator version the chunk was edited on, then the layout above. Integers are
little endian. A dense value is the whole chunk, so it reads the same over any
generated chunk; a sparse value lists only the cells that differ and needs the
generated chunk to be read first. The run-length coding is in groups: a control
byte under 128 is followed by that many plus one literal blocks, and a control
byte of 128 or more is followed by one block repeated that many minus 126 times
(2 to 129). The decoder refuses a value that is cut short, has bytes left over, has a
format it does not know, holds a cell out of order or outside the chunk, holds
the not-loaded byte (255), or does not make exactly 4,096 blocks. It also
refuses a sparse value read over a chunk from a different generator version,
since the changes would land on the wrong terrain. It accepts any other block
id, so a client that predates a new block still reads the chunk, and it accepts
any run-length layout that decodes, so two different byte strings can make the
same chunk: compare chunks by their blocks, not their stored bytes. The code is
`core/src/delta.rs`.

Sparse wins up to 1,375 changed cells when nothing in the chunk repeats, and
for much more when it does, which covers almost every chunk in a normal world.
A typical edited chunk (a house, a dug tunnel) changes 100 to 400 cells and
stores 300 bytes to 1.2 KiB. The generator version in the value lets a world
made by an older generator be recognised and kept on it. A chunk edited back to
exactly its generated blocks encodes as an empty sparse value (4 bytes), and the
writer may delete the key instead.

### One value per chunk, not one record per edit

Two shapes were considered:

|                         | Per-edit records                                | Whole-chunk delta (chosen)        |
| ----------------------- | ----------------------------------------------- | --------------------------------- |
| Write per placed block  | ~8 bytes                                        | the chunk's delta, ~1 KiB typical |
| Stored after compaction | every edit ever made, unless someone folds them | the current delta only            |
| Join cost               | replay the edits of every chunk in view         | one value per edited chunk        |
| Concurrent edits        | need an ordering, then a fold                   | a conditional write on the chunk  |

Per-edit records are cheaper to write, but someone has to fold them into a
current state and nothing in this design runs continuously to do it. A whole
chunk value is what the cache already compacts to, so the world stays at its
current state with no process of ours involved. The write cost is affordable:
a player who places three blocks a second and batches them every 100 ms writes
about 3 KiB/s, well inside the gateway's default 256 KiB/s per session.

### Keys

The gateway accepts keys of 1 to 64 letters, digits, `-` and `_`, and Felix's
prefix watch is a plain string prefix. The key puts the region first, in fixed
width, so one prefix covers a region and never matches a neighbour:

```
R<rx:4 hex>_<rz:4 hex>-<lx:1 hex><lz:1 hex><cy:1 hex>
R8000_8003-365        region (0, 3) written with the offset, chunk (3, 6) in it, height 5
```

Region coordinates are written plus `0x8000`, which keeps the digits fixed width and leaves room for regions below zero if a world ever grows that way. The prefix
`R8000_8003-` is exactly one region's chunks. `lx` and `lz` run from 0 to 7,
since a region is 8 x 8 chunks. Hex digits are lowercase, and a key spelled any
other way names no chunk. `core/src/key.rs` makes and reads the keys, and its
tests check all 1,048,576 chunk keys of a world against the gateway's rule.

### Felix resources per world

| Resource   | Felix kind                     | Name                      | Notes                                                                                 |
| ---------- | ------------------------------ | ------------------------- | ------------------------------------------------------------------------------------- |
| Chunks     | Log-backed cache, one shard    | `blocks.chunks.<world>`   | One key per edited chunk. No TTL. Compacts                                            |
| Presence   | In-memory stream               | `blocks.presence.<world>` | Positions, at most once, 10 per second per player                                     |
| Online     | Cache with a TTL               | `blocks.online.<world>`   | One entry per session: name, colour, skin. 30 second TTL                              |
| World info | Cache, read only to players    | `blocks.info.<world>`     | One key, `info`: seed, generator version, size, spawn point. Written by `blocks-tool` |
| Chat       | Durable stream, `stamp_sender` | `blocks.chat.<world>`     | Short messages with a verified sender                                                 |

The gateway's scope is the world name, so a session's token reaches one world
and nothing else.

### Creating a world

`blocks-tool create <world> --owner <subject> --issuer <url>` makes a world in
four steps, in this order so that nobody can join a world that has no info:

1. Create the world's caches and streams through the control plane's REST API.
2. Read the info cache. If it holds a value, keep it (and refuse a `--seed` that
   differs). If not, write a new one: the seed, the newest generator version,
   the world's size, and a spawn point on dry ground near the middle.
3. Add the policies of `role:world-<world>`, which holds what a session in the
   world needs and no more.
4. Put the owner in that role. Felix names a person by `sha256(issuer|subject)`,
   so the tool takes the sign-in provider's issuer URL as well as the subject.

Every step can be repeated: Felix answers 409 for something that exists, and the
tool takes that as done. The info value is 24 bytes, little endian: format
(1), generator version, seed (u32), size in chunks (x, y, z as u16) and spawn
point in blocks (x, y, z as i32). `core/src/info.rs` reads and writes it, so
the browser and the tool agree on it. The tool calls the control plane as the tenant's
administrator, and reaches the broker with a second token that is scoped to
cache reads and writes.

## The Felix mapping

### Editing a chunk

Each edit is a compare-and-set on the chunk's key:

1. The client holds each watched chunk's value and the version it last saw. A key's version is the log offset of the put that wrote it, and it only grows.
2. The player places a block. The client draws it at once as a pending change and adds it to the chunk's batch.
3. Every 100 ms, for each chunk with pending changes, it writes the new delta with `cache_put_if` at the version it holds (or absent, for a chunk with no key yet). If it does not hold the version, it reads the key with `cache_get` first. Today's gateway watch carries values without versions (gap 1 below), so a watch change only marks the chunk stale, and the next round reads the key with its version.
4. Applied: the answer carries the new version. The pending changes become real.
5. Refused: someone wrote the chunk first. The client reads the key with its version, replays its pending changes on top of that value, and writes again, up to five times in one round before it waits for the next. A change whose cell the other player also changed is dropped in favour of the stored one, and the player sees their block replaced. A read that returns the version the client already holds is its own write coming back and changes nothing.

A write that fails for another reason (the connection, a visitor who may not write) leaves the changes pending, and the client tries that chunk again a second later. The code is `web/src/edit-sync.ts`; `web/src/editable-world.ts` holds the blocks the player sees, and `web/src/raycast.ts` finds the block a click targets.

This gives demonstration 1: two players in one chunk never overwrite each
other, because the second write is refused and rebased instead of applied. The
cost is one retry per collision, which at 16³ chunks is rare.

Felix does not retry a conditional write after an indeterminate forward,
because a retry of a write that applied would be refused by its own version.
The client keeps the changes of a write that got no answer, reads the key
again, and treats those blocks coming back as its own write rather than
another player's. A watch change only marks the chunk stale and the client
reads the key with its version, so values are ordered by version, never by
arrival.

### Watching the world

The client watches the chunk keys around it, by region. With a prefix watch
per region, the player watches the 3 × 3 regions centred on them (384 × 384
blocks) and moves the window as they walk. Felix's retained delivery gives
every edited chunk in each region on join, then each change as it lands. An
untouched region delivers nothing and costs nothing.

A watch carries offsets, so a client that drops off resumes from the offset
after the last change it handled and gets everything it missed with no gap. If
compaction has removed that offset, Felix answers with every current value in
the watched range instead, which is what a rejoining client needs anyway. A
watch that falls behind is ended with a resume point, and the client resumes
from there, so a slow device never draws a stale world without knowing it.

Today's gateway can only watch a whole cache from the start, with no prefix
and no resume (gaps 2 to 4 below), so until region watches land a client watches the whole
world and re-downloads it on reconnect. The client hides this behind one watch
interface so region watches drop in later.

Watches read one shard, so a world's chunk cache has one shard. A world is a
few thousand edited chunks at most, about 4 MB, and one shard holds that
comfortably. Spreading a big world across shards is a question for the scale work.

### Presence

Positions go on the world's in-memory stream, 10 times a second per player
while they move and once a second while they stand still: position as three
16.16 fixed-point numbers, yaw and pitch, about 20 bytes with the header.
Twenty players moving is 200 records a second in and 4,000 a second out across
everyone, about 80 KB/s of fanout. In-memory delivery is at most once, which is
right for positions: a lost one is replaced 100 ms later. Clients interpolate
other players between records.

Who is online is the TTL cache. Each session writes its entry on joining and
every 10 seconds; an entry that stops being written expires after 30 seconds
and every watcher sees it go. A tab that closes sends the gateway's leave
beacon so it disappears at once.

### Joining a world

1. `join` the gateway with the world as the scope.
2. `cache_get` the world info: seed, size, spawn.
3. Watch the regions around the spawn point. Generate their chunks while the first values arrive.
4. Apply each stored delta, mesh, draw.
5. Write the online entry, start publishing position.

Terrain generation does not wait for Felix. A client draws the generated world
as soon as it has the seed and swaps in edited chunks as they arrive, so the
first frame is not held up by the network.

### Single player

A solo world is an ordinary world whose only grant holder is its owner. It is
stored in Felix like any other, so it survives a cleared browser and opens on
another device. Opening it to friends is granting them roles on the world's
resources with `blocks-tool`. The world itself does not move or change.

### Offline mode

The client can run with no Felix at all. It swaps the gateway client for
`felix-gateway-client/fake`, an in-memory stand-in with the same shape, and
saves chunk values to IndexedDB. Nothing else changes, which keeps the offline
path honest: it is the same code under a different transport. An offline world
can be uploaded to a Felix world later with `blocks-tool`, since it is the same
set of keys and values.

### Builders and visitors

Builders hold `cache.write` on the world's chunk cache. Visitors hold only
`cache.read`, which covers reading and watching. The broker enforces this on the
token the gateway gets for each session, so a visitor's browser cannot write a
block whatever it sends. Presence and chat are open to both.

## Rendering

- **Three.js**, plain TypeScript, no UI framework, built with Vite.
- **Greedy meshing per chunk** in `core`, run in a pool of Web Workers so meshing never blocks a frame. Faces between two solid blocks are culled; coplanar faces of the same block merge into quads. Per-vertex ambient occlusion gives the blocky look its depth.

  The mesher takes a chunk plus a one-block border of its 26 neighbours (a 16 by 16 layer from each face neighbour, a row from each edge neighbour, a single block from each corner neighbour). With that it hides faces and shades corners across a chunk edge without knowing about other chunks. A border block that is not loaded shows as "unloaded": a face looking into it is not drawn, and it does not shade. The caller fills the border with a chosen block where there is no chunk, such as past the edge of the world, or those outer walls and the world floor are never drawn.

  It returns four meshes, one per draw pass (opaque, cutout, glass, water), as flat arrays: position, normal, tile coordinates, tile and ambient occlusion per vertex. Faces merge only when the block, tile and all four corner levels match. A merged quad is longer than one tile, so the shader repeats the tile across it, as described below.

  The page asks for a chunk with `Mesher.request` (`web/src/mesher.ts`), giving the chunk and its neighbours and a priority, the squared distance from the player. Each worker loads `core` once, meshes one chunk at a time and moves the arrays back without copying them. The nearest chunk goes first, and a chunk that changes again before its job starts is meshed once. Meshing a chunk takes about a millisecond, so one worker keeps up with walking. The pool is for bursts: joining a world, or a view distance of 12 chunks, is thousands of chunks at once, which on the page would be seconds of meshing.

- **One shader patch for the atlas.** A merged quad is longer than one tile, so each vertex carries its tile and its position in tile units, which runs past 1 across the quad. The fragment shader keeps the fraction, maps it into the tile's rectangle in the atlas, and takes the mip level from the unwrapped coordinate. The wrapped one jumps back to 0 at every tile edge, which would pick the smallest mip there and draw a line. `web/src/terrain.ts` applies the patch to Three's own materials, so lighting, fog and shadows work as usual, and the shadow depth material gets it too so leaves cast their holes.
- **One texture atlas** built at load time from the block textures, with nearest-neighbour filtering and mipmaps padded so edges do not bleed.
- **Draw order**: opaque and cutout blocks (leaves) first, then glass, then water, each as its own mesh per chunk.
- **The look**: bright daylight, soft fog to the view distance, a sky gradient, and the Felix brand in the UI: cyan `hsl(192, 90%, 46%)` for the cursor outline, selection and accents, Inter for text and JetBrains Mono for coordinates and numbers.
- **Players** as blocky characters with their name above them.
- **View distance tiers**, 4 to 12 chunks, picked from the frame time. The target is 60 fps at 8 chunks on a laptop iGPU.

  `ViewDistance` (`web/src/view-distance.ts`) takes each frame's time and answers with a tier. It averages 30 frames, and no single frame counts for more than three budgets, so a hitch or a tab switch does not move the tier. A mean more than 10% over the 16.7 ms budget means the frame rate is slipping, and it steps down at once: one tier for a small overrun, or straight to the tier that should fit when the frames are far over, since the cost follows the square of the distance. After a step up it ignores frames until the new chunks have loaded, and at least 20 more; a step down only unloads, so it ignores none. It steps up one tier only when two things hold: the mean has been at budget for 5 seconds, and at least the wait (15 seconds) has passed since the last step up. Climbing the whole range, 4 to 12, therefore takes about two minutes. If a step up has to be undone within the wait, the wait doubles, up to 2 minutes, so a machine that sits on the edge settles instead of flapping; a step up that holds for the whole wait halves it again. Fog ends one chunk inside the loaded area, so the edge never shows.

### Movement and collision

The player is a box 0.6 blocks wide and 1.8 tall, with the eyes 1.62 above the feet. `web/src/player.ts` moves it with plain maths over a function that says what block is at a place, so it runs in tests without a renderer. `web/src/controls.ts` turns the keyboard and mouse into the input, and `web/src/solid.ts` says which blocks stop the box (everything but air and water, from the block table in `core`) and reads blocks out of the chunks.

A frame longer than a quarter second counts as a quarter second (the page clamps it to a tenth), so a stalled tab does not fall far in one go. The frame is cut into steps of at most 1/30 second. A step sets the horizontal speed from the keys (4.3 blocks a second, 6.2 sprinting, 0.6 of that in water), applies gravity (28 blocks a second squared, at most 50 blocks a second down), and moves one axis at a time, x then z then y, in hops of at most a quarter block. A hop that would put the box inside a block puts it flush against that block's face instead and zeroes the speed on that axis, so a wall stops one axis and lets the player slide along it, and a fast fall cannot skip over a floor. A jump leaves the ground at 8.4 blocks a second and rises a little over a block, so one block is a step the player jumps up and two are a wall. In water the player moves at 0.6 of walking speed, sinks at most 3 blocks a second, swims up at 3.5, and jumps as usual when pushing off the bed or with the head at the surface, which lets a swimmer climb onto a bank level with the water. Flying ignores gravity, moves at 10.9 blocks a second, rises on space and sinks on shift, and ends when the player lands.

A cell the player's box asks about can be in a chunk that has not arrived, and the sides and the floor of the world are not chunks at all. Both read as the "unloaded" block, which is solid, so the player waits at the edge of what is loaded and never falls through a hole in the world. Above the top of the world is air. Terrain is generated on the page before anything is fetched from Felix, so on the generated world the player never meets an unloaded chunk; the rule is there for the stored chunks that replace generated ones.

### Assets

Candidates from [Kenney](https://kenney.nl), all CC0, checked on kenney.nl:

| Pack                                                                        | What it gives               | Use                                      |
| --------------------------------------------------------------------------- | --------------------------- | ---------------------------------------- |
| [Voxel Pack](https://kenney.nl/assets/voxel-pack) (190 assets)              | Block textures and tiles    | The block atlas                          |
| [Block Pack](https://kenney.nl/assets/block-pack) (100 assets)              | 3D blocks                   | Palette previews, the logo and store art |
| [Blocky Characters](https://kenney.nl/assets/blocky-characters) (20 assets) | Low-poly characters         | Other players                            |
| [Survival Kit](https://kenney.nl/assets/survival-kit) (80 assets)           | Props: tools, tents, crates | Held items, decoration                   |

The style frame uses the Voxel Pack and Blocky Characters from
`web/assets/`, which the client loads the same way. [docs/art.md](art.md) has
the palette and the restyling. The client builds the atlas from them when it loads. The test scene `/atlas.html` shows it, and
`/chunks.html` draws meshed chunks on it.

## Build order

| Milestone                                                                                                   | Proves                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The look, locked: asset pipeline, block atlas, greedy meshing, style frame, view distance tiers             | It looks good at 60 fps before Felix is involved |
| A world you can edit, solo, through Felix: `core`, the dev stack, `blocks-tool`, chunk values, offline mode | Demonstrations 2, 3 and 5 for one player         |
| Multiplayer: conditional chunk writes, presence, the online list, chat                                      | Demonstration 1, the headline                    |
| A world that lasts: compaction proof, rejoin by offset, world export and import                             | Demonstration 4                                  |
| Worlds with owners: builders and visitors, opening a solo world to friends                                  | Demonstrations 5 and 6                           |
| Region watches: watch only the regions around the player                                                    | Join cost bounded by view, not world size        |
| Scale: 50 players in a world, bots, broker restart and failover                                             | It holds under load and loss                     |
| Self-hosting: images, compose, Helm, releases                                                               | Anyone can run it                                |

**The look comes first on purpose**, for the reason felix-arena and felix-metro give:
looking good is the requirement most likely to fail late, so the look is fixed
before anything is built inside it.

## Risks, and what this surfaces in Felix

- **Trusted builders.** There is no server to check an edit. A builder's browser can write any value into any chunk it may write. Permissions limit who can do that; a builder who writes garbage is a moderation problem, and an export lets an owner restore a world.
- **Generator changes.** A stored delta is relative to the generated chunk. Changing the generator would shift every edit, so the generator is versioned and a world keeps the version it was created with.
- **Hot chunks.** Many players building in one chunk retry often. Batching edits per 100 ms bounds the write rate; the spawn area is the likely hot spot.
- **Scope.** No feature that does not serve one of the six demonstrations or the look.

**Felix gaps this design runs into**

Checked against Felix's cache docs and felix-gateway's protocol and source.

1. **Watch changes carry no version.** The gateway has relayed `cache_put_if` since 0.8.0 (with the `cache_versions` feature), and `cache_get` answers with the entry's version. But `cache_change` and `cache_entries` carry none, so a client that watches a chunk learns its version only by reading the key again with `cache_get`. Until the watch reports versions, every refused write and every change to a chunk the player is editing costs one read ([felix-blocks#48](https://github.com/GetFelix/felix-blocks/issues/48)).
2. **The gateway's cache watch is the whole cache.** It always watches every key, so there is no key or prefix watch from a browser. Joining a world downloads every edited chunk in it. Fine for small worlds, and the reason region watches are their own milestone.
3. **The gateway's cache watch cannot resume.** `cache_change` carries no offset and `cache_watch` takes no `from_offset`, so a client that reconnects downloads the whole world again instead of what it missed.
4. **The gateway's cache watch needs a single-shard cache.** It opens a prefix watch without naming a shard, which Felix refuses on a multi-shard cache. World caches stay at one shard until it watches every shard.
5. **The gateway cannot use key-prefix grants.** Felix can grant a key or key prefix of a cache, but the gateway narrows by cache name only, and its configuration doc still says Felix cannot. A protected spawn area that only owners may edit needs this.
6. **Worlds cannot be created from a browser.** The gateway never creates resources or grants, so a new solo world needs an operator step through `blocks-tool`. A templated, self-service scope (create a world's resources and grant its creator) would remove it.
7. **Cache writes carry no sender.** The gateway stamps the sender on streams marked `stamp_sender`, not on cache writes, so the world cannot say who placed a block. An edit history would have to be a second write to a stamped stream.

**Open questions**

- [ ] Can one gateway scope give the same cache `read` and `watch` to everyone and `write` only to builders, for example as two aliases with `write` optional? If not, builders and visitors need a gateway change.
- [ ] Should a solo world be created on first play with a default seed, or always through a "new world" screen?
- [ ] How many blocks in the palette for the solo world: a small fixed set, or the whole Voxel Pack?
