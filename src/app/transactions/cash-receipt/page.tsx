'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, uniqueJournalCount, countJournalsByStatus, monthlyTrendFor, categoryBreakdown, CHART_COLORS, transactionsMissingJeId, unbalancedJournals } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';

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

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'cash_receipt' = pergerakan kas/bank & pendanaan (akun Kas
// & Bank, Deposito, kategori 'Financing') — lihat getTransactionGroup().
export default function CashReceiptPage() {
  const { getByGroup } = useTransactions();
  const receiptTx = useMemo(() => getByGroup('cash_receipt'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // [TIDAK DIUBAH] inflow/outflow/netMovement sengaja TETAP dijumlah per
  // BARIS (bukan per jeId seperti Sales/Purchase/Cash Payment). Beda dengan
  // "Total Sales/Purchase" yang rawan dobel karena 1 nilai ekonomi dicatat di
  // 2 kaki jurnal (Kas & Pendapatan/Beban), di sini SETIAP baris kas/bank
  // ADALAH satu pergerakan fisik kas yang nyata sendiri-sendiri (mis. transfer
  // antar-bank = 1 jeId tapi 2 baris Kas & Bank yang berbeda: satu keluar dari
  // Bank A, satu masuk ke Bank B — keduanya harus tetap terhitung terpisah,
  // kalau di-dedup per jeId salah satu pergerakannya akan hilang).
  // [BARU] Baris berstatus 'Draft' (pending approval) dikeluarkan dari
  // inflow/outflow di sini — sama alasannya dengan Sales/Purchase/Cash
  // Payment/Other lewat groupByJournalRealized() (lihat groupAnalytics.ts):
  // pergerakan kas yang belum disetujui secara bisnis belum seharusnya
  // dianggap terjadi. Nilainya tetap dihitung terpisah di bawah
  // (draftInflow/draftOutflow) supaya tidak hilang begitu saja dari UI.
  const realizedReceiptTx = receiptTx.filter((t) => t.status !== 'Draft');
  const inflow = realizedReceiptTx.reduce((s, t) => s + t.debit, 0); // masuk ke Kas & Bank
  const outflow = realizedReceiptTx.reduce((s, t) => s + t.credit, 0); // keluar dari Kas & Bank
  const netMovement = inflow - outflow;
  // [DIUBAH] "Jumlah Transaksi" beda konsep dari inflow/outflow di atas — ini
  // menghitung jumlah TRANSAKSI (jeId unik), konsisten dengan kartu yang sama
  // di Sales/Purchase/Cash Payment/Other, supaya 1 transfer antar-bank (1
  // jeId, 2 baris) dihitung sebagai 1 transaksi, bukan 2.
  const txCount = uniqueJournalCount(receiptTx);
  // [BARU] Nilai pergerakan kas berstatus Draft yang dikeluarkan dari
  // inflow/outflow di atas — ditampilkan terpisah (bukan dihilangkan begitu
  // saja) lewat banner & subLabel KPI di bawah.
  const draftCount = countJournalsByStatus(receiptTx, 'Draft');
  const draftReceiptTx = receiptTx.filter((t) => t.status === 'Draft');
  const draftInflow = draftReceiptTx.reduce((s, t) => s + t.debit, 0);
  const draftOutflow = draftReceiptTx.reduce((s, t) => s + t.credit, 0);

  // [BARU] Peringatan integritas data — sama seperti Sales/Purchase/Cash
  // Payment. Lihat transactionsMissingJeId() di groupAnalytics.ts. Relevan
  // juga di sini karena "Jumlah Transaksi" (txCount) di atas tetap dihitung
  // per jeId, walau inflow/outflow sengaja dijumlah per baris (lihat catatan
  // di atas).
  const missingJeIdCount = useMemo(() => transactionsMissingJeId(receiptTx).length, [receiptTx]);
  const unbalanced = useMemo(() => unbalancedJournals(receiptTx), [receiptTx]);
  const latestBalance = useMemo(() => {
    const sorted = [...receiptTx].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted[0]?.saldoAkhir ?? 0;
  }, [receiptTx]);

  const trend = useMemo(() => monthlyTrendFor(receiptTx), [receiptTx]);
  const byCategory = useMemo(() => categoryBreakdown(receiptTx).slice(0, 6), [receiptTx]);
  const byAccount = useMemo(() => {
    const byAcc = new Map<string, number>();
    receiptTx.forEach(tx => byAcc.set(tx.accountName, (byAcc.get(tx.accountName) || 0) + txAmount(tx)));
    return Array.from(byAcc.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [receiptTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama pola dengan chart
  // Sales / Purchase / Cash Payment / Financial Overview. ──
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
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Cash Receipt</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pergerakan kas, bank & pendanaan — diambil otomatis dari halaman Transaksi</p>
      </div>

      {missingJeIdCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {missingJeIdCount} baris transaksi Cash Receipt tidak memiliki nomor jurnal (jeId). KPI di bawah tetap
            dihitung memakai nomor referensi sebagai gantinya, tapi sebaiknya ditinjau di halaman Transaksi utama.
          </span>
        </div>
      )}

      {unbalanced.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {unbalanced.length} jurnal Cash Receipt tidak balance (total debit ≠ total kredit) — contoh:{' '}
            {unbalanced[0].jeId} (selisih {formatIDR(unbalanced[0].diff, true)}). Grafik tren & breakdown kategori di
            bawah tetap dihitung dari sisi yang lebih besar, tapi sebaiknya jurnal ini diperbaiki di halaman
            Transaksi utama.
          </span>
        </div>
      )}

      {draftCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">Perhatian:</span>
          <span>
            {draftCount} transaksi Cash Receipt (masuk {formatIDR(draftInflow, true)}, keluar{' '}
            {formatIDR(draftOutflow, true)}) masih berstatus Draft (menunggu approval) — belum termasuk dalam Kas
            Masuk/Kas Keluar di bawah sampai disetujui.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Saldo Terakhir" value={latestBalance} icon="BanknotesIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard
          title="Kas Masuk"
          value={inflow}
          icon="ArrowDownCircleIcon"
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          subLabel={draftCount > 0 && draftInflow > 0 ? `+ ${formatIDR(draftInflow, true)} pending approval` : undefined}
        />
        <KpiCard
          title="Kas Keluar"
          value={outflow}
          icon="ArrowUpCircleIcon"
          iconColor="text-rose-600"
          iconBg="bg-rose-50"
          subLabel={draftCount > 0 && draftOutflow > 0 ? `+ ${formatIDR(draftOutflow, true)} pending approval` : undefined}
        />
        <KpiCard title="Pergerakan Bersih" value={netMovement} icon="ScaleIcon" iconColor={netMovement >= 0 ? 'text-emerald-600' : 'text-rose-600'} iconBg={netMovement >= 0 ? 'bg-emerald-50' : 'bg-rose-50'} />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Cash Receipt Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
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

      {/* Aksi & Upload Data + Tabel Transaksi Cash Receipt — digabung jadi 1
          kolom, aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="cash_receipt"
        groupLabel="Cash Receipt"
        defaultCategory="Financing"
        columns={columns}
        onRowClick={setSelectedTx}
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}