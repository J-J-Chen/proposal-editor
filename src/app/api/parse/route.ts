// STUB — replaced by Track A (real hybrid parse + cache-by-hash).
// Returns the mock fixture Doc so the frontend (Tracks B/D) can build with zero backend.
import { NextResponse } from 'next/server';
import type { ParseResponse } from '@/lib/contracts';
import easyDoc from '@/fixtures/easy.doc.json';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res: ParseResponse = { doc: easyDoc as ParseResponse['doc'], cached: false };
  return NextResponse.json(res);
}
