# Bhavik — AI Cold Calling Demo

Browser-based voice agent that scrapes a company website, then opens a cold-call style conversation with you as if pitching to that company. Built on Next.js 14 + Ultravox.

## Quick start

```powershell
npm install
Copy-Item .env.example .env.local
# edit .env.local — set ULTRAVOX_API_KEY
npm run dev
```

Open http://localhost:3000, enter a company URL, click **INITIATE CALL**. Grant mic permission when prompted.

## Environment variables

| Key | Required | Purpose |
|---|---|---|
| `ULTRAVOX_API_KEY` | yes | Server-side Ultravox key (never exposed to browser) |
| `N8N_WEBHOOK_URL` | no | If set, scraping goes via n8n. Otherwise the inline cheerio fallback runs. |

## n8n workflow (optional)

1. Install n8n locally (`npx n8n`) or use a hosted instance.
2. Import `n8n/bhavik-scrape-workflow.json` via *Workflows → Import from File*.
3. Activate the workflow. Copy the **Production** webhook URL (not the test one).
4. Put that URL in `.env.local` as `N8N_WEBHOOK_URL` and restart `npm run dev`.

Without n8n configured, the backend falls back to an inline cheerio scraper. Either path produces the same JSON shape consumed by the prompt builder.

## Architecture

```
Browser (Next.js page + Ultravox SDK)
   │
   ├── POST /api/prepare-context ──► Next.js API route
   │                                    │
   │                                    ├──► n8n webhook (if set) ──► scrape JSON
   │                                    │       OR
   │                                    │       inline cheerio fallback
   │                                    │
   │                                    └──► Ultravox REST /api/calls
   │                                            └──► { joinUrl }
   │
   └── UltravoxSession.joinCall(joinUrl) ──► WebRTC voice loop
```

Key files:

- `app/api/prepare-context/route.ts` — server endpoint that scrapes + creates an Ultravox call
- `lib/url-validator.ts` — SSRF guard
- `lib/scraper-fallback.ts` — cheerio inline scraper
- `lib/n8n-client.ts` — webhook caller
- `lib/prompt-builder.ts` — generates the cold-call system prompt
- `lib/voice-map.ts` — language + gender → Ultravox voice id
- `lib/ultravox-create-call.ts` — `POST https://api.ultravox.ai/api/calls`
- `lib/use-ultravox.ts` — React hook wrapping `UltravoxSession`
- `app/page.tsx` — main shell wiring UI to the Ultravox session

Full design lives in `docs/superpowers/specs/2026-05-28-bhavik-cold-call-design.md`. The implementation plan is in `docs/superpowers/plans/2026-05-28-bhavik-cold-call.md`.

## Tests

```powershell
npm test
```

Tests cover the pure lib functions (URL validator, voice map, prompt builder, scraper). UI is verified manually in the browser.

## Production build

```powershell
npm run build
npm start
```

## Voice / language

Voice IDs are mapped from `language + voice` in `lib/voice-map.ts`. The defaults target Ultravox standard voices (`Mark`, `Jessica`, `Cassidy`, `Anjali-Hindi-Urdu`, `Riya-Rao-Hindi-Urdu`). If Ultravox returns a 404 for a voice id, swap it for one listed in the Ultravox console.

## Personas

Four persona presets shape the cold-call tone:

- **Professional** — polished, measured, business-formal
- **Friendly** — warm, casual, upbeat
- **Direct** — concise, time-respecting
- **Consultative** — advisory, question-led

## Legacy files

The original static prototype is preserved under `legacy/`. The Next.js app supersedes it; the visual design is ported into `app/globals.css`.

## Troubleshooting

- **"ULTRAVOX_API_KEY not set on server"** — add it to `.env.local` and restart `npm run dev`.
- **Mic doesn't activate** — browser needs HTTPS or `localhost`. Grant mic permission on the page.
- **Scraping returns empty company** — target site blocks scrapers or has no usable meta tags. The agent falls back to a generic opening line.
- **Ultravox 4xx on call create** — check the voice id exists and the API key is valid.
