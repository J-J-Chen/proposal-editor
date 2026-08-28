/**
 * AI clients for the Buoyant hiring proxy.
 *
 * The proxy is a drop-in replacement for the official OpenAI/Anthropic SDKs: use the
 * official SDK, point `baseURL` at the proxy, and use the proxy token as the API key.
 * A single token works for both providers. Spend is capped — keep calls small and cache.
 *
 * Server-only: this module reads the secret token from the environment and must never be
 * imported into a Client Component. It's used from route handlers / server code.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const TOKEN = process.env.BUOYANT_PROXY_TOKEN;

const ANTHROPIC_BASE_URL =
  process.env.ANTHROPIC_BASE_URL ?? 'https://hiring-proxy.trybuoyant.ai/anthropic';
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? 'https://hiring-proxy.trybuoyant.ai/openai';

/** Model ids. Small = cheap (health checks, structuring); Main = quality (edits). */
export const AI_MODELS = {
  anthropicSmall: process.env.ANTHROPIC_SMALL_MODEL ?? 'claude-haiku-4-5-20251001',
  anthropicMain: process.env.ANTHROPIC_MAIN_MODEL ?? 'claude-sonnet-4-5',
  openaiSmall: process.env.OPENAI_SMALL_MODEL ?? 'gpt-4o-mini',
} as const;

/** True when the proxy token is present. Lets routes degrade gracefully instead of throwing. */
export function isAiConfigured(): boolean {
  return typeof TOKEN === 'string' && TOKEN.length > 0;
}

// The Buoyant proxy returns compressed bodies that fail to decode in the Node/undici
// fetch the SDKs use here (garbled bytes → "not valid JSON"). Forcing an identity
// (uncompressed) response avoids the broken decode path. Verified: with the SDK default
// Accept-Encoding the call errors; with identity it returns cleanly.
const PROXY_HEADERS = { 'accept-encoding': 'identity' } as const;
// Chat's 12-call budget can form four sequential waves (plan + 2 edit waves + repair wave).
// Twenty-five seconds keeps that worst case under its 120-second route limit.
const PROXY_TIMEOUT_MS = 25_000;

export function getAnthropic(): Anthropic {
  if (!isAiConfigured()) throw new Error('BUOYANT_PROXY_TOKEN is not set');
  return new Anthropic({
    apiKey: TOKEN,
    baseURL: ANTHROPIC_BASE_URL,
    defaultHeaders: PROXY_HEADERS,
    maxRetries: 0,
    timeout: PROXY_TIMEOUT_MS,
  });
}

export function getOpenAI(): OpenAI {
  if (!isAiConfigured()) throw new Error('BUOYANT_PROXY_TOKEN is not set');
  return new OpenAI({
    apiKey: TOKEN,
    baseURL: OPENAI_BASE_URL,
    defaultHeaders: PROXY_HEADERS,
    maxRetries: 0,
    timeout: PROXY_TIMEOUT_MS,
  });
}
