#!/usr/bin/env bash
# PostToolUse(Bash): when a verification command succeeded, stamp it for this agent so the stop gate can pass (constitution §2, §11).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ "$(jf '.tool_name')" = "Bash" ] || exit 0
cmd="$(jf '.tool_input.command // empty')"
echo "$cmd" | grep -Eq 'tsc +--noEmit|vitest +run|npm +test|eslint |smoke\.mjs|next +build' || exit 0
key="$(agent_key)"
date +%s > "$STATE/verify-$key.stamp"
printf '%s\t%s\t%s\n' "$(date +%s)" "$key" "$(printf '%s' "$cmd" | head -c 200 | tr '\n' ' ')" >> "$STATE/verify.log" 2>/dev/null || true
exit 0
