import type { SarvamChatMessage } from './sarvam-client';

interface SessionState {
  history: SarvamChatMessage[];
  createdAt: number;
  lastUsedAt: number;
  // Supabase linkage (nullable when Supabase isn't configured).
  callSessionId: string | null;
  leadId: string | null;
  // Monotonic turn counter shared by user + agent so audio paths sort cleanly.
  nextTurnIndex: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// In Next.js dev each API route compiles into its own bundle and would
// otherwise get a fresh Map per bundle — a session created in
// /api/telugu-start would then be invisible to /api/telugu-turn, causing
// every turn to 404 with "session expired or unknown". Pin the Map on
// globalThis so both route bundles (and HMR reloads) share one instance.
const globalForStore = globalThis as unknown as {
  __teluguSessionStore?: Map<string, SessionState>;
};
const store: Map<string, SessionState> =
  globalForStore.__teluguSessionStore ??
  (globalForStore.__teluguSessionStore = new Map<string, SessionState>());

function sweep() {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.lastUsedAt > TTL_MS) store.delete(id);
  }
}

export function createSession(systemPrompt: string): string {
  sweep();
  const id = 'tg_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set(id, {
    history: [{ role: 'system', content: systemPrompt }],
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    callSessionId: null,
    leadId: null,
    nextTurnIndex: 0,
  });
  return id;
}

export function getSession(id: string): SessionState | null {
  const s = store.get(id);
  if (!s) return null;
  if (Date.now() - s.lastUsedAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return s;
}

export function appendTurn(id: string, role: 'user' | 'assistant', content: string): boolean {
  const s = store.get(id);
  if (!s) return false;
  s.history.push({ role, content });
  s.lastUsedAt = Date.now();
  return true;
}

export function attachSupabase(id: string, callSessionId: string | null, leadId: string | null): void {
  const s = store.get(id);
  if (!s) return;
  s.callSessionId = callSessionId;
  s.leadId = leadId;
}

export function nextTurnIndex(id: string): number {
  const s = store.get(id);
  if (!s) return 0;
  const idx = s.nextTurnIndex;
  s.nextTurnIndex = idx + 1;
  return idx;
}

export function endSession(id: string): void {
  store.delete(id);
}
