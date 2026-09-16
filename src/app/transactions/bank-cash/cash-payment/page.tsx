'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../../components/TransactionDrawer';
import TransactionsGroupPanel from '../../components/TransactionsGroupPanel';
import { Transaction } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate, uniqueJournalTotal, uniqueJournalCount, countJournalsByStatus, countJournalsByCategory, draftJournalTotal, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS, transactionsMissingJeId, unbalancedJournals } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import CashBankTabs from '../components/CashBankTabs';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales/Purchase). ──
const PAYMENT_AXIS_WIDTH = 65;
const PAYMENT_AXIS_OVERLAY_WIDTH = PAYMENT_AXIS_WIDTH + 10;
const PAYMENT_SPRING_MS = 380;
const paymentEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface PaymentDragPreview {
  index: number;
  value: number;
}

function PaymentTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: PaymentDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-rose-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'cash_payment' = pembayaran kewajiban tunai/bank (Hutang
// Usaha, Pajak/PPN/PPh) — lihat getTransactionGroup() di transactionData.ts.
export default function CashPaymentPage() {
  const { getByGroup } = useTransactions();
  const paymentTx = useMemo(() => getByGroup('cash_payment'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // [DIUBAH] Sama seperti Sales/Purchase — dikelompokkan per NOMOR JURNAL
  // (jeId) dulu sebelum dijumlah/dihitung, supaya transaksi dengan 2 kaki
  // jurnal (mis. sisi Kas & Bank saat uang keluar, DAN sisi akun
  // Hutang/Pajak saat kewajiban dilunasi — keduanya sama-sama masuk
  // paymentTx) tidak terhitung dua kali. Lihat groupAnalytics.ts untuk detail.
  const totalPayment = uniqueJournalTotal(paymentTx);
  const txCount = uniqueJournalCount(paymentTx);
  const avgTxValue = txCount > 0 ? totalPayment / txCount : 0;
  const unpostedCount = countJournalsByStatus(paymentTx, 'Unposted');
  // [BARU] Sama seperti Sales/Purchase — transaksi 'Draft' sengaja dikeluarkan
  // dari totalPayment/txCount lewat groupByJournalRealized(), nilainya
  // ditampilkan terpisah supaya tidak hilang begitu saja.
  const draftCount = countJournalsByStatus(paymentTx, 'Draft');
  const draftTotal = draftJournalTotal(paymentTx);
  const taxCount = countJournalsByCategory(paymentTx, ['Tax']);
  const apCount = countJournalsByCategory(paymentTx, ['AP Payment']);

  // [BARU] Peringatan integritas data — sama seperti Sales/Purchase. Lihat
  // transactionsMissingJeId() di groupAnalytics.ts.
  const missingJeIdCount = useMemo(() => transactionsMissingJeId(paymentTx).length, [paymentTx]);
  const unbalanced = useMemo(() => unbalancedJournals(paymentTx), [paymentTx]);

  const trend = useMemo(() => monthlyTrendFor(paymentTx), [paymentTx]);
  const byCategory = useMemo(() => categoryBreakdown(paymentTx).slice(0, 6), [paymentTx]);
  const topPayees = useMemo(() => topParties(paymentTx, 5), [paymentTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Purchase / Financial Overview. ──
  const paymentBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [paymentPriceZoom, setPaymentPriceZoom] = useState(1);
  const paymentZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: paymentYTicks } = useMemo(
    () => getNiceTicksFromZero(paymentBaseMax / paymentPriceZoom, 5),
    [paymentBaseMax, paymentPriceZoom]
  );
  const paymentYDomain = useMemo<[number, number]>(
    () => [0, paymentBaseMax / paymentPriceZoom],
    [paymentBaseMax, paymentPriceZoom]
  );
  const paymentYDomainRef = useRef(paymentYDomain);
  paymentYDomainRef.current = paymentYDomain;

  const handlePaymentAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    paymentZoomDragRef.current = { startY: e.clientY, startZoom: paymentPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!paymentZoomDragRef.current) return;
      const deltaY = paymentZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, paymentZoomDragRef.current.startZoom * factor));
      setPaymentPriceZoom(next);
    };
    const onUp = () => {
      paymentZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetPaymentZoom = () => setPaymentPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const paymentDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [paymentDragPreview, setPaymentDragPreview] = useState<PaymentDragPreview | null>(null);
  const paymentDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const paymentAnimRef = useRef<number | null>(null);

  const stopPaymentSpring = () => {
    if (paymentAnimRef.current) cancelAnimationFrame(paymentAnimRef.current);
    paymentAnimRef.current = null;
  };

  useEffect(() => {
    stopPaymentSpring();
    paymentDragStateRef.current = null;
    setPaymentDragPreview(null);
    paymentDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopPaymentSpring, []);

  const springBackPayment = useCallback(() => {
    const drag = paymentDragStateRef.current;
    if (!drag) return;
    stopPaymentSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / PAYMENT_SPRING_MS);
      const eased = paymentEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (paymentDragStateRef.current) paymentDragStateRef.current.currentValue = next;
      setPaymentDragPreview({ index, value: next });
      if (elapsed < 1) {
        paymentAnimRef.current = requestAnimationFrame(step);
      } else {
        paymentDragStateRef.current = null;
        paymentAnimRef.current = null;
        setPaymentDragPreview(null);
      }
    };
    paymentAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handlePaymentDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopPaymentSpring();

    const samples = paymentDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = paymentYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    paymentDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setPaymentDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = paymentDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = paymentYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setPaymentDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (paymentDragStateRef.current) springBackPayment();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackPayment]);

  const paymentDisplayTrend = useMemo(() => {
    if (!paymentDragPreview) return trend;
    return trend.map((d, i) => (i === paymentDragPreview.index ? { ...d, total: paymentDragPreview.value } : d));
  }, [trend, paymentDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderPaymentCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    paymentDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`payment-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderPaymentActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = paymentDragPreview?.index === index;
    return (
      <g key={`payment-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#e11d48" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handlePaymentDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Penerima', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-rose-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {missingJeIdCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {missingJeIdCount} baris transaksi Cash Payment tidak memiliki nomor jurnal (jeId). KPI di bawah tetap
            dihitung memakai nomor referensi sebagai gantinya, tapi sebaiknya ditinjau di halaman Transaksi utama.
          </span>
        </div>
      )}

      {unbalanced.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {unbalanced.length} jurnal Cash Payment tidak balance (total debit ≠ total kredit) — contoh: {unbalanced[0].jeId}
            {' '}(selisih {formatIDR(unbalanced[0].diff, true)}). Total Cash Payment tetap dihitung dari sisi yang
            lebih besar, tapi sebaiknya jurnal ini diperbaiki di halaman Transaksi utama.
          </span>
        </div>
      )}

      {draftCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {draftCount} transaksi Cash Payment senilai {formatIDR(draftTotal, true)} masih berstatus Draft
            (menunggu approval) — belum termasuk dalam Total Cash Payment di bawah sampai disetujui.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard
          title="Total Cash Payment"
          value={totalPayment}
          icon="ArrowUpCircleIcon"
          iconColor="text-rose-600"
          iconBg="bg-rose-50"
          subLabel={draftCount > 0 ? `+ ${formatIDR(draftTotal, true)} pending approval` : undefined}
        />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Pembayaran Pajak" value={String(taxCount)} icon="ReceiptPercentIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
        <KpiCard title="Pembayaran Hutang Usaha" value={String(apCount)} icon="BuildingLibraryIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>
      {unpostedCount > 0 && (
        <p className="text-xs text-amber-700 -mt-4 mb-2">⚠ {unpostedCount} transaksi Cash Payment belum diposting.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Cash Payment Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Cash Payment untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={paymentDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPaymentMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={PAYMENT_AXIS_WIDTH}
                    ticks={paymentYTicks}
                    domain={paymentYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<PaymentTrendTooltip dragPreview={paymentDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Cash Payment"
                    stroke="#e11d48"
                    strokeWidth={2.5}
                    fill="url(#gradPaymentMain)"
                    dot={renderPaymentCalibrationDot as any}
                    activeDot={renderPaymentActiveDot as any}
                    isAnimationActive={!paymentDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handlePaymentAxisMouseDown}
                onDoubleClick={resetPaymentZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: PAYMENT_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Payment per Kategori</h2>
          <p className="text-xs text-muted-foreground mb-3">Breakdown pembayaran</p>
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
        <h2 className="text-sm font-bold text-foreground mb-1">Top Penerima Pembayaran</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan kontribusi nominal</p>
        {topPayees.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topPayees.map((c, i) => {
              const max = topPayees[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-rose-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Cash Payment — digabung jadi 1
          kolom, aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="cash_payment"
        groupLabel="Cash Payment"
        defaultCategory="AP Payment"
        columns={columns}
        onRowClick={setSelectedTx}
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}