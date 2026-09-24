#!/usr/bin/env bash
# Stop: if this agent edited code after its last successful verification, block the stop once with instructions (constitution §2, §9, §11).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ "$(jf '.stop_hook_active // false')" = "true" ] && exit 0
key="$(agent_key)"
[ -f "$STATE/edits.log" ] || exit 0
last_edit="$(awk -F'\t' -v k="$key" '$2==k && $3 ~ /^(src|tests|evals|scripts)\// {t=$1} END{print t+0}' "$STATE/edits.log" 2>/dev/null)"
[ "${last_edit:-0}" -gt 0 ] || exit 0
stamp=0; [ -f "$STATE/verify-$key.stamp" ] && stamp="$(cat "$STATE/verify-$key.stamp" 2>/dev/null || echo 0)"
if [ "$stamp" -lt "$last_edit" ]; then
  files="$(awk -F'\t' -v k="$key" -v s="$stamp" '$2==k && $1>s && $3 ~ /^(src|tests|evals|scripts)\// {print $3}' "$STATE/edits.log" | sort -u | head -20 | tr '\n' ' ')"
  jq -n --arg r "Code changed after the last successful verification (files: $files). Run npx tsc --noEmit and npx eslint on those files, plus the relevant vitest suites, fix what fails, then stop (CLAUDE.md §2, §11). Unverified work is not complete." '{decision:"block",reason:$r}'
fi
exit 0
