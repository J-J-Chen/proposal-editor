/**
 * Track G — the Refine inbox. A short, high-precision list of grounded suggestions, each shown
 * with its "why" quoted from the actual text. Clicking a card scrolls to and highlights the
 * block; "Make this fix" routes through the normal edit loop (review card → Keep/Discard/Undo).
 */
'use client';

import type { RefineCategory, Suggestion } from '@/refine/scan';
import { IconSearch } from './icons';

const CAT_LABEL: Record<RefineCategory, string> = {
  // Deterministic client scan.
  placeholder: 'Leftover text',
  casing: 'Capitalization',
  repetition: 'Repeated words',
  // LLM editorial pass (/api/suggest) — plain-language, never jargon.
  wordiness: 'Could be tighter',
  clarity: 'Be more specific',
  consistency: 'Keep it consistent',
};

export function RefinePanel({
  suggestions,
  reviewedCount,
  loadingMore,
  onFix,
  onDismiss,
  onGoto,
  onPeek,
  onClose,
}: {
  suggestions: Suggestion[];
  reviewedCount: number;
  /** True while the LLM editorial pass is still running (its results merge in when it returns). */
  loadingMore: boolean;
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
        loadingMore ? (
          <div className="rf-looking">
            <div className="tdots">
              <i />
              <i />
              <i />
            </div>
            <span>Reading your writing for ways to improve it…</span>
          </div>
        ) : (
          <div className="pane-note info">
            {reviewedCount > 0
              ? 'Nice work — you’ve reviewed everything.'
              : 'I didn’t find anything that needs fixing. Your proposal looks good.'}
          </div>
        )
      ) : (
        <>
          {suggestions.map((s) => (
            <div
              className="refcard"
              key={s.id}
              onMouseEnter={() => onPeek(s.blockId)}
              onMouseLeave={() => onPeek(null)}
            >
              <button
                className="refcard-body"
                onClick={() => onGoto(s.blockId)}
                title="Show me where"
              >
                <span className={`rf-cat ${s.category}`}>{CAT_LABEL[s.category]}</span>
                <span className="rf-title">{s.title}</span>
                <span className="rf-why">{s.why}</span>
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
          ))}
          {loadingMore && (
            <div className="rf-looking">
              <div className="tdots">
                <i />
                <i />
                <i />
              </div>
              <span>Looking for more ways to improve your writing…</span>
            </div>
          )}
        </>
      )}

      <button className="btn-quiet mt-auto" onClick={onClose}>
        Done reviewing
      </button>
    </aside>
  );
}
