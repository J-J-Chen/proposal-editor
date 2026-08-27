'use client';

import { useEffect, useRef, useState } from 'react';

type Health =
  | { state: 'loading' }
  | { state: 'ok'; latencyMs: number; model: string }
  | { state: 'down'; message: string };

function HealthBadge() {
  const [health, setHealth] = useState<Health>({ state: 'loading' });

  useEffect(() => {
    let alive = true;
    fetch('/api/health/ai')
      .then(async (r) => {
        const data = await r.json();
        if (!alive) return;
        if (data.ok) {
          setHealth({ state: 'ok', latencyMs: data.latencyMs, model: data.model });
        } else {
          setHealth({ state: 'down', message: data.message ?? data.error ?? 'unavailable' });
        }
      })
      .catch((e) => alive && setHealth({ state: 'down', message: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  const dot =
    health.state === 'ok'
      ? 'bg-green-500'
      : health.state === 'down'
        ? 'bg-amber-500'
        : 'bg-gray-400 animate-pulse';

  const label =
    health.state === 'loading'
      ? 'Checking AI proxy…'
      : health.state === 'ok'
        ? `AI proxy OK · ${health.model} · ${health.latencyMs}ms`
        : `AI proxy not ready · ${health.message}`;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-black/10 dark:border-white/15 px-3 py-1 text-xs text-foreground/70">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Proposal Editor</h1>
        <p className="text-foreground/70">
          Upload a proposal PDF and edit it section-by-section with AI — select a
          paragraph, ask for a change, review the diff, apply.
        </p>
      </header>

      <section
        className="rounded-xl border border-dashed border-black/15 dark:border-white/20 p-10 text-center"
        aria-label="Upload a proposal PDF"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Choose a PDF
        </button>
        <p className="mt-3 text-sm text-foreground/60">
          {fileName ? (
            <>
              Selected <span className="font-medium text-foreground/80">{fileName}</span> —
              parsing &amp; editing land in the next checkpoints.
            </>
          ) : (
            'PDF upload → structure extraction → edit loop (coming next).'
          )}
        </p>
      </section>

      <footer className="flex justify-center">
        <HealthBadge />
      </footer>
    </main>
  );
}
