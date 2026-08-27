#!/usr/bin/env bash
# mq-status.sh — show worktrees, merge-queue lock state, and recent lands.
set -euo pipefail
MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
LOG="$MAIN_ROOT/.mq/run/log"; LOCK="$MAIN_ROOT/.mq/run/lock"

echo "== worktrees =="
git worktree list
echo ""
echo "== merge-queue lock =="
[ -d "$LOCK" ] && echo "HELD (a land is in progress)" || echo "free"
echo ""
echo "== recent lands =="
[ -f "$LOG" ] && tail -n 15 "$LOG" || echo "(none yet)"
