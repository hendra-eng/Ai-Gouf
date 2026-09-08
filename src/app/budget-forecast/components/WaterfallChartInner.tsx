'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

export interface WaterfallItem { name: string; value: number; isBase: boolean }

// Spring-back setelah drag bar dilepas — pola & durasi sama persis dengan
// EquityMovementChart.tsx / EquityBridgeChartInner.tsx / PL Waterfall.
const WF_SPRING_DURATION_MS = 420;
const wfEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
const WF_AXIS_WIDTH = 45;

function buildData(raw: WaterfallItem[]) {
  let cumulative = 0;
  const withCumulative = raw.map((item) => {
    cumulative = item.isBase ? item.value : cumulative + item.value;
    return { ...item, cumulative };
  });
  return withCumulative.map((item, i) => {
    if (item.isBase) {
      return { ...item, invisible: 0, positive: item.value, negative: 0 };
    }
    const prev = withCumulative[i - 1]?.cumulative || 0;
    const base = item.value >= 0 ? prev : prev + item.value;
    return {
      ...item,
      invisible: base,
      positive: item.value >= 0 ? item.value : 0,
      negative: item.value < 0 ? Math.abs(item.value) : 0,
    };
  });
}

const CustomTooltip = ({ active, payload, label, raw }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; raw: ReturnType<typeof buildData> }) => {
  if (!active || !payload?.length) return null;
  const item = raw.find((r) => r.name === label);
  if (!item) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-1">{label?.replace('\n', ' ')}</p>
      <p className={`text-sm font-bold tabular-nums ${item.value >= 0 ? 'text-positive' : 'text-negative'}`}>
        {item.value >= 0 ? '+' : ''}Rp {item.value}M
      </p>
      <p className="text-xs text-muted-foreground">Running: Rp {item.cumulative}M</p>
    </div>
  );
};

export default function WaterfallChartInner({ items }: { items: WaterfallItem[] }) {
  const DATA = useMemo(() => buildData(items), [items]);

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — pola sama persis dengan
  // Equity Movement Waterfall / Financial Overview / PL Waterfall. Tarik
  // naik/turun di area label sumbu Y buat zoom in/out skala, double-click
  // buat reset. ──
  const baseMax = useMemo(
    () => Math.max(1, ...DATA.map((d) => Math.max(d.cumulative, d.invisible + d.positive + d.negative))) * 1.1,
    [DATA]
  );
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

  // ── Fitur 2: Drag badan bar (preview realtime, spring-back saat dilepas) —
  // pola sama persis dengan Equity Movement Waterfall / PL Waterfall.
  // Base (Budgeted/Actual EBITDA): anchor 0, tarik ATAS = makin besar.
  // Bar hijau (variance positif): anchor BAWAH tetap, tarik ATAS = makin besar.
  // Bar merah (variance negatif): anchor ATAS tetap, tarik BAWAH = makin dalam. ──
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
      const elapsed = Math.min(1, (now - start) / WF_SPRING_DURATION_MS);
      const eased = wfEaseOutQuint(elapsed);
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

  // Reset drag & zoom kalau data berubah (mis. ganti client/periode) — index
  // bar & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
    setPriceZoom(1);
  }, [DATA]);

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
        pxPerUnit = -180 / (dMax || 1);
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

  // Data yang benar-benar dikirim ke chart: sama seperti DATA, kecuali satu
  // bar yang sedang ditarik/spring-back diganti nilai live-nya. Data asli
  // (items / props) TIDAK pernah dimutasi — cuma override tampilan sementara.
  const displayData = useMemo(() => {
    if (!dragPreview) return DATA;
    return DATA.map((d, i) => {
      if (i !== dragPreview.index) return d;
      if (d.isBase) {
        return { ...d, positive: dragPreview.value, negative: 0, invisible: 0, value: dragPreview.value, cumulative: dragPreview.value };
      }
      if (d.negative > 0) {
        // Bar merah: anchor ATAS tetap.
        const anchorTop = d.invisible + d.negative;
        const newMagnitude = dragPreview.value;
        return { ...d, negative: newMagnitude, positive: 0, invisible: anchorTop - newMagnitude, value: -newMagnitude, cumulative: anchorTop - newMagnitude };
      }
      // Bar hijau: anchor BAWAH tetap.
      return { ...d, positive: dragPreview.value, negative: 0, value: dragPreview.value, cumulative: d.invisible + dragPreview.value };
    });
  }, [DATA, dragPreview]);

  // Custom bar shape (dipakai untuk stack "positive" & "negative"): seluruh
  // badan bar bisa digenggam & ditarik, plus overlay transparan di atas biar
  // area genggam tetap besar walau bar-nya pendek — persis pola waterfall lain.
  const renderBarFactory = (isNegativeStack: boolean) => (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null || !height) return null;
    const isDraggingThis = dragPreview?.index === index;
    const invertDrag = isNegativeStack;
    const dragStartValue = isNegativeStack ? payload.negative : payload.positive;
    const fillColor = payload.isBase ? 'var(--chart-2)' : (isNegativeStack ? 'var(--negative)' : 'var(--positive)');
    const dragHandlers = handleBarPointerDown(index, dragStartValue, height, invertDrag);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fillColor}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? fillColor : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam ke atas, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect x={x} y={y - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
      </g>
    );
  };
  const renderPositiveBar = renderBarFactory(false);
  const renderNegativeBar = renderBarFactory(true);

  if (items.length === 0) {
    return <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No data available yet.</div>;
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}M`}
            width={WF_AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip raw={displayData} />} cursor={false} />
          <Bar dataKey="invisible" stackId="a" fill="transparent" legendType="none" isAnimationActive={!dragPreview} />
          <Bar dataKey="positive" stackId="a" shape={renderPositiveBar as any} legendType="none" isAnimationActive={!dragPreview} />
          <Bar dataKey="negative" stackId="a" shape={renderNegativeBar as any} legendType="none" isAnimationActive={!dragPreview} />
        </BarChart>
      </ResponsiveContainer>
      {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
      <div
        onMouseDown={handleAxisMouseDown}
        onDoubleClick={resetZoom}
        title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: WF_AXIS_WIDTH }}
      />
    </div>
  );
}