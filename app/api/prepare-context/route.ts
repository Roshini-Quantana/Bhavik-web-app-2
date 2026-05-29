import { NextRequest, NextResponse } from 'next/server';
import { validateScrapeUrl } from '@/lib/url-validator';
import { callN8nWebhook } from '@/lib/n8n-client';
import { fetchAndScrape, deriveCompanyFromUrl } from '@/lib/scraper-fallback';
import { buildSystemPrompt } from '@/lib/prompt-builder';
import { pickVoice } from '@/lib/voice-map';
import { createUltravoxCall } from '@/lib/ultravox-create-call';
import { getCachedCompany, putCachedCompany, type CacheSource } from '@/lib/supabase-cache';
import { upsertLead, markLeadCalled } from '@/lib/supabase-leads';
import { createCallSession } from '@/lib/supabase-sessions';
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

  const urlStr = v.url.toString();

  let context: CompanyContext | null = await getCachedCompany(urlStr);
  const fromCache = !!context;
  let cacheSource: CacheSource = 'fallback';

  if (!context) {
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (n8nUrl) {
      context = await callN8nWebhook(n8nUrl, urlStr);
      if (context) cacheSource = 'n8n';
    }
  }
  if (!context) {
    context = await fetchAndScrape(urlStr);
    cacheSource = 'fallback';
  }
  if (!context.company_name) {
    context = { ...context, company_name: deriveCompanyFromUrl(urlStr) };
  }

  if (!fromCache) {
    void putCachedCompany(urlStr, context, cacheSource);
  }

  const systemPrompt = buildSystemPrompt(context, body.persona, body.language);
  const voice = pickVoice(body.language, body.voice);

  try {
    const { joinUrl, callId } = await createUltravoxCall(
      { systemPrompt, voice, languageHint: body.language },
      apiKey
    );

    const leadId = await upsertLead({ url: urlStr, ctx: context });
    const callSessionId = await createCallSession({
      leadId,
      url: urlStr,
      language: body.language,
      persona: body.persona,
      voice: body.voice,
      provider: 'ultravox',
      ctx: context,
    });
    void markLeadCalled(leadId);

    const resp: PrepareContextResponse = {
      joinUrl,
      callId,
      companyContext: context,
      callSessionId,
    };
    return NextResponse.json(resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ultravox failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
