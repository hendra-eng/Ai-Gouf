'use client';
// AnginRobot — efek garis angin di belakang robot Neo saat ditarik (makin cepat makin banyak/panjang).
// Kanvas layar penuh, tidak bisa diklik. Hanya menggambar selama robot ditarik + sampai garis angin memudar.

import React, { useEffect, useRef } from 'react';
import type { NeoGerak } from './NeoRobot';

type Garis = { x: number; y: number; ux: number; uy: number; l: number; s: number; umur: number; maks: number };

export default function AnginRobot({
  gerak,
  robotRef,
  aktif,
}: {
  gerak: React.MutableRefObject<NeoGerak>;
  robotRef: React.RefObject<HTMLElement | null>;
  aktif: boolean;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const garisRef = useRef<Garis[]>([]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const cx = cv.getContext('2d');
    if (!cx) return;
    let raf = 0;
    const ukur = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    ukur();
    window.addEventListener('resize', ukur);
    const warna = getComputedStyle(cv).color || '#888';

    const tick = () => {
      const g = gerak.current;
      const sp = Math.hypot(g.vx, g.vy);
      const el = robotRef.current;
      if (aktif && el && sp > 3) {
        const r = el.getBoundingClientRect();
        const mx = r.left + r.width / 2, my = r.top + r.height / 2;
        const ux = g.vx / sp, uy = g.vy / sp;
        const n = Math.min(4, 1 + Math.floor(sp / 6));
        for (let i = 0; i < n; i++) {
          const off = (Math.random() - 0.5) * 110;
          garisRef.current.push({
            x: mx - ux * 50 - uy * off, y: my - uy * 50 + ux * off, ux, uy,
            l: 16 + Math.random() * 22 + sp * 1.4, s: sp * 0.9 + 4, umur: 0, maks: 14 + Math.random() * 10,
          });
        }
      }
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.strokeStyle = warna; cx.lineCap = 'round'; cx.lineWidth = 2;
      garisRef.current = garisRef.current.filter((p) => p.umur < p.maks);
      for (const p of garisRef.current) {
        p.umur++; p.x -= p.ux * p.s; p.y -= p.uy * p.s;
        cx.globalAlpha = (1 - p.umur / p.maks) * 0.7;
        cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x + p.ux * p.l, p.y + p.uy * p.l); cx.stroke();
      }
      cx.globalAlpha = 1;
      if (aktif || garisRef.current.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', ukur); cx.clearRect(0, 0, cv.width, cv.height); };
  }, [aktif, gerak, robotRef]);

  return <canvas ref={cvRef} data-voice-ignore aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 text-muted-foreground" />;
}