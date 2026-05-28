import { NextRequest, NextResponse } from 'next/server';
import { validateScrapeUrl } from '@/lib/url-validator';
import { callN8nWebhook } from '@/lib/n8n-client';
import { fetchAndScrape } from '@/lib/scraper-fallback';
import { buildSystemPrompt } from '@/lib/prompt-builder';
import { sarvamChat, sarvamTts } from '@/lib/sarvam-client';
import { createSession, appendTurn } from '@/lib/telugu-session-store';
import type { CompanyContext, Persona, VoiceGender } from '@/lib/types';

export const runtime = 'nodejs';

interface Body {
  url: string;
  persona: Persona;
  voice: VoiceGender;
}

function pickSpeaker(voice: VoiceGender): string {
  if (voice === 'male') return 'abhilash';
  return 'anushka';
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const v = validateScrapeUrl(body.url);
  if (!v.ok) {
    return NextResponse.json({ error: `bad url: ${v.reason}` }, { status: 400 });
  }

  const sarvamKey = process.env.SARVAM_API_KEY;
  if (!sarvamKey) {
    return NextResponse.json({ error: 'SARVAM_API_KEY not set on server' }, { status: 500 });
  }

  let context: CompanyContext | null = null;
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nUrl) {
    context = await callN8nWebhook(n8nUrl, v.url.toString());
  }
  if (!context) {
    context = await fetchAndScrape(v.url.toString());
  }

  const systemPrompt = buildSystemPrompt(context, body.persona, 'te-in');
  const sessionId = createSession(systemPrompt);

  try {
    const firstUserPrime: string =
      'Start the cold call now with a short, natural opener in Telugu (2 sentences max).';
    const agentText = await sarvamChat(sarvamKey, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: firstUserPrime },
    ], { maxTokens: 250 });

    appendTurn(sessionId, 'assistant', agentText);

    const audioBase64 = await sarvamTts(sarvamKey, {
      text: agentText,
      language: 'te-IN',
      speaker: pickSpeaker(body.voice),
    });

    return NextResponse.json({
      sessionId,
      agentText,
      agentAudio: audioBase64,
      companyContext: context,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sarvam failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
