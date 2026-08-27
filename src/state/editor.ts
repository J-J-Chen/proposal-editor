/**
 * Editor state — one reducer over the whole edit loop (docs/architecture.md "The edit loop").
 * Three slots kept separate so they can't corrupt each other:
 *   - `doc`      — the live, fully-applied block model (what renders).
 *   - `history` + `cursor` — the inverse-command log. `cursor` = count of applied entries;
 *                  [0, cursor) are live, [cursor, len) are redoable. Doubles as the audit trail.
 *   - `pending`  — the AI proposal under review. NOT in history, so Discard can't pollute undo/redo.
 *
 * Undo = cursor-- + invert the op; Redo = cursor++ + re-apply it. One array, one cursor. A new
 * Keep after an Undo drops the abandoned redo future (redo-invalidation). Uses the FROZEN
 * `EditOp`/`HistoryEntry` from src/lib/types.ts — `replace` is what the AI edit loop emits;
 * `insert`/`delete` are handled too (reserved for the KB-insert feature).
 */
import type { Doc, EditOp, HistoryEntry } from '@/lib/types';

/** An AI proposal awaiting the user's Keep/Discard (FE-only; never enters history). */
export interface Pending {
  blockId: string;
  before: string;
  after: string;
  /** The plain instruction that produced it ("Make it more formal") — for the echo + audit. */
  instruction: string;
  rationale?: string;
  /** Protected names/numbers found in the block — shown as "Kept exactly as written". */
  protectedKept: string[];
  /** Guards against applying after the user undid mid-review. */
  baseCursor: number;
}

export interface EditorState {
  doc: Doc | null;
  selectedId: string | null;
  history: HistoryEntry[];
  cursor: number;
  pending: Pending | null;
  status: 'idle' | 'thinking';
  /** The block last changed by keep/undo/redo — lets the view pulse it. */
  lastChangedId: string | null;
}

export const initialEditorState: EditorState = {
  doc: null,
  selectedId: null,
  history: [],
  cursor: 0,
  pending: null,
  status: 'idle',
  lastChangedId: null,
};

export type EditorAction =
  | { type: 'LOAD_DOC'; doc: Doc }
  | { type: 'SELECT'; blockId: string | null }
  | { type: 'START_THINKING' }
  | { type: 'SET_PENDING'; pending: Pending }
  | { type: 'CANCEL_THINKING' }
  | { type: 'DISCARD_PENDING' }
  | { type: 'KEEP_PENDING' }
  /** Apply a batch of chat-proposed edits as ONE grouped, undo-able transaction. */
  | { type: 'KEEP_BATCH'; batch: Pending[] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function applyOp(doc: Doc, op: EditOp): Doc {
  switch (op.kind) {
    case 'replace':
      return {
        ...doc,
        blocks: doc.blocks.map((b) => (b.id === op.blockId ? { ...b, text: op.after } : b)),
      };
    case 'insert': {
      const blocks = doc.blocks.slice();
      const idx = op.afterId === null ? -1 : blocks.findIndex((b) => b.id === op.afterId);
      blocks.splice(idx + 1, 0, op.block);
      return { ...doc, blocks };
    }
    case 'delete':
      return { ...doc, blocks: doc.blocks.filter((b) => b.id !== op.blockId) };
  }
}

function invertOp(doc: Doc, op: EditOp): Doc {
  switch (op.kind) {
    case 'replace':
      return {
        ...doc,
        blocks: doc.blocks.map((b) => (b.id === op.blockId ? { ...b, text: op.before } : b)),
      };
    case 'insert':
      return { ...doc, blocks: doc.blocks.filter((b) => b.id !== op.block.id) };
    case 'delete':
      // Reserved (delete is unused in v1); best-effort restore by re-appending.
      return { ...doc, blocks: doc.blocks.concat(op.before) };
  }
}

/** The block a given op targets — for pulsing / scrolling. */
function opBlockId(op: EditOp): string {
  return op.kind === 'insert' ? op.block.id : op.blockId;
}

/**
 * How many contiguous entries ending at index `end` (inclusive) form one undo step: a run sharing
 * the same non-empty groupId (a Kept chat batch), or just 1 for an ordinary single-block edit.
 */
function groupRunBack(history: HistoryEntry[], end: number): number {
  const gid = history[end]?.groupId;
  if (!gid) return 1;
  let k = 1;
  while (end - k >= 0 && history[end - k].groupId === gid) k++;
  return k;
}

/** How many contiguous entries starting at `start` form one redo step (mirror of groupRunBack). */
function groupRunForward(history: HistoryEntry[], start: number): number {
  const gid = history[start]?.groupId;
  if (!gid) return 1;
  let k = 1;
  while (start + k < history.length && history[start + k].groupId === gid) k++;
  return k;
}

export function canUndo(s: EditorState): boolean {
  return s.cursor > 0;
}
export function canRedo(s: EditorState): boolean {
  return s.cursor < s.history.length;
}
export function lastApplied(s: EditorState): HistoryEntry | null {
  return s.cursor > 0 ? s.history[s.cursor - 1] : null;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'LOAD_DOC':
      return { ...initialEditorState, doc: action.doc };

    case 'SELECT':
      // Selecting elsewhere clears any proposal under review (stale-pending guard).
      return { ...state, selectedId: action.blockId, pending: null, status: 'idle' };

    case 'START_THINKING':
      return { ...state, status: 'thinking', pending: null };

    case 'CANCEL_THINKING':
      return { ...state, status: 'idle', pending: null };

    case 'SET_PENDING':
      // Show the proposal for review. (Staleness is guarded in the caller via a request id,
      // so a response for an abandoned request is never dispatched here.)
      return { ...state, status: 'idle', pending: action.pending };

    case 'DISCARD_PENDING':
      return { ...state, pending: null };

    case 'KEEP_PENDING': {
      const p = state.pending;
      if (!p || !state.doc) return state;
      // Stale guard: the user undid mid-review, so this proposal's base is gone.
      if (p.baseCursor !== state.cursor) return { ...state, pending: null };

      const op: EditOp = { kind: 'replace', blockId: p.blockId, before: p.before, after: p.after };
      const entry: HistoryEntry = {
        op,
        at: new Date().toISOString(),
        source: 'ai',
        rationale: p.rationale,
      };
      // Redo-invalidation: drop any abandoned redo future, then append.
      const history = state.history.slice(0, state.cursor).concat(entry);
      return {
        ...state,
        doc: applyOp(state.doc, op),
        history,
        cursor: state.cursor + 1,
        pending: null,
        lastChangedId: p.blockId,
      };
    }

    case 'KEEP_BATCH': {
      const { batch } = action;
      if (!state.doc || batch.length === 0) return state;
      // One shared base: if the user undid since the batch was proposed, drop it wholesale.
      if (batch[0].baseCursor !== state.cursor) return { ...state, pending: null };

      const at = new Date().toISOString();
      const groupId = `batch-${state.cursor}-${at}`; // unique among live entries
      let doc = state.doc;
      const entries: HistoryEntry[] = batch.map((p) => {
        const op: EditOp = { kind: 'replace', blockId: p.blockId, before: p.before, after: p.after };
        doc = applyOp(doc, op);
        return { op, at, source: 'ai', rationale: p.rationale, groupId };
      });
      // Redo-invalidation: drop any abandoned redo future, then append the whole group.
      const history = state.history.slice(0, state.cursor).concat(entries);
      return {
        ...state,
        doc,
        history,
        cursor: state.cursor + entries.length,
        pending: null,
        lastChangedId: batch[batch.length - 1].blockId,
      };
    }

    case 'UNDO': {
      if (!canUndo(state) || !state.doc || state.status !== 'idle') return state;
      // A grouped batch undoes as one step: invert every entry in the run (newest→oldest).
      const k = groupRunBack(state.history, state.cursor - 1);
      let doc = state.doc;
      for (let i = state.cursor - 1; i >= state.cursor - k; i--) {
        doc = invertOp(doc, state.history[i].op);
      }
      return {
        ...state,
        doc,
        cursor: state.cursor - k,
        pending: null,
        lastChangedId: opBlockId(state.history[state.cursor - 1].op),
      };
    }

    case 'REDO': {
      if (!canRedo(state) || !state.doc || state.status !== 'idle') return state;
      // Mirror of UNDO: reapply the whole group (oldest→newest).
      const k = groupRunForward(state.history, state.cursor);
      let doc = state.doc;
      for (let i = state.cursor; i < state.cursor + k; i++) {
        doc = applyOp(doc, state.history[i].op);
      }
      return {
        ...state,
        doc,
        cursor: state.cursor + k,
        pending: null,
        lastChangedId: opBlockId(state.history[state.cursor].op),
      };
    }

    default:
      return state;
  }
}

/** The nearest preceding heading's text — the "section" a block belongs to. */
export function sectionOf(doc: Doc, blockId: string): string | null {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  for (let i = idx; i >= 0; i--) {
    if (doc.blocks[i].type === 'heading') return doc.blocks[i].text;
  }
  return null;
}
