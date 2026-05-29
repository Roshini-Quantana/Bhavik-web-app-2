import { NextRequest, NextResponse } from 'next/server';
import { validateScrapeUrl } from '@/lib/url-validator';
import { callN8nWebhook } from '@/lib/n8n-client';
import { fetchAndScrape, deriveCompanyFromUrl } from '@/lib/scraper-fallback';
import { buildSystemPrompt } from '@/lib/prompt-builder';
import { sarvamChat, sarvamTts } from '@/lib/sarvam-client';
import {
  createSession,
  appendTurn,
  attachSupabase,
  nextTurnIndex,
} from '@/lib/telugu-session-store';
import { getCachedCompany, putCachedCompany, type CacheSource } from '@/lib/supabase-cache';
import { upsertLead, markLeadCalled } from '@/lib/supabase-leads';
import { createCallSession, recordTurn } from '@/lib/supabase-sessions';
import { uploadAudio } from '@/lib/supabase-storage';
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

  const urlStr = v.url.toString();

  // 1. Cache lookup → 2. n8n → 3. fallback scraper. Track which path won so we
  //    only re-cache when we actually pulled fresh data.
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

  const systemPrompt = buildSystemPrompt(context, body.persona, 'te-in');
  const sessionId = createSession(systemPrompt);

  // Fire DB writes that don't block opener generation.
  const leadIdPromise = upsertLead({ url: urlStr, ctx: context });
  const cachePromise = fromCache
    ? Promise.resolve()
    : putCachedCompany(urlStr, context, cacheSource);

  try {
    const firstUserPrime =
      'Start the cold call now with a short, natural opener in Telugu (2 sentences max). Do not show your reasoning; respond with only the Telugu opener.';
    const agentText = await sarvamChat(
      sarvamKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: firstUserPrime },
      ],
      { maxTokens: 600 }
    );

    if (!agentText.trim()) {
      throw new Error('Sarvam chat returned empty opener (model may have exhausted budget on reasoning)');
    }

    // Persist the priming user turn too — Sarvam rejects histories where the
    // first non-system message is from the assistant ("First message must be
    // from user"), so subsequent /telugu-turn calls would 400 without it.
    appendTurn(sessionId, 'user', firstUserPrime);
    appendTurn(sessionId, 'assistant', agentText);

    const audioBase64 = await sarvamTts(sarvamKey, {
      text: agentText,
      language: 'te-IN',
      speaker: pickSpeaker(body.voice),
    });

    // Persist the call to Supabase. createCallSession needs the leadId.
    const leadId = await leadIdPromise;
    const callSessionId = await createCallSession({
      leadId,
      url: urlStr,
      language: 'te-in',
      persona: body.persona,
      voice: body.voice,
      provider: 'sarvam',
      ctx: context,
    });
    attachSupabase(sessionId, callSessionId, leadId);

    if (callSessionId) {
      const turnIdx = nextTurnIndex(sessionId);
      const audioBytes = Buffer.from(audioBase64, 'base64');
      const audioPath = await uploadAudio(
        callSessionId,
        turnIdx,
        'agent',
        new Uint8Array(audioBytes),
        'wav'
      );
      await recordTurn({
        callSessionId,
        turnIndex: turnIdx,
        speaker: 'agent',
        text: agentText,
        audioPath,
        audioFormat: 'wav',
      });
      void markLeadCalled(leadId);
    }

    // Don't make the response wait on cache fill — but don't drop the error either.
    void cachePromise.catch((e) => console.error('[supabase] cache write failed', e));

    return NextResponse.json({
      sessionId,
      callSessionId,
      agentText,
      agentAudio: audioBase64,
      companyContext: context,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sarvam failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
