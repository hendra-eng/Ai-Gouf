'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

const waterfallData = [
  { name: 'Revenue', value: 8420000000, type: 'positive' },
  { name: 'COGS', value: -4700000000, type: 'negative' },
  { name: 'Gross Profit', value: 3720000000, type: 'subtotal' },
  { name: 'Opex', value: -1390000000, type: 'negative' },
  { name: 'EBITDA', value: 2330000000, type: 'subtotal' },
  { name: 'D&A', value: -180000000, type: 'negative' },
  { name: 'EBIT', value: 2150000000, type: 'subtotal' },
  { name: 'Tax', value: -310000000, type: 'negative' },
  { name: 'Net Profit', value: 1840000000, type: 'result' },
];

const monthlyProfit = [
  { month: 'Jan', revenue: 950, cogs: 545, grossProfit: 405, opex: 165, netProfit: 190 },
  { month: 'Feb', revenue: 1020, cogs: 580, grossProfit: 440, opex: 170, netProfit: 230 },
  { month: 'Mar', revenue: 1080, cogs: 610, grossProfit: 470, opex: 175, netProfit: 260 },
  { month: 'Apr', revenue: 1050, cogs: 620, grossProfit: 430, opex: 182, netProfit: 210 },
  { month: 'May', revenue: 1120, cogs: 645, grossProfit: 475, opex: 185, netProfit: 250 },
  { month: 'Jun', revenue: 1090, cogs: 640, grossProfit: 450, opex: 188, netProfit: 230 },
  { month: 'Jul', revenue: 1150, cogs: 665, grossProfit: 485, opex: 190, netProfit: 260 },
  { month: 'Aug', revenue: 1160, cogs: 680, grossProfit: 480, opex: 195, netProfit: 240 },
];

type PlKey = 'revenue' | 'cogs' | 'grossProfit' | 'opex' | 'netProfit';

// Spring-back setelah drag titik dilepas — pola & durasi sama persis dengan
// chart lain (Financial Overview, Total Assets/Liabilities/Equity Trend, dst).
const PL_SPRING_DURATION_MS = 420;
const plEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

const drivers = [
  { category: 'Revenue Growth', impact: +285000000, type: 'positive', description: 'New contracts from PT Global Teknindo and CV Berkah Mandiri' },
  { category: 'COGS Increase', impact: -195000000, type: 'negative', description: 'Raw material costs +8.4%, partially offset by volume efficiency' },
  { category: 'Opex Increase', impact: -142000000, type: 'negative', description: 'IT infrastructure +Rp 96M, marketing +Rp 46M' },
  { category: 'Collection Improvement', impact: +68000000, type: 'positive', description: 'AR collection rate improved in Feb–Mar' },
  { category: 'Tax Adjustment', impact: -28000000, type: 'negative', description: 'Prior year tax provision adjustment' },
];

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
  const renderPlCalibrationDot = (key: PlKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    plDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot yang terlihat & bisa digenggam di bulan yang sedang di-hover — tarik
  // vertikal untuk preview, lepas untuk spring-back ke nilai asli.
  const renderPlActiveDot = (key: PlKey, color: string) => (props: any) => {
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
          Net profit for Jan–Aug 2026 is <strong>{fx('Rp 1.84M')}</strong>, representing a margin of <strong>21.8%</strong> on revenue of {fx('Rp 8.42M')}.
          While revenue grew +12.8% vs the same period last year, net profit growth was constrained to +8.4% due to two primary pressures:
          operating expenses increased +7.1% driven by IT infrastructure investment, and COGS rose +8.4% due to raw material cost inflation.
          The margin compression is <strong>partially structural</strong> and partially cyclical — Q3 should see normalization as the IT project completes.
        </p>
      </div>

      {/* Key Findings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: 'ArrowTrendingUpIcon', color: 'text-success', bg: 'bg-success-bg', label: 'Revenue Growth', value: '+12.8%', desc: 'vs Jan–Aug 2025' },
          { icon: 'ArrowTrendingDownIcon', color: 'text-danger', bg: 'bg-danger-bg', label: 'Margin Compression', value: '-1.2pp', desc: 'Gross margin vs prior year' },
          { icon: 'ExclamationTriangleIcon', color: 'text-warning', bg: 'bg-warning-bg', label: 'Opex Growth', value: '+7.1%', desc: 'Above revenue growth rate' },
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
            <p className="text-xs text-muted-foreground mb-3">{fx('Total Opex: Rp 1.39M — click to investigate each category')}</p>
            {[
              { name: 'IT Infrastructure', amount: 385000000, change: '+28.4%', pct: 27.7, color: 'bg-danger' },
              { name: 'Salaries & Benefits', amount: 420000000, change: '+5.2%', pct: 30.2, color: 'bg-primary' },
              { name: 'Marketing', amount: 198000000, change: '+12.8%', pct: 14.2, color: 'bg-warning' },
              { name: 'Rent & Utilities', amount: 145000000, change: '+2.1%', pct: 10.4, color: 'bg-info' },
              { name: 'Other Opex', amount: 242000000, change: '+4.5%', pct: 17.5, color: 'bg-muted-foreground' },
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
            <p className="text-xs text-muted-foreground mb-3">{fx('IT Infrastructure: Rp 385M — drilling into vendor breakdown')}</p>
            {[
              { vendor: 'PT Infratech Solusi', amount: 185000000, category: 'Server & Network', invoices: 2, status: 'Overdue' },
              { vendor: 'PT Daya Cipta Digital', amount: 68000000, category: 'Software Licenses', invoices: 1, status: 'Due Soon' },
              { vendor: 'PT Cloud Asia', amount: 82000000, category: 'Cloud Services', invoices: 3, status: 'Paid' },
              { vendor: 'CV Tech Support', amount: 50000000, category: 'Maintenance', invoices: 2, status: 'Open' },
            ].map((item) => (
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

        {drillLevel === 2 && drillPath[1] === 'PT Infratech Solusi' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">PT Infratech Solusi — outstanding invoices</p>
            {[
              { number: 'BILL-2026-0142', date: '2026-05-20', due: '2026-06-20', amount: 96000000, daysOverdue: 69 },
              { number: 'BILL-2026-0158', date: '2026-07-15', due: '2026-08-15', amount: 89000000, daysOverdue: 13 },
            ].map((bill) => (
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
                <strong>AI Insight:</strong> {fx('PT Infratech Solusi has Rp 185M overdue across 2 bills. This is the primary driver of IT infrastructure cost overrun. Immediate payment action required. Consider negotiating extended terms given the relationship size.')}
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
                { label: 'Journal Entry', value: 'JE-2026-4821' },
                { label: 'GL Account', value: '5200 — IT Expenses' },
                { label: 'Cost Center', value: 'CC-IT-001' },
                { label: 'Approved By', value: 'Rizky Wardana' },
                { label: 'Posted Date', value: '2026-06-20' },
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
          {[
            { priority: 'High', title: 'Resolve IT Infrastructure Overrun', desc: 'Pay overdue bills to PT Infratech Solusi (Rp 185M) and renegotiate contract terms to prevent recurrence.', action: 'View AP', route: '/accounts-payable' },
            { priority: 'Medium', title: 'Accelerate AR Collections', desc: 'PT Mitra Solusi Digital owes Rp 320M overdue. Escalate to senior management and consider credit limit suspension.', action: 'View AR', route: '/accounts-receivable' },
            { priority: 'Low', title: 'Review Marketing Spend ROI', desc: 'Marketing expenses grew +12.8% but revenue attribution is unclear. Request performance analysis from marketing team.', action: 'View Transactions', route: '/transactions' },
          ].map((rec) => (
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