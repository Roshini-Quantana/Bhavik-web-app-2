'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { UltravoxSession, Role } from 'ultravox-client';
import type { TranscriptMsg } from '@/components/Transcript';

export interface UseUltravoxApi {
  status: string;
  messages: TranscriptMsg[];
  micLevel: number;
  join: (joinUrl: string) => void;
  leave: () => Promise<void>;
}

export function useUltravox(): UseUltravoxApi {
  const sessionRef = useRef<UltravoxSession | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [messages, setMessages] = useState<TranscriptMsg[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const levelRafRef = useRef<number | null>(null);

  const refreshFromSession = useCallback((sess: UltravoxSession) => {
    setStatus(String(sess.status));
    const mapped: TranscriptMsg[] = sess.transcripts.map((t) => ({
      speaker: t.speaker === Role.AGENT ? 'agent' : 'user',
      text: cleanRepetitiveText(t.text),
      final: t.isFinal,
    }));
    setMessages(mapped);
  }, []);

  const startMicWobble = useCallback(() => {
    const tick = () => {
      setMicLevel((prev) => {
        const target = Math.random() * 0.6 + 0.2;
        return prev + (target - prev) * 0.1;
      });
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopMicWobble = useCallback(() => {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const join = useCallback((joinUrl: string) => {
    if (sessionRef.current) {
      sessionRef.current.leaveCall().catch(() => {});
    }
    const sess = new UltravoxSession();
    sessionRef.current = sess;
    sess.addEventListener('status', () => refreshFromSession(sess));
    sess.addEventListener('transcripts', () => refreshFromSession(sess));
    sess.joinCall(joinUrl);
    startMicWobble();
  }, [refreshFromSession, startMicWobble]);

  const leave = useCallback(async () => {
    stopMicWobble();
    if (!sessionRef.current) return;
    try {
      await sessionRef.current.leaveCall();
    } catch {
      // noop
    }
    sessionRef.current = null;
    setStatus('idle');
  }, [stopMicWobble]);

  useEffect(() => {
    return () => {
      stopMicWobble();
      if (sessionRef.current) {
        sessionRef.current.leaveCall().catch(() => {});
        sessionRef.current = null;
      }
    };
  }, [stopMicWobble]);

  return { status, messages, micLevel, join, leave };
}

export function cleanRepetitiveText(text: string): string {
  if (!text) return text;
  
  const tokens = text.match(/([^\s\u060C\u061F,.:;?؟!]+)|([\s\u060C\u061F,.:;?؟!]+)/g) || [];
  const cleaned: string[] = [];
  let lastWord = '';
  let repeatCount = 0;
  
  for (const token of tokens) {
    const isWord = /^[^\s\u060C\u061F,.:;?؟!]+$/.test(token);
    if (isWord) {
      const normalized = token.trim().toLowerCase();
      if (normalized === lastWord) {
        repeatCount++;
      } else {
        lastWord = normalized;
        repeatCount = 1;
      }
      
      if (repeatCount <= 3) {
        cleaned.push(token);
      }
    } else {
      if (repeatCount <= 3) {
        cleaned.push(token);
      }
    }
  }
  
  const result = cleaned.join('').trim();
  return result.replace(/[\s\u060C,.:;]+$/, '');
}
