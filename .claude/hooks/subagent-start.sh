#!/usr/bin/env bash
# SubagentStart: inject the ownership and verification contract (constitution §8).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
ctx="LeClaude subagent contract (CLAUDE.md §8): work only inside your OWNED MODULES/FILES; keep the INTERFACES named in your brief stable; do not modify files you were told not to; never run git, npm install or next build; never kill processes you did not start; run the TESTS named in your brief plus npx tsc --noEmit and npx eslint on every file you changed before you report. Your final message MUST be the structured handoff: Summary; Files changed; Behavior changed; Tests/commands run; Exact results; Open risks; Assumptions; Integration notes. 'Done' without evidence is not a handoff (CLAUDE.md §2)."
jq -n --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"SubagentStart",additionalContext:$c}}'
