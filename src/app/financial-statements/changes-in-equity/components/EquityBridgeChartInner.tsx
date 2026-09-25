'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useLanguage } from '@/lib/language';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

/* Waterfall data: base = invisible stack, bar = visible portion */
const raw = [
  { id: 'w-open',    name: 'Opening\nEquity',         absolute: 8420,   type: 'base',     display: '$8.42M'  },
  { id: 'w-capital', name: 'Capital\nContributions',  absolute: 750,    type: 'positive', display: '+$750K'  },
  { id: 'w-profit',  name: 'Net\nProfit',             absolute: 1840,   type: 'positive', display: '+$1.84M' },
  { id: 'w-div',     name: 'Dividends',               absolute: -420,   type: 'negative', display: '($420K)' },
  { id: 'w-adj',     name: 'Other\nAdjustments',      absolute: -85,    type: 'negative', display: '($85K)'  },
  { id: 'w-close',   name: 'Closing\nEquity',         absolute: 10505,  type: 'base',     display: '$10.51M' },
];

const COLORS = {
  base:     'var(--primary)',
  positive: 'var(--positive)',
  negative: 'var(--negative)',
};

/* Compute base (transparent stack) and visible bar */
const data = raw.map((item, idx) => {
  if (item.type === 'base') return { ...item, base: 0, bar: item.absolute };
  let running = 8420;
  for (let i = 1; i < idx; i++) running += raw[i].absolute;
  if (item.absolute >= 0) return { ...item, base: running, bar: item.absolute };
  return { ...item, base: running + item.absolute, bar: Math.abs(item.absolute) };
});

type EquityRow = typeof data[0];

const AXIS_WIDTH = 52;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 4; // + margin.left dari BarChart
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

/** Format nilai jadi teks label sama gaya dgn data contoh ($8.42M / +$750K / ($420K)). */
function formatLabel(value: number, type: string) {
  const abs = Math.abs(value);
  const num = abs >= 1000 ? `$${(abs / 1000).toFixed(2)}M` : `$${Math.round(abs)}K`;
  if (type === 'positive') return `+${num}`;
  if (type === 'negative') return `(${num})`;
  return num;
}

const fmtY = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}M` : `$${v}K`;

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: EquityRow & { __index: number } }>;
  t: (text: string) => string;
  dragPreview?: { index: number; value: number } | null;
}

function CustomTooltip({ active, payload, t, dragPreview }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isDragged = !!dragPreview && dragPreview.index === d.__index;
  const displayValue = isDragged ? formatLabel(dragPreview!.value, d.type) : d.display;
  const cls = d.type === 'positive' ? 'text-positive' : d.type === 'negative' ? 'text-negative' : 'text-primary';
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-float text-sm min-w-32">
      <div className="font-semibold text-foreground mb-1 text-xs">{d.name.replace('\n', ' ')}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>
        {isDragged ? `${t('est.')} · ` : ''}
        {displayValue}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1 capitalize">
        {d.type === 'base' ? t('Balance') : t(`${d.type} movement`)}
      </div>
    </div>
  );
}

export default function EquityBridgeChartInner() {
  const { t } = useLanguage();

  // ── Zoom skala harga (drag vertikal di sumbu Y) — pola sama seperti chart
  // Financial Position / PL & Cash Waterfall. ──
  const baseMax = useMemo(() => Math.max(1, ...data.map((d) => d.base + d.bar)) * 1.15, []);
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: yTicks } = useMemo(() => getNiceTicksFromZero(baseMax / priceZoom, 5), [baseMax, priceZoom]);
  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    zoomDragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!zoomDragRef.current) return;
      const deltaY = zoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, zoomDragRef.current.startZoom * factor));
      setPriceZoom(next);
    };
    const onUp = () => {
      zoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetZoom = () => setPriceZoom(1);

  // ── Drag badan bar (preview realtime, spring-back saat dilepas) — pola
  // sama seperti PL/Cash Waterfall. 'base'/'positive': anchor BAWAH tetap,
  // tarik ATAS = magnitude makin besar. 'negative' (Dividends/Other
  // Adjustments): anchor ATAS tetap (base+bar), tarik BAWAH = makin dalam. ──
  const [dragPreview, setDragPreview] = useState<{ index: number; value: number } | null>(null);
  const dragStateRef = useRef<{
    index: number; startValue: number; startClientY: number; currentValue: number; pxPerUnit: number;
  } | null>(null);
  const animRef = useRef<number | null>(null);

  const stopSpring = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  };

  const springBack = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.currentValue;
    const to = drag.startValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SPRING_DURATION_MS);
      const eased = easeOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (dragStateRef.current) dragStateRef.current.currentValue = next;
      setDragPreview({ index, value: next });
      if (elapsed < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        dragStateRef.current = null;
        animRef.current = null;
        setDragPreview(null);
      }
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => stopSpring, []);

  const handleBarPointerDown = useCallback(
    (index: number, startValue: number, barHeight: number, invertDrag: boolean) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stopSpring();
      const magnitude = Math.abs(startValue) || 1;
      let pxPerUnit = -barHeight / magnitude;
      if (invertDrag) pxPerUnit = -pxPerUnit;
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
        const [, dMax] = yDomainRef.current;
        pxPerUnit = -220 / (dMax || 1);
      }
      dragStateRef.current = { index, startValue, startClientY: e.clientY, currentValue: startValue, pxPerUnit };
      setDragPreview({ index, value: startValue });
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = yDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (dragStateRef.current) springBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBack]);

  const displayData = useMemo(() => {
    const base = data.map((d) => ({ ...d, name: t(d.name) }));
    if (!dragPreview) return base;
    return base.map((d, i) => {
      if (i !== dragPreview.index) return d;
      if (d.type === 'negative') {
        const anchorTop = d.base + d.bar;
        return { ...d, base: anchorTop - dragPreview.value, bar: dragPreview.value, display: formatLabel(dragPreview.value, d.type) };
      }
      return { ...d, bar: dragPreview.value, display: formatLabel(dragPreview.value, d.type) };
    });
  }, [dragPreview, t]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik, plus label
  // angka di atasnya (menggantikan LabelList statis, supaya ikut update saat
  // di-drag) & area transparan tambahan di atas/bawah biar gampang ditarik.
  const renderBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const invertDrag = payload.type === 'negative';
    const isDraggingThis = dragPreview?.index === index;
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragHandlers = handleBarPointerDown(index, payload.bar, height, invertDrag);
    return (
      <g>
        <rect
          x={x} y={rectY} width={width} height={h}
          fill={COLORS[payload.type as keyof typeof COLORS]} rx={5} ry={5}
          stroke={isDraggingThis ? COLORS[payload.type as keyof typeof COLORS] : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        <rect x={x} y={rectY - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        <rect x={x} y={rectY + h} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        <text
          x={x + width / 2}
          y={rectY - 8}
          textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-sans)', fill: 'var(--foreground)' }}
        >
          {payload.display}
        </text>
      </g>
    );
  };
  renderBar.displayName = 'RenderBar';

  const chartData = useMemo(() => displayData.map((d, i) => ({ ...d, __index: i })), [displayData]);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Equity Movement Bridge')}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {t('How opening equity changed to closing equity — Jan to Aug 2026')}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] flex-wrap">
          {[
            { id: 'leg-balance',  color: 'bg-primary',  label: 'Balance'  },
            { id: 'leg-positive', color: 'bg-positive', label: 'Positive' },
            { id: 'leg-negative', color: 'bg-negative', label: 'Negative' },
          ].map(l => (
            <div key={l.id} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
              <span className="text-muted-foreground">{t(l.label)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 28, right: 16, left: 0, bottom: 16 }} barCategoryGap="32%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-sans)' }}
              axisLine={false} tickLine={false} interval={0}
            />
            <YAxis
              tickFormatter={fmtY}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-sans)' }}
              axisLine={false} tickLine={false}
              width={AXIS_WIDTH}
              ticks={yTicks}
              domain={yDomain}
              allowDataOverflow
            />
            <Tooltip content={<CustomTooltip t={t} dragPreview={dragPreview} />} cursor={false} />
            {/* Invisible base */}
            <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
            {/* Visible colored bar */}
            <Bar dataKey="bar" stackId="wf" shape={renderBar as any} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
        <div
          onMouseDown={handleAxisMouseDown}
          onDoubleClick={resetZoom}
          title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
          className="absolute top-0 left-0 h-full cursor-ns-resize"
          style={{ width: AXIS_OVERLAY_WIDTH }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 pt-3 border-t border-border text-[11px]">
        <span className="font-medium text-foreground">{t('Opening')}: $8,420,000</span>
        <span className="font-semibold text-positive">{t('Net change')}: +$2,085,000</span>
        <span className="font-medium text-foreground">{t('Closing')}: $10,505,000</span>
      </div>
    </div>
  );
}