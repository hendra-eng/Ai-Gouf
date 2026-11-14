'use client';

import React, { useEffect, useState } from 'react';
import type { TimeRange, TrendPoint } from './salesTrendTime';
import type { CrosshairGeometry } from './SalesChartCrosshair';

// Bentuk grafik Tren Sales ala TradingView.
//  - area / line : digambar Recharts (lihat SalesOverview)
//  - column      : batang dari 0 sampai total periode
//  - candle      : open = total periode SEBELUMNYA, close = total periode ini.
//                  Hijau = naik dari periode sebelumnya, merah = turun.
//  - ohlc        : sama dengan candle, tapi berbentuk bar (tick open di kiri, tick close di kanan).
// Data penjualan tidak punya "tick harga" di dalam satu periode, jadi tidak ada sumbu (wick) high/low
// terpisah: high/low = max/min dari open dan close.
export type SalesChartType = 'area' | 'line' | 'column' | 'candle' | 'ohlc';

const UP = '#0F7D4E';
const DOWN = '#EF4444';
const FLAT = '#94a3b8';
const COLUMN = '#EAB308';
const CLIP_ID = 'sales-candle-clip';

interface Props {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  geometry: CrosshairGeometry;
  view: TimeRange;
  /** Batas bawah & atas sumbu Y saat ini (sudah memperhitungkan zoom & geser). */
  yMin: number;
  yMax: number;
  points: TrendPoint[];
  /** Awal periode berikutnya (menentukan lebar tiap batang/candle). */
  nextOf: (t: number) => number;
  type: 'column' | 'candle' | 'ohlc';
}

export default function SalesCandleLayer({ wrapRef, geometry, view, yMin, yMax, points, nextOf, type }: Props) {
  const [width, setWidth] = useState(0);
  const { plotLeft, plotRightMargin, plotTop, plotBottom } = geometry;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef]);

  if (width <= plotLeft + plotRightMargin) return null;

  const plotRight = width - plotRightMargin;
  const plotW = plotRight - plotLeft;
  const plotH = Math.max(1, plotBottom - plotTop);
  const span = Math.max(1, view.to - view.from);
  const xOf = (t: number) => plotLeft + ((t - view.from) / span) * plotW;
  const yRange = Math.max(1e-9, yMax - yMin);
  const yOf = (v: number) => plotBottom - ((v - yMin) / yRange) * plotH;

  const shapes: React.ReactNode[] = [];
  points.forEach((p, i) => {
    const x0 = xOf(p.t);
    const x1 = xOf(nextOf(p.t));
    if (x1 < plotLeft || x0 > plotRight) return;
    const slot = Math.max(1, x1 - x0);
    const cx = (x0 + x1) / 2;
    const bodyW = Math.max(1, Math.min(slot * (type === 'column' ? 0.8 : 0.7), 48));

    if (type === 'column') {
      if (p.total === 0) return;
      const yTotal = yOf(p.total);
      const yZero = yOf(0);
      shapes.push(
        <rect key={p.t} x={cx - bodyW / 2} y={Math.min(yTotal, yZero)} width={bodyW} height={Math.max(1, Math.abs(yZero - yTotal))} fill={COLUMN} fillOpacity={0.9} rx={1} />
      );
      return;
    }

    const open = i > 0 ? points[i - 1].total : p.total;
    const close = p.total;
    if (open === 0 && close === 0) return;
    const color = close > open ? UP : close < open ? DOWN : FLAT;
    const yHigh = yOf(Math.max(open, close));
    const yLow = yOf(Math.min(open, close));

    if (type === 'candle') {
      shapes.push(
        <rect key={p.t} x={cx - bodyW / 2} y={yHigh} width={bodyW} height={Math.max(1.5, yLow - yHigh)} fill={color} stroke={color} strokeWidth={1} rx={1} />
      );
      return;
    }

    // ohlc
    const tick = Math.max(2, Math.min(bodyW / 2, 10));
    const yOpen = yOf(open);
    const yClose = yOf(close);
    shapes.push(
      <g key={p.t} stroke={color} strokeWidth={1.6} strokeLinecap="butt">
        <line x1={cx} y1={yHigh} x2={cx} y2={yLow} />
        <line x1={cx - tick} y1={yOpen} x2={cx} y2={yOpen} />
        <line x1={cx} y1={yClose} x2={cx + tick} y2={yClose} />
      </g>
    );
  });

  return (
    <svg width="100%" height="100%" className="pointer-events-none absolute inset-0" aria-hidden="true">
      <defs>
        <clipPath id={CLIP_ID}>
          <rect x={plotLeft} y={plotTop} width={plotW} height={plotH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${CLIP_ID})`}>{shapes}</g>
    </svg>
  );
}