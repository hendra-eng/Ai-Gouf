'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction, PAYMENT_STATUS_VARIANT } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, uniqueJournalTotal, uniqueJournalCount, countJournalsByStatus, countJournalsByCategory, draftJournalTotal, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS, transactionsMissingJeId, unbalancedJournals } from '../lib/groupAnalytics';
import { purchaseOutstanding, purchaseBillStatus } from '../lib/apBridge';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import { ArrowUpRight } from 'lucide-react';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales / Financial
// Overview / Balance Sheet): width YAxis (65) + margin.left AreaChart (10). ──
const PURCHASE_AXIS_WIDTH = 65;
const PURCHASE_AXIS_OVERLAY_WIDTH = PURCHASE_AXIS_WIDTH + 10;
const PURCHASE_SPRING_MS = 380;
const purchaseEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface PurchaseDragPreview {
  index: number;
  value: number;
}

function PurchaseTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: PurchaseDragPreview | null;
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
// 'purchase' (akun Beban, kategori Payroll/Software/Rent/Marketing/Travel/
// Utilities) di halaman Transaksi, lewat getByGroup('purchase').
export default function PurchasePage() {
  const { getByGroup } = useTransactions();
  const purchaseTx = useMemo(() => getByGroup('purchase'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // [DIUBAH] Sama seperti Sales — dikelompokkan per NOMOR JURNAL (jeId)
  // dulu sebelum dijumlah/dihitung, supaya transaksi dengan 2 kaki jurnal
  // (mis. sisi Kas & Bank saat uang keluar, DAN sisi akun Beban saat beban
  // diakui — keduanya sama-sama masuk purchaseTx) tidak terhitung dua kali.
  // Lihat groupAnalytics.ts untuk detail (uniqueJournalTotal/uniqueJournalCount/
  // countJournalsByStatus/countJournalsByCategory).
  const totalPurchase = uniqueJournalTotal(purchaseTx);
  const txCount = uniqueJournalCount(purchaseTx);
  const avgTxValue = txCount > 0 ? totalPurchase / txCount : 0;
  const unpostedCount = countJournalsByStatus(purchaseTx, 'Unposted');
  const recurringLike = countJournalsByCategory(purchaseTx, ['Payroll', 'Rent', 'Software', 'Utilities']);
  // [BARU] Sama seperti Sales — transaksi 'Draft' (pending approval) sengaja
  // dikeluarkan dari totalPurchase/txCount lewat groupByJournalRealized(),
  // nilainya ditampilkan terpisah supaya tidak hilang begitu saja.
  const draftCount = countJournalsByStatus(purchaseTx, 'Draft');
  const draftTotal = draftJournalTotal(purchaseTx);

  // [BARU] Peringatan integritas data — sama seperti Sales. Lihat
  // transactionsMissingJeId() di groupAnalytics.ts.
  const missingJeIdCount = useMemo(() => transactionsMissingJeId(purchaseTx).length, [purchaseTx]);
  const unbalanced = useMemo(() => unbalancedJournals(purchaseTx), [purchaseTx]);

  // [BARU] Nilai yang belum dibayar ke vendor di antara transaksi Purchase —
  // inilah angka yang "mengalir" ke halaman Account Payable (lihat apBridge.ts).
  const outstandingToAP = useMemo(() => purchaseTx.reduce((s, t) => s + purchaseOutstanding(t), 0), [purchaseTx]);
  const overdueToAPCount = useMemo(
    () => purchaseTx.filter((t) => purchaseOutstanding(t) > 0 && purchaseBillStatus(t) === 'Overdue').length,
    [purchaseTx]
  );

  const trend = useMemo(() => monthlyTrendFor(purchaseTx), [purchaseTx]);
  const byCategory = useMemo(() => categoryBreakdown(purchaseTx).slice(0, 6), [purchaseTx]);
  const topVendors = useMemo(() => topParties(purchaseTx, 5), [purchaseTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Financial Overview / Balance Sheet. ──
  const purchaseBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [purchasePriceZoom, setPurchasePriceZoom] = useState(1);
  const purchaseZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: purchaseYTicks } = useMemo(
    () => getNiceTicksFromZero(purchaseBaseMax / purchasePriceZoom, 5),
    [purchaseBaseMax, purchasePriceZoom]
  );
  const purchaseYDomain = useMemo<[number, number]>(
    () => [0, purchaseBaseMax / purchasePriceZoom],
    [purchaseBaseMax, purchasePriceZoom]
  );
  const purchaseYDomainRef = useRef(purchaseYDomain);
  purchaseYDomainRef.current = purchaseYDomain;

  const handlePurchaseAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    purchaseZoomDragRef.current = { startY: e.clientY, startZoom: purchasePriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!purchaseZoomDragRef.current) return;
      const deltaY = purchaseZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, purchaseZoomDragRef.current.startZoom * factor));
      setPurchasePriceZoom(next);
    };
    const onUp = () => {
      purchaseZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetPurchaseZoom = () => setPurchasePriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const purchaseDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [purchaseDragPreview, setPurchaseDragPreview] = useState<PurchaseDragPreview | null>(null);
  const purchaseDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const purchaseAnimRef = useRef<number | null>(null);

  const stopPurchaseSpring = () => {
    if (purchaseAnimRef.current) cancelAnimationFrame(purchaseAnimRef.current);
    purchaseAnimRef.current = null;
  };

  useEffect(() => {
    stopPurchaseSpring();
    purchaseDragStateRef.current = null;
    setPurchaseDragPreview(null);
    purchaseDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopPurchaseSpring, []);

  const springBackPurchase = useCallback(() => {
    const drag = purchaseDragStateRef.current;
    if (!drag) return;
    stopPurchaseSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / PURCHASE_SPRING_MS);
      const eased = purchaseEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (purchaseDragStateRef.current) purchaseDragStateRef.current.currentValue = next;
      setPurchaseDragPreview({ index, value: next });
      if (elapsed < 1) {
        purchaseAnimRef.current = requestAnimationFrame(step);
      } else {
        purchaseDragStateRef.current = null;
        purchaseAnimRef.current = null;
        setPurchaseDragPreview(null);
      }
    };
    purchaseAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handlePurchaseDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopPurchaseSpring();

    const samples = purchaseDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = purchaseYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    purchaseDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setPurchaseDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = purchaseDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = purchaseYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setPurchaseDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (purchaseDragStateRef.current) springBackPurchase();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackPurchase]);

  const purchaseDisplayTrend = useMemo(() => {
    if (!purchaseDragPreview) return trend;
    return trend.map((d, i) => (i === purchaseDragPreview.index ? { ...d, total: purchaseDragPreview.value } : d));
  }, [trend, purchaseDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderPurchaseCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    purchaseDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`purchase-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderPurchaseActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = purchaseDragPreview?.index === index;
    return (
      <g key={`purchase-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#f97316" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handlePurchaseDotPointerDown(e, index, payload.total)}
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
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Purchase</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaksi beban operasional — diambil otomatis dari halaman Transaksi</p>
      </div>

      {missingJeIdCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {missingJeIdCount} baris transaksi Purchase tidak memiliki nomor jurnal (jeId). KPI di bawah tetap
            dihitung memakai nomor referensi sebagai gantinya, tapi sebaiknya ditinjau di halaman Transaksi utama.
          </span>
        </div>
      )}

      {unbalanced.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {unbalanced.length} jurnal Purchase tidak balance (total debit ≠ total kredit) — contoh: {unbalanced[0].jeId}
            {' '}(selisih {formatIDR(unbalanced[0].diff, true)}). Total Purchase tetap dihitung dari sisi yang lebih
            besar, tapi sebaiknya jurnal ini diperbaiki di halaman Transaksi utama.
          </span>
        </div>
      )}

      {/* [BARU] Banner penghubung ke Account Payable — setiap transaksi
          Purchase yang Status Pembayarannya belum "Lunas" otomatis muncul
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

      {draftCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {draftCount} transaksi Purchase senilai {formatIDR(draftTotal, true)} masih berstatus Draft (menunggu
            approval) — belum termasuk dalam Total Purchase di bawah sampai disetujui.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard
          title="Total Purchase"
          value={totalPurchase}
          icon="CreditCardIcon"
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
          subLabel={draftCount > 0 ? `+ ${formatIDR(draftTotal, true)} pending approval` : undefined}
        />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Belum Diposting" value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title="Beban Rutin" value={String(recurringLike)} icon="ArrowPathIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Purchase Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Purchase untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={purchaseDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPurchaseMain" x1="0" y1="0" x2="0" y2="1">
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
                    width={PURCHASE_AXIS_WIDTH}
                    ticks={purchaseYTicks}
                    domain={purchaseYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<PurchaseTrendTooltip dragPreview={purchaseDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Purchase"
                    stroke="#f97316"
                    strokeWidth={2.5}
                    fill="url(#gradPurchaseMain)"
                    dot={renderPurchaseCalibrationDot as any}
                    activeDot={renderPurchaseActiveDot as any}
                    isAnimationActive={!purchaseDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handlePurchaseAxisMouseDown}
                onDoubleClick={resetPurchaseZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: PURCHASE_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Purchase per Kategori</h2>
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

      {/* Aksi & Upload Data + Tabel Transaksi Purchase — digabung jadi 1 kolom,
          aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="purchase"
        groupLabel="Purchase"
        defaultCategory="Software"
        columns={columns}
        onRowClick={setSelectedTx}
        // [BARU] Tombol Import di halaman Purchase sekarang MENGGANTI (bukan
        // menambah) seluruh transaksi Purchase dengan hasil upload PDF
        // "Data Penjualan Detail" (kasir/POS) — kelompok transaksi lain
        // (Sales, Cash Payment, dll) tidak ikut terhapus. Excel/rekening
        // koran belum didukung di mode ini, hanya PDF.
        importMode="replace-group"
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}