// llm-extractor.mjs — the OPTIONAL second layer of the instrument (see entities.mjs for layer 1).
//
// Two cross-model checks, both run on the OTHER provider from the editor. The shipped editor is
// Anthropic (claude-sonnet-4-5); these run on OpenAI (gpt-4o-mini) so the editor never grades
// itself — correlated blind spots are exactly how a real miss hides.
//
//   1. crossModelEntityDiff — ONE diff-aware call per edit: "list every name / number / date / $
//      in BEFORE that is missing or altered in AFTER." Diff-aware (sees both sides at once) avoids
//      two independent stochastic extractions manufacturing false diffs. Catches OPEN-CLASS proper
//      nouns not in the known corpus — this is what lets the eval generalize to the hidden fixture.
//   2. effectivenessJudge — ONE y/n call for the hard instructions (tone / voice): "did AFTER
//      actually apply this instruction?" The ceiling check a no-op fails.
//
// SDKs are imported dynamically so the deterministic eval still runs with no node_modules. If the
// proxy token is absent, both functions return null and the harness falls back to layer 1 only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load .env.local (repo root) into process.env without a dotenv dependency. */
export function loadEnv() {
  const candidates = [
    resolve(__dirname, '../../.env.local'), // worktree root
    resolve(process.cwd(), '.env.local'),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].replace(/^["']|["']$/g, '');
        if (process.env[key] === undefined) process.env[key] = val;
      }
      return path;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function isLlmAvailable() {
  return typeof process.env.BUOYANT_PROXY_TOKEN === 'string' && process.env.BUOYANT_PROXY_TOKEN.length > 0;
}

const PROXY_HEADERS = { 'accept-encoding': 'identity' }; // proxy returns bodies undici mis-decodes otherwise

let _openai = null;
async function openai() {
  if (_openai) return _openai;
  const { default: OpenAI } = await import('openai');
  _openai = new OpenAI({
    apiKey: process.env.BUOYANT_PROXY_TOKEN,
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://hiring-proxy.trybuoyant.ai/openai',
    defaultHeaders: PROXY_HEADERS,
  });
  return _openai;
}

const EXTRACT_MODEL = process.env.OPENAI_SMALL_MODEL ?? 'gpt-4o-mini';

/**
 * Diff-aware entity check. Returns { missing: [{entity, issue}] } or null if unavailable/errored.
 * Prompted to be conservative: legitimate abbreviation / reformat is NOT a miss.
 */
export async function crossModelEntityDiff({ before, after }) {
  if (!isLlmAvailable()) return null;
  const prompt = [
    'You compare a professional-proposal sentence BEFORE and AFTER an edit.',
    'List ONLY the proper nouns, names, organizations, places, project/contract numbers, dates,',
    'and dollar figures that appear in BEFORE but are MISSING or CHANGED TO A DIFFERENT VALUE in',
    'AFTER. Do NOT flag legitimate abbreviation (e.g. "MECO Engineering Company, Inc." → "MECO"),',
    'reformatting of the same value (e.g. "$2.4M" → "$2.4 million"), or ordinary rewording.',
    'Respond with strict JSON: {"missing":[{"entity":"...","issue":"missing|changed"}]}.',
    'If nothing is missing or changed, return {"missing":[]}.',
    '',
    `BEFORE: """${before}"""`,
    `AFTER: """${after}"""`,
  ].join('\n');
  try {
    const client = await openai();
    const res = await client.chat.completions.create({
      model: EXTRACT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{"missing":[]}');
    return { missing: Array.isArray(parsed.missing) ? parsed.missing : [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), missing: [] };
  }
}

/**
 * One-shot effectiveness judge for the hard instructions. Returns { applied: bool, why } or null.
 */
export async function effectivenessJudge({ before, after, instruction }) {
  if (!isLlmAvailable()) return null;
  const prompt = [
    'A document editor was told to apply an instruction to a sentence. Judge ONLY whether the',
    'instruction was actually carried out (not whether entities were preserved).',
    `INSTRUCTION: ${instruction}`,
    `BEFORE: """${before}"""`,
    `AFTER: """${after}"""`,
    'Respond with strict JSON: {"applied": true|false, "why": "one short clause"}.',
  ].join('\n');
  try {
    const client = await openai();
    const res = await client.chat.completions.create({
      model: EXTRACT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    return { applied: !!parsed.applied, why: String(parsed.why ?? '') };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), applied: null };
  }
}

export { EXTRACT_MODEL };
