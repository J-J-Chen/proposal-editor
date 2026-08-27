# AGENTS.md

Entry point for any agent (or human) working in this repo. `CLAUDE.md` symlinks to this file,
so it's auto-loaded every session. Keep this lean — the details live in `docs/`.

## Read first (the knowledge base)
Start here, then open the docs relevant to your task:
- **[docs/README.md](docs/README.md)** — KB index (also auto-injected at session start).
- [docs/product-brief.md](docs/product-brief.md) — what Buoyant wants + the pass/fail bar.
- [docs/architecture.md](docs/architecture.md) — the design and reasoning.
- [docs/decisions.md](docs/decisions.md) — decision log (append to it when you decide something).
- [docs/goals.md](docs/goals.md), [docs/fixtures.md](docs/fixtures.md), [docs/workflow.md](docs/workflow.md).
- [plans/00-overview.md](plans/00-overview.md) + `plans/checkpoint-*.md` — the plan.
- [docs/assignment-notion.md](docs/assignment-notion.md) — the full brief, verbatim.

## Hard rules (non-negotiable)
1. **The bar:** `proposals/easy.pdf` works end-to-end on the *deployed* app (upload → select →
   AI edit → apply). Scope so this closes first.
2. **Stack:** Next.js + TypeScript. Deploy on Vercel. DB optional (default none).
3. **AI only via the Buoyant proxy**, server-side. **Never commit the token/secrets** — use
   `.env.local`. Spend is capped: cache parses, keep prompts small.
4. **`origin/main` is canonical; it advances only through the merge queue** (`scripts/mq-land.sh`,
   `--no-ff`) — never commit or push main by hand. The queue is **fully isolated** (its own
   detached `.queue` worktree; never touches the shared root), so a dirty root never blocks a land.
   **Do all work in your own worktree** (`scripts/wt-new.sh`); the shared repo **root is not a
   workspace** (edits there are never landed). See [docs/workflow.md](docs/workflow.md).
5. **Don't squash history** (the brief wants to see how work evolved). Merges are `--no-ff`.
6. **Decompose sensibly** — not everything in one file — but don't over-abstract a 4-hour app.
7. **Log non-obvious decisions** in [docs/decisions.md](docs/decisions.md).
8. **Port 3111 is reserved** for the shared always-on local test server (one owner, tracking
   `origin/main`) so it's always available to test. Never run `next dev` on 3111 and never kill
   it — use another port (3112+) for your own dev server.
9. **Everything through `J-J-Chen`** — all commits/pushes use the personal `J-J-Chen` account
   (repo-local `user.email` = jjchen2019@gmail.com); **no other GitHub identity may appear
   anywhere** (attributions, docs, paths). **Never `gh auth switch` the global account** (it races
   with the other parallel sessions); `mq-land.sh` pushes via a process-scoped J-J-Chen credential
   — if a push 403s, rely on that, don't flip the global account.

## Priorities (owner directive)
**Speed first.** Correctness and perfect tests are good but not important. Milestones are not
strict. Two thoughtful features beat ten half-built ones. See [docs/goals.md](docs/goals.md).

## Commands
```sh
scripts/wt-new.sh <name>            # new worktree + branch off main
scripts/mq-land.sh [--cleanup]      # land current branch into main (serialized, no-ff, gated)
scripts/mq-status.sh                # worktrees, queue lock, recent lands
npm install && cp .env.example .env.local && npm run dev   # (after the scaffold exists)
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
