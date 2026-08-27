# Knowledge Base — Proposal Editor

**Agents: read this index at the start of a session, then open the docs relevant to your
task before working.** This is our shared context: what we're building, why, and how.
(Auto-loaded each session via a `SessionStart` hook. `AGENTS.md`/`CLAUDE.md` hold the
hard rules; this KB holds the reasoning.)

## Map

| Doc | Read it when you need… |
|-----|------------------------|
| [product-brief.md](product-brief.md) | What Buoyant wants, the pass/fail bar, grading, submission. |
| [assignment-notion.md](assignment-notion.md) | The full Buoyant brief, verbatim (offline source of truth). |
| [goals.md](goals.md) | Goals, priorities (speed-first), success criteria, explicit non-goals. |
| [architecture.md](architecture.md) | The design + reasoning: editable-model bet, parse, block model, edit loop, eval. |
| [design-ui.md](design-ui.md) | The editor UI: the "familiar-not-clone" principle, the chosen "Assistant" direction, confirmed UX decisions, tokens. |
| [decisions.md](decisions.md) | The decision log — what we chose, why, and alternatives rejected. |
| [fixtures.md](fixtures.md) | The provided PDFs (recon facts), fixture paths, the product KB corpus. |
| [workflow.md](workflow.md) | How we work: worktrees + merge queue, env/secrets, GitHub account. |
| [../plans/00-overview.md](../plans/00-overview.md) | The master plan + per-checkpoint plans in `plans/`. |

## The 60-second version

Build + deploy a **Next.js/TS** web app: upload a proposal PDF → interact with it in the
browser → select a paragraph/section → AI edits it → review diff → apply (composes; undo).
**Bar:** `proposals/easy.pdf` works end-to-end on the *deployed* app. The core problem is
**recovering structure from a PDF**, not reproducing it.

**Priorities:** speed first; correctness/tests good-but-not-important; milestones not strict.

**The architectural bet:** don't edit the PDF — convert it once into a clean, structured,
editable **block model** and run the whole loop on that. See [architecture.md](architecture.md).

## Keep the KB alive
When you make a non-obvious design decision, **append it to [decisions.md](decisions.md)**.
When you learn something durable about the fixtures or product, update the relevant doc.
Small, specific entries beat none.
