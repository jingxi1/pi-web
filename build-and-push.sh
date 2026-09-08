#!/usr/bin/env bash
# Build the PiTools image and optionally push to a registry.
#   ./build-and-push.sh                 # build only
#   ./build-and-push.sh registry.example.com/team/pi-tools:0.8.11   # build + push
set -euo pipefail

cd "$(dirname "$0")"

PIWEB="${NEXT_PUBLIC_PIWEB_VERSION:-0.8.11}"
PITOOLS="${NEXT_PUBLIC_PI_TOOLS_VERSION:-0.8.11}"

echo ">> building pi-tools (piweb=$PIWEB, pitools=$PITOOLS)"
docker build \
  -t pi-tools:latest \
  --build-arg NEXT_PUBLIC_PIWEB_VERSION="$PIWEB" \
  --build-arg NEXT_PUBLIC_PI_TOOLS_VERSION="$PITOOLS" \
  .

if [[ $# -ge 1 ]]; then
  TARGET="$1"
  echo ">> tagging + pushing $TARGET"
  docker tag pi-tools:latest "$TARGET"
  docker push "$TARGET"
fi

echo ">> done. run: docker compose up -d"
