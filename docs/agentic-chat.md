# Agentic chat — the always-available multi-block assistant (backend)

The next feature after the single-block edit loop: an **always-open chat** (works with nothing
selected) where the user can make sweeping requests — "make the whole proposal more concise",
"make the tone more confident", "fix any passive voice" — and get a **batch of proposed per-block
edits** to review. This doc is the backend design + the FE integration contract.

Owner split: **backend** (`/api/chat` + `src/lib/agent`) is built here. The **FE** (chat pane,
batch review, grouped undo) is a0's (`src/state/editor.ts`, the components). 58 coordinates.

## The one hard promise: propose, never apply

The agent **never mutates the document.** It returns a conversational reply plus a list of
`proposedEdits`. The FE renders each one (reusing `DiffView`) and the user Keeps/Discards — all,
or per-block — and a Kept batch applies as **one grouped, undo-able transaction** (a0 owns that in
the reducer). Nothing reaches the document without a human Keep.

## The loop (and where each safety rule lives)

```
POST /api/chat  →  runAgent()
  1. PLAN   src/lib/agent/plan.ts     one model call, forced tool `submit_plan`.
            Sees a COMPACT doc map (blockId + type + ~180-char preview), never full text.
            Returns { reply, summary?, edits: [{blockId, instruction}] }.
            → OVER-EDIT GUARD: names only the minimal, relevant blocks; a question → 0 edits.
  2. EDIT   src/lib/edit.ts runEdit()  the EXACT same guarded editor as /api/edit, per block:
            entity-preserving system prompt + forced-tool structured output. Reused, not re-implemented.
            Runs with a small concurrency cap (4); capped at MAX_EDIT_BLOCKS (16) blocks/turn.
  3. GATE   src/lib/agent/entity-gate.ts  deterministic, no model: every protected entity present
            in `before` must appear verbatim in `after`. A drop → one bounded repair retry
            (re-edit forbidding the change); anything still dropped ships as a `warnings[]` flag.
            No-op edits (instruction didn't apply) are dropped so the review stays clean.
```

Why plan/edit are split: it makes the over-edit guard real (the editor can only ever touch blocks
the planner named) and it keeps spend bounded (previews to plan; one block at a time to edit).

## Contract — `POST /api/chat`

Types live in **`src/lib/agent/contract.ts`** (not the frozen `src/lib/contracts.ts`, so this can
evolve during integration). The FE imports from there; a typed browser helper is
`src/lib/agent/client.ts` → `requestChat()` (mirrors `requestEdit`).

```ts
ChatRequest {
  message: string
  history?: { role: 'user'|'assistant'; content: string }[]   // multi-turn
  blocks: Block[]                    // the live, fully-applied doc model (no DB — FE sends it)
  selection?: string | null          // optional selected blockId, biases scope
  docContext?: { firm?: string }     // passthrough to the guardrail for voice
}

ChatResponse {
  reply: string                      // always present (even for a question with no edits)
  summary?: string                   // one line for the batch-review header
  proposedEdits: ProposedEdit[]      // empty for a question. NEVER applied server-side.
}

ProposedEdit {
  blockId: string
  before: string
  after: string
  instruction: string                // the per-block instruction the planner assigned
  changeSummary?: string             // what changed; never treated as a grounded "why"
  rationale?: string                 // legacy saved-response compatibility only
  protectedKept: string[]            // entities preserved verbatim → "Kept exactly as written"
  warnings?: string[]                // entities changed DESPITE the guardrail — flag loudly before Keep
}
```

Status codes match `/api/edit`: `503` not configured, `400` bad request (`message` + `blocks[]`
required), `502` proxy/model failure.

### FE mapping (for a0)

Each `ProposedEdit` maps straight onto a `Pending` for `DiffView`:
`{ blockId, before, after, instruction, changeSummary, protectedKept, baseCursor }`. The batch shares
one `baseCursor`. Suggested reducer additions (a0's call): a `pendingBatch: Pending[]` (or a
`groupId` on `HistoryEntry`) so N Kept edits apply/undo as one transaction. An edit with a
non-empty `warnings` should get the same loud treatment as the single-block confirm modal.

## Bounds & spend (public, unauthenticated endpoint — hardened)

All caps live in `src/lib/agent/limits.ts` (one source of truth for route + agent).

- **Hard ceiling on total model calls per request: `maxModelCalls` = 12** (was ~33 worst-case:
  1 planner + 16 edits + 16 repairs). Planner, every block edit, and every repair draw from ONE
  budget; edits are spent before repairs (coverage beats polish — a still-dropped entity ships
  flagged either way); when the budget is gone we stop calling and say so in the reply.
- **Input bounds (route → 400):** `message` ≤ `maxMessageChars` (4000); `blocks[]` ≤ `maxBlocks`
  (300). History is trimmed to the newest `maxHistoryTurns` (20) / `maxHistoryChars` (8000).
- **Per-block input cap:** a block over `maxBlockChars` (8000) is SKIPPED from editing before any
  model call (not truncated — that would drop its tail from the rewrite) and surfaced in the reply.
- ≤ `maxEditBlocks` (8) edits proposed/turn (also caps human review load); concurrency 4; one
  repair retry only on an entity drop.
- Planner sees previews only; editor sees one block at a time → prompt size stays small.
- All calls go through the Buoyant proxy server-side (`getAnthropic`), model `anthropicMain`.

## Verified (live, against the proxy)

- Question ("what does this say about…") → conversational reply, **0 edits**.
- "Make the whole proposal more concise" over 3 blocks → the heading is **skipped**, both
  paragraphs tightened, and every entity (`MECO Engineering Company, Inc.`, `City of Dixon`,
  `Project No. 041-560`, `$250,000`, `Mary Wiles`, `MO PE No. 022510`) preserved (`protectedKept`,
  no warnings).
- "Drop the dollar fee figure" → the edit is proposed but **flagged** (`warnings: ["$250,000"
  was changed…"]`), never silently applied.
