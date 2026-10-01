'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import DataTable from '@/components/shared/DataTable';
import Pagination from '@/components/shared/Pagination';
import { formatIDR, formatDate, CHART_COLORS } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import CashBankTabs from '../components/CashBankTabs';
import { MutasiBankCell, JurnalCell, DalamProsesBadge } from '../components/RekonInfoCells';
import {
  useCashPaymentsFromPurchase,
  trenBulananDibayar,
  rincianPerKategori,
  vendorTerbesar,
  type CashPaymentRow,
} from '../lib/usePurchaseCashPayments';

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

const PAGE_SIZE = 8;

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'Lunas', partially_paid: 'Sebagian', unpaid: 'Belum Dibayar', overdue: 'Jatuh Tempo', on_hold: 'Ditahan',
};
const PAYMENT_STATUS_VARIANT: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  paid: 'positive', partially_paid: 'warning', unpaid: 'neutral', overdue: 'negative', on_hold: 'info',
};

// Cash Payment = pembayaran tagihan vendor. Sumber data: transaksi Purchase
// (lihat lib/usePurchaseCashPayments.ts) -- TIDAK membaca tabel Cash & Bank lagi.
export default function CashPaymentPage() {
  const { rows, loading, error, refresh } = useCashPaymentsFromPurchase();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const totalPaid = useMemo(() => rows.reduce((s, r) => s + r.paid, 0), [rows]);
  const totalOutstanding = useMemo(() => rows.reduce((s, r) => s + r.outstanding, 0), [rows]);
  const txCount = rows.length;
  const avgTxValue = txCount > 0 ? rows.reduce((s, r) => s + r.total, 0) / txCount : 0;
  const overdueCount = useMemo(() => rows.filter(r => r.isOverdue).length, [rows]);
  const totalDalamProses = useMemo(() => rows.reduce((s, r) => s + r.dalamProses, 0), [rows]);

  const trend = useMemo(() => trenBulananDibayar(rows), [rows]);
  const byCategory = useMemo(() => rincianPerKategori(rows).slice(0, 6), [rows]);
  const topPayees = useMemo(() => vendorTerbesar(rows, 5), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.paymentStatus !== statusFilter) return false;
      if (!q) return true;
      return [r.purchaseId, r.invoiceNumber, r.vendor, r.description].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

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
    { key: 'date', label: 'Tanggal', render: (r: CashPaymentRow) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'purchaseId', label: 'No. Purchase', render: (r: CashPaymentRow) => <span className="font-mono text-xs text-teal-600">{r.purchaseId}</span> },
    { key: 'vendor', label: 'Vendor', render: (r: CashPaymentRow) => <span className="font-medium text-xs">{r.vendor}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: CashPaymentRow) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description || '—'}</span> },
    { key: 'category', label: 'Kategori', render: (r: CashPaymentRow) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'dueDate', label: 'Jatuh Tempo', render: (r: CashPaymentRow) => <span className="font-mono text-xs">{r.dueDate ? formatDate(r.dueDate) : '—'}</span> },
    { key: 'total', label: 'Total', render: (r: CashPaymentRow) => <span className="font-mono text-xs">{formatIDR(r.total, true)}</span> },
    { key: 'paid', label: 'Dibayar', render: (r: CashPaymentRow) => <span className="font-mono text-xs font-semibold text-rose-700">{r.paid ? formatIDR(r.paid, true) : '—'}</span> },
    { key: 'outstanding', label: 'Sisa', render: (r: CashPaymentRow) => <span className="font-mono text-xs">{r.outstanding ? formatIDR(r.outstanding, true) : '—'}</span> },
    { key: 'paymentStatus', label: 'Status', render: (r: CashPaymentRow) => (
      <div>
        <StatusBadge variant={r.isOverdue && r.paymentStatus !== 'overdue' ? 'negative' : (PAYMENT_STATUS_VARIANT[r.paymentStatus] || 'neutral')}
          label={r.isOverdue && r.paymentStatus !== 'overdue' ? 'Jatuh Tempo' : (PAYMENT_STATUS_LABEL[r.paymentStatus] || r.paymentStatus)} dot />
        <DalamProsesBadge nominal={r.dalamProses} />
      </div>
    ) },
    { key: 'mutasi', label: 'Mutasi Bank', render: (r: CashPaymentRow) => <MutasiBankCell items={r.rekon} /> },
    { key: 'jurnal', label: 'Jurnal', render: (r: CashPaymentRow) => <JurnalCell items={r.rekon} /> },
  ];

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">Gagal memuat data Purchase:</span>
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium ml-auto">Coba lagi</button>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>{overdueCount} tagihan vendor sudah lewat jatuh tempo dan belum lunas (total sisa {formatIDR(totalOutstanding, true)} untuk seluruh tagihan yang belum lunas).</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Dibayar" value={totalPaid} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" />
        <KpiCard title="Belum Dibayar (Hutang)" value={totalOutstanding} icon="BuildingLibraryIcon" iconColor="text-slate-600" iconBg="bg-slate-100" subLabel={totalDalamProses > 0 ? `${formatIDR(totalDalamProses, true)} dalam proses (menunggu posting)` : undefined} />
        <KpiCard title="Jumlah Tagihan" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Tagihan" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Lewat Jatuh Tempo" value={String(overdueCount)} icon="ReceiptPercentIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Cash Payment Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Nominal dibayar per bulan: tanggal bayar untuk pembayaran rekonsiliasi yang sudah diposting, tanggal pembelian untuk sisanya</p>
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
          <p className="text-xs text-muted-foreground mb-3">Total tagihan per kategori Purchase</p>
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
        <h2 className="text-sm font-bold text-foreground mb-1">Top Vendor</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan total tagihan</p>
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

      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="text-sm font-bold text-foreground">Tagihan Vendor (dari halaman Purchase)</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Cari no. purchase, invoice, vendor..."
              className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground w-64"
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
            >
              <option value="all">Semua status</option>
              <option value="unpaid">Belum Dibayar</option>
              <option value="partially_paid">Sebagian</option>
              <option value="overdue">Jatuh Tempo</option>
              <option value="on_hold">Ditahan</option>
              <option value="paid">Lunas</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Hanya transaksi Purchase yang sudah diposting. Dibayar dan sisa baru berubah setelah jurnal rekonsiliasinya diposting; sebelum itu invoice ditandai "Dalam proses".
        </p>
        <DataTable
          columns={columns}
          data={paged}
          loading={loading}
          emptyMessage="Belum ada transaksi Purchase yang sudah diposting."
        />
        <Pagination page={pageSafe} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>
    </div>
  );
}