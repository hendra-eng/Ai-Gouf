'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import type { EquityWaterfallStep } from '../lib/useEquityData';

// Spring-back setelah drag bar dilepas — pola & durasi sama persis dengan
// EquityBridgeChartInner.tsx / PL & Cash Waterfall.
const WF_SPRING_DURATION_MS = 420;
const wfEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
const WF_AXIS_WIDTH = 52;

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat EquityContent.tsx
// (useEquityData()) untuk sumber data ASLI client aktif. Versi ASLI cuma
// punya 2 komponen (Net Profit + Other Equity Movements digabung) karena
// trial_balance_bulanan tidak menyimpan jenis mutasi ekuitas per transaksi
// (dividen/setoran modal/revaluasi/OCI) -- lihat komentar di useEquityData.ts.
const mockWaterfallData: EquityWaterfallStep[] = [
  { name: 'Beginning Equity', value: 4290, type: 'base' },
  { name: 'Net Profit', value: 1840, type: 'positive' },
  { name: 'Capital Injection', value: 0, type: 'neutral' },
  { name: 'Dividends Paid', value: -880, type: 'negative' },
  { name: 'Revaluation Gain', value: 50, type: 'positive' },
  { name: 'OCI Adjustments', value: -600, type: 'negative' },
  { name: 'Ending Equity', value: 4700, type: 'base' },
];

const TYPE_COLOR: Record<EquityWaterfallStep['type'], string> = {
  base: '#2563eb',
  positive: '#16a34a',
  negative: '#dc2626',
  neutral: '#64748b',
};

function buildChartData(steps: EquityWaterfallStep[]) {
  let runningCumulative = 0;
  return steps.map((d, i) => {
    if (d.type === 'base') {
      runningCumulative = d.value;
      return { ...d, cumulative: d.value, color: TYPE_COLOR[d.type], invisible: 0, display: d.value };
    }
    const before = runningCumulative;
    runningCumulative += d.value;
    const base = Math.min(before, runningCumulative);
    const display = Math.abs(d.value);
    return { ...d, cumulative: runningCumulative, color: TYPE_COLOR[d.type], invisible: base, display };
  });
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { payload: ReturnType<typeof buildChartData>[0] }[]; label?: string }) => {
  if (!active || !payload || !payload[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[180px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Movement</span>
        <span className={`font-600 ${d.type === 'negative' ? 'text-negative' : d.type === 'positive' ? 'text-positive' : 'text-primary'}`}>
          {d.type === 'negative' ? '-' : d.type === 'positive' ? '+' : ''}Rp {Math.abs(d.value).toLocaleString('id-ID')}M
        </span>
      </div>
      <div className="flex justify-between gap-4 mt-1">
        <span className="text-muted-foreground">Cumulative</span>
        <span className="font-600 text-foreground">Rp {d.cumulative.toLocaleString('id-ID')}M</span>
      </div>
    </div>
  );
};

interface EquityMovementChartProps {
  steps?: EquityWaterfallStep[];
  periodLabel?: string;
}

export default function EquityMovementChart({ steps, periodLabel }: EquityMovementChartProps) {
  const source = steps && steps.length > 0 ? steps : mockWaterfallData;
  const chartData = useMemo(() => buildChartData(source), [source]);

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — pola sama persis dengan
  // EquityBridgeChartInner.tsx / Financial Overview / PL Waterfall. Tarik
  // naik/turun di area label sumbu Y buat zoom in/out skala, double-click
  // buat reset. Angka dasar (baseMax) TETAP dihitung sama seperti sebelumnya
  // (dibulatkan ke kelipatan 500) supaya tampilan awal (zoom 1×) tidak berubah. ──
  const baseMax = useMemo(() => {
    const maxCumulative = Math.max(...chartData.map((d) => Math.max(d.cumulative, (d as any).invisible + (d as any).display)));
    return Math.ceil((maxCumulative * 1.1) / 500) * 500 || 500;
  }, [chartData]);
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
  // pola sama persis dengan EquityBridgeChartInner.tsx / PL Waterfall.
  // Arah drag per tipe:
  //  - 'base' (Beginning/Ending Equity): anchor 0, tarik ATAS = nilai makin besar.
  //  - 'positive' (Increase): anchor BAWAH tetap (level sebelum step ini),
  //    tarik ATAS = magnitude makin besar.
  //  - 'negative' (Decrease): anchor ATAS tetap, tarik BAWAH = makin dalam
  //    (dibalik, sama seperti bar merah di PL Waterfall).
  //  - 'neutral' (Adjustment, mis. Capital Injection): bebas dua arah dari
  //    anchor, sama seperti kategori "Financing"/orange di chart lain. ──
  const [dragPreview, setDragPreview] = useState<{ index: number; value: number } | null>(null);
  const dragStateRef = useRef<{
    index: number; startValue: number; startClientY: number; currentValue: number; pxPerUnit: number;
    clampMin: number; clampMax: number;
  } | null>(null);
  const animRef = useRef<number | null>(null);
  // true kalau pointer sudah bergerak (dianggap "drag", bukan klik biasa).
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

  // Reset drag & zoom kalau data berubah (mis. ganti client aktif / periode) —
  // index bar & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
    setPriceZoom(1);
  }, [chartData]);

  const handleBarPointerDown = useCallback(
    (index: number, startValue: number, barHeight: number, invertDrag: boolean, clampMin: number, clampMax: number) => (
      e: React.PointerEvent
    ) => {
      e.preventDefault();
      e.stopPropagation();
      stopSpring();
      justDraggedRef.current = false;
      const magnitude = Math.abs(startValue) || 1;
      let pxPerUnit = -barHeight / magnitude;
      if (invertDrag) pxPerUnit = -pxPerUnit;
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
        const [, dMax] = yDomainRef.current;
        pxPerUnit = -220 / (dMax || 1);
      }
      dragStateRef.current = { index, startValue, startClientY: e.clientY, currentValue: startValue, pxPerUnit, clampMin, clampMax };
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
      const value = Math.max(drag.clampMin, Math.min(drag.clampMax, drag.startValue + deltaY / drag.pxPerUnit));
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

  // Data yang benar-benar dikirim ke chart: sama seperti chartData, kecuali
  // satu bar yang sedang ditarik/spring-back diganti nilai live-nya. Data
  // asli (steps / props) TIDAK pernah dimutasi — cuma override tampilan
  // sementara, sama seperti waterfallDisplayBars di PL Waterfall.
  const displayData = useMemo(() => {
    if (!dragPreview) return chartData;
    return chartData.map((d, i) => {
      if (i !== dragPreview.index) return d;
      if (d.type === 'base') {
        return { ...d, display: dragPreview.value, invisible: 0, value: dragPreview.value, cumulative: dragPreview.value };
      }
      if (d.type === 'neutral') {
        // Anchor = level kumulatif sebelum step ini (fixed), delta bertanda
        // bebas dua arah dari situ — persis pola bar oranye di PL Waterfall.
        const anchor = d.value >= 0 ? (d as any).invisible : (d as any).invisible + (d as any).display;
        const delta = dragPreview.value;
        const top = anchor + Math.max(delta, 0);
        const bottom = anchor + Math.min(delta, 0);
        return { ...d, invisible: bottom, display: top - bottom, value: delta, cumulative: anchor + delta };
      }
      if (d.type === 'negative') {
        const anchorTop = (d as any).invisible + (d as any).display;
        const newMagnitude = dragPreview.value;
        return { ...d, invisible: anchorTop - newMagnitude, display: newMagnitude, value: -newMagnitude, cumulative: anchorTop - newMagnitude };
      }
      // 'positive': anchor BAWAH tetap.
      const anchorBottom = (d as any).invisible;
      return { ...d, display: dragPreview.value, value: dragPreview.value, cumulative: anchorBottom + dragPreview.value };
    });
  }, [chartData, dragPreview]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik (bukan cuma
  // titik), plus overlay transparan di atas & bawah biar area genggam tetap
  // besar walau bar-nya pendek — persis pola EquityBridgeChartInner.tsx.
  const renderWaterfallBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isNeutral = payload.type === 'neutral';
    const invertDrag = payload.type === 'negative';
    const isDraggingThis = dragPreview?.index === index;
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragStartValue = isNeutral ? payload.value : payload.display;
    const maxValue = (baseMax / priceZoom) * 1.4;
    const clampMin = isNeutral ? -maxValue : 0;
    const dragHandlers = handleBarPointerDown(index, dragStartValue, height, invertDrag, clampMin, maxValue);
    return (
      <g>
        <rect
          x={x}
          y={rectY}
          width={width}
          height={h}
          fill={payload.color}
          opacity={payload.type === 'base' ? 0.9 : 0.85}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? payload.color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam ke atas, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect x={x} y={rectY - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        {/* Neutral (Adjustment) bisa ditarik dua arah -> genggaman diperluas ke bawah juga */}
        {isNeutral && (
          <rect x={x} y={rectY + h} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
        )}
      </g>
    );
  };

  return (
    <div className="fin-card p-5">
      <div className="mb-4">
        <div className="text-[14px] font-600 text-foreground">Equity Movement (Waterfall)</div>
        <div className="text-[11px] text-muted-foreground">Beginning to ending equity{periodLabel ? ` — ${periodLabel}` : ' — Jan–Aug 2026'}</div>
      </div>

      <div className="relative">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={displayData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `${v}M`}
              width={WF_AXIS_WIDTH}
              ticks={yTicks}
              domain={yDomain}
              allowDataOverflow
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            {/* Invisible base bar */}
            <Bar dataKey="invisible" stackId="a" fill="transparent" radius={[0, 0, 0, 0]} isAnimationActive={!dragPreview} />
            {/* Visible delta bar */}
            <Bar dataKey="display" stackId="a" shape={renderWaterfallBar as any} name="Movement" isAnimationActive={!dragPreview} />
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

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 pt-3 border-t border-border flex-wrap">
        {[
          { label: 'Beginning/Ending', color: '#2563eb' },
          { label: 'Increase', color: '#16a34a' },
          { label: 'Decrease', color: '#dc2626' },
          { label: 'Adjustment', color: '#d97706' },
        ].map(l => (
          <div key={`wf-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}