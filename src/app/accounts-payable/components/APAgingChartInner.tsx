'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

export interface APAgingRow {
  bucket: string;
  amount: number;
  percentage: number;
  color: string;
}

const AXIS_WIDTH = 42;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 4; // + margin.left dari BarChart
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function CustomTooltip({
  active,
  payload,
  fx,
  dragPreview,
}: {
  active?: boolean;
  payload?: { payload: APAgingRow & { __index: number } }[];
  fx: (v: number) => string;
  dragPreview?: { index: number; value: number } | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const isDragged = !!dragPreview && dragPreview.index === d.__index;
  const value = isDragged ? dragPreview!.value : d.amount;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{d.bucket}</p>
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
        <span className="text-muted-foreground">Amount:</span>
        <span className="font-semibold text-foreground">
          {isDragged ? 'est. · ' : ''}
          {fx(value)}
        </span>
      </div>
    </div>
  );
}

export default function APAgingChartInner({
  data,
  fx,
}: {
  data: APAgingRow[];
  fx: (v: number) => string;
}) {
  // ── Zoom skala harga (drag vertikal di sumbu Y) — pola sama seperti chart
  // Working Capital Trend / Financial Position. ──
  const baseMax = useMemo(() => Math.max(1, ...data.map((d) => d.amount)) * 1.15, [data]);
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: yTicks } = useMemo(() => getNiceTicksFromZero(baseMax / priceZoom, 4), [baseMax, priceZoom]);
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

  // ── Drag badan bar (preview realtime, spring-back saat dilepas) — anchor
  // di 0, tarik ATAS = nilai makin besar, tarik BAWAH = makin kecil. ──
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

  // Reset drag + zoom kalau data berubah (mis. ganti client aktif).
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
  }, [data]);

  useEffect(() => stopSpring, []);

  const handleBarPointerDown = useCallback(
    (index: number, startValue: number, barHeight: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stopSpring();
      const magnitude = Math.abs(startValue) || 1;
      let pxPerUnit = -barHeight / magnitude;
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
        const [, dMax] = yDomainRef.current;
        pxPerUnit = -140 / (dMax || 1);
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
    if (!dragPreview) return data;
    return data.map((d, i) => (i === dragPreview.index ? { ...d, amount: dragPreview.value } : d));
  }, [data, dragPreview]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik (warna per-
  // bucket dipertahankan dari `color`), plus area transparan tambahan di
  // atas/bawah supaya gampang ditarik walau bar-nya pendek.
  const renderBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragPreview?.index === index;
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragHandlers = handleBarPointerDown(index, payload.amount, height);
    return (
      <g>
        <rect
          x={x} y={rectY} width={width} height={h}
          fill={payload.color} rx={3} ry={3}
          stroke={isDraggingThis ? payload.color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        <rect x={x} y={rectY - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        <rect x={x} y={rectY + h} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
      </g>
    );
  };
  renderBar.displayName = 'RenderBar';

  const chartData = useMemo(() => displayData.map((d, i) => ({ ...d, __index: i })), [displayData]);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip fx={fx} dragPreview={dragPreview} />} cursor={false} />
          <Bar dataKey="amount" name="Amount" shape={renderBar as any} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
      <div
        onMouseDown={handleAxisMouseDown}
        onDoubleClick={resetZoom}
        title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: AXIS_OVERLAY_WIDTH }}
      />
    </div>
  );
}