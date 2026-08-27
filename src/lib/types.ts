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
  | { kind: 'replace'; blockId: string; before: string; after: string }
  | { kind: 'insert'; afterId: string | null; block: Block } // afterId null = prepend
  | { kind: 'delete'; blockId: string; before: Block };

export type EditSource = 'ai' | 'user' | 'kb';

/** One applied edit, recorded on the undo stack (also an audit trail for the demo). */
export interface HistoryEntry {
  op: EditOp;
  at: string; // ISO timestamp
  source: EditSource;
  rationale?: string;
}
