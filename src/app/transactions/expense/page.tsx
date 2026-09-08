'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction, PAYMENT_STATUS_VARIANT } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS } from '../lib/groupAnalytics';
import { expenseOutstanding, expenseBillStatus } from '../lib/apBridge';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import { ArrowUpRight } from 'lucide-react';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales / Financial
// Overview / Balance Sheet): width YAxis (65) + margin.left AreaChart (10). ──
const EXPENSE_AXIS_WIDTH = 65;
const EXPENSE_AXIS_OVERLAY_WIDTH = EXPENSE_AXIS_WIDTH + 10;
const EXPENSE_SPRING_MS = 380;
const expenseEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface ExpenseDragPreview {
  index: number;
  value: number;
}

function ExpenseTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: ExpenseDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-orange-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Sama seperti Sales — turunan langsung dari transaksi kelompok
// 'expense' (akun Beban, kategori Payroll/Software/Rent/Marketing/Travel/
// Utilities) di halaman Transaksi, lewat getByGroup('expense').
export default function ExpensePage() {
  const { getByGroup } = useTransactions();
  const expenseTx = useMemo(() => getByGroup('expense'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const totalExpense = expenseTx.reduce((s, t) => s + txAmount(t), 0);
  const txCount = expenseTx.length;
  const avgTxValue = txCount > 0 ? totalExpense / txCount : 0;
  const unpostedCount = expenseTx.filter(t => t.status === 'Unposted').length;
  const recurringLike = expenseTx.filter(t => ['Payroll', 'Rent', 'Software', 'Utilities'].includes(t.category)).length;

  // [BARU] Nilai yang belum dibayar ke vendor di antara transaksi Expense —
  // inilah angka yang "mengalir" ke halaman Account Payable (lihat apBridge.ts).
  const outstandingToAP = useMemo(() => expenseTx.reduce((s, t) => s + expenseOutstanding(t), 0), [expenseTx]);
  const overdueToAPCount = useMemo(
    () => expenseTx.filter((t) => expenseOutstanding(t) > 0 && expenseBillStatus(t) === 'Overdue').length,
    [expenseTx]
  );

  const trend = useMemo(() => monthlyTrendFor(expenseTx), [expenseTx]);
  const byCategory = useMemo(() => categoryBreakdown(expenseTx).slice(0, 6), [expenseTx]);
  const topVendors = useMemo(() => topParties(expenseTx, 5), [expenseTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Financial Overview / Balance Sheet. ──
  const expenseBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [expensePriceZoom, setExpensePriceZoom] = useState(1);
  const expenseZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: expenseYTicks } = useMemo(
    () => getNiceTicksFromZero(expenseBaseMax / expensePriceZoom, 5),
    [expenseBaseMax, expensePriceZoom]
  );
  const expenseYDomain = useMemo<[number, number]>(
    () => [0, expenseBaseMax / expensePriceZoom],
    [expenseBaseMax, expensePriceZoom]
  );
  const expenseYDomainRef = useRef(expenseYDomain);
  expenseYDomainRef.current = expenseYDomain;

  const handleExpenseAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    expenseZoomDragRef.current = { startY: e.clientY, startZoom: expensePriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!expenseZoomDragRef.current) return;
      const deltaY = expenseZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, expenseZoomDragRef.current.startZoom * factor));
      setExpensePriceZoom(next);
    };
    const onUp = () => {
      expenseZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetExpenseZoom = () => setExpensePriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const expenseDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [expenseDragPreview, setExpenseDragPreview] = useState<ExpenseDragPreview | null>(null);
  const expenseDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const expenseAnimRef = useRef<number | null>(null);

  const stopExpenseSpring = () => {
    if (expenseAnimRef.current) cancelAnimationFrame(expenseAnimRef.current);
    expenseAnimRef.current = null;
  };

  useEffect(() => {
    stopExpenseSpring();
    expenseDragStateRef.current = null;
    setExpenseDragPreview(null);
    expenseDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopExpenseSpring, []);

  const springBackExpense = useCallback(() => {
    const drag = expenseDragStateRef.current;
    if (!drag) return;
    stopExpenseSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / EXPENSE_SPRING_MS);
      const eased = expenseEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (expenseDragStateRef.current) expenseDragStateRef.current.currentValue = next;
      setExpenseDragPreview({ index, value: next });
      if (elapsed < 1) {
        expenseAnimRef.current = requestAnimationFrame(step);
      } else {
        expenseDragStateRef.current = null;
        expenseAnimRef.current = null;
        setExpenseDragPreview(null);
      }
    };
    expenseAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleExpenseDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopExpenseSpring();

    const samples = expenseDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = expenseYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    expenseDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setExpenseDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = expenseDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = expenseYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setExpenseDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (expenseDragStateRef.current) springBackExpense();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackExpense]);

  const expenseDisplayTrend = useMemo(() => {
    if (!expenseDragPreview) return trend;
    return trend.map((d, i) => (i === expenseDragPreview.index ? { ...d, total: expenseDragPreview.value } : d));
  }, [trend, expenseDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderExpenseCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    expenseDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`expense-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderExpenseActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = expenseDragPreview?.index === index;
    return (
      <g key={`expense-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#f97316" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleExpenseDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Vendor / Pihak', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-warning">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-orange-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
    // [BARU] Kolom penghubung ke Account Payable — status ini yang menentukan
    // apakah baris ini muncul sebagai tagihan terbuka di halaman AP atau tidak.
    {
      key: 'paymentStatus',
      label: 'Status Pembayaran (AP)',
      render: (r: Transaction) => {
        const ps = r.paymentStatus || 'Belum Dibayar';
        return (
          <div className="flex flex-col gap-0.5">
            <StatusBadge variant={PAYMENT_STATUS_VARIANT[ps]} label={ps} dot />
            {r.dueDate && ps !== 'Lunas' && (
              <span className="text-2xs text-muted-foreground">Jatuh tempo {formatDate(r.dueDate)}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Expense</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaksi beban operasional — diambil otomatis dari halaman Transaksi</p>
      </div>

      {/* [BARU] Banner penghubung ke Account Payable — setiap transaksi
          Expense yang Status Pembayarannya belum "Lunas" otomatis muncul
          sebagai tagihan (bill) di halaman Account Payable. */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ArrowUpRight size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {formatIDR(outstandingToAP, true)} belum dibayar ke vendor
              {overdueToAPCount > 0 && <span className="text-danger"> — {overdueToAPCount} sudah jatuh tempo</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Otomatis tersinkron ke halaman Account Payable berdasarkan kolom "Status Pembayaran (AP)" di tabel bawah.
            </p>
          </div>
        </div>
        <Link
          href="/accounts-payable"
          className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-card border border-primary/30 hover:bg-primary/10 rounded-md px-3 py-2 transition-colors flex-shrink-0"
        >
          Lihat di Account Payable
          <ArrowUpRight size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Expense" value={totalExpense} icon="CreditCardIcon" iconColor="text-orange-600" iconBg="bg-orange-50" />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Belum Diposting" value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title="Beban Rutin" value={String(recurringLike)} icon="ArrowPathIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Expense Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Expense untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={expenseDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradExpenseMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={EXPENSE_AXIS_WIDTH}
                    ticks={expenseYTicks}
                    domain={expenseYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<ExpenseTrendTooltip dragPreview={expenseDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Expense"
                    stroke="#f97316"
                    strokeWidth={2.5}
                    fill="url(#gradExpenseMain)"
                    dot={renderExpenseCalibrationDot as any}
                    activeDot={renderExpenseActiveDot as any}
                    isAnimationActive={!expenseDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleExpenseAxisMouseDown}
                onDoubleClick={resetExpenseZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: EXPENSE_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Expense per Kategori</h2>
          <p className="text-xs text-muted-foreground mb-3">Breakdown beban</p>
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
        <h2 className="text-sm font-bold text-foreground mb-1">Top Vendor / Pihak</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan kontribusi nominal beban</p>
        {topVendors.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topVendors.map((c, i) => {
              const max = topVendors[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-orange-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Expense — digabung jadi 1 kolom,
          aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="expense"
        groupLabel="Expense"
        defaultCategory="Software"
        columns={columns}
        onRowClick={setSelectedTx}
        // [BARU] Tombol Import di halaman Expense sekarang MENGGANTI (bukan
        // menambah) seluruh transaksi Expense dengan hasil upload PDF
        // "Data Penjualan Detail" (kasir/POS) — kelompok transaksi lain
        // (Sales, Cash Payment, dll) tidak ikut terhapus. Excel/rekening
        // koran belum didukung di mode ini, hanya PDF.
        importMode="replace-group"
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}