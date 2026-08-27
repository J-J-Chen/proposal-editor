/**
 * Track D — the calm review card. The AI's change shown as three labelled boxes, read top to
 * bottom like a letter (comprehension by reading, not merging): the wording now (old), the
 * suggested new wording (clean, so the result reads on its own), then "What changed" — the same
 * new wording with removed/added words marked inline (green underline / red strikethrough). Those
 * inline marks are the first thing to cut per design-ui.md #3 — flip SHOW_INLINE_MARKS to false
 * and the "What changed" box drops away, leaving the two plain old/new boxes.
 */
import { useState } from 'react';
import type { Pending } from '@/state/editor';
import { wordDiff } from '@/lib/text/diff';
import { IconCheck, IconShield } from './icons';

const SHOW_INLINE_MARKS = true;

// Follow-up quick actions — the common ways someone nudges a proposed edit before deciding.
// The label is the button; the phrase is what we actually ask the model (fuller, so it aims true).
const FOLLOWUP_CHIPS: { label: string; phrase: string }[] = [
  { label: 'Shorter', phrase: 'Make it a little shorter' },
  { label: 'More formal', phrase: 'Make it more formal' },
  { label: 'Simpler', phrase: 'Say it more simply' },
  { label: 'Warmer', phrase: 'Make the tone a little warmer' },
];

/**
 * The follow-up conversation on the PENDING proposal. Lets the user keep nudging the suggestion
 * ("shorter", "keep the client name") before they Keep or Discard — each nudge iterates on the
 * current draft rather than starting over. Prior asks are shown as a short thread; the resulting
 * draft is what the boxes above display.
 */
function FollowUp({
  followUps,
  refining,
  onRefine,
}: {
  followUps: string[];
  refining: boolean;
  onRefine: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || refining) return;
    onRefine(t);
    setText('');
  };
  return (
    <div className="followup">
      <div className="fu-lab">Not quite right? Tell me how to adjust it — I’ll keep the change up for review:</div>
      {followUps.length > 0 && (
        <div className="fu-turns">
          {followUps.map((f, i) => (
            <div className="fu-turn" key={i}>
              <span aria-hidden="true">↳</span> {f}
            </div>
          ))}
        </div>
      )}
      <div className="fu-row">
        <input
          className="fu-input"
          value={text}
          disabled={refining}
          aria-label="Ask for an adjustment to this change"
          placeholder="e.g. keep the client name, one sentence shorter"
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
        {FOLLOWUP_CHIPS.map((c) => (
          <button
            key={c.label}
            className="chip"
            type="button"
            disabled={refining}
            onClick={() => submit(c.phrase)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The diff itself — three labelled boxes (now / suggested / what-changed) + the "Kept exactly as
 * written" line. No actions, so it's reused by both the single-edit review card (DiffView) and
 * each card in the chat's batch review (ChatPanel).
 */
export function DiffBody({
  before,
  after,
  protectedKept,
}: {
  before: string;
  after: string;
  protectedKept: string[];
}) {
  const segs = SHOW_INLINE_MARKS ? wordDiff(before, after) : null;
  return (
    <>
      <div className="boxlab">The wording now</div>
      <div className="oldbox">{before}</div>

      <div className="boxlab" style={{ marginTop: 9 }}>
        The suggested new wording
      </div>
      <div className="newbox">{after}</div>

      {segs && (
        <>
          <div className="boxlab" style={{ marginTop: 9 }}>
            What changed
          </div>
          <div className="diffbox">
            {segs.map((s, i) =>
              s.kind === 'same' ? (
                <span key={i}>{s.text}</span>
              ) : s.kind === 'add' ? (
                <span key={i} className="ad">
                  {s.text}
                </span>
              ) : (
                <span key={i} className="rm">
                  {s.text}
                </span>
              ),
            )}
          </div>
          <div className="legend">
            <span>
              <span className="rm2">red crossed-out</span> = removed
            </span>
            <span>
              <span className="ad2">green underlined</span> = added
            </span>
          </div>
        </>
      )}

      {protectedKept.length > 0 && (
        <div className="keptline">
          <IconShield style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 6 }} />
          <b>Kept exactly as written:</b>
          <br />
          {protectedKept.map((s, i) => (
            <span className="pill" key={i}>
              {s}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function DiffView({
  pending,
  onKeep,
  onDiscard,
  followUps,
  refining,
  onRefine,
}: {
  pending: Pending;
  onKeep: () => void;
  onDiscard: () => void;
  followUps: string[];
  refining: boolean;
  onRefine: (text: string) => void;
}) {
  return (
    <div className="rcard">
      <div className="rc-head">
        <div className="t">Here is the suggested change</div>
        <div className="asked">You asked: {pending.instruction}.</div>
      </div>

      <DiffBody
        before={pending.before}
        after={pending.after}
        protectedKept={pending.protectedKept}
      />

      <FollowUp followUps={followUps} refining={refining} onRefine={onRefine} />

      <div className="rc-actions">
        <button className="btn-keep" onClick={onKeep}>
          <IconCheck />
          Keep this change
        </button>
        <button className="btn-discard" onClick={onDiscard}>
          Discard
        </button>
        <span className="rc-under">You can Undo this afterward.</span>
      </div>
    </div>
  );
}
