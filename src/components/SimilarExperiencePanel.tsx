'use client';

import { useState } from 'react';
import type { KbCandidate } from '@/lib/contracts';
import type { Block } from '@/lib/types';
import { IconSearch } from './icons';

const EXAMPLES = ['bridge work', 'electrical upgrades', 'water infrastructure'];

function short(text: string, limit = 360): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

export function SimilarExperiencePanel({
  target,
  section,
  candidates,
  status,
  selectedCandidateId,
  error,
  onSearch,
  onChoose,
  onBack,
}: {
  target: Block;
  section: string | null;
  candidates: KbCandidate[];
  status: 'idle' | 'searching' | 'composing';
  selectedCandidateId: string | null;
  error: string | null;
  onSearch: (query: string) => void;
  onChoose: (candidate: KbCandidate) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const busy = status !== 'idle';
  const submit = (raw?: string) => {
    const value = (raw ?? query).trim();
    if (!value || busy) return;
    setQuery(value);
    onSearch(value);
  };

  return (
    <aside className="pane kb-panel">
      <button className="pane-back" onClick={onBack} disabled={busy && status === 'composing'}>
        <span aria-hidden="true">←</span> Back to section actions
      </button>
      <div className="pane-head">
        <div className="pane-ico">
          <IconSearch />
        </div>
        <div>
          <div className="pane-h">Add similar experience</div>
          <span className="pane-sub">After: {section ?? short(target.text, 54)}</span>
        </div>
      </div>

      <p className="kb-intro">
        Search real past proposals. You’ll see the source before any new wording is prepared.
      </p>

      <form
        className="kb-search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="lab" htmlFor="experience-search">
          What kind of experience would help here?
        </label>
        <div className="kb-search-row">
          <input
            id="experience-search"
            value={query}
            disabled={busy}
            placeholder="For example: a bridge project we’ve done"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn-cta" type="submit" disabled={busy || !query.trim()}>
            <IconSearch />
            {status === 'searching' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="chips">
          {EXAMPLES.map((example) => (
            <button
              className="chip"
              type="button"
              key={example}
              disabled={busy}
              onClick={() => submit(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      {error && <div className="pane-note warn">{error}</div>}

      {status === 'searching' && (
        <div className="kb-progress" role="status">
          <div className="tdots">
            <i />
            <i />
            <i />
          </div>
          Looking through past proposals…
        </div>
      )}

      {candidates.length > 0 && (
        <div className="kb-results">
          <div className="kb-results-head">Choose the past project to use</div>
          <p>Picking one prepares a paragraph for review. It will not add anything yet.</p>
          {candidates.map((candidate) => {
            const composing =
              status === 'composing' && selectedCandidateId === candidate.candidateId;
            const excerpt = candidate.quote || candidate.text;
            return (
              <article className="kb-candidate" key={candidate.candidateId}>
                <div className="kb-candidate-top">
                  <span className="kb-discipline">{candidate.discipline || 'Past experience'}</span>
                  <span className="kb-score">Source match</span>
                </div>
                <h3>{candidate.title}</h3>
                <blockquote>“{short(excerpt)}”</blockquote>
                <div className="kb-source">
                  {candidate.sourceTitle || candidate.sourceDoc}, page {candidate.page}
                </div>
                <button
                  className="btn-keep kb-use"
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(candidate)}
                >
                  {composing ? 'Preparing paragraph…' : 'Use this project'}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {status === 'composing' && (
        <div className="kb-progress" role="status">
          <div className="tdots">
            <i />
            <i />
            <i />
          </div>
          Preparing a grounded paragraph for you to review…
        </div>
      )}

      {status === 'idle' && !error && candidates.length === 0 && (
        <div className="kb-empty">Search by project type, service, client need, or discipline.</div>
      )}
    </aside>
  );
}
