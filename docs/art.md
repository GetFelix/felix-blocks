# Art direction

Felix Blocks should look like a sunny afternoon in a world you made: bright, clean
and friendly, with enough shading that the blocks read as solid things and not
flat tiles. The reference is [prototype/style-frame.html](../prototype/style-frame.html).

| First person | Overview |
|---|---|
| ![First person](screenshots/style-frame-first-person.jpg) | ![Overview](screenshots/style-frame-overview.jpg) |

## Assets

| Pack | Used for | Notes |
|---|---|---|
| Voxel Pack | Block textures, plants | 128 px tiles, flat cartoon shading, one family |
| Blocky Characters | Other players | Rigged GLB with `idle`, `walk`, `interact-right` and more; faces +z; scaled to 1.8 blocks |

Considered and left out for now: the Block Pack (3D blocks, useful later for store
art) and the Survival Kit (held items and props). Voxel Pack tiles that are sprites
on a transparent background, such as `rock_moss`, cannot be cube faces.

## Palette

| Role | Colour | Why |
|---|---|---|
| Grass | `rgb(102, 174, 62)` | Kenney's grass is a cool mint; this is warmed toward the green in the logo |
| Leaves | `rgb(66, 146, 58)` | Darker than grass so trees separate from the ground behind them |
| Sky, zenith to horizon | `#3f93dc` to `#cfe8f6` | Clear midday; the horizon colour is also the fog colour, so the world fades into the sky instead of ending |
| Selection and accents | `hsl(192, 90%, 46%)` | Felix cyan. It is the only saturated blue-green in the scene, so the outline is always the thing you see |
| UI panels | `rgba(12, 20, 28, 0.62)` with blur | Dark glass reads on both sky and grass |
| Player colours | coral `#ff7a59`, violet `#a37cf0` | Warm and cool, both far from green and from the cyan |

Grass, leaves and plants are recoloured by brightness, the way a biome tint
works, so the tile's texture stays and only the hue changes. Stone is slightly
desaturated so it sits behind the grass. Everything else keeps Kenney's colours.

## Rules

- **Light comes from three places.** A warm sun with soft shadows, a sky/ground
  hemisphere light, and per-vertex shading baked into the mesh: ambient occlusion
  from the three neighbours of each corner, and sky light that falls down each
  column and spreads a few blocks sideways. That last one is what makes the cave
  mouth, the eaves and the inside of the house go dark without any extra lights.
- **Fog to the horizon colour.** Distance fades to the sky, so the edge of the
  loaded world never shows as an edge.
- **Textures are crisp up close.** Nearest-neighbour magnification, mipmaps for
  distance, and 16 px of padding around each tile in the atlas so mipmaps never
  bleed a neighbour in.
- **Three passes.** Opaque blocks, cut-out blocks (leaves, plants) with an alpha
  test so they cast proper shadows, and blended water and glass last. Water sits
  0.12 below the block top so shorelines read.
- **Players carry their name.** A dark pill with the player's colour, fixed in
  screen size so names stay readable at any distance.
- **UI**: Inter for words, JetBrains Mono for anything numeric (coordinates,
  chunk, latency, slot numbers), cyan for the selected slot and Felix state.
  Hotbar icons are drawn from the same restyled tiles as the world.

## Using the style frame

Serve the repository root (`python3 -m http.server`) and open
`/prototype/style-frame.html`. Drag to look around.

| Parameter | Effect |
|---|---|
| `?view=overview` | The wide shot, with orbit controls |
| `?ui=0` | Hide the overlay |

The screenshots above are the default view and `?view=overview` at 1600 × 900.
