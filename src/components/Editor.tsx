/**
 * The editor — composition of the whole front-end loop (I own the FE per build-plan.md):
 * open → reading → document + Assistant pane → select → ask AI (/api/edit) → review card →
 * Keep/Discard → compose → Undo/Redo, plus the protected-name safety net. State lives in the
 * reducer (src/state/editor.ts); this component owns screen transitions + the async edit flow.
 */
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Block, Doc, GroundedRationale, HistoryEntry, KbProvenance } from '@/lib/types';
import type { DocumentContext, KbCandidate } from '@/lib/contracts';
import {
  canRedo,
  canKeepPending,
  canUndo,
  editorReducer,
  initialEditorState,
  sectionOf,
  type Pending,
} from '@/state/editor';
import {
  parseByHash,
  parseByUpload,
  parseByBlobUrl,
  requestEdit,
  requestKbCompose,
  requestKbSearch,
  requestSuggestions,
} from '@/lib/client';
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
import { SimilarExperiencePanel } from './SimilarExperiencePanel';
import { ChangesPanel, StatusBar, Titlebar, type ChangeItem } from './AppChrome';
import { RefinePanel } from './RefinePanel';
import { ChatPanel, type ChatBatch, type ChatEdit } from './ChatPanel';
import { scanForRefinements, type Suggestion } from '@/refine/scan';
import { requestChat } from '@/lib/agent/client';
import type { ChatTurn } from '@/lib/agent/contract';
import { RENDERED } from '@/parse-cache/renders';
import { IconAssistant, IconCheck, IconFolder, IconSearch, IconShield } from './icons';

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

/** Sample nearby, substantive prose so every writing path can match the open document's voice. */
function voiceSamplesFor(doc: Doc, targetId?: string | null): string[] {
  const targetIndex = targetId ? doc.blocks.findIndex((block) => block.id === targetId) : -1;
  const prose = doc.blocks
    .map((block, index) => ({ block, index }))
    .filter(
      ({ block }) =>
        block.text.trim().length >= 60 &&
        (block.type === 'paragraph' || block.type === 'list-item' || block.type === 'caption'),
    )
    .sort((a, b) => {
      if (targetIndex < 0) return a.index - b.index;
      const aTarget = a.block.id === targetId ? 1 : 0;
      const bTarget = b.block.id === targetId ? 1 : 0;
      return aTarget - bTarget || Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex);
    });

  return prose.slice(0, 4).map(({ block }) => {
    const clean = block.text.trim().replace(/\s+/g, ' ');
    return clean.length > 600 ? `${clean.slice(0, 600).trimEnd()}…` : clean;
  });
}

/**
 * Where a document-scoped "Add similar experience" (no paragraph selected) inserts. Appends at the
 * END of the "Relevant Experience"/Experience section — the block just before the next heading — so
 * a new experience paragraph joins the existing ones; falls back to the end of the document when
 * there's no such heading. Returns the anchor Block (its id is the insert's afterId; its text/type
 * give the compose route nearby context). Heading match is loose: a heading whose text
 * case-insensitively contains "experience".
 */
function resolveInsertTarget(doc: Doc): Block {
  const blocks = doc.blocks;
  const headingIdx = blocks.findIndex((b) => b.type === 'heading' && /experience/i.test(b.text));
  if (headingIdx !== -1) {
    let end = headingIdx;
    for (let i = headingIdx + 1; i < blocks.length; i++) {
      if (blocks[i].type === 'heading') break;
      end = i;
    }
    return blocks[end];
  }
  return blocks[blocks.length - 1];
}

function documentContext(doc: Doc, targetId?: string | null): DocumentContext {
  return {
    docId: doc.id,
    headings: doc.blocks.filter((block) => block.type === 'heading').map((block) => block.text),
    firm: firmFor(doc.id),
    voiceSamples: voiceSamplesFor(doc, targetId),
    // Resolver-only applicability signal. This is never copied into a prompt; it lets an uploaded
    // MECO proposal resolve the same profile as a bundled one even when the selected block omits
    // the firm name.
    docText: doc.blocks
      .map((block) => block.text)
      .join('\n')
      .slice(0, 50_000),
  };
}

/**
 * Build the instruction for a follow-up refine turn. The block we send is the CURRENT draft
 * (so "shorter" shortens the latest wording, not the original), but we hand the model the
 * original text as reference so an ask like "put the client name back" can still restore
 * something an earlier turn dropped. The entity guardrail (system prompt + client gate) does
 * the heavy lifting; this just frames the turn.
 */
function composeRefineInstruction(phrase: string): string {
  return (
    `This is a follow-up refinement of an edit already under review. Apply this change to the ` +
    `current draft below, changing only what it asks and keeping the rest of the draft: ${phrase}. ` +
    `The original wording is supplied separately as untrusted reference data.`
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

/** A short, single-line echo of a block's text — for the scope bar / headers. */
function echoText(text: string, max = 40): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Which tab of the assistant pane is showing. Suggestions is the onboarding-first default. */
type AsstTab = 'suggestions' | 'ask';

/**
 * The two-tab header of the assistant pane. Suggestions (amber "attention" identity) is where a
 * proposal opens — the high-confidence fixes to review first; Ask for a change (teal) is the
 * conversational surface. One persistent pane, two clearly-different jobs.
 */
function AsstTabs({
  active,
  suggestionCount,
  onSuggestions,
  onAsk,
}: {
  active: AsstTab;
  suggestionCount: number;
  onSuggestions: () => void;
  onAsk: () => void;
}) {
  return (
    <div className="asst-tabs" role="tablist" aria-label="Assistant">
      <button
        role="tab"
        aria-selected={active === 'suggestions'}
        className={`asst-tab sug${active === 'suggestions' ? ' on' : ''}`}
        onClick={onSuggestions}
      >
        <IconSearch />
        Suggestions
        {suggestionCount > 0 && <span className="asst-count">{suggestionCount}</span>}
      </button>
      <button
        role="tab"
        aria-selected={active === 'ask'}
        className={`asst-tab ask${active === 'ask' ? ' on' : ''}`}
        onClick={onAsk}
      >
        <IconAssistant />
        Ask for a change
      </button>
    </div>
  );
}

/**
 * The scope bar sits above the Ask composer and says — loudly — what the next request will touch.
 * Selection IS the scope: a paragraph selected → edit just it; nothing selected → the whole
 * proposal. Making the scope unmistakable is the make-or-break for a single conversational box.
 */
function ScopeBar({
  selectedBlock,
  onClear,
}: {
  selectedBlock: Block | null;
  onClear: () => void;
}) {
  if (selectedBlock) {
    return (
      <div className="scopebar para">
        <span className="sb-ico" aria-hidden="true">
          ¶
        </span>
        <span className="sb-txt">
          Editing <b>just this paragraph</b>
        </span>
        <span className="sb-ex">“{echoText(selectedBlock.text, 30)}”</span>
        <button className="sb-x" onClick={onClear}>
          × whole proposal
        </button>
      </div>
    );
  }
  return (
    <div className="scopebar whole">
      <span className="sb-ico" aria-hidden="true">
        ▤
      </span>
      <span className="sb-txt">
        Editing the <b>whole proposal</b>
      </span>
      <span className="sb-hint">· click any paragraph to focus on one part</span>
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
  // Which assistant tab is showing. Suggestions is the onboarding-first default (set when a doc
  // opens); Ask is the conversational surface. Replaces the old mutually-exclusive pane flags as
  // the top-level right-pane router.
  const [activeTab, setActiveTab] = useState<AsstTab>('suggestions');
  const scannedDocRef = useRef<string | null>(null); // guards the one-time onboarding scan per doc
  const [lastInstruction, setLastInstruction] = useState('');
  // Follow-up conversation on the pending proposal: the asks made so far (the review thread) and
  // whether an adjustment is in flight. Distinct from status:'thinking' so the diff card stays up.
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  // Tracks which block the follow-up thread belongs to, so we can reset it when the proposal
  // under review changes block or clears (see the render-time guard below).
  const [threadBlockId, setThreadBlockId] = useState<string | null>(null);
  // Suggestions ("things to fix") state — shown in the Suggestions tab.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Candidate-first KB flow. Search results are shown before compose; composed prose becomes a
  // Pending insert and cannot reach the document until the ordinary Keep action runs.
  const [similarOpen, setSimilarOpen] = useState(false);
  const [kbCandidates, setKbCandidates] = useState<KbCandidate[]>([]);
  const [kbStatus, setKbStatus] = useState<'idle' | 'searching' | 'composing'>('idle');
  const [kbError, setKbError] = useState<string | null>(null);
  const [kbPicked, setKbPicked] = useState<string | null>(null);
  // Ask-for-a-change (whole-proposal chat) state.
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([]);
  const [chatStatus, setChatStatus] = useState<'idle' | 'thinking'>('idle');
  const [chatBatch, setChatBatch] = useState<ChatBatch | null>(null);
  const [chatIncluded, setChatIncluded] = useState<Set<string>>(new Set());
  // blockIds whose batch card is mid-refine (a "tell me how to adjust it" ask is in flight), so
  // every review card — single OR batch — supports the same back-and-forth.
  const [chatRefining, setChatRefining] = useState<Set<string>>(new Set());
  const reqRef = useRef(0);
  const suggestReqRef = useRef(0); // guards a stale /api/suggest response from a superseded scan
  const chatReqRef = useRef(0); // guards a stale /api/chat response from a superseded turn
  const kbReqRef = useRef(0); // guards stale search/compose responses and document switches
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
  // "Add similar experience" is document-scoped: with a paragraph selected it anchors after that
  // block; with nothing selected it anchors at the end of the Experience section (else end of doc).
  const similarTarget = doc ? (selectedBlock ?? resolveInsertTarget(doc)) : null;
  const similarSection =
    doc && similarTarget ? (selectedBlock ? section : sectionOf(doc, similarTarget.id)) : null;
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
    if (!doc || kbStatus !== 'idle' || refining) return m;
    const touched = new Set<string>();
    for (let i = 0; i < state.cursor; i++) {
      const op = state.history[i].op;
      // Structural insertions use global Undo/Redo. Only actual rewrites have a meaningful
      // original/edited pair for this per-section toggle.
      if (op.kind === 'replace') touched.add(op.blockId);
    }
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
  }, [doc, originalBaseline, state.history, state.cursor, state.pending, kbStatus, refining]);

  const sectionStep = useCallback(
    (blockId: string) => {
      if (kbStatus !== 'idle' || refining) return;
      dispatch({ type: 'SECTION_STEP', blockId });
    },
    [kbStatus, refining],
  );

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
    kbReqRef.current++;
    setSimilarOpen(false);
    setKbStatus('idle');
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
        if (kbStatus !== 'idle' || refining) return;
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (kbStatus !== 'idle' || refining) return;
        dispatch({ type: 'REDO' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, deselect, kbStatus, refining]);

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
    kbReqRef.current++; // …and any experience search/compose request
    setSimilarOpen(false);
    setKbStatus('idle');
    setOpenError(null);
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
    kbReqRef.current++; // cancel any experience request for the previous selection
    setSimilarOpen(false);
    setKbStatus('idle');
    setKbCandidates([]);
    setKbPicked(null);
    setKbError(null);
    setNote(null);
    setConfirm(null);
    setActiveSuggestionId(null); // …so a later Keep isn't misattributed to a stale suggestion
    setPeekId(null);
    setActiveTab('ask'); // intent override: clicking a paragraph goes straight to Ask, scoped to it
    dispatch({ type: 'SELECT', blockId: id });
  }, []);

  const runEdit = useCallback(
    async (block: Block, instruction: string, grounding?: GroundedRationale) => {
      setNote(null);
      setConfirm(null);
      const myReq = ++reqRef.current;
      const baseCursor = state.cursor;
      dispatch({ type: 'START_THINKING' });

      const result = await requestEdit({
        block: { id: block.id, text: block.text, type: block.type },
        instruction,
        docContext: doc ? documentContext(doc, block.id) : undefined,
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
        changeSummary: result.res.changeSummary ?? result.res.rationale,
        grounding,
        protectedKept,
        baseCursor,
        docId: doc?.id,
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

  const openSimilar = useCallback(() => {
    if (!doc) return; // document-scoped: available with or without a paragraph selected
    reqRef.current++;
    chatReqRef.current++;
    setActiveSuggestionId(null);
    setPeekId(null);
    setNote(null);
    setConfirm(null);
    setKbCandidates([]);
    setKbError(null);
    setKbPicked(null);
    setKbStatus('idle');
    setSimilarOpen(true);
  }, [doc]);

  const closeSimilar = useCallback(() => {
    kbReqRef.current++;
    setSimilarOpen(false);
    setKbStatus('idle');
    setKbCandidates([]);
    setKbError(null);
    setKbPicked(null);
  }, []);

  const searchSimilar = useCallback(
    async (query: string) => {
      if (!doc) return;
      const myReq = ++kbReqRef.current;
      setKbStatus('searching');
      setKbError(null);
      setKbPicked(null);
      setKbCandidates([]);
      const result = await requestKbSearch({
        query,
        k: 5,
        docId: doc.id,
        excludeSourceDoc: doc.filename,
      });
      if (myReq !== kbReqRef.current) return;
      setKbStatus('idle');
      if (!result.ok) {
        setKbError(result.message);
        return;
      }
      // Normalize optional legacy fields at the browser boundary, while retaining the server's
      // opaque candidate id for the compose request.
      const found = result.res.candidates
        .map((candidate) => ({
          ...candidate,
          candidateId: candidate.candidateId || candidate.snippetId || '',
          sourceTitle: candidate.sourceTitle || candidate.title,
          quote: candidate.quote || candidate.text,
          discipline: candidate.discipline || 'Past experience',
        }))
        .filter((candidate) => candidate.candidateId);
      setKbCandidates(found);
      if (found.length === 0) {
        setKbError('No matching past projects found. Try a different project type or service.');
      }
    },
    [doc],
  );

  const chooseSimilar = useCallback(
    async (candidate: KbCandidate) => {
      if (!doc || kbStatus !== 'idle') return;
      // Doc-scoped when nothing is selected: anchor at the end of the Experience section.
      const target = selectedBlock ?? resolveInsertTarget(doc);
      const baseCursor = state.cursor;
      const myReq = ++kbReqRef.current;
      setKbPicked(candidate.candidateId);
      setKbStatus('composing');
      setKbError(null);

      // Deliberately send only the opaque id, never client-supplied source text. The server resolves
      // it back to the trusted corpus record before composing.
      const result = await requestKbCompose({
        candidateId: candidate.candidateId,
        target: {
          id: target.id,
          text: target.text,
          type: target.type,
          page: target.page,
        },
        docContext: documentContext(doc, target.id),
      });
      if (myReq !== kbReqRef.current) return;
      setKbStatus('idle');
      if (!result.ok) {
        setKbError(result.message);
        setKbPicked(null);
        return;
      }

      const newText = result.res.newText.trim();
      if (!newText) {
        setKbError('That project could not be prepared. Choose another result.');
        setKbPicked(null);
        return;
      }
      const returnedCandidate = result.res.candidate ?? candidate;
      const supplied = result.res.provenance as Partial<KbProvenance> | undefined;
      const fallbackUsed = Boolean(result.res.fallbackUsed || supplied?.fallbackUsed);
      const provenance: KbProvenance = {
        candidateId: supplied?.candidateId || returnedCandidate.candidateId || candidate.candidateId,
        title: supplied?.title || returnedCandidate.title || candidate.title,
        sourceDoc: supplied?.sourceDoc || returnedCandidate.sourceDoc || candidate.sourceDoc,
        sourceTitle:
          supplied?.sourceTitle ||
          returnedCandidate.sourceTitle ||
          candidate.sourceTitle ||
          candidate.title,
        page: supplied?.page || returnedCandidate.page || candidate.page,
        quote:
          supplied?.quote ||
          returnedCandidate.quote ||
          returnedCandidate.text ||
          candidate.quote ||
          candidate.text,
        discipline:
          supplied?.discipline || returnedCandidate.discipline || candidate.discipline || 'Experience',
        fallbackUsed,
      };
      const block: Block = {
        id: `kb-${crypto.randomUUID()}`,
        type: 'paragraph',
        text: newText,
        page: target.page,
        provenance,
      };
      const pendingInsert: Pending = {
        blockId: target.id,
        before: '',
        after: newText,
        instruction: `Add similar experience: ${provenance.title}`,
        changeSummary: `Added similar experience: ${provenance.title}`,
        grounding: {
          reason: 'This paragraph uses the past project you reviewed and chose before generation.',
          evidence: provenance.quote,
          provenance,
        },
        source: 'kb',
        insert: { afterId: target.id, block, provenance },
        protectedKept: protectedStrings(provenance.quote).filter((value) => newText.includes(value)),
        baseCursor,
        docId: doc.id,
      };
      setSimilarOpen(false);
      setKbCandidates([]);
      setKbPicked(null);
      setLastInstruction(pendingInsert.instruction);
      dispatch({ type: 'SET_PENDING', pending: pendingInsert });
    },
    [doc, selectedBlock, kbStatus, state.cursor],
  );

  const onKeep = useCallback(() => {
    // A review decision supersedes any follow-up request that was still settling. This guard is
    // also safe when no request is active and prevents a late response from resurrecting Pending.
    reqRef.current++;
    setRefining(false);
    if (!canKeepPending(state)) {
      dispatch({ type: 'KEEP_PENDING' }); // clears the stale proposal through the reducer guard
      setNote({
        kind: 'warn',
        text: 'This suggestion no longer matches the current document. Nothing was changed.',
      });
      return;
    }
    const changedId = pending?.insert?.block.id ?? pending?.blockId;
    const addingExperience = Boolean(pending?.insert);
    dispatch({ type: 'KEEP_PENDING' });
    setToast(
      addingExperience
        ? 'Experience added. You can Undo if you change your mind.'
        : 'Change saved. You can Undo if you change your mind.',
    );
    if (addingExperience) setDocView('document');
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
  }, [activeSuggestionId, pending, state]);
  const onDiscard = useCallback(() => {
    reqRef.current++;
    setRefining(false);
    const addingExperience = Boolean(pending?.insert);
    dispatch({ type: 'DISCARD_PENDING' });
    if (activeSuggestionId) {
      // Leave the suggestion in the list (not resolved) and go back to it.
      setActiveSuggestionId(null);
      setPeekId(null);
      dispatch({ type: 'SELECT', blockId: null });
    } else {
      setNote({ kind: 'info', text: addingExperience ? 'No experience added.' : 'No changes made.' });
    }
  }, [activeSuggestionId, pending]);
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
      // KB prose is reviewed as an attributable whole-paragraph insertion. A follow-up rewrite
      // would blur that provenance, so the insert review intentionally offers Keep/Discard only.
      if (!p || p.insert || !doc || !text || refining) return;
      const type = doc.blocks.find((b) => b.id === p.blockId)?.type ?? 'paragraph';
      setNote(null);
      setConfirm(null);
      const myReq = ++reqRef.current; // shares the stale-guard with runEdit/onSelect/onCancel
      setRefining(true);
      setFollowUps((prev) => [...prev, text]);

      const result = await requestEdit({
        block: { id: p.blockId, text: p.after, type }, // iterate on the CURRENT draft
        instruction: composeRefineInstruction(text),
        // The original block travels in a separately labeled reference field. Only the human's
        // raw follow-up may authorize a factual mutation at the server gate.
        authoritativeInstruction: text,
        referenceText: p.before,
        docContext: documentContext(doc, p.blockId),
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
        changeSummary: result.res.changeSummary ?? result.res.rationale ?? p.changeSummary,
        grounding: p.grounding,
        source: p.source,
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

  const gotoBlock = useCallback(
    (id: string, documentOnly = false) => {
      setShowChanges(false);
      if (documentOnly || doc?.blocks.find((block) => block.id === id)?.provenance) {
        // Inserted KB blocks do not exist on the immutable Original PDF raster. Reveal them in the
        // live document when navigating from the audit trail.
        setDocView('document');
      }
      // Reuse the normal selection boundary so an experience response anchored to the previous
      // section cannot arrive after navigation and open a stale insert review.
      onSelect(id);
      setTimeout(() => {
        document
          .querySelector(`[data-block-id="${id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 30);
    },
    [doc, onSelect],
  );

  // ---- Suggestions (the onboarding-first "things to fix" pass) ----
  // Populate the Suggestions tab: the instant, no-spend deterministic client scan shows first,
  // then the LLM editorial pass merges in when it returns (any failure degrades silently to []).
  // Pane-routing lives in the tab bar now, so this only owns the suggestion data. Returns the count
  // of instant (grounded) fixes so the caller can decide the landing tab.
  const scanNow = useCallback((d: Doc): number => {
    kbReqRef.current++;
    const clientScan = scanForRefinements(d);
    setSuggestions(clientScan);
    setDismissed(new Set());
    setResolved(new Set());
    setActiveSuggestionId(null);
    setPeekId(null);
    const myReq = ++suggestReqRef.current;
    setSuggestLoading(true);
    void requestSuggestions(d, documentContext(d)).then((server) => {
      if (myReq !== suggestReqRef.current) return; // a newer scan (or close) superseded this one
      if (server.length) setSuggestions((prev) => mergeSuggestions(d, prev, server));
      setSuggestLoading(false);
    });
    return clientScan.length;
  }, []);

  // Re-run the scan on demand (kept for the EditPanel rest-state CTA) and show the Suggestions tab.
  const runScan = useCallback(() => {
    if (!doc) return;
    scanNow(doc);
    setActiveTab('suggestions');
  }, [doc, scanNow]);

  // Onboarding-first: when a proposal opens, scan it once and land on Suggestions if there are
  // high-confidence fixes to review; a clean document opens straight on Ask for a change.
  useEffect(() => {
    if (view !== 'editor' || !doc) return;
    if (scannedDocRef.current === doc.id) return;
    scannedDocRef.current = doc.id;
    const grounded = scanNow(doc);
    setActiveTab(grounded > 0 ? 'suggestions' : 'ask');
  }, [view, doc, scanNow]);

  const showSuggestions = useCallback(() => setActiveTab('suggestions'), []);
  const showAsk = useCallback(() => setActiveTab('ask'), []);

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

  // ---- Ask for a change, whole-proposal (the Titlebar shortcut deselects → whole-doc chat) ----
  const openChat = useCallback(() => {
    reqRef.current++;
    kbReqRef.current++;
    setSimilarOpen(false);
    setKbStatus('idle');
    setActiveSuggestionId(null);
    setPeekId(null);
    setNote(null);
    setConfirm(null);
    dispatch({ type: 'SELECT', blockId: null }); // no selection → the whole proposal is the scope
    setActiveTab('ask');
  }, []);

  const closeChat = useCallback(() => {
    chatReqRef.current++; // drop any in-flight turn
    setChatStatus('idle');
    setPeekId(null);
    setActiveTab('suggestions');
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
        docContext: documentContext(doc, selectedId),
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
      changeSummary: e.changeSummary ?? e.rationale,
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
    setChatRefining(new Set());
    setChatMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: 'No problem — I discarded those suggestions. Nothing changed.',
      },
    ]);
  }, []);

  // Back-and-forth on ONE card of the whole-doc batch: re-ask /api/edit on that block's current
  // draft and swap the new wording in place, so a batch review is a conversation too — parity with
  // the single-block FollowUp. Gated against the ORIGINAL `before` so entity drift can't accrue.
  const refineChatEdit = useCallback(
    async (blockId: string, phrase: string) => {
      const text = phrase.trim();
      if (!doc || !chatBatch || !text || chatRefining.has(blockId)) return;
      const edit = chatBatch.edits.find((e) => e.blockId === blockId);
      if (!edit) return;
      const type = doc.blocks.find((b) => b.id === blockId)?.type ?? 'paragraph';
      const batchDocId = chatBatch.docId;
      setChatRefining((prev) => new Set(prev).add(blockId));
      const result = await requestEdit({
        block: { id: blockId, text: edit.after, type }, // iterate on the current draft
        instruction: composeRefineInstruction(text),
        authoritativeInstruction: text,
        referenceText: edit.before,
        docContext: documentContext(doc, blockId),
      });
      setChatRefining((prev) => {
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
      if (!result.ok) return; // leave the card as-is so the review isn't lost
      const after = result.res.newText;
      if (isNoChange(edit.after, after)) return;
      const changed = droppedEntities(edit.before, after); // gate vs the pinned original
      const flagged = changed.length > 0;
      const changedSet = new Set(changed);
      const protectedKept = protectedStrings(edit.before).filter((s) => !changedSet.has(s));
      setChatBatch((prev) => {
        if (!prev || prev.docId !== batchDocId) return prev; // superseded by a new turn / doc switch
        return {
          ...prev,
          edits: prev.edits.map((e) =>
            e.blockId === blockId
              ? {
                  ...e,
                  after,
                  protectedKept,
                  flagged,
                  changeSummary: result.res.changeSummary ?? e.changeSummary,
                }
              : e,
          ),
        };
      });
      // If a refine newly touches a protected fact, drop it from the kept set (default-off parity).
      if (flagged) {
        setChatIncluded((prev) => {
          const next = new Set(prev);
          next.delete(blockId);
          return next;
        });
      }
    },
    [doc, chatBatch, chatRefining],
  );

  // A new (or reopened) document invalidates any in-flight chat turn and proposed batch — reset
  // the whole chat surface so a proposal from one document can never bleed into another. Kept in a
  // callback (rather than inline setState in the effect) so the sync reads as one intentional step.
  const resetChatState = useCallback(() => {
    chatReqRef.current++;
    kbReqRef.current++;
    setChatStatus('idle');
    setChatMessages([]);
    setChatBatch(null);
    setChatIncluded(new Set());
    setChatRefining(new Set());
    setSimilarOpen(false);
    setKbStatus('idle');
    setKbCandidates([]);
    setKbPicked(null);
    setKbError(null);
  }, []);
  useEffect(() => {
    // Deliberate reset-on-doc-change; fires only on a document switch, so the cascade cost is nil.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    resetChatState();
  }, [doc?.id, resetChatState]);

  // Every visible recommendation must still quote the current block verbatim. This also protects
  // against a late server scan that was grounded against the pre-edit document.
  const freshSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) => {
        const block = doc?.blocks.find((item) => item.id === suggestion.blockId);
        return Boolean(block && block.text.includes(suggestion.evidence));
      }),
    [suggestions, doc],
  );
  const visibleSuggestions = useMemo(
    () => freshSuggestions.filter((s) => !dismissed.has(s.id) && !resolved.has(s.id)),
    [freshSuggestions, dismissed, resolved],
  );
  const reviewedCount = freshSuggestions.length - visibleSuggestions.length;

  const fixSuggestion = useCallback(
    (s: Suggestion) => {
      if (!doc) return;
      const block = doc.blocks.find((b) => b.id === s.blockId);
      if (!block || !block.text.includes(s.evidence)) {
        // A click can race the render that filters stale recommendations after a Keep.
        setSuggestions((previous) => previous.filter((item) => item.id !== s.id));
        return;
      }
      setActiveSuggestionId(s.id);
      setLastInstruction(s.instruction);
      dispatch({ type: 'SELECT', blockId: s.blockId }); // keeps refineOpen (not a doc click)
      void runEdit(block, s.instruction, { reason: s.why, evidence: s.evidence });
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
    const liveHistory = state.history.slice(0, state.cursor);
    const insertedIds = new Set(
      liveHistory
        .filter((entry) => entry.op.kind === 'insert')
        .map((entry) => (entry.op.kind === 'insert' ? entry.op.block.id : '')),
    );
    return liveHistory
      .map((e) => {
        const blockId = e.op.kind === 'insert' ? e.op.block.id : e.op.blockId;
        const sec = sectionOf(doc, blockId);
        return {
          blockId,
          documentOnly: insertedIds.has(blockId),
          summary:
            e.changeSummary ??
            e.rationale ??
            (e.source === 'kb'
              ? `Added experience${sec ? ` to ${sec}` : ''}`
              : sec
                ? `Edited ${sec}`
                : 'Edited a section'),
          when: relTime(e.at),
          grounding: e.grounding,
          provenance: e.provenance,
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
    else if (similarOpen && kbStatus === 'searching') statusLeft = 'Searching past proposals…';
    else if (similarOpen && kbStatus === 'composing') statusLeft = 'Preparing experience…';
    else if (similarOpen) statusLeft = 'Choosing past experience';
    else if (activeTab === 'suggestions')
      statusLeft = `${visibleSuggestions.length} suggestion${visibleSuggestions.length === 1 ? '' : 's'} to review`;
    else if (selectedId) statusLeft = 'Editing one paragraph';
    else statusLeft = `Editing the whole proposal · ${sectionCount} sections`;
  }
  const saved = view === 'editor' && status === 'idle' && !pending && persistOk;

  return (
    <div className="app">
      <Titlebar
        mode={view === 'editor' ? 'editor' : 'backstage'}
        docName={doc?.filename ?? 'Proposal Editor'}
        onHome={view === 'editor' ? goBackstage : undefined}
        canUndo={kbStatus === 'idle' && !refining && canUndo(state)}
        canRedo={kbStatus === 'idle' && !refining && canRedo(state)}
        undoTip={
          kbStatus !== 'idle' || refining
            ? refining
              ? 'Finish the current draft first'
              : 'Finish preparing the experience first'
            : canUndo(state)
              ? 'Undo your last change'
              : 'Nothing to undo yet'
        }
        redoTip={
          kbStatus !== 'idle' || refining
            ? 'Finish the current draft first'
            : canRedo(state)
              ? 'Redo'
              : 'Nothing to redo yet'
        }
        chatActive={activeTab === 'ask'}
        onUndo={() => {
          if (kbStatus === 'idle' && !refining) dispatch({ type: 'UNDO' });
        }}
        onRedo={() => {
          if (kbStatus === 'idle' && !refining) dispatch({ type: 'REDO' });
        }}
        onOpenChat={activeTab === 'ask' ? closeChat : openChat}
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
          <div className={`asst-col ${activeTab}`}>
            <AsstTabs
              active={activeTab}
              suggestionCount={visibleSuggestions.length}
              onSuggestions={showSuggestions}
              onAsk={showAsk}
            />
            {activeTab === 'suggestions' ? (
              // ---- Suggestions tab: the onboarding-first list, or an inline review card while
              // fixing one (the SAME calm card + back-and-forth refine as everywhere else). ----
              activeSuggestionId && (status === 'thinking' || pending) ? (
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
                  onBack={backToSuggestions}
                />
              ) : (
                <RefinePanel
                  suggestions={visibleSuggestions}
                  reviewedCount={reviewedCount}
                  loadingMore={suggestLoading}
                  onFix={fixSuggestion}
                  onDismiss={dismissSuggestion}
                  onGoto={highlightBlock}
                  onPeek={peekBlock}
                  onClose={showAsk}
                />
              )
            ) : (
              // ---- Ask for a change tab: one conversational surface, selection = scope. ----
              <>
                <ScopeBar selectedBlock={selectedBlock} onClear={deselect} />
                {similarOpen && similarTarget && status === 'idle' && !pending ? (
                  <SimilarExperiencePanel
                    target={similarTarget}
                    section={similarSection}
                    candidates={kbCandidates}
                    status={kbStatus}
                    selectedCandidateId={kbPicked}
                    error={kbError}
                    onSearch={searchSimilar}
                    onChoose={chooseSimilar}
                    onBack={closeSimilar}
                  />
                ) : pending || selectedBlock ? (
                  // `pending ||` so a doc-scoped insert (no selection) still reaches EditPanel's
                  // review card; EditPanel renders `pending` ahead of its no-selection guard. The
                  // header shows the anchor section ("After: RELEVANT EXPERIENCE") when unselected.
                  <EditPanel
                    selectedBlock={selectedBlock}
                    section={selectedBlock ? section : similarSection}
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
                  />
                ) : (
                  <ChatPanel
                    messages={chatMessages}
                    status={chatStatus}
                    batch={chatBatch}
                    included={chatIncluded}
                    onSend={sendChat}
                    onSimilar={openSimilar}
                    onToggleInclude={toggleChatInclude}
                    onKeepBatch={keepChatBatch}
                    onDiscardBatch={discardChatBatch}
                    onClose={showSuggestions}
                    onPeek={peekBlock}
                    onRefineEdit={refineChatEdit}
                    refiningEdits={chatRefining}
                  />
                )}
              </>
            )}
          </div>
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
