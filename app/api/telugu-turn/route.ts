import { NextRequest, NextResponse } from 'next/server';
import { sarvamChat, sarvamTts, sarvamStt } from '@/lib/sarvam-client';
import { getSession, appendTurn, nextTurnIndex } from '@/lib/telugu-session-store';
import { recordTurn } from '@/lib/supabase-sessions';
import { uploadAudio, type AudioFormat } from '@/lib/supabase-storage';
import type { VoiceGender } from '@/lib/types';

export const runtime = 'nodejs';

function pickSpeaker(voice: VoiceGender): string {
  if (voice === 'male') return 'abhilash';
  return 'anushka';
}

function inferFormat(name: string, type: string | undefined): AudioFormat {
  const lower = (name + ' ' + (type ?? '')).toLowerCase();
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mp3') || lower.includes('mpeg')) return 'mp3';
  return 'webm';
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

  const callSessionId = session.callSessionId;
  const uploadedName =
    audioField instanceof File && audioField.name ? audioField.name : 'turn.webm';
  const userAudioFormat = inferFormat(uploadedName, audioField.type);

  try {
    let stt;
    try {
      stt = await sarvamStt(sarvamKey, audioField, uploadedName, 'te-IN');
    } catch (e) {
      // STT can reject for transient reasons (>30s audio, malformed payload,
      // rate limit). Return an empty turn so the client keeps the duplex loop
      // alive instead of bubbling a 502 that breaks the call.
      const msg = e instanceof Error ? e.message : 'stt failed';
      return NextResponse.json({
        userText: '',
        agentText: '',
        agentAudio: null,
        note: /30 seconds|duration exceeds/i.test(msg)
          ? 'audio too long — please keep each reply under 25 seconds'
          : `stt error: ${msg.slice(0, 200)}`,
      });
    }
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

    // Persist the user turn + raw audio in parallel with the LLM call so
    // Supabase latency doesn't show up in user-perceived turn time.
    const userTurnIdx = nextTurnIndex(sessionId);
    const userPersist = (async () => {
      if (!callSessionId) return;
      const audioBuf = Buffer.from(await audioField.arrayBuffer());
      const audioPath = await uploadAudio(
        callSessionId,
        userTurnIdx,
        'user',
        new Uint8Array(audioBuf),
        userAudioFormat
      );
      await recordTurn({
        callSessionId,
        turnIndex: userTurnIdx,
        speaker: 'user',
        text: userText,
        audioPath,
        audioFormat: userAudioFormat,
      });
    })();

    const reply = await sarvamChat(sarvamKey, session.history, { maxTokens: 600 });
    if (!reply.trim()) {
      throw new Error('Sarvam chat returned empty reply (model may have exhausted budget on reasoning)');
    }
    appendTurn(sessionId, 'assistant', reply);

    const audioBase64 = await sarvamTts(sarvamKey, {
      text: reply,
      language: 'te-IN',
      speaker: pickSpeaker(voice),
    });

    const agentTurnIdx = nextTurnIndex(sessionId);
    const agentPersist = (async () => {
      if (!callSessionId) return;
      const audioBytes = Buffer.from(audioBase64, 'base64');
      const audioPath = await uploadAudio(
        callSessionId,
        agentTurnIdx,
        'agent',
        new Uint8Array(audioBytes),
        'wav'
      );
      await recordTurn({
        callSessionId,
        turnIndex: agentTurnIdx,
        speaker: 'agent',
        text: reply,
        audioPath,
        audioFormat: 'wav',
      });
    })();

    await Promise.allSettled([userPersist, agentPersist]);

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
