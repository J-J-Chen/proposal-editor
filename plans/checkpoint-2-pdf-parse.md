# Checkpoint 2 — PDF → Structured Blocks

**Goal:** turn an uploaded PDF into a clean, ordered list of typed **blocks** with stable ids,
cached so we parse each file only once. Develop against `easy.pdf`; generalize gracefully to an
unseen SOQ.

> This plan is the output of a research + adversarial-review pass (2026-08-26). Key claims were
> **verified against the real fixtures** (mupdf run on `easy.pdf`/`hard.pdf`), not assumed. See
> [decisions.md](../docs/decisions.md) for the logged calls, [fixtures.md](../docs/fixtures.md)
> for the recon, [architecture.md](../docs/architecture.md) for the bet.

> **STATUS — BUILT (2026-08-26).** Implemented in `src/parse/*` + real `src/app/api/parse/route.ts`,
> verified end-to-end on the fixtures (easy.pdf seed → 101 blocks; unseeded 12MB upload live-parses in
> ~36s; `e2e-verify` ALL PASS). **Three deltas from the text below**, logged in
> [decisions.md](../docs/decisions.md): (1) structured output via **tool-use**, not `messages.parse()`
> (the latter was unverified on the proxy); (2) **a single `/api/parse` route** (no separate `parse-check`) plus a **Vercel Blob
> client-upload** path (`/api/blob/upload`) used only when a large PDF misses the cache; (3) reading order = **mupdf native order** (a global y-sort scrambles the
> two-column list), column-sort kept only as a hedge.

## Bottom line (what the research changed)
Deterministic extraction is far stronger than the KB first assumed: **the extractor itself gives
bold-vs-normal per line.** So we do ~80% of structuring with deterministic TypeScript and use
**one LLM call** only to group lines into blocks + assign heading levels — and that call
**references line indices, it never re-emits text.** Consequences:
- **Entity fidelity by construction** — the model cannot alter "MECO", "041-560",
  "MO PE No. 022510", `$` figures, etc.; it only emits `{type, level, startLine, endLine}`. This is
  the CP2 half of "the parse is entity-safe by construction; the edit route is the only place an
  entity can break" (see the Evaluation v2 decision in [decisions.md](../docs/decisions.md)).
- **Small, clean output** — ~3–4× fewer output tokens than re-emitting text: a latency/quality win.
  (Spend is **not** a constraint per the owner — reference-based output is kept for fidelity +
  latency, not cost.)
- **Degrades to heuristics-only** if the LLM/proxy flakes.

## Pipeline
```
browser: pick PDF → sha256 (Web Crypto) → send hash to /api/parse-check
   │ HIT  → cached Doc
   │ MISS → Blob client-upload (raw bytes)      server (Node runtime route)
                                          → 1. EXTRACT   mupdf asJSON → RawLine[]{text,bbox,font,weight,size,page}
                                            2. HEURISTICS dedup → header/footer strip → column-sort → line-merge → provisional labels
                                            3. LLM        numbered+annotated lines → blocks[]{type,level,startLine,endLine}
                                            4. ASSEMBLE   join referenced lines VERBATIM → Block[] + stable ids + coverage-validate
                                            5. CACHE       write-back → Doc (blocks JSON, ~10–30KB)
```
The cache value is the finished `Doc`. We cache the slow LLM pass (for latency + a deterministic
demo, not spend), not the ~90ms extraction.

## Extraction library — `mupdf` (WASM)
**Pick:** `mupdf@1.28.0`, **server-side, Node runtime** (never Edge — needs fs/WASM).
`page.toStructuredText("preserve-whitespace").asJSON()` returns pymupdf-`dict`-equivalent
blocks→lines with `bbox` + `font{name,family,weight,style,size}` + `text`.

**Verified on the real fixtures:** `OUR FIRM`/`SERVICES` come back `weight:"bold" size:12` while
body is `weight:"normal" size:12` — so **MESS #2 (bold headings at body size) is solved by the
extractor**, no `commonObjs`/font-walker plumbing. Same engine as the pymupdf that gave clean
recon output.

**Fallback:** `pdfjs-serverless` (same span data, but weight needs `page.commonObjs.get(fontName)`
resolution and is unreliable for subset fonts like `Unnamed-T3`). Only switch if the `.wasm`
won't trace into the Vercel bundle.

```ts
import * as mupdf from "mupdf"; // module scope → WASM reused across warm invocations

export function extractLines(bytes: Uint8Array): RawLine[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const out: RawLine[] = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const st = page.toStructuredText("preserve-whitespace");
    const json = JSON.parse(st.asJSON()) as { blocks: any[] };
    for (const b of json.blocks ?? []) {
      if (b.type !== "text") continue;
      for (const ln of b.lines ?? []) {
        const text = ln.text ?? "";
        if (!text.trim()) continue;
        out.push({
          text,
          x0: ln.bbox.x, y0: ln.bbox.y, x1: ln.bbox.x + ln.bbox.w, y1: ln.bbox.y + ln.bbox.h,
          size: ln.font?.size ?? 0,
          bold: ln.font?.weight === "bold" || /-(Semibold|Bold|Black)/i.test(ln.font?.name ?? ""),
          font: ln.font?.name ?? "",
          page: p,
        });
      }
    }
    st.destroy?.();
  }
  return out;
}
```
Granularity is per **line** (asJSON reports font at line level) — exactly what heuristics +
line-range refs want.

## Deterministic structuring (before the LLM)
Operate on `RawLine[]`. All rules grounded in recon (easy/hard/monroe are one MECO template).

1. **Shadow/dup dedup (MESS #1) — position-bucketed, NOT consecutive.** The shadow text is
   *interleaved* (verified p1 emission order: `SoF, SoF, Q, Q, SoF, Q`), so a consecutive-collapse
   leaves a copy behind. Group per page by `(normalizedText + rounded x/y bucket ≈8pt)`, keep one
   representative per bucket. Scope to same-text-same-position so legit repeated list items survive.
   Do **not** dedup by font name (`Unnamed-T3` carries both shadow text and real content).
2. **Header/footer strip.** Lines in the top/bottom y-band that repeat across ≥2 pages (e.g.
   `2701 Industrial Drive | … | 573-893-5558`, page numbers). Drop from block flow — but **relabel
   as low-priority `other`, don't hard-delete**: a hidden fixture might surface an entity (phone /
   project no.) only in the footer.
3. **Column-aware reading order (the one real generalization fix).** Per page, histogram line `x0`;
   on a clean gap, bucket into columns and sort each top-to-bottom, columns left-to-right; else
   plain y-sort. Both mupdf and pymupdf emit 2-column staff pages (hard p16–18) OUT of reading
   order (title after its body, sidebar last). Single-column pages already order correctly.
4. **Line → block merge.** Within a column, merge consecutive body lines with compatible font/size
   and normal leading. Break on a heading line, a large blank gap, a list marker, or a weight change.
5. **Heading detection — weight + ALL-CAPS + short, NEVER size.** Candidate iff
   `bold && isAllCaps(text) && wordCount ≤ ~6`. Headings (`OUR FIRM`, `SERVICES`, `RELEVANT
   EXPERIENCE`, `YOUR TEAM`, `OUR APPROACH`) are Semibold **12pt = body size** — bigger=heading
   fails. ALL-CAPS is load-bearing: "Ryan Huseman, PE, Electrical Engineer" is bold-12 but
   mixed-case → NOT a heading. Split glued heading+body blocks (MESS #2 within a block).
6. **List/caption detection.** List-item = bullet/number/dash prefix OR indented short line in a
   sibling run (indent via `x0` step). Flatten deep nesting to flat `list-item` + optional `level`.
   Caption = short line adjacent to an image region (best-effort).
7. **Number the survivors** `0..N` with provisional `{type, page, x0bucket, bold, caps}` for the LLM.

Do **not** hardcode a body font: body is `ProximaNova-Light 12pt` on letter pages but
`Unnamed-T3 10/12pt` on dense pages. Detect headings **relative** to each page's dominant run.

## LLM structuring pass
**Division of labor.** Heuristics own reading order, dedup, verbatim text, and provisional labels.
The LLM owns only the ambiguous ~20%: (a) fix block boundaries the heuristic mis-cut, (b) assign
heading **levels** (h1/h2/h3), (c) coarsely label brochure/infographic pages as `other`/`caption`
instead of over-segmenting. **It references line ranges; it never emits text.**

Always run the single LLM call on a cache miss — **do not** skip it "when heuristics look
confident" (cut: infographic stat labels like `60 EMPLOYEES`, `PRE-QUALIFIED` are bold+CAPS+short
and would fire as false headings without the LLM's coarse relabel).

**Model:** default `claude-sonnet-5`, effort `low` — the label-by-reference task is mechanical, so
Sonnet is plenty. **Spend is not a constraint** (owner directive), so choose for QUALITY, not cost:
bump the structuring pass to `claude-opus-5` if it improves block boundaries / heading levels on the
hidden fixture — don't down-tier to save money. (`claude-haiku-4-5` only if you want lower latency on
a clearly-easy page.)

**Structured output:** prefer the Anthropic SDK `messages.parse()` + zod schema via
`output_config.format` through the Buoyant proxy baseURL. **⚠ Verify the proxy forwards it before
generating seeds** (smoke test — see tasks); if unsupported, fall back to tool-use (`input_schema`)
or JSON-in-a-text-block + `JSON.parse` + zod validate. Guard `parsed_output === null`.

```ts
const Structure = z.object({
  blocks: z.array(z.object({
    type: z.enum(["heading","paragraph","list-item","caption","table","other"]),
    level: z.number().nullable(),   // 1..3 for headings, null otherwise
    startLine: z.number(),
    endLine: z.number(),
  })),
});
```
User content = compact numbered lines, verbatim text after `|`:
```
0 p1 . CAPS x76 heading | STATEMENT OF QUALIFICATIONS
1 p2 B CAPS x76 heading | OUR FIRM
2 p2 . .    x76 paragraph | MECO Engineering Company, Inc. is a ...
```
**Context budget (measured):** easy ≈3.0K input tok, hard(19pp) ≈12.2K — both fit ONE request.
Chunk **per page** only above ~50pp / ~25K input tok to stay within the context window (a
reliability concern, not a spend one) — not needed for the provided set.

**Assemble:** join `lines[startLine..endLine]` VERBATIM; `page = min(page of lines)`; derive id
(below). **Validate coverage:** `0 ≤ start ≤ end ≤ N`, each line used ≤1×; unreferenced content
lines become their own paragraph; on any violation fall back to heuristic provisional blocks for
that span. Never crash.

## Doc / Block model + stable ids
```ts
type BlockType = "heading" | "paragraph" | "list-item" | "caption" | "table" | "other";
interface Block { id: string; type: BlockType; text: string; level?: number; page: number; }
interface Doc {
  id: string;                 // = sha256 of source bytes
  filename: string;
  blocks: Block[];
  meta: { sha256: string; parserVersion: number; pages: number; model: string; parsedAt: string };
}
```
**Stable id:** `id = shortHash(normalize(text) + "|" + type + "|" + ordinalAmongSameNormText)` —
content-derived so re-parsing the same file yields the same ids (edit history / selection survive);
the ordinal disambiguates repeated identical lines.

## Caching (no DB)
**Key:** `parse/v{PARSER_VERSION}/{sha256}.json` — parser/prompt/schema version in the key so a
prompt bump auto-invalidates. `sha256` over raw bytes.

- **L0 committed seed (highest ROI — do first):** run the pipeline once locally over the 7 provided
  PDFs, commit `src/parse-cache/{sha256}.json`, load into a Map at module init. Makes the graded
  demo **instant with zero runtime LLM / zero Blob / zero 413 risk.** Commit only the small JSON,
  never the PDFs. `easy.pdf` sha256 = `03dd3ee8dd7962eb11fd67dd223cfdcdcd0e4f8957aa8622ac24d929cd8c5829` (verified).
- **L1 in-process Map:** warm-instance / dev accelerator.
- **Blob for UPLOAD (required):** `easy.pdf` is 13MB, `hard.pdf` 18MB — both exceed Vercel's
  **4.5MB request-body cap**, so a plain POST 413s. Compute sha256 in the **browser** (Web Crypto),
  send only the 64-char hash to `parse-check`; on a miss upload bytes via **Vercel Blob client
  upload**. (Durable Blob *write-back* caching + a dev-disk `.cache/` tier are optional polish — add
  only if time remains. Skip Runtime Cache/KV.)

## Serverless / runtime config
`src/app/api/parse/route.ts`:
```ts
export const runtime = "nodejs";   // NOT edge — mupdf needs fs/WASM
export const maxDuration = 60;     // Hobby ceiling is 60s; must cover cold wasm-load + extract + 1 LLM call
// memory: 2GB default is fine
```
`next.config.ts`:
```ts
const nextConfig = {
  serverExternalPackages: ["mupdf"],   // keep the ~10.4MB WASM out of the bundle, load from node_modules
  // if the deployed function 500s on missing wasm:
  // outputFileTracingIncludes: { "/api/parse": ["./node_modules/mupdf/dist/*.wasm"] },
};
```
`import * as mupdf` at **module scope**. **Verify the WASM traces into the deployed function with
one smoke test before building on it** — the single genuine deploy risk.

## Module layout
```
src/
  app/api/
    parse-check/route.ts   # POST {sha256, filename} → cached Doc | {miss:true, uploadUrl}
    parse/route.ts         # POST {blobUrl|sha256} → Doc  (runtime/maxDuration here)
    upload/route.ts        # Vercel Blob client-upload handler
  parse/
    extract.ts             # mupdf → RawLine[]
    heuristics.ts          # dedup, header/footer, column-sort, line-merge, labels
    structure.ts           # numbered-line repr + Sonnet call + zod schema
    assemble.ts            # line-ranges → Block[], verbatim join, coverage-validate, stable ids
    pipeline.ts            # extract → heuristics → structure → assemble; fallback wiring
    cache.ts               # sha256 key, L0 seed Map, L1 Map, Blob
    types.ts               # Doc, Block, RawLine
  parse-cache/{sha256}.json  # committed L0 seeds
  lib/ai.ts                # proxy-configured Anthropic client
scripts/seed-parse.ts      # run pipeline over provided PDFs → write src/parse-cache/*.json
```

## Generalization & graceful degradation
- All 7 fixtures are one MECO template (hard p1–6 byte-identical to easy) → easy's heuristics carry;
  **column-sort is the one added capability**. Heuristics are **relative** (weight+caps+short vs the
  page's dominant run), hedging an unseen firm's template.
- **Unseen fixture:** misses L0 by design → Blob + full parse. Coverage-validation + heuristic
  fallback ⇒ never crashes; worst case renders selectable heuristic blocks.
- **Infographic/brochure pages** (easy 5–8, dense hard pages): LLM labels them coarse
  `other`/`caption`; render read-only. No layout reconstruction.
- **No OCR** — all provided PDFs have a text layer, and the owner confirms the hidden fixture is
  **another MECO-style SOQ with a real text layer** (so the provided set is representative; no
  scanned path). Scanned input remains a documented gap.

## Known parse limitations (best-effort, documented — QA-reviewed 2026-08-26)
Deliberately NOT chased, to protect the verbatim/entity-fidelity guarantee and avoid rabbit-holing:
- **Glyph-spacing run-ons on dense brochure pages** (hard.pdf only): e.g. `Highway58` (missing space),
  run-on service lists (`PumpingFlow`). The space is absent in the PDF's glyphs; **inserting one would
  modify verbatim text** and risk corrupting tokens like `PE-2020000059`/`MoDOT`/license numbers — the
  exact fidelity we sell. Left as-is.
- **Dense multi-column brochure ordering**: the column-aware sort fixes the officer chart + heading
  order, but the busiest infographic pages can still interleave; acceptable (rendered read-only).
- **Source-set values**: `Evan Nickels — Engineer` has no PE#/experience *in the source* (non-registered
  staff). Correct as-is; we never fabricate a missing entity.
- **Small-caps case**: names the source sets in small-caps (`scott vogler, pe`) stay lowercase — we
  don't fabricate capitalization.

## Scope boundary with CP3
CP2 = the parse pipeline + `/api/parse` returning Doc JSON + a **throwaway test page that dumps the
JSON** (enough to prove it end-to-end on the deployed app). The real block renderer + click-select
is **CP3**.

## Risks / failure modes → mitigations
| Risk | Mitigation |
|---|---|
| WASM not traced into the Vercel function (works local, 500 deployed) | Deploy smoke test task #3; `outputFileTracingIncludes` if needed |
| 13–18MB upload → 413 | Browser sha256 + Blob client upload; hash-only cache-check |
| Proxy doesn't forward `messages.parse()` structured output | Smoke test before seeds; fall back to tool-use / JSON+zod |
| LLM mutates a proper noun / number | Reference-based output — model never emits text; impossible by construction |
| LLM drops/dupes/invents a line id | Coverage validation + per-span heuristic fallback |
| Two-column pages scrambled | x0-cluster column detection + per-column y-sort |
| Over-aggressive dedup deletes real content | Position-bucketed, same-text-same-position only; never font-name-based |
| Footer strip drops an entity | Relabel footer lines as `other`, don't hard-delete |
| Parse latency (spend is not a constraint) | Cache by hash (parse once); L0 seed makes the graded path instant |

**Cut for CP2:** gridded-table extraction; robust dense multi-column beyond the 2-bucket split;
infographic layout reconstruction; sub-line (per-char) weight via `walk()`; skip-LLM-when-confident;
durable Blob write-back + dev-disk cache; OCR; Runtime Cache/KV; DB/multi-user.

## Task breakdown (ordered)
1. `scripts/wt-new.sh cp2-pdf-parse` — worktree off main.
2. `npm i mupdf zod @vercel/blob`; add `serverExternalPackages:["mupdf"]` to `next.config.ts`.
3. **De-risk twice, early:** (a) trivial `nodejs` route opens `easy.pdf` via mupdf → returns page
   count; deploy; confirm `.wasm` traces. (b) one `messages.parse()` + zod ping through the Buoyant
   proxy → confirm `parsed_output` non-null (else pick the tool-use / JSON fallback now).
4. `parse/types.ts` — `Doc`, `Block`, `RawLine`.
5. `parse/extract.ts` — mupdf `asJSON` → `RawLine[]`. Eyeball vs `easy.pdf`.
6. `parse/heuristics.ts` — dedup → header/footer → column-sort → line-merge → labels. Verify easy
   p1–4 (6 headings, services list unscrambled, cover deduped).
7. `parse/assemble.ts` — line-ranges → `Block[]`, verbatim join, coverage validation, stable ids.
8. `parse/structure.ts` — numbered-line repr, `messages.parse()` + zod (or fallback), Sonnet 5
   (bump to Opus 5 if structure quality needs it — spend is not a constraint).
9. `parse/cache.ts` (sha256 key, L1 Map, L0 seed, Blob upload) + `parse/pipeline.ts` (heuristics-only
   fallback).
10. `scripts/seed-parse.ts` — run pipeline over the 7 PDFs; commit `src/parse-cache/{sha256}.json`.
11. Routes: `api/upload`, `api/parse-check`, `api/parse`; provision `BLOB_READ_WRITE_TOKEN` +
    `BUOYANT_PROXY_TOKEN` on Vercel.
12. Throwaway test page (file picker → sha256 → parse-check/upload → dump JSON). Deploy; upload
    `easy.pdf` → clean block list from seed; re-upload → instant hit; spot-check `hard.pdf` degrades
    without crashing.
13. Append decisions.md entries; `scripts/mq-land.sh --cleanup`.

**Done when:** the deployed app turns `easy.pdf` into a clean ordered block list (cover deduped,
headings split from bodies, services list not scrambled), cached by hash so a second upload returns
immediately — and an unseen SOQ parses without crashing.
