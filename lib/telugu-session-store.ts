import type { SarvamChatMessage } from './sarvam-client';

interface SessionState {
  history: SarvamChatMessage[];
  createdAt: number;
  lastUsedAt: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map<string, SessionState>();

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

export function endSession(id: string): void {
  store.delete(id);
}
