#!/usr/bin/env bash
# PostToolUse(Edit|Write|NotebookEdit): targeted fast checks on the edited file and an edit log for the stop gate (constitution §9, §11).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
f="$(jf '.tool_response.filePath // .tool_input.file_path // .tool_input.notebook_path // empty')"
[ -n "$f" ] || exit 0
case "$f" in /*) ;; *) f="$ROOT/$f";; esac
rel="${f#$ROOT/}"
key="$(agent_key)"
printf '%s\t%s\t%s\n' "$(date +%s)" "$key" "$rel" >> "$STATE/edits.log" 2>/dev/null || true
[ -f "$f" ] || exit 0
cd "$ROOT" || exit 0
out=""; status=0
case "$f" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    case "$rel" in src/*|tests/*|evals/*|scripts/*)
      out="$(timeout 75 npx eslint --cache --cache-location "$STATE/eslintcache" --no-warn-ignored "$f" 2>&1)"; status=$?;;
    esac;;
  *.json) out="$(jq -e . "$f" 2>&1 >/dev/null)"; status=$?;;
  *.sh) out="$(bash -n "$f" 2>&1)"; status=$?;;
esac
if [ "$status" -ne 0 ] && [ -n "$out" ]; then
  msg="Check on $rel failed (exit $status). Fix before moving on:
$(printf '%s' "$out" | head -40)"
  jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
fi
exit 0
