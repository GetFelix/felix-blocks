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
- The block table's ids are the stored format. Add blocks at the end, never renumber or reuse an id.

## Art

- Every colour comes from the palette module.
- Assets must be CC0 or similarly free and listed with their source and licence in `web/assets/CREDITS.md`. A tile or model is only added when a block or feature uses it; tests fail on an asset nothing uses and on a pack with no credits row.
- A change to lighting, materials, textures or meshing comes with before and after screenshots of the same view and a frame time on an iGPU.

## Comments and docs

- Only comment where the code is unclear, such as a constraint the code can't show.
- Write docs in plain sentences, and update them in the same pull request as the behaviour they describe.

## Checks

[README.md](README.md#run-it-from-source) has the commands. CI runs them all, and `CI ok` is the one check main requires.

## Pull requests

- CI must pass before merge. Merges are squash only.
- No AI attribution in commits or pull request descriptions.
- List design calls under "Review notes", and Felix gaps you hit under "Felix gaps found", with the issue each one is filed as.

## Releases

A release is a `v*` tag. Before tagging, a pull request bumps the version in `core/Cargo.toml`, `tool/Cargo.toml`,
`Cargo.lock`, `web/package.json` and `web/package-lock.json`, moves the CHANGELOG entry from "Unreleased" to the new
version, and updates the version in the README's "Install a release" commands. The release workflow refuses a tag
that does not match all of them. Pushing the tag builds the files and publishes the release. A pull request that
touches the release workflow, and a manual run of it, build everything and publish nothing. CI checks the tree's versions and those commands against each other on every pull request. If the tag check fails anyway, delete the tag (`git push origin :refs/tags/vX.Y.Z`), fix main and tag again. If publishing fails part way, re-run the release job: it finishes the draft release it finds.
