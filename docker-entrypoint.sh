#!/usr/bin/env bash
set -euo pipefail

# Point the pi agent at the mounted data directory when provided.
# Defaults stay inside the container at /root/.pi/agent.
: "${PI_CODING_AGENT_DIR:=/root/.pi/agent}"
: "${WORKSPACE_DIR:=/pi-workspace}"
: "${PORT:=3000}"

mkdir -p "$PI_CODING_AGENT_DIR" "$WORKSPACE_DIR"

# If any SMTP_* vars are supplied, surface them to the process. The notify
# store keeps its own copies on disk; env is just a fallback if unset there.
export PI_CODING_AGENT_DIR WORKSPACE_DIR

echo "[pi-tools] data=$PI_CODING_AGENT_DIR workspace=$WORKSPACE_DIR port=$PORT"
exec npx next start -H 0.0.0.0 -p "$PORT" "$@"
