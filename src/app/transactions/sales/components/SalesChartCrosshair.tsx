'use client';

import React, { useEffect, useState } from 'react';
import { formatIDR } from '../../lib/groupAnalytics';
import { startOf, type Granularity, type TimeRange, type TrendPoint } from './salesTrendTime';

// Crosshair ala TradingView untuk chart Tren Sales.
//
// Saat kursor berada di dalam area grafik muncul garis putus-putus horizontal + vertikal di kursor:
//  - label harga (nilai di posisi kursor) menempel di sumbu Y
//  - label tanggal menempel di sumbu X (hari / bulan / tahun, sesuai tingkat zoom)
//  - legenda kecil di pojok kiri atas: nilai sales pada periode di bawah kursor
//
// Komponen ini mendengarkan gerakan kursor sendiri (event native pada elemen chart), jadi gerakan kursor
// hanya merender ulang overlay ini, bukan seluruh halaman Sales.

export interface CrosshairGeometry {
  /** Batas kiri area grafik, px dari tepi kiri elemen chart (lebar sumbu Y + margin kiri). */
  plotLeft: number;
  /** Margin kanan area grafik (px). */
  plotRightMargin: number;
  /** Batas atas area grafik (px). */
  plotTop: number;
  /** Batas bawah area grafik (px) = tinggi chart - tinggi sumbu X. */
  plotBottom: number;
}

interface Props {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  geometry: CrosshairGeometry;
  view: TimeRange;
  gran: Granularity;
  /** Batas bawah & atas sumbu Y saat ini (sudah memperhitungkan zoom & geser). */
  yMin: number;
  yMax: number;
  trend: TrendPoint[];
  pointLabel: (t: number, g: Granularity) => string;
  /** Opsional: bucket & label khusus saat user memilih interval (5m ... 1Y). */
  bucketOf?: (t: number) => number;
  labelOf?: (t: number) => string;
  /** Opsional: teks tambahan di legenda untuk bucket ke-i (mis. Open -> Close saat mode candle). */
  extraOf?: (index: number) => string | null;
  /** Nilai sementara saat titik data sedang ditarik (fitur drag titik). */
  dragPreview: { index: number; value: number } | null;
  estimatedLabel: string;
  salesLabel: string;
}

const CHIP = 'absolute rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white whitespace-nowrap shadow-sm';
const CHIP_BG = '#0E2F26'; // hijau sidebar (--nav)
const LINE = '#94a3b8';
const DATE_CHIP_HALF = 80; // setengah lebar perkiraan label tanggal, supaya tidak keluar dari grafik

export default function SalesChartCrosshair({
  wrapRef, geometry, view, gran, yMin, yMax, trend, pointLabel, bucketOf, labelOf, extraOf, dragPreview, estimatedLabel, salesLabel,
}: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; w: number } | null>(null);
  const { plotLeft, plotRightMargin, plotTop, plotBottom } = geometry;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') { setPos(null); return; }
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const inside = x >= plotLeft && x <= r.width - plotRightMargin && y >= plotTop && y <= plotBottom;
      setPos(inside ? { x, y, w: r.width } : null);
    };
    const onLeave = () => setPos(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [wrapRef, plotLeft, plotRightMargin, plotTop, plotBottom]);

  if (!pos) return null;

  const plotRight = pos.w - plotRightMargin;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  // Piksel -> nilai: harga di sumbu Y, waktu di sumbu X.
  const price = yMin + ((plotBottom - pos.y) / plotHeight) * (yMax - yMin);
  const time = view.from + ((pos.x - plotLeft) / plotWidth) * (view.to - view.from);
  const bucketStart = bucketOf ? bucketOf(time) : startOf(time, gran);
  const bucketIndex = trend.findIndex((p) => p.t === bucketStart);
  const bucket = bucketIndex >= 0 ? trend[bucketIndex] : undefined;
  const dragged = dragPreview != null && dragPreview.index === bucketIndex;
  const bucketValue = dragged ? dragPreview!.value : bucket?.total ?? 0;
  const extra = extraOf && bucketIndex >= 0 ? extraOf(bucketIndex) : null;
  const dateText = labelOf ? labelOf(bucketStart) : pointLabel(bucketStart, gran);
  const dateCenter = Math.min(plotRight - DATE_CHIP_HALF, Math.max(plotLeft + DATE_CHIP_HALF, pos.x));

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <line x1={pos.x} y1={plotTop} x2={pos.x} y2={plotBottom} stroke={LINE} strokeWidth={1} strokeDasharray="4 3" />
        <line x1={plotLeft} y1={pos.y} x2={plotRight} y2={pos.y} stroke={LINE} strokeWidth={1} strokeDasharray="4 3" />
      </svg>

      {/* Harga di posisi kursor — menempel di sumbu Y */}
      <div className={CHIP} style={{ background: CHIP_BG, right: pos.w - plotLeft + 4, top: pos.y - 10 }}>
        {formatIDR(Math.round(price))}
      </div>

      {/* Tanggal di posisi kursor — menempel di sumbu X */}
      <div className={CHIP} style={{ background: CHIP_BG, left: dateCenter, top: plotBottom + 4, transform: 'translateX(-50%)' }}>
        {dateText}
      </div>

      {/* Nilai sales pada periode di bawah kursor (pengganti kartu tooltip) */}
      <div
        className="absolute rounded bg-white/90 px-1.5 py-0.5 text-[11px] leading-4 text-slate-700 shadow-sm"
        style={{ left: plotLeft + 8, top: plotTop + 2 }}
      >
        <span className="font-semibold">{dateText}</span>
        <span className="text-yellow-600">
          {' · '}{salesLabel}: {dragged ? `${estimatedLabel} · ` : ''}{formatIDR(bucketValue)}
        </span>
        {extra && <span className="text-slate-500">{' · '}{extra}</span>}
      </div>
    </div>
  );
}