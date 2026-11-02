#!/usr/bin/env bash
# Start the development stack from scratch and wait until the gateway serves. The control plane keeps its state in
# memory, so the broker's log is reset with it: a log that outlived its control plane would no longer match it.
set -euo pipefail
cd "$(dirname "$0")"
source ./compose.sh

"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
rm -rf state
mkdir -p state
if ! "${compose[@]}" up --detach; then
  "${compose[@]}" logs >&2
  exit 1
fi

for _ in $(seq 1 90); do
  # The broker refuses cache watches and writes until the control plane has granted it a lease on its shards.
  if [[ -f state/seeded && -f state/finalized ]] \
    && curl -fsS http://127.0.0.1:8080/ready >/dev/null 2>&1 \
    && metrics="$(curl -fsS http://127.0.0.1:8080/metrics 2>/dev/null)" \
    && grep -Eq '^felix_broker_lease_held(\{[^}]*\})? 1$' <<<"$metrics" \
    && curl -fsS http://127.0.0.1:8787/oidc >/dev/null 2>&1; then
    echo "Felix is up, with the world demo open to ana and ben."
    echo "  gateway:   ws://127.0.0.1:8787/ws, sign-in at http://127.0.0.1:9400"
    echo "  check:     node dev/check-join.mjs"
    echo "  logs:      ${compose[*]} logs -f"
    echo "  stop:      dev/down.sh"
    exit 0
  fi
  sleep 2
done

echo "the stack did not come up" >&2
"${compose[@]}" ps --all >&2
"${compose[@]}" logs >&2
exit 1
