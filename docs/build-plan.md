# Build Plan — parallel tracks & contracts

Goal: close the bar (`easy.pdf` edit loop, deployed) as fast as possible with parallel
sessions. Everything hinges on the **contracts in `src/lib/types.ts` + `src/lib/contracts.ts`**
and the mock **`src/fixtures/easy.doc.json`** — build against those + mocks, integrate later.

## Phases
- **Phase 0 — Contracts (DONE):** `Doc`/`Block`/`EditOp`/`HistoryEntry` types, API request/response
  types, mock `easy.doc.json`, and stub routes (`/api/parse` returns the fixture, `/api/edit`
  echoes a visible edit). This unblocks all tracks.
- **Phase 1 — Fan out (parallel):** Tracks A/B/C/D, each against the contract + mocks.
- **Phase 2 — Integration (one session):** swap mocks for real (real parse → render; FE → real
  `/api/edit`); wire `src/app/page.tsx`. **Closes the bar on deployed `easy.pdf`.**
- **Phase 3 — Stretch (parallel):** E (eval), F (KB), G (refine).

## Tracks & file ownership (disjoint dirs → no merge conflicts)
| Track | Scope | Owns | Deps |
|---|---|---|---|
| A. Parse (BE) | easy.pdf → `Doc`, cache-by-hash | `src/parse/**`, `src/app/api/parse/route.ts` | 0 |
| B. Render+Select (FE) | `Doc` → HTML, click-select, edit affordance | `src/components/DocumentView.tsx`, `BlockView.tsx` | 0 (mock Doc) |
| C. Edit (BE) | `/api/edit`: prompt, entity guardrail, structured output | `src/ai/edit.ts`, `src/app/api/edit/route.ts` | 0 |
| D. Edit-loop (FE) | diff view, apply/reject, compose, undo/redo | `src/state/editor.ts`, `src/components/EditPanel.tsx`, `DiffView.tsx` | 0 (stub /api/edit) |
| Integration | wire real↔real; page | `src/app/page.tsx` | A,B,C,D |
| E. Eval | name/entity-fidelity harness + numbers | `src/eval/**`, `scripts/eval.ts` | C |
| F. KB | offline index + `/api/kb/search` | `src/kb/**`, `src/app/api/kb/**`, `scripts/build-kb.ts` | 0 |
| G. Refine | rubric + Refine panel (routes Accept through D's apply path) | `src/refine/**` | D |

**Critical path:** `0 → (A ∥ B ∥ C ∥ D) → Integration`. One session per track.

## Rules for parallel work
- Build against `src/lib/types.ts` / `contracts.ts` — **do not invent parallel types.**
- Stay inside your track's files (table above). `page.tsx` and `src/state/editor.ts` are the
  shared integration surfaces — coordinate before touching.
- Contracts are **frozen**; changing a shape means announcing it (it breaks other tracks).
- One worktree per task (`scripts/wt-new.sh`), land via the isolated queue. Never edit the root.

## Integration checklist (Phase 2)
1. Track A's `/api/parse` replaces the stub (real Doc, cached by hash).
2. Track C's `/api/edit` replaces the stub (real AI + guardrail).
3. FE points at the real routes; upload → parse → render → select → edit → diff → apply → undo.
4. Verify end-to-end on the **deployed** URL with `easy.pdf`. Bar closed.
