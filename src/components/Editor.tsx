/**
 * The editor — composition of the whole front-end loop (I own the FE per build-plan.md):
 * open → reading → document + Assistant pane → select → ask AI (/api/edit) → review card →
 * Keep/Discard → compose → Undo/Redo, plus the protected-name safety net. State lives in the
 * reducer (src/state/editor.ts); this component owns screen transitions + the async edit flow.
 */
'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Block } from '@/lib/types';
import {
  canRedo,
  canUndo,
  editorReducer,
  initialEditorState,
  sectionOf,
  type Pending,
} from '@/state/editor';
import { parseByHash, parseByUpload, requestEdit } from '@/lib/client';
import { protectedStrings } from '@/lib/entities';
import { isNoChange } from '@/lib/text/diff';
import { DocumentView } from './DocumentView';
import { EditPanel } from './EditPanel';
import { ChangesPanel, StatusBar, Titlebar, type ChangeItem } from './AppChrome';
import { IconCheck, IconFolder, IconShield } from './icons';

type View = 'open' | 'reading' | 'editor';

/** easy.pdf's real sha256 — cache-hits Track A's committed parse seed (the real 76-block Doc). */
const SAMPLE = {
  hash: '03dd3ee8dd7962eb11fd67dd223cfdcdcd0e4f8957aa8622ac24d929cd8c5829',
  filename: 'easy.pdf',
};
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
  onSample: () => void;
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
      <button className="recent" onClick={onSample}>
        <span className="thumb" />
        <span className="rt">
          <b>Statement of Qualifications — City of Dixon</b>
          <span>Sample proposal — open this to try it out</span>
        </span>
      </button>
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

function ConfirmModal({
  token,
  onYes,
  onNo,
}: {
  token: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Change a protected name?">
      <div className="modal">
        <div className="m-body">
          <div className="m-ico">
            <IconShield />
          </div>
          <h3>Change a name we usually keep exactly?</h3>
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

export function Editor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [view, setView] = useState<View>('open');
  const [openError, setOpenError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ token: string; data: Pending } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [lastInstruction, setLastInstruction] = useState('');
  const reqRef = useRef(0);

  const { doc, selectedId, pending, status } = state;
  const selectedBlock = useMemo(
    () => doc?.blocks.find((b) => b.id === selectedId) ?? null,
    [doc, selectedId],
  );
  const section = doc && selectedId ? sectionOf(doc, selectedId) : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view !== 'editor') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
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
  }, [view]);

  const openDoc = useCallback(async (hash: string, filename: string, file?: File) => {
    setOpenError(null);
    setView('reading');
    try {
      const r = await parseByHash(hash, filename);
      // Cache hit → done. Genuine miss (unseen PDF) → upload the bytes for a real parse.
      const doc = 'doc' in r ? r.doc : file ? await parseByUpload(file) : null;
      if (!doc) throw new Error('cache miss with no file to upload');
      dispatch({ type: 'LOAD_DOC', doc });
      setView('editor');
    } catch {
      setView('open');
      setOpenError('Something went wrong reading your proposal. Please try again.');
    }
  }, []);

  const openSample = useCallback(() => openDoc(SAMPLE.hash, SAMPLE.filename), [openDoc]);

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
        dispatch({ type: 'CANCEL_THINKING' });
        setConfirm({ token: protectedChanged[0], data });
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
  }, []);
  const onDiscard = useCallback(() => {
    dispatch({ type: 'DISCARD_PENDING' });
    setNote({ kind: 'info', text: 'No changes made.' });
  }, []);
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
    setNote({ kind: 'info', text: 'No changes made.' });
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
          <DocumentView
            doc={doc}
            selectedId={selectedId}
            pulseId={state.lastChangedId}
            onSelect={onSelect}
          />
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
          />
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
      {confirm && <ConfirmModal token={confirm.token} onYes={confirmYes} onNo={confirmNo} />}
    </div>
  );
}
