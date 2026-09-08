'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCurrency, formatMoney } from '@/lib/currency';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import type { DebtMetrics, LiabilityObligation, MaturityBucket } from '../lib/liabilitiesBridge';

// Spring-back setelah drag bar dilepas — pola & durasi sama persis dengan
// PLWaterfallChart.tsx / Financial Overview, biar terasa konsisten se-app.
const DEBT_SPRING_DURATION_MS = 420;
const debtEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_MATURITY: MaturityBucket[] = [
  { bucket: '\u226430 days', amount: 182, color: '#dc2626' },
  { bucket: '31\u201390 days', amount: 340, color: '#d97706' },
  { bucket: '3\u20136 months', amount: 280, color: '#f59e0b' },
  { bucket: '6\u201312 months', amount: 458, color: '#2563eb' },
  { bucket: '1\u20133 years', amount: 520, color: '#7c3aed' },
  { bucket: '3+ years', amount: 360, color: '#16a34a' },
];

const SAMPLE_METRICS: DebtMetrics = {
  totalDebt: 860_000_000,
  shortTermDebt: 240_000_000,
  longTermDebt: 620_000_000,
  shortTermPct: 27.9,
  longTermPct: 72.1,
  debtToEquity: 0.18,
  interestExpenseYtd: 48_200_000,
  interestCoverage: 12.7,
};

interface DebtAnalysisSectionProps {
  isSampleData: boolean;
  companyName: string | null;
  metrics: DebtMetrics;
  maturityBuckets: MaturityBucket[];
  nearestObligation: LiabilityObligation | null;
}

export default function DebtAnalysisSection({ isSampleData, companyName, metrics, maturityBuckets, nearestObligation }: DebtAnalysisSectionProps) {
  const { fx } = useCurrency();
  const rp = (v: number) => fx(formatMoney(v, 'IDR'));

  const maturityData = isSampleData ? SAMPLE_MATURITY : maturityBuckets;
  const m = isSampleData ? SAMPLE_METRICS : metrics;
  const hasAnyDebt = maturityData.some((b) => b.amount > 0);

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — pola sama persis dengan
  // Financial Overview (OverviewCharts.tsx) & P&L Waterfall. Tarik naik/turun
  // di area label sumbu Y buat zoom in/out skala, double-click buat reset. ──
  const maturityBaseMax = useMemo(
    () => Math.max(0, ...maturityData.map((d) => d.amount)) * 1.15 || 1,
    [maturityData]
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: yTicks } = useMemo(
    () => getNiceTicksFromZero(maturityBaseMax / priceZoom, 5),
    [maturityBaseMax, priceZoom]
  );
  const yDomain = useMemo<[number, number]>(
    () => [0, maturityBaseMax / priceZoom],
    [maturityBaseMax, priceZoom]
  );

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
  // pola sama persis dengan renderWaterfallBar di profit-loss/page.tsx. Beda
  // dengan waterfall, bar di sini tidak stacked & selalu positif (anchor di
  // bawah/nol), jadi arahnya satu: tarik ATAS = nilai makin besar. ──
  const [barDrag, setBarDrag] = useState<{ index: number; liveValue: number } | null>(null);
  const barDragRef = useRef<{
    index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
  } | null>(null);
  const barAnimRef = useRef<number | null>(null);
  // true kalau pointer sudah bergerak (dianggap "drag") — dipakai supaya
  // klik biasa (tanpa gerak) tidak ikut kepicu sebagai drag.
  const barJustDraggedRef = useRef(false);

  const stopBarSpring = () => {
    if (barAnimRef.current) cancelAnimationFrame(barAnimRef.current);
    barAnimRef.current = null;
  };

  const barSpringBack = useCallback(() => {
    const drag = barDragRef.current;
    if (!drag) return;
    stopBarSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / DEBT_SPRING_DURATION_MS);
      const eased = debtEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (barDragRef.current) barDragRef.current.liveValue = next;
      setBarDrag({ index, liveValue: next });
      if (elapsed < 1) {
        barAnimRef.current = requestAnimationFrame(step);
      } else {
        barDragRef.current = null;
        barAnimRef.current = null;
        setBarDrag(null);
      }
    };
    barAnimRef.current = requestAnimationFrame(step);
  }, []);

  // Data yang benar-benar dikirim ke chart: sama seperti maturityData,
  // kecuali satu bar yang sedang ditarik/spring-back diganti nilai live-nya.
  // Data asli (maturityData / props) TIDAK pernah dimutasi — ini cuma
  // override tampilan sementara, sama seperti waterfallDisplayBars.
  const maturityDisplayData = useMemo(() => {
    if (!barDrag) return maturityData;
    return maturityData.map((d, i) => (i === barDrag.index ? { ...d, amount: barDrag.liveValue } : d));
  }, [maturityData, barDrag]);

  // Reset drag & zoom kalau data berubah (mis. ganti client aktif) — index
  // bar & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopBarSpring();
    barDragRef.current = null;
    setBarDrag(null);
    setPriceZoom(1);
  }, [maturityData]);

  const handleBarPointerDown = (index: number, startValue: number, barHeight: number) => (
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    stopBarSpring();
    barJustDraggedRef.current = false;
    let pxPerUnit = startValue !== 0 ? -barHeight / startValue : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    barDragRef.current = { index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setBarDrag({ index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = barDragRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      if (Math.abs(deltaY) > 3) barJustDraggedRef.current = true;
      const maxValue = (maturityBaseMax / priceZoom) * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setBarDrag({ index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (barDragRef.current) barSpringBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [barSpringBack, maturityBaseMax, priceZoom]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik (bukan cuma
  // titik), plus overlay transparan di atas bar biar area genggam tetap besar
  // walau bar-nya pendek — persis pola renderWaterfallBar.
  const renderDraggableBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = barDrag?.index === index;
    const dragHandlers = handleBarPointerDown(index, payload.amount, height);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={payload.color}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? payload.color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
        {/* Perluas area genggam ke atas, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={y - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
        />
      </g>
    );
  };

  const debtMetrics = [
    { label: 'Total Debt', value: rp(m.totalDebt), sub: 'Short + Long-term' },
    { label: 'Short-Term Debt', value: rp(m.shortTermDebt), sub: `${m.shortTermPct}% of total debt` },
    { label: 'Long-Term Debt', value: rp(m.longTermDebt), sub: `${m.longTermPct}% of total debt` },
    {
      label: 'Debt-to-Equity',
      value: m.debtToEquity !== null ? `${m.debtToEquity}x` : 'N/A',
      sub: m.debtToEquity !== null ? (m.debtToEquity < 1 ? 'Healthy leverage' : 'Above 1.0x threshold') : 'Equity data unavailable',
    },
    {
      label: 'Interest Coverage',
      value: m.interestCoverage !== null ? `${m.interestCoverage}x` : 'N/A',
      sub: m.interestCoverage !== null ? 'Est. EBIT / Interest Exp.' : 'No interest expense found',
    },
    {
      label: 'Interest Expense',
      value: m.interestExpenseYtd !== null ? rp(m.interestExpenseYtd) : 'N/A',
      sub: m.interestExpenseYtd !== null ? 'YTD, from posted journals' : 'No "Beban Bunga" account found',
    },
  ];

  const deRatioPct = m.debtToEquity !== null ? Math.min(100, Math.round(m.debtToEquity * 100)) : 0;
  const deHealthy = m.debtToEquity !== null && m.debtToEquity < 1;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Debt Maturity Chart */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="mb-4">
          <div className="text-[14px] font-600 text-foreground">Debt Maturity Profile</div>
          <div className="text-[11px] text-muted-foreground">
            Upcoming obligation schedule{companyName ? ` — ${companyName}` : ''}
          </div>
        </div>

        {/* Urgency callout — derived from the nearest real obligation, not hardcoded */}
        {!isSampleData && nearestObligation && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-4 border ${nearestObligation.status === 'overdue' ? 'bg-negative-subtle border-red-200' : 'bg-warning-subtle border-amber-200'}`}>
            <span className={`w-2 h-2 rounded-full inline-block ${nearestObligation.status === 'overdue' ? 'bg-negative' : 'bg-warning'}`} />
            <span className={`text-[12px] font-600 ${nearestObligation.status === 'overdue' ? 'text-negative' : 'text-warning'}`}>
              {nearestObligation.status === 'overdue'
                ? fx(`${formatMoney(nearestObligation.amount, 'IDR')} overdue by ${Math.abs(nearestObligation.daysRemaining)} days`)
                : fx(`${formatMoney(nearestObligation.amount, 'IDR')} due within ${nearestObligation.daysRemaining} days`)}
            </span>
            <span className="text-[11px] text-muted-foreground ml-1 truncate">— {nearestObligation.liability} ({nearestObligation.creditor})</span>
          </div>
        )}
        {isSampleData && (
          <div className="flex items-center gap-2 bg-negative-subtle border border-red-200 rounded-lg px-3 py-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-negative inline-block" />
            <span className="text-[12px] font-600 text-negative">{fx('Rp 182M due within 30 days')}</span>
            <span className="text-[11px] text-muted-foreground ml-1">— Sample: Tax payable</span>
          </div>
        )}

        {!isSampleData && !hasAnyDebt ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-[12px] text-muted-foreground">No outstanding liability obligations found for this client yet.</div>
          </div>
        ) : (
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={maturityDisplayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}M`}
                  width={56}
                  ticks={yTicks}
                  domain={yDomain}
                  allowDataOverflow
                />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [fx(`Rp ${v.toLocaleString('id-ID')}M`), 'Obligations']}
                  cursor={false}
                />
                <Bar
                  dataKey="amount"
                  name="Obligations"
                  shape={renderDraggableBar as any}
                  isAnimationActive={!barDrag}
                />
              </BarChart>
            </ResponsiveContainer>
            {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
            <div
              onMouseDown={handleAxisMouseDown}
              onDoubleClick={resetZoom}
              title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
              className="absolute top-0 left-0 h-full cursor-ns-resize"
              style={{ width: 56 }}
            />
          </div>
        )}
      </div>

      {/* Debt Metrics */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Debt Analysis</div>
        <div className="text-[11px] text-muted-foreground mb-4">Key debt ratios and metrics</div>
        <div className="space-y-3">
          {debtMetrics.map((m2, i) => (
            <div key={`debt-metric-${i}`} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
              <div>
                <div className="text-[12px] font-500 text-foreground">{m2.label}</div>
                <div className="text-[10px] text-muted-foreground">{m2.sub}</div>
              </div>
              <div className="text-[14px] font-700 text-foreground financial-value">{m2.value}</div>
            </div>
          ))}
        </div>

        {/* D/E Ratio visual */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] font-600 text-muted-foreground mb-2">Debt-to-Equity Ratio</div>
          {m.debtToEquity !== null ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className={`h-2 rounded-full ${deHealthy ? 'bg-primary' : 'bg-negative'}`} style={{ width: `${deRatioPct}%` }} />
                </div>
                <span className={`text-[11px] font-600 ${deHealthy ? 'text-positive' : 'text-negative'}`}>
                  {m.debtToEquity}x — {deHealthy ? 'Healthy' : 'Elevated'}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0x</span>
                <span>Threshold: 1.0x</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">Equity balance not available yet — ratio will appear once equity accounts have posted balances.</div>
          )}
        </div>
      </div>
    </div>
  );
}