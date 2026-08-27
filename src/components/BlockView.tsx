/** Track B — one selectable block. Renders semantic text with the gold protected-entity tint. */
import type { ReactNode } from 'react';
import type { Block } from '@/lib/types';
import { entityRanges } from '@/lib/entities';
import { IconRedo, IconUndo } from './icons';

function withEntities(text: string): ReactNode {
  const ranges = entityRanges(text);
  if (ranges.length === 0) return text;
  const out: ReactNode[] = [];
  let cur = 0;
  ranges.forEach((r, i) => {
    if (r.start > cur) out.push(text.slice(cur, r.start));
    out.push(
      <mark className="prot" key={i}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cur = r.end;
  });
  if (cur < text.length) out.push(text.slice(cur));
  return out;
}

function blockNoun(block: Block): string {
  if (block.type === 'heading') return 'heading';
  if (block.type === 'list-item') return 'list item';
  return 'paragraph';
}

function Inner({ block, isTitle }: { block: Block; isTitle: boolean }) {
  switch (block.type) {
    case 'heading':
      // The document's first heading is its title; every later heading is a section heading.
      // (The parser levels all headings the same, so we key off position, not `level`.)
      return isTitle ? (
        <h1 className="doc-h1">{block.text}</h1>
      ) : (
        <h2 className="doc-h2">{block.text}</h2>
      );
    case 'list-item':
      return <div className="doc-li">•&nbsp;&nbsp;{withEntities(block.text)}</div>;
    case 'caption':
      return <div className="doc-meta">{withEntities(block.text)}</div>;
    default:
      return <p className="doc-p">{withEntities(block.text)}</p>;
  }
}

export function BlockView({
  block,
  selected,
  dim,
  pulse,
  peek,
  isTitle,
  sectionControl,
  onSectionStep,
  onSelect,
}: {
  block: Block;
  selected: boolean;
  dim: boolean;
  pulse: boolean;
  peek: boolean;
  isTitle: boolean;
  /** Per-section undo/redo control for this block: 'undo' can revert it, 'redo' can reapply. */
  sectionControl: 'undo' | 'redo' | null;
  onSectionStep: (blockId: string) => void;
  onSelect: (id: string) => void;
}) {
  const cls = [
    'block',
    selected && 'selected',
    dim && 'dim',
    pulse && 'pulse',
    peek && !selected && 'peek',
  ]
    .filter(Boolean)
    .join(' ');

  const isSectionHead = block.type === 'heading' && !isTitle;

  return (
    <div
      className={cls}
      style={isSectionHead ? { marginTop: 26 } : undefined}
      data-block-id={block.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(block.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(block.id);
        }
      }}
    >
      {selected && <span className="sel-tag">You selected this {blockNoun(block)}</span>}
      {peek && !selected && <span className="peek-tag">The suggestion is about this {blockNoun(block)}</span>}
      {sectionControl && (
        <button
          className={`sec-ctl ${sectionControl}`}
          title={
            sectionControl === 'undo'
              ? 'Undo the change to this section'
              : 'Redo the change to this section'
          }
          aria-label={
            sectionControl === 'undo'
              ? `Undo the change to this ${blockNoun(block)}`
              : `Redo the change to this ${blockNoun(block)}`
          }
          onClick={(e) => {
            e.stopPropagation(); // don't select the block
            onSectionStep(block.id);
          }}
        >
          {sectionControl === 'undo' ? <IconUndo /> : <IconRedo />}
          {sectionControl === 'undo' ? 'Undo' : 'Redo'}
        </button>
      )}
      <Inner block={block} isTitle={isTitle} />
    </div>
  );
}
