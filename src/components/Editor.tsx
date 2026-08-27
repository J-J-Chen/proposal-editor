/**
 * The editor — composition of the whole front-end loop (I own the FE per build-plan.md):
 * open → reading → document + Assistant pane → select → ask AI (/api/edit) → review card →
 * Keep/Discard → compose → Undo/Redo, plus the protected-name safety net. State lives in the
 * reducer (src/state/editor.ts); this component owns screen transitions + the async edit flow.
 */
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Block, Doc } from '@/lib/types';
import {
  canRedo,
  canUndo,
  editorReducer,
  initialEditorState,
  sectionOf,
  type Pending,
} from '@/state/editor';
import { parseByHash, parseByUpload, requestEdit, requestSuggestions } from '@/lib/client';
import { extractEntities, protectedStrings, type EntityKind } from '@/lib/entities';
import { isNoChange } from '@/lib/text/diff';
import { DocumentView } from './DocumentView';
import { PageView } from './PageView';
import { EditPanel } from './EditPanel';
import { ChangesPanel, StatusBar, Titlebar, type ChangeItem } from './AppChrome';
import { RefinePanel } from './RefinePanel';
import { scanForRefinements, type Suggestion } from '@/refine/scan';
import { RENDERED } from '@/parse-cache/renders';
import { IconCheck, IconFolder, IconShield } from './icons';

type View = 'open' | 'reading' | 'editor';
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

function relTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
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
  onSample,
  onFile,
  error,
}: {
  onSample: (s: Sample) => void;
  onFile: (f: File) => void;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="backstage">
      <div className="bs-title">Start by opening your proposal</div>
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
      {SAMPLES.map((s) => (
        <button key={s.hash} className="recent" onClick={() => onSample(s)}>
          <span className="thumb" />
          <span className="rt">
            <b>{s.title}</b>
            <span>{s.subtitle}</span>
          </span>
        </button>
      ))}
      {error && (
        <div className="pane-note warn" style={{ maxWidth: 480 }}>
          {error}
        </div>
      )}
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

/** The "Your document | Original PDF" switch over the canvas — plain words, Word-familiar. */
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
        aria-selected={value === 'document'}
        className={value === 'document' ? 'on' : ''}
        onClick={() => onChange('document')}
      >
        Your document
      </button>
      <button
        role="tab"
        aria-selected={value === 'original'}
        className={value === 'original' ? 'on' : ''}
        onClick={() => onChange('original')}
      >
        Original PDF
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
  const [view, setView] = useState<View>('open');
  const [docView, setDocView] = useState<DocView>('document');
  const [openError, setOpenError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ token: string; kind: EntityKind; data: Pending } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [lastInstruction, setLastInstruction] = useState('');
  // Refine ("Check my proposal") state.
  const [refineOpen, setRefineOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const reqRef = useRef(0);
  const suggestReqRef = useRef(0); // guards a stale /api/suggest response from a superseded scan

  const { doc, selectedId, pending, status } = state;
  const selectedBlock = useMemo(
    () => doc?.blocks.find((b) => b.id === selectedId) ?? null,
    [doc, selectedId],
  );
  const section = doc && selectedId ? sectionOf(doc, selectedId) : null;
  // Whether the faithful "Original PDF" view has pages to show (committed renders, or a page count).
  const originalAvailable = doc
    ? (RENDERED[doc.id]?.pages ?? doc.meta?.pages ?? 0) > 0
    : false;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

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

  const openDoc = useCallback(async (hash: string, filename: string, file?: File) => {
    setOpenError(null);
    setView('reading');
    try {
      const r = await parseByHash(hash, filename);
      // Cache hit → done. Genuine miss (unseen PDF) → push bytes to Blob, then parse by URL.
      const doc = 'doc' in r ? r.doc : file ? await parseByUpload(file, hash) : null;
      if (!doc) throw new Error('cache miss with no file to upload');
      dispatch({ type: 'LOAD_DOC', doc });
      setDocView('document'); // always land on the editable surface
      setView('editor');
    } catch {
      setView('open');
      setOpenError('Something went wrong reading your proposal. Please try again.');
    }
  }, []);

  const openSample = useCallback((s: Sample) => openDoc(s.hash, s.filename), [openDoc]);

  const onFile = useCallback(
    async (f: File) => {
      setView('reading');
      const hash = await sha256(f);
      void openDoc(hash, f.name, f);
    },
    [openDoc],
  );

  const onSelect = useCallback((id: string) => {
    reqRef.current++; // cancel any in-flight edit for the previous selection
    setNote(null);
    setConfirm(null);
    setRefineOpen(false); // a direct doc click leaves the Refine list
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
        docContext: { headings, firm: FIRM },
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

      const beforeEnts = protectedStrings(block.text);
      const protectedKept = beforeEnts.filter((s) => after.includes(s));
      const protectedChanged = beforeEnts.filter((s) => !after.includes(s));
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
    dispatch({ type: 'KEEP_PENDING' });
    setToast('Change saved. You can Undo if you change your mind.');
    if (activeSuggestionId) {
      // Resolve this suggestion and return cleanly to the list (the kept block still pulses).
      setResolved((prev) => new Set(prev).add(activeSuggestionId));
      setActiveSuggestionId(null);
      setPeekId(null);
      dispatch({ type: 'SELECT', blockId: null });
    }
  }, [activeSuggestionId]);
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
  const saved = view === 'editor' && status === 'idle' && !pending;

  return (
    <div className="app">
      <Titlebar
        docName={doc?.filename ?? 'Proposal Editor'}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        undoTip={canUndo(state) ? 'Undo your last change' : 'Nothing to undo yet'}
        redoTip={canRedo(state) ? 'Redo' : 'Nothing to redo yet'}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onToggleChanges={() => setShowChanges((v) => !v)}
      />

      {view === 'open' && (
        <OpenScreen onSample={openSample} onFile={onFile} error={openError} />
      )}
      {view === 'reading' && <ReadingScreen />}
      {view === 'editor' && doc && (
        <div className="wbody">
          <div className="docarea">
            {originalAvailable && <DocViewSwitch value={docView} onChange={setDocView} />}
            {docView === 'original' ? (
              <PageView doc={doc} />
            ) : (
              <DocumentView
                doc={doc}
                selectedId={selectedId}
                pulseId={highlightId ?? state.lastChangedId}
                peekId={peekId}
                onSelect={onSelect}
                onBackgroundClick={deselect}
              />
            )}
          </div>
          {refineOpen && status === 'idle' && !pending ? (
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
              onAction={handleAction}
              onKeep={onKeep}
              onDiscard={onDiscard}
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
