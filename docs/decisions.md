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

### 2026-08-26 — Evaluation v2: two-axis, run against the shipped edit route + owner clarifications
**Decision:** Keep name/entity fidelity as the shipped eval, but sharpen it (see
[checkpoint 5](../plans/checkpoint-5-eval-readme.md)):
(1) pair fidelity with a **no-op-defeating effectiveness check** — a no-op / too-timid model
scores 100% on fidelity alone — plus a free preamble/refusal-leak regex;
(2) run it through the **real deployed CP4 edit route** with the exact request shape (docContext
included), scoring the applied text — not a reimplemented SDK prompt;
(3) **harden the extractor**: deterministic regex as ground truth for closed-class entities
(`$`, job / `MO PE No.` / MoDOT / TAP numbers, years), one *diff-aware* LLM call for open-class
proper nouns, run **cross-model** (extract on the non-editor provider), value-preservation with a
small alias + `$`-normalization table, and hand-adjudicate flags;
(4) **exclude entity-changing instructions** ("fix names") from the preservation set; report raw
k/n per instruction with the entity-bearing denominator + a leading violation list.
**Owner clarifications (from Eric, 2026-08-26):** the hidden generalization fixture is **another
MECO-style SOQ with a real text layer** (→ `easy.pdf` / KB SOQs are representative; no OCR/scanned
path); **spend is not a constraint** (→ run the full grid, use the stronger / cross-model calls
where quality benefits; the KB stretch is a **time + trust** cut, not a budget one).
**Why:** Fidelity alone is gameable by a timid model, and if run on a reimplemented prompt it
doesn't measure the shipped product — both are exactly what a founding-engineer reviewer probes.
The parse is already entity-safe by construction (CP2), so the **edit route is the only place an
entity can break**; the eval isolates it.
**Rejected:** Single-axis preservation-only (perverse optimum); two independent LLM extractions
set-diffed (stochastic false violations); the editor grading its own output (correlated blind
spots); surface-string preservation (penalizes legitimate rewordings).
