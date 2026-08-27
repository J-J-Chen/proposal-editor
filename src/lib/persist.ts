/**
 * Local persistence — the app's "autosave" and "Recent documents", entirely in the browser
 * (localStorage; no DB, per the stack rules). Two things are kept:
 *
 *   • RECENTS  — a short LRU list of documents the user has opened (metadata only), so the
 *                backstage/Open screen can offer "Recent" like Word's Start screen.
 *   • SESSIONS — one working snapshot per doc ({doc, undo history, cursor, view, selection}),
 *                so a soft refresh (or reopening a recent) restores the document *with edits*
 *                exactly where the user left it. Kept for the most-recent SESSION_CAP docs.
 *
 * Everything here is defensive: SSR-safe (no `window` on the server), every read/write wrapped
 * so a private-mode / disabled-storage / quota / corrupt-JSON failure degrades to "no memory"
 * rather than crashing the editor. Keys are namespaced + versioned so a schema change is inert
 * against old data instead of throwing.
 */
import type { Doc, HistoryEntry } from './types';

const NS = 'pe:v1';
const RECENTS_KEY = `${NS}:recents`;
const ACTIVE_KEY = `${NS}:active`;
const SESSION_PREFIX = `${NS}:session:`;

/** How many entries the Recent list holds. */
const RECENTS_CAP = 12;
/** How many full working snapshots we keep (the rest of the Recent list reopens by re-parsing). */
const SESSION_CAP = 6;

export type DocSource = 'sample' | 'upload';
export type DocView = 'document' | 'original';

/** One row in the Recent list — metadata only (the heavy block model lives in the session). */
export interface RecentDoc {
  id: string; // = doc.id = sha256 of the source bytes
  filename: string;
  source: DocSource;
  pages: number;
  lastOpenedAt: string; // ISO
  /** For reopening an uploaded PDF that has since dropped out of the server parse cache. */
  blobUrl?: string;
}

/** A full working snapshot for one document — enough to restore the editor as it was. */
export interface DocSession {
  docId: string;
  doc: Doc; // the live, fully-applied block model (kept edits already applied)
  history: HistoryEntry[];
  cursor: number;
  docView: DocView;
  selectedId: string | null;
  savedAt: string; // ISO
}

// ── low-level, all failure-tolerant ──────────────────────────────────────────

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null; // access itself can throw (sandboxed / blocked cookies)
  }
}

function readJSON<T>(key: string): T | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota / disabled
  }
}

function removeKey(key: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

function sessionKeys(): string[] {
  const s = store();
  if (!s) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(SESSION_PREFIX)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

// ── recents ──────────────────────────────────────────────────────────────────

export function loadRecents(): RecentDoc[] {
  const r = readJSON<RecentDoc[]>(RECENTS_KEY);
  if (!Array.isArray(r)) return [];
  return r.filter(
    (x): x is RecentDoc =>
      !!x && typeof x.id === 'string' && typeof x.filename === 'string',
  );
}

function saveRecents(list: RecentDoc[]): void {
  writeJSON(RECENTS_KEY, list);
}

/** Move `entry` to the front of the Recent list (dedup by id), cap it, and prune stale sessions. */
export function touchRecent(entry: RecentDoc): RecentDoc[] {
  const list = [entry, ...loadRecents().filter((x) => x.id !== entry.id)].slice(0, RECENTS_CAP);
  saveRecents(list);
  pruneSessions(list);
  return list;
}

/** Forget a recent (and its saved working snapshot). Clears `active` if it pointed here. */
export function removeRecent(id: string): RecentDoc[] {
  const list = loadRecents().filter((x) => x.id !== id);
  saveRecents(list);
  removeKey(SESSION_PREFIX + id);
  if (loadActive() === id) setActive(null);
  return list;
}

export function clearRecents(): void {
  for (const k of sessionKeys()) removeKey(k);
  removeKey(RECENTS_KEY);
  setActive(null);
}

// ── active doc pointer ─────────────────────────────────────────────────────────

export function loadActive(): string | null {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActive(id: string | null): void {
  const s = store();
  if (!s) return;
  try {
    if (id) s.setItem(ACTIVE_KEY, id);
    else s.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

// ── sessions (per-doc working snapshots) ───────────────────────────────────────

export function loadSession(id: string): DocSession | null {
  const sess = readJSON<DocSession>(SESSION_PREFIX + id);
  // Shape-check defensively — a schema change or corrupt entry must read as "no snapshot".
  if (
    !sess ||
    typeof sess !== 'object' ||
    !sess.doc ||
    !Array.isArray(sess.doc.blocks) ||
    !Array.isArray(sess.history) ||
    typeof sess.cursor !== 'number'
  ) {
    return null;
  }
  // Every history entry must be a well-formed op — a single malformed entry would crash undo/redo
  // and the "Changes you've made" list, so reject the whole snapshot rather than restore a landmine.
  const entriesOk = sess.history.every(
    (e) => !!e && typeof e === 'object' && !!e.op && typeof (e.op as { kind?: unknown }).kind === 'string',
  );
  if (!entriesOk) return null;
  return sess;
}

/** Persist a doc's working snapshot; on a quota failure, evict other docs' snapshots and retry.
 *  Returns whether the write ultimately succeeded, so callers can reflect real save state. */
export function saveSession(sess: DocSession): boolean {
  if (writeJSON(SESSION_PREFIX + sess.docId, sess)) return true;
  evictSessionsExcept(sess.docId);
  return writeJSON(SESSION_PREFIX + sess.docId, sess); // best-effort second try
}

/** Keep only the newest SESSION_CAP docs' snapshots (plus whatever is active). */
function pruneSessions(recents: RecentDoc[]): void {
  const keep = new Set(recents.slice(0, SESSION_CAP).map((r) => SESSION_PREFIX + r.id));
  const active = loadActive();
  if (active) keep.add(SESSION_PREFIX + active);
  for (const k of sessionKeys()) if (!keep.has(k)) removeKey(k);
}

function evictSessionsExcept(docId: string): void {
  const keep = new Set([SESSION_PREFIX + docId]);
  const active = loadActive();
  if (active) keep.add(SESSION_PREFIX + active);
  for (const k of sessionKeys()) if (!keep.has(k)) removeKey(k);
}
