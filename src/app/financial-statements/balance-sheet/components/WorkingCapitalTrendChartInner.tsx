'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLanguage } from '@/lib/language';
import { getNiceTicksFromZero, getNiceSymmetricTicks } from '@/lib/chartTicks';

const AXIS_WIDTH = 56;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 5; // + margin.left dari BarChart
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export interface WorkingCapitalRow {
  month: string;
  workingCapital: number;
}

function CustomTooltip({
  active,
  payload,
  label,
  fx,
  t,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; payload: WorkingCapitalRow }[];
  label?: string;
  fx: (v: number) => string;
  t: (s: string) => string;
  dragPreview?: { index: number; value: number } | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const isDragged = !!dragPreview && dragPreview.index === (payload[0] as any).index;
  const value = isDragged ? dragPreview!.value : row.workingCapital;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-bold text-slate-800 mb-2 pb-1.5 border-b border-slate-100">{label}</p>
      <div className="flex items-center justify-between gap-5">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#0d9488' }} />
          <span className="text-[11px] text-slate-500">{t('Working Capital')}</span>
        </div>
        <span className="text-[11px] font-semibold text-slate-800">
          {isDragged ? `${t('estimate')} · ` : ''}
          {fx(value)}
        </span>
      </div>
    </div>
  );
}

export default function WorkingCapitalTrendChartInner({
  data,
  fx,
}: {
  data: WorkingCapitalRow[];
  fx: (v: number) => string;
}) {
  const { t } = useLanguage();

  // ── Zoom skala harga (drag vertikal di sumbu Y) — pola sama seperti chart
  // "Financial Position" (FinancialPositionChartInner) di atasnya. ──
  const hasNegative = useMemo(() => data.some((d) => d.workingCapital < 0), [data]);
  const baseMax = useMemo(
    () => Math.max(1, ...data.map((d) => Math.abs(d.workingCapital))) * 1.15,
    [data]
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  // Tick "nice" (angka bulat) — domain chart tetap kontinu (baseMax / priceZoom)
  // supaya drag zoom tetap smooth, cuma label/gridline yang dibulatkan.
  const { ticks: yTicks } = useMemo(
    () => (hasNegative ? getNiceSymmetricTicks(baseMax / priceZoom, 4) : getNiceTicksFromZero(baseMax / priceZoom, 4)),
    [baseMax, priceZoom, hasNegative]
  );
  const yDomain = useMemo<[number, number]>(
    () => (hasNegative ? [-baseMax / priceZoom, baseMax / priceZoom] : [0, baseMax / priceZoom]),
    [baseMax, priceZoom, hasNegative]
  );
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

  // ── Drag badan bar (preview nilai realtime, spring-back saat dilepas) —
  // pola sama seperti bar teal/hijau di PL Waterfall (profit-loss/page.tsx):
  // tarik ATAS = nilai makin besar, tarik BAWAH = makin kecil, anchor di 0. ──
  const [dragPreview, setDragPreview] = useState<{ index: number; value: number } | null>(null);
  const dragStateRef = useRef<{
    index: number; startValue: number; startClientY: number; currentValue: number; pxPerUnit: number;
  } | null>(null);
  const animRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);

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

  // Reset drag + zoom kalau data berubah (mis. ganti client aktif) — index
  // bar & kalibrasi piksel jadi tidak relevan lagi.
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
      justDraggedRef.current = false;
      // pxPerUnit dari tinggi bar aktual saat ini (kita kontrol rendernya
      // sendiri lewat custom shape, jadi tahu persis geometrinya) — tarik
      // atas (clientY makin kecil) = nilai makin besar.
      const magnitude = Math.abs(startValue) || 1;
      let pxPerUnit = -barHeight / magnitude;
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
        const [dMin, dMax] = yDomainRef.current;
        pxPerUnit = -160 / ((dMax - dMin) || 1);
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
      if (Math.abs(deltaY) > 3) justDraggedRef.current = true;
      const [dMin, dMax] = yDomainRef.current;
      const clampMin = hasNegative ? dMin * 1.4 : 0;
      const clampMax = dMax * 1.4;
      const value = Math.max(clampMin, Math.min(clampMax, drag.startValue + deltaY / drag.pxPerUnit));
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
  }, [springBack, hasNegative]);

  const displayData = useMemo(() => {
    if (!dragPreview) return data;
    return data.map((d, i) => (i === dragPreview.index ? { ...d, workingCapital: dragPreview.value } : d));
  }, [data, dragPreview]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik, plus area
  // transparan tambahan di atas/bawah supaya gampang ditarik walau bar
  // pendek (pola sama seperti renderWaterfallBar di profit-loss/page.tsx).
  const renderBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragPreview?.index === index;
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragHandlers = handleBarPointerDown(index, payload.workingCapital, height);
    return (
      <g>
        <rect
          x={x} y={rectY} width={width} height={h}
          fill="#0d9488" rx={4} ry={4}
          stroke={isDraggingThis ? '#0d9488' : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam ke atas & bawah, biar mudah ditarik walau bar pendek */}
        <rect x={x} y={rectY - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        <rect x={x} y={rectY + h} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={displayData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => fx(v).replace(/^(Rp|S?\$)\s?/, '')}
            width={AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip fx={fx} t={t} dragPreview={dragPreview} />} cursor={false} />
          <Bar dataKey="workingCapital" name={t('Working Capital')} shape={renderBar as any} isAnimationActive={false} />
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

