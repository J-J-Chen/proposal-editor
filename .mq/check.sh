#!/usr/bin/env bash
# check.sh — the gate the merge queue runs before a branch lands on main.
# SPEED-FIRST: keep this fast and forgiving. No tests here by design.
# Bypass entirely with: MQ_SKIP_CHECK=1 scripts/mq-land.sh
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# No app yet → nothing to check.
[ -f package.json ] || { echo "no package.json — nothing to check"; exit 0; }

# Ensure deps exist (quiet). If this fails, block the land.
if [ ! -d node_modules ]; then
  echo "installing deps for gate check…"
  npm install --no-audit --no-fund --silent || { echo "npm install failed"; exit 1; }
fi

# Fast typecheck only (no build, no tests) to honor speed-first.
if [ -f tsconfig.json ]; then
  echo "typecheck (tsc --noEmit)…"
  npx --no-install tsc --noEmit || { echo "typecheck failed"; exit 1; }
fi

echo "gate check ok"
exit 0
