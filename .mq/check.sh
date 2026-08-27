#!/usr/bin/env bash
# check.sh — the gate the merge queue runs before a branch lands on main.
# SPEED-FIRST: keep this fast and forgiving. No tests here by design.
# MUST NOT mutate tracked files (it runs in the main worktree): use `npm ci`, never
# `npm install`, so package-lock.json is never rewritten and main stays clean.
# Bypass entirely with: MQ_SKIP_CHECK=1 scripts/mq-land.sh
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# No app yet → nothing to check.
[ -f package.json ] || { echo "no package.json — nothing to check"; exit 0; }

# Install deps only when missing (keeps most lands fast). `npm ci` installs strictly from
# the lockfile and never modifies it; plain `npm install` can rewrite the lock (which would
# dirty main), so we only fall back to it when there is no lockfile yet.
if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    echo "npm ci…"
    npm ci --no-audit --no-fund --silent || { echo "npm ci failed"; exit 1; }
  else
    echo "npm install…"
    npm install --no-audit --no-fund --silent || { echo "npm install failed"; exit 1; }
  fi
fi

# Fast typecheck only (no build, no tests) to honor speed-first.
if [ -f tsconfig.json ]; then
  echo "typecheck (tsc --noEmit)…"
  npx --no-install tsc --noEmit || { echo "typecheck failed"; exit 1; }
fi

echo "gate check ok"
exit 0
