'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, uniqueJournalCount, monthlyTrendFor, categoryBreakdown, CHART_COLORS } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales/Expense/Cash Payment). ──
const RESERVE_AXIS_WIDTH = 65;
const RESERVE_AXIS_OVERLAY_WIDTH = RESERVE_AXIS_WIDTH + 10;
const RESERVE_SPRING_MS = 380;
const reserveEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface ReserveDragPreview {
  index: number;
  value: number;
}

function ReserveTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: ReserveDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-blue-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'cash_reserve' = pergerakan kas/bank & pendanaan (akun Kas
// & Bank, Deposito, kategori 'Financing') — lihat getTransactionGroup().
export default function CashReservePage() {
  const { getByGroup } = useTransactions();
  const reserveTx = useMemo(() => getByGroup('cash_reserve'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // [TIDAK DIUBAH] inflow/outflow/netMovement sengaja TETAP dijumlah per
  // BARIS (bukan per jeId seperti Sales/Expense/Cash Payment). Beda dengan
  // "Total Sales/Expense" yang rawan dobel karena 1 nilai ekonomi dicatat di
  // 2 kaki jurnal (Kas & Pendapatan/Beban), di sini SETIAP baris kas/bank
  // ADALAH satu pergerakan fisik kas yang nyata sendiri-sendiri (mis. transfer
  // antar-bank = 1 jeId tapi 2 baris Kas & Bank yang berbeda: satu keluar dari
  // Bank A, satu masuk ke Bank B — keduanya harus tetap terhitung terpisah,
  // kalau di-dedup per jeId salah satu pergerakannya akan hilang).
  const inflow = reserveTx.reduce((s, t) => s + t.debit, 0); // masuk ke Kas & Bank
  const outflow = reserveTx.reduce((s, t) => s + t.credit, 0); // keluar dari Kas & Bank
  const netMovement = inflow - outflow;
  // [DIUBAH] "Jumlah Transaksi" beda konsep dari inflow/outflow di atas — ini
  // menghitung jumlah TRANSAKSI (jeId unik), konsisten dengan kartu yang sama
  // di Sales/Expense/Cash Payment/Other, supaya 1 transfer antar-bank (1
  // jeId, 2 baris) dihitung sebagai 1 transaksi, bukan 2.
  const txCount = uniqueJournalCount(reserveTx);
  const latestBalance = useMemo(() => {
    const sorted = [...reserveTx].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted[0]?.saldoAkhir ?? 0;
  }, [reserveTx]);

  const trend = useMemo(() => monthlyTrendFor(reserveTx), [reserveTx]);
  const byCategory = useMemo(() => categoryBreakdown(reserveTx).slice(0, 6), [reserveTx]);
  const byAccount = useMemo(() => {
    const byAcc = new Map<string, number>();
    reserveTx.forEach(tx => byAcc.set(tx.accountName, (byAcc.get(tx.accountName) || 0) + txAmount(tx)));
    return Array.from(byAcc.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [reserveTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Expense / Cash Payment / Financial Overview. ──
  const reserveBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [reservePriceZoom, setReservePriceZoom] = useState(1);
  const reserveZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: reserveYTicks } = useMemo(
    () => getNiceTicksFromZero(reserveBaseMax / reservePriceZoom, 5),
    [reserveBaseMax, reservePriceZoom]
  );
  const reserveYDomain = useMemo<[number, number]>(
    () => [0, reserveBaseMax / reservePriceZoom],
    [reserveBaseMax, reservePriceZoom]
  );
  const reserveYDomainRef = useRef(reserveYDomain);
  reserveYDomainRef.current = reserveYDomain;

  const handleReserveAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    reserveZoomDragRef.current = { startY: e.clientY, startZoom: reservePriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!reserveZoomDragRef.current) return;
      const deltaY = reserveZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, reserveZoomDragRef.current.startZoom * factor));
      setReservePriceZoom(next);
    };
    const onUp = () => {
      reserveZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetReserveZoom = () => setReservePriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const reserveDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [reserveDragPreview, setReserveDragPreview] = useState<ReserveDragPreview | null>(null);
  const reserveDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const reserveAnimRef = useRef<number | null>(null);

  const stopReserveSpring = () => {
    if (reserveAnimRef.current) cancelAnimationFrame(reserveAnimRef.current);
    reserveAnimRef.current = null;
  };

  useEffect(() => {
    stopReserveSpring();
    reserveDragStateRef.current = null;
    setReserveDragPreview(null);
    reserveDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopReserveSpring, []);

  const springBackReserve = useCallback(() => {
    const drag = reserveDragStateRef.current;
    if (!drag) return;
    stopReserveSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / RESERVE_SPRING_MS);
      const eased = reserveEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (reserveDragStateRef.current) reserveDragStateRef.current.currentValue = next;
      setReserveDragPreview({ index, value: next });
      if (elapsed < 1) {
        reserveAnimRef.current = requestAnimationFrame(step);
      } else {
        reserveDragStateRef.current = null;
        reserveAnimRef.current = null;
        setReserveDragPreview(null);
      }
    };
    reserveAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleReserveDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopReserveSpring();

    const samples = reserveDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = reserveYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    reserveDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setReserveDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = reserveDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = reserveYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setReserveDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (reserveDragStateRef.current) springBackReserve();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackReserve]);

  const reserveDisplayTrend = useMemo(() => {
    if (!reserveDragPreview) return trend;
    return trend.map((d, i) => (i === reserveDragPreview.index ? { ...d, total: reserveDragPreview.value } : d));
  }, [trend, reserveDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderReserveCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    reserveDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`reserve-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderReserveActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = reserveDragPreview?.index === index;
    return (
      <g key={`reserve-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleReserveDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'accountName', label: 'Akun Kas/Bank', render: (r: Transaction) => <span className="font-medium text-xs">{r.accountName}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-info">{r.category}</span> },
    { key: 'debit', label: 'Masuk', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-emerald-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Keluar', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-rose-700">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'saldoAkhir', label: 'Saldo Akhir', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatIDR(r.saldoAkhir, true)}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Cash Reserve</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pergerakan kas, bank & pendanaan — diambil otomatis dari halaman Transaksi</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Saldo Terakhir" value={latestBalance} icon="BanknotesIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Kas Masuk" value={inflow} icon="ArrowDownCircleIcon" iconColor="text-teal-600" iconBg="bg-teal-50" />
        <KpiCard title="Kas Keluar" value={outflow} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" />
        <KpiCard title="Pergerakan Bersih" value={netMovement} icon="ScaleIcon" iconColor={netMovement >= 0 ? 'text-emerald-600' : 'text-rose-600'} iconBg={netMovement >= 0 ? 'bg-emerald-50' : 'bg-rose-50'} />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Cash Reserve Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Cash Reserve untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={reserveDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradReserveMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={RESERVE_AXIS_WIDTH}
                    ticks={reserveYTicks}
                    domain={reserveYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<ReserveTrendTooltip dragPreview={reserveDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Cash Reserve"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fill="url(#gradReserveMain)"
                    dot={renderReserveCalibrationDot as any}
                    activeDot={renderReserveActiveDot as any}
                    isAnimationActive={!reserveDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleReserveAxisMouseDown}
                onDoubleClick={resetReserveZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: RESERVE_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Berdasarkan Akun</h2>
          <p className="text-xs text-muted-foreground mb-3">Kontribusi per akun Kas/Bank</p>
          {byAccount.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {byAccount.map((acc, i) => {
                const total = byAccount.reduce((s, c) => s + c.amount, 0);
                const pct = total > 0 ? (acc.amount / total) * 100 : 0;
                return (
                  <div key={acc.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground truncate flex-1">{acc.name}</span>
                      <span className="text-xs font-semibold font-mono ml-2">{formatIDR(acc.amount, true)}</span>
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

      {/* Aksi & Upload Data + Tabel Transaksi Cash Reserve — digabung jadi 1
          kolom, aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="cash_reserve"
        groupLabel="Cash Reserve"
        defaultCategory="Financing"
        columns={columns}
        onRowClick={setSelectedTx}
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}