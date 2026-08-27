/** The read-only "Original PDF" view: a faithful, scrollable stack of the real pages (logos,
 *  photos, layout intact), rendered by mupdf. It is deliberately NOT editable — the clean block
 *  model (DocumentView) is where changes happen. A visible banner says so, so a page that looks
 *  exactly like the document never invites a dead click. */
'use client';

import { useMemo, useState } from 'react';
import type { Doc } from '@/lib/types';
import { RENDERED } from '@/parse-cache/renders';

/** Committed static images for seeded docs; otherwise the on-demand render route (uploads). */
function pageSrc(hash: string, n: number, hasStatic: boolean): string {
  return hasStatic ? `/pages/${hash}/${n}.jpg` : `/api/page/${hash}/${n}`;
}

export function PageView({ doc }: { doc: Doc }) {
  const hash = doc.id;
  const rendered = RENDERED[hash];
  const hasStatic = Boolean(rendered);
  const pageCount = rendered?.pages ?? doc.meta?.pages ?? 0;
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1),
    [pageCount],
  );
  const [failed, setFailed] = useState<Set<number>>(new Set());

  return (
    <div className="canvas original" id="original-canvas">
      <div className="orig-stack">
        <div className="orig-banner" role="note">
          <EyeIcon />
          <span>
            This is your <b>original PDF</b>, exactly as you sent it — <b>view only</b>. Switch to{' '}
            <b>Your document</b> to make changes.
          </span>
        </div>

        {pages.map((n) => (
          <figure className="orig-page" key={n}>
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
