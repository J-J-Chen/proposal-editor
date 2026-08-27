/** The "Original PDF" view: a faithful, scrollable stack of the real pages (logos, photos, layout
 *  intact), rendered by mupdf. When we have a block→location map for the doc (LAYOUT), it becomes
 *  EDITABLE ON THE PAGE: every paragraph is clickable right where it sits, and an applied edit is
 *  patched in place over the original. Honest limits (fixed layout): the patched paragraph uses a
 *  close-but-not-identical font, and a much longer edit won't reflow the text below it. Without a
 *  map (e.g. an uploaded PDF) it falls back to a read-only preview. */
'use client';

import { useMemo, useState } from 'react';
import type { Doc } from '@/lib/types';
import { RENDERED } from '@/parse-cache/renders';
import { LAYOUT, type BlockRect } from '@/parse-cache/layout';

/** Committed static images for seeded docs; otherwise the on-demand render route (uploads). */
function pageSrc(hash: string, n: number, hasStatic: boolean): string {
  return hasStatic ? `/pages/${hash}/${n}.jpg` : `/api/page/${hash}/${n}`;
}

export function PageView({
  doc,
  selectedId,
  editedText,
  onSelect,
  onBackgroundClick,
}: {
  doc: Doc;
  selectedId: string | null;
  /** blockId → current text, for blocks whose text differs from the original (patched in place). */
  editedText: Record<string, string>;
  onSelect?: (id: string) => void;
  /** Click on the page away from any paragraph → deselect (same as the document view). */
  onBackgroundClick?: () => void;
}) {
  const hash = doc.id;
  const rendered = RENDERED[hash];
  const hasStatic = Boolean(rendered);
  const pageCount = rendered?.pages ?? doc.meta?.pages ?? 0;
  const layout = LAYOUT[hash];
  const interactive = Boolean(onSelect && layout);

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount]);
  const regionsByPage = useMemo(() => {
    const m: Record<number, { id: string; rect: BlockRect }[]> = {};
    if (layout) for (const [id, rect] of Object.entries(layout)) (m[rect.page] ??= []).push({ id, rect });
    return m;
  }, [layout]);

  const [failed, setFailed] = useState<Set<number>>(new Set());

  return (
    <div
      className="canvas original"
      id="original-canvas"
      onClick={() => onBackgroundClick?.()}
    >
      <div className="orig-stack">
        <div className="orig-banner" role="note">
          <EyeIcon />
          {interactive ? (
            <span>
              This is your <b>real proposal</b>. <b>Click any paragraph</b> to edit it — your changes
              appear right here on the page.
            </span>
          ) : (
            <span>
              This is your <b>original PDF</b>, exactly as you sent it — <b>view only</b>. Switch to{' '}
              <b>Your document</b> to make changes.
            </span>
          )}
        </div>

        {pages.map((n) => (
          <figure className="orig-page" key={n}>
            <div className="orig-canvas">
              {failed.has(n) ? (
                <div className="orig-missing">
                  <span>Page {n}</span>
                  <small>Preview isn&rsquo;t available for this page.</small>
                </div>
              ) : (
                <img
                  src={pageSrc(hash, n, hasStatic)}
                  alt={`Page ${n} of ${doc.filename}`}
                  width={612}
                  height={792}
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailed((prev) => new Set(prev).add(n))}
                />
              )}

              {interactive &&
                (regionsByPage[n] ?? []).map(({ id, rect }) => {
                  const patched = editedText[id];
                  const cls =
                    'orig-region' +
                    (id === selectedId ? ' sel' : '') +
                    (patched !== undefined ? ' edited' : '');
                  return (
                    <div
                      key={id}
                      className={cls}
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.w * 100}%`,
                        height: `${rect.h * 100}%`,
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={id === selectedId}
                      aria-label={patched !== undefined ? `Edited paragraph: ${patched}` : 'Edit this paragraph'}
                      onClick={(e) => {
                        e.stopPropagation(); // don't let the click bubble to the background deselect
                        // Toggle: clicking the already-selected paragraph deselects it.
                        if (id === selectedId) onBackgroundClick?.();
                        else onSelect?.(id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (id === selectedId) onBackgroundClick?.();
                          else onSelect?.(id);
                        }
                      }}
                    >
                      {patched !== undefined && (
                        <span className="orig-patch" style={{ fontSize: `${rect.size * 100}cqh` }}>
                          {patched}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
            <figcaption>Page {n}</figcaption>
          </figure>
        ))}

        {pageCount === 0 && (
          <div className="pane-note info">There are no pages to preview for this proposal.</div>
        )}
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
