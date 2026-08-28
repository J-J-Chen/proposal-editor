/** App chrome — the title bar (Undo/Redo top-left, "Changes you've made"), the status bar, and
 *  the slide-in changes list. The undo/redo arrows sit exactly where a document editor puts them. */
'use client';

import { IconAssistant, IconFolder, IconHistory, IconRedo, IconUndo } from './icons';
import type { GroundedRationale, KbProvenance } from '@/lib/types';

export function Titlebar({
  mode,
  docName,
  onHome,
  canUndo,
  canRedo,
  undoTip,
  redoTip,
  chatActive,
  onUndo,
  onRedo,
  onOpenChat,
  onToggleChanges,
}: {
  /** 'editor' shows the doc controls; 'backstage' (open/reading) shows just the app identity. */
  mode: 'backstage' | 'editor';
  docName: string;
  /** When set (editor view), the leading "Proposals" button returns to the Open/Recent screen. */
  onHome?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoTip: string;
  redoTip: string;
  /** Whether the chat pane is currently open (highlights the button). */
  chatActive: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Opens the always-available agentic chat (multi-block requests). */
  onOpenChat: () => void;
  onToggleChanges: () => void;
}) {
  if (mode !== 'editor') {
    // Backstage / reading — nothing to undo or review yet, so keep the bar to the app identity.
    return (
      <header className="titlebar">
        <span className="tb-brand">
          <IconFolder />
          Proposal Editor
        </span>
        <span className="tb-spacer" />
      </header>
    );
  }
  return (
    <header className="titlebar">
      {onHome && (
        <button className="tbtn tb-home" onClick={onHome} title="Open another proposal">
          <IconFolder />
          Proposals
        </button>
      )}
      <div className="qat">
        <button
          className={`qbtn ${canUndo ? 'active' : ''}`}
          disabled={!canUndo}
          onClick={onUndo}
          title={undoTip}
          aria-label={undoTip}
        >
          <IconUndo />
        </button>
        <button
          className={`qbtn ${canRedo ? 'active' : ''}`}
          disabled={!canRedo}
          onClick={onRedo}
          title={redoTip}
          aria-label={redoTip}
        >
          <IconRedo />
        </button>
      </div>
      <span className="doc-name">{docName}</span>
      <span className="tb-spacer" />
      <button
        className={`tbtn ${chatActive ? 'on' : ''}`}
        onClick={onOpenChat}
        aria-pressed={chatActive}
      >
        <IconAssistant />
        Ask the assistant
      </button>
      <button className="tbtn" onClick={onToggleChanges}>
        <IconHistory />
        Changes you’ve made
      </button>
    </header>
  );
}

export function StatusBar({ left, saved }: { left: string; saved: boolean }) {
  return (
    <footer className="statusbar">
      <span>{left}</span>
      <span className="tb-spacer" />
      {saved && (
        <span className="s-ok">
          <span className="dotg" />
          All changes saved
        </span>
      )}
    </footer>
  );
}

export interface ChangeItem {
  blockId: string;
  /** True for an inserted block that has no location in the immutable Original PDF. */
  documentOnly?: boolean;
  summary: string;
  when: string;
  grounding?: GroundedRationale;
  provenance?: KbProvenance;
}

export function ChangesPanel({
  items,
  onClose,
  onGoto,
}: {
  items: ChangeItem[];
  onClose: () => void;
  onGoto: (blockId: string, documentOnly?: boolean) => void;
}) {
  return (
    <div className="changes" role="dialog" aria-label="Changes you’ve made">
      <div className="changes-head">
        <span>Changes you’ve made</span>
        <button className="x-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {items.length === 0 ? (
        <div className="changes-empty">Your changes will appear here.</div>
      ) : (
        <div className="changes-list">
          {items.map((it, i) => (
            <div className="change-row" key={i}>
              <div>
                <b>{it.summary}</b>
              </div>
              <div className="when">
                {it.when}
              </div>
              {it.grounding && (
                <div className="change-grounding">
                  <span>{it.grounding.reason}</span>
                  <q>{it.grounding.evidence}</q>
                  {it.provenance && (
                    <small>
                      {it.provenance.sourceTitle}, page {it.provenance.page}
                    </small>
                  )}
                </div>
              )}
              <button
                className="btn-quiet"
                style={{ marginTop: 8, padding: '6px 12px', minHeight: 0 }}
                onClick={() => onGoto(it.blockId, it.documentOnly)}
              >
                Go to this section
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
