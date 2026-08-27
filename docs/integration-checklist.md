# Integration & cutover checklist (owner: integration track)

The bar closes when `easy.pdf` works end-to-end **on the deployed app**. Landing to `origin/main`
is NOT deploy — prod is deployed explicitly, on the owner's say-so.

## Status — BAR CLOSED (deployed + verified)
- ✅ **Deployed to prod + verified end-to-end:** https://proposal-editor-sandy.vercel.app.
  `node scripts/e2e-verify.mjs https://proposal-editor-sandy.vercel.app` → ALL PASS (easy.pdf
  seed-hit 76 blocks; edit changes text, preserves MECO, no preamble leak).
- ✅ **Track C** — real `/api/edit` (guardrailed, forced-tool structured output).
- ✅ **Track A** — real `/api/parse` (mupdf extract → heuristics → LLM label-by-line-ref →
  verbatim assemble; sha256 cache, committed L0 seeds: easy=76, hard=279). JSON `{hash,filename}`
  → hit or 422 `needsUpload`; multipart `file` → full parse.
  NOTE (Codex flag): the multipart path assumes Vercel's 100MB body limit (per current 2026
  docs). Pending an empirical prod check on a >4.5MB *unseen* upload (delegated to Track A);
  easy.pdf is unaffected (seed hit). If prod caps at 4.5MB → direct-to-Blob upload or document it.
- ✅ **Track B+D** — full FE loop (a0): render/select, EditPanel, review card, Keep/Discard,
  inverse-command undo/redo, protected-entity confirm.
- ✅ **Track CP5** — name/entity-fidelity eval landed + recorded vs prod (276/279 ≈ 99% raw
  route fidelity; the UI confirm catches the 3 PE-license misses before Apply).

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
