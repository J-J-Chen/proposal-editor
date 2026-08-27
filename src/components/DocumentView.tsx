/** Track B — the document: the block model rendered as a clean page on the grey canvas. */
import type { Doc } from '@/lib/types';
import { BlockView } from './BlockView';

export function DocumentView({
  doc,
  selectedId,
  pulseId,
  onSelect,
}: {
  doc: Doc;
  selectedId: string | null;
  pulseId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="canvas" id="doc-canvas">
      <article className="page" aria-label={doc.filename}>
        {doc.blocks.map((b) => (
          <BlockView
            key={b.id}
            block={b}
            selected={b.id === selectedId}
            dim={false}
            pulse={b.id === pulseId}
            onSelect={onSelect}
          />
        ))}
      </article>
    </div>
  );
}
