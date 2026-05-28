# Bhavik AI Cold Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working browser-based AI cold-calling demo where the user enters a company URL and talks to "Bhavik" (an AI sales rep voiced by Ultravox) about that company.

**Architecture:** Single Next.js 14 app (App Router, TypeScript). Browser uses @fixie/ultravox-client SDK for WebRTC voice. Next.js API route prepares the call: scrapes the company (via n8n webhook with cheerio fallback), builds a context-aware system prompt, and asks Ultravox to create a call. SDK joins the returned `joinUrl`. n8n workflow exported as importable JSON.

**Tech Stack:** Next.js 14 (App Router), TypeScript, @fixie/ultravox-client, cheerio (HTML fallback parser), Vitest (unit tests for pure libs), n8n (external).

**Platform note:** Windows + PowerShell. Project path contains spaces — always quote. Not a git repo at plan start; Task 1 initialises git.

**Source spec:** `docs/superpowers/specs/2026-05-28-bhavik-cold-call-design.md`

---

## Task 1: Project bootstrap & archive legacy files

**Files:**
- Move: `index.html`, `style.css`, `app.js` → `legacy/`
- Create: Next.js 14 app at repo root
- Create: `.gitignore` (auto by create-next-app)
- Create: `.env.example`

- [ ] **Step 1: Init git and archive existing static prototype**

Run in repo root:
```powershell
git init
New-Item -ItemType Directory -Force legacy
Move-Item index.html legacy\
Move-Item style.css legacy\
Move-Item app.js legacy\
```

- [ ] **Step 2: Scaffold Next.js 14 app at repo root**

```powershell
npx --yes create-next-app@14 . --typescript --app --no-tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm
```

If prompted about non-empty directory, accept (only `docs/` and `legacy/` remain — both safe).

Expected: `app/`, `package.json`, `tsconfig.json`, `next.config.js` created.

- [ ] **Step 3: Add runtime deps**

```powershell
npm install ultravox-client cheerio
npm install -D vitest @vitest/ui
```

(`ultravox-client` is the official SDK package name. Verify by checking `node_modules/ultravox-client/package.json` exists after install.)

- [ ] **Step 4: Add test script to package.json**

Open `package.json`, in the `scripts` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create `.env.example`**

Create `.env.example`:
```
ULTRAVOX_API_KEY=your_key_here
N8N_WEBHOOK_URL=
```

Also create `.env.local` (gitignored by default) with the user's real key for local testing.

- [ ] **Step 6: First commit**

```powershell
git add .
git commit -m "chore: bootstrap Next.js app, archive static prototype"
```

---

## Task 2: Shared types

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Create `lib/types.ts`**

```typescript
export type Language =
  | 'en-in'
  | 'en-us'
  | 'en-gb'
  | 'en-au'
  | 'hi-in';

export type VoiceGender = 'male' | 'female' | 'neutral';

export type Persona = 'Professional' | 'Friendly' | 'Direct' | 'Consultative';

export interface CompanyContext {
  company_name: string;
  summary: string;
  industry: string;
  services?: string[];
}

export interface PrepareContextRequest {
  url: string;
  language: Language;
  voice: VoiceGender;
  persona: Persona;
}

export interface PrepareContextResponse {
  joinUrl: string;
  callId: string;
  companyContext: CompanyContext;
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/types.ts
git commit -m "feat: shared TypeScript types"
```

---

## Task 3: URL validator with SSRF guard (TDD)

**Files:**
- Create: `lib/url-validator.ts`
- Test: `lib/url-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/url-validator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateScrapeUrl } from './url-validator';

describe('validateScrapeUrl', () => {
  it('accepts a public https URL', () => {
    const r = validateScrapeUrl('https://acme.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.hostname).toBe('acme.com');
  });

  it('accepts http (some sites still are)', () => {
    expect(validateScrapeUrl('http://example.com').ok).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(validateScrapeUrl('ftp://example.com').ok).toBe(false);
    expect(validateScrapeUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateScrapeUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(validateScrapeUrl('not a url').ok).toBe(false);
    expect(validateScrapeUrl('').ok).toBe(false);
  });

  it('rejects localhost / loopback', () => {
    expect(validateScrapeUrl('http://localhost').ok).toBe(false);
    expect(validateScrapeUrl('http://127.0.0.1').ok).toBe(false);
    expect(validateScrapeUrl('http://[::1]').ok).toBe(false);
  });

  it('rejects private IPv4 ranges', () => {
    expect(validateScrapeUrl('http://10.0.0.5').ok).toBe(false);
    expect(validateScrapeUrl('http://192.168.1.1').ok).toBe(false);
    expect(validateScrapeUrl('http://172.16.0.1').ok).toBe(false);
    expect(validateScrapeUrl('http://169.254.169.254').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```powershell
npm test -- lib/url-validator.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement validator**

Create `lib/url-validator.ts`:
```typescript
type Result = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_V4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
];

export function validateScrapeUrl(input: string): Result {
  if (!input || typeof input !== 'string') {
    return { ok: false, reason: 'empty url' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'malformed url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http/https allowed' };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || host === '0.0.0.0') {
    return { ok: false, reason: 'loopback not allowed' };
  }

  if (host.startsWith('[') && host.includes('::1')) {
    return { ok: false, reason: 'IPv6 loopback not allowed' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    for (const pat of PRIVATE_V4_PATTERNS) {
      if (pat.test(host)) {
        return { ok: false, reason: 'private IP range not allowed' };
      }
    }
  }

  return { ok: true, url };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```powershell
npm test -- lib/url-validator.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```powershell
git add lib/url-validator.ts lib/url-validator.test.ts
git commit -m "feat: URL validator with SSRF guard"
```

---

## Task 4: Voice mapping (TDD)

**Files:**
- Create: `lib/voice-map.ts`
- Test: `lib/voice-map.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/voice-map.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { pickVoice } from './voice-map';

describe('pickVoice', () => {
  it('maps en + male', () => {
    expect(pickVoice('en-us', 'male')).toBe('Mark');
    expect(pickVoice('en-in', 'male')).toBe('Mark');
  });
  it('maps en + female', () => {
    expect(pickVoice('en-gb', 'female')).toBe('Jessica');
  });
  it('maps en + neutral', () => {
    expect(pickVoice('en-au', 'neutral')).toBe('Cassidy');
  });
  it('maps hi-in + male', () => {
    expect(pickVoice('hi-in', 'male')).toBe('Anjali-Hindi-Urdu');
  });
  it('maps hi-in + female', () => {
    expect(pickVoice('hi-in', 'female')).toBe('Riya-Rao-Hindi-Urdu');
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
npm test -- lib/voice-map.test.ts
```

- [ ] **Step 3: Implement**

Create `lib/voice-map.ts`:
```typescript
import type { Language, VoiceGender } from './types';

export function pickVoice(language: Language, gender: VoiceGender): string {
  if (language === 'hi-in') {
    if (gender === 'male') return 'Anjali-Hindi-Urdu';
    if (gender === 'female') return 'Riya-Rao-Hindi-Urdu';
    return 'Cassidy';
  }
  if (gender === 'male') return 'Mark';
  if (gender === 'female') return 'Jessica';
  return 'Cassidy';
}
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
npm test -- lib/voice-map.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add lib/voice-map.ts lib/voice-map.test.ts
git commit -m "feat: language+gender to Ultravox voice mapping"
```

---

## Task 5: Prompt builder (TDD)

**Files:**
- Create: `lib/prompt-builder.ts`
- Test: `lib/prompt-builder.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/prompt-builder.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt-builder';

const ctx = {
  company_name: 'Acme',
  summary: 'They sell widgets to factories.',
  industry: 'Industrial',
};

describe('buildSystemPrompt', () => {
  it('includes company fields', () => {
    const p = buildSystemPrompt(ctx, 'Professional', 'en-us');
    expect(p).toContain('Acme');
    expect(p).toContain('widgets to factories');
    expect(p).toContain('Industrial');
  });

  it('embeds persona tone', () => {
    const p = buildSystemPrompt(ctx, 'Friendly', 'en-us');
    expect(p.toLowerCase()).toContain('warm');
  });

  it('embeds language directive for Hindi', () => {
    const p = buildSystemPrompt(ctx, 'Direct', 'hi-in');
    expect(p.toLowerCase()).toContain('hindi');
  });

  it('falls back gracefully when company fields are empty', () => {
    const p = buildSystemPrompt(
      { company_name: '', summary: '', industry: '' },
      'Professional',
      'en-us'
    );
    expect(p).toContain('came across your company');
  });

  it('always tells agent not to reveal AI identity', () => {
    const p = buildSystemPrompt(ctx, 'Professional', 'en-us');
    expect(p.toLowerCase()).toContain('never reveal');
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```powershell
npm test -- lib/prompt-builder.test.ts
```

- [ ] **Step 3: Implement**

Create `lib/prompt-builder.ts`:
```typescript
import type { CompanyContext, Persona, Language } from './types';

const PERSONA_TONE: Record<Persona, string> = {
  Professional: 'polished, measured, business-formal',
  Friendly: 'warm, casual, upbeat',
  Direct: 'concise, get-to-the-point, time-respecting',
  Consultative: 'advisory, question-led, listening more than pitching',
};

const LANG_DIRECTIVE: Record<Language, string> = {
  'en-in': 'Speak natural Indian English.',
  'en-us': 'Speak natural American English.',
  'en-gb': 'Speak natural British English.',
  'en-au': 'Speak natural Australian English.',
  'hi-in': 'Speak Hindi by default; switch to English if the user does.',
};

export function buildSystemPrompt(
  ctx: CompanyContext,
  persona: Persona,
  language: Language
): string {
  const hasContext = !!(ctx.company_name || ctx.summary || ctx.industry);
  const opener = hasContext
    ? `Open by saying you came across their website ("${ctx.company_name || 'their company'}").`
    : 'Open by saying you came across your company online.';

  return `You are Bhavik, a confident and friendly sales representative.

You are speaking to a potential customer from this company:

Company Name: ${ctx.company_name || '(unknown)'}
What they do: ${ctx.summary || '(unknown)'}
Industry: ${ctx.industry || '(unknown)'}

Your goal:
- ${opener}
- Be natural and conversational, not robotic
- Ask short discovery questions
- Try to pitch a relevant solution

Tone: ${PERSONA_TONE[persona]}

Hard rules:
- Never reveal you are an AI
- Keep each reply under 3 sentences
- Pause for the user to respond
- ${LANG_DIRECTIVE[language]}`;
}
```

- [ ] **Step 4: Run, confirm pass**

```powershell
npm test -- lib/prompt-builder.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add lib/prompt-builder.ts lib/prompt-builder.test.ts
git commit -m "feat: dynamic system prompt builder"
```

---

## Task 6: Cheerio scraper fallback (TDD)

**Files:**
- Create: `lib/scraper-fallback.ts`
- Test: `lib/scraper-fallback.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/scraper-fallback.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractCompanyFromHtml } from './scraper-fallback';

describe('extractCompanyFromHtml', () => {
  it('pulls company name from <title>', () => {
    const html = `<html><head><title>Acme Widgets</title></head><body></body></html>`;
    const r = extractCompanyFromHtml(html, 'https://acme.com');
    expect(r.company_name).toBe('Acme Widgets');
  });

  it('prefers og:site_name over <title>', () => {
    const html = `<html><head>
      <title>Some Page Title - Buy Now</title>
      <meta property="og:site_name" content="Acme" />
    </head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').company_name).toBe('Acme');
  });

  it('uses meta description as summary', () => {
    const html = `<html><head>
      <meta name="description" content="We sell widgets." />
    </head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').summary).toContain('widgets');
  });

  it('falls back to first paragraph if no meta description', () => {
    const html = `<html><body><p>We make industrial machines for factories.</p></body></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').summary).toContain('industrial machines');
  });

  it('detects SaaS industry keyword', () => {
    const html = `<html><head><meta name="description" content="Our SaaS platform helps teams."/></head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').industry.toLowerCase()).toContain('saas');
  });

  it('returns empty fields gracefully on empty html', () => {
    const r = extractCompanyFromHtml('', 'https://x.com');
    expect(r.company_name).toBe('');
    expect(r.summary).toBe('');
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
npm test -- lib/scraper-fallback.test.ts
```

- [ ] **Step 3: Implement scraper**

Create `lib/scraper-fallback.ts`:
```typescript
import * as cheerio from 'cheerio';
import type { CompanyContext } from './types';

const INDUSTRY_KEYWORDS: Array<[string, string]> = [
  ['saas', 'SaaS'],
  ['e-commerce', 'E-commerce'],
  ['ecommerce', 'E-commerce'],
  ['fintech', 'FinTech'],
  ['healthcare', 'Healthcare'],
  ['health', 'Healthcare'],
  ['education', 'Education'],
  ['consulting', 'Consulting'],
  ['marketing', 'Marketing'],
  ['real estate', 'Real Estate'],
  ['logistics', 'Logistics'],
  ['manufacturing', 'Manufacturing'],
  ['ai', 'AI / ML'],
];

export function extractCompanyFromHtml(html: string, sourceUrl: string): CompanyContext {
  if (!html) return { company_name: '', summary: '', industry: '', services: [] };

  const $ = cheerio.load(html);

  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  const titleTag = $('title').first().text().trim();
  const company_name = ogSite || titleTag || '';

  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  let summary = metaDesc || ogDesc || '';
  if (!summary) {
    const firstP = $('p').first().text().trim();
    summary = firstP.slice(0, 300);
  }

  const haystack = (summary + ' ' + titleTag).toLowerCase();
  let industry = '';
  for (const [needle, label] of INDUSTRY_KEYWORDS) {
    if (haystack.includes(needle)) { industry = label; break; }
  }

  const services = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 5).filter(Boolean);

  return { company_name, summary, industry, services };
}

export async function fetchAndScrape(url: string): Promise<CompanyContext> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'BhavikScraper/1.0 (+demo)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return { company_name: '', summary: '', industry: '', services: [] };
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return extractCompanyFromHtml(text.slice(0, 1_000_000), url);
    }
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
      if (received > 1_000_000) { controller.abort(); break; }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
    return extractCompanyFromHtml(html, url);
  } catch {
    return { company_name: '', summary: '', industry: '', services: [] };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
npm test -- lib/scraper-fallback.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add lib/scraper-fallback.ts lib/scraper-fallback.test.ts
git commit -m "feat: cheerio-based fallback scraper with size cap"
```

---

## Task 7: n8n client helper

**Files:**
- Create: `lib/n8n-client.ts`

- [ ] **Step 1: Implement**

Create `lib/n8n-client.ts`:
```typescript
import type { CompanyContext } from './types';

export async function callN8nWebhook(
  webhookUrl: string,
  targetUrl: string
): Promise<CompanyContext | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      company_name: String(json.company_name ?? ''),
      summary: String(json.summary ?? ''),
      industry: String(json.industry ?? ''),
      services: Array.isArray(json.services) ? json.services.map(String) : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/n8n-client.ts
git commit -m "feat: n8n webhook client with timeout"
```

---

## Task 8: Ultravox call creator

**Files:**
- Create: `lib/ultravox-create-call.ts`

- [ ] **Step 1: Implement**

Create `lib/ultravox-create-call.ts`:
```typescript
export interface CreateCallParams {
  systemPrompt: string;
  voice: string;
  languageHint: string;
}

export interface CreateCallResult {
  joinUrl: string;
  callId: string;
}

export async function createUltravoxCall(
  params: CreateCallParams,
  apiKey: string
): Promise<CreateCallResult> {
  const res = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      systemPrompt: params.systemPrompt,
      model: 'fixie-ai/ultravox',
      voice: params.voice,
      languageHint: params.languageHint,
      firstSpeaker: 'FIRST_SPEAKER_AGENT',
      medium: { webRtc: {} },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ultravox create call failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  return { joinUrl: json.joinUrl, callId: json.callId };
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/ultravox-create-call.ts
git commit -m "feat: Ultravox call creation helper"
```

---

## Task 9: `/api/prepare-context` route

**Files:**
- Create: `app/api/prepare-context/route.ts`

- [ ] **Step 1: Implement route**

Create `app/api/prepare-context/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateScrapeUrl } from '@/lib/url-validator';
import { callN8nWebhook } from '@/lib/n8n-client';
import { fetchAndScrape } from '@/lib/scraper-fallback';
import { buildSystemPrompt } from '@/lib/prompt-builder';
import { pickVoice } from '@/lib/voice-map';
import { createUltravoxCall } from '@/lib/ultravox-create-call';
import type { PrepareContextRequest, PrepareContextResponse, CompanyContext } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: PrepareContextRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const v = validateScrapeUrl(body.url);
  if (!v.ok) {
    return NextResponse.json({ error: `bad url: ${v.reason}` }, { status: 400 });
  }

  const apiKey = process.env.ULTRAVOX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ULTRAVOX_API_KEY not set on server' }, { status: 500 });
  }

  let context: CompanyContext | null = null;
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nUrl) {
    context = await callN8nWebhook(n8nUrl, v.url.toString());
  }
  if (!context) {
    context = await fetchAndScrape(v.url.toString());
  }

  const systemPrompt = buildSystemPrompt(context, body.persona, body.language);
  const voice = pickVoice(body.language, body.voice);

  try {
    const { joinUrl, callId } = await createUltravoxCall(
      { systemPrompt, voice, languageHint: body.language },
      apiKey
    );
    const resp: PrepareContextResponse = { joinUrl, callId, companyContext: context };
    return NextResponse.json(resp);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'ultravox failed' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Smoke-test the route (without UI)**

Start dev server:
```powershell
npm run dev
```

In a separate PowerShell tab (with `ULTRAVOX_API_KEY` set in `.env.local`):
```powershell
$body = @{ url='https://stripe.com'; language='en-us'; voice='female'; persona='Professional' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/prepare-context -ContentType 'application/json' -Body $body
```

Expected: JSON with `joinUrl` (wss://...) and `companyContext` containing "Stripe".

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
git add app/api/prepare-context/route.ts
git commit -m "feat: /api/prepare-context endpoint"
```

---

## Task 10: Port styles from legacy

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace `app/globals.css` with ported styles**

Copy the entire contents of `legacy/style.css` into `app/globals.css`, replacing whatever boilerplate create-next-app put there. The original CSS is self-contained and uses no preprocessor.

(If `legacy/style.css` was not preserved, refer to git history — but Task 1 preserved it.)

- [ ] **Step 2: Update `app/layout.tsx`**

Open `app/layout.tsx` and ensure it imports `./globals.css` and includes the Google Fonts the legacy `index.html` used. Replace the body content with `{children}` only — no boilerplate header.

Replace `app/layout.tsx`:
```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bhavik · AI Cold Call OS',
  description: 'Bhavik AI Voice Agent – Cold Call Operating System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add app/globals.css app/layout.tsx
git commit -m "style: port legacy CSS and update root layout"
```

---

## Task 11: ConfigPanel component (URL, language, voice, persona)

**Files:**
- Create: `components/ConfigPanel.tsx`

- [ ] **Step 1: Implement**

Create `components/ConfigPanel.tsx`:
```tsx
'use client';

import type { Language, VoiceGender, Persona } from '@/lib/types';

interface Props {
  url: string;
  setUrl: (v: string) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  voice: VoiceGender;
  setVoice: (v: VoiceGender) => void;
  persona: Persona;
  setPersona: (v: Persona) => void;
  disabled: boolean;
}

const PERSONAS: Persona[] = ['Professional', 'Friendly', 'Direct', 'Consultative'];

export default function ConfigPanel(p: Props) {
  return (
    <>
      <section className="card" id="target-intel-card">
        <div className="card-header"><span className="card-label">TARGET INTEL</span></div>
        <div className="url-input-group">
          <span className="url-prefix">https://</span>
          <input
            type="text"
            id="target-url"
            className="url-input"
            placeholder="company.com"
            autoComplete="off"
            value={p.url}
            disabled={p.disabled}
            onChange={(e) => p.setUrl(e.target.value)}
          />
        </div>
      </section>

      <section className="card" id="voice-config-card">
        <div className="card-header"><span className="card-label">VOICE CONFIG</span></div>
        <div className="select-row">
          <div className="custom-select-wrapper">
            <select
              className="custom-select"
              value={p.language}
              disabled={p.disabled}
              onChange={(e) => p.setLanguage(e.target.value as Language)}
            >
              <option value="en-in">EN — India</option>
              <option value="en-us">EN — USA</option>
              <option value="en-gb">EN — UK</option>
              <option value="en-au">EN — Australia</option>
              <option value="hi-in">HI — India</option>
            </select>
            <span className="select-arrow">▾</span>
          </div>
          <div className="custom-select-wrapper">
            <select
              className="custom-select"
              value={p.voice}
              disabled={p.disabled}
              onChange={(e) => p.setVoice(e.target.value as VoiceGender)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="neutral">Neutral</option>
            </select>
            <span className="select-arrow">▾</span>
          </div>
        </div>
      </section>

      <section className="card" id="persona-card">
        <div className="card-header"><span className="card-label">PERSONA</span></div>
        <div className="persona-grid">
          {PERSONAS.map((name, i) => (
            <button
              key={name}
              className={`persona-tag${p.persona === name ? ' active' : ''}`}
              disabled={p.disabled}
              onClick={() => p.setPersona(name)}
            >
              <span className="persona-dot"></span>{name}
              <span className="persona-key">P{i + 1}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add components/ConfigPanel.tsx
git commit -m "feat: ConfigPanel (url/language/voice/persona)"
```

---

## Task 12: AgentCard + CallButton components

**Files:**
- Create: `components/AgentCard.tsx`
- Create: `components/CallButton.tsx`

- [ ] **Step 1: AgentCard**

Create `components/AgentCard.tsx`:
```tsx
interface Props {
  statusText: string;
  active: boolean;
}

export default function AgentCard({ statusText, active }: Props) {
  return (
    <section className={`card agent-card${active ? ' active' : ''}`}>
      <div className="agent-avatar">B</div>
      <div className="agent-info">
        <div className="agent-name">Bhavik</div>
        <div className="agent-status-line">
          <span className="agent-role">AI Cold Caller</span>
          <span className="agent-sep">·</span>
          <span className="agent-ready">{statusText}</span>
        </div>
      </div>
      <div className="agent-pulse"></div>
    </section>
  );
}
```

- [ ] **Step 2: CallButton**

Create `components/CallButton.tsx`:
```tsx
interface Props {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export default function CallButton({ active, label, onClick, disabled }: Props) {
  return (
    <button
      className={`call-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 6 6l1.27-.73a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add components/AgentCard.tsx components/CallButton.tsx
git commit -m "feat: AgentCard and CallButton components"
```

---

## Task 13: Waveform component

**Files:**
- Create: `components/Waveform.tsx`

- [ ] **Step 1: Implement**

Create `components/Waveform.tsx`. Port the canvas drawing logic from `legacy/app.js` (the `startWaveform` / `draw` / `clearWaveform` block). Drive amplitude from a `level` prop (0..1) instead of pure simulation so it can react to mic input later.

```tsx
'use client';

import { useEffect, useRef } from 'react';

interface Props {
  active: boolean;
  level: number;
}

export default function Waveform({ active, level }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      if (!active) {
        ctx!.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(0, h / 2);
        ctx!.lineTo(w, h / 2);
        ctx!.stroke();
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      phaseRef.current += 0.06;
      const mid = h / 2;
      const amp = h * (0.18 + level * 0.3);
      ctx!.strokeStyle = 'rgba(150, 220, 255, 0.85)';
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      for (let x = 0; x <= w; x++) {
        const t = x / w;
        const y = mid + Math.sin(t * Math.PI * 4 + phaseRef.current) * amp * (0.6 + 0.4 * Math.sin(phaseRef.current * 0.5));
        x === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y);
      }
      ctx!.stroke();
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, level]);

  return (
    <div className="card waveform-card">
      <div className="card-header-inline">
        <span className="card-label">AUDIO WAVEFORM</span>
        <span className={active ? 'badge-active' : 'badge-idle'}>{active ? 'LIVE' : 'IDLE'}</span>
      </div>
      <div className="waveform-container">
        <canvas ref={canvasRef} className="waveform-canvas" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add components/Waveform.tsx
git commit -m "feat: Waveform component"
```

---

## Task 14: StreamPanel + Transcript + StatsBar

**Files:**
- Create: `components/StreamPanel.tsx`
- Create: `components/Transcript.tsx`
- Create: `components/StatsBar.tsx`

- [ ] **Step 1: StreamPanel**

Create `components/StreamPanel.tsx`:
```tsx
export interface StreamEntry { ts: string; text: string; kind: 'info' | 'ok' | 'warn' | 'err'; }

export default function StreamPanel({ entries }: { entries: StreamEntry[] }) {
  return (
    <div className="card stream-card">
      <div className="card-header-inline">
        <span className="stream-dot"></span>
        <span className="card-label stream-label">AI PROCESS STREAM</span>
      </div>
      <div className="stream-content">
        {entries.length === 0
          ? <div className="stream-line awaiting">… awaiting input…</div>
          : entries.map((e, i) => (
              <div key={i} className={`stream-line ${e.kind}`}>
                <span className="stream-ts">{e.ts}</span> {e.text}
              </div>
            ))
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Transcript**

Create `components/Transcript.tsx`:
```tsx
export interface TranscriptMsg { speaker: 'agent' | 'user'; text: string; final: boolean; }

export default function Transcript({ messages }: { messages: TranscriptMsg[] }) {
  return (
    <div className="card transcript-card">
      <div className="card-header-inline">
        <span className="card-label">LIVE TRANSCRIPT</span>
        <span className="transcript-msgs">{messages.length} msgs</span>
      </div>
      <div className="transcript-content">
        {messages.length === 0
          ? <div className="transcript-empty"><span>Transcript will stream here</span></div>
          : messages.map((m, i) => (
              <div key={i} className={`transcript-msg ${m.speaker}${m.final ? '' : ' interim'}`}>
                <span className="transcript-speaker">{m.speaker === 'agent' ? 'BHAVIK' : 'USER'}</span>
                <span className="transcript-text">{m.text}</span>
              </div>
            ))
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 3: StatsBar**

Create `components/StatsBar.tsx`:
```tsx
interface Props { turns: number; durationSec: number; }

export default function StatsBar({ turns, durationSec }: Props) {
  const m = Math.floor(durationSec / 60);
  const s = String(durationSec % 60).padStart(2, '0');
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <div className="stat-value">{turns}</div>
        <span className="stat-label">turns</span>
      </div>
      <div className="stat-divider"></div>
      <div className="stat-item">
        <div className="stat-value timer">{m}:{s}</div>
        <span className="stat-label">duration</span>
      </div>
    </div>
  );
}
```

(StatsBar trimmed — sentiment/intent bars in the legacy UI were faked from mock data; without a real sentiment source we'd be lying. YAGNI per spec §11.)

- [ ] **Step 4: Commit**

```powershell
git add components/StreamPanel.tsx components/Transcript.tsx components/StatsBar.tsx
git commit -m "feat: StreamPanel, Transcript, StatsBar components"
```

---

## Task 15: Ultravox SDK wrapper hook

**Files:**
- Create: `lib/use-ultravox.ts`

- [ ] **Step 1: Implement hook**

Create `lib/use-ultravox.ts`:
```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { UltravoxSession, UltravoxSessionStatus } from 'ultravox-client';
import type { TranscriptMsg } from '@/components/Transcript';

export interface UseUltravoxApi {
  status: string;
  messages: TranscriptMsg[];
  micLevel: number;
  join: (joinUrl: string) => Promise<void>;
  leave: () => Promise<void>;
}

export function useUltravox(onTurn?: () => void): UseUltravoxApi {
  const sessionRef = useRef<UltravoxSession | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [messages, setMessages] = useState<TranscriptMsg[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const levelRafRef = useRef<number | null>(null);

  const handleStatus = useCallback((s: UltravoxSession) => {
    setStatus(String(s.status));
  }, []);

  const handleTranscripts = useCallback((s: UltravoxSession) => {
    const t = s.transcripts;
    const mapped: TranscriptMsg[] = t.map((x) => ({
      speaker: x.speaker === 'agent' ? 'agent' : 'user',
      text: x.text,
      final: x.isFinal,
    }));
    setMessages(mapped);
    if (onTurn) onTurn();
  }, [onTurn]);

  const join = useCallback(async (joinUrl: string) => {
    if (sessionRef.current) await sessionRef.current.leaveCall().catch(() => {});
    const sess = new UltravoxSession();
    sessionRef.current = sess;
    sess.addEventListener('status', () => handleStatus(sess));
    sess.addEventListener('transcripts', () => handleTranscripts(sess));
    await sess.joinCall(joinUrl);
    // poll mic level if SDK exposes an analyser; otherwise simulate light wobble
    const tick = () => {
      setMicLevel((prev) => {
        const target = Math.random() * 0.6 + 0.2;
        return prev + (target - prev) * 0.1;
      });
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [handleStatus, handleTranscripts]);

  const leave = useCallback(async () => {
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    setMicLevel(0);
    if (!sessionRef.current) return;
    await sessionRef.current.leaveCall().catch(() => {});
    sessionRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => () => { leave(); }, [leave]);

  return { status, messages, micLevel, join, leave };
}
```

(Note: the Ultravox SDK API for real mic level may differ — the wobble fallback keeps the waveform alive visually. Real RMS hookup is a stretch goal post-demo.)

- [ ] **Step 2: Commit**

```powershell
git add lib/use-ultravox.ts
git commit -m "feat: useUltravox React hook"
```

---

## Task 16: Main page wiring

**Files:**
- Replace: `app/page.tsx`

- [ ] **Step 1: Implement page**

Replace `app/page.tsx`:
```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import ConfigPanel from '@/components/ConfigPanel';
import AgentCard from '@/components/AgentCard';
import CallButton from '@/components/CallButton';
import Waveform from '@/components/Waveform';
import StreamPanel, { StreamEntry } from '@/components/StreamPanel';
import Transcript from '@/components/Transcript';
import StatsBar from '@/components/StatsBar';
import { useUltravox } from '@/lib/use-ultravox';
import type { Language, VoiceGender, Persona, PrepareContextResponse } from '@/lib/types';

function now() { return new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

export default function Page() {
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState<Language>('en-in');
  const [voice, setVoice] = useState<VoiceGender>('male');
  const [persona, setPersona] = useState<Persona>('Professional');

  const [calling, setCalling] = useState(false);
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const log = useCallback((text: string, kind: StreamEntry['kind'] = 'info') => {
    setStream((s) => [...s, { ts: now(), text, kind }]);
  }, []);

  const ux = useUltravox();

  useEffect(() => {
    if (!startedAt) { setDuration(0); return; }
    const i = setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(i);
  }, [startedAt]);

  async function start() {
    if (!url.trim()) { log('URL required', 'err'); return; }
    setCalling(true);
    setStream([]);
    log(`Preparing context for ${url}`);
    try {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      const res = await fetch('/api/prepare-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl, language, voice, persona }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        log(`prepare-context failed: ${j.error ?? res.statusText}`, 'err');
        setCalling(false);
        return;
      }
      const data: PrepareContextResponse = await res.json();
      log(`Got Ultravox session. Company: ${data.companyContext.company_name || '(unknown)'}`, 'ok');
      log('Joining call…');
      setStartedAt(Date.now());
      await ux.join(data.joinUrl);
      log('Connected', 'ok');
    } catch (e: any) {
      log(`error: ${e?.message ?? e}`, 'err');
      setCalling(false);
    }
  }

  async function end() {
    log('Ending call…');
    await ux.leave();
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }

  const callActive = calling && (ux.status === 'connected' || ux.status === 'listening' || ux.status === 'speaking');

  return (
    <>
      <nav className="topnav">
        <div className="topnav-left">
          <span className="brand">BHAVIK</span>
          <div className="nav-tags">
            <span className="nav-tag">AI VOICE AGENT</span>
            <span className="nav-tag">COLD CALL OS</span>
          </div>
        </div>
        <div className="topnav-right">
          <div className="status-badge">
            <span className="status-dot"></span>
            <span className="status-text">{calling ? ux.status.toUpperCase() : 'STANDBY'}</span>
            <span className="status-version">v2.0</span>
          </div>
        </div>
      </nav>
      <main className="layout">
        <aside className="panel panel-left">
          <ConfigPanel
            url={url} setUrl={setUrl}
            language={language} setLanguage={setLanguage}
            voice={voice} setVoice={setVoice}
            persona={persona} setPersona={setPersona}
            disabled={calling}
          />
          <AgentCard statusText={calling ? ux.status : 'Ready'} active={callActive} />
          <CallButton
            active={calling}
            label={calling ? 'END CALL' : 'INITIATE CALL'}
            onClick={calling ? end : start}
          />
        </aside>
        <section className="panel panel-right">
          <Waveform active={callActive} level={ux.micLevel} />
          <StreamPanel entries={stream} />
          <Transcript messages={ux.messages} />
          <StatsBar turns={ux.messages.length} durationSec={duration} />
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Run dev server, click through end-to-end**

```powershell
npm run dev
```

Open http://localhost:3000. Enter `stripe.com`. Click INITIATE CALL. Grant mic permission. Bhavik should open the conversation referencing Stripe. Speak — your transcript appears. Click END CALL.

If any step breaks: check browser console + terminal logs, fix, re-test before commit.

- [ ] **Step 3: Commit**

```powershell
git add app/page.tsx
git commit -m "feat: wire page UI to Ultravox session and prepare-context"
```

---

## Task 17: n8n workflow JSON

**Files:**
- Create: `n8n/bhavik-scrape-workflow.json`

- [ ] **Step 1: Build workflow JSON**

Create `n8n/bhavik-scrape-workflow.json`:
```json
{
  "name": "Bhavik Company Scraper",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "scrape-company",
        "responseMode": "lastNode",
        "options": {}
      },
      "id": "webhook-1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1.1,
      "position": [200, 300],
      "webhookId": "bhavik-scrape"
    },
    {
      "parameters": {
        "url": "={{ $json.body.url }}",
        "options": {
          "timeout": 6000,
          "response": { "response": { "responseFormat": "text" } }
        },
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "User-Agent", "value": "BhavikScraper/1.0" }
          ]
        }
      },
      "id": "http-1",
      "name": "Fetch HTML",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [440, 300]
    },
    {
      "parameters": {
        "jsCode": "const html = String($input.first().json.data ?? $input.first().json.body ?? '');\nfunction match(re){ const m = html.match(re); return m ? m[1].trim() : ''; }\nconst title = match(/<title[^>]*>([^<]+)<\\/title>/i);\nconst ogSite = match(/<meta[^>]+property=[\"']og:site_name[\"'][^>]+content=[\"']([^\"']+)[\"']/i);\nconst metaDesc = match(/<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)[\"']/i);\nconst ogDesc = match(/<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"']([^\"']+)[\"']/i);\nconst firstP = match(/<p[^>]*>([^<]+)<\\/p>/i);\nconst h2s = [...html.matchAll(/<h2[^>]*>([^<]+)<\\/h2>/gi)].map(m=>m[1].trim()).slice(0,5);\nconst summary = metaDesc || ogDesc || firstP.slice(0,300);\nconst hay = (summary + ' ' + title).toLowerCase();\nconst KW = [['saas','SaaS'],['e-commerce','E-commerce'],['ecommerce','E-commerce'],['fintech','FinTech'],['healthcare','Healthcare'],['consulting','Consulting'],['marketing','Marketing'],['logistics','Logistics'],['manufacturing','Manufacturing'],['ai','AI / ML']];\nlet industry = '';\nfor (const [n,l] of KW) if (hay.includes(n)) { industry = l; break; }\nreturn [{ json: { company_name: ogSite || title || '', summary, industry, services: h2s } }];"
      },
      "id": "code-1",
      "name": "Extract",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [680, 300]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Fetch HTML", "type": "main", "index": 0 }]] },
    "Fetch HTML": { "main": [[{ "node": "Extract", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" }
}
```

- [ ] **Step 2: Commit**

```powershell
git add n8n/bhavik-scrape-workflow.json
git commit -m "feat: n8n scraping workflow export"
```

---

## Task 18: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:
```markdown
# Bhavik — AI Cold Calling Demo

Browser-based voice agent that scrapes a company website, then starts a cold-call style conversation with you about that company. Built on Next.js 14 + Ultravox.

## Quick start

```powershell
npm install
Copy-Item .env.example .env.local
# edit .env.local — set ULTRAVOX_API_KEY
npm run dev
```

Open http://localhost:3000, enter a company URL, click **INITIATE CALL**.

## Environment variables

| Key | Required | Purpose |
|---|---|---|
| `ULTRAVOX_API_KEY` | yes | Server-side Ultravox key (never exposed to browser) |
| `N8N_WEBHOOK_URL` | no | If set, scraping goes via n8n. Otherwise inline cheerio fallback runs. |

## n8n workflow (optional)

1. Install n8n locally or use a hosted instance.
2. Import `n8n/bhavik-scrape-workflow.json`.
3. Activate it. Copy the webhook URL (production URL, not test).
4. Put that URL in `.env.local` as `N8N_WEBHOOK_URL`.

## Architecture

- `app/api/prepare-context/route.ts` — server endpoint that scrapes + creates an Ultravox call
- `lib/` — pure helpers (URL validator, prompt builder, voice map, scraper, Ultravox client)
- `components/` — UI building blocks
- `app/page.tsx` — main shell wiring UI to the Ultravox session

See `docs/superpowers/specs/2026-05-28-bhavik-cold-call-design.md` for the full design.

## Tests

```powershell
npm test
```

Tests cover the pure lib functions (URL validator, voice map, prompt builder, scraper). UI is verified manually in the browser.

## Legacy files

The original static prototype lives in `legacy/`. The Next.js app supersedes it and preserves the same visual design.
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "docs: README with setup, env, n8n import instructions"
```

---

## Task 19: End-to-end verification

**No files. Pure validation.**

- [ ] **Step 1: Full test suite**

```powershell
npm test
```

Expected: all green (Tasks 3, 4, 5, 6 tests).

- [ ] **Step 2: Production build**

```powershell
npm run build
```

Expected: no TypeScript errors, no ESLint failures, build succeeds.

- [ ] **Step 3: Full UX run**

```powershell
npm run dev
```

In the browser:
1. Enter `stripe.com` → click INITIATE CALL → verify agent opens with a Stripe-referencing line → say "tell me more" → verify response → click END CALL → verify clean reset.
2. Enter a bad URL (`http://10.0.0.1`) → verify graceful error in stream panel.
3. Switch language to `hi-in`, voice to female, start a new call → verify voice changes and agent speaks Hindi (or attempts to).

- [ ] **Step 4: Final commit (if any cleanup)**

```powershell
git status
# if any tweaks made:
git add -A
git commit -m "chore: end-to-end verification fixes"
```

- [ ] **Step 5: Report results**

Summarize: tests passing, build clean, full UX run OK. Note any deferred bugs.

---

## Self-review checklist

**Spec coverage:**
- §1 Goal — Task 16 (UI + flow)
- §2 Architecture — All tasks
- §3 File layout — Tasks 1, 11–17
- §4 API contract — Task 9 (route), Task 7 (n8n client), Task 8 (Ultravox client), Tasks 3–6 (lib pieces)
- §5 Frontend session flow — Tasks 15, 16
- §6 n8n workflow — Task 17
- §7 Prompt builder — Task 5
- §8 Voice mapping — Task 4
- §9 Error handling — Tasks 3 (URL guard), 6 (scraper fallback), 7 (n8n timeout), 9 (route 4xx/502), 16 (UI errors)
- §10 Security — Task 3 (SSRF guard), Task 6 (size cap), Task 9 (server-side key)
- §11 Out of scope — explicitly skipped
- §12 Deliverables — Tasks 1, 17, 18
- §13 Acceptance — Task 19

**Placeholder scan:** all code blocks complete, no TBD/TODO, all file paths exact.

**Type consistency:** `CompanyContext` shape consistent across Tasks 2, 6, 7, 9; `Language`/`VoiceGender`/`Persona` consistent across Tasks 2, 4, 5, 11, 16; `TranscriptMsg`/`StreamEntry` interfaces defined in their owning components and imported elsewhere; `PrepareContextResponse` consistent between Tasks 2, 9, 16.
