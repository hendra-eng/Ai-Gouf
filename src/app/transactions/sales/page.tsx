'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, txAmount, uniqueJournalTotal, uniqueJournalCount, countJournalsByStatus, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS, formatDate } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Financial
// Overview / Balance Sheet): width YAxis (65) + margin.left AreaChart (10). ──
const SALES_AXIS_WIDTH = 65;
const SALES_AXIS_OVERLAY_WIDTH = SALES_AXIS_WIDTH + 10;
const SALES_SPRING_MS = 380;
const salesEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface SalesDragPreview {
  index: number;
  value: number;
}

function SalesTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: SalesDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-teal-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Halaman ini sekarang murni turunan dari data di halaman Transaksi
// utama: seluruh baris yang tergolong kelompok 'sales' (lihat
// getTransactionGroup() di components/transactionData.ts — akun Pendapatan/
// Piutang, atau category 'Revenue') diambil lewat getByGroup('sales') dari
// TransactionsContext, lalu dianalisa & ditabelkan di sini. Tidak ada lagi
// data dummy terpisah (salesTransactions dari lib/transactionData.ts sudah
// tidak dipakai).
//
// [DIUBAH] "Aksi & Upload Data" (Import/Export/Download Jurnal PDF/+Jurnal
// Baru + filter bar) dan tabel "Transaksi Sales" sebelumnya 2 kartu terpisah
// (aksi di paling bawah halaman). Sekarang keduanya digabung jadi 1 kolom
// lewat TransactionsGroupPanel, dengan Aksi & Upload Data diletakkan di atas
// tabel.
export default function SalesPage() {
  const { getByGroup } = useTransactions();
  const salesTx = useMemo(() => getByGroup('sales'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // ── KPI (dihitung langsung dari salesTx, bukan angka statis) ──
  // [DIUBAH] Total Sales sebelumnya menjumlah txAmount() (debit+kredit) tiap
  // BARIS transaksi. Masalahnya: satu transaksi penjualan sering dicatat
  // sebagai 2 baris kaki jurnal dengan jeId yang sama (mis. sisi Kas & Bank
  // saat uang masuk, DAN sisi akun Pendapatan saat pendapatan diakui) —
  // keduanya sama-sama category 'Revenue' sehingga sama-sama masuk salesTx,
  // dan kalau dijumlah per baris nilainya kehitung 2x lipat. uniqueJournalTotal()
  // mengelompokkan per jeId dulu sebelum dijumlah, jadi tiap transaksi
  // ekonomi hanya dihitung sekali. Lihat groupAnalytics.ts untuk detail.
  const grossSales = uniqueJournalTotal(salesTx);
  // [DIUBAH] Sebelumnya txCount = salesTx.length (jumlah BARIS). Sekarang
  // dihitung per jeId unik (uniqueJournalCount), konsisten dengan grossSales
  // di atas — supaya "Rata-rata / Transaksi" (grossSales ÷ txCount) tetap
  // benar (bukan Total Sales yang sudah per-jurnal dibagi jumlah baris yang
  // masih dobel).
  const txCount = uniqueJournalCount(salesTx);
  const avgTxValue = txCount > 0 ? grossSales / txCount : 0;
  // [DIUBAH] unpostedCount & reconciledCount sebelumnya menghitung BARIS
  // (salesTx.filter(...).length) — basisnya jadi tidak nyambung dengan
  // txCount yang sekarang sudah per-jurnal. countJournalsByStatus() ikut
  // mengelompokkan per jeId dulu, jadi satu transaksi dengan 2 kaki jurnal
  // (mis. Kas + Pendapatan yang sama-sama 'Posted') tetap dihitung sebagai
  // SATU transaksi Posted, bukan 2.
  const unpostedCount = countJournalsByStatus(salesTx, 'Unposted');
  const reconciledCount = countJournalsByStatus(salesTx, 'Reconciled');
  const reconciledPct = txCount > 0 ? (reconciledCount / txCount) * 100 : 0;

  const trend = useMemo(() => monthlyTrendFor(salesTx), [salesTx]);
  const byCategory = useMemo(() => categoryBreakdown(salesTx).slice(0, 6), [salesTx]);
  const topCustomers = useMemo(() => topParties(salesTx, 5), [salesTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // Financial Overview / Balance Sheet. ──
  const salesBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [salesPriceZoom, setSalesPriceZoom] = useState(1);
  const salesZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: salesYTicks } = useMemo(
    () => getNiceTicksFromZero(salesBaseMax / salesPriceZoom, 5),
    [salesBaseMax, salesPriceZoom]
  );
  const salesYDomain = useMemo<[number, number]>(() => [0, salesBaseMax / salesPriceZoom], [salesBaseMax, salesPriceZoom]);
  const salesYDomainRef = useRef(salesYDomain);
  salesYDomainRef.current = salesYDomain;

  const handleSalesAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    salesZoomDragRef.current = { startY: e.clientY, startZoom: salesPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!salesZoomDragRef.current) return;
      const deltaY = salesZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, salesZoomDragRef.current.startZoom * factor));
      setSalesPriceZoom(next);
    };
    const onUp = () => {
      salesZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetSalesZoom = () => setSalesPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const salesDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [salesDragPreview, setSalesDragPreview] = useState<SalesDragPreview | null>(null);
  const salesDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const salesAnimRef = useRef<number | null>(null);

  const stopSalesSpring = () => {
    if (salesAnimRef.current) cancelAnimationFrame(salesAnimRef.current);
    salesAnimRef.current = null;
  };

  useEffect(() => {
    stopSalesSpring();
    salesDragStateRef.current = null;
    setSalesDragPreview(null);
    salesDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopSalesSpring, []);

  const springBackSales = useCallback(() => {
    const drag = salesDragStateRef.current;
    if (!drag) return;
    stopSalesSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SALES_SPRING_MS);
      const eased = salesEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (salesDragStateRef.current) salesDragStateRef.current.currentValue = next;
      setSalesDragPreview({ index, value: next });
      if (elapsed < 1) {
        salesAnimRef.current = requestAnimationFrame(step);
      } else {
        salesDragStateRef.current = null;
        salesAnimRef.current = null;
        setSalesDragPreview(null);
      }
    };
    salesAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleSalesDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSalesSpring();

    const samples = salesDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = salesYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    salesDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setSalesDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = salesDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = salesYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setSalesDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (salesDragStateRef.current) springBackSales();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackSales]);

  const salesDisplayTrend = useMemo(() => {
    if (!salesDragPreview) return trend;
    return trend.map((d, i) => (i === salesDragPreview.index ? { ...d, total: salesDragPreview.value } : d));
  }, [trend, salesDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderSalesCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    salesDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`sales-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderSalesActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = salesDragPreview?.index === index;
    return (
      <g key={`sales-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#14b8a6" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleSalesDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Customer', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-info">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-teal-700">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Sales</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaksi penjualan & pendapatan — diambil otomatis dari halaman Transaksi</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Sales" value={grossSales} icon="ShoppingCartIcon" iconColor="text-teal-600" iconBg="bg-teal-50" />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-orange-600" iconBg="bg-orange-50" />
        <KpiCard title="Belum Diposting" value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title="Rekonsiliasi" value={`${reconciledPct.toFixed(0)}%`} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Sales Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Sales untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={salesDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradSalesMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={SALES_AXIS_WIDTH}
                    ticks={salesYTicks}
                    domain={salesYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<SalesTrendTooltip dragPreview={salesDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Sales"
                    stroke="#14b8a6"
                    strokeWidth={2.5}
                    fill="url(#gradSalesMain)"
                    dot={renderSalesCalibrationDot as any}
                    activeDot={renderSalesActiveDot as any}
                    isAnimationActive={!salesDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleSalesAxisMouseDown}
                onDoubleClick={resetSalesZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: SALES_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Sales per Kategori</h2>
          <p className="text-xs text-muted-foreground mb-3">Breakdown pendapatan</p>
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

      {/* Top Customers */}
      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-foreground mb-1">Top Customer</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan kontribusi nominal</p>
        {topCustomers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topCustomers.map((c, i) => {
              const max = topCustomers[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-teal-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-teal-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Sales — digabung jadi 1 kolom,
          aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="sales"
        groupLabel="Sales"
        defaultCategory="Revenue"
        columns={columns}
        onRowClick={setSelectedTx}
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}