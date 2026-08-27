/**
 * The editor — composition of the whole front-end loop (I own the FE per build-plan.md):
 * open → reading → document + Assistant pane → select → ask AI (/api/edit) → review card →
 * Keep/Discard → compose → Undo/Redo, plus the protected-name safety net. State lives in the
 * reducer (src/state/editor.ts); this component owns screen transitions + the async edit flow.
 */
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Block, Doc, HistoryEntry } from '@/lib/types';
import {
  canRedo,
  canUndo,
  editorReducer,
  initialEditorState,
  opBlockId,
  sectionOf,
  type Pending,
} from '@/state/editor';
import { parseByHash, parseByUpload, parseByBlobUrl, requestEdit, requestSuggestions } from '@/lib/client';
import {
  loadRecents,
  touchRecent,
  removeRecent as removeRecentEntry,
  loadActive,
  setActive,
  loadSession,
  saveSession,
  type RecentDoc,
  type DocSource,
} from '@/lib/persist';
import { droppedEntities, extractEntities, protectedStrings, type EntityKind } from '@/lib/entities';
import { isNoChange } from '@/lib/text/diff';
import { DocumentView } from './DocumentView';
import { PageView } from './PageView';
import { EditPanel } from './EditPanel';
import { ChangesPanel, StatusBar, Titlebar, type ChangeItem } from './AppChrome';
import { RefinePanel } from './RefinePanel';
import { ChatPanel, type ChatBatch, type ChatEdit } from './ChatPanel';
import { scanForRefinements, type Suggestion } from '@/refine/scan';
import { requestChat } from '@/lib/agent/client';
import type { ChatTurn } from '@/lib/agent/contract';
import { RENDERED } from '@/parse-cache/renders';
import { IconCheck, IconFolder, IconShield } from './icons';

// 'boot' = the first client tick, before we've read localStorage — avoids flashing the Open
// screen when we're about to restore a document the user was working on.
type View = 'boot' | 'open' | 'reading' | 'editor';
/** Which surface fills the canvas: the editable block model, or the faithful read-only PDF. */
type DocView = 'document' | 'original';

/** The bundled sample proposals — each sha256 cache-hits a committed parse seed (a real Doc). */
type Sample = { hash: string; filename: string; title: string; subtitle: string };
const SAMPLES: Sample[] = [
  {
    hash: '03dd3ee8dd7962eb11fd67dd223cfdcdcd0e4f8957aa8622ac24d929cd8c5829',
    filename: 'easy.pdf',
    title: 'Statement of Qualifications — City of Dixon',
    subtitle: 'Sample proposal — open this to try it out',
  },
  {
    hash: '02d30cdbbdf08ce1f8a743b233665e4d6f5550343e1a96cc4da0223733851bf9',
    filename: 'hard.pdf',
    title: 'Statement of Qualifications — City of Kirksville',
    subtitle: 'Larger sample — 19 pages, denser layout',
  },
];
const FIRM = 'MECO Engineering Company, Inc.';
/** Firm voice/context for the guardrail — only for the seeded MECO samples. An unseen upload is
 *  someone else's proposal, so injecting "MECO" would bias its edits toward the wrong firm. */
function firmFor(docId: string): string | undefined {
  return SAMPLES.some((s) => s.hash === docId) ? FIRM : undefined;
}

/**
 * Build the instruction for a follow-up refine turn. The block we send is the CURRENT draft
 * (so "shorter" shortens the latest wording, not the original), but we hand the model the
 * original text as reference so an ask like "put the client name back" can still restore
 * something an earlier turn dropped. The entity guardrail (system prompt + client gate) does
 * the heavy lifting; this just frames the turn.
 */
function composeRefineInstruction(original: string, phrase: string): string {
  return (
    `This is a follow-up refinement of an edit already under review. Apply this change to the ` +
    `current draft below, changing only what it asks and keeping the rest of the draft: ${phrase}. ` +
    `For reference, the original text was:\n"""${original}"""`
  );
}

function relTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
}

/**
 * Reconstruct each block's pristine (pre-edit) text from a restored snapshot, so the Original-PDF
 * overlay (editedText) still highlights edits the user made before a soft refresh / reopen. Walks
 * the applied history backwards; the earliest `before` for a block is its true original text.
 */
function originalTextMap(doc: Doc, history: HistoryEntry[], cursor: number): Record<string, string> {
  const map: Record<string, string> = Object.fromEntries(doc.blocks.map((b) => [b.id, b.text]));
  for (let i = Math.min(cursor, history.length) - 1; i >= 0; i--) {
    const op = history[i].op;
    if (op.kind === 'replace') map[op.blockId] = op.before;
  }
  return map;
}

async function sha256(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unknown';
  }
}

function OpenScreen({
  recents,
  activeId,
  hasOpenDoc,
  onSample,
  onFile,
  onOpenRecent,
  onRemoveRecent,
  onBackToDoc,
  error,
}: {
  recents: RecentDoc[];
  activeId: string | null;
  hasOpenDoc: boolean;
  onSample: (s: Sample) => void;
  onFile: (f: File) => void;
  onOpenRecent: (r: RecentDoc) => void;
  onRemoveRecent: (id: string) => void;
  onBackToDoc: () => void;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="backstage">
      <div className="bs-inner">
        {hasOpenDoc && (
          <button className="bs-back" onClick={onBackToDoc}>
            ← Back to your document
          </button>
        )}
        <div className="bs-title">
          {recents.length > 0 ? 'Open a proposal' : 'Start by opening your proposal'}
        </div>
        <div
          className="bs-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <input
            ref={inputRef}
            id="proposal-file"
            name="proposal-file"
            aria-label="Choose a proposal PDF"
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <button className="bs-open" onClick={() => inputRef.current?.click()}>
            <IconFolder />
            Open a proposal
          </button>
          <span className="bs-or">Choose a PDF from your computer — or drag it here.</span>
        </div>

        {recents.length > 0 && (
          <div className="bs-group">
            <div className="bs-section">Recent</div>
            {recents.map((r) => {
              const current = r.id === activeId;
              const meta = `${r.source === 'sample' ? 'Sample' : 'PDF'}${
                r.pages ? ` · ${r.pages} page${r.pages === 1 ? '' : 's'}` : ''
              } · ${current ? 'currently open' : `opened ${relTime(r.lastOpenedAt)}`}`;
              return (
                <div className={`recent${current ? ' current' : ''}`} key={r.id}>
                  <button className="recent-open" onClick={() => onOpenRecent(r)}>
                    <span className="thumb" />
                    <span className="rt">
                      <b>{r.filename}</b>
                      <span>{meta}</span>
                    </span>
                  </button>
                  {!current && (
                    <button
                      className="recent-x"
                      title="Remove from recent"
                      aria-label={`Remove ${r.filename} from recent`}
                      onClick={() => onRemoveRecent(r.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="bs-group">
          <div className="bs-section">Sample proposals</div>
          {SAMPLES.map((s) => (
            <button key={s.hash} className="recent" onClick={() => onSample(s)}>
              <span className="thumb" />
              <span className="rt">
                <b>{s.title}</b>
                <span>{s.subtitle}</span>
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="pane-note warn" style={{ maxWidth: 480 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadingScreen() {
  return (
    <div className="waitwrap">
      <div className="ghost-page" />
      <div className="waitcard">
        <div className="spinner" />
        <div className="wt">Reading your proposal…</div>
        <div className="ws">
          This usually takes about a minute the first time.
          <br />
          You don’t need to do anything — we’ll show your document when it’s ready.
        </div>
      </div>
    </div>
  );
}

/** What to call each protected-entity kind in plain language. */
const ENTITY_NOUN: Record<EntityKind, string> = {
  name: 'name',
  license: 'license number',
  projectNo: 'project number',
  money: 'dollar amount',
  phone: 'phone number',
};

function ConfirmModal({
  token,
  kind,
  onYes,
  onNo,
}: {
  token: string;
  kind: EntityKind;
  onYes: () => void;
  onNo: () => void;
}) {
  const noun = ENTITY_NOUN[kind];
  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Change a ${noun} we usually keep exactly?`}
    >
      <div className="modal">
        <div className="m-body">
          <div className="m-ico">
            <IconShield />
          </div>
          <h3>Change a {noun} we usually keep exactly?</h3>
          <p>
            You asked to change <span className="tok">{token}</span>. We normally keep names and
            numbers exactly as written so your proposal stays accurate. Are you sure you want to
            change it?
          </p>
        </div>
        <div className="m-act">
          <button className="m-danger" onClick={onYes}>
            Yes, change it
          </button>
          <button className="m-safe" onClick={onNo}>
            No, keep it as is
          </button>
        </div>
      </div>
    </div>
  );
}

/** The "Original PDF | Your document" switch over the canvas — plain words, Word-familiar. */
function DocViewSwitch({
  value,
  onChange,
}: {
  value: DocView;
  onChange: (v: DocView) => void;
}) {
  return (
    <div className="viewswitch" role="tablist" aria-label="How to view your proposal">
      <button
        role="tab"
        aria-selected={value === 'original'}
        className={value === 'original' ? 'on' : ''}
        onClick={() => onChange('original')}
      >
        Original PDF
      </button>
      <button
        role="tab"
        aria-selected={value === 'document'}
        className={value === 'document' ? 'on' : ''}
        onClick={() => onChange('document')}
      >
        Your document
      </button>
    </div>
  );
}

/**
 * Merge the LLM editorial suggestions onto the deterministic client scan. Dedupe by id (client
 * wins — the two category sets don't overlap anyway), and staleness-guard the server list: drop
 * any whose `evidence` is no longer a verbatim substring of its current block text. da guarantees
 * server evidence is verbatim, so this filters both cache-stale items and anything the user edited
 * out mid-review. The client scan is always freshly computed, so it passes through untouched.
 */
function mergeSuggestions(doc: Doc, clientScan: Suggestion[], server: Suggestion[]): Suggestion[] {
  const seen = new Set(clientScan.map((s) => s.id));
  const fresh = server.filter((s) => {
    if (seen.has(s.id)) return false;
    const block = doc.blocks.find((b) => b.id === s.blockId);
    return !!block && block.text.includes(s.evidence);
  });
  return [...clientScan, ...fresh];
}

export function Editor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [view, setView] = useState<View>('boot');
  const [docView, setDocView] = useState<DocView>('original');
  // Snapshot of each block's ORIGINAL text (as parsed), so the Original-PDF overlay knows which
  // blocks have been edited (their current text differs) and patches them in place. Held in STATE
  // (not a ref) so the editedText memo below is reactive and doesn't read a ref during render.
  const [originalBaseline, setOriginalBaseline] = useState<Record<string, string>>({});
  const [openError, setOpenError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ token: string; kind: EntityKind; data: Pending } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [lastInstruction, setLastInstruction] = useState('');
  // Follow-up conversation on the pending proposal: the asks made so far (the review thread) and
  // whether an adjustment is in flight. Distinct from status:'thinking' so the diff card stays up.
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  // Tracks which block the follow-up thread belongs to, so we can reset it when the proposal
  // under review changes block or clears (see the render-time guard below).
  const [threadBlockId, setThreadBlockId] = useState<string | null>(null);
  // Refine ("Check my proposal") state.
  const [refineOpen, setRefineOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Agentic chat ("Ask the assistant") state.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([]);
  const [chatStatus, setChatStatus] = useState<'idle' | 'thinking'>('idle');
  const [chatBatch, setChatBatch] = useState<ChatBatch | null>(null);
  const [chatIncluded, setChatIncluded] = useState<Set<string>>(new Set());
  const reqRef = useRef(0);
  const suggestReqRef = useRef(0); // guards a stale /api/suggest response from a superseded scan
  const chatReqRef = useRef(0); // guards a stale /api/chat response from a superseded turn
  // Recent documents (localStorage) + a guard so autosave never fires before the first restore.
  const [recents, setRecents] = useState<RecentDoc[]>([]);
  const hydratedRef = useRef(false);
  // Whether the last autosave actually reached localStorage (false = private mode / full quota),
  // so the "All changes saved" reassurance is never shown dishonestly.
  const [persistOk, setPersistOk] = useState(true);

  const { doc, selectedId, pending, status } = state;
  const selectedBlock = useMemo(
    () => doc?.blocks.find((b) => b.id === selectedId) ?? null,
    [doc, selectedId],
  );
  const section = doc && selectedId ? sectionOf(doc, selectedId) : null;
  // Reset the follow-up thread when the proposal under review moves to a different block or clears
  // (Keep/Discard/Undo/reselect). Done during render — React's endorsed "adjust state on change"
  // pattern — keyed on blockId, so a refine turn (new pending, SAME blockId) preserves the thread.
  const pendingBlockId = pending?.blockId ?? null;
  if (pendingBlockId !== threadBlockId) {
    setThreadBlockId(pendingBlockId);
    setFollowUps([]);
    setRefining(false);
  }
  // Whether the faithful "Original PDF" view has pages to show (committed renders, or a page count).
  const originalAvailable = doc
    ? (RENDERED[doc.id]?.pages ?? doc.meta?.pages ?? 0) > 0
    : false;
  // Blocks whose current text differs from the original — patched onto the Original-PDF view.
  const editedText = useMemo(() => {
    const out: Record<string, string> = {};
    if (!doc) return out;
    for (const b of doc.blocks) {
      if (originalBaseline[b.id] !== undefined && b.text !== originalBaseline[b.id]) {
        out[b.id] = b.text;
      }
    }
    return out;
  }, [doc, originalBaseline]);
  // The current doc's private Blob URL (uploads only — samples have none), from its recent entry.
  // Passed to the Original-PDF view so /api/page can self-heal a cold-instance render miss.
  const activeBlobUrl = useMemo(
    () => (doc ? (recents.find((r) => r.id === doc.id)?.blobUrl ?? null) : null),
    [doc, recents],
  );
  // Per-section inline undo/redo: a block that has an applied change (a live op in history) shows a
  // small control. 'undo' when it currently differs from its original, 'redo' when it's been
  // reverted back to the original (so the edit can be reapplied). Driven off the same
  // originalBaseline the Original-PDF overlay uses.
  const sectionControls = useMemo(() => {
    const m: Record<string, 'undo' | 'redo'> = {};
    if (!doc) return m;
    const touched = new Set<string>();
    for (let i = 0; i < state.cursor; i++) touched.add(opBlockId(state.history[i].op));
    for (const b of doc.blocks) {
      if (!touched.has(b.id)) continue;
      // Hide the control while THIS block has a review open — clicking it would silently drop the
      // in-progress AI suggestion (SECTION_STEP clears pending). It returns after Keep/Discard.
      if (state.pending?.blockId === b.id) continue;
      const orig = originalBaseline[b.id];
      if (orig === undefined) continue;
      m[b.id] = b.text !== orig ? 'undo' : 'redo';
    }
    return m;
  }, [doc, originalBaseline, state.history, state.cursor, state.pending]);

  const sectionStep = useCallback((blockId: string) => {
    dispatch({ type: 'SECTION_STEP', blockId });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  // Restore on first client tick: the Recent list, and the document the user last had open
  // (with its edits + undo history). This MUST be an effect, not a lazy state initializer:
  // localStorage doesn't exist during SSR, so reading it at render time would desync the
  // server/client hydration. The synchronous setState here is the intended one-time "sync on
  // mount", which is why the set-state-in-effect rule is disabled just for this block.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecents(loadRecents());
    const active = loadActive();
    const sess = active ? loadSession(active) : null;
    if (sess) {
      dispatch({
        type: 'HYDRATE',
        doc: sess.doc,
        history: sess.history,
        cursor: sess.cursor,
        selectedId: sess.selectedId,
      });
      setOriginalBaseline(originalTextMap(sess.doc, sess.history, sess.cursor));
      setDocView(sess.docView === 'original' ? 'original' : 'document');
      setView('editor');
    } else {
      setView('open');
    }
    hydratedRef.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Autosave the working snapshot on every change, so a soft refresh restores the doc + edits.
  // Transient state (pending review, thinking) is intentionally never persisted.
  useEffect(() => {
    if (!hydratedRef.current || view !== 'editor' || !doc) return;
    setActive(doc.id);
    const ok = saveSession({
      docId: doc.id,
      doc,
      history: state.history,
      cursor: state.cursor,
      docView,
      selectedId,
      savedAt: new Date().toISOString(),
    });
    setPersistOk(ok);
  }, [view, doc, state.history, state.cursor, docView, selectedId]);

  // Clear a settled selection — clicking blank space, or pressing Escape. Guarded so it never
  // yanks a change out from under the user while they're mid-edit (thinking or reviewing).
  const deselect = useCallback(() => {
    if (status !== 'idle' || pending || !selectedId) return;
    reqRef.current++;
    setNote(null);
    setConfirm(null);
    setPeekId(null);
    dispatch({ type: 'SELECT', blockId: null });
  }, [status, pending, selectedId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view !== 'editor') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'Escape') {
        deselect();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, deselect]);

  const openDoc = useCallback(
    async (
      hash: string,
      filename: string,
      opts?: { file?: File; blobUrl?: string; source?: DocSource },
    ) => {
      setOpenError(null);
      // Already the open doc? Just return to it. Otherwise, if we have a saved working snapshot,
      // RESTORE it (edits + undo history) instead of re-parsing — a fresh parse would reset the
      // doc and the autosave would then clobber the saved snapshot. This mirrors openRecent and
      // covers every entry point (Sample tile, drag/upload of the same file, reopen).
      if (doc && hash === doc.id) {
        setView('editor');
        return;
      }
      const existing = loadSession(hash);
      if (existing) {
        dispatch({
          type: 'HYDRATE',
          doc: existing.doc,
          history: existing.history,
          cursor: existing.cursor,
          selectedId: existing.selectedId,
        });
        // Baseline for the Original-PDF overlay: pristine text before any restored edits.
        setOriginalBaseline(originalTextMap(existing.doc, existing.history, existing.cursor));
        setDocView(existing.docView === 'original' ? 'original' : 'document');
        setView('editor');
        setActive(hash);
        const src: DocSource = opts?.source ?? (opts?.file || opts?.blobUrl ? 'upload' : 'sample');
        const prior = loadRecents().find((r) => r.id === hash);
        setRecents(
          touchRecent({
            id: hash,
            filename: existing.doc.filename,
            source: src,
            pages: RENDERED[hash]?.pages ?? existing.doc.meta?.pages ?? prior?.pages ?? 0,
            lastOpenedAt: new Date().toISOString(),
            blobUrl: opts?.blobUrl ?? prior?.blobUrl,
          }),
        );
        return;
      }
      setView('reading');
      try {
        const r = await parseByHash(hash, filename);
        let loaded: Doc | null = null;
        let blobUrl = opts?.blobUrl;
        if ('doc' in r) {
          loaded = r.doc; // cache/seed hit — instant
        } else if (opts?.file) {
          const up = await parseByUpload(opts.file, hash); // unseen PDF → Blob → parse
          loaded = up.doc;
          blobUrl = up.blobUrl;
        } else if (opts?.blobUrl) {
          loaded = await parseByBlobUrl(hash, filename, opts.blobUrl); // reopen an upload
        }
        if (!loaded) throw new Error('cache miss with no bytes to parse');
        setOriginalBaseline(Object.fromEntries(loaded.blocks.map((b) => [b.id, b.text])));
        dispatch({ type: 'LOAD_DOC', doc: loaded });
        // Land on the faithful Original PDF (the main view) when we have page renders for it; fall
        // back to the block view only when there's nothing to rasterise (so the toggle stays usable).
        const hasOriginal = (RENDERED[loaded.id]?.pages ?? loaded.meta?.pages ?? 0) > 0;
        setDocView(hasOriginal ? 'original' : 'document');
        setView('editor');
        const source: DocSource =
          opts?.source ?? (opts?.file || opts?.blobUrl ? 'upload' : 'sample');
        const pages = RENDERED[loaded.id]?.pages ?? loaded.meta?.pages ?? 0;
        setActive(loaded.id);
        setRecents(
          touchRecent({
            id: loaded.id,
            filename: loaded.filename,
            source,
            pages,
            lastOpenedAt: new Date().toISOString(),
            blobUrl,
          }),
        );
      } catch {
        if (doc) {
          // A failed open/reopen while a document is already open: stay on it, and surface the
          // error where it's visible — the Open-screen error banner isn't rendered in editor view.
          setView('editor');
          setToast('Couldn’t read that file — your current document is unchanged.');
        } else {
          setView('open');
          setOpenError('Something went wrong reading your proposal. Please try again.');
        }
      }
    },
    [doc],
  );

  const openSample = useCallback(
    (s: Sample) => openDoc(s.hash, s.filename, { source: 'sample' }),
    [openDoc],
  );

  const onFile = useCallback(
    async (f: File) => {
      setView('reading');
      const hash = await sha256(f);
      void openDoc(hash, f.name, { file: f, source: 'upload' });
    },
    [openDoc],
  );

  // Return to the backstage / Open screen without closing the current doc (its snapshot stays).
  // Cancel anything in flight first, so a late AI response can't land on the next document and no
  // confirm/review card is left hanging over the Open screen.
  const goBackstage = useCallback(() => {
    reqRef.current++; // invalidate any in-flight edit response
    chatReqRef.current++; // …and any in-flight chat turn
    setOpenError(null);
    setRefineOpen(false);
    setConfirm(null);
    setNote(null);
    dispatch({ type: 'CANCEL_THINKING' }); // clears thinking + any pending review card
    setView('open');
  }, []);

  const backToDoc = useCallback(() => {
    if (doc) setView('editor');
  }, [doc]);

  const openRecent = useCallback(
    (r: RecentDoc) => {
      if (doc && r.id === doc.id) {
        backToDoc(); // already loaded — just return to it
        return;
      }
      const sess = loadSession(r.id);
      if (sess) {
        // Restore the saved working snapshot (edits + undo history) — no network, no re-parse.
        dispatch({
          type: 'HYDRATE',
          doc: sess.doc,
          history: sess.history,
          cursor: sess.cursor,
          selectedId: sess.selectedId,
        });
        setOriginalBaseline(originalTextMap(sess.doc, sess.history, sess.cursor));
        setDocView(sess.docView === 'original' ? 'original' : 'document');
        setView('editor');
        setActive(r.id);
        setRecents(touchRecent({ ...r, lastOpenedAt: new Date().toISOString() }));
        return;
      }
      void openDoc(r.id, r.filename, { blobUrl: r.blobUrl, source: r.source });
    },
    [doc, backToDoc, openDoc],
  );

  const removeRecent = useCallback((id: string) => {
    setRecents(removeRecentEntry(id));
  }, []);

  const onSelect = useCallback((id: string) => {
    reqRef.current++; // cancel any in-flight edit for the previous selection
    setNote(null);
    setConfirm(null);
    setRefineOpen(false); // a direct doc click leaves the Refine list
    setChatOpen(false); // …and leaves chat → the single-block Assistant for this block
    setActiveSuggestionId(null); // …so a later Keep isn't misattributed to a stale suggestion
    setPeekId(null);
    dispatch({ type: 'SELECT', blockId: id });
  }, []);

  const runEdit = useCallback(
    async (block: Block, instruction: string) => {
      setNote(null);
      setConfirm(null);
      const myReq = ++reqRef.current;
      const baseCursor = state.cursor;
      dispatch({ type: 'START_THINKING' });

      const headings = doc ? doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text) : [];
      const result = await requestEdit({
        block: { id: block.id, text: block.text, type: block.type },
        instruction,
        docContext: { headings, firm: doc ? firmFor(doc.id) : undefined },
      });
      if (myReq !== reqRef.current) return; // stale — user reselected or cancelled

      if (!result.ok) {
        dispatch({ type: 'CANCEL_THINKING' });
        setNote({ kind: 'warn', text: result.message });
        return;
      }
      const after = result.res.newText;
      if (isNoChange(block.text, after)) {
        dispatch({ type: 'CANCEL_THINKING' });
        setNote({ kind: 'info', text: 'This already looks good — I didn’t find anything to change.' });
        return;
      }

      // Occurrence-counting gate (shared with the batch backstop) — catches appended-digit
      // tampering and dropped duplicates that a substring `.includes` would silently pass.
      const protectedChanged = droppedEntities(block.text, after);
      const changedSet = new Set(protectedChanged);
      const protectedKept = protectedStrings(block.text).filter((s) => !changedSet.has(s));
      const data: Pending = {
        blockId: block.id,
        before: block.text,
        after,
        instruction,
        rationale: result.res.rationale,
        protectedKept,
        baseCursor,
      };
      if (protectedChanged.length > 0) {
        // Name the kind of the first changed entity so the confirm says "phone number" / "license
        // number" / … rather than always "name".
        const ents = extractEntities(block.text);
        const kind: EntityKind = ents.find((e) => e.text === protectedChanged[0])?.kind ?? 'name';
        dispatch({ type: 'CANCEL_THINKING' });
        setConfirm({ token: protectedChanged[0], kind, data });
      } else {
        dispatch({ type: 'SET_PENDING', pending: data });
      }
    },
    [state.cursor, doc],
  );

  const handleAction = useCallback(
    (instruction: string) => {
      if (!selectedBlock) return;
      setLastInstruction(instruction);
      void runEdit(selectedBlock, instruction);
    },
    [selectedBlock, runEdit],
  );

  const onKeep = useCallback(() => {
    const changedId = pending?.blockId;
    dispatch({ type: 'KEEP_PENDING' });
    setToast('Change saved. You can Undo if you change your mind.');
    // The action may concern a paragraph on another PDF page. Reveal the applied patch after the
    // reducer has rendered it instead of leaving the user at the old scroll position.
    if (changedId) {
      setTimeout(() => {
        document
          .querySelector(`[data-block-id="${changedId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 30);
    }
    if (activeSuggestionId) {
      // Resolve this suggestion and return cleanly to the list (the kept block still pulses).
      setResolved((prev) => new Set(prev).add(activeSuggestionId));
      setActiveSuggestionId(null);
      setPeekId(null);
      dispatch({ type: 'SELECT', blockId: null });
    }
  }, [activeSuggestionId, pending]);
  const onDiscard = useCallback(() => {
    dispatch({ type: 'DISCARD_PENDING' });
    if (activeSuggestionId) {
      // Leave the suggestion in the list (not resolved) and go back to it.
      setActiveSuggestionId(null);
      setPeekId(null);
      dispatch({ type: 'SELECT', blockId: null });
    } else {
      setNote({ kind: 'info', text: 'No changes made.' });
    }
  }, [activeSuggestionId]);
  const onCancel = useCallback(() => {
    reqRef.current++;
    dispatch({ type: 'CANCEL_THINKING' });
  }, []);

  const confirmYes = () => {
    if (!confirm) return;
    dispatch({ type: 'SET_PENDING', pending: confirm.data });
    setConfirm(null);
  };
  const confirmNo = () => {
    setConfirm(null);
    if (activeSuggestionId) setActiveSuggestionId(null);
    else setNote({ kind: 'info', text: 'No changes made.' });
  };

  // Follow-up refine on the pending proposal — iterate the draft in place before Keep/Discard.
  // Does NOT dispatch START_THINKING (that would wipe `pending` and hide the diff); instead a
  // local `refining` flag keeps the card on screen while the next draft is written.
  const onRefine = useCallback(
    async (phrase: string) => {
      const p = pending;
      const text = phrase.trim();
      if (!p || !doc || !text || refining) return;
      const type = doc.blocks.find((b) => b.id === p.blockId)?.type ?? 'paragraph';
      setNote(null);
      setConfirm(null);
      const myReq = ++reqRef.current; // shares the stale-guard with runEdit/onSelect/onCancel
      setRefining(true);
      setFollowUps((prev) => [...prev, text]);

      const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
      const result = await requestEdit({
        block: { id: p.blockId, text: p.after, type }, // iterate on the CURRENT draft
        instruction: composeRefineInstruction(p.before, text),
        docContext: { headings, firm: firmFor(doc.id) },
      });
      // Superseded (reselect / cancel / a newer refine). Leave `refining` alone: if a newer refine
      // took over it owns the flag; if the proposal cleared, the reset effect already cleared it.
      if (myReq !== reqRef.current) return;
      setRefining(false);

      if (!result.ok) {
        setNote({ kind: 'warn', text: result.message });
        return; // keep the current proposal on screen so the thread isn't lost
      }
      const after = result.res.newText;
      if (isNoChange(p.after, after)) {
        setNote({ kind: 'info', text: 'I couldn’t adjust it further for that — the wording is unchanged.' });
        return;
      }
      // Gate against the ORIGINAL (p.before), never the intermediate draft, so entity drift that
      // accumulates across turns can't slip past the Keep.
      const protectedChanged = droppedEntities(p.before, after);
      const changedSet = new Set(protectedChanged);
      const protectedKept = protectedStrings(p.before).filter((s) => !changedSet.has(s));
      const data: Pending = {
        blockId: p.blockId,
        before: p.before, // pinned original — the undo baseline
        after,
        instruction: p.instruction, // headline stays the original ask; nudges show as the thread
        rationale: result.res.rationale,
        protectedKept,
        baseCursor: p.baseCursor, // pinned — nothing applied yet, cursor hasn't moved
        docId: p.docId,
      };
      if (protectedChanged.length > 0) {
        const ents = extractEntities(p.before);
        const kind: EntityKind = ents.find((e) => e.text === protectedChanged[0])?.kind ?? 'name';
        setConfirm({ token: protectedChanged[0], kind, data });
      } else {
        dispatch({ type: 'SET_PENDING', pending: data });
      }
    },
    [pending, doc, refining],
  );

  const gotoBlock = useCallback((id: string) => {
    setShowChanges(false);
    dispatch({ type: 'SELECT', blockId: id });
    setTimeout(() => {
      document
        .querySelector(`[data-block-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  }, []);

  // ---- Refine ("Check my proposal for things to fix") ----
  const runScan = useCallback(() => {
    if (!doc) return;
    // Instant, no-spend floor: the deterministic client scan shows immediately…
    const clientScan = scanForRefinements(doc);
    setSuggestions(clientScan);
    setDismissed(new Set());
    setResolved(new Set());
    setActiveSuggestionId(null);
    setPeekId(null);
    setNote(null);
    setConfirm(null);
    dispatch({ type: 'SELECT', blockId: null });
    setRefineOpen(true);
    // …then the LLM editorial pass runs in parallel and merges in when it returns. Any failure
    // degrades silently to [] (requestSuggestions swallows it), leaving the client floor intact.
    const myReq = ++suggestReqRef.current;
    setSuggestLoading(true);
    void requestSuggestions(doc).then((server) => {
      if (myReq !== suggestReqRef.current) return; // a newer scan (or close) superseded this one
      if (server.length) setSuggestions((prev) => mergeSuggestions(doc, prev, server));
      setSuggestLoading(false);
    });
  }, [doc]);

  const closeRefine = useCallback(() => {
    suggestReqRef.current++; // drop any in-flight editorial pass
    setSuggestLoading(false);
    setRefineOpen(false);
    setPeekId(null);
    dispatch({ type: 'SELECT', blockId: null });
  }, []);

  // Hovering a suggestion reveals its section in the document (steady highlight + gentle scroll).
  const peekBlock = useCallback((id: string | null) => {
    setPeekId(id);
    if (id) {
      document
        .querySelector(`[data-block-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  // From a suggestion's edit (thinking or review card) back to the full list, without Keep/Discard.
  const backToSuggestions = useCallback(() => {
    reqRef.current++; // ignore any in-flight edit response
    setActiveSuggestionId(null);
    setNote(null);
    setConfirm(null);
    setPeekId(null);
    dispatch({ type: 'SELECT', blockId: null }); // clears pending + thinking; refineOpen stays → RefinePanel
  }, []);

  // ---- Agentic chat ("Ask the assistant") ----
  const openChat = useCallback(() => {
    reqRef.current++;
    setRefineOpen(false);
    setActiveSuggestionId(null);
    setPeekId(null);
    setNote(null);
    setConfirm(null);
    dispatch({ type: 'SELECT', blockId: null });
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    chatReqRef.current++; // drop any in-flight turn
    setChatOpen(false);
    setChatStatus('idle');
    setPeekId(null);
  }, []);

  const sendChat = useCallback(
    (message: string) => {
      if (!doc) return;
      const history = chatMessages;
      setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
      setChatBatch(null);
      setChatIncluded(new Set());
      setChatStatus('thinking');
      const myReq = ++chatReqRef.current;
      const baseCursor = state.cursor;
      void requestChat({
        message,
        history,
        blocks: doc.blocks,
        selection: selectedId,
        docContext: { firm: doc ? firmFor(doc.id) : undefined },
      }).then((result) => {
        if (myReq !== chatReqRef.current) return; // superseded turn or chat closed
        setChatStatus('idle');
        if (!result.ok) {
          setChatMessages((prev) => [...prev, { role: 'assistant', content: result.message }]);
          return;
        }
        const { reply, summary, proposedEdits } = result.res;
        setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
        if (proposedEdits.length > 0) {
          const edits: ChatEdit[] = proposedEdits.map((e) => {
            // Independent client-side entity gate (∪ the server's warnings): a protected change
            // can never be silently kept, even if a server warning were missing. Same
            // occurrence-counting check as the single-block gate.
            const changed = droppedEntities(e.before, e.after);
            const flagged = changed.length > 0 || (e.warnings?.length ?? 0) > 0;
            return { ...e, flagged, section: sectionOf(doc, e.blockId) };
          });
          setChatBatch({ summary, edits, baseCursor, docId: doc.id });
          // Safe edits on by default; flagged ones OFF until the user explicitly turns them on.
          setChatIncluded(new Set(edits.filter((e) => !e.flagged).map((e) => e.blockId)));
        }
      });
    },
    [doc, chatMessages, state.cursor, selectedId],
  );

  const toggleChatInclude = useCallback((blockId: string) => {
    setChatIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  const keepChatBatch = useCallback(() => {
    if (!chatBatch || !doc) return;
    const included = chatBatch.edits.filter((e) => chatIncluded.has(e.blockId));
    // Only edits that still apply cleanly to the CURRENT doc: right document, unchanged base, and
    // the target block still holds exactly the text the edit was proposed against. This is the same
    // check the reducer re-runs, so the count we report is the count that actually applies.
    const applicable =
      chatBatch.docId === doc.id && chatBatch.baseCursor === state.cursor
        ? included.filter((e) => {
            const b = doc.blocks.find((x) => x.id === e.blockId);
            return !!b && b.text === e.before;
          })
        : [];
    if (applicable.length === 0) {
      setChatBatch(null);
      setChatIncluded(new Set());
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Those changes no longer apply — your document has moved on since. Nothing was changed.',
        },
      ]);
      return;
    }
    const batch: Pending[] = applicable.map((e) => ({
      blockId: e.blockId,
      before: e.before,
      after: e.after,
      instruction: e.instruction,
      rationale: e.rationale,
      protectedKept: e.protectedKept,
      baseCursor: chatBatch.baseCursor,
      docId: chatBatch.docId,
    }));
    dispatch({ type: 'KEEP_BATCH', batch });
    setChatBatch(null);
    setChatIncluded(new Set());
    const n = applicable.length;
    setChatMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `Done — I applied ${n} change${n === 1 ? '' : 's'}. You can Undo the whole set from the top-left.`,
      },
    ]);
    setToast(`Applied ${n} change${n === 1 ? '' : 's'}. Undo reverses them together.`);
  }, [chatBatch, chatIncluded, doc, state.cursor]);

  const discardChatBatch = useCallback(() => {
    setChatBatch(null);
    setChatIncluded(new Set());
    setChatMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: 'No problem — I discarded those suggestions. Nothing changed.',
      },
    ]);
  }, []);

  // A new (or reopened) document invalidates any in-flight chat turn and proposed batch — reset
  // the whole chat surface so a proposal from one document can never bleed into another. Kept in a
  // callback (rather than inline setState in the effect) so the sync reads as one intentional step.
  const resetChatState = useCallback(() => {
    chatReqRef.current++;
    setChatOpen(false);
    setChatStatus('idle');
    setChatMessages([]);
    setChatBatch(null);
    setChatIncluded(new Set());
  }, []);
  useEffect(() => {
    // Deliberate reset-on-doc-change; fires only on a document switch, so the cascade cost is nil.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    resetChatState();
  }, [doc?.id, resetChatState]);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !dismissed.has(s.id) && !resolved.has(s.id)),
    [suggestions, dismissed, resolved],
  );
  const reviewedCount = suggestions.length - visibleSuggestions.length;

  const fixSuggestion = useCallback(
    (s: Suggestion) => {
      if (!doc) return;
      const block = doc.blocks.find((b) => b.id === s.blockId);
      if (!block) return;
      setActiveSuggestionId(s.id);
      setLastInstruction(s.instruction);
      dispatch({ type: 'SELECT', blockId: s.blockId }); // keeps refineOpen (not a doc click)
      void runEdit(block, s.instruction);
    },
    [doc, runEdit],
  );

  const dismissSuggestion = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const highlightBlock = useCallback((id: string) => {
    setHighlightId(id);
    setTimeout(() => {
      document
        .querySelector(`[data-block-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 20);
    setTimeout(() => setHighlightId(null), 1400);
  }, []);

  const changeItems: ChangeItem[] = useMemo(() => {
    if (!doc) return [];
    return state.history
      .slice(0, state.cursor)
      .map((e) => {
        const blockId = e.op.kind === 'insert' ? e.op.block.id : e.op.blockId;
        const sec = sectionOf(doc, blockId);
        return {
          blockId,
          summary: sec ? `Edited ${sec}` : 'Edited a section',
          when: relTime(e.at),
          rationale: e.rationale,
        };
      })
      .reverse();
  }, [doc, state.history, state.cursor]);

  // Every heading after the first is a section (the first heading is the document title).
  const sectionCount = doc
    ? Math.max(0, doc.blocks.filter((b) => b.type === 'heading').length - 1)
    : 0;
  let statusLeft = 'No proposal open';
  if (view === 'reading') statusLeft = 'Reading your proposal…';
  else if (view === 'editor') {
    if (status === 'thinking') statusLeft = 'Working on it…';
    else if (pending) statusLeft = 'Reviewing a change';
    else if (refineOpen)
      statusLeft = `${visibleSuggestions.length} suggestion${visibleSuggestions.length === 1 ? '' : 's'} to review`;
    else if (selectedId) statusLeft = '1 section selected';
    else statusLeft = `Ready · ${sectionCount} sections`;
  }
  const saved = view === 'editor' && status === 'idle' && !pending && persistOk;

  return (
    <div className="app">
      <Titlebar
        mode={view === 'editor' ? 'editor' : 'backstage'}
        docName={doc?.filename ?? 'Proposal Editor'}
        onHome={view === 'editor' ? goBackstage : undefined}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        undoTip={canUndo(state) ? 'Undo your last change' : 'Nothing to undo yet'}
        redoTip={canRedo(state) ? 'Redo' : 'Nothing to redo yet'}
        chatActive={chatOpen}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onOpenChat={chatOpen ? closeChat : openChat}
        onToggleChanges={() => setShowChanges((v) => !v)}
      />

      {view === 'boot' && <div className="backstage" aria-hidden />}
      {view === 'open' && (
        <OpenScreen
          recents={recents}
          activeId={doc?.id ?? null}
          hasOpenDoc={!!doc}
          onSample={openSample}
          onFile={onFile}
          onOpenRecent={openRecent}
          onRemoveRecent={removeRecent}
          onBackToDoc={backToDoc}
          error={openError}
        />
      )}
      {view === 'reading' && <ReadingScreen />}
      {view === 'editor' && doc && (
        <div className="wbody">
          <div className="docarea">
            {originalAvailable && <DocViewSwitch value={docView} onChange={setDocView} />}
            {docView === 'original' && originalAvailable ? (
              <PageView
                doc={doc}
                selectedId={selectedId}
                pulseId={highlightId ?? state.lastChangedId}
                peekId={peekId}
                editedText={editedText}
                blobUrl={activeBlobUrl}
                onSelect={onSelect}
                onBackgroundClick={deselect}
              />
            ) : (
              <DocumentView
                doc={doc}
                selectedId={selectedId}
                sectionControls={sectionControls}
                onSectionStep={sectionStep}
                pulseId={highlightId ?? state.lastChangedId}
                peekId={peekId}
                onSelect={onSelect}
                onBackgroundClick={deselect}
              />
            )}
          </div>
          {chatOpen ? (
            <ChatPanel
              messages={chatMessages}
              status={chatStatus}
              batch={chatBatch}
              included={chatIncluded}
              onSend={sendChat}
              onToggleInclude={toggleChatInclude}
              onKeepBatch={keepChatBatch}
              onDiscardBatch={discardChatBatch}
              onClose={closeChat}
              onPeek={peekBlock}
            />
          ) : refineOpen && status === 'idle' && !pending ? (
            <RefinePanel
              suggestions={visibleSuggestions}
              reviewedCount={reviewedCount}
              loadingMore={suggestLoading}
              onFix={fixSuggestion}
              onDismiss={dismissSuggestion}
              onGoto={highlightBlock}
              onPeek={peekBlock}
              onClose={closeRefine}
            />
          ) : (
            <EditPanel
              selectedBlock={selectedBlock}
              section={section}
              status={status}
              pending={pending}
              note={note}
              lastInstruction={lastInstruction}
              followUps={followUps}
              refining={refining}
              onAction={handleAction}
              onKeep={onKeep}
              onDiscard={onDiscard}
              onRefine={onRefine}
              onCancel={onCancel}
              onCheck={runScan}
              onBack={refineOpen && activeSuggestionId ? backToSuggestions : undefined}
            />
          )}
        </div>
      )}

      <StatusBar left={statusLeft} saved={saved} />

      {showChanges && view === 'editor' && (
        <ChangesPanel
          items={changeItems}
          onClose={() => setShowChanges(false)}
          onGoto={gotoBlock}
        />
      )}
      {toast && (
        <div className="toast">
          <IconCheck />
          {toast}
        </div>
      )}
      {confirm && (
        <ConfirmModal
          token={confirm.token}
          kind={confirm.kind}
          onYes={confirmYes}
          onNo={confirmNo}
        />
      )}
    </div>
  );
}
