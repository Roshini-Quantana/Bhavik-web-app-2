# Post-Call Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "what happens AFTER the call" layer: transcript persistence on hang-up, LLM extraction of structured insights via n8n, an admin review dashboard, and human-approved n8n follow-up email automation. All additive — existing voice/scrape/transcript features remain unchanged.

**Architecture:**
- Browser end-call now POSTs the live transcript array alongside the existing call-end event; server persists turns and fires-and-forgets a call to the new extraction route.
- Extraction route hits an n8n webhook that runs an LLM node and returns structured JSON; result is stored in a new `call_sessions.extracted_data` JSONB column.
- New `/admin` area (password-gated) lists completed calls, lets a human review/edit the extracted summary + email, then triggers a second n8n webhook for sending. The app itself never sends email directly.

**Tech Stack:** Next.js 14 App Router (existing), Supabase Postgres (existing), n8n (existing — adding two new workflows), vitest (existing), iron-style cookie auth via `jose` or HMAC.

---

## File Structure

**New files:**
- `supabase/migrations/0002_followup.sql` — extends `call_sessions` with extraction + follow-up columns
- `lib/admin-auth.ts` — HMAC-signed cookie helpers (no new deps; uses Node `crypto`)
- `lib/extractor.ts` — calls the n8n extraction webhook with timeout + fallback heuristic
- `lib/followup-client.ts` — POSTs approved follow-ups to the n8n follow-up webhook
- `lib/supabase-followup.ts` — DB helpers for extraction read/write and follow-up status transitions
- `app/api/extract-call/route.ts` — POST `{ callSessionId }` → fetches turns → n8n LLM → writes `extracted_data`
- `app/api/send-follow-up/route.ts` — POST `{ callSessionId, email?, summary? }` → calls n8n follow-up webhook
- `app/api/admin/login/route.ts` — POST `{ password }` → sets signed cookie
- `app/api/admin/logout/route.ts` — POST → clears cookie
- `app/api/admin/calls/route.ts` — GET list of reviewable calls (paginated)
- `app/api/admin/calls/[id]/route.ts` — GET single call + transcript + extracted data
- `app/admin/layout.tsx` — admin shell, redirects to `/admin/login` when cookie missing
- `app/admin/login/page.tsx` — password form
- `app/admin/calls/page.tsx` — call list (server component)
- `app/admin/calls/[id]/page.tsx` — call detail + transcript + edit form + send button (server + client island)
- `app/admin/calls/[id]/ReviewActions.tsx` — client component for edit + send
- `app/admin/admin.css` — scoped admin styles
- `n8n/bhavik-extract-workflow.json` — webhook → LLM node → JSON response
- `n8n/bhavik-followup-workflow.json` — webhook → email template → Gmail/Resend send

**Modified files:**
- `lib/supabase-sessions.ts` — add `recordTurnsBatch` helper (recordTurn already exists; we add the batch variant)
- `lib/types.ts` — add `ExtractedData`, `FollowUpStatus`, transcript message shape used by end-call
- `app/api/end-call/route.ts` — accept optional `transcript` array, persist turns, fire-and-forget extraction
- `app/page.tsx` — pass `messages` array to `/api/end-call` on hang-up (both ultravox and telugu)
- `lib/use-telugu.ts` — expose `messages` so the page can pass them through (only if not already exposed; verify in Task 0)
- `.env.example` — document `N8N_EXTRACT_WEBHOOK_URL`, `N8N_FOLLOWUP_WEBHOOK_URL`, `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET`
- `README.md` — document admin URL and the new env vars

**Untouched (do not edit):**
- `app/api/prepare-context/route.ts`, `app/api/telugu-start/route.ts`, `app/api/telugu-turn/route.ts`
- `lib/use-ultravox.ts`, `lib/scraper-fallback.ts`, `lib/prompt-builder.ts`, `lib/voice-map.ts`, `lib/ultravox-create-call.ts`
- All component files except as noted

---

## Task 0: Preflight Verification

**Files:** read-only

- [ ] **Step 1: Verify `recordTurn` exists and call_sessions has expected columns**

Run:
```powershell
Select-String -Path "lib\supabase-sessions.ts" -Pattern "recordTurn"
Get-Content "supabase\migrations\0001_init.sql" | Select-String "extracted_data|follow_up"
```
Expected: `recordTurn` found in `supabase-sessions.ts`. **No** match for `extracted_data` or `follow_up` (confirms migration 0002 is needed).

- [ ] **Step 2: Confirm `use-telugu.ts` exposes a `messages` array**

Run:
```powershell
Select-String -Path "lib\use-telugu.ts" -Pattern "messages" -Context 0,2
```
Expected: `messages:` field returned by the hook. If absent, note this — Task 9 will branch on whether to expose it.

- [ ] **Step 3: Confirm tests still pass before any changes**

Run: `npm test`
Expected: existing suites pass (`prompt-builder`, `sarvam-client`, `scraper-fallback`, `url-validator`, `voice-map`).

---

## Task 1: Schema migration — extraction + follow-up columns

**Files:**
- Create: `supabase/migrations/0002_followup.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0002 — post-call extraction + human-reviewed follow-up workflow.
-- Additive to 0001. Safe to run multiple times.

alter table public.call_sessions
  add column if not exists extracted_data    jsonb,
  add column if not exists extracted_at      timestamptz,
  add column if not exists follow_up_status  text not null default 'none',
  add column if not exists follow_up_email   text,
  add column if not exists follow_up_summary text,
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_error   text;

-- Status lifecycle:
--   'none'      — extraction not yet run (default)
--   'pending'   — extracted; awaiting human review
--   'approved'  — human clicked Send; webhook in flight
--   'sent'      — n8n confirmed send
--   'skipped'   — human chose not to send
--   'failed'    — webhook returned error
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'call_sessions_follow_up_status_chk'
  ) then
    alter table public.call_sessions
      add constraint call_sessions_follow_up_status_chk
      check (follow_up_status in ('none','pending','approved','sent','skipped','failed'));
  end if;
end$$;

create index if not exists call_sessions_followup_status_idx
  on public.call_sessions (follow_up_status);
create index if not exists call_sessions_pending_review_idx
  on public.call_sessions (follow_up_status, started_at desc)
  where follow_up_status = 'pending';
```

- [ ] **Step 2: Run the migration in Supabase SQL editor**

Open `https://app.supabase.com/project/_/sql/new`, paste the entire file, click **Run**.
Expected: "Success. No rows returned." No errors about existing columns (the `if not exists` guards make it idempotent).

- [ ] **Step 3: Verify columns exist**

Run this in the SQL editor:
```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'call_sessions'
  and column_name in ('extracted_data','extracted_at','follow_up_status',
                      'follow_up_email','follow_up_summary','follow_up_sent_at','follow_up_error');
```
Expected: 7 rows returned, `extracted_data` is `jsonb`, the rest are `text` / `timestamp with time zone`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/0002_followup.sql
git commit -m "feat(db): add extraction + follow-up columns to call_sessions"
```

---

## Task 2: Types for extracted data and follow-up status

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Append types to `lib/types.ts`**

Open `lib/types.ts` and append (do not remove anything existing):

```typescript
// ---- Post-call workflow ----

export type FollowUpStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'sent'
  | 'skipped'
  | 'failed';

export interface ExtractedData {
  interest_level: 'low' | 'medium' | 'high' | 'unknown';
  follow_up_needed: boolean;
  meeting_interest: boolean;
  email_confirmed: boolean;
  email: string;
  summary: string;
  notes?: string;
  preferred_time?: string;
}

// Shape the browser sends to /api/end-call when posting the live transcript.
export interface EndCallTranscriptMsg {
  speaker: 'agent' | 'user';
  text: string;
}

export interface EndCallRequest {
  callSessionId?: string;
  status?: 'ended' | 'error';
  errorMessage?: string;
  transcript?: EndCallTranscriptMsg[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add lib/types.ts
git commit -m "feat(types): add ExtractedData + FollowUpStatus + EndCallRequest"
```

---

## Task 3: Supabase helpers — batch turn insert + follow-up reads/writes

**Files:**
- Modify: `lib/supabase-sessions.ts`
- Create: `lib/supabase-followup.ts`
- Create: `lib/supabase-sessions.batch.test.ts`

- [ ] **Step 1: Write a failing test for `recordTurnsBatch`**

Create `lib/supabase-sessions.batch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
vi.mock('./supabase', () => ({
  getSupabase: () => ({ from: fromMock }),
  AUDIO_BUCKET: 'call-audio',
}));

import { recordTurnsBatch } from './supabase-sessions';

beforeEach(() => {
  insertMock.mockReset();
  fromMock.mockClear();
  insertMock.mockResolvedValue({ error: null });
});

describe('recordTurnsBatch', () => {
  it('returns early without insert when callSessionId is null', async () => {
    await recordTurnsBatch(null, [{ speaker: 'user', text: 'hi' }]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns early without insert when transcript is empty', async () => {
    await recordTurnsBatch('abc', []);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('inserts rows with monotonic turn_index starting at 0', async () => {
    await recordTurnsBatch('sess-1', [
      { speaker: 'agent', text: 'hello' },
      { speaker: 'user',  text: 'hi'    },
      { speaker: 'agent', text: 'bye'   },
    ]);
    expect(fromMock).toHaveBeenCalledWith('call_turns');
    const rows = insertMock.mock.calls[0][0];
    expect(rows).toEqual([
      { session_id: 'sess-1', turn_index: 0, speaker: 'agent', text: 'hello' },
      { session_id: 'sess-1', turn_index: 1, speaker: 'user',  text: 'hi'    },
      { session_id: 'sess-1', turn_index: 2, speaker: 'agent', text: 'bye'   },
    ]);
  });

  it('drops empty-text turns', async () => {
    await recordTurnsBatch('sess-2', [
      { speaker: 'agent', text: '   '  },
      { speaker: 'user',  text: 'hi'   },
    ]);
    const rows = insertMock.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('hi');
    expect(rows[0].turn_index).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run lib/supabase-sessions.batch.test.ts`
Expected: FAIL — `recordTurnsBatch` is not exported.

- [ ] **Step 3: Add `recordTurnsBatch` to `lib/supabase-sessions.ts`**

Append to `lib/supabase-sessions.ts` (do not modify existing exports):

```typescript
export interface BatchTurnInput {
  speaker: 'user' | 'agent';
  text: string;
}

export async function recordTurnsBatch(
  callSessionId: string | null,
  turns: BatchTurnInput[]
): Promise<void> {
  if (!callSessionId) return;
  const clean = turns.filter((t) => t.text && t.text.trim().length > 0);
  if (clean.length === 0) return;
  const sb = getSupabase();
  if (!sb) return;
  const rows = clean.map((t, i) => ({
    session_id: callSessionId,
    turn_index: i,
    speaker: t.speaker,
    text: t.text,
  }));
  const { error } = await sb.from('call_turns').insert(rows);
  if (error) console.error('[supabase] recordTurnsBatch error:', error.message);
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run lib/supabase-sessions.batch.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Create `lib/supabase-followup.ts`**

```typescript
import { getSupabase } from './supabase';
import type { ExtractedData, FollowUpStatus } from './types';

export interface CallSessionRow {
  id: string;
  url: string;
  company_name: string;
  summary: string;
  industry: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: string;
  extracted_data: ExtractedData | null;
  extracted_at: string | null;
  follow_up_status: FollowUpStatus;
  follow_up_email: string | null;
  follow_up_summary: string | null;
  follow_up_sent_at: string | null;
  follow_up_error: string | null;
}

export interface TurnRow {
  turn_index: number;
  speaker: 'user' | 'agent';
  text: string;
}

export async function listReviewableCalls(limit = 50): Promise<CallSessionRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('call_sessions')
    .select(
      'id,url,company_name,summary,industry,started_at,ended_at,duration_seconds,status,extracted_data,extracted_at,follow_up_status,follow_up_email,follow_up_summary,follow_up_sent_at,follow_up_error'
    )
    .neq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[supabase] listReviewableCalls error:', error.message);
    return [];
  }
  return (data ?? []) as CallSessionRow[];
}

export async function getCallSession(id: string): Promise<CallSessionRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('call_sessions')
    .select(
      'id,url,company_name,summary,industry,started_at,ended_at,duration_seconds,status,extracted_data,extracted_at,follow_up_status,follow_up_email,follow_up_summary,follow_up_sent_at,follow_up_error'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[supabase] getCallSession error:', error.message);
    return null;
  }
  return (data as CallSessionRow) ?? null;
}

export async function getCallTurns(callSessionId: string): Promise<TurnRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('call_turns')
    .select('turn_index,speaker,text')
    .eq('session_id', callSessionId)
    .order('turn_index', { ascending: true });
  if (error) {
    console.error('[supabase] getCallTurns error:', error.message);
    return [];
  }
  return (data ?? []) as TurnRow[];
}

export async function saveExtraction(
  callSessionId: string,
  extracted: ExtractedData
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('call_sessions')
    .update({
      extracted_data: extracted,
      extracted_at: new Date().toISOString(),
      follow_up_status: 'pending',
      // Pre-populate review fields from extraction so the admin can just tweak + send.
      follow_up_email: extracted.email || null,
      follow_up_summary: extracted.summary || null,
    })
    .eq('id', callSessionId)
    .eq('follow_up_status', 'none'); // only first extraction transitions to pending
  if (error) console.error('[supabase] saveExtraction error:', error.message);
}

export async function updateFollowUpFields(
  callSessionId: string,
  fields: { follow_up_email?: string; follow_up_summary?: string }
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const patch: Record<string, string> = {};
  if (typeof fields.follow_up_email === 'string') patch.follow_up_email = fields.follow_up_email;
  if (typeof fields.follow_up_summary === 'string') patch.follow_up_summary = fields.follow_up_summary;
  if (Object.keys(patch).length === 0) return;
  const { error } = await sb
    .from('call_sessions')
    .update(patch)
    .eq('id', callSessionId);
  if (error) console.error('[supabase] updateFollowUpFields error:', error.message);
}

export async function setFollowUpStatus(
  callSessionId: string,
  status: FollowUpStatus,
  extras: { sentAt?: string; error?: string | null } = {}
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const patch: Record<string, unknown> = { follow_up_status: status };
  if (extras.sentAt) patch.follow_up_sent_at = extras.sentAt;
  if (extras.error !== undefined) patch.follow_up_error = extras.error;
  const { error } = await sb
    .from('call_sessions')
    .update(patch)
    .eq('id', callSessionId);
  if (error) console.error('[supabase] setFollowUpStatus error:', error.message);
}
```

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: no TS errors. All tests pass.

- [ ] **Step 7: Commit**

```powershell
git add lib/supabase-sessions.ts lib/supabase-sessions.batch.test.ts lib/supabase-followup.ts
git commit -m "feat(supabase): batch turn insert + follow-up helpers"
```

---

## Task 4: Extractor client — n8n webhook + safe fallback

**Files:**
- Create: `lib/extractor.ts`
- Create: `lib/extractor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractInsights, fallbackExtract } from './extractor';
import type { TurnRow } from './supabase-followup';

const turns: TurnRow[] = [
  { turn_index: 0, speaker: 'agent', text: 'Would you be interested in automation?' },
  { turn_index: 1, speaker: 'user',  text: 'Yes, maybe next week. Send details to info@sportsplus.app.' },
];

describe('fallbackExtract', () => {
  it('detects "yes" + email + medium interest', () => {
    const out = fallbackExtract(turns, 'info@example.com');
    expect(out.email).toBe('info@sportsplus.app');
    expect(out.follow_up_needed).toBe(true);
    expect(out.email_confirmed).toBe(true);
    expect(out.interest_level === 'medium' || out.interest_level === 'high').toBe(true);
  });

  it('falls back to context email when transcript has none', () => {
    const out = fallbackExtract(
      [{ turn_index: 0, speaker: 'user', text: 'Maybe later.' }],
      'info@example.com'
    );
    expect(out.email).toBe('info@example.com');
    expect(out.email_confirmed).toBe(false);
  });
});

describe('extractInsights', () => {
  const oldEnv = { ...process.env };
  beforeEach(() => { process.env = { ...oldEnv }; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('falls back when N8N_EXTRACT_WEBHOOK_URL not set', async () => {
    delete process.env.N8N_EXTRACT_WEBHOOK_URL;
    const out = await extractInsights(turns, { contextEmail: 'x@y.com' });
    expect(out.source).toBe('fallback');
    expect(out.data.email).toBeDefined();
  });

  it('uses webhook response when set and ok', async () => {
    process.env.N8N_EXTRACT_WEBHOOK_URL = 'https://n8n.example.com/extract';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        interest_level: 'high',
        follow_up_needed: true,
        meeting_interest: true,
        email_confirmed: true,
        email: 'demo@acme.com',
        summary: 'Prospect interested in AI demo.',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const out = await extractInsights(turns, { contextEmail: 'x@y.com' });
    expect(fetchSpy).toHaveBeenCalled();
    expect(out.source).toBe('n8n');
    expect(out.data.email).toBe('demo@acme.com');
    expect(out.data.interest_level).toBe('high');
  });

  it('falls back when webhook returns non-200', async () => {
    process.env.N8N_EXTRACT_WEBHOOK_URL = 'https://n8n.example.com/extract';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const out = await extractInsights(turns, { contextEmail: 'x@y.com' });
    expect(out.source).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run lib/extractor.test.ts`
Expected: FAIL — `extractor` module not found.

- [ ] **Step 3: Implement `lib/extractor.ts`**

```typescript
import type { ExtractedData } from './types';
import type { TurnRow } from './supabase-followup';

export interface ExtractContext {
  contextEmail?: string;
  companyName?: string;
}

export interface ExtractResult {
  source: 'n8n' | 'fallback';
  data: ExtractedData;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function detectInterest(text: string): ExtractedData['interest_level'] {
  const t = text.toLowerCase();
  if (/(definitely|absolutely|love to|yes please|book.*meeting|sign me up)/.test(t)) return 'high';
  if (/(not interested|no thanks|do not|don't (call|email))/.test(t)) return 'low';
  if (/(yes|sure|maybe|interested|sounds good|tell me more|send (me )?details)/.test(t)) return 'medium';
  return 'unknown';
}

export function fallbackExtract(turns: TurnRow[], contextEmail = ''): ExtractedData {
  const userText = turns.filter((t) => t.speaker === 'user').map((t) => t.text).join(' ');
  const allText  = turns.map((t) => t.text).join(' ');
  const emailMatch = allText.match(EMAIL_RE);
  const email = emailMatch?.[0] ?? contextEmail ?? '';
  const interest = detectInterest(userText);
  const wantsTime = /next (week|month)|tomorrow|monday|tuesday|wednesday|thursday|friday/i.exec(userText);
  return {
    interest_level: interest,
    follow_up_needed: interest === 'medium' || interest === 'high',
    meeting_interest: /meeting|demo|call|schedule|book/i.test(userText),
    email_confirmed: !!emailMatch,
    email,
    summary: userText.slice(0, 240) || 'No user speech captured.',
    notes: 'Generated by fallback heuristic (no n8n webhook configured).',
    preferred_time: wantsTime?.[0],
  };
}

function coerceExtracted(raw: unknown, fallback: ExtractedData): ExtractedData {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const lvl = String(r.interest_level ?? '').toLowerCase();
  const validLvl: ExtractedData['interest_level'] =
    lvl === 'high' || lvl === 'medium' || lvl === 'low' ? lvl : 'unknown';
  return {
    interest_level: validLvl,
    follow_up_needed: Boolean(r.follow_up_needed ?? false),
    meeting_interest: Boolean(r.meeting_interest ?? false),
    email_confirmed: Boolean(r.email_confirmed ?? false),
    email: typeof r.email === 'string' ? r.email : fallback.email,
    summary: typeof r.summary === 'string' ? r.summary : fallback.summary,
    notes: typeof r.notes === 'string' ? r.notes : undefined,
    preferred_time: typeof r.preferred_time === 'string' ? r.preferred_time : undefined,
  };
}

export async function extractInsights(
  turns: TurnRow[],
  ctx: ExtractContext
): Promise<ExtractResult> {
  const fb = fallbackExtract(turns, ctx.contextEmail ?? '');
  const url = process.env.N8N_EXTRACT_WEBHOOK_URL;
  if (!url) return { source: 'fallback', data: fb };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: ctx.companyName ?? '',
        context_email: ctx.contextEmail ?? '',
        transcript: turns.map((t) => ({ speaker: t.speaker, text: t.text })),
      }),
    });
    if (!res.ok) return { source: 'fallback', data: fb };
    const json = await res.json().catch(() => null);
    return { source: 'n8n', data: coerceExtracted(json, fb) };
  } catch {
    return { source: 'fallback', data: fb };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/extractor.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```powershell
git add lib/extractor.ts lib/extractor.test.ts
git commit -m "feat(extractor): n8n webhook client with heuristic fallback"
```

---

## Task 5: Follow-up client — POST to n8n send webhook

**Files:**
- Create: `lib/followup-client.ts`
- Create: `lib/followup-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendFollowUp } from './followup-client';

const oldEnv = { ...process.env };
beforeEach(() => { process.env = { ...oldEnv }; });
afterEach(() => { vi.restoreAllMocks(); });

describe('sendFollowUp', () => {
  it('returns skipped:true when webhook env not set', async () => {
    delete process.env.N8N_FOLLOWUP_WEBHOOK_URL;
    const r = await sendFollowUp({ email: 'a@b.com', company: 'X', summary: 'hi', callSessionId: 'id' });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('posts JSON to webhook and returns ok on 200', async () => {
    process.env.N8N_FOLLOWUP_WEBHOOK_URL = 'https://n8n.example.com/followup';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', { status: 200 })
    );
    const r = await sendFollowUp({ email: 'a@b.com', company: 'X', summary: 'hi', callSessionId: 'id' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('https://n8n.example.com/followup');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false with error on non-2xx', async () => {
    process.env.N8N_FOLLOWUP_WEBHOOK_URL = 'https://n8n.example.com/followup';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const r = await sendFollowUp({ email: 'a@b.com', company: 'X', summary: 'hi', callSessionId: 'id' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/followup-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/followup-client.ts`**

```typescript
export interface FollowUpPayload {
  callSessionId: string;
  company: string;
  email: string;
  summary: string;
}

export interface FollowUpResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function sendFollowUp(p: FollowUpPayload): Promise<FollowUpResult> {
  const url = process.env.N8N_FOLLOWUP_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, error: 'N8N_FOLLOWUP_WEBHOOK_URL not set' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) return { ok: false, error: `webhook responded ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Verify passing + commit**

Run: `npx vitest run lib/followup-client.test.ts`
Expected: 3 passing.

```powershell
git add lib/followup-client.ts lib/followup-client.test.ts
git commit -m "feat(followup): n8n webhook client for human-approved sends"
```

---

## Task 6: Admin auth — HMAC-signed cookie

**Files:**
- Create: `lib/admin-auth.ts`
- Create: `lib/admin-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { signSession, verifySession } from './admin-auth';

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = 'test-secret-please-change';
});

describe('signSession / verifySession', () => {
  it('round-trips a signed token within ttl', () => {
    const tok = signSession({ ttlMs: 60_000 });
    expect(verifySession(tok)).toBe(true);
  });

  it('rejects a token with a tampered payload', () => {
    const tok = signSession({ ttlMs: 60_000 });
    const [payload, sig] = tok.split('.');
    const tampered = Buffer.from(payload, 'base64url').toString('utf8').replace(/\d/g, '9');
    const bad = Buffer.from(tampered).toString('base64url') + '.' + sig;
    expect(verifySession(bad)).toBe(false);
  });

  it('rejects an expired token', () => {
    const tok = signSession({ ttlMs: -1 });
    expect(verifySession(tok)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifySession('')).toBe(false);
    expect(verifySession('no-dot')).toBe(false);
    expect(verifySession('a.b.c')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/admin-auth.test.ts`

- [ ] **Step 3: Implement `lib/admin-auth.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'bhavik_admin';

function getSecret(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error('ADMIN_COOKIE_SECRET missing or too short (min 16 chars)');
  }
  return s;
}

function hmac(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export interface SignOptions {
  ttlMs?: number; // default 12h
}

export function signSession(opts: SignOptions = {}): string {
  const ttl = opts.ttlMs ?? 12 * 60 * 60 * 1000;
  const payload = JSON.stringify({ exp: Date.now() + ttl });
  const p64 = Buffer.from(payload).toString('base64url');
  return `${p64}.${hmac(p64)}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [p64, sig] = parts;
  const expected = hmac(p64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function cookieName(): string {
  return COOKIE_NAME;
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run lib/admin-auth.test.ts`
Expected: 4 passing.

```powershell
git add lib/admin-auth.ts lib/admin-auth.test.ts
git commit -m "feat(admin): HMAC-signed cookie + password check"
```

---

## Task 7: Extract-call API route

**Files:**
- Create: `app/api/extract-call/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCallSession, getCallTurns, saveExtraction } from '@/lib/supabase-followup';
import { extractInsights } from '@/lib/extractor';

export const runtime = 'nodejs';

interface Body {
  callSessionId?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.callSessionId) {
    return NextResponse.json({ error: 'callSessionId required' }, { status: 400 });
  }

  const session = await getCallSession(body.callSessionId);
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  // Idempotent: if already extracted, return existing.
  if (session.extracted_data) {
    return NextResponse.json({ ok: true, alreadyExtracted: true, data: session.extracted_data });
  }

  const turns = await getCallTurns(body.callSessionId);
  if (turns.length === 0) {
    return NextResponse.json({ ok: false, error: 'no turns recorded' }, { status: 422 });
  }

  const result = await extractInsights(turns, {
    contextEmail: '',
    companyName: session.company_name,
  });
  await saveExtraction(body.callSessionId, result.data);
  return NextResponse.json({ ok: true, source: result.source, data: result.data });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/extract-call/route.ts
git commit -m "feat(api): extract-call route — turns → n8n LLM → extracted_data"
```

---

## Task 8: Send-follow-up API route

**Files:**
- Create: `app/api/send-follow-up/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getCallSession,
  setFollowUpStatus,
  updateFollowUpFields,
} from '@/lib/supabase-followup';
import { sendFollowUp } from '@/lib/followup-client';
import { verifySession, cookieName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

interface Body {
  callSessionId?: string;
  email?: string;
  summary?: string;
  skip?: boolean;
}

export async function POST(req: NextRequest) {
  const tok = cookies().get(cookieName())?.value;
  if (!verifySession(tok)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.callSessionId) {
    return NextResponse.json({ error: 'callSessionId required' }, { status: 400 });
  }

  await updateFollowUpFields(body.callSessionId, {
    follow_up_email: body.email,
    follow_up_summary: body.summary,
  });

  if (body.skip) {
    await setFollowUpStatus(body.callSessionId, 'skipped');
    return NextResponse.json({ ok: true, skipped: true });
  }

  const session = await getCallSession(body.callSessionId);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  const email = body.email ?? session.follow_up_email ?? '';
  const summary = body.summary ?? session.follow_up_summary ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 422 });
  }

  await setFollowUpStatus(body.callSessionId, 'approved');
  const result = await sendFollowUp({
    callSessionId: body.callSessionId,
    company: session.company_name,
    email,
    summary,
  });
  if (result.ok) {
    await setFollowUpStatus(body.callSessionId, 'sent', { sentAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  await setFollowUpStatus(body.callSessionId, 'failed', { error: result.error ?? 'unknown' });
  return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`

```powershell
git add app/api/send-follow-up/route.ts
git commit -m "feat(api): send-follow-up route — admin-gated n8n trigger"
```

---

## Task 9: Extend `/api/end-call` to persist turns + trigger extraction

**Files:**
- Modify: `app/api/end-call/route.ts`

- [ ] **Step 1: Replace handler**

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { endCallSession, recordTurnsBatch } from '@/lib/supabase-sessions';
import type { EndCallRequest } from '@/lib/types';

export const runtime = 'nodejs';

function originFrom(req: NextRequest): string {
  // Same-origin self-call: use the incoming request's origin so the trigger
  // works in dev, preview, and prod without extra env vars.
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  let body: EndCallRequest;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.callSessionId) {
    return NextResponse.json({ ok: true, skipped: 'no callSessionId' });
  }

  await endCallSession(body.callSessionId, body.status ?? 'ended', body.errorMessage);

  if (Array.isArray(body.transcript) && body.transcript.length > 0) {
    await recordTurnsBatch(
      body.callSessionId,
      body.transcript.map((m) => ({ speaker: m.speaker, text: m.text }))
    );
  }

  // Fire-and-forget extraction. Failures must never block the END CALL response.
  const origin = originFrom(req);
  void fetch(`${origin}/api/extract-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callSessionId: body.callSessionId }),
    keepalive: true,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/end-call/route.ts
git commit -m "feat(api): end-call persists turns + triggers extraction"
```

---

## Task 10: Browser — send transcript on hang-up

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update the `end` callback to include transcript**

Find this block in `app/page.tsx`:

```typescript
  const end = useCallback(async () => {
    log('Ending call…');
    if (isTelugu) {
      tg.end(); // hook fires its own /api/end-call
    } else {
      await ux.leave();
      const cs = ultravoxCallSessionId;
      setUltravoxCallSessionId(null);
      if (cs) {
        void fetch('/api/end-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callSessionId: cs, status: 'ended' }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }, [log, isTelugu, tg, ux, ultravoxCallSessionId]);
```

Replace with:

```typescript
  const end = useCallback(async () => {
    log('Ending call…');
    // Snapshot transcript BEFORE leaving so the underlying session can be torn down.
    const finalMessages = (isTelugu ? tg.messages : ux.messages)
      .filter((m) => m.final !== false && m.text && m.text.trim().length > 0)
      .map((m) => ({ speaker: m.speaker, text: m.text }));

    if (isTelugu) {
      tg.end(); // hook fires its own /api/end-call (without transcript — telugu turns are saved per-turn)
    } else {
      await ux.leave();
      const cs = ultravoxCallSessionId;
      setUltravoxCallSessionId(null);
      if (cs) {
        void fetch('/api/end-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callSessionId: cs,
            status: 'ended',
            transcript: finalMessages,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }, [log, isTelugu, tg, ux, ultravoxCallSessionId]);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If TS complains that `tg.messages` doesn't include `.final`, widen the filter to `m.final !== false`.)

- [ ] **Step 3: Manual smoke test (dev)**

Run: `npm run dev`. Open `http://localhost:3000`. Start a call, say "yes I'm interested, email me at test@example.com", hang up. In Supabase SQL editor:

```sql
select id, follow_up_status, extracted_data
from call_sessions
order by started_at desc limit 1;
```

Expected (within a few seconds of hang-up): `follow_up_status = 'pending'`, `extracted_data` populated.

If `extracted_data` is null after 30s, check server logs for `[supabase] recordTurnsBatch error` or `extract-call` errors.

- [ ] **Step 4: Commit**

```powershell
git add app/page.tsx
git commit -m "feat(page): send live transcript with end-call event"
```

---

## Task 11: Admin login API + page

**Files:**
- Create: `app/api/admin/login/route.ts`
- Create: `app/api/admin/logout/route.ts`
- Create: `app/admin/layout.tsx`
- Create: `app/admin/login/page.tsx`
- Create: `app/admin/admin.css`

- [ ] **Step 1: `app/api/admin/login/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkPassword, signSession, cookieName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

interface Body { password?: string }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.password || !checkPassword(body.password)) {
    return NextResponse.json({ error: 'invalid password' }, { status: 401 });
  }
  const tok = signSession({ ttlMs: 12 * 60 * 60 * 1000 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), tok, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return res;
}
```

- [ ] **Step 2: `app/api/admin/logout/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookieName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), '', { path: '/', maxAge: 0 });
  return res;
}
```

- [ ] **Step 3: `app/admin/layout.tsx`** (gates everything under `/admin` except the login page)

```typescript
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { verifySession, cookieName } from '@/lib/admin-auth';
import './admin.css';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = headers().get('x-invoke-path') ?? '';
  const isLogin = pathname.endsWith('/admin/login');
  const tok = cookies().get(cookieName())?.value;
  if (!isLogin && !verifySession(tok)) {
    redirect('/admin/login');
  }
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <span className="admin-brand">BHAVIK · REVIEW</span>
        {!isLogin && (
          <form action="/api/admin/logout" method="post">
            <button className="admin-link" type="submit">Logout</button>
          </form>
        )}
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
```

> **Note:** Next 14 may not set `x-invoke-path` reliably for nested layouts. If `redirect` loops on `/admin/login`, replace the `isLogin` detection with `cookies().get(cookieName())?.value` check only, and let the login page render unconditionally (the login API itself enforces the password). The fallback approach is shown in Step 6 below.

- [ ] **Step 4: `app/admin/login/page.tsx`**

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (!res.ok) { setErr('Invalid password'); return; }
    router.push('/admin/calls');
    router.refresh();
  }

  return (
    <div className="admin-login">
      <h1>Admin sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          <span>Password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <p className="admin-error">{err}</p>}
      </form>
    </div>
  );
}
```

- [ ] **Step 5: `app/admin/admin.css`**

```css
.admin-shell { min-height: 100vh; background: #0b0d12; color: #e6e8ed; font-family: 'Inter', system-ui, sans-serif; }
.admin-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #1f2330; }
.admin-brand { font-family: 'JetBrains Mono', monospace; letter-spacing: 0.08em; font-weight: 600; }
.admin-link { background: transparent; color: #9aa1ad; border: 1px solid #1f2330; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
.admin-link:hover { color: #fff; border-color: #2a3040; }
.admin-main { padding: 24px; max-width: 1100px; margin: 0 auto; }
.admin-login { max-width: 360px; margin: 80px auto; padding: 24px; background: #11141c; border: 1px solid #1f2330; border-radius: 12px; }
.admin-login h1 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
.admin-login label { display: block; margin-bottom: 12px; }
.admin-login label span { display: block; font-size: 12px; color: #9aa1ad; margin-bottom: 6px; }
.admin-login input { width: 100%; padding: 10px 12px; background: #0b0d12; border: 1px solid #1f2330; border-radius: 6px; color: #fff; font-family: inherit; }
.admin-login button { width: 100%; padding: 10px; background: #6366f1; color: white; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; }
.admin-login button:disabled { opacity: 0.6; }
.admin-error { color: #f87171; margin-top: 12px; font-size: 13px; }
.admin-table { width: 100%; border-collapse: collapse; }
.admin-table th, .admin-table td { text-align: left; padding: 12px; border-bottom: 1px solid #1f2330; font-size: 14px; }
.admin-table th { color: #9aa1ad; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.admin-table tr:hover td { background: #11141c; }
.admin-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.admin-pill.pending  { background: #3a2f0e; color: #f5c451; }
.admin-pill.sent     { background: #0f3b22; color: #4ade80; }
.admin-pill.skipped  { background: #2a2f3a; color: #9aa1ad; }
.admin-pill.failed   { background: #3b1212; color: #f87171; }
.admin-pill.approved { background: #1f2a3a; color: #60a5fa; }
.admin-pill.none     { background: #1f2330; color: #9aa1ad; }
.admin-pill.high     { background: #0f3b22; color: #4ade80; }
.admin-pill.medium   { background: #3a2f0e; color: #f5c451; }
.admin-pill.low      { background: #3b1212; color: #f87171; }
.admin-pill.unknown  { background: #1f2330; color: #9aa1ad; }
.admin-link-row { color: #93c5fd; text-decoration: none; }
.admin-link-row:hover { text-decoration: underline; }
.admin-detail { display: grid; gap: 24px; grid-template-columns: 1fr 320px; }
.admin-detail h1 { font-size: 20px; margin: 0 0 8px; }
.admin-detail h2 { font-size: 14px; margin: 16px 0 8px; color: #9aa1ad; text-transform: uppercase; letter-spacing: 0.05em; }
.admin-card { background: #11141c; border: 1px solid #1f2330; border-radius: 10px; padding: 16px; }
.admin-transcript { max-height: 480px; overflow-y: auto; }
.admin-transcript .turn { padding: 8px 0; border-bottom: 1px solid #1f2330; font-size: 13px; }
.admin-transcript .turn:last-child { border-bottom: 0; }
.admin-transcript .speaker { display: inline-block; min-width: 56px; color: #9aa1ad; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.admin-transcript .agent .speaker { color: #93c5fd; }
.admin-transcript .user .speaker { color: #f5c451; }
.admin-actions textarea, .admin-actions input { width: 100%; background: #0b0d12; border: 1px solid #1f2330; color: #fff; border-radius: 6px; padding: 10px; font-family: inherit; font-size: 13px; box-sizing: border-box; }
.admin-actions textarea { min-height: 120px; resize: vertical; }
.admin-actions label { display: block; font-size: 12px; color: #9aa1ad; margin: 12px 0 6px; }
.admin-actions .button-row { display: flex; gap: 8px; margin-top: 16px; }
.admin-actions button { flex: 1; padding: 10px; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; }
.admin-actions .send { background: #4ade80; color: #052e16; }
.admin-actions .skip { background: #1f2330; color: #e6e8ed; }
.admin-actions .send:disabled, .admin-actions .skip:disabled { opacity: 0.5; cursor: not-allowed; }
.admin-toast { margin-top: 12px; font-size: 13px; }
.admin-toast.ok { color: #4ade80; }
.admin-toast.err { color: #f87171; }
pre.admin-json { background: #0b0d12; border: 1px solid #1f2330; border-radius: 6px; padding: 12px; font-size: 12px; overflow-x: auto; }
```

- [ ] **Step 6: Smoke-test login**

Run `npm run dev`. Open `http://localhost:3000/admin/calls`.
Expected: redirected to `/admin/login`. Submit wrong password → "Invalid password". Submit correct password → redirected to `/admin/calls` (which will 404 until Task 12 — that's expected at this point).

If the layout `redirect` loops on `/admin/login`, simplify `app/admin/layout.tsx` by removing the `isLogin` branch and instead duplicate the cookie check in `app/admin/calls/page.tsx` and `app/admin/calls/[id]/page.tsx` (use the same `verifySession`/redirect pattern there, and leave the layout as just chrome).

- [ ] **Step 7: Commit**

```powershell
git add app/api/admin/login/route.ts app/api/admin/logout/route.ts app/admin/layout.tsx app/admin/login/page.tsx app/admin/admin.css
git commit -m "feat(admin): login page + signed-cookie gate"
```

---

## Task 12: Admin calls list page + API

**Files:**
- Create: `app/api/admin/calls/route.ts`
- Create: `app/admin/calls/page.tsx`

- [ ] **Step 1: `app/api/admin/calls/route.ts`** (used by client refresh if needed; also the page can read directly)

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { listReviewableCalls } from '@/lib/supabase-followup';
import { verifySession, cookieName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET() {
  if (!verifySession(cookies().get(cookieName())?.value)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const rows = await listReviewableCalls(100);
  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: `app/admin/calls/page.tsx`** (server component reads directly from DB; no extra round-trip)

```typescript
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listReviewableCalls } from '@/lib/supabase-followup';
import { verifySession, cookieName } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default async function CallsPage() {
  if (!verifySession(cookies().get(cookieName())?.value)) redirect('/admin/login');
  const rows = await listReviewableCalls(100);
  return (
    <>
      <h1>Calls ({rows.length})</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Interest</th>
            <th>Email</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const interest = r.extracted_data?.interest_level ?? 'unknown';
            return (
              <tr key={r.id}>
                <td>{r.company_name || r.url}</td>
                <td>{fmtDate(r.started_at)}</td>
                <td>{r.duration_seconds ? `${r.duration_seconds}s` : '—'}</td>
                <td><span className={`admin-pill ${interest}`}>{interest}</span></td>
                <td>{r.follow_up_email || r.extracted_data?.email || '—'}</td>
                <td><span className={`admin-pill ${r.follow_up_status}`}>{r.follow_up_status}</span></td>
                <td><Link className="admin-link-row" href={`/admin/calls/${r.id}`}>View →</Link></td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9aa1ad', padding: '32px' }}>No calls yet.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 3: Smoke**

Run `npm run dev`. Visit `/admin/calls`. Expected: table renders. Run a call (from `/`), hang up, come back to `/admin/calls`. The new row should appear with `interest`, `email`, `status: pending` once extraction finishes.

- [ ] **Step 4: Commit**

```powershell
git add app/api/admin/calls/route.ts app/admin/calls/page.tsx
git commit -m "feat(admin): calls list page"
```

---

## Task 13: Admin call detail page + review actions

**Files:**
- Create: `app/api/admin/calls/[id]/route.ts`
- Create: `app/admin/calls/[id]/page.tsx`
- Create: `app/admin/calls/[id]/ReviewActions.tsx`

- [ ] **Step 1: `app/api/admin/calls/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCallSession, getCallTurns } from '@/lib/supabase-followup';
import { verifySession, cookieName } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  if (!verifySession(cookies().get(cookieName())?.value)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const session = await getCallSession(ctx.params.id);
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const turns = await getCallTurns(ctx.params.id);
  return NextResponse.json({ session, turns });
}
```

- [ ] **Step 2: `app/admin/calls/[id]/page.tsx`**

```typescript
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getCallSession, getCallTurns } from '@/lib/supabase-followup';
import { verifySession, cookieName } from '@/lib/admin-auth';
import ReviewActions from './ReviewActions';

export const dynamic = 'force-dynamic';

export default async function CallDetailPage({ params }: { params: { id: string } }) {
  if (!verifySession(cookies().get(cookieName())?.value)) redirect('/admin/login');
  const session = await getCallSession(params.id);
  if (!session) notFound();
  const turns = await getCallTurns(params.id);
  const e = session.extracted_data;
  return (
    <div className="admin-detail">
      <div>
        <h1>{session.company_name || session.url}</h1>
        <div style={{ color: '#9aa1ad', fontSize: 13 }}>
          {session.url} · {new Date(session.started_at).toLocaleString()} ·{' '}
          {session.duration_seconds ? `${session.duration_seconds}s` : '—'}
        </div>

        <h2>Transcript ({turns.length} turns)</h2>
        <div className="admin-card admin-transcript">
          {turns.length === 0 && <div style={{ color: '#9aa1ad' }}>No transcript saved.</div>}
          {turns.map((t) => (
            <div key={t.turn_index} className={`turn ${t.speaker}`}>
              <span className="speaker">{t.speaker.toUpperCase()}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>

        <h2>Extracted insights</h2>
        <div className="admin-card">
          {!e && <div style={{ color: '#9aa1ad' }}>Extraction not yet run.</div>}
          {e && (
            <>
              <div style={{ marginBottom: 12 }}>
                <span className={`admin-pill ${e.interest_level}`}>{e.interest_level}</span>{' '}
                {e.meeting_interest && <span className="admin-pill medium">meeting</span>}{' '}
                {e.follow_up_needed && <span className="admin-pill pending">follow-up</span>}{' '}
                {e.email_confirmed && <span className="admin-pill sent">email confirmed</span>}
              </div>
              <pre className="admin-json">{JSON.stringify(e, null, 2)}</pre>
            </>
          )}
        </div>
      </div>

      <div className="admin-card admin-actions">
        <h2 style={{ margin: '0 0 8px' }}>Review &amp; send</h2>
        <ReviewActions
          callSessionId={session.id}
          initialEmail={session.follow_up_email ?? e?.email ?? ''}
          initialSummary={session.follow_up_summary ?? e?.summary ?? ''}
          status={session.follow_up_status}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `app/admin/calls/[id]/ReviewActions.tsx`**

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FollowUpStatus } from '@/lib/types';

interface Props {
  callSessionId: string;
  initialEmail: string;
  initialSummary: string;
  status: FollowUpStatus;
}

export default function ReviewActions({ callSessionId, initialEmail, initialSummary, status }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const locked = status === 'sent' || status === 'skipped';

  async function submit(skip = false) {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/send-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSessionId, email, summary, skip }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: 'err', text: json.error ?? `Error ${res.status}` });
      } else {
        setToast({ kind: 'ok', text: skip ? 'Marked as skipped.' : 'Follow-up sent.' });
        router.refresh();
      }
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ fontSize: 12, color: '#9aa1ad' }}>Status: <strong>{status}</strong></div>
      <label>Recipient email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={locked} placeholder="contact@company.com" />
      <label>Summary (used by n8n template)</label>
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} disabled={locked} />
      <div className="button-row">
        <button className="send" onClick={() => submit(false)} disabled={busy || locked}>
          {busy ? 'Sending…' : 'Send follow-up'}
        </button>
        <button className="skip" onClick={() => submit(true)} disabled={busy || locked}>
          Skip
        </button>
      </div>
      {toast && <div className={`admin-toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
```

- [ ] **Step 4: Manual smoke (full happy path)**

Run `npm run dev`.
1. From `/` run a call. End it. Wait ~10s.
2. Open `/admin/calls`. Confirm new row, status `pending`.
3. Click **View**. Confirm transcript + extracted JSON render.
4. Edit summary, click **Send follow-up**. Expected toast: "Follow-up sent." Status flips to `sent` (or `failed` if n8n webhook URL not set — that's OK for now).
5. Refresh. Buttons should be disabled because status is `sent`/`failed`.

- [ ] **Step 5: Commit**

```powershell
git add app/api/admin/calls/[id]/route.ts app/admin/calls/[id]/page.tsx app/admin/calls/[id]/ReviewActions.tsx
git commit -m "feat(admin): call detail page + review actions"
```

---

## Task 14: n8n workflow JSON — extraction

**Files:**
- Create: `n8n/bhavik-extract-workflow.json`

- [ ] **Step 1: Write the workflow JSON**

```json
{
  "name": "Bhavik Extract Insights",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "extract-call",
        "responseMode": "lastNode",
        "options": {}
      },
      "id": "webhook-extract",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1.1,
      "position": [200, 300],
      "webhookId": "bhavik-extract"
    },
    {
      "parameters": {
        "jsCode": "const body = $input.first().json.body ?? $input.first().json;\nconst turns = Array.isArray(body.transcript) ? body.transcript : [];\nconst text = turns.map(t => `${(t.speaker||'').toUpperCase()}: ${t.text}`).join('\\n');\nconst system = `You extract sales call signals. Return STRICT JSON with keys: interest_level (one of high|medium|low|unknown), follow_up_needed (bool), meeting_interest (bool), email_confirmed (bool), email (string), summary (string, <=240 chars), preferred_time (string optional), notes (string optional). No prose.`;\nreturn [{ json: { system, user: `Company: ${body.company || ''}\\nContext email: ${body.context_email || ''}\\nTranscript:\\n${text}` } }];"
      },
      "id": "code-build-prompt",
      "name": "Build Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [420, 300]
    },
    {
      "parameters": {
        "url": "https://api.openai.com/v1/chat/completions",
        "options": { "timeout": 12000 },
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "=Bearer {{$env.OPENAI_API_KEY}}" },
            { "name": "Content-Type", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"gpt-4o-mini\",\n  \"response_format\": { \"type\": \"json_object\" },\n  \"messages\": [\n    { \"role\": \"system\", \"content\": $json.system },\n    { \"role\": \"user\", \"content\": $json.user }\n  ]\n}"
      },
      "id": "http-llm",
      "name": "OpenAI",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [640, 300]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json;\nconst content = raw?.choices?.[0]?.message?.content || '{}';\nlet parsed = {};\ntry { parsed = JSON.parse(content); } catch { parsed = {}; }\nreturn [{ json: parsed }];"
      },
      "id": "code-parse",
      "name": "Parse JSON",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [860, 300]
    }
  ],
  "connections": {
    "Webhook":      { "main": [[{ "node": "Build Prompt", "type": "main", "index": 0 }]] },
    "Build Prompt": { "main": [[{ "node": "OpenAI",       "type": "main", "index": 0 }]] },
    "OpenAI":       { "main": [[{ "node": "Parse JSON",   "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" }
}
```

- [ ] **Step 2: Import in n8n**

In n8n UI: **Workflows → Import from File** → select `n8n/bhavik-extract-workflow.json`. Set `OPENAI_API_KEY` in n8n env. Activate. Copy the **production** webhook URL.

- [ ] **Step 3: Commit**

```powershell
git add n8n/bhavik-extract-workflow.json
git commit -m "feat(n8n): extract workflow — transcript → OpenAI JSON"
```

---

## Task 15: n8n workflow JSON — follow-up email

**Files:**
- Create: `n8n/bhavik-followup-workflow.json`

- [ ] **Step 1: Write the workflow JSON** (uses Gmail node — swap for Resend/SMTP as preferred; template is editable in the n8n UI)

```json
{
  "name": "Bhavik Follow-Up Email",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "follow-up",
        "responseMode": "lastNode",
        "options": {}
      },
      "id": "webhook-followup",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1.1,
      "position": [200, 300],
      "webhookId": "bhavik-followup"
    },
    {
      "parameters": {
        "jsCode": "const b = $input.first().json.body ?? $input.first().json;\nconst subject = `Following up — ${b.company || 'our conversation'}`;\nconst body = `Hi,\\n\\nThanks for the call earlier. Quick recap:\\n\\n${b.summary || ''}\\n\\nHappy to set up a short demo whenever works. Reply to this email and I'll send a few times.\\n\\n— Bhavik`;\nreturn [{ json: { to: b.email, subject, body, callSessionId: b.callSessionId } }];"
      },
      "id": "code-template",
      "name": "Render Template",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [420, 300]
    },
    {
      "parameters": {
        "sendTo": "={{$json.to}}",
        "subject": "={{$json.subject}}",
        "message": "={{$json.body}}",
        "options": {}
      },
      "id": "gmail-send",
      "name": "Send Gmail",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [640, 300]
    }
  ],
  "connections": {
    "Webhook":         { "main": [[{ "node": "Render Template", "type": "main", "index": 0 }]] },
    "Render Template": { "main": [[{ "node": "Send Gmail",      "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" }
}
```

- [ ] **Step 2: Import + configure**

n8n UI: import the JSON, attach a Gmail (or Resend) credential to the **Send Gmail** node, activate, copy production webhook URL into `.env.local` as `N8N_FOLLOWUP_WEBHOOK_URL`. Restart `npm run dev`.

- [ ] **Step 3: Commit**

```powershell
git add n8n/bhavik-followup-workflow.json
git commit -m "feat(n8n): follow-up email workflow"
```

---

## Task 16: Env + README updates

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Append to `.env.example`**

```
# === Post-call workflow ===
# n8n webhook that runs an LLM and returns ExtractedData JSON.
# If unset, the app uses a heuristic fallback so the admin flow still works.
N8N_EXTRACT_WEBHOOK_URL=
# n8n webhook that formats + sends the follow-up email.
N8N_FOLLOWUP_WEBHOOK_URL=
# Shared password for the /admin area.
ADMIN_PASSWORD=
# Random 32+ char string used to sign the admin session cookie. Rotate to invalidate sessions.
ADMIN_COOKIE_SECRET=
```

- [ ] **Step 2: Append a section to `README.md`** (right before `## Troubleshooting`)

```markdown
## Post-call workflow

After a call ends, the browser POSTs the final transcript to `/api/end-call`. The server:

1. Marks the `call_sessions` row as `ended` (existing behavior).
2. Persists every turn to `call_turns`.
3. Fires `/api/extract-call`, which calls `N8N_EXTRACT_WEBHOOK_URL` (falls back to a local heuristic) and writes the result to `call_sessions.extracted_data`. `follow_up_status` flips from `none` → `pending`.

A human then reviews the call at `/admin/calls` (password-gated by `ADMIN_PASSWORD`), edits the recipient email and summary if needed, and clicks **Send follow-up** — which POSTs to `N8N_FOLLOWUP_WEBHOOK_URL`. Status moves to `sent`, `skipped`, or `failed`.

Required env vars for the full flow: `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET`, `N8N_EXTRACT_WEBHOOK_URL`, `N8N_FOLLOWUP_WEBHOOK_URL`. The app still works without them — extraction uses the heuristic fallback and the send button reports "webhook not set."

Workflows:

- `n8n/bhavik-extract-workflow.json` — transcript → OpenAI → structured JSON (set `OPENAI_API_KEY` in n8n)
- `n8n/bhavik-followup-workflow.json` — payload → Gmail/Resend (attach credentials in n8n)
```

- [ ] **Step 3: Commit**

```powershell
git add .env.example README.md
git commit -m "docs: env vars + post-call workflow section"
```

---

## Task 17: End-to-end verification

**Files:** none (manual)

- [ ] **Step 1: Full test suite**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green; production build succeeds.

- [ ] **Step 2: Local happy path with both webhooks unset (fallback mode)**

Unset `N8N_EXTRACT_WEBHOOK_URL` and `N8N_FOLLOWUP_WEBHOOK_URL` in `.env.local`. Set `ADMIN_PASSWORD=local-dev` and `ADMIN_COOKIE_SECRET` to a random 32-char string. Restart dev server.

1. Run a real call from `/`. End it.
2. Visit `/admin/calls` → sign in → see your call with a `pending` status and a fallback-summary.
3. Open detail → edit email → click **Send follow-up** → expect `failed` with "N8N_FOLLOWUP_WEBHOOK_URL not set".

- [ ] **Step 3: Full path with n8n configured**

Set both n8n URLs to the production webhooks. Restart. Repeat the call. Expected: extracted JSON shows an LLM-quality summary. **Send follow-up** results in `sent` status; an email arrives at the recipient address.

- [ ] **Step 4: Verify no existing feature regressed**

1. Telugu call still works (`hi-in` ignored, `te-in` selected): mic activates, transcript streams, hang-up does not crash.
2. Ultravox English calls still work end-to-end.
3. `/api/prepare-context` still returns `callSessionId`.

- [ ] **Step 5: Final commit (if any local-doc tweaks)**

```powershell
git status
# only commit if there are leftover formatting fixes
```
