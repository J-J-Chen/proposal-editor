#!/usr/bin/env bash
# mq-land.sh — local merge queue. Serialize-merge a branch into main, FULLY ISOLATED.
#
# Independence (why there is no stash): the queue does its merge + gate + push in its OWN
# dedicated worktree (../<repo>-worktrees/.queue), detached — NEVER in the shared repo root.
# Every session's cwd is the shared root, so the root collects stray edits; because the queue
# never touches the root, those edits are simply irrelevant (nothing to stash, nothing to
# clobber). The single source of truth is **origin/main**; `wt-new` branches off origin/main
# and this pushes to origin/main. The root's local `main` ref is not advanced by the queue —
# treat origin/main as canonical.
#
# Usage: scripts/mq-land.sh [<branch>] [--cleanup] [--skip-check]
#   <branch>      branch to land (default: current branch of the cwd)
#   --cleanup     remove the branch's worktree and delete the branch after landing
#   --skip-check  skip the gate check (or set MQ_SKIP_CHECK=1)
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
git remote get-url origin >/dev/null 2>&1 || { echo "this queue needs an 'origin' remote (canonical main)" >&2; exit 1; }

[ -n "$BRANCH" ] || BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] && { echo "refuse to land 'main' into itself" >&2; exit 1; }
git show-ref --verify --quiet "refs/heads/$BRANCH" || { echo "branch not found: $BRANCH" >&2; exit 1; }

RUN_DIR="$MAIN_ROOT/.mq/run"; LOCK="$RUN_DIR/lock"; LOG="$RUN_DIR/log"
QUEUE_WT="$(dirname "$MAIN_ROOT")/$(basename "$MAIN_ROOT")-worktrees/.queue"
mkdir -p "$RUN_DIR"

# --- lock (serializes lands; the queue worktree is single-writer) ---
WAITED=0; TIMEOUT="${MQ_LOCK_TIMEOUT:-600}"
until mkdir "$LOCK" 2>/dev/null; do
  [ "$WAITED" -ge "$TIMEOUT" ] && { echo "timed out waiting for merge-queue lock" >&2; exit 1; }
  [ "$WAITED" = 0 ] && echo "waiting for merge-queue lock (another land in progress)…"
  sleep 2; WAITED=$((WAITED+2))
done
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

git fetch -q origin main

# Ensure the dedicated, detached queue worktree exists (never the shared root).
if ! git -C "$QUEUE_WT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git worktree add -q --detach "$QUEUE_WT" origin/main
fi

cd "$QUEUE_WT"
git reset -q --hard origin/main       # start from current canonical main
git clean -qfd -e node_modules        # drop leftovers from any prior aborted land (keep deps)

# Fast typecheck needs deps: reuse the root's node_modules (same lockfile) via symlink.
if [ ! -e node_modules ] && [ -d "$MAIN_ROOT/node_modules" ]; then
  ln -s "$MAIN_ROOT/node_modules" node_modules
fi

# Merge (no-ff; history preserved — the brief forbids squashing).
if ! git merge --no-ff -q -m "merge: land $BRANCH into main" "$BRANCH"; then
  git merge --abort 2>/dev/null || true
  echo "MERGE CONFLICT landing $BRANCH — merge origin/main into your branch, resolve, retry." >&2
  echo "$(date -u +%FT%TZ) CONFLICT $BRANCH" >> "$LOG"
  exit 1
fi

# Gate check (light; speed-first) — runs in the queue worktree, not the root.
if [ "$SKIP_CHECK" != "1" ] && [ -x "$QUEUE_WT/.mq/check.sh" ]; then
  echo "running gate check…"
  if ! "$QUEUE_WT/.mq/check.sh"; then
    echo "gate check FAILED — not landing $BRANCH" >&2
    echo "$(date -u +%FT%TZ) CHECK-FAIL $BRANCH" >> "$LOG"
    exit 1
  fi
fi

# Publish to canonical main via a PROCESS-SCOPED J-J-Chen credential — never a global
# `gh auth switch`, which races the other parallel sessions and 403s everyone (AGENTS.md rule 9).
# The credential helper runs `gh auth token --user J-J-Chen` only for this one push (touching no
# global gh state), so a plain `mq-land.sh` lands as J-J-Chen regardless of the active account.
# Falls back to a plain push if that user's token isn't available on this machine.
if gh auth token --user J-J-Chen >/dev/null 2>&1; then
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= \
    GIT_CONFIG_KEY_1='credential.https://github.com.helper' \
    GIT_CONFIG_VALUE_1='!f(){ echo username=x-access-token; echo "password=$(gh auth token --user J-J-Chen)"; };f' \
    git push -q origin HEAD:main
else
  git push -q origin HEAD:main
fi
echo "$(date -u +%FT%TZ) LANDED $BRANCH -> $(git rev-parse --short HEAD)" >> "$LOG"
echo "✓ landed $BRANCH into origin/main ($(git rev-parse --short HEAD))"

# Keep the root's local `main` in sync with canonical (best-effort, never fatal) so the
# root's `git log` never looks behind origin/main — the drift that confuses parallel sessions.
if [ -z "$(git -C "$MAIN_ROOT" status --porcelain 2>/dev/null)" ]; then
  git -C "$MAIN_ROOT" merge --ff-only origin/main >/dev/null 2>&1 || true
fi

# Optional cleanup of the FEATURE worktree + branch (never the root or queue worktree).
if [ "$CLEANUP" = 1 ]; then
  WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
    $1=="worktree"{p=$2} ($1=="branch" && $2==b){print p}')"
  if [ -n "$WT" ] && [ "$WT" != "$MAIN_ROOT" ] && [ "$WT" != "$QUEUE_WT" ]; then
    git worktree remove --force "$WT" 2>/dev/null || true
  fi
  git branch -D "$BRANCH" 2>/dev/null || true
  echo "✓ cleaned up worktree + branch $BRANCH"
fi
