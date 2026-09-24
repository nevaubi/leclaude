#!/usr/bin/env bash
# PreCompact: persist the working state so the next context window can resume exactly (constitution §9).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT" || exit 0
ts="$(date +%Y%m%dT%H%M%S)"
sid="$(jf '.session_id // "nosession"')"
out="$STATE/precompact-${sid:0:8}-$ts.md"
{
  echo "# Pre-compaction state $ts"
  echo; echo "## Git"; git branch --show-current; git log -5 --oneline; echo; git status --short | head -60
  echo; echo "## Verification stamps"; ls -la "$STATE"/verify-*.stamp 2>/dev/null | tail -5; tail -5 "$STATE/verify.log" 2>/dev/null
  echo; echo "## Recent edits"; tail -40 "$STATE/edits.log" 2>/dev/null
  echo; echo "## Pointers"; echo "CLAUDE.md (constitution), docs/architecture/*.md, session scratchpad phase3-design.md, workflow journals under the session's subagents/workflows directory"
} > "$out" 2>/dev/null
jq -n --arg f "${out#$ROOT/}" '{systemMessage:("Pre-compaction state saved to " + $f),hookSpecificOutput:{hookEventName:"PreCompact",additionalContext:"When summarizing, preserve verbatim: the current goal, architecture decisions made this session, every changed file path, test commands and their exact results, unresolved defects, active worktrees/agents/workflows with their ids, and the exact next steps (CLAUDE.md §9 pre-compaction)."}}'
