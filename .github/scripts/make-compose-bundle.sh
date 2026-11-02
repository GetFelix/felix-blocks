#!/usr/bin/env bash
# Build the compose bundle from dev/: the same Felix stack, with its scripts at the top of the bundle. Usage:
#   make-compose-bundle.sh <tag> <dest-dir>
# The bundle unpacks to <dest-dir>/felix-blocks-compose-<tag>/. Its images (Felix, the control plane, the gateway) are
# already pinned by version in compose.yml, so nothing is built.
set -euo pipefail
tag="${1:?usage: make-compose-bundle.sh <tag> <dest-dir>}"
dest="${2:?usage: make-compose-bundle.sh <tag> <dest-dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="felix-blocks-compose-${tag}"
out="${dest}/${name}"

rm -rf "$out"
mkdir -p "$out"
for f in "$root"/dev/*; do
  [ "$(basename "$f")" = state ] || cp -a "$f" "$out/"
done

# The scripts print commands as they are run from the repository; here they sit next to each other.
for f in "$out"/*.sh "$out"/*.yml "$out"/*.mjs; do
  sed -i.bak -e 's#node dev/check-join.mjs#node check-join.mjs#g' \
    -e 's#dev/up.sh#./up.sh#g' -e 's#dev/down.sh#./down.sh#g' \
    -e 's#dev/state/#state/#g' "$f"
  rm "$f.bak"
done
chmod +x "$out"/*.sh
