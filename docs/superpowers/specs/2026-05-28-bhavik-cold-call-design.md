# Bhavik – AI Cold Calling Demo: Design Spec

**Date:** 2026-05-28
**Status:** Approved for implementation
**Source PRD:** Inline in conversation 2026-05-28

## 1. Goal

Browser-based voice agent ("Bhavik") that scrapes a company website, then opens a cold-call style voice conversation with the user as if pitching to that company. Demo-grade, runs locally.

## 2. Architecture

Single Next.js 14 app (App Router, TypeScript). Frontend and backend live in the same project — Next.js API routes replace the separate Node server in the PRD. The Ultravox React SDK (`@fixie/ultravox-client`) handles mic capture, WebRTC, audio playback, and transcripts in the browser. n8n is called over HTTP webhook for company scraping, with a cheerio-based inline fallback if n8n is unreachable.

```
Browser (Next.js page + Ultravox SDK)
   │
   ├── POST /api/prepare-context ──► Next.js API route
   │                                    │
   │                                    ├──► n8n webhook (scrape)
   │                                    │       └──► { company_name, summary, industry }
   │                                    │
   │                                    └──► Ultravox REST /api/calls
   │                                            └──► { joinUrl }
   │
   └── UltravoxSession.joinCall(joinUrl) ──► WebRTC voice loop
```

## 3. File layout

```
/app
  /api/prepare-context/route.ts   POST endpoint
  page.tsx                         main UI shell
  layout.tsx
  globals.css                      ported from existing style.css
/components
  ConfigPanel.tsx                  URL, language, voice, persona
  AgentCard.tsx                    Bhavik avatar + status
  Waveform.tsx                     canvas viz, reactive to mic level
  StreamPanel.tsx                  AI process log
  Transcript.tsx                   live transcript stream
  StatsBar.tsx                     sentiment / turns / duration
  CallButton.tsx
/lib
  ultravox-client.ts               wrapper around UltravoxSession
  prompt-builder.ts                builds system prompt from PRD template
  voice-map.ts                     language+voice → Ultravox voice ID
  scraper-fallback.ts              cheerio-based fallback when n8n down
  types.ts                         shared types
/n8n
  bhavik-scrape-workflow.json      importable n8n workflow
.env.example                       ULTRAVOX_API_KEY, N8N_WEBHOOK_URL (optional)
README.md                          run instructions, n8n import steps
```

The existing `index.html`, `style.css`, `app.js` are reference material — the visual design is ported into the Next.js components, then the old files can be removed.

## 4. API contract

### `POST /api/prepare-context`

Request:
```json
{
  "url": "https://acme.com",
  "language": "en-in",
  "voice": "male",
  "persona": "Professional"
}
```

Server flow:
1. Validate URL with `new URL()`; reject non-http/https; block private/loopback IPs (SSRF guard).
2. If `N8N_WEBHOOK_URL` set: POST `{ url }` to it with 8s timeout, expect `{ company_name, summary, industry, services? }`.
3. If n8n missing, errors, or times out → run inline cheerio scraper (`scraper-fallback.ts`): fetch HTML, extract `<title>`, meta description, og:description, first H1/H2, first few `<p>` text blocks.
4. If both scrapers produce no usable content → fall through to a "generic cold call" context with empty fields.
5. Build Ultravox system prompt via `prompt-builder.ts` (template from PRD §6 with persona tone modifier and language hint).
6. POST to Ultravox `https://api.ultravox.ai/api/calls` with:
   ```
   { systemPrompt, model: "fixie-ai/ultravox", voice, firstSpeaker: "FIRST_SPEAKER_AGENT", languageHint: <code> }
   ```
   Authenticated by `X-API-Key: $ULTRAVOX_API_KEY`.
7. Return `{ joinUrl, companyContext, callId }` to client.

Response:
```json
{
  "joinUrl": "wss://...",
  "callId": "uv_...",
  "companyContext": {
    "company_name": "Acme",
    "summary": "...",
    "industry": "..."
  }
}
```

Errors: 400 (bad URL), 502 (Ultravox unreachable), 500 (uncaught). JSON `{ error: "..." }`.

## 5. Frontend session flow

1. User fills config panel, clicks `INITIATE CALL`.
2. UI shows "Dialing…" state + ringing animation.
3. `fetch('/api/prepare-context', ...)` → on success, instantiate `UltravoxSession`, call `joinCall(joinUrl)`.
4. Wire SDK events:
   - `status` → drive status badge + agent pulse
   - `transcripts` → append to Transcript panel, bump turn count, update StatsBar
   - mic input level (from MediaStream) → drive Waveform
5. End call button → `session.leaveCall()`, reset UI to idle.

The mock simulation in current `app.js` (`STREAM_EVENTS`, `simulateStream`) is removed — stream panel now logs real lifecycle events (prepare → scrape → connect → speaking).

## 6. n8n workflow

Exported as `n8n/bhavik-scrape-workflow.json`. Four nodes:

1. **Webhook** — POST trigger at path `/scrape-company`, `responseMode: lastNode`.
2. **HTTP Request** — GET `{{ $json.url }}`, 6s timeout, sets User-Agent header.
3. **Code** (JavaScript) — parses HTML string with regex/string ops (no cheerio in default n8n). Extracts:
   - `company_name`: `<title>` or og:site_name
   - `summary`: meta description or og:description, fallback to first 300 chars of body text
   - `industry`: best-effort scan for keywords (saas / ecommerce / consulting / health / fintech / etc.)
   - `services`: list of H2 text
4. **Respond to Webhook** — return JSON.

No LLM step inside n8n — Ultravox handles all language understanding. The PRD's optional OpenAI summarization node is dropped (YAGNI for demo).

## 7. Prompt builder

Template (in `lib/prompt-builder.ts`):

```
You are Bhavik, a confident and friendly sales representative.

You are speaking to a potential customer from this company:

Company Name: {{company_name}}
What they do: {{summary}}
Industry: {{industry}}

Your goal:
- Open like a real cold call ("Hi, I came across your website...")
- Be natural and conversational, not robotic
- Ask short discovery questions
- Try to pitch a relevant solution

Tone: {{persona_tone}}

Hard rules:
- Never reveal you are an AI
- Keep each reply under 3 sentences
- Pause for the user to respond
- {{language_directive}}
```

Persona → tone map:
- Professional → "polished, measured, business-formal"
- Friendly → "warm, casual, upbeat"
- Direct → "concise, get-to-the-point, time-respecting"
- Consultative → "advisory, question-led, listening more than pitching"

Language directive examples:
- `en-in` → "Speak natural Indian English."
- `hi-in` → "Speak Hindi by default; switch to English if the user does."
- `en-us` → "Speak natural American English."

## 8. Voice mapping (`lib/voice-map.ts`)

| language + voice | Ultravox voice |
|---|---|
| en-* + male | `Mark` |
| en-* + female | `Jessica` |
| en-* + neutral | `Cassidy` |
| hi-in + male | `Anjali-Hindi-Urdu` (fallback to `Mark` if 404) |
| hi-in + female | `Riya-Rao-Hindi-Urdu` (fallback to `Jessica` if 404) |

Voice IDs are verified at implementation time against the Ultravox voice list endpoint; the table is the starting point, not a contract.

## 9. Error handling & fallbacks

| Failure | Behavior |
|---|---|
| Invalid URL | 400, UI inline error under URL field |
| Target site refuses / 4xx / 5xx | Use whatever partial content scraper got; if empty → generic script |
| n8n timeout / missing env | Silent fallback to cheerio scraper, log warning to AI Process Stream |
| Both scrapers empty | Generic prompt: agent opens with "Hi, I came across your company online..." |
| Ultravox API error | 502, UI banner "Could not start call. Check API key." |
| Mic permission denied | UI prompts user to grant permission, call state resets to idle |
| WebRTC disconnect mid-call | UI shows "Call dropped", offers reconnect |

## 10. Security

- URL validator blocks `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, IPv6 link-local — prevents SSRF against internal services.
- Scraper caps response size at 1 MB; aborts longer responses.
- `ULTRAVOX_API_KEY` server-side only, never sent to browser.
- No durable storage of transcripts (in-memory in browser only) for demo.

## 11. Out of scope (demo YAGNI)

- Auth / multi-user
- Rate limiting (single-user local demo)
- Call recording / persistence
- OpenAI summarization step in n8n (Ultravox handles it)
- Deployment to Vercel / Railway (README has notes, no automation)
- Analytics / observability

## 12. Deliverables

1. Next.js app under project root (or `app/` subdir if existing files kept for reference)
2. `n8n/bhavik-scrape-workflow.json` ready to import
3. `.env.example` documenting required keys
4. `README.md` with: install, env setup, n8n import steps, run command
5. Existing `index.html`/`style.css`/`app.js` archived under `legacy/` for reference

## 13. Acceptance

- `npm install && npm run dev` brings up the app
- With `ULTRAVOX_API_KEY` set, entering a URL and clicking INITIATE CALL produces a live voice conversation
- With `N8N_WEBHOOK_URL` unset, app still works (uses inline scraper)
- Agent opens with a context-aware line referencing the scraped company
- Live transcripts appear in the right panel as turns happen
- End Call cleanly tears down the session
