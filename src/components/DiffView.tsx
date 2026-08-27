/**
 * Track D — the calm review card. The AI's change shown as two labelled boxes, read top to
 * bottom like a letter (comprehension by reading, not merging). Removed/added words are marked
 * INSIDE the new-wording box (green underline / red strikethrough); those inline marks are the
 * first thing to cut per design-ui.md #3 — flip SHOW_INLINE_MARKS to false and the two boxes
 * stand on their own.
 */
import type { Pending } from '@/state/editor';
import { wordDiff } from '@/lib/text/diff';
import { IconCheck, IconShield } from './icons';

const SHOW_INLINE_MARKS = true;

export function DiffView({
  pending,
  onKeep,
  onDiscard,
}: {
  pending: Pending;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const segs = SHOW_INLINE_MARKS ? wordDiff(pending.before, pending.after) : null;

  return (
    <div className="rcard">
      <div className="rc-head">
        <div className="t">Here is the suggested change</div>
        <div className="asked">You asked: {pending.instruction}.</div>
      </div>

      <div className="boxlab">The wording now</div>
      <div className="oldbox">{pending.before}</div>

      <div className="boxlab" style={{ marginTop: 9 }}>
        The suggested new wording
      </div>
      <div className="newbox">
        {segs
          ? segs.map((s, i) =>
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
            )
          : pending.after}
      </div>

      {pending.protectedKept.length > 0 && (
        <div className="keptline">
          <IconShield style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 6 }} />
          <b>Kept exactly as written:</b>
          <br />
          {pending.protectedKept.map((s, i) => (
            <span className="pill" key={i}>
              {s}
            </span>
          ))}
        </div>
      )}

      {segs && (
        <div className="legend">
          <span>
            <span className="rm2">red crossed-out</span> = removed
          </span>
          <span>
            <span className="ad2">green underlined</span> = added
          </span>
        </div>
      )}

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
