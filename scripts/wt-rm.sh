#!/usr/bin/env bash
# wt-rm.sh — remove a worktree (and optionally its branch).
# Usage: scripts/wt-rm.sh <name|path> [--delete-branch]
set -euo pipefail

TARGET="${1:?usage: wt-rm.sh <name|path> [--delete-branch]}"
DEL=0; [ "${2:-}" = "--delete-branch" ] && DEL=1

MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
cd "$MAIN_ROOT"

SLUG="$(printf '%s' "$TARGET" | tr '[:upper:] /' '[:lower:]--' | tr -cd '[:alnum:]-_')"
WT_DIR="$(dirname "$MAIN_ROOT")/$(basename "$MAIN_ROOT")-worktrees/$SLUG"
[ -d "$WT_DIR" ] || WT_DIR="$TARGET"   # allow passing a full path

git worktree remove --force "$WT_DIR"
echo "✓ removed worktree $WT_DIR"

if [ "$DEL" = 1 ]; then
  git branch -D "feat/$SLUG" 2>/dev/null || git branch -D "$SLUG" 2>/dev/null || true
  echo "✓ deleted branch"
fi
