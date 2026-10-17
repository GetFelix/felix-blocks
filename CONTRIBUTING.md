# Contributing

[docs/design.md](docs/design.md) describes what is being built.

## Code

- Write the simplest thing that meets the design. Don't add abstractions a milestone doesn't need yet.
- Write the rules once. World generation, the block table, the chunk encoding, meshing and the key scheme live in `core/`. `blocks-tool` links it and the browser uses it as WebAssembly. Never copy that logic into TypeScript.
- Generation must give the same blocks in every build. Integer arithmetic only in `core/`, and a change to the generator bumps its version.
- Felix is the only backend. A feature that needs a game server or a second datastore is out of scope.
- The gateway is a relay. Anything that needs to understand a chunk belongs in `core/`.
- Plain TypeScript and Three.js in `web/`, no UI framework.
- Format with `cargo fmt` and prettier. Pin dependency versions.

## Art

- Every colour comes from the palette module.
- Assets must be CC0 or similarly free and listed with their source and licence in the credits file.
- A change to lighting, materials, textures or meshing comes with before and after screenshots of the same view and a frame time on an iGPU.

## Comments and docs

- Only comment where the code is unclear, such as a constraint the code can't show.
- Write docs in plain sentences, and update them in the same pull request as the behaviour they describe.

## Pull requests

- CI must pass before merge. Merges are squash only.
- No AI attribution in commits or pull request descriptions.
- List design calls under "Review notes", and Felix gaps you hit under "Felix gaps found", with the issue each one is filed as.
