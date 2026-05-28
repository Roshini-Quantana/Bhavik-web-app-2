'use client';

import { useEffect, useRef } from 'react';

interface Props {
  active: boolean;
  level: number;
}

export default function Waveform({ active, level }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!activeRef.current) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      phaseRef.current += 0.06;
      const mid = h / 2;
      const amp = h * (0.18 + levelRef.current * 0.3);
      ctx.strokeStyle = 'rgba(150, 220, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const t = x / w;
        const y = mid + Math.sin(t * Math.PI * 4 + phaseRef.current) * amp * (0.6 + 0.4 * Math.sin(phaseRef.current * 0.5));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="card waveform-card">
      <div className="card-header-inline">
        <span className="card-label">AUDIO WAVEFORM</span>
        <span className={active ? 'badge-active' : 'badge-idle'}>{active ? 'LIVE' : 'IDLE'}</span>
      </div>
      <div className="waveform-container">
        <canvas ref={canvasRef} className="waveform-canvas" />
      </div>
    </div>
  );
}
