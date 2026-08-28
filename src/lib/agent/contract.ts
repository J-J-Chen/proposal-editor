// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC CHAT CONTRACT — request/response for POST /api/chat.
//
// Kept in the agent module (NOT in the frozen src/lib/contracts.ts) so it can evolve
// while a0 wires the FE, without touching the frozen core shapes. Re-exports Block so the
// FE imports document types from one place. Additive only — coordinate before changing.
//
// The whole point: the agent PROPOSES a batch of per-block edits. It never applies.
// The FE reviews them (reusing DiffView per edit) and Keeps/Discards as ONE grouped,
// undo-able transaction. See docs/agentic-chat.md.
// ─────────────────────────────────────────────────────────────────────────────
import type { Block } from '@/lib/types';
import type { DocumentContext } from '@/lib/contracts';

/** One prior turn of the conversation, for multi-turn context. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/chat request. No DB, so the FE sends the live blocks each turn (small: previews
 * only are sent to the planner; full text goes to the guarded editor one block at a time).
 */
export interface ChatRequest {
  message: string;
  history?: ChatTurn[];
  /** The current document blocks (the live, fully-applied model from the reducer). */
  blocks: Block[];
  /** Optional selected blockId, to bias scope toward the user's current focus. */
  selection?: string | null;
  /** Passthrough to the per-block guardrail for voice/consistency. */
  docContext?: DocumentContext;
}

/**
 * One proposed per-block edit — the same shape the review card (DiffView) already consumes,
 * so the FE can map each straight onto a Pending. `instruction` is the per-block instruction
 * the planner assigned (carried onto the resulting Pending). PROPOSED only — never applied here.
 */
export interface ProposedEdit {
  blockId: string;
  before: string;
  after: string;
  /** The single-block instruction the planner assigned to this block. */
  instruction: string;
  /** Model-authored description of the change, not a grounded rationale. */
  changeSummary?: string;
  /** Legacy field retained for older cached responses. */
  rationale?: string;
  /** Protected names/numbers found in `before` that survived verbatim in `after`. */
  protectedKept: string[];
  /**
   * Protected entities that changed DESPITE the guardrail + a repair retry. Non-empty means the
   * FE must flag this edit loudly (parity with the single-block confirm modal) before it's kept.
   */
  warnings?: string[];
}

export interface ChatResponse {
  /** The assistant's conversational reply (always present — even for a question with no edits). */
  reply: string;
  /** One line summarizing the batch, for the review header ("Proposing 6 edits to tighten…"). */
  summary?: string;
  /** The proposed batch. Empty for a question-only turn. Never applied server-side. */
  proposedEdits: ProposedEdit[];
}

export type { Block };
