import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let warnedMissing = false;

// Project URL is the same value whether read server-side or shipped to the
// browser, so accept either name. .env.example documents the NEXT_PUBLIC_ form.
function readSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function isSupabaseConfigured(): boolean {
  return !!(readSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Server-only singleton — uses the service-role key so we don't need RLS yet.
// Returns null when env vars are missing so callers can degrade gracefully.
export function getSupabase(): SupabaseClient | null {
  const url = readSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Loud-once warning — silent "graceful degradation" hides "nothing saves"
    // bugs caused by an env var name mismatch.
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(
        '[supabase] not configured — set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local. Persistence is disabled.'
      );
    }
    return null;
  }
  if (cachedClient) return cachedClient;
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

export const AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET ?? 'call-audio';
