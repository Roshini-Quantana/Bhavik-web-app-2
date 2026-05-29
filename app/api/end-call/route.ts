import { NextRequest, NextResponse } from 'next/server';
import { endCallSession } from '@/lib/supabase-sessions';

export const runtime = 'nodejs';

interface Body {
  callSessionId?: string;
  status?: 'ended' | 'error';
  errorMessage?: string;
}

// Idempotent: marks the call_session row as ended and stamps duration_seconds.
// Browser fires-and-forgets this on END CALL — failures are swallowed so the
// hang-up never blocks UI cleanup.
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.callSessionId) {
    return NextResponse.json({ ok: true, skipped: 'no callSessionId' });
  }
  await endCallSession(body.callSessionId, body.status ?? 'ended', body.errorMessage);
  return NextResponse.json({ ok: true });
}
