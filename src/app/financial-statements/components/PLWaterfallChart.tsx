'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList
} from 'recharts';
import { useLanguage } from '@/lib/language';
import { getNiceTicksFromZero, formatAxisValue } from '@/lib/chartTicks';

// type: 'total' | 'subtotal' -> biru/hijau, drag ke ATAS = nilai membesar
//       'negative'           -> merah, drag ke BAWAH = potongan makin dalam (arah drag dibalik)
//       'adjustable'         -> orange, bisa ditarik ATAS & BAWAH secara natural (tidak dibalik)
// Nilai contoh (juta) -- dipakai kalau komponen tidak diberi prop `values`.
const DEFAULT_VALUES: PLWaterfallValues = { revenue: 8420, cogs: 4700, opex: 1180, da: 210, interest: 148, tax: 436 };

export interface PLWaterfallValues { revenue: number; cogs: number; opex: number; da: number; interest: number; tax: number }

function buatWaterfallRaw(v: PLWaterfallValues) {
  const gross = v.revenue - v.cogs;
  const ebitda = gross - v.opex;
  const ebit = ebitda - v.da;
  const ebt = ebit - v.interest;
  const net = ebt - v.tax;
  return [
    { name: 'Revenue', value: v.revenue, start: 0, end: v.revenue, type: 'total' },
    { name: 'COGS', value: -v.cogs, start: gross, end: v.revenue, type: 'negative' },
    { name: 'Gross Profit', value: gross, start: 0, end: gross, type: 'subtotal' },
    { name: 'OpEx', value: -v.opex, start: ebitda, end: gross, type: 'adjustable' },
    { name: 'EBITDA', value: ebitda, start: 0, end: ebitda, type: 'subtotal' },
    { name: 'D&A', value: -v.da, start: ebit, end: ebitda, type: 'adjustable' },
    { name: 'EBIT', value: ebit, start: 0, end: ebit, type: 'subtotal' },
    { name: 'Interest', value: -v.interest, start: ebt, end: ebit, type: 'adjustable' },
    { name: 'EBT', value: ebt, start: 0, end: ebt, type: 'subtotal' },
    { name: 'Tax', value: -v.tax, start: net, end: ebt, type: 'negative' },
    { name: 'Net Profit', value: net, start: 0, end: net, type: 'total' },
  ];
}

// Build invisible base + visible bar for each item
function buatChartData(v: PLWaterfallValues) {
  return buatWaterfallRaw(v).map((d) => ({
    name: d.name,
    base: d.type === 'total' || d.type === 'subtotal' ? 0 : Math.max(0, Math.min(d.start, d.end)),
    bar: Math.abs(d.value),
    type: d.type,
    value: d.value,
  }));
}

type ChartDatum = ReturnType<typeof buatChartData>[number];

function getColor(type: string) {
  if (type === 'total') return 'var(--primary)';
  if (type === 'subtotal') return 'var(--info)';
  if (type === 'adjustable') return 'var(--warning)';
  return 'var(--negative)';
}

function CustomTooltip({ active, payload, label, t }: { active?: boolean; payload?: { payload: ChartDatum }[]; label?: string; t: (text: string) => string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-3">
      <p className="text-xs font-bold text-foreground mb-1">{t(label ?? '')}</p>
      <p className={`text-sm font-bold font-mono ${d.value < 0 ? 'text-negative' : 'text-primary'}`}>
        {d.value < 0 ? '−' : ''}Rp {Math.abs(d.value).toFixed(0)}Jt
      </p>
    </div>
  );
}

const AXIS_WIDTH = 44;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 16; // + margin.left dari BarChart

// Harus sinkron dengan height ResponsiveContainer & margin BarChart di JSX bawah --
// dipakai untuk kalibrasi drag berbasis skala sumbu-Y (lihat handleBarPointerDown).
const CHART_HEIGHT = 280;
const CHART_MARGIN_TOP = 20;
const CHART_MARGIN_BOTTOM = 4;

export default function PLWaterfallChart({ values = DEFAULT_VALUES }: { values?: PLWaterfallValues }) {
  const { t } = useLanguage();
  const baseChartData = useMemo(() => buatChartData(values), [values]);

  // ── Zoom skala harga (drag vertikal di sumbu Y, sama seperti chart Financial Overview) ──
  const baseMax = useMemo(() => Math.max(0, ...baseChartData.map((d) => d.base + d.bar)) * 1.15 || 1, [baseChartData]);
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

  // Kotak "negative" (COGS/OpEx/D&A/Interest/Tax, warna merah) mewakili pengurang,
  // jadi arah tariknya dibalik: tarik ke BAWAH -> magnitude membesar (potongan makin
  // dalam), tarik ke ATAS -> mengecil. Kotak total/subtotal (biru) tetap: atas = besar.
  // invertDrag: true HANYA untuk bar merah ('negative') -> tarik ke BAWAH = magnitude membesar.
  // Bar orange ('adjustable') & biru/hijau (total/subtotal) TIDAK dibalik -> tarik ke ATAS = membesar,
  // tarik ke BAWAH = mengecil, jadi orange otomatis bisa digenggam & digerakkan dua arah secara natural.
  //
  // Kalibrasi pxPerUnit dihitung dari SKALA SUMBU-Y CHART (bukan dari tinggi pixel
  // bar itu sendiri) supaya konsisten untuk semua bar. Sebelumnya kalibrasi dihitung
  // dari tinggi bar saat mulai drag -- untuk bar kecil seperti D&A/Interest (nilainya
  // kecil, tinggi pixel-nya cuma beberapa px), rasio ini jadi sangat kecil sehingga
  // sedikit saja gerakan ke bawah langsung "meloncat" ke nilai 0 (kelihatan seperti
  // tidak bisa ditarik turun secara halus, cuma naik yang terasa jalan). Dengan basis
  // skala sumbu-Y penuh, drag naik & turun jadi sama-sama halus & proporsional untuk
  // bar besar maupun kecil (khususnya bar orange yang nilainya kecil).
  const handleBarPointerDown = (index: number, startValue: number, invertDrag: boolean) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    const plotHeightPx = CHART_HEIGHT - CHART_MARGIN_TOP - CHART_MARGIN_BOTTOM;
    const domainMax = baseMax / priceZoom;
    let pxPerUnit = domainMax !== 0 ? -plotHeightPx / domainMax : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    if (invertDrag) pxPerUnit = -pxPerUnit;
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
  // bergerak (turun saat membesar), searah tarikan (drag dibalik: tarik bawah = besar).
  // Kotak "adjustable" (orange) titik BAWAH-nya anchor tetap -- titik ATAS yang
  // bergerak naik saat magnitude membesar, searah tarikan (drag natural: tarik atas
  // = besar). Base selalu >= 0 di kedua kasus supaya tidak pernah keluar domain sumbu Y.
  // Kotak total/subtotal (biru) anchornya di 0 (bawah tetap), titik ATAS yang bergerak seperti biasa.
  const displayData = useMemo(() => {
    if (!dragBar) return baseChartData;
    return baseChartData.map((d, i) => {
      if (i !== dragBar.index) return d;
      if (d.type === 'negative') {
        const anchorTop = d.base + d.bar; // level kumulatif sebelumnya, tetap
        const newBar = dragBar.liveValue;
        return { ...d, base: anchorTop - newBar, bar: newBar, value: -newBar };
      }
      if (d.type === 'adjustable') {
        const anchorBottom = d.base; // titik bawah tetap, badan tumbuh ke ATAS (searah tarikan)
        const newBar = dragBar.liveValue;
        return { ...d, base: anchorBottom, bar: newBar, value: -newBar };
      }
      return { ...d, bar: dragBar.liveValue, value: dragBar.liveValue };
    });
  }, [dragBar, baseChartData]);

  // Badan bar custom: seluruh kotak bisa digenggam & ditarik naik/turun (bukan cuma strip tipis)
  const renderInteractiveBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragBar?.index === index;
    const isSubtractive = payload.type === 'negative' || payload.type === 'adjustable';
    const invertDrag = payload.type === 'negative';
    const color = getColor(payload.type);
    const opacity = isSubtractive ? 0.75 : 1;
    // Sama seperti CashFlowChart: Recharts bisa ngirim `height` negatif untuk
    // segmen stack tertentu -- jangan di-clamp pakai Math.max(0, height) (itu
    // yang bikin bar hilang), normalisasi pakai Math.abs + geser y.
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    return (
      <g>
        <rect
          x={x}
          y={rectY}
          width={width}
          height={h}
          fill={color}
          fillOpacity={opacity}
          rx={4}
          ry={4}
          stroke={isDraggingThis ? color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(index, payload.bar, invertDrag)}
        />
        {/* Perluas area genggam ke atas & bawah sedikit, biar mudah ditarik walau bar-nya pendek/kecil
            (bar orange 'adjustable' butuh genggaman dua arah, jadi diperluas di kedua sisi) */}
        <rect
          x={x}
          y={rectY - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(index, payload.bar, invertDrag)}
        />
        {payload.type === 'adjustable' && (
          <rect
            x={x}
            y={rectY + h}
            width={width}
            height={10}
            fill="transparent"
            style={{ cursor: 'ns-resize' }}
            onPointerDown={handleBarPointerDown(index, payload.bar, invertDrag)}
          />
        )}
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={displayData} margin={{ top: CHART_MARGIN_TOP, right: 16, left: 16, bottom: CHART_MARGIN_BOTTOM }} barSize={38}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tickFormatter={(v: string) => t(v)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
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
          <Tooltip content={<CustomTooltip t={t} />} cursor={false} />
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