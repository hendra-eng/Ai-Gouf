'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// [UBAH] Data contoh dikosongkan -- diisi backend P&L setelah client aktif
// punya jurnal yang cukup untuk periode ini.
const waterfallData = [
  { name: 'Revenue', value: 0, type: 'positive' },
  { name: 'COGS', value: 0, type: 'negative' },
  { name: 'Gross Profit', value: 0, type: 'subtotal' },
  { name: 'Opex', value: 0, type: 'negative' },
  { name: 'EBITDA', value: 0, type: 'subtotal' },
  { name: 'D&A', value: 0, type: 'negative' },
  { name: 'EBIT', value: 0, type: 'subtotal' },
  { name: 'Tax', value: 0, type: 'negative' },
  { name: 'Net Profit', value: 0, type: 'result' },
];

const monthlyProfit = [
  { month: 'Jan', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Feb', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Mar', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Apr', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'May', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Jun', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Jul', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
  { month: 'Aug', revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 },
];

type PlKey = 'revenue' | 'cogs' | 'grossProfit' | 'opex' | 'netProfit';

// Spring-back setelah drag titik dilepas — pola & durasi sama persis dengan
// chart lain (Financial Overview, Total Assets/Liabilities/Equity Trend, dst).
const PL_SPRING_DURATION_MS = 420;
const plEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

const drivers: { category: string; impact: number; type: 'positive' | 'negative'; description: string }[] = [];

// [UBAH] Rekomendasi contoh dikosongkan -- akan di-generate backend AI setelah
// data transaksi client tersedia.
const recommendations: { priority: string; title: string; desc: string; action: string; route: string }[] = [];

// v is expressed in raw IDR; fmtM receives values already in millions (Jt).
const fmt = (v: number) => `${(v / 1000000000).toFixed(2).replace('.', ',')}M`;
const fmtM = (v: number) => `${v}Jt`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`ptt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">{fx(`Rp ${p.value}M`)}</span>
        </div>
      ))}
    </div>
  );
};

export default function ProfitAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [drillLevel, setDrillLevel] = useState(0);
  const [drillPath, setDrillPath] = useState<string[]>([]);

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — tarik naik/turun di area
  // label sumbu Y buat zoom in/out skala, double-click buat reset. Data
  // (`monthlyProfit`) tidak pernah diubah, cuma domain/tick sumbu yang berubah. ──
  const plBaseMax = useMemo(
    () => Math.max(0, ...monthlyProfit.map((d) => Math.max(d.revenue, d.cogs, d.grossProfit, d.opex, d.netProfit))) * 1.08 || 1,
    []
  );
  const [plZoom, setPlZoom] = useState(1);
  const plZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: plYTicks } = useMemo(
    () => getNiceTicksFromZero(plBaseMax / plZoom, 5),
    [plBaseMax, plZoom]
  );
  const plYDomain = useMemo<[number, number]>(
    () => [0, plBaseMax / plZoom],
    [plBaseMax, plZoom]
  );

  const handlePlAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    plZoomDragRef.current = { startY: e.clientY, startZoom: plZoom };
    const onMove = (ev: MouseEvent) => {
      if (!plZoomDragRef.current) return;
      const deltaY = plZoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, plZoomDragRef.current.startZoom * factor));
      setPlZoom(next);
    };
    const onUp = () => {
      plZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetPlZoom = () => setPlZoom(1);

  // ── Fitur 2: Drag titik garis (Revenue/COGS/Gross Profit/Opex/Net Profit)
  // di bulan yang sedang di-hover — tarik naik/turun untuk preview nilai
  // (live), lepas -> "spring back" ke nilai aslinya. Kalibrasi piksel<->nilai
  // diambil dari titik-titik lain yang sudah dirender, jadi tetap akurat
  // walau chart sedang di-zoom (plZoom) atau lebar containernya berubah-ubah. ──
  const plDotsRef = useRef<Record<PlKey, { value: number; cy: number }[]>>({
    revenue: [],
    cogs: [],
    grossProfit: [],
    opex: [],
    netProfit: [],
  });

  const [plDragPoint, setPlDragPoint] = useState<{ key: PlKey; index: number; liveValue: number } | null>(null);
  const plDragPointRef = useRef<{
    key: PlKey;
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number; // px per 1 satuan nilai (negatif: makin ke atas makin besar nilainya)
  } | null>(null);
  const plPointAnimRef = useRef<number | null>(null);
  const plYDomainRef = useRef(plYDomain);
  plYDomainRef.current = plYDomain;

  const stopPlPointSpring = () => {
    if (plPointAnimRef.current) cancelAnimationFrame(plPointAnimRef.current);
    plPointAnimRef.current = null;
  };

  const plSpringBackPoint = useCallback(() => {
    const drag = plDragPointRef.current;
    if (!drag) return;
    stopPlPointSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { key, index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / PL_SPRING_DURATION_MS);
      const eased = plEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (plDragPointRef.current) plDragPointRef.current.liveValue = next;
      setPlDragPoint({ key, index, liveValue: next });
      if (elapsed < 1) {
        plPointAnimRef.current = requestAnimationFrame(step);
      } else {
        plDragPointRef.current = null;
        plPointAnimRef.current = null;
        setPlDragPoint(null);
      }
    };
    plPointAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handlePlDotPointerDown = (key: PlKey, index: number, startValue: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopPlPointSpring();

    // Kalibrasi px-per-unit dari 2 titik lain (selain yang sedang ditarik) di
    // garis yang sama -- linear, jadi titik mana saja bisa dipakai asal beda nilai.
    const samples = plDotsRef.current[key].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      // fallback kalau kalibrasi gagal (mis. cuma 1 titik data): perkiraan kasar dari yDomain
      const [dMin, dMax] = plYDomainRef.current;
      pxPerUnit = -180 / (dMax - dMin || 1);
    }

    plDragPointRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setPlDragPoint({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = plDragPointRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = plYDomainRef.current;
      const maxValue = dMax * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setPlDragPoint({ key: drag.key, index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (plDragPointRef.current) plSpringBackPoint();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [plSpringBackPoint]);

  // Data yang benar-benar dikirim ke chart: sama seperti `monthlyProfit`,
  // kecuali satu titik (bulan + garis) yang sedang ditarik/spring-back
  // diganti nilai live-nya. Data asli (`monthlyProfit`) TIDAK pernah dimutasi.
  const plDisplayData = useMemo(() => {
    if (!plDragPoint) return monthlyProfit;
    return monthlyProfit.map((d, i) => (i === plDragPoint.index ? { ...d, [plDragPoint.key]: plDragPoint.liveValue } : d));
  }, [plDragPoint]);

  // Dot tak terlihat di SETIAP titik data: cuma untuk merekam posisi piksel
  // (cy) & nilai asli tiap titik ke plDotsRef, dipakai buat kalibrasi drag.
  const renderPlCalibrationDot = (key: PlKey) => function PlCalibrationDot(props: any) {
    const { cx, cy, index, payload } = props;
    plDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot yang terlihat & bisa digenggam di bulan yang sedang di-hover — tarik
  // vertikal untuk preview, lepas untuk spring-back ke nilai asli.
  const renderPlActiveDot = (key: PlKey, color: string) => function PlActiveDot(props: any) {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = plDragPoint?.key === key && plDragPoint?.index === index;
    return (
      <g key={`pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 4} fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handlePlDotPointerDown(key, index, payload[key])}
        />
      </g>
    );
  };

  const handleDrill = (item: string) => {
    setDrillLevel((l) => l + 1);
    setDrillPath((p) => [...p, item]);
  };

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Net profit for this period is <strong>{fx('Rp 0')}</strong>, representing a margin of <strong>0%</strong> on revenue of {fx('Rp 0')}.
          No profit & loss data is available yet for this period.
        </p>
      </div>

      {/* Key Findings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: 'ArrowTrendingUpIcon', color: 'text-success', bg: 'bg-success-bg', label: 'Revenue Growth', value: '0%', desc: 'vs previous period' },
          { icon: 'ArrowTrendingDownIcon', color: 'text-danger', bg: 'bg-danger-bg', label: 'Margin Compression', value: '0pp', desc: 'Gross margin vs prior period' },
          { icon: 'ExclamationTriangleIcon', color: 'text-warning', bg: 'bg-warning-bg', label: 'Opex Growth', value: '0%', desc: 'vs revenue growth rate' },
        ].map((f) => (
          <div key={`finding-${f.label}`} className={`${f.bg} border rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon name={f.icon as any} size={16} className={f.color} />
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${f.color}`}>{f.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Monthly Trend Chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-1">Monthly P&L Trend</h3>
        <p className="text-xs text-muted-foreground mb-4">Revenue, COGS, Gross Profit, Opex, Net Profit — Jan–Aug 2026 (Rp Million)</p>
        <div className="relative">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={plDisplayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={fmtM}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={42}
                ticks={plYTicks}
                domain={plYDomain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={renderPlCalibrationDot('revenue') as any}
                activeDot={renderPlActiveDot('revenue', 'var(--primary)') as any}
                isAnimationActive={!plDragPoint}
              />
              <Line
                type="monotone"
                dataKey="cogs"
                name="COGS"
                stroke="var(--danger)"
                strokeWidth={1.5}
                dot={renderPlCalibrationDot('cogs') as any}
                activeDot={renderPlActiveDot('cogs', 'var(--danger)') as any}
                isAnimationActive={!plDragPoint}
              />
              <Line
                type="monotone"
                dataKey="grossProfit"
                name="Gross Profit"
                stroke="var(--success)"
                strokeWidth={2}
                dot={renderPlCalibrationDot('grossProfit') as any}
                activeDot={renderPlActiveDot('grossProfit', 'var(--success)') as any}
                isAnimationActive={!plDragPoint}
              />
              <Line
                type="monotone"
                dataKey="opex"
                name="Opex"
                stroke="var(--warning)"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={renderPlCalibrationDot('opex') as any}
                activeDot={renderPlActiveDot('opex', 'var(--warning)') as any}
                isAnimationActive={!plDragPoint}
              />
              <Line
                type="monotone"
                dataKey="netProfit"
                name="Net Profit"
                stroke="var(--ai-purple)"
                strokeWidth={2}
                dot={renderPlCalibrationDot('netProfit') as any}
                activeDot={renderPlActiveDot('netProfit', 'var(--ai-purple)') as any}
                isAnimationActive={!plDragPoint}
              />
            </LineChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
          <div
            onMouseDown={handlePlAxisMouseDown}
            onDoubleClick={resetPlZoom}
            title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 42 }}
          />
        </div>
      </div>

      {/* Performance Drivers */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-4">Performance Drivers</h3>
        {drivers.length === 0 && (
          <p className="text-xs text-muted-foreground">No performance drivers identified yet.</p>
        )}
        <div className="space-y-3">
          {drivers.map((d) => (
            <div key={`driver-${d.category}`} className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${d.type === 'positive' ? 'bg-success-bg' : 'bg-danger-bg'}`}>
                <Icon name={d.type === 'positive' ? 'ArrowTrendingUpIcon' : 'ArrowTrendingDownIcon'} size={14} className={d.type === 'positive' ? 'text-success' : 'text-danger'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{d.category}</p>
                  <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${d.type === 'positive' ? 'text-success' : 'text-danger'}`}>
                    {d.impact < 0 ? '-' : '+'}{fx(`Rp ${(Math.abs(d.impact) / 1000000).toFixed(0)}M`)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{fx(d.description)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Investigation Drill-Down */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="MagnifyingGlassIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Investigation: Why is Opex Increasing?</h3>
        </div>

        {/* Drill path */}
        {drillPath.length > 0 && (
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <button onClick={() => { setDrillLevel(0); setDrillPath([]); }} className="text-xs text-primary hover:underline">Operating Expenses</button>
            {drillPath.map((p, i) => (
              <React.Fragment key={`drill-path-${i}`}>
                <Icon name="ChevronRightIcon" size={12} className="text-muted-foreground" />
                <button onClick={() => { setDrillLevel(i + 1); setDrillPath(drillPath.slice(0, i + 1)); }} className="text-xs text-primary hover:underline">{p}</button>
              </React.Fragment>
            ))}
          </div>
        )}

        {drillLevel === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">{fx('Total Opex: Rp 0 — click to investigate each category')}</p>
            {[
              { name: 'IT Infrastructure', amount: 0, change: '0%', pct: 0, color: 'bg-danger' },
              { name: 'Salaries & Benefits', amount: 0, change: '0%', pct: 0, color: 'bg-primary' },
              { name: 'Marketing', amount: 0, change: '0%', pct: 0, color: 'bg-warning' },
              { name: 'Rent & Utilities', amount: 0, change: '0%', pct: 0, color: 'bg-info' },
              { name: 'Other Opex', amount: 0, change: '0%', pct: 0, color: 'bg-muted-foreground' },
            ].map((item) => (
              <div
                key={`opex-${item.name}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(item.name)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold ${item.change.startsWith('+') ? 'text-danger' : 'text-success'}`}>{item.change}</span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">{fx(`Rp ${(item.amount / 1000000).toFixed(0)}M`)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
          </div>
        )}

        {drillLevel === 1 && drillPath[0] === 'IT Infrastructure' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">{fx('IT Infrastructure: Rp 0 — no vendor breakdown available yet')}</p>
            {([] as { vendor: string; amount: number; category: string; invoices: number; status: string }[]).map((item) => (
              <div
                key={`it-${item.vendor}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(item.vendor)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{item.vendor}</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{fx(`Rp ${(item.amount / 1000000).toFixed(0)}M`)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">{item.category}</span>
                    <span className="text-xs text-muted-foreground">{item.invoices} invoice{item.invoices > 1 ? 's' : ''}</span>
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold ${item.status === 'Overdue' ? 'bg-danger-bg text-danger-foreground' : item.status === 'Due Soon' ? 'bg-warning-bg text-warning-foreground' : item.status === 'Paid' ? 'bg-success-bg text-success-foreground' : 'bg-secondary text-muted-foreground'}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
          </div>
        )}

        {drillLevel === 2 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">{drillPath[1]} — no outstanding invoices available yet</p>
            {([] as { number: string; date: string; due: string; amount: number; daysOverdue: number }[]).map((bill) => (
              <div
                key={`bill-drill-${bill.number}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(bill.number)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">{bill.number}</span>
                    <span className="text-sm font-semibold tabular-nums text-danger">{fx(`Rp ${(bill.amount / 1000000).toFixed(0)}M`)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">Due: {bill.due}</span>
                    <span className="text-xs font-semibold text-danger">{bill.daysOverdue}d overdue</span>
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
            <div className="mt-3 p-3 bg-ai-purple-bg border border-purple-200 rounded-lg">
              <p className="text-xs text-ai-purple-foreground leading-relaxed">
                <strong>AI Insight:</strong> {fx('No insight available yet — connect vendor bill data to generate an analysis.')}
              </p>
              <button
                onClick={() => toast.info('Navigating to AP...')}
                className="text-xs text-ai-purple font-semibold mt-1.5 hover:underline"
              >
                View in Accounts Payable →
              </button>
            </div>
          </div>
        )}

        {drillLevel >= 3 && (
          <div className="p-4 bg-secondary rounded-lg">
            <p className="text-sm font-semibold text-foreground mb-2">{drillPath[drillPath.length - 1]}</p>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Journal Entry', value: '—' },
                { label: 'GL Account', value: '—' },
                { label: 'Cost Center', value: '—' },
                { label: 'Approved By', value: '—' },
                { label: 'Posted Date', value: '—' },
              ].map((row) => (
                <div key={`je-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium text-foreground">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recommendations */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {recommendations.length === 0 && (
            <p className="text-xs text-muted-foreground">No recommendations available yet — they will appear once transaction data is connected.</p>
          )}
          {recommendations.map((rec) => (
            <div key={`rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${
                rec.priority === 'High' ? 'bg-danger-bg text-danger-foreground' :
                rec.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                'bg-secondary text-muted-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec.desc)}</p>
              </div>
              <button
                onClick={() => router.push(rec.route)}
                className="text-xs text-primary hover:underline font-medium flex-shrink-0 whitespace-nowrap"
              >
                {rec.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}