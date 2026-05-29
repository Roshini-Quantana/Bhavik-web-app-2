import { getSupabase } from './supabase';
import type { CompanyContext } from './types';

export type Provider = 'sarvam' | 'ultravox';

export interface CreateCallSessionInput {
  leadId: string | null;
  url: string;
  language: string;
  persona: string;
  voice: string;
  provider: Provider;
  ctx: CompanyContext;
}

export async function createCallSession(input: CreateCallSessionInput): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('call_sessions')
    .insert({
      lead_id: input.leadId,
      url: input.url,
      language: input.language,
      persona: input.persona,
      voice: input.voice,
      provider: input.provider,
      company_name: input.ctx.company_name || '',
      summary: input.ctx.summary || '',
      industry: input.ctx.industry || '',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[supabase] createCallSession error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function endCallSession(
  callSessionId: string | null,
  status: 'ended' | 'error' = 'ended',
  errorMessage?: string
): Promise<void> {
  if (!callSessionId) return;
  const sb = getSupabase();
  if (!sb) return;
  // Compute duration from started_at so it stays accurate even if the request
  // is delayed (e.g. the browser sent the end-call event late).
  const { data: existing } = await sb
    .from('call_sessions')
    .select('started_at, status')
    .eq('id', callSessionId)
    .maybeSingle();
  if (existing?.status && existing.status !== 'active') return; // idempotent
  const duration = existing?.started_at
    ? Math.max(0, Math.floor((Date.now() - new Date(existing.started_at).getTime()) / 1000))
    : null;
  const { error } = await sb
    .from('call_sessions')
    .update({
      ended_at: new Date().toISOString(),
      status,
      duration_seconds: duration,
      error_message: errorMessage ?? null,
    })
    .eq('id', callSessionId);
  if (error) console.error('[supabase] endCallSession error:', error.message);
}

export interface RecordTurnInput {
  callSessionId: string | null;
  turnIndex: number;
  speaker: 'user' | 'agent';
  text: string;
  audioPath?: string | null;
  audioFormat?: string | null;
  durationMs?: number | null;
}

export async function recordTurn(input: RecordTurnInput): Promise<void> {
  if (!input.callSessionId) return;
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from('call_turns').insert({
    session_id: input.callSessionId,
    turn_index: input.turnIndex,
    speaker: input.speaker,
    text: input.text || '',
    audio_path: input.audioPath ?? null,
    audio_format: input.audioFormat ?? null,
    duration_ms: input.durationMs ?? null,
  });
  if (error) console.error('[supabase] recordTurn error:', error.message);
}
