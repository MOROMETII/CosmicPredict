#!/bin/bash
set -euo pipefail

python3 -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

REGION_PROMPT="${REGION_PROMPT:-explore RA 76.96 Dec 30.40 and report candidates}"
opencode run --agent space-region-explorer --auto "$REGION_PROMPT" >"${AGENT_LOG:-agent.log}" 2>&1 &
AGENT_PID=$!

trap 'kill "$BACKEND_PID" "$AGENT_PID" 2>/dev/null || true' EXIT

wait "$BACKEND_PID"
