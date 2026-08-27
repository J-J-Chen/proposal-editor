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
