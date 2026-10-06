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
  useCashReceiptsFromSales,
  trenBulananDiterima,
  rincianPerKategori,
  customerTerbesar,
  type CashReceiptRow,
} from '../lib/useSalesCashReceipts';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Sales/Purchase/Cash Payment). ──
const RECEIPT_AXIS_WIDTH = 65;
const RECEIPT_AXIS_OVERLAY_WIDTH = RECEIPT_AXIS_WIDTH + 10;
const RECEIPT_SPRING_MS = 380;
const receiptEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface ReceiptDragPreview {
  index: number;
  value: number;
}

function ReceiptTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: ReceiptDragPreview | null;
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

const PAGE_SIZE = 8;

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  paid: 'Lunas', partial: 'Sebagian', unpaid: 'Belum Diterima',
};
const RECEIPT_STATUS_VARIANT: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  paid: 'positive', partial: 'warning', unpaid: 'neutral',
};

// Cash Receipt = penerimaan pembayaran dari customer. Sumber data: invoice Sales
// (lihat lib/useSalesCashReceipts.ts) -- TIDAK membaca tabel Cash & Bank lagi.
export default function CashReceiptPage() {
  const { rows, loading, error, refresh } = useCashReceiptsFromSales();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const totalReceived = useMemo(() => rows.reduce((s, r) => s + r.received, 0), [rows]);
  const totalOutstanding = useMemo(() => rows.reduce((s, r) => s + r.outstanding, 0), [rows]);
  const txCount = rows.length;
  const avgTxValue = txCount > 0 ? rows.reduce((s, r) => s + r.total, 0) / txCount : 0;
  const overdueCount = useMemo(() => rows.filter(r => r.isOverdue).length, [rows]);
  const totalDalamProses = useMemo(() => rows.reduce((s, r) => s + r.dalamProses, 0), [rows]);

  const trend = useMemo(() => trenBulananDiterima(rows), [rows]);
  const byCategory = useMemo(() => rincianPerKategori(rows).slice(0, 6), [rows]);
  const topCustomers = useMemo(() => customerTerbesar(rows, 5), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.receiptStatus !== statusFilter) return false;
      if (!q) return true;
      return [r.invoiceNo, r.customer, r.description].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Purchase / Financial Overview. ──
  const receiptBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [receiptPriceZoom, setReceiptPriceZoom] = useState(1);
  const receiptZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: receiptYTicks } = useMemo(
    () => getNiceTicksFromZero(receiptBaseMax / receiptPriceZoom, 5),
    [receiptBaseMax, receiptPriceZoom]
  );
  const receiptYDomain = useMemo<[number, number]>(
    () => [0, receiptBaseMax / receiptPriceZoom],
    [receiptBaseMax, receiptPriceZoom]
  );
  const receiptYDomainRef = useRef(receiptYDomain);
  receiptYDomainRef.current = receiptYDomain;

  const handleReceiptAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    receiptZoomDragRef.current = { startY: e.clientY, startZoom: receiptPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!receiptZoomDragRef.current) return;
      const deltaY = receiptZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, receiptZoomDragRef.current.startZoom * factor));
      setReceiptPriceZoom(next);
    };
    const onUp = () => {
      receiptZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetReceiptZoom = () => setReceiptPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const receiptDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [receiptDragPreview, setReceiptDragPreview] = useState<ReceiptDragPreview | null>(null);
  const receiptDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const receiptAnimRef = useRef<number | null>(null);

  const stopReceiptSpring = () => {
    if (receiptAnimRef.current) cancelAnimationFrame(receiptAnimRef.current);
    receiptAnimRef.current = null;
  };

  useEffect(() => {
    stopReceiptSpring();
    receiptDragStateRef.current = null;
    setReceiptDragPreview(null);
    receiptDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopReceiptSpring, []);

  const springBackReceipt = useCallback(() => {
    const drag = receiptDragStateRef.current;
    if (!drag) return;
    stopReceiptSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / RECEIPT_SPRING_MS);
      const eased = receiptEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (receiptDragStateRef.current) receiptDragStateRef.current.currentValue = next;
      setReceiptDragPreview({ index, value: next });
      if (elapsed < 1) {
        receiptAnimRef.current = requestAnimationFrame(step);
      } else {
        receiptDragStateRef.current = null;
        receiptAnimRef.current = null;
        setReceiptDragPreview(null);
      }
    };
    receiptAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleReceiptDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopReceiptSpring();

    const samples = receiptDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = receiptYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    receiptDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setReceiptDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = receiptDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = receiptYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setReceiptDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (receiptDragStateRef.current) springBackReceipt();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackReceipt]);

  const receiptDisplayTrend = useMemo(() => {
    if (!receiptDragPreview) return trend;
    return trend.map((d, i) => (i === receiptDragPreview.index ? { ...d, total: receiptDragPreview.value } : d));
  }, [trend, receiptDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderReceiptCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    receiptDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`receipt-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderReceiptActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = receiptDragPreview?.index === index;
    return (
      <g key={`receipt-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleReceiptDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  const columns = [
    { key: 'date', label: 'Tanggal', render: (r: CashReceiptRow) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'invoiceNo', label: 'No. Invoice', render: (r: CashReceiptRow) => <span className="font-mono text-xs text-teal-600">{r.invoiceNo}</span> },
    { key: 'customer', label: 'Customer', render: (r: CashReceiptRow) => <span className="font-medium text-xs">{r.customer}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: CashReceiptRow) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description || '—'}</span> },
    { key: 'category', label: 'Tipe', render: (r: CashReceiptRow) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'dueDate', label: 'Jatuh Tempo', render: (r: CashReceiptRow) => <span className="font-mono text-xs">{r.dueDate ? formatDate(r.dueDate) : '—'}</span> },
    { key: 'total', label: 'Total', render: (r: CashReceiptRow) => <span className="font-mono text-xs">{formatIDR(r.total, true)}</span> },
    { key: 'received', label: 'Diterima', render: (r: CashReceiptRow) => <span className="font-mono text-xs font-semibold text-blue-700">{r.received ? formatIDR(r.received, true) : '—'}</span> },
    { key: 'outstanding', label: 'Sisa', render: (r: CashReceiptRow) => <span className="font-mono text-xs">{r.outstanding ? formatIDR(r.outstanding, true) : '—'}</span> },
    { key: 'receiptStatus', label: 'Status', render: (r: CashReceiptRow) => (
      <div>
        <StatusBadge variant={r.isOverdue ? 'negative' : (RECEIPT_STATUS_VARIANT[r.receiptStatus] || 'neutral')}
          label={r.isOverdue ? 'Jatuh Tempo' : (RECEIPT_STATUS_LABEL[r.receiptStatus] || r.receiptStatus)} dot />
        <DalamProsesBadge nominal={r.dalamProses} />
      </div>
    ) },
    { key: 'mutasi', label: 'Mutasi Bank', render: (r: CashReceiptRow) => <MutasiBankCell items={r.rekon} /> },
    { key: 'jurnal', label: 'Jurnal', render: (r: CashReceiptRow) => <JurnalCell items={r.rekon} /> },
  ];

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">Gagal memuat data Sales:</span>
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium ml-auto">Coba lagi</button>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>{overdueCount} invoice customer sudah lewat jatuh tempo dan belum lunas (total piutang {formatIDR(totalOutstanding, true)} untuk seluruh invoice yang belum lunas).</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Diterima" value={totalReceived} icon="ArrowDownCircleIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Belum Diterima (Piutang)" value={totalOutstanding} icon="BuildingLibraryIcon" iconColor="text-slate-600" iconBg="bg-slate-100" subLabel={totalDalamProses > 0 ? `${formatIDR(totalDalamProses, true)} dalam proses (menunggu posting)` : undefined} />
        <KpiCard title="Jumlah Invoice" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Invoice" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Lewat Jatuh Tempo" value={String(overdueCount)} icon="ReceiptPercentIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Cash Receipt Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Nominal diterima per bulan: tanggal bayar untuk pembayaran rekonsiliasi yang sudah diposting, tanggal invoice untuk sisanya</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Cash Receipt untuk ditampilkan.</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={receiptDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradReceiptMain" x1="0" y1="0" x2="0" y2="1">
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
                    width={RECEIPT_AXIS_WIDTH}
                    ticks={receiptYTicks}
                    domain={receiptYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<ReceiptTrendTooltip dragPreview={receiptDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Cash Receipt"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fill="url(#gradReceiptMain)"
                    dot={renderReceiptCalibrationDot as any}
                    activeDot={renderReceiptActiveDot as any}
                    isAnimationActive={!receiptDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleReceiptAxisMouseDown}
                onDoubleClick={resetReceiptZoom}
                title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: RECEIPT_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Receipt per Tipe</h2>
          <p className="text-xs text-muted-foreground mb-3">Total invoice per tipe transaksi Sales</p>
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
        <h2 className="text-sm font-bold text-foreground mb-1">Top Customer</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan total invoice</p>
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
                      <span className="text-xs font-semibold font-mono text-blue-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-blue-400" style={{ width: `${(c.amount / max) * 100}%` }} />
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
          <h2 className="text-sm font-bold text-foreground">Invoice Customer (dari halaman Sales)</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Cari no. invoice, customer..."
              className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground w-64"
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
            >
              <option value="all">Semua status</option>
              <option value="unpaid">Belum Diterima</option>
              <option value="partial">Sebagian</option>
              <option value="paid">Lunas</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Hanya invoice Sales yang sudah diposting. Diterima dan sisa baru berubah setelah jurnal rekonsiliasinya diposting; sebelum itu invoice ditandai "Dalam proses".
        </p>
        <DataTable
          columns={columns}
          data={paged}
          loading={loading}
          emptyMessage="Belum ada invoice Sales yang sudah diposting."
        />
        <Pagination page={pageSafe} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>
    </div>
  );
}