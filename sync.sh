#!/usr/bin/env bash
# One-shot sync of local markdown docs onto the container's data dir.
# Usage: ./sync.sh <container-or-image> [pi-agent-data-dir]
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-pi-tools}"
DATA_DIR="${2:-/data/pi-agent}"

if docker ps --format '{{.Names}}' | grep -q "^${TARGET}\$"; then
  DEST="${TARGET}:${DATA_DIR}"
else
  echo "container '$TARGET' not running; run 'docker compose up -d' first"
  exit 1
fi

for dir in docs; do
  [ -d "$dir" ] && { echo ">> syncing ./$dir -> $DEST/$dir"; docker cp "$dir" "$DEST"; }
done
echo ">> done"
