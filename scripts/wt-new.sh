#!/usr/bin/env bash
# wt-new.sh — create an isolated worktree + branch off the latest main.
# Usage: scripts/wt-new.sh <name> [<base-branch>]
#   <name>  short task name; becomes branch feat/<slug> and ../<repo>-worktrees/<slug>
set -euo pipefail

NAME="${1:?usage: wt-new.sh <name> [base-branch]}"
BASE="${2:-main}"

MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
[ -n "$MAIN_ROOT" ] || { echo "not in a git repo" >&2; exit 1; }
cd "$MAIN_ROOT"

SLUG="$(printf '%s' "$NAME" | tr '[:upper:] /' '[:lower:]--' | tr -cd '[:alnum:]-_')"
[ -n "$SLUG" ] || { echo "empty name after sanitizing" >&2; exit 1; }
BRANCH="feat/$SLUG"
WT_DIR="$(dirname "$MAIN_ROOT")/$(basename "$MAIN_ROOT")-worktrees/$SLUG"

# Prefer branching off the freshest base (origin/BASE if the remote has it).
START="$BASE"
if git remote get-url origin >/dev/null 2>&1; then
  git fetch -q origin "$BASE" 2>/dev/null || true
  if git show-ref -q --verify "refs/remotes/origin/$BASE"; then START="origin/$BASE"; fi
fi

git worktree add -b "$BRANCH" "$WT_DIR" "$START"
echo "✓ worktree: $WT_DIR"
echo "✓ branch:   $BRANCH (off $START)"
echo ""
echo "  cd $WT_DIR"
