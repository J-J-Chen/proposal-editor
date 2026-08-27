#!/usr/bin/env bash
# mq-land.sh — local merge queue. Serialize-merge a branch into a clean main.
#
# Usage: scripts/mq-land.sh [<branch>] [--cleanup] [--skip-check]
#   <branch>      branch to land (default: current branch of the cwd)
#   --cleanup     remove the branch's worktree and delete the branch after landing
#   --skip-check  skip the gate check (or set MQ_SKIP_CHECK=1)
#
# Guarantees: a mkdir-based lock serializes concurrent lands so main never races;
# merges are --no-ff (history preserved); a failed gate check rolls the merge back.
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
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

cd "$MAIN_ROOT"
git checkout -q main

# main must be clean
[ -z "$(git status --porcelain)" ] || { echo "main worktree is dirty — refusing (main must stay clean)" >&2; exit 1; }

# sync with origin if present
if git remote get-url origin >/dev/null 2>&1; then
  git fetch -q origin main 2>/dev/null || true
  if git show-ref -q --verify refs/remotes/origin/main; then
    git merge -q --ff-only origin/main || { echo "local main diverged from origin/main — resolve manually" >&2; exit 1; }
  fi
fi

PRE="$(git rev-parse HEAD)"

# merge (no-ff preserves branch history — the brief forbids squashing)
if ! git merge --no-ff -q -m "merge: land $BRANCH into main" "$BRANCH"; then
  git merge --abort 2>/dev/null || true
  echo "MERGE CONFLICT landing $BRANCH — merge main into your branch, resolve, retry." >&2
  echo "$(date -u +%FT%TZ) CONFLICT $BRANCH" >> "$LOG"
  exit 1
fi

# gate check (light; speed-first)
if [ "$SKIP_CHECK" != "1" ] && [ -x "$MAIN_ROOT/.mq/check.sh" ]; then
  echo "running gate check…"
  if ! "$MAIN_ROOT/.mq/check.sh"; then
    echo "gate check FAILED — rolling back merge of $BRANCH" >&2
    git reset -q --hard "$PRE"
    echo "$(date -u +%FT%TZ) CHECK-FAIL $BRANCH" >> "$LOG"
    exit 1
  fi
fi

# publish
if git remote get-url origin >/dev/null 2>&1; then git push -q origin main; fi
echo "$(date -u +%FT%TZ) LANDED $BRANCH -> $(git rev-parse --short HEAD)" >> "$LOG"
echo "✓ landed $BRANCH into main ($(git rev-parse --short HEAD))"

# optional cleanup
if [ "$CLEANUP" = 1 ]; then
  WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
    $1=="worktree"{p=$2} ($1=="branch" && $2==b){print p}')"
  if [ -n "$WT" ] && [ "$WT" != "$MAIN_ROOT" ]; then git worktree remove --force "$WT" 2>/dev/null || true; fi
  git branch -D "$BRANCH" 2>/dev/null || true
  echo "✓ cleaned up worktree + branch $BRANCH"
fi
