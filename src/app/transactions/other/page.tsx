'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales/Expense/dst). ──
const OTHER_AXIS_WIDTH = 65;
const OTHER_AXIS_OVERLAY_WIDTH = OTHER_AXIS_WIDTH + 10;
const OTHER_SPRING_MS = 380;
const otherEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface OtherDragPreview {
  index: number;
  value: number;
}

function OtherTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: OtherDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-slate-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'other' = sisanya yang tidak masuk 4 kelompok lain
// (mis. CapEx / aset tetap, atau kategori baru yang belum dipetakan) —
// lihat CATEGORY_TO_GROUP & classifyByAccountName() di transactionData.ts.
export default function OtherTransactionsPage() {
  const { getByGroup } = useTransactions();
  const otherTx = useMemo(() => getByGroup('other'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const totalOther = otherTx.reduce((s, t) => s + txAmount(t), 0);
  const txCount = otherTx.length;
  const avgTxValue = txCount > 0 ? totalOther / txCount : 0;
  const unpostedCount = otherTx.filter(t => t.status === 'Unposted').length;
  const needsReview = otherTx.filter(t => !!t.notes).length;

  const trend = useMemo(() => monthlyTrendFor(otherTx), [otherTx]);
  const byCategory = useMemo(() => categoryBreakdown(otherTx).slice(0, 6), [otherTx]);
  const topParties5 = useMemo(() => topParties(otherTx, 5), [otherTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Expense / Cash Payment / Cash Reserve / Financial Overview. ──
  const otherBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [otherPriceZoom, setOtherPriceZoom] = useState(1);
  const otherZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: otherYTicks } = useMemo(
    () => getNiceTicksFromZero(otherBaseMax / otherPriceZoom, 5),
    [otherBaseMax, otherPriceZoom]
  );
  const otherYDomain = useMemo<[number, number]>(
    () => [0, otherBaseMax / otherPriceZoom],
    [otherBaseMax, otherPriceZoom]
  );
  const otherYDomainRef = useRef(otherYDomain);
  otherYDomainRef.current = otherYDomain;

  const handleOtherAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    otherZoomDragRef.current = { startY: e.clientY, startZoom: otherPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!otherZoomDragRef.current) return;
      const deltaY = otherZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, otherZoomDragRef.current.startZoom * factor));
      setOtherPriceZoom(next);
    };
    const onUp = () => {
      otherZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetOtherZoom = () => setOtherPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const otherDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [otherDragPreview, setOtherDragPreview] = useState<OtherDragPreview | null>(null);
  const otherDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const otherAnimRef = useRef<number | null>(null);

  const stopOtherSpring = () => {
    if (otherAnimRef.current) cancelAnimationFrame(otherAnimRef.current);
    otherAnimRef.current = null;
  };

  useEffect(() => {
    stopOtherSpring();
    otherDragStateRef.current = null;
    setOtherDragPreview(null);
    otherDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopOtherSpring, []);

  const springBackOther = useCallback(() => {
    const drag = otherDragStateRef.current;
    if (!drag) return;
    stopOtherSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / OTHER_SPRING_MS);
      const eased = otherEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (otherDragStateRef.current) otherDragStateRef.current.currentValue = next;
      setOtherDragPreview({ index, value: next });
      if (elapsed < 1) {
        otherAnimRef.current = requestAnimationFrame(step);
      } else {
        otherDragStateRef.current = null;
        otherAnimRef.current = null;
        setOtherDragPreview(null);
      }
    };
    otherAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleOtherDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopOtherSpring();

    const samples = otherDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = otherYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    otherDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setOtherDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = otherDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = otherYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setOtherDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (otherDragStateRef.current) springBackOther();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackOther]);

  const otherDisplayTrend = useMemo(() => {
    if (!otherDragPreview) return trend;
    return trend.map((d, i) => (i === otherDragPreview.index ? { ...d, total: otherDragPreview.value } : d));
  }, [trend, otherDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderOtherCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    otherDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`other-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderOtherActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = otherDragPreview?.index === index;
    return (
      <g key={`other-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#64748b" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleOtherDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Pihak', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Other</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaksi lain-lain (CapEx & belum terkategori) — diambil otomatis dari halaman Transaksi</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Other" value={totalOther} icon="Squares2X2Icon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Belum Diposting" value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title="Perlu Ditinjau" value={String(needsReview)} icon="ExclamationTriangleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" alert={needsReview > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Other Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Other untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={otherDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradOtherMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={OTHER_AXIS_WIDTH}
                    ticks={otherYTicks}
                    domain={otherYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<OtherTrendTooltip dragPreview={otherDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Other"
                    stroke="#64748b"
                    strokeWidth={2.5}
                    fill="url(#gradOtherMain)"
                    dot={renderOtherCalibrationDot as any}
                    activeDot={renderOtherActiveDot as any}
                    isAnimationActive={!otherDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleOtherAxisMouseDown}
                onDoubleClick={resetOtherZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: OTHER_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Other per Kategori</h2>
          <p className="text-xs text-muted-foreground mb-3">Breakdown transaksi lain-lain</p>
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((cat, i) => {
                const total = byCategory.reduce((s, c) => s + c.value, 0);
                const pct = total > 0 ? (cat.value / total) * 100 : 0;
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground truncate flex-1">{cat.name}</span>
                      <span className="text-xs font-semibold font-mono ml-2">{formatIDR(cat.value, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-foreground mb-1">Top Pihak Terkait</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan kontribusi nominal</p>
        {topParties5.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topParties5.map((c, i) => {
              const max = topParties5[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-slate-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-slate-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Other — digabung jadi 1 kolom,
          aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="other"
        groupLabel="Other"
        defaultCategory="CapEx"
        columns={columns}
        onRowClick={setSelectedTx}
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}