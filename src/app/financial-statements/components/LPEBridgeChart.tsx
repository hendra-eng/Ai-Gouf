'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList
} from 'recharts';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { getNiceTicksFromZero, formatAxisValue } from '@/lib/chartTicks';

// Backend integration point: replace with /api/statements/equity?company=&period=
const bridgeRaw = [
  { name: 'Opening\nEquity', value: 0, start: 0, end: 0, type: 'base' },
  { name: 'Capital\nContributions', value: 0, start: 0, end: 0, type: 'positive' },
  { name: 'Net\nProfit', value: 0, start: 0, end: 0, type: 'positive' },
  { name: 'Dividends', value: 0, start: 0, end: 0, type: 'negative' },
  { name: 'Other\nAdjustments', value: 0, start: 0, end: 0, type: 'negative' },
  { name: 'Closing\nEquity', value: 0, start: 0, end: 0, type: 'base' },
];

// Build invisible base + visible bar for each item (sama pola dengan chart P&L / Cash Flow)
const baseChartData = bridgeRaw.map((d) => ({
  name: d.name,
  base: d.type === 'base' ? 0 : Math.min(d.start, d.end),
  bar: Math.abs(d.value),
  type: d.type,
  value: d.value,
}));

function getColor(type: string) {
  if (type === 'base') return 'var(--primary)';
  if (type === 'negative') return 'var(--negative)';
  return 'var(--positive)';
}

interface ChartDatum {
  name: string;
  base: number;
  bar: number;
  type: string;
  value: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
  t: (text: string) => string;
  formatRp: (v: number) => string;
}

function CustomTooltip({ active, payload, t, formatRp }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cls = d.type === 'positive' ? 'text-positive' : d.type === 'negative' ? 'text-negative' : 'text-primary';
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-3">
      <p className="text-xs font-bold text-foreground mb-1">{t(d.name).replace('\n', ' ')}</p>
      <p className={`text-sm font-bold font-mono ${cls}`}>
        {d.value < 0 ? '−' : ''}{formatRp(Math.abs(d.value))}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">
        {d.type === 'base' ? t('Balance') : t(`${d.type} movement`)}
      </p>
    </div>
  );
}

const AXIS_WIDTH = 44;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 16; // + margin.left dari BarChart

export default function LPEBridgeChart() {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);

  // ── Zoom skala harga (drag vertikal di sumbu Y, sama seperti chart P&L / Cash Flow) ──
  const baseMax = useMemo(() => Math.max(0, ...baseChartData.map((d) => d.base + d.bar)) * 1.15 || 1, []);
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  // Tick "nice" (angka bulat) untuk label sumbu — domain chart tetap kontinu
  // (baseMax / priceZoom) supaya drag zoom tetap smooth, cuma label/gridline
  // yang dihitung ke angka bulat terdekat.
  const { ticks: yTicks, step: yStep } = useMemo(
    () => getNiceTicksFromZero(baseMax / priceZoom, 5),
    [baseMax, priceZoom]
  );
  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);

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

  // ── Drag badan bar: tarik naik/turun untuk preview nilai (live), lepas -> spring back ke nilai asli ──
  // Kotak "base" (Opening/Closing Equity, biru) & "positive" (Capital Contributions, Net
  // Profit, hijau) mewakili saldo/penambah -> tarik ke ATAS = membesar.
  // Kotak "negative" (Dividends, Other Adjustments, merah) mewakili pengurang, titik ATAS-nya
  // adalah anchor tetap (level kumulatif sebelumnya) -> tarik ke BAWAH = magnitude membesar
  // (potongan makin dalam), tarik ke ATAS = mengecil.
  const [dragBar, setDragBar] = useState<{ index: number; liveValue: number } | null>(null);
  const dragBarRef = useRef<{
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number;
  } | null>(null);
  const springAnimRef = useRef<number | null>(null);

  const stopSpring = () => {
    if (springAnimRef.current) cancelAnimationFrame(springAnimRef.current);
    springAnimRef.current = null;
  };
  const easeOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);

  const springBack = () => {
    const drag = dragBarRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const duration = 380;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeOutQuint(progress);
      const next = from + (to - from) * eased;
      if (dragBarRef.current) {
        dragBarRef.current = { ...dragBarRef.current, liveValue: next };
        setDragBar({ index: drag.index, liveValue: next });
      }
      if (progress < 1) {
        springAnimRef.current = requestAnimationFrame(step);
      } else {
        dragBarRef.current = null;
        setDragBar(null);
        springAnimRef.current = null;
      }
    };
    springAnimRef.current = requestAnimationFrame(step);
  };

  const handleBarPointerDown = (index: number, startValue: number, barHeight: number, isNegativeType: boolean) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    let pxPerUnit = startValue !== 0 ? -barHeight / startValue : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    if (isNegativeType) pxPerUnit = -pxPerUnit;
    dragBarRef.current = { index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setDragBar({ index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragBarRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const maxValue = (baseMax / priceZoom) * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      dragBarRef.current = { ...drag, liveValue: next };
      setDragBar({ index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (dragBarRef.current) springBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMax, priceZoom]);

  // Data yang benar-benar dikirim ke chart: sama seperti baseChartData, kecuali
  // satu bar yang sedang ditarik/spring-back diganti nilai live-nya.
  // Kotak "negative" (merah) titik ATAS-nya adalah anchor tetap (level kumulatif
  // sebelumnya) -- jadi saat magnitude membesar/mengecil, titik BAWAH yang
  // bergerak (turun saat membesar), bukan titik atas. Kotak "base"/"positive"
  // (biru/hijau) anchornya di bawah tetap, titik ATAS yang bergerak seperti biasa.
  const displayData = useMemo(() => {
    if (!dragBar) return baseChartData;
    return baseChartData.map((d, i) => {
      if (i !== dragBar.index) return d;
      if (d.type === 'negative') {
        const anchorTop = d.base + d.bar; // level kumulatif sebelumnya, tetap
        const newBar = dragBar.liveValue;
        return { ...d, base: anchorTop - newBar, bar: newBar, value: -newBar };
      }
      return { ...d, bar: dragBar.liveValue, value: dragBar.liveValue };
    });
  }, [dragBar]);

  // Badan bar custom: seluruh kotak bisa digenggam & ditarik naik/turun (bukan cuma strip tipis)
  const renderInteractiveBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragBar?.index === index;
    const isNegativeType = payload.type === 'negative';
    const color = getColor(payload.type);
    const opacity = isNegativeType ? 0.75 : 1;
    const h = Math.max(0, height);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={h}
          fill={color}
          fillOpacity={opacity}
          rx={4}
          ry={4}
          stroke={isDraggingThis ? color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(index, payload.bar, height, isNegativeType)}
        />
        {/* Perluas area genggam ke atas sedikit, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={y - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(index, payload.bar, height, isNegativeType)}
        />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={displayData} margin={{ top: 20, right: 16, left: 16, bottom: 4 }} barSize={38}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tickFormatter={(v: string) => t(v).replace('\n', ' ')}
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            ticks={yTicks}
            tickFormatter={(v) => formatAxisValue(v, yStep)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
            width={AXIS_WIDTH}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip t={t} formatRp={formatRp} />} cursor={false} />
          {/* Invisible base bar */}
          <Bar dataKey="base" stackId="wf" fill="transparent" stroke="none" isAnimationActive={!dragBar} />
          {/* Visible colored bar — badannya bisa ditarik */}
          <Bar dataKey="bar" stackId="wf" shape={renderInteractiveBar as any} isAnimationActive={!dragBar}>
            <LabelList
              dataKey="bar"
              position="top"
              formatter={(v: number) => `${(v / 1000).toFixed(1)}M`}
              style={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-ibm-plex-mono)' }}
            />
          </Bar>
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
  );
}