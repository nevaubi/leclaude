#!/usr/bin/env bash
# SessionStart: read-only snapshot of the repository state and the verification commands (constitution §9).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT" || exit 0
branch="$(git branch --show-current 2>/dev/null || echo unknown)"
head="$(git log -1 --format='%h %s' 2>/dev/null || echo unknown)"
dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
ahead="$(git rev-list --count @{upstream}..HEAD 2>/dev/null || echo '?')"
node_v="$(node -v 2>/dev/null || echo none)"
npm_v="$(npm -v 2>/dev/null || echo none)"
pm="npm (package-lock.json present)"; [ -f pnpm-lock.yaml ] && pm="pnpm"; [ -f yarn.lock ] && pm="yarn"
ctx="LeClaude session start. Branch: $branch. HEAD: $head. Uncommitted paths: $dirty. Commits ahead of upstream: $ahead. Node $node_v, npm $npm_v, package manager: $pm.
Constitution: CLAUDE.md (root) governs every task; Appendix A has the repository conventions; docs/architecture/ holds the design records; the active build plan lives in the session scratchpad phase3-design.md when present.
Verification commands: npx tsc --noEmit (whole repo), npx eslint <changed files>, npx vitest run <suites> (full suite: npm test), scripts/smoke.mjs against a running server, node scripts/intel-run.ts health. Never run npm install or next build while other agents work; use a mirror dev server with a private LECLAUDE_DATA_DIR for browser checks.
Rules enforced by hooks: destructive git and deploy commands are denied; edits are linted per file; a stop is blocked until code changes are verified; subagents must return the structured handoff."
jq -n --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
