# Decision Log

Append-only. Newest last. One entry per non-obvious decision: what, why, alternatives
rejected. Keep entries short. Format: `### YYYY-MM-DD — Title`.

---

### 2026-08-26 — Edit a structured block model, not the PDF
**Decision:** Parse each PDF once into an ordered list of typed blocks, render as semantic
HTML, and run the whole edit loop on that model. Drop pixel-fidelity of the original.
**Why:** Makes selection/apply/compose/undo trivial and closes the loop within the 4-hour
budget. The brief explicitly says reconstruction isn't the point.
**Rejected:** Editing the rendered PDF in place (pdf.js text layer) — high effort, sinks the
budget, and selection/apply are painful.

### 2026-08-26 — Hybrid parse (deterministic extract + LLM structuring), cached by hash
**Decision:** Extract text+layout deterministically, then use an LLM (structured output) to
segment/clean/label into blocks. Cache by file hash.
**Why:** Handles the verified messes (duplicated cover text, glued headings, multi-column) and
generalizes to the hidden fixture; caching respects the slow/metered parse.
**Rejected:** Pure heuristics (brittle on branded/multi-column layout); pure LLM-on-raw-text
(slower, pricier, loses layout cues).

### 2026-08-26 — Name/entity fidelity as the shipped evaluation
**Decision:** Measure the % of preservation-type edits that keep untouched entities (names,
orgs, project numbers, $), and report a real number.
**Why:** The brief foregrounds names; it's the highest-value silent-failure to catch, and
it's automatable within the time.
**Rejected:** Generic "edit faithfulness" (fuzzier, harder to score objectively).

### 2026-08-26 — No database by default
**Decision:** Keep the doc in client state (optional localStorage/Blob for parse cache). No DB.
**Why:** The brief says DB is optional; nothing in the core loop needs one; speed-first.
**Rejected:** Supabase/Postgres — unnecessary infra for a single-user editing session.

### 2026-08-26 — main clean; all work on worktrees via a local merge queue
**Decision:** main only advances through `scripts/mq-land.sh` (serialized, `--no-ff`, light
gate check). Feature work happens in sibling worktrees.
**Why:** Enables parallel multi-agent work without racing main; preserves commit history
(no squashing, per the brief).
**Rejected:** Direct commits to main; squash-merges.

### 2026-08-26 — Decompose context into a docs/ knowledge base + SessionStart hook
**Decision:** Split the project context out of a monolithic AGENTS.md into `docs/`, and inject
`docs/README.md` at session start so every agent loads the KB map. AGENTS.md becomes a lean
index of hard rules.
**Why:** "Not everything in one file"; ensures new sessions/agents have context automatically.
**Rejected:** One large AGENTS.md (poor separation, easy to drift, heavy to load fully).

### 2026-08-26 — Deploy to the personal Vercel account via access token (not the CLI login)
**Decision:** Deploy under **jjchen2019@gmail.com** (Vercel `jjchen2019-5995` / "John Chen's
projects") using a personal access token (`vercel deploy --token …`), and disabled the
project's `ssoProtection` so the `.vercel.app` URL is publicly reachable for grading.
**Why:** The machine's Vercel CLI is logged into the **work** account (john.chen@strala.ai,
`johnchen-6968`, default scope = Strala team) — which the owner said not to use. The personal
token has no access to the Strala scope, so it's impossible to deploy there by accident. Token
auth also leaves the Strala CLI login untouched.
**Rejected:** Deploying with the existing CLI login (wrong account); logging the CLI out of
Strala (disruptive to the owner's work).

### 2026-08-26 — Undo/redo via an inverse-command log + cursor (not a two-stack undo)
**Decision:** Promote the `{ blockId, before, after }` entry to a first-class `history:
HistoryEntry[]` log with a `cursor` (count of applied entries), held in one `useReducer`.
Undo = `cursor--` + invert the op; redo = `cursor++` + apply it — one array, no second stack.
Redo-invalidation = `history.slice(0, cursor)` on apply. The AI proposal lives in a separate
`pending` slot so Reject can't pollute history. Grafts: a structural-sharing `setText`, a
`baseCursor` stale-pending guard, and a discriminated-union `op` field + `groupId` reserved for
future structural/multi-block edits (routed via `applyOp`/`invertOp`, but **not built now**).
Closes the docs' undo-but-not-redo gap. Container is `useReducer` (zero deps, ~45-line pure,
testable reducer); lifting into Context/Zustand later is mechanical if cross-component state grows.
**Why:** Zero new deps; redo-invalidation and reject-isolation are correct *by construction*, not
by discipline; compose is automatic; the log doubles as the graded audit trail.
**Rejected:** Whole-doc snapshots (nearly tied — grafted its best parts instead of storing whole
docs + a parallel audit record); Immer patches (dep + `enablePatches()` footgun + positional
paths that fight stable ids); Zustand+zundo (two deps + silent `partialize`/equality footguns);
Yjs/CRDT (full collaboration tax with no single-user payoff); non-linear/branching undo (the real
budget-sink). Decided via a 5-design judge panel; see `docs/architecture.md` "The edit loop".

### 2026-08-26 — Extractor = mupdf (WASM), server-side Node runtime
**Decision:** Use `mupdf@1.28.0` (MuPDF compiled to WASM) as the CP2 extractor, via
`page.toStructuredText("preserve-whitespace").asJSON()`, in a `runtime="nodejs"` route.
**Why:** Same engine as the pymupdf that gave clean recon output; pure WASM, zero native deps on
Vercel. **Verified on the real fixtures:** its per-line `font.weight` reports `"bold"` for the
same-12pt-as-body headings ("OUR FIRM"/"SERVICES") — so heading detection needs no font-plumbing.
**Rejected:** `pdfjs-serverless`/`unpdf` (weight requires `commonObjs.get(fontName)` resolution,
unreliable for subset fonts like `Unnamed-T3`) — kept as the fallback only; `pdf-parse`/`pdfreader`
(no structured span data). Only genuine risk: the ~10.4MB `.wasm` tracing into the Vercel bundle →
smoke-test early, `outputFileTracingIncludes` if needed. See [checkpoint 2](../plans/checkpoint-2-pdf-parse.md).

### 2026-08-26 — Structuring: heuristics-first, LLM labels by line-reference (never re-emits text)
**Decision:** Do ~80% of structuring with deterministic TS (position-bucketed dedup, header/footer
strip, x0-column reading-order sort, line→block merge, heading = bold+ALL-CAPS+short **not size**),
then ONE cheap LLM call (`claude-sonnet-5`, effort `low`) that groups/labels/levels lines by
returning `{type, level, startLine, endLine}` — a deterministic assembler rebuilds text VERBATIM
from the referenced lines.
**Why:** Makes proper-noun/number/$ corruption **impossible by construction** (the model can't emit
text), cuts output tokens ~3–4×, and degrades to heuristics-only if the LLM/proxy fails. Corrects
the KB's earlier "bigger=heading" assumption — recon shows headings are the same 12pt as body,
distinguished by weight+caps.
**Rejected:** Pure-heuristic labeling (can't assign heading levels; misfires on infographic
stat labels like "60 EMPLOYEES"); LLM re-emitting full block text (entity-corruption risk, pricier);
"skip the LLM when heuristics look confident" (overbuilt + actively mislabels design pages).
**Watch:** structured output through the Buoyant proxy is unverified — smoke-test `messages.parse()`
before generating seeds; fall back to tool-use / JSON+zod if unsupported.

### 2026-08-26 — Parse cache: committed seed + in-proc Map + Blob-for-upload; no DB
**Decision:** Key parses by `sha256(bytes)`. Layers: **L0** committed pre-parsed JSON for the 7
provided PDFs (`src/parse-cache/{sha256}.json`, loaded at module init) → graded demo is instant,
zero-runtime-LLM; **L1** in-process Map; **Vercel Blob for the upload only** (files are 13–18MB,
over Vercel's 4.5MB body cap → hash in the browser, Blob client-upload on a miss). Durable Blob
write-back + dev-disk tiers are optional polish.
**Why:** Speed-first, no DB (per project rules), and the committed seed removes all runtime/spend/413
risk from the pass/fail path. `easy.pdf` sha256 = `03dd3ee8…c5829` (verified).
**Rejected:** On-disk `.cache/` as the prod store (Vercel fs is ephemeral/per-instance); Runtime
Cache/KV (non-durable / ≈ a DB). See [checkpoint 2](../plans/checkpoint-2-pdf-parse.md).
