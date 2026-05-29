import { getSupabase } from './supabase';
import type { CompanyContext } from './types';

export type CacheSource = 'n8n' | 'fallback' | 'manual';

// Return a cached context only if it has not expired. Missing config or any
// Supabase error short-circuits to null so the caller falls back to live scrape.
export async function getCachedCompany(url: string): Promise<CompanyContext | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('company_cache')
    .select('company_name, summary, industry, services')
    .eq('url', url)
    .gt('ttl_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return {
    company_name: String(data.company_name ?? ''),
    summary: String(data.summary ?? ''),
    industry: String(data.industry ?? ''),
    services: Array.isArray(data.services) ? data.services.map(String) : [],
  };
}

export async function putCachedCompany(
  url: string,
  ctx: CompanyContext,
  source: CacheSource
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // Skip totally empty contexts — re-scrape next time is cheaper than caching junk.
  if (!ctx.company_name && !ctx.summary && !ctx.industry) return;
  const now = new Date();
  const ttl = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const { error } = await sb.from('company_cache').upsert(
    {
      url,
      company_name: ctx.company_name,
      summary: ctx.summary,
      industry: ctx.industry,
      services: ctx.services ?? [],
      source,
      scraped_at: now.toISOString(),
      ttl_at: ttl.toISOString(),
    },
    { onConflict: 'url' }
  );
  if (error) console.error('[supabase] putCachedCompany error:', error.message);
}
