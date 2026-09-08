'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

const comparisonData = [
  { metric: 'Revenue', q1: 3050, q2: 3260, change: 6.9, unit: 'M' },
  { metric: 'Gross Profit', q1: 1315, q2: 1355, change: 3.0, unit: 'M' },
  { metric: 'Gross Margin', q1: 43.1, q2: 41.6, change: -1.5, unit: '%' },
  { metric: 'Operating Exp', q1: 512, q2: 555, change: 8.4, unit: 'M' },
  { metric: 'EBITDA', q1: 803, q2: 800, change: -0.4, unit: 'M' },
  { metric: 'Net Profit', q1: 680, q2: 710, change: 4.4, unit: 'M' },
  { metric: 'Cash Flow', q1: 373, q2: 287, change: -23.1, unit: 'M' },
  { metric: 'AR Balance', q1: 1038, q2: 1155, change: 11.3, unit: 'M' },
  { metric: 'AP Balance', q1: 678, q2: 795, change: 17.3, unit: 'M' },
];

const chartData = [
  { name: 'Revenue', Q1: 3050, Q2: 3260 },
  { name: 'Gross Profit', Q1: 1315, Q2: 1355 },
  { name: 'EBITDA', Q1: 803, Q2: 800 },
  { name: 'Net Profit', Q1: 680, Q2: 710 },
];

const CustomTooltip = ({ active, payload, label, dragPreview }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => {
        const isDragged = !!dragPreview && dragPreview.key === p.dataKey && dragPreview.index === p.payload?.__index;
        const value = isDragged ? dragPreview.value : p.value;
        return (
          <div key={`qtt-${i}`} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-semibold text-foreground">
              {isDragged ? 'est. · ' : ''}Rp {Math.round(value)}M
            </span>
          </div>
        );
      })}
    </div>
  );
};

const AXIS_WIDTH = 42;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 4; // + margin.left dari BarChart
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

type BarKey = 'Q1' | 'Q2';

// Chart Q1 vs Q2: drag zoom skala sumbu Y + drag badan bar (preview realtime,
// spring-back saat dilepas) — pola sama seperti chart lain di dashboard.
function QuarterComparisonChart() {
  const baseMax = useMemo(
    () => Math.max(1, ...chartData.flatMap((d) => [d.Q1, d.Q2])) * 1.15,
    []
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

  const [dragPreview, setDragPreview] = useState<{ key: BarKey; index: number; value: number } | null>(null);
  const dragStateRef = useRef<{
    key: BarKey; index: number; startValue: number; startClientY: number; currentValue: number; pxPerUnit: number;
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
    const { key, index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SPRING_DURATION_MS);
      const eased = easeOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (dragStateRef.current) dragStateRef.current.currentValue = next;
      setDragPreview({ key, index, value: next });
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
    (key: BarKey, index: number, startValue: number, barHeight: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stopSpring();
      const magnitude = Math.abs(startValue) || 1;
      let pxPerUnit = -barHeight / magnitude;
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
        const [, dMax] = yDomainRef.current;
        pxPerUnit = -140 / (dMax || 1);
      }
      dragStateRef.current = { key, index, startValue, startClientY: e.clientY, currentValue: startValue, pxPerUnit };
      setDragPreview({ key, index, value: startValue });
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
      setDragPreview({ key: drag.key, index: drag.index, value });
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
    const withIndex = chartData.map((d, i) => ({ ...d, __index: i }));
    if (!dragPreview) return withIndex;
    return withIndex.map((d, i) => (i === dragPreview.index ? { ...d, [dragPreview.key]: dragPreview.value } : d));
  }, [dragPreview]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik, plus area
  // transparan tambahan di atas biar gampang ditarik walau bar-nya pendek.
  const renderBar = (key: BarKey, fillColor: string) => (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragPreview?.key === key && dragPreview?.index === index;
    const h = Math.max(0, height);
    const dragHandlers = handleBarPointerDown(key, index, payload[key], h);
    return (
      <g>
        <rect
          x={x} y={y} width={width} height={h}
          fill={fillColor} rx={3} ry={3}
          stroke={isDraggingThis ? fillColor : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        <rect x={x} y={y - 10} width={width} height={10} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={displayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => `${v}M`}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip dragPreview={dragPreview} />} cursor={false} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Q1" name="Q1 2026" fill="var(--muted)" shape={renderBar('Q1', 'var(--muted)') as any} isAnimationActive={false} />
          <Bar dataKey="Q2" name="Q2 2026" fill="var(--primary)" shape={renderBar('Q2', 'var(--primary)') as any} isAnimationActive={false} />
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

export default function QuarterComparison() {
  return (
    <div className="space-y-6">
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Q2 2026 showed <strong>revenue growth of +6.9%</strong> vs Q1, driven by new contract wins. However, gross margin contracted 1.5pp to 41.6%
          due to higher COGS. Operating expenses grew +8.4%, outpacing revenue growth — the primary margin compression driver.
          EBITDA was essentially flat (-0.4%) while net profit improved +4.4% due to lower tax provisions.
          A concerning trend is the <strong>AR balance growing +11.3%</strong> and <strong>AP growing +17.3%</strong> — working capital deterioration that warrants attention.
        </p>
      </div>

      {/* Side-by-side comparison table */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card overflow-x-auto">
        <h3 className="text-md font-semibold text-foreground mb-4">Q1 vs Q2 2026 — Detailed Comparison</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Metric</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Q1 2026</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Q2 2026</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">% Change</th>
            </tr>
          </thead>
          <tbody>
            {comparisonData.map((row) => {
              const isPositive = row.metric === 'Operating Exp' || row.metric === 'AR Balance' || row.metric === 'AP Balance'
                ? row.change < 0
                : row.change > 0;
              const isNeutral = Math.abs(row.change) < 1;
              return (
                <tr key={`qc-${row.metric}`} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-medium text-foreground">{row.metric}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.unit === '%' ? `${row.q1}%` : `Rp ${row.q1}M`}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {row.unit === '%' ? `${row.q2}%` : `Rp ${row.q2}M`}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    <span className={isNeutral ? 'text-muted-foreground' : isPositive ? 'text-success' : 'text-danger'}>
                      {row.change > 0 ? '+' : ''}{row.unit === '%' ? `${row.change}pp` : `Rp ${Math.abs(row.q2 - row.q1)}M`}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                      isNeutral ? 'bg-secondary text-muted-foreground' :
                      isPositive ? 'bg-success-bg text-success-foreground': 'bg-danger-bg text-danger-foreground'
                    }`}>
                      {row.change > 0 ? '+' : ''}{row.change}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-4">Key Metrics — Q1 vs Q2 (Rp Million)</h3>
        <QuarterComparisonChart />
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Interpretation</h3>
        </div>
        <div className="space-y-3">
          {[
            { type: 'positive', title: 'Revenue momentum is strong', desc: '+6.9% Q-on-Q revenue growth is above industry average. New contracts are materializing into bookings.' },
            { type: 'warning', title: 'Opex growing faster than revenue', desc: '+8.4% opex vs +6.9% revenue — margin compression will continue unless opex is controlled in Q3.' },
            { type: 'negative', title: 'Working capital deteriorating', desc: 'AR +11.3% and AP +17.3% Q-on-Q indicates cash conversion cycle is lengthening. Requires immediate management attention.' },
            { type: 'neutral', title: 'EBITDA stability maintained', desc: 'Despite margin pressure, EBITDA remained flat — operational efficiency is largely preserved.' },
          ].map((insight) => (
            <div
              key={`qi-${insight.title}`}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                insight.type === 'positive' ? 'bg-success-bg border-green-200' :
                insight.type === 'warning' ? 'bg-warning-bg border-yellow-200' :
                insight.type === 'negative'? 'bg-danger-bg border-red-200' : 'bg-secondary border-border'
              }`}
            >
              <Icon
                name={insight.type === 'positive' ? 'CheckCircleIcon' : insight.type === 'warning' ? 'ExclamationTriangleIcon' : insight.type === 'negative' ? 'XCircleIcon' : 'InformationCircleIcon'}
                size={16}
                className={insight.type === 'positive' ? 'text-success' : insight.type === 'warning' ? 'text-warning' : insight.type === 'negative' ? 'text-danger' : 'text-muted-foreground'}
              />
              <div>
                <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{insight.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}