/**
 * The agentic chat pane — the always-available assistant for sweeping, multi-block requests
 * ("make the whole proposal more concise"). It PROPOSES a batch of per-block edits; the user
 * reviews each (reusing DiffBody, the same three-box card as the single-edit loop) and keeps the
 * ones they like. The kept set applies as ONE grouped, undo-able transaction (reducer KEEP_BATCH).
 *
 * Safety: an edit that changes a protected name/number (client-recomputed ∪ the server's warnings)
 * is FLAGGED — shown with a loud banner and left OFF by default, so including it is an explicit act
 * (the batch-appropriate parity with the single-block confirm modal).
 */
'use client';

import { useState } from 'react';
import type { ChatTurn, ProposedEdit } from '@/lib/agent/contract';
import { DiffBody } from './DiffView';
import { IconAssistant, IconCheck, IconShield } from './icons';

/** A proposed edit enriched for review: `flagged` (touches a protected entity) + its section. */
export interface ChatEdit extends ProposedEdit {
  flagged: boolean;
  section: string | null;
}

export interface ChatBatch {
  summary?: string;
  edits: ChatEdit[];
  /** The cursor the batch was proposed against — all edits apply against this one base. */
  baseCursor: number;
  /** The doc.id the batch was proposed against — guards against applying to the wrong proposal. */
  docId: string;
}

const EXAMPLES = [
  'Make the whole proposal more concise',
  'Make the tone more confident',
  'Fix any passive voice',
];

const REFINE_CHIPS = ['Shorter', 'More formal', 'Simpler'];

/**
 * The per-card "tell me how to adjust it" row — the batch-review parity with the single edit's
 * FollowUp. Re-asks the model for just this block's wording and swaps it in place, so reviewing a
 * whole-doc change is a back-and-forth, not a take-it-or-leave-it.
 */
function BatchRefine({
  blockId,
  refining,
  onRefineEdit,
}: {
  blockId: string;
  refining: boolean;
  onRefineEdit: (blockId: string, phrase: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || refining) return;
    onRefineEdit(blockId, t);
    setText('');
  };
  return (
    <div className="bc-refine">
      <div className="bc-refine-lab">Not quite right? Tell me how to adjust this one:</div>
      <div className="fu-row">
        <input
          className="fu-input"
          value={text}
          disabled={refining}
          aria-label="Ask for an adjustment to this change"
          placeholder="e.g. one sentence shorter"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="fu-send" onClick={() => submit()} disabled={refining || !text.trim()}>
          {refining ? 'Adjusting…' : 'Adjust'}
        </button>
      </div>
      <div className="chips">
        {REFINE_CHIPS.map((c) => (
          <button key={c} className="chip" type="button" disabled={refining} onClick={() => submit(c)}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatPanel({
  messages,
  status,
  batch,
  included,
  onSend,
  onToggleInclude,
  onKeepBatch,
  onDiscardBatch,
  onClose,
  onPeek,
  onRefineEdit,
  refiningEdits,
}: {
  messages: ChatTurn[];
  status: 'idle' | 'thinking';
  batch: ChatBatch | null;
  /** blockIds currently included in the batch to keep. */
  included: Set<string>;
  onSend: (message: string) => void;
  onToggleInclude: (blockId: string) => void;
  onKeepBatch: () => void;
  onDiscardBatch: () => void;
  onClose: () => void;
  /** Reveal a block in the document while hovering its batch card. */
  onPeek: (blockId: string | null) => void;
  /** Refine one card's wording in place (the batch parity with the single-edit FollowUp). */
  onRefineEdit: (blockId: string, phrase: string) => void;
  /** blockIds whose card is mid-refine. */
  refiningEdits: Set<string>;
}) {
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  const keptCount = batch ? batch.edits.filter((e) => included.has(e.blockId)).length : 0;

  return (
    <aside className="pane chat">
      <div className="pane-head">
        <div className="pane-ico">
          <IconAssistant />
        </div>
        <div className="pane-h">
          Ask the assistant
          <span className="pane-sub">Change anything across your whole proposal</span>
        </div>
        <button className="pane-x" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>

      <div className="chat-log">
        {messages.length === 0 && !batch && status === 'idle' && (
          <div className="chat-empty">
            <b>Tell me what you’d like to change.</b> I’ll suggest edits across the whole proposal —
            you review each one and keep what you like. I won’t change anything until you say so.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {status === 'thinking' && (
          <div className="chat-msg assistant thinking-msg">
            <div className="tdots">
              <i />
              <i />
              <i />
            </div>
            Reading your proposal and preparing changes…
          </div>
        )}
      </div>

      {batch ? (
        <div className="batch">
          <div className="batch-head">
            <b>
              {batch.summary ??
                `${batch.edits.length} suggested change${batch.edits.length === 1 ? '' : 's'}`}
            </b>
            <span>Keep the ones you like — they apply together, and one Undo reverses the whole set.</span>
          </div>
          {batch.edits.map((e) => {
            const on = included.has(e.blockId);
            return (
              <div
                key={e.blockId}
                className={`batch-card${e.flagged ? ' flagged' : ''}${on ? '' : ' off'}`}
                onMouseEnter={() => onPeek(e.blockId)}
                onMouseLeave={() => onPeek(null)}
              >
                <div className="bc-head">
                  <span className="bc-sec">{e.section ?? 'This section'}</span>
                  <label className="bc-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleInclude(e.blockId)}
                    />
                    {on ? 'Including' : 'Skipped'}
                  </label>
                </div>
                {e.flagged && (
                  <div className="bc-warn">
                    <IconShield />
                    <span>
                      This changes a name or number we usually keep exactly. Turn it on only if
                      you’re sure.
                    </span>
                  </div>
                )}
                <DiffBody before={e.before} after={e.after} protectedKept={e.protectedKept} />
                {on && (
                  <BatchRefine
                    blockId={e.blockId}
                    refining={refiningEdits.has(e.blockId)}
                    onRefineEdit={onRefineEdit}
                  />
                )}
              </div>
            );
          })}
          <div className="batch-actions">
            <button className="btn-keep" disabled={keptCount === 0} onClick={onKeepBatch}>
              <IconCheck />
              Keep {keptCount} change{keptCount === 1 ? '' : 's'}
            </button>
            <button className="btn-discard" onClick={onDiscardBatch}>
              Discard all
            </button>
          </div>
        </div>
      ) : (
        status === 'idle' && (
          <div className="chat-input">
            <textarea
              id="chat-message"
              name="chat-message"
              aria-label="Ask the assistant to change your proposal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="For example: make the whole proposal more concise"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
              }}
            />
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" type="button" onClick={() => setText(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            <button className="btn-cta" onClick={send} style={{ alignSelf: 'flex-start' }}>
              Ask
            </button>
          </div>
        )
      )}
    </aside>
  );
}
