'use client';

import { useRef, useCallback, useEffect } from 'react';

export function useRingtone() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // noop
      }
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    stop(); // stop any existing playback first

    const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtxCtor();
    audioCtxRef.current = ctx;

    const sampleRate = ctx.sampleRate;
    const duration = 3.0; // 3 seconds per cycle
    const numSamples = sampleRate * duration;
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    const f1 = 400;
    const f2 = 450;
    const volume = 0.12;
    const fadeDuration = 0.05; // 50ms fade-in/fade-out to avoid clicks

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let val = 0;

      // Ring 1 (0.0s to 0.4s)
      if (t >= 0 && t <= 0.4) {
        let envelope = 1.0;
        if (t < fadeDuration) {
          envelope = t / fadeDuration;
        } else if (t > 0.4 - fadeDuration) {
          envelope = (0.4 - t) / fadeDuration;
        }
        val = (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)) * 0.5 * envelope * volume;
      }
      // Ring 2 (0.6s to 1.0s)
      else if (t >= 0.6 && t <= 1.0) {
        let envelope = 1.0;
        const tRing = t - 0.6;
        if (tRing < fadeDuration) {
          envelope = tRing / fadeDuration;
        } else if (tRing > 0.4 - fadeDuration) {
          envelope = (0.4 - tRing) / fadeDuration;
        }
        val = (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)) * 0.5 * envelope * volume;
      }

      data[i] = val;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ctx.destination);
    source.start(0);

    sourceRef.current = source;
  }, [stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { play, stop };
}
