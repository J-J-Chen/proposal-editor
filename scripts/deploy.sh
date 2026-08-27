#!/usr/bin/env bash
# deploy.sh — deploy to Vercel under the PERSONAL account (jjchen2019), never the work account.
#
# Usage:
#   export VERCEL_TOKEN=<personal access token from vercel.com/account/tokens as jjchen2019>
#   scripts/deploy.sh            # preview deployment
#   scripts/deploy.sh prod       # production deployment
#
# We pass the token explicitly (instead of using the machine's Vercel CLI login, which is a
# non-personal work account). A personal token has no work scope, so a wrong-account
# deploy is impossible. See docs/workflow.md.
set -euo pipefail

: "${VERCEL_TOKEN:?set VERCEL_TOKEN to your personal Vercel access token (jjchen2019)}"

# Safety: allow ONLY the personal account, just in case a work token is exported.
who="$(vercel whoami --token "$VERCEL_TOKEN" 2>/dev/null | tail -1 || true)"
case "$who" in
  jjchen2019*) : ;;
  *) echo "refusing: not the personal account ($who)"; exit 1 ;;
esac
echo "deploying as: $who"

args=(deploy --yes --token "$VERCEL_TOKEN")
if [ "${1:-}" = "prod" ] || [ "${1:-}" = "production" ]; then
  args+=(--prod)
fi
exec vercel "${args[@]}"
