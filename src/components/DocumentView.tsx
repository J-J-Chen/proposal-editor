/** Track B — the document: the block model rendered as a clean page on the grey canvas. */
import type { Doc } from '@/lib/types';
import { BlockView } from './BlockView';

export function DocumentView({
  doc,
  selectedId,
  pulseId,
  peekId,
  onSelect,
  onBackgroundClick,
}: {
  doc: Doc;
  selectedId: string | null;
  pulseId: string | null;
  /** A block being previewed from the Refine list (hover) — steady reveal, not a one-shot pulse. */
  peekId: string | null;
  onSelect: (id: string) => void;
  /** Clicking blank space (canvas / page margins, not a block) clears the selection. */
  onBackgroundClick: () => void;
}) {
  const titleId = doc.blocks.find((b) => b.type === 'heading')?.id;
  return (
    <div
      className="canvas"
      id="doc-canvas"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.block')) onBackgroundClick();
      }}
    >
      <article className="page" aria-label={doc.filename}>
        {doc.blocks.map((b) => (
          <BlockView
            key={b.id}
            block={b}
            selected={b.id === selectedId}
            dim={false}
            pulse={b.id === pulseId}
            peek={b.id === peekId}
            isTitle={b.id === titleId}
            onSelect={onSelect}
          />
        ))}
      </article>
    </div>
  );
}
