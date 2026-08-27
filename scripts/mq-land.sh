#!/usr/bin/env bash
# mq-land.sh — local merge queue. Serialize-merge a branch into main.
#
# Usage: scripts/mq-land.sh [<branch>] [--cleanup] [--skip-check]
#   <branch>      branch to land (default: current branch of the cwd)
#   --cleanup     remove the branch's worktree and delete the branch after landing
#   --skip-check  skip the gate check (or set MQ_SKIP_CHECK=1)
#
# THE INVARIANT is the main BRANCH: it advances only through here, --no-ff, history
# preserved (the brief forbids squashing). It does NOT require the shared repo-root
# working tree to be pristine. Every session's cwd is the shared root, so it collects
# stray edits; to keep one session's mess from blocking another's land, any stray root
# edits are AUTO-STASHED for the duration of the land and restored afterward.
#
# >>> Do your real work in a worktree (scripts/wt-new.sh). The repo root is not a
#     workspace — edits there are never landed (they're stashed aside during lands).
set -euo pipefail

BRANCH=""; CLEANUP=0; SKIP_CHECK="${MQ_SKIP_CHECK:-0}"
for a in "$@"; do
  case "$a" in
    --cleanup) CLEANUP=1 ;;
    --skip-check) SKIP_CHECK=1 ;;
    -*) echo "unknown flag: $a" >&2; exit 2 ;;
    *) BRANCH="$a" ;;
  esac
done

MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
[ -n "$MAIN_ROOT" ] || { echo "not in a git repo" >&2; exit 1; }

[ -n "$BRANCH" ] || BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] && { echo "refuse to land 'main' into itself" >&2; exit 1; }
git show-ref --verify --quiet "refs/heads/$BRANCH" || { echo "branch not found: $BRANCH" >&2; exit 1; }

RUN_DIR="$MAIN_ROOT/.mq/run"; LOCK="$RUN_DIR/lock"; LOG="$RUN_DIR/log"
mkdir -p "$RUN_DIR"

# --- acquire lock (atomic mkdir; wait up to MQ_LOCK_TIMEOUT seconds) ---
WAITED=0; TIMEOUT="${MQ_LOCK_TIMEOUT:-600}"
until mkdir "$LOCK" 2>/dev/null; do
  [ "$WAITED" -ge "$TIMEOUT" ] && { echo "timed out waiting for merge-queue lock" >&2; exit 1; }
  [ "$WAITED" = 0 ] && echo "waiting for merge-queue lock (another land in progress)…"
  sleep 2; WAITED=$((WAITED+2))
done

STASHED=0
cleanup() {
  # Restore any auto-stashed root edits, then release the lock. Runs on every exit path.
  if [ "$STASHED" = 1 ]; then
    if ! git -C "$MAIN_ROOT" stash pop >/dev/null 2>&1; then
      echo "⚠ auto-stashed root edits didn't re-apply cleanly — they are safe in the stash." >&2
      echo "  in $MAIN_ROOT: 'git stash list' then resolve with 'git stash pop'." >&2
    fi
  fi
  rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

cd "$MAIN_ROOT"
git checkout -q main 2>/dev/null || true

# Auto-stash stray root edits (tracked + untracked) instead of refusing to land.
if [ -n "$(git status --porcelain)" ]; then
  echo "root has stray edits — auto-stashing them for this land (restored after)…"
  git stash push -u -m "mq-land auto-stash before landing $BRANCH" >/dev/null 2>&1 && STASHED=1
  if [ -n "$(git status --porcelain)" ]; then
    echo "could not clean the root working tree; aborting to avoid a bad merge" >&2; exit 1
  fi
fi

# Sync local main with origin if present.
if git remote get-url origin >/dev/null 2>&1; then
  git fetch -q origin main 2>/dev/null || true
  if git show-ref -q --verify refs/remotes/origin/main; then
    git merge -q --ff-only origin/main || { echo "local main diverged from origin/main — resolve manually" >&2; exit 1; }
  fi
fi

PRE="$(git rev-parse HEAD)"

# Merge (no-ff preserves branch history).
if ! git merge --no-ff -q -m "merge: land $BRANCH into main" "$BRANCH"; then
  git merge --abort 2>/dev/null || true
  echo "MERGE CONFLICT landing $BRANCH — merge main into your branch, resolve, retry." >&2
  echo "$(date -u +%FT%TZ) CONFLICT $BRANCH" >> "$LOG"
  exit 1
fi

# Gate check (light; speed-first).
if [ "$SKIP_CHECK" != "1" ] && [ -x "$MAIN_ROOT/.mq/check.sh" ]; then
  echo "running gate check…"
  if ! "$MAIN_ROOT/.mq/check.sh"; then
    echo "gate check FAILED — rolling back merge of $BRANCH" >&2
    git reset -q --hard "$PRE"
    echo "$(date -u +%FT%TZ) CHECK-FAIL $BRANCH" >> "$LOG"
    exit 1
  fi
fi

# Publish.
if git remote get-url origin >/dev/null 2>&1; then git push -q origin main; fi
echo "$(date -u +%FT%TZ) LANDED $BRANCH -> $(git rev-parse --short HEAD)" >> "$LOG"
echo "✓ landed $BRANCH into main ($(git rev-parse --short HEAD))"

# Optional cleanup.
if [ "$CLEANUP" = 1 ]; then
  WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
    $1=="worktree"{p=$2} ($1=="branch" && $2==b){print p}')"
  if [ -n "$WT" ] && [ "$WT" != "$MAIN_ROOT" ]; then git worktree remove --force "$WT" 2>/dev/null || true; fi
  git branch -D "$BRANCH" 2>/dev/null || true
  echo "✓ cleaned up worktree + branch $BRANCH"
fi
