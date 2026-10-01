'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// Fallback kosong kalau parent belum mengirim `data` (belum ada client aktif).
const SAMPLE_DATA: { period: string; payable: number }[] = [];

const AXIS_WIDTH = 40;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH; // margin.left BarChart di sini = 0
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

const CustomTooltip = ({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload: { __index: number } }>;
  label?: string;
  dragPreview?: { index: number; value: number } | null;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => {
        const isDragged = !!dragPreview && dragPreview.index === p.payload?.__index;
        const value = isDragged ? dragPreview!.value : p.value;
        return (
          <div key={`ppn-tt-${i}`} className="flex justify-between gap-4 mb-1">
            <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
            <span className="text-xs font-semibold tabular-nums" style={{ color: p.color }}>
              {isDragged ? 'est. · ' : ''}Rp {Math.round(value)}Jt
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default function PPNChartInner({ data }: { data?: { period: string; payable: number }[] }) {
  const baseData = data && data.length > 0 ? data : SAMPLE_DATA;

  // ── Zoom skala harga (drag vertikal di sumbu Y) — pola sama seperti chart lain ──
  const baseMax = useMemo(() => Math.max(1, ...baseData.map((d) => d.payable)) * 1.15, [baseData]);
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
  // di 0, tarik ATAS = nilai makin besar, tarik BAWAH = makin kecil. Ini
  // cuma preview visual, tidak mengubah data asli (`data` prop). ──
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

  // Reset drag + zoom kalau data berubah (mis. ganti periode/perusahaan).
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
  }, [baseData]);

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

  const chartData = useMemo(() => {
    return baseData.map((d, i) => ({
      ...d,
      __index: i,
      payable: dragPreview && dragPreview.index === i ? dragPreview.value : d.payable,
    }));
  }, [baseData, dragPreview]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik, plus area
  // transparan tambahan di atas/bawah supaya gampang ditarik walau bar-nya pendek.
  const renderBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragPreview?.index === index;
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragHandlers = handleBarPointerDown(index, payload.payable, height);
    return (
      <g>
        <rect
          x={x} y={rectY} width={width} height={h}
          fill="var(--warning)" fillOpacity={0.85} rx={3} ry={3}
          stroke={isDraggingThis ? 'var(--warning)' : 'none'}
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

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={20}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}Jt`}
            width={AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip dragPreview={dragPreview} />} cursor={false} />
          <Bar dataKey="payable" name="net payable" shape={renderBar as any} isAnimationActive={false} />
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