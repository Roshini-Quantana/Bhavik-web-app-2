'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptMsg } from '@/components/Transcript';
import type { Persona, VoiceGender } from './types';

export type TeluguStatus =
  | 'idle'
  | 'connecting'
  | 'speaking'
  | 'ready'
  | 'recording'
  | 'thinking'
  | 'ended';

export interface UseTeluguApi {
  status: TeluguStatus;
  messages: TranscriptMsg[];
  micLevel: number;
  callSessionId: string | null;
  start: (args: { url: string; persona: Persona; voice: VoiceGender }) => Promise<void>;
  end: () => void;
}

// VAD tuning: how the loop decides the user is done speaking.
const SILENCE_THRESHOLD = 0.015; // RMS (0..1) below which we count silence
const SILENCE_MS_TO_STOP = 1400; // sustained silence that ends a turn
const MIN_RECORDING_MS = 700; // ignore VAD during opening micro-pause
// Sarvam STT rejects audio >30s. Cap below that so a noisy room or a
// long-winded user never produces a payload the API will refuse.
const MAX_RECORDING_MS = 25_000;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeWavFromAudioBuffer(buf: AudioBuffer): Blob {
  const numCh = 1;
  const sampleRate = buf.sampleRate;
  const length = buf.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / buf.numberOfChannels;
  }
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const headerSize = 44;
  const dataSize = pcm.byteLength;
  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);
  let p = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  writeStr('RIFF');
  view.setUint32(p, headerSize + dataSize - 8, true); p += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2;
  view.setUint16(p, numCh, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, sampleRate * numCh * 2, true); p += 4;
  view.setUint16(p, numCh * 2, true); p += 2;
  view.setUint16(p, 16, true); p += 2;
  writeStr('data');
  view.setUint32(p, dataSize, true); p += 4;
  new Uint8Array(out, headerSize).set(new Uint8Array(pcm.buffer));
  return new Blob([out], { type: 'audio/wav' });
}

async function blobToWav(blob: Blob, ctx: AudioContext): Promise<Blob> {
  const ab = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(ab.slice(0));
  return encodeWavFromAudioBuffer(audioBuffer);
}

export function useTelugu(): UseTeluguApi {
  const [status, setStatus] = useState<TeluguStatus>('idle');
  const [messages, setMessages] = useState<TranscriptMsg[]>([]);
  const [micLevel, setMicLevel] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const voiceRef = useRef<VoiceGender>('female');
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const callSessionIdRef = useRef<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Continuous-duplex bookkeeping.
  const endedRef = useRef(false);
  const isRecordingRef = useRef(false);
  const recStartedAtRef = useRef(0);
  const silenceStartRef = useRef<number | null>(null);
  const stopAndSendRef = useRef<(() => Promise<void>) | null>(null);

  const appendMsg = useCallback((m: TranscriptMsg) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    levelRafRef.current = null;
    setMicLevel(0);
  }, []);

  const startLevelMeter = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      setMicLevel(Math.min(1, rms * 3));

      // VAD: when recording, sustained silence ends the turn.
      if (isRecordingRef.current) {
        const elapsed = Date.now() - recStartedAtRef.current;
        // Hard cap: ship whatever we have before Sarvam's 30s STT limit.
        if (elapsed > MAX_RECORDING_MS) {
          isRecordingRef.current = false;
          silenceStartRef.current = null;
          stopAndSendRef.current?.();
          return;
        }
        if (elapsed > MIN_RECORDING_MS) {
          if (rms < SILENCE_THRESHOLD) {
            if (silenceStartRef.current === null) silenceStartRef.current = Date.now();
            else if (Date.now() - silenceStartRef.current > SILENCE_MS_TO_STOP) {
              isRecordingRef.current = false;
              silenceStartRef.current = null;
              // Fire-and-forget — stopAndSend chains back into beginRecording.
              stopAndSendRef.current?.();
              return;
            }
          } else {
            silenceStartRef.current = null;
          }
        }
      }

      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const playAgentAudio = useCallback(async (b64: string): Promise<void> => {
    if (!b64) {
      console.error('[telugu] empty agentAudio payload');
      setStatus('ready');
      return;
    }
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* noop */ }
      currentSourceRef.current = null;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) {
      console.error('[telugu] no AudioContext available for playback');
      setStatus('ready');
      return;
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { console.error('[telugu] ctx.resume failed', e); }
    }
    const bytes = base64ToBytes(b64);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(ab);
    } catch (e) {
      console.error('[telugu] decodeAudioData failed', e, 'bytes=', bytes.length);
      setStatus('ready');
      return;
    }
    setStatus('speaking');
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      currentSourceRef.current = src;
      try {
        src.start(0);
      } catch (e) {
        console.error('[telugu] source.start failed', e);
        resolve();
      }
    });
    currentSourceRef.current = null;
    setStatus('ready');
  }, []);

  const ensureMic = useCallback(async () => {
    if (mediaStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    mediaStreamRef.current = stream;
    const AudioCtxCtor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtxCtor();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyserRef.current = analyser;
  }, []);

  const beginRecording = useCallback(() => {
    if (endedRef.current) return;
    if (!mediaStreamRef.current) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const rec = mime
      ? new MediaRecorder(mediaStreamRef.current, { mimeType: mime })
      : new MediaRecorder(mediaStreamRef.current);
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start(250);
    recStartedAtRef.current = Date.now();
    silenceStartRef.current = null;
    isRecordingRef.current = true;
    setStatus('recording');
    startLevelMeter();
  }, [startLevelMeter]);

  const stopRecordingAndSend = useCallback(async (): Promise<void> => {
    const rec = recorderRef.current;
    if (!rec) return;
    isRecordingRef.current = false;
    await new Promise<void>((resolve) => {
      if (rec.state === 'inactive') return resolve();
      rec.onstop = () => resolve();
      try { rec.stop(); } catch { resolve(); }
    });
    stopLevelMeter();
    setStatus('thinking');

    const recordedBlob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
    chunksRef.current = [];

    let uploadBlob: Blob = recordedBlob;
    let uploadName = 'turn.webm';
    try {
      if (audioCtxRef.current) {
        uploadBlob = await blobToWav(recordedBlob, audioCtxRef.current);
        uploadName = 'turn.wav';
      }
    } catch (e) {
      console.error('[telugu] WAV transcode failed, sending original blob', e);
    }

    const form = new FormData();
    form.append('sessionId', sessionIdRef.current ?? '');
    form.append('voice', voiceRef.current);
    form.append('audio', uploadBlob, uploadName);

    try {
      const res = await fetch('/api/telugu-turn', { method: 'POST', body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('[telugu] turn http error', j?.error);
      } else {
        const data = await res.json();
        if (data.userText) appendMsg({ speaker: 'user', text: data.userText, final: true });
        if (data.agentText) {
          appendMsg({ speaker: 'agent', text: data.agentText, final: true });
          if (data.agentAudio) await playAgentAudio(data.agentAudio);
        }
      }
    } catch (e) {
      console.error('[telugu] turn fetch failed', e);
    }

    setStatus('ready');
    // Continuous duplex: immediately reopen the mic for the next user turn.
    if (!endedRef.current) beginRecording();
  }, [appendMsg, playAgentAudio, stopLevelMeter, beginRecording]);

  // Keep the VAD tick pointing at the latest send function.
  useEffect(() => {
    stopAndSendRef.current = stopRecordingAndSend;
  }, [stopRecordingAndSend]);

  const start = useCallback(async (args: { url: string; persona: Persona; voice: VoiceGender }) => {
    setStatus('connecting');
    setMessages([]);
    voiceRef.current = args.voice;
    endedRef.current = false;
    await ensureMic();
    const res = await fetch('/api/telugu-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: args.url, persona: args.persona, voice: args.voice }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setStatus('idle');
      throw new Error(j.error ?? 'telugu-start failed');
    }
    const data = await res.json();
    sessionIdRef.current = data.sessionId;
    callSessionIdRef.current = data.callSessionId ?? null;
    setCallSessionId(data.callSessionId ?? null);
    appendMsg({ speaker: 'agent', text: data.agentText, final: true });
    await playAgentAudio(data.agentAudio);
    // Hand the floor to the user.
    if (!endedRef.current) beginRecording();
  }, [ensureMic, appendMsg, playAgentAudio, beginRecording]);

  const end = useCallback(() => {
    endedRef.current = true;
    isRecordingRef.current = false;
    stopLevelMeter();
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* noop */ }
      currentSourceRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    recorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    sessionIdRef.current = null;
    // Stamp Supabase row as ended — fire-and-forget so UI cleanup never blocks.
    const cs = callSessionIdRef.current;
    callSessionIdRef.current = null;
    setCallSessionId(null);
    if (cs) {
      void fetch('/api/end-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSessionId: cs, status: 'ended' }),
        keepalive: true,
      }).catch(() => {});
    }
    setStatus('ended');
  }, [stopLevelMeter]);

  useEffect(() => () => { end(); }, [end]);

  return { status, messages, micLevel, callSessionId, start, end };
}
