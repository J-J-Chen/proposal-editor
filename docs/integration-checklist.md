# Integration & cutover checklist (owner: integration track)

The bar closes when `easy.pdf` works end-to-end **on the deployed app**. Landing to `origin/main`
is NOT deploy — prod is deployed explicitly, on the owner's say-so.

## Status (live)
- ✅ Contracts + mock fixture + stub routes on `origin/main`.
- ✅ **Track C** — real `/api/edit` landed (guardrailed, structured output). Verified locally:
  `node scripts/e2e-verify.mjs http://localhost:3111` → ALL PASS (parse 15 blocks; edit changes
  text, preserves MECO, no preamble leak).
- ✅ **Track A** — real `/api/parse` landed (mupdf extract → heuristics → LLM label-by-line-ref →
  verbatim assemble; sha256 cache with committed L0 seeds). Mock fixture removed. Verified locally:
  `e2e-verify` → parse 76 blocks (easy.pdf seed hit); a 12MB unseeded upload live-parses in 36s.
  The stub→real cutover is done. `/api/parse` accepts JSON `{hash,filename}` (hit or 422
  `needsUpload`) or a multipart `file` (full parse; 100MB body limit → no Blob).
- ⏳ **Track B+D** — full FE loop (a0). Builds against the real parse + real edit contracts.
- ⚠️ **Prod is still the CP1 deploy** — new routes are on main but NOT live. Closing the bar
  requires one prod deploy.

## Cutover steps (when A + B/D have landed)
1. `git fetch origin main` in the integration worktree; `git reset --hard origin/main`.
2. Real deps (Turbopack rejects a symlinked node_modules): `npm ci`. Copy `.env.local` from the
   shared root (gitignored, not in worktrees).
3. Local gate: `PORT=3111 npm run dev`, then `node scripts/e2e-verify.mjs http://localhost:3111`
   → must be ALL PASS. Then a manual pass in the browser: upload `proposals/easy.pdf` → blocks
   render → select a block → AI edit → review card → Keep → undo.
4. Confirm prod env: `vercel env ls production --token $VERCEL_TOKEN` shows `BUOYANT_PROXY_TOKEN`
   (✅ verified present, Secret, Production). Personal account only (`jjchen2019-5995`).
5. **Deploy (only when the owner says so):** `export VERCEL_TOKEN=<personal>` then
   `scripts/deploy.sh prod` (refuses the Strala account by construction).
6. Post-deploy: `node scripts/e2e-verify.mjs https://<prod-url>` → ALL PASS against the live URL.
7. Record deploy SHA + edit model + date in the README.

## Notes
- `/api/edit` returns 503 if `BUOYANT_PROXY_TOKEN` is unset — that's the "AI not configured"
  path, not a bug.
- `e2e-verify.mjs` is the shared smoke test; the CP5 eval harness extends it (full instruction
  grid + entity extractor) rather than reimplementing the request shape.
