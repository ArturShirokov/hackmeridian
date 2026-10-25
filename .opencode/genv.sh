#!/bin/bash
# helper: genv.sh <tool-name> <json-args>
ID=$((RANDOM+3))
curl -sS -X POST https://doc2dpp.wisecraft.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$(jq -n --arg t "$1" --argjson a "$2" --argjson id "$ID" \
        '{jsonrpc:"2.0",id:$id,method:"tools/call",params:{name:$t,arguments:$a}}')" \
  | grep '^data:' | sed 's/^data: //' | jq -r '.result.content // .error // empty' 2>/dev/null
