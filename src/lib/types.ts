// ─────────────────────────────────────────────────────────────────────────────
// CORE CONTRACT — the document model every track builds against. FROZEN.
// Changing these shapes requires coordinating across tracks (announce it).
// See docs/architecture.md ("The document model", "The edit loop").
// ─────────────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'caption'
  | 'table'
  | 'other';

/** Traceable source metadata for text composed from the experience knowledge base. */
export interface KbProvenance {
  candidateId: string;
  title: string;
  sourceDoc: string;
  sourceTitle: string;
  page: number;
  quote: string;
  discipline: string;
  fallbackUsed?: boolean;
}

/** A human-readable reason plus the exact evidence supporting an AI recommendation. */
export interface GroundedRationale {
  reason: string;
  evidence: string;
  provenance?: KbProvenance;
}

/** One editable unit of the document. Selection, edits, and undo all target a Block by id. */
export interface Block {
  /** Stable id (derived from content + order so it survives a re-parse where possible). */
  id: string;
  type: BlockType;
  text: string;
  /** Heading depth 1..3 (only for type === 'heading'). */
  level?: number;
  /** 1-based page the block came from (provenance). */
  page: number;
  /** Present when this block was inserted from a reviewed KB candidate. */
  provenance?: KbProvenance;
}

/** The parsed, editable document. The rendered view IS this model. */
export interface Doc {
  /** = sha256 of the source file bytes (also the parse-cache key). */
  id: string;
  filename: string;
  blocks: Block[];
  meta?: { pages: number; parsedAt: string; model?: string };
}

// ── Edits: ONE op union for AI edits, manual edits, and KB inserts; powers undo/redo ──

export type EditOp =
  | {
      kind: 'replace';
      blockId: string;
      before: string;
      after: string;
      /**
       * Present only when this rewrite changes the block's citation state. A later rewrite of a
       * KB insertion clears its source badge; Undo restores it and Redo clears it again. Keeping
       * this optional preserves hydration compatibility with older saved replace operations.
       */
      provenanceChange?: { before?: KbProvenance; after?: KbProvenance };
    }
  | { kind: 'insert'; afterId: string | null; block: Block } // afterId null = prepend
  | { kind: 'delete'; blockId: string; before: Block };

export type EditSource = 'ai' | 'user' | 'kb';

/** One applied edit, recorded on the undo stack (also an audit trail for the demo). */
export interface HistoryEntry {
  op: EditOp;
  at: string; // ISO timestamp
  source: EditSource;
  /** Legacy model-generated summary, retained for saved-snapshot hydration compatibility. */
  rationale?: string;
  /** Stable, user-facing description of the applied change. */
  changeSummary?: string;
  /** Structured reason/evidence captured before the change was generated. */
  grounding?: GroundedRationale;
  /** Source metadata for an applied KB insertion. */
  provenance?: KbProvenance;
  /**
   * Groups entries that must undo/redo as ONE transaction — a batch of per-block edits Kept
   * together from the agentic chat. Contiguous entries sharing a groupId pop/reapply as a unit.
   * Absent for ordinary single-block edits (each its own step). Additive; optional.
   */
  groupId?: string;
}
