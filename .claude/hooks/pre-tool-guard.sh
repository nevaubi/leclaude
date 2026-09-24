#!/usr/bin/env bash
# PreToolUse(Bash): deny destructive git, history rewrites, broad deletion, credential exposure,
# unrequested deployments, infrastructure deletion, verification bypass and data exfiltration (constitution §9, §41).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ "$(jf '.tool_name')" = "Bash" ] || exit 0
cmd="$(jf '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0
deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
c="$cmd"
# Git history and branch destruction.
echo "$c" | grep -Eq 'git +push[^|;&]*( -f| --force)' && deny "Force pushes rewrite shared history (CLAUDE.md §3). Push normally or ask the user."
echo "$c" | grep -Eq 'git +(reset +--hard|checkout +-f|checkout +-- +\.|switch +-f|clean +-[a-zA-Z]*[fdx]|branch +-D|push +[^|;&]*--delete|rebase|commit +[^|;&]*--amend|filter-branch|reflog +expire|gc +--prune)' && deny "History rewrites, forced checkouts and branch deletion are not allowed (CLAUDE.md §3). Preserve other agents' work; ask the user for anything irreversible."
echo "$c" | grep -Eq 'git +stash +(drop|clear)' && deny "Dropping stashes discards work (CLAUDE.md §3)."
# Broad deletion outside temp space.
echo "$c" | grep -Eq '(^|[;&| ])rm +(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r +-f|-f +-r)' && ! echo "$c" | grep -Eq 'rm +-[a-zA-Z ]*(/tmp/|/tmp$|\$TMPDIR|"?/tmp/)' && deny "Recursive forced deletion is limited to /tmp (CLAUDE.md §9). Delete specific files, or ask the user."
echo "$c" | grep -Eq '(^|[;&| ])rm +[^|;&]*(data/|\.git( |$|/)|node_modules( |$|/)|src( |$|/)|\.env)' && deny "Deleting data/, .git, node_modules, src or env files is destructive (CLAUDE.md §9)."
# Credential exposure into the transcript.
echo "$c" | grep -Eq '(cat|less|more|head|tail|bat|grep|strings|sed|awk)[^|;&]* \.?env(\.local|\.production|\.development)?( |$)' && deny "Printing env files exposes secrets (CLAUDE.md §41). Check presence with: test -n \"\$OPENAI_API_KEY\"."
echo "$c" | grep -Eq '(^|[;&| ])(printenv|env)( |$|\|)' && ! echo "$c" | grep -Eq 'env +[A-Z_]+=|env +-i|printenv +[A-Z_]+' && deny "Dumping the whole environment exposes secrets (CLAUDE.md §41). Query a single non-secret variable instead."
echo "$c" | grep -Eq 'echo[^|;&]*\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD)' && deny "Echoing credentials exposes secrets (CLAUDE.md §41)."
# Deployments and infrastructure deletion.
echo "$c" | grep -Eq '(^|[;&| ])(npx +)?vercel( |$)' && deny "Deployments are not run from the agent (CLAUDE.md §9); the branch deploys through the configured pipeline."
echo "$c" | grep -Eq 'aws +[a-z0-9-]+ +(delete|terminate|rm|rb|remove|purge)[a-z-]*|terraform +(destroy|apply)|cdk +(destroy|deploy)|sam +deploy|amplify +publish' && deny "Cloud deployments and infrastructure deletion require explicit user approval (CLAUDE.md §9)."
# Verification bypass and production data destruction.
echo "$c" | grep -Eq -- '--no-verify' && deny "Bypassing verification hooks is not allowed (CLAUDE.md §9)."
echo "$c" | grep -Eiq 'sqlite3[^|;&]*data/[^|;&]*(drop |delete from|vacuum)' && deny "Destructive commands against the data directory are not allowed (CLAUDE.md §9)."
# Exfiltration of confidential material.
echo "$c" | grep -Eq '(curl|wget)[^|;&]*(-T |--upload-file|--data-binary +@|-F +[^ ]*@|-d +@)[^|;&]*(data/|\.env|\.db|blobs)' && deny "Uploading matter data or env files to a remote host is not allowed (CLAUDE.md §41)."
echo "$c" | grep -Eq '(scp|rsync)[^|;&]*(data/|\.env)[^|;&]* [^ ]+:' && deny "Copying matter data or env files to a remote host is not allowed (CLAUDE.md §41)."
exit 0
