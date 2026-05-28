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
  isRecording: boolean;
  start: (args: { url: string; persona: Persona; voice: VoiceGender }) => Promise<void>;
  toggleRecording: () => Promise<void>;
  end: () => void;
}

function base64ToBlob(b64: string, mime = 'audio/wav'): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function useTelugu(): UseTeluguApi {
  const [status, setStatus] = useState<TeluguStatus>('idle');
  const [messages, setMessages] = useState<TranscriptMsg[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const voiceRef = useRef<VoiceGender>('female');

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

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
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const playAgentAudio = useCallback(async (b64: string): Promise<void> => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    const blob = base64ToBlob(b64, 'audio/wav');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    setStatus('speaking');
    await new Promise<void>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play().catch(() => resolve());
    });
    currentAudioRef.current = null;
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

  const start = useCallback(async (args: { url: string; persona: Persona; voice: VoiceGender }) => {
    setStatus('connecting');
    setMessages([]);
    voiceRef.current = args.voice;
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
    appendMsg({ speaker: 'agent', text: data.agentText, final: true });
    await playAgentAudio(data.agentAudio);
  }, [ensureMic, appendMsg, playAgentAudio]);

  const beginRecording = useCallback(() => {
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
    setIsRecording(true);
    setStatus('recording');
    startLevelMeter();
  }, [startLevelMeter]);

  const stopRecordingAndSend = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    setIsRecording(false);
    stopLevelMeter();
    setStatus('thinking');

    const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
    chunksRef.current = [];

    const form = new FormData();
    form.append('sessionId', sessionIdRef.current ?? '');
    form.append('voice', voiceRef.current);
    form.append('audio', blob, 'turn.webm');

    const res = await fetch('/api/telugu-turn', { method: 'POST', body: form });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setStatus('ready');
      throw new Error(j.error ?? 'telugu-turn failed');
    }
    const data = await res.json();
    if (data.userText) appendMsg({ speaker: 'user', text: data.userText, final: true });
    if (data.agentText) {
      appendMsg({ speaker: 'agent', text: data.agentText, final: true });
      if (data.agentAudio) await playAgentAudio(data.agentAudio);
      else setStatus('ready');
    } else {
      setStatus('ready');
    }
  }, [appendMsg, playAgentAudio, stopLevelMeter]);

  const toggleRecording = useCallback(async () => {
    if (status === 'recording') {
      await stopRecordingAndSend();
    } else if (status === 'ready' || status === 'speaking') {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      beginRecording();
    }
  }, [status, beginRecording, stopRecordingAndSend]);

  const end = useCallback(() => {
    stopLevelMeter();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
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
    setIsRecording(false);
    setStatus('ended');
  }, [stopLevelMeter]);

  useEffect(() => () => { end(); }, [end]);

  return { status, messages, micLevel, isRecording, start, toggleRecording, end };
}
