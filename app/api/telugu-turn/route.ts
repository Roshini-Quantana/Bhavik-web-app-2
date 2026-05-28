import { NextRequest, NextResponse } from 'next/server';
import { sarvamChat, sarvamTts, sarvamStt } from '@/lib/sarvam-client';
import { getSession, appendTurn } from '@/lib/telugu-session-store';
import type { VoiceGender } from '@/lib/types';

export const runtime = 'nodejs';

function pickSpeaker(voice: VoiceGender): string {
  if (voice === 'male') return 'abhilash';
  return 'anushka';
}

export async function POST(req: NextRequest) {
  const sarvamKey = process.env.SARVAM_API_KEY;
  if (!sarvamKey) {
    return NextResponse.json({ error: 'SARVAM_API_KEY not set on server' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const sessionId = String(form.get('sessionId') ?? '');
  const voice = String(form.get('voice') ?? 'female') as VoiceGender;
  const audioField = form.get('audio');

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  if (!(audioField instanceof Blob)) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'session expired or unknown' }, { status: 404 });
  }

  try {
    const stt = await sarvamStt(sarvamKey, audioField, 'turn.webm', 'te-IN');
    const userText = stt.transcript.trim();
    if (!userText) {
      return NextResponse.json({
        userText: '',
        agentText: '',
        agentAudio: null,
        note: 'no speech detected',
      });
    }
    appendTurn(sessionId, 'user', userText);

    const reply = await sarvamChat(sarvamKey, session.history, { maxTokens: 250 });
    appendTurn(sessionId, 'assistant', reply);

    const audioBase64 = await sarvamTts(sarvamKey, {
      text: reply,
      language: 'te-IN',
      speaker: pickSpeaker(voice),
    });

    return NextResponse.json({
      userText,
      agentText: reply,
      agentAudio: audioBase64,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sarvam turn failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
