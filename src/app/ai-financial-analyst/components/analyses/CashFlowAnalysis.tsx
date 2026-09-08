'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { getNiceSymmetricTicks, formatAxisValue } from '@/lib/chartTicks';

const cashFlowData = [
  { month: 'Jan', operating: 285000000, investing: -120000000, financing: -45000000, net: 120000000 },
  { month: 'Feb', operating: 310000000, investing: -85000000, financing: -50000000, net: 175000000 },
  { month: 'Mar', operating: 265000000, investing: -145000000, financing: -42000000, net: 78000000 },
  { month: 'Apr', operating: 298000000, investing: -98000000, financing: -48000000, net: 152000000 },
  { month: 'May', operating: 245000000, investing: -210000000, financing: -52000000, net: -17000000 },
  { month: 'Jun', operating: 322000000, investing: -115000000, financing: -55000000, net: 152000000 },
  { month: 'Jul', operating: 338000000, investing: -92000000, financing: -58000000, net: 188000000 },
  { month: 'Aug', operating: 195000000, investing: -68000000, financing: -42000000, net: 85000000 },
];

const fmtM = (v: number) => `${(v / 1000000).toFixed(0)}M`;

type CFKey = 'operating' | 'investing' | 'financing' | 'net';

function getBarColor(key: CFKey) {
  if (key === 'operating') return 'var(--success)';
  if (key === 'investing') return 'var(--danger)';
  if (key === 'financing') return 'var(--warning)';
  return 'var(--primary)';
}
const SERIES_NAME: Record<CFKey, string> = {
  operating: 'Operating CF',
  investing: 'Investing CF',
  financing: 'Financing CF',
  net: 'Net CF',
};

const AXIS_WIDTH = 42;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 4; // + margin.left dari BarChart
const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function CustomTooltip({ active, payload, label, fx, dragPreview }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => {
        const isDragged = !!dragPreview && dragPreview.key === p.dataKey && dragPreview.index === p.payload?.__index;
        const value = isDragged ? dragPreview.value : p.value;
        return (
          <div key={`cftt-${i}`} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className={`font-semibold ${value < 0 ? 'text-danger' : 'text-foreground'}`}>
              {isDragged ? 'est. · ' : ''}{fx(`Rp ${fmtM(value)}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Chart Monthly Cash Flow Components: drag zoom skala sumbu Y (drag vertikal
// di label sumbu) + drag badan bar per-kategori dengan arah dibatasi sesuai
// warna: Operating (hijau) & Net (biru) cuma bisa ditarik ke ATAS (nilai
// makin besar dari nilai asal, tidak bisa dikecilkan), Investing (merah) cuma
// bisa ditarik ke BAWAH (makin negatif dari nilai asal, tidak bisa dinaikkan),
// Financing (oranye) bebas dua arah. Lepas -> spring back ke nilai asli.
function CashFlowMonthlyChart({ fx }: { fx: (v: string) => string }) {
  const baseMax = useMemo(
    () => Math.max(1, ...cashFlowData.flatMap((d) => [Math.abs(d.operating), Math.abs(d.investing), Math.abs(d.financing), Math.abs(d.net)])) * 1.2,
    []
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: yTicks, step: yStep } = useMemo(() => getNiceSymmetricTicks(baseMax / priceZoom, 4), [baseMax, priceZoom]);
  const yDomain = useMemo<[number, number]>(() => [-baseMax / priceZoom, baseMax / priceZoom], [baseMax, priceZoom]);
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

  const [dragBar, setDragBar] = useState<{ key: CFKey; index: number; liveValue: number } | null>(null);
  const dragBarRef = useRef<{
    key: CFKey; index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
  } | null>(null);
  const springAnimRef = useRef<number | null>(null);

  const stopSpring = () => {
    if (springAnimRef.current) cancelAnimationFrame(springAnimRef.current);
    springAnimRef.current = null;
  };

  const springBack = () => {
    const drag = dragBarRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / SPRING_DURATION_MS);
      const eased = easeOutQuint(progress);
      const next = from + (to - from) * eased;
      if (dragBarRef.current) {
        dragBarRef.current = { ...dragBarRef.current, liveValue: next };
        setDragBar({ key: drag.key, index: drag.index, liveValue: next });
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

  useEffect(() => stopSpring, []);

  const handleBarPointerDown = (key: CFKey, index: number, startValue: number, barHeight: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    const magnitude = Math.abs(startValue) || 1;
    let pxPerUnitMagnitude = barHeight !== 0 ? Math.abs(barHeight) / magnitude : -1;
    if (!Number.isFinite(pxPerUnitMagnitude) || pxPerUnitMagnitude <= 0) {
      const [dMin, dMax] = yDomainRef.current;
      pxPerUnitMagnitude = 226 / (dMax - dMin || 1);
    }
    // pxPerUnit NEGATIF -> drag ke atas (deltaY negatif) menaikkan nilai
    const pxPerUnit = -pxPerUnitMagnitude;
    dragBarRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setDragBar({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragBarRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [dMin, dMax] = yDomainRef.current;
      const clampMax = dMax * 1.4;
      const clampMin = dMin * 1.4;
      let next = drag.startValue + deltaY / drag.pxPerUnit;
      if (drag.key === 'operating' || drag.key === 'net') {
        // Hijau & biru: cuma boleh naik dari nilai asal, tidak boleh turun.
        next = Math.max(drag.startValue, Math.min(clampMax, next));
      } else if (drag.key === 'investing') {
        // Merah: cuma boleh turun (makin negatif) dari nilai asal, tidak boleh naik.
        next = Math.min(drag.startValue, Math.max(clampMin, next));
      } else {
        // Oranye: bebas dua arah.
        next = Math.max(clampMin, Math.min(clampMax, next));
      }
      dragBarRef.current = { ...drag, liveValue: next };
      setDragBar({ key: drag.key, index: drag.index, liveValue: next });
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
  }, []);

  const displayData = useMemo(() => {
    const withIndex = cashFlowData.map((d, i) => ({ ...d, __index: i }));
    if (!dragBar) return withIndex;
    return withIndex.map((d, i) => (i === dragBar.index ? { ...d, [dragBar.key]: dragBar.liveValue } : d));
  }, [dragBar]);

  // Badan bar custom: seluruh kotak bisa digenggam & ditarik naik/turun.
  // Untuk nilai negatif, Recharts kadang mengirim `height` negatif (y = titik
  // bawah, height = jarak ke atas) -- normalisasi pakai Math.abs + geser y.
  const renderInteractiveBar = (key: CFKey) => (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragBar?.key === key && dragBar?.index === index;
    const color = getBarColor(key);
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const dragHandlers = handleBarPointerDown(key, index, payload[key], h);
    return (
      <g>
        <rect
          x={x} y={rectY} width={width} height={h}
          fill={color} rx={2} ry={2}
          stroke={isDraggingThis ? color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam di atas & bawah, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect x={x} y={rectY - 10} width={width} height={h + 20} fill="transparent" style={{ cursor: 'ns-resize' }} onPointerDown={dragHandlers} />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={displayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis
            ticks={yTicks}
            tickFormatter={(v) => formatAxisValue(v, yStep, 'M', 1000000)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={AXIS_WIDTH}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip fx={fx} dragPreview={dragBar} />} cursor={false} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
          <Bar dataKey="operating" name={SERIES_NAME.operating} fill={getBarColor('operating')} shape={renderInteractiveBar('operating') as any} isAnimationActive={!dragBar} />
          <Bar dataKey="investing" name={SERIES_NAME.investing} fill={getBarColor('investing')} shape={renderInteractiveBar('investing') as any} isAnimationActive={!dragBar} />
          <Bar dataKey="financing" name={SERIES_NAME.financing} fill={getBarColor('financing')} shape={renderInteractiveBar('financing') as any} isAnimationActive={!dragBar} />
          <Bar dataKey="net" name={SERIES_NAME.net} fill={getBarColor('net')} shape={renderInteractiveBar('net') as any} isAnimationActive={!dragBar} />
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

export default function CashFlowAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  return (
    <div className="space-y-6">
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Operating cash flow YTD is <strong>{fx('Rp 2.26M')}</strong>, healthy and sufficient to cover operations.
          However, investing activities consumed <strong>{fx('Rp 933M')}</strong> — primarily the IT infrastructure investment in Q2.
          Net cash position stands at <strong>{fx('Rp 2.96M')}</strong> with an estimated <strong>4.8 month runway</strong> at current burn rate.
          May was the only negative net cash flow month (-{fx('Rp 17M')}) due to peak infrastructure spend. Cash runway is adequate but AR collection improvement would significantly strengthen the position.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Opening Cash (Jan)', value: 'Rp 2.07M', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Operating CF', value: 'Rp 2.26M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Investing CF', value: '-Rp 933M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Financing CF', value: '-Rp 392M', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Net Cash Flow', value: 'Rp 933M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Closing Cash (Aug)', value: 'Rp 2.96M', color: 'text-primary', bg: 'bg-info-bg' },
          { label: 'Cash Runway', value: '4.8 months', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'AR Impact', value: 'Rp 320M', color: 'text-warning', bg: 'bg-warning-bg' },
        ].map((m) => (
          <div key={`cfm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-bold tabular-nums ${m.color}`}>{fx(m.value)}</p>
          </div>
        ))}
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-1">Monthly Cash Flow Components</h3>
        <p className="text-xs text-muted-foreground mb-4">Operating, Investing, Financing, and Net Cash Flow — Jan–Aug 2026</p>
        <CashFlowMonthlyChart fx={fx} />
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'High', title: 'Accelerate AR Collections to Improve Cash', desc: 'Collecting Rp 320M overdue AR would increase cash position by 10.8%, extending runway to 5.3+ months.', action: 'View AR', route: '/accounts-receivable' },
            { priority: 'Medium', title: 'Monitor Investing Outflows', desc: 'IT infrastructure investment is winding down. Ensure Q4 investing CF stays below Rp 100M to maintain healthy net cash.', action: 'View Transactions', route: '/transactions' },
            { priority: 'Low', title: 'Review AP Payment Timing', desc: 'Optimizing AP payment timing (pay closer to due dates) could improve working capital by Rp 80–120M.', action: 'View AP', route: '/accounts-payable' },
          ].map((rec) => (
            <div key={`cf-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${
                rec.priority === 'High' ? 'bg-orange-50 text-orange-700' :
                rec.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                'bg-secondary text-muted-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec.desc)}</p>
              </div>
              <button onClick={() => router.push(rec.route)} className="text-xs text-primary hover:underline font-medium flex-shrink-0 whitespace-nowrap">
                {rec.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}