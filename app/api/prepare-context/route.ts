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
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ultravox failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
