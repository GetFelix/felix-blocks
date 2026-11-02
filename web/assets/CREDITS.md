# Credits

Every asset here is CC0 (public domain). No credit is required; it is given anyway. Each pack keeps its own
`License.txt`, and the build copies this folder into the site so the licences ship with the art.

| Asset                           | Files                | Source                                     | Licence                                  |
| ------------------------------- | -------------------- | ------------------------------------------ | ---------------------------------------- |
| Voxel Pack by Kenney            | `voxel-pack/tiles/`  | https://kenney.nl/assets/voxel-pack        | CC0 1.0, `voxel-pack/License.txt`        |
| Blocky Characters 2.0 by Kenney | `blocky-characters/` | https://kenney.nl/assets/blocky-characters | CC0 1.0, `blocky-characters/License.txt` |

## What is used

The tiles are the 22 from the pack's `PNG/Tiles` folder that the block table in `core/src/blocks.rs` names: the faces
of the 15 blocks, four grass tufts and a wheat crop. A test in `core` fails if a tile is shipped that no block uses,
or a block names a tile that is not here. They are unmodified; the atlas recolours some of them when it is built
(see `docs/art.md`).

The characters are `character-b` and `character-e` from `Models/GLB format`, with their textures, unmodified.

## Left out

The Block Pack and the Survival Kit from kenney.nl are also CC0 and are not imported. Nothing in the current plan
draws a 3D block or a held item. They are added here, with a row above, when a feature needs them.
