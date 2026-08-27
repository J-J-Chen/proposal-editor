/**
 * Track D — the right-hand Assistant pane. The single home for every AI moment: at rest it
 * invites a click; with a section selected it offers the quick actions + a free-text ask; while
 * working it shows a calm "writing a suggestion…"; and it hosts the review card (DiffView).
 * The header always names the current step, so the app always answers "what do I do next?".
 */
'use client';

import { useState } from 'react';
import type { Block } from '@/lib/types';
import type { Pending } from '@/state/editor';
import { DiffView } from './DiffView';
import {
  IconAssistant,
  IconFixNames,
  IconFormal,
  IconRewrite,
  IconSearch,
  IconShield,
  IconShorter,
} from './icons';

const QUICK_ACTIONS = [
  { instruction: 'Rewrite this', desc: 'Say it in a fresh way', Icon: IconRewrite },
  { instruction: 'Make it shorter', desc: 'Same meaning, fewer words', Icon: IconShorter },
  { instruction: 'Fix names and spelling', desc: 'Check names and numbers are right', Icon: IconFixNames },
  { instruction: 'Make it more formal', desc: 'Change how it sounds', Icon: IconFormal },
] as const;

// Examples must never invite the model to invent facts (no "add our bridge experience" — there's
// no KB behind it, so it would fabricate). These only reshape the block's own words.
const EXAMPLES = ['Make it more formal', 'Make the tone more confident', 'Say this more simply'];

function echo(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 46 ? `${t.slice(0, 46).trimEnd()}…` : t;
}

const Reassure = () => (
  <div className="reassure">
    <IconShield />
    <span>
      I won’t change names, license numbers, project numbers, or dollar amounts unless you ask me
      to.
    </span>
  </div>
);

// Shown only when this edit came from the "Check my proposal" list — a way back to the other
// suggestions without having to Keep or Discard first.
const BackToSuggestions = ({ onBack }: { onBack: () => void }) => (
  <button className="pane-back" onClick={onBack}>
    <span aria-hidden="true">←</span> Back to suggestions
  </button>
);

export function EditPanel({
  selectedBlock,
  section,
  status,
  pending,
  note,
  lastInstruction,
  followUps,
  refining,
  onAction,
  onKeep,
  onDiscard,
  onRefine,
  onCancel,
  onCheck,
  onBack,
}: {
  selectedBlock: Block | null;
  section: string | null;
  status: 'idle' | 'thinking';
  pending: Pending | null;
  note: { kind: 'info' | 'warn'; text: string } | null;
  lastInstruction: string;
  /** Follow-up asks made against the pending proposal, oldest first (the review thread). */
  followUps: string[];
  /** True while a follow-up adjustment is in flight (keeps the diff card on screen). */
  refining: boolean;
  onAction: (instruction: string) => void;
  onKeep: () => void;
  onDiscard: () => void;
  /** Refine the pending proposal in place (before Keep/Discard). */
  onRefine: (text: string) => void;
  onCancel: () => void;
  onCheck: () => void;
  /** Present only during a "Check my proposal" fix — returns to the suggestion list. */
  onBack?: () => void;
}) {
  const [freeText, setFreeText] = useState('');

  // ---- rest (nothing selected) ----
  if (!selectedBlock) {
    return (
      <aside className="pane">
        <div className="pane-head">
          <div className="pane-ico">
            <IconAssistant />
          </div>
          <div className="pane-h">Assistant</div>
        </div>
        <div className="pane-copy">
          <b>Click any part of your proposal</b> to work on it.
        </div>
        <Reassure />
        <button className="btn-cta block" onClick={onCheck}>
          <IconSearch />
          Check my proposal for things to fix
        </button>
        <div className="pane-cue" style={{ textTransform: 'none', fontWeight: 500 }}>
          I’ll look for names to fix, leftover placeholder text, and repeated words.
        </div>
      </aside>
    );
  }

  const header = (
    <div className="pane-head">
      <div className="pane-ico">
        <IconAssistant />
      </div>
      <div>
        <div className="pane-h">
          Working on: {section ?? 'this section'}
          <span className="pane-sub">“{echo(selectedBlock.text)}”</span>
        </div>
      </div>
    </div>
  );

  // ---- thinking ----
  if (status === 'thinking') {
    return (
      <aside className="pane">
        {onBack && <BackToSuggestions onBack={onBack} />}
        {header}
        <div className="thinking">
          <div className="tdots">
            <i />
            <i />
            <i />
          </div>
          <div className="tt">Writing a suggestion for this {selectedBlock.type === 'heading' ? 'heading' : 'paragraph'}…</div>
          <button className="btn-quiet" onClick={onCancel}>
            Stop
          </button>
        </div>
        {lastInstruction && (
          <div className="pane-cue" style={{ textTransform: 'none', fontWeight: 500 }}>
            You asked: {lastInstruction}
          </div>
        )}
      </aside>
    );
  }

  // ---- reviewing a change ----
  if (pending) {
    return (
      <aside className="pane">
        {onBack && <BackToSuggestions onBack={onBack} />}
        {header}
        <DiffView
          pending={pending}
          onKeep={onKeep}
          onDiscard={onDiscard}
          followUps={followUps}
          refining={refining}
          onRefine={onRefine}
        />
      </aside>
    );
  }

  // ---- choices (idle, selected) ----
  const submitFree = () => {
    const t = freeText.trim();
    if (!t) return;
    onAction(t);
    setFreeText('');
  };

  return (
    <aside className="pane">
      {header}
      {note && <div className={`pane-note ${note.kind}`}>{note.text}</div>}
      <div className="pane-cue">Choose what you’d like to change:</div>
      {QUICK_ACTIONS.map(({ instruction, desc, Icon }) => (
        <button key={instruction} className="actbtn" onClick={() => onAction(instruction)}>
          <span className="ai">
            <Icon />
          </span>
          <span className="tx">
            <b>{instruction}</b>
            <span>{desc}</span>
          </span>
        </button>
      ))}
      <div className="freebox">
        <label className="lab" htmlFor="assistant-request">
          Or tell us in your own words
        </label>
        <textarea
          id="assistant-request"
          name="assistant-request"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="For example: make the tone more confident"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitFree();
          }}
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setFreeText(ex)} type="button">
              {ex}
            </button>
          ))}
        </div>
        <button className="btn-cta" onClick={submitFree} style={{ alignSelf: 'flex-start' }}>
          Ask
        </button>
      </div>
      <Reassure />
    </aside>
  );
}
