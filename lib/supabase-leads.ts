import { getSupabase } from './supabase';
import type { CompanyContext } from './types';

export interface UpsertLeadInput {
  url: string;
  ctx: CompanyContext;
}

// Upsert by URL and return the lead's id. Returns null when Supabase is not
// configured or the write fails — callers persist what they can without it.
export async function upsertLead({ url, ctx }: UpsertLeadInput): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload: Record<string, unknown> = { url };
  if (ctx.company_name) payload.company_name = ctx.company_name;
  if (ctx.summary) payload.summary = ctx.summary;
  if (ctx.industry) payload.industry = ctx.industry;
  if (ctx.services && ctx.services.length) payload.services = ctx.services;

  const { data, error } = await sb
    .from('leads')
    .upsert(payload, { onConflict: 'url' })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[supabase] upsertLead error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

// Atomic increment via SQL function (see migration). Bumps call_count,
// sets first/last called timestamps, and flips status new → called.
export async function markLeadCalled(leadId: string | null): Promise<void> {
  if (!leadId) return;
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc('mark_lead_called', { p_lead_id: leadId });
  if (error) console.error('[supabase] markLeadCalled error:', error.message);
}
