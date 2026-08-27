# AGENTS.md

Operating manual for any agent (or human) working in this repo. Read this first.
`CLAUDE.md` is a symlink to this file.

---

## 1. What this is

A take-home for a **Founding Engineer** role at **Buoyant** (trybuoyant.ai), which
builds AI tooling for engineering/consulting firms that write proposals to win
civil / infrastructure contracts.

**The product to build:** a web app where a user uploads a proposal PDF, the PDF is
rendered interactively in the browser, the user selects a unit of content (a
paragraph/section) and asks AI to act on it (rewrite, tighten, fix names, change
tone, pull from a knowledge base), sees the proposed change as a diff, and applies
it. Edits compose. Undo where possible.

**The core engineering problem is recovering structure from a PDF** — PDFs expose no
paragraphs/sections/headings. That, plus a clean edit loop, is what's being graded.

## 2. Non-negotiable requirements (from the Buoyant brief)

These come from the assignment and must hold. Do not regress them.

- **The bar:** `proposals/easy.pdf` must work **end-to-end on the deployed app**:
  upload → select content → AI-proposed edit → apply. A submission that doesn't
  close this loop fails review regardless of other polish. **Scope so the loop
  closes first.**
- **Stack:** Next.js + TypeScript. Beyond that, our call.
- **Deploy:** Vercel (recommended). The graded artifact is the *deployed* app.
- **Database:** optional. Default to **none** unless a feature clearly needs it.
- **AI access:** only via the Buoyant proxy (see §6). Spend is capped — budget calls,
  cache aggressively.
- **Generalization:** graders may run a **hidden fixture** we haven't seen. Don't
  hardcode to `easy.pdf` specifics.
- **README is graded** and must contain these 7 sections (we fill them in CP5):
  1. Setup & run instructions
  2. Design decisions (PDF representation, agent design, UX) with brief justifications
  3. What I cut and why (high-signal — be specific)
  4. Failure modes I worried about (silent-failure risks; what to check before a paying customer)
  5. How I'd evaluate this — **and actually run one evaluation with real numbers**
  6. What I added beyond the brief and why
  7. What I'd build next given another 8 hours
- **Submission:** public GitHub repo (**do not squash history**), live URL, README in repo.

## 3. Priorities for this repo (owner directive)

> **Speed first.** Correctness and perfect tests are *good but not important*.
> **Milestones are not strict** — reorder/cut freely to keep momentum.

Concretely: ship the working loop over polishing internals. Prefer the smallest thing
that closes the loop. Skip tests unless a test is the fastest way to unblock yourself.
Two thoughtful features beat ten half-built ones.

## 4. Architecture (the decisions)

- **Don't edit the PDF. Convert it once into a clean, structured, editable document
  and run the whole loop on that.** PDF → an ordered list of typed **blocks**
  (heading / paragraph / list-item / …), each with a **stable id**. Render *that* as
  semantic HTML. Selection, apply, compose, and undo all become trivial DOM/state ops.
  We deliberately drop pixel-fidelity of the original — the brief explicitly blesses
  this ("the core problem is the edit loop, not PDF reconstruction").
- **Parse = hybrid, cached.** Extract text + layout hints (pdf.js / pymupdf), then use
  an LLM to segment/clean/label into blocks (handles duplicated cover text, headings
  glued to bodies, multi-column reading order). **Cache parse output by file hash** —
  parsing is slow and metered. Force JSON via structured output (no prose preamble).
- **Edit loop.** selected block + instruction → LLM returns new text → show word-level
  diff → Apply / Reject. Apply mutates the block in state and pushes `{blockId, before,
  after}` onto an undo stack. Compose falls out for free.
- **Edit guardrail:** the prompt must instruct the model to change only what's asked and
  **preserve all proper nouns, project numbers, and dollar figures** unless told
  otherwise. (This is what CP5's evaluation measures.)
- **Evaluation (CP5):** name / entity fidelity — % of preservation-type edits that keep
  every entity that should be untouched. Report a real number in the README.
- **No OCR needed for the provided fixtures** — all 7 have a real text layer. (A scanned
  hidden fixture would need OCR; note that as a known gap, don't build it.)

Fixtures live in `/Users/john/strala/workspaces/ws_8ab97d2dec3e/ExampleProposals`
(`proposals/easy.pdf`, `proposals/hard.pdf`, `kb/*.pdf`). Copy what you need in; don't
commit the large binaries unless a fixture is required at runtime.

## 5. How we work — worktrees + local merge queue

**main must always remain clean. All code work happens on a worktree, and lands via the
merge queue.** This is what lets multiple agents work in parallel without stepping on
each other. The only exception was the genesis commit that created this file.

Worktrees live as siblings: `../proposal_editor-worktrees/<slug>`.

```sh
# start a task (creates ../proposal_editor-worktrees/<slug> on branch feat/<slug>)
scripts/wt-new.sh <name>
cd ../proposal_editor-worktrees/<slug>
# ... do the work, commit normally (small commits; history is preserved) ...

# land it: serialized merge into main, light gate check, push
scripts/mq-land.sh                 # lands the current branch
scripts/mq-land.sh --cleanup       # also remove the worktree + branch after landing

# housekeeping
scripts/wt-list.sh
scripts/mq-status.sh
scripts/wt-rm.sh <name> --delete-branch
```

Rules:
- Never commit directly to `main`. Never `git push` `main` by hand — `mq-land` does it.
- The merge queue serializes with a lock, so concurrent lands are safe (FIFO by lock).
- Merges are `--no-ff` (branch history preserved — the brief forbids squashing).
- The gate check (`.mq/check.sh`) is intentionally light (typecheck only, no tests) to
  honor speed-first. Bypass with `MQ_SKIP_CHECK=1 scripts/mq-land.sh` when needed.
- If a land hits a conflict, merge/rebase `main` into your branch, resolve, retry.

## 6. Environment & secrets

**Never commit the proxy token or any secret.** Copy `.env.example` → `.env.local`
(gitignored) and fill it in. The token is sent by Buoyant separately.

The proxy is a drop-in for the official OpenAI/Anthropic SDKs — use the official SDKs,
point `baseURL` at the proxy, use the token as the API key:

```ts
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.BUOYANT_PROXY_TOKEN,
  baseURL: process.env.ANTHROPIC_BASE_URL, // https://hiring-proxy.trybuoyant.ai/anthropic
});
```

```ts
import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.BUOYANT_PROXY_TOKEN,
  baseURL: process.env.OPENAI_BASE_URL,    // https://hiring-proxy.trybuoyant.ai/openai
});
```

All AI calls run **server-side** (route handlers / server actions) so the token never
reaches the browser.

## 7. GitHub account

This repo belongs to the personal **J-J-Chen** account (John Chen,
jjchen2019@gmail.com). Pushes rely on `J-J-Chen` being the active `gh` account
(`gh auth switch --user J-J-Chen`) with `gh` configured as the git credential helper.
Repo is **public** (required by the brief).

## 8. Repo layout

```
AGENTS.md            this file (source of truth)
CLAUDE.md            -> AGENTS.md (symlink)
README.md            the graded README (filled during CP5)
.env.example         env var template (copy to .env.local)
plans/
  00-overview.md     the initial plan (architecture, priorities, cut list, eval)
  checkpoint-*.md    per-checkpoint plans (milestones, not strict)
scripts/             worktree + merge-queue tooling
.mq/
  check.sh           the gate check the merge queue runs before landing
  run/               runtime state (lock, log) — gitignored
```

## 9. Plans

`plans/00-overview.md` is the master plan. Each `plans/checkpoint-N-*.md` is a small,
self-contained milestone. They're a guide, not a contract — cut and reorder for speed.
