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
    stop();

    const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtxCtor();
    audioCtxRef.current = ctx;

    const sampleRate = ctx.sampleRate;

    // Classic Indian "tring-tring" cadence:
    //   ring A (0.45s) → gap (0.15s) → ring B (0.45s) → silence (2.95s)
    // Total cycle = 4.0s, loops continuously.
    const cycleDuration = 4.0;
    const numSamples = Math.floor(sampleRate * cycleDuration);
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    // Warmer, softer tones (lower than European 400/450 Hz buzz).
    const f1 = 380;
    const f2 = 425;
    const volume = 0.09;

    // Smooth fade-in / fade-out to avoid harsh clicks.
    const FADE_IN  = 0.030; // 30 ms
    const FADE_OUT = 0.060; // 60 ms

    function envelope(tInBurst: number, burstLen: number): number {
      if (tInBurst < FADE_IN) return tInBurst / FADE_IN;
      if (tInBurst > burstLen - FADE_OUT) return Math.max(0, (burstLen - tInBurst) / FADE_OUT);
      return 1.0;
    }

    // Two bursts per cycle — the classic double-ring pattern.
    const bursts: Array<[start: number, end: number]> = [
      [0.00, 0.45], // first ring
      [0.60, 1.05], // second ring
    ];

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let val = 0;

      for (const [start, end] of bursts) {
        if (t >= start && t < end) {
          const tB = t - start;
          const len = end - start;
          const env = envelope(tB, len);
          // Blend two sine waves for a richer, less electronic timbre.
          val = (
            Math.sin(2 * Math.PI * f1 * t) * 0.6 +
            Math.sin(2 * Math.PI * f2 * t) * 0.4
          ) * env * volume;
          break;
        }
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
