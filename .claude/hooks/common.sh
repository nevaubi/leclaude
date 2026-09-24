#!/usr/bin/env bash
# Shared helpers for LeClaude project hooks. Sourced by every hook; never prints on its own.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/.claude/state"
mkdir -p "$STATE" 2>/dev/null || true
INPUT="$(cat 2>/dev/null || true)"
jf() { printf '%s' "$INPUT" | jq -r "$1" 2>/dev/null; }
# One key per agent transcript so a subagent's edits never gate the lead (and vice versa).
agent_key() {
  local tp; tp="$(jf '.transcript_path // empty')"
  local sid; sid="$(jf '.session_id // "nosession"')"
  local aid; aid="$(jf '.agent_id // empty')"
  printf '%s' "${sid}:${aid:-main}:${tp}" | md5sum | cut -c1-16
}
json_escape() { printf '%s' "$1" | jq -Rs . ; }
