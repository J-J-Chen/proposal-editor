import { NextResponse } from 'next/server';
import { AI_MODELS, getAnthropic, isAiConfigured } from '@/lib/ai';

// Never cache — this reflects live proxy state.
export const dynamic = 'force-dynamic';

/**
 * GET /api/health/ai
 * Proves the Buoyant proxy is reachable and authenticated in whatever environment this
 * runs in (crucially: the deployed one). Makes one tiny, cheap Anthropic call.
 */
export async function GET() {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, message: 'BUOYANT_PROXY_TOKEN is not set' },
      { status: 503 },
    );
  }

  const started = Date.now();
  try {
    const anthropic = getAnthropic();
    const res = await anthropic.messages.create({
      model: AI_MODELS.anthropicSmall,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
    });
    const reply = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    return NextResponse.json({
      ok: true,
      configured: true,
      provider: 'anthropic',
      model: AI_MODELS.anthropicSmall,
      latencyMs: Date.now() - started,
      reply,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
