#!/usr/bin/env bash
# SubagentStop: check the handoff has the required sections; warn (never loop) when it does not (constitution §8).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
msg="$(jf '.last_assistant_message // empty')"
if [ -z "$msg" ]; then
  tp="$(jf '.transcript_path // empty')"
  if [ -n "$tp" ] && [ -f "$tp" ]; then
    msg="$(grep '"type":"assistant"' "$tp" 2>/dev/null | tail -3 | jq -r '.message.content[]? | select(.type=="text") | .text' 2>/dev/null | tail -c 6000)"
  fi
fi
[ -n "$msg" ] || exit 0
missing=""
for s in "summary" "files" "test|verif|command" "risk|limitation|assumption"; do
  printf '%s' "$msg" | grep -Eiq "$s" || missing="$missing ${s%%|*}"
done
if [ -n "$missing" ]; then
  jq -n --arg m "Subagent handoff is missing sections:$missing. Treat its result as unverified until the gaps are covered (CLAUDE.md §8)." '{systemMessage:$m}'
fi
exit 0
