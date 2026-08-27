/**
 * Track G — the Refine inbox. A short, high-precision list of grounded suggestions, each shown
 * with its "why" quoted from the actual text. Clicking a card scrolls to and highlights the
 * block; "Make this fix" routes through the normal edit loop (review card → Keep/Discard/Undo).
 */
'use client';

import type { RefineCategory, Suggestion } from '@/refine/scan';
import { IconSearch } from './icons';

const CAT_LABEL: Record<RefineCategory, string> = {
  placeholder: 'Leftover text',
  casing: 'Capitalization',
  repetition: 'Repeated words',
};

export function RefinePanel({
  suggestions,
  reviewedCount,
  onFix,
  onDismiss,
  onGoto,
  onPeek,
  onClose,
}: {
  suggestions: Suggestion[];
  reviewedCount: number;
  onFix: (s: Suggestion) => void;
  onDismiss: (id: string) => void;
  onGoto: (blockId: string) => void;
  /** Hovering a card reveals its section in the document; null clears the reveal. */
  onPeek: (blockId: string | null) => void;
  onClose: () => void;
}) {
  const n = suggestions.length;
  return (
    <aside className="pane">
      <div className="pane-head">
        <div className="pane-ico">
          <IconSearch />
        </div>
        <div>
          <div className="pane-h">
            Suggestions to review
            <span className="pane-sub">
              {n === 0
                ? reviewedCount > 0
                  ? 'all done'
                  : 'nothing to fix'
                : `${n} thing${n === 1 ? '' : 's'} to look at`}
            </span>
          </div>
        </div>
      </div>

      {n === 0 ? (
        <div className="pane-note info">
          {reviewedCount > 0
            ? 'Nice work — you’ve reviewed everything.'
            : 'I didn’t find anything that needs fixing. Your proposal looks good.'}
        </div>
      ) : (
        suggestions.map((s) => (
          <div
            className="refcard"
            key={s.id}
            onMouseEnter={() => onPeek(s.blockId)}
            onMouseLeave={() => onPeek(null)}
          >
            <button className="refcard-body" onClick={() => onGoto(s.blockId)} title="Show me where">
              <span className={`rf-cat ${s.category}`}>{CAT_LABEL[s.category]}</span>
              <span className="rf-title">{s.title}</span>
              <span className="rf-why">{s.why}</span>
              <span className="rf-where">Hover to see this part · click to jump to it</span>
            </button>
            <div className="rf-act">
              <button className="mini-keep" onClick={() => onFix(s)}>
                Make this fix
              </button>
              <button className="mini-sec" onClick={() => onDismiss(s.id)}>
                Dismiss
              </button>
            </div>
          </div>
        ))
      )}

      <button className="btn-quiet mt-auto" onClick={onClose}>
        Done reviewing
      </button>
    </aside>
  );
}
