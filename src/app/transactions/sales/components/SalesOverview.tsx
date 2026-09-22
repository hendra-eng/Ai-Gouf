'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { formatIDR, CHART_COLORS } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useSalesInvoices, formatTanggalSingkat, type BackendSalesInvoice } from '@/lib/salesStore';

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
        {entry.name}: {isDragged ? 'Estimated · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Status invoice (taksonomi financial_transaction_sales_invoices.posting_status):
// Draft/Review/Approved = belum diposting; Posted/Partial/Paid = sudah diposting.
const POSTED_STATUSES = ['Posted', 'Partial', 'Paid'];
const isPosted = (inv: BackendSalesInvoice) => POSTED_STATUSES.includes(inv.posting_status);

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Draft: 'warning', Review: 'warning', Approved: 'info', Posted: 'info', Partial: 'warning', Paid: 'positive',
};

const num = (v: unknown) => Number(v) || 0;
const sumBy = (rows: BackendSalesInvoice[], pick: (r: BackendSalesInvoice) => unknown) => rows.reduce((s, r) => s + num(pick(r)), 0);
const yearOf = (iso: string | null | undefined) => {
  const y = Number((iso || '').slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

const TABLE_PAGE_SIZE = 10;

// Tab "Overview" halaman Transactions > Sales. Seluruh angkanya dihitung dari
// invoice di financial_transaction_sales_invoices (useSalesInvoices, sumber
// yang SAMA dengan tab Sales Transaction / Journal Preview / Posted) --
// bukan lagi dari TransactionsContext (pipeline jurnal-posting lama Agent AI).
// Jadi invoice hasil "Create Invoice" dari Source Data maupun input manual di
// Sales Transaction langsung tampil di sini.
//
// clientId = akun yang login (user.id), sama seperti tab Sales lainnya --
// invoices.client_id memang mengacu ke management_users, bukan ke perusahaan
// aktif di dropdown "Switch Company".
//
// Definisi angka:
//  - Total Sales / Invoices / DPP / VAT / PPh : SEMUA invoice (Draft s/d Paid),
//    supaya invoice yang baru diimport langsung terlihat.
//  - Posted / Reconciliation                  : hanya invoice berstatus Posted/Partial/Paid.
//  - Paid / Accounts Receivable / Overdue     : hanya invoice yang sudah diposting
//    (piutang baru sah setelah diposting; sama dengan kolom AR di tab Posted).
export default function SalesOverview() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { invoices: allInvoices, loading, error } = useSalesInvoices(clientId);
  const invoices = useMemo(() => allInvoices.filter((i) => i.aktif !== false), [allInvoices]);

  const postedInvoices = useMemo(() => invoices.filter(isPosted), [invoices]);
  const pendingInvoices = useMemo(() => invoices.filter((i) => !isPosted(i)), [invoices]);

  // ── KPI baris 1 ──
  const grossSales = sumBy(invoices, (i) => i.gross_amount);
  const txCount = invoices.length;
  const avgTxValue = txCount > 0 ? grossSales / txCount : 0;
  const pendingCount = pendingInvoices.length;
  const pendingTotal = sumBy(pendingInvoices, (i) => i.gross_amount);
  const postedTotal = sumBy(postedInvoices, (i) => i.gross_amount);
  const reconciledCount = postedInvoices.filter((i) => i.reconcile_status === 'Reconciled').length;
  const reconciledPct = postedInvoices.length > 0 ? (reconciledCount / postedInvoices.length) * 100 : 0;

  // ── KPI baris 2 ──
  const totalDPP = sumBy(invoices, (i) => i.dpp);
  const totalPPN = sumBy(invoices, (i) => i.ppn);
  const totalPPh = sumBy(invoices, (i) => i.pph);
  const totalPaid = sumBy(postedInvoices, (i) => i.paid_amount);
  const totalOutstanding = sumBy(postedInvoices, (i) => i.outstanding_amount);
  const overdue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = postedInvoices.filter((i) => !!i.due_date && (i.due_date as string).slice(0, 10) < today && num(i.outstanding_amount) > 0);
    return { count: rows.length, total: sumBy(rows, (i) => i.outstanding_amount) };
  }, [postedInvoices]);

  // ── Tren bulanan (per tahun, berdasarkan invoice_date) ──
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    invoices.forEach((i) => { const y = yearOf(i.invoice_date); if (y) ys.add(y); });
    return Array.from(ys).sort((a, b) => b - a);
  }, [invoices]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const trendYear = pickedYear && availableYears.includes(pickedYear) ? pickedYear : (availableYears[0] ?? new Date().getFullYear());

  const trend = useMemo(() => {
    const totals = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
    invoices.forEach((i) => {
      if (yearOf(i.invoice_date) !== trendYear) return;
      const m = Number((i.invoice_date || '').slice(5, 7)) - 1;
      if (m < 0 || m > 11) return;
      totals[m].total += num(i.gross_amount);
      totals[m].count += 1;
    });
    return MONTH_LABELS.map((month, i) => ({ month, total: totals[i].total, count: totals[i].count }));
  }, [invoices, trendYear]);

  // ── Sales per cabang & top customer ──
  const byBranch = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((i) => {
      const key = (i.cabang || '').trim() || 'Unassigned';
      map.set(key, (map.get(key) || 0) + num(i.gross_amount));
    });
    return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [invoices]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((i) => {
      const key = (i.customer_name || '').trim() || '-';
      map.set(key, (map.get(key) || 0) + num(i.gross_amount));
    });
    return Array.from(map, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [invoices]);

  // ── Tabel invoice (cari + filter cabang + paging) ──
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [tablePage, setTablePage] = useState(1);
  const branches = useMemo(
    () => Array.from(new Set(invoices.map((i) => (i.cabang || '').trim()).filter(Boolean))).sort(),
    [invoices]
  );
  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => {
        if (branchFilter !== 'all' && (i.cabang || '') !== branchFilter) return false;
        if (!q) return true;
        return [i.invoice_no, i.customer_name, i.cabang, i.description].some((v) => (v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));
  }, [invoices, search, branchFilter]);
  const tableTotalPages = Math.max(1, Math.ceil(tableRows.length / TABLE_PAGE_SIZE));
  const tablePageSafe = Math.min(tablePage, tableTotalPages);
  const pagedRows = tableRows.slice((tablePageSafe - 1) * TABLE_PAGE_SIZE, tablePageSafe * TABLE_PAGE_SIZE);

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

  const thClass = 'text-left py-2.5 px-2 text-xs font-semibold text-muted-foreground whitespace-nowrap';

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">{t('Error:')}</span>
          <span>{error}</span>
        </div>
      )}

      {/* Invoice yang belum diposting tetap dihitung di Total Sales, tapi
          diberi peringatan supaya jelas mana yang belum resmi masuk jurnal. */}
      {pendingCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{t('Perhatian:')}</span>
          <span>
            {pendingCount} {t('invoices worth')} {formatIDR(pendingTotal, true)} {t('are not posted yet (Draft / Review / Approved) — they are included in Total Sales, but not in Paid, Accounts Receivable, or Overdue.')}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard
          title={t('Total Sales')}
          value={grossSales}
          icon="ShoppingCartIcon"
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          subLabel={txCount > 0 ? `${formatIDR(postedTotal, true)} ${t('posted')}` : undefined}
        />
        <KpiCard title={t('Number of Transactions')} value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title={t('Average per Transaction')} value={avgTxValue} icon="CalculatorIcon" iconColor="text-orange-600" iconBg="bg-orange-50" />
        <KpiCard title={t('Not Posted')} value={String(pendingCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={pendingCount > 0} />
        <KpiCard title={t('Reconciliation')} value={`${reconciledPct.toFixed(0)}%`} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard title={t('Total Tax Base (DPP)')} value={totalDPP} icon="ScaleIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title={t('VAT Output')} value={totalPPN} icon="ReceiptPercentIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title={t('Total Withholding Tax (PPh)')} value={totalPPh} icon="BuildingLibraryIcon" iconColor="text-indigo-600" iconBg="bg-indigo-50" />
        <KpiCard title={t('Paid')} value={totalPaid} icon="CreditCardIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard
          title={t('Accounts Receivable')}
          value={totalOutstanding}
          icon="BanknotesIcon"
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          alert={totalOutstanding > 0}
        />
        <KpiCard
          title={t('Overdue Invoices')}
          value={String(overdue.count)}
          subLabel={overdue.count > 0 ? `${t('Worth')} ${formatIDR(overdue.total, true)}` : undefined}
          icon="ExclamationTriangleIcon"
          iconColor="text-red-600"
          iconBg="bg-red-50"
          alert={overdue.count > 0}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('Tren Sales Bulanan')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t('Based on invoice date, gross amount')}</p>
            </div>
            {availableYears.length > 1 && (
              <select
                value={trendYear}
                onChange={(e) => setPickedYear(Number(e.target.value))}
                className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground"
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
          {trend.every(pt => pt.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{loading ? t('Loading...') : t('No sales invoices to display yet.')}</p>
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
                title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: SALES_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">{t('Sales per Branch')}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t('Gross sales by branch')}</p>
          {byBranch.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{t('Belum ada data.')}</p>
          ) : (
            <div className="space-y-2.5">
              {byBranch.map((cat, i) => {
                const total = byBranch.reduce((s, c) => s + c.value, 0);
                const pct = total > 0 ? (cat.value / total) * 100 : 0;
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground truncate flex-1">{cat.name === 'Unassigned' ? t('Unassigned') : cat.name}</span>
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
        <h2 className="text-sm font-bold text-foreground mb-1">{t('Top Customer')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('Berdasarkan kontribusi nominal')}</p>
        {topCustomers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">{t('Belum ada data.')}</p>
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

      {/* Tabel invoice Sales (read-only ringkasan -- edit/approve/posting ada di tab Sales Transaction) */}
      {invoices.length === 0 ? (
        <div className="card-elevated-md rounded-xl p-8 text-center text-xs text-muted-foreground">
          {loading ? t('Loading...') : t('No sales invoices yet. Upload a file in Source Data and create invoices, or add one in Sales Transaction.')}
        </div>
      ) : (
        <div className="card-elevated-md rounded-xl">
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-border">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setTablePage(1); }}
              placeholder={t('Cari Invoice, deskripsi, customer, no. jurnal...')}
              className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground w-full sm:w-72"
            />
            <select
              value={branchFilter}
              onChange={(e) => { setBranchFilter(e.target.value); setTablePage(1); }}
              className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
            >
              <option value="all">{t('All Branches')}</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1300px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Date', 'Invoice', 'Customer', 'Cabang', 'DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding', 'Due Date', 'Journal', 'Status'].map((h) => (
                    <th key={h} className={thClass}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {pagedRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors text-xs">
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{formatTanggalSingkat(r.invoice_date)}</td>
                    <td className="py-2.5 px-2 font-mono text-teal-600 whitespace-nowrap">{r.invoice_no}</td>
                    <td className="py-2.5 px-2 font-medium text-foreground whitespace-nowrap">{r.customer_name}</td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{r.cabang || '—'}</td>
                    <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">{formatIDR(num(r.dpp))}</td>
                    <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">{formatIDR(num(r.ppn))}</td>
                    <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">{formatIDR(num(r.pph))}</td>
                    <td className="py-2.5 px-2 text-right font-mono font-semibold whitespace-nowrap">{formatIDR(num(r.gross_amount))}</td>
                    <td className="py-2.5 px-2 text-right font-mono whitespace-nowrap">{formatIDR(num(r.paid_amount))}</td>
                    <td className={`py-2.5 px-2 text-right font-mono whitespace-nowrap ${isPosted(r) && num(r.outstanding_amount) > 0 ? 'text-amber-600 font-semibold' : ''}`}>{formatIDR(num(r.outstanding_amount))}</td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{r.due_date ? formatTanggalSingkat(r.due_date) : '—'}</td>
                    <td className="py-2.5 px-2 font-mono text-muted-foreground whitespace-nowrap">{r.journal_entry_id ? `JE-${r.journal_entry_id}` : '—'}</td>
                    <td className="py-2.5 px-2 whitespace-nowrap"><StatusBadge variant={statusVariant[r.posting_status] || 'neutral'} label={t(r.posting_status)} dot /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {tableRows.length === 0
                ? t('Menampilkan 0 dari 0 transaksi')
                : `${t('Menampilkan')} ${(tablePageSafe - 1) * TABLE_PAGE_SIZE + 1} - ${Math.min(tablePageSafe * TABLE_PAGE_SIZE, tableRows.length)} ${t('dari')} ${tableRows.length} ${t('transaksi')}`}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setTablePage(tablePageSafe - 1)} disabled={tablePageSafe <= 1} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} />
              </button>
              <span>{tablePageSafe} / {tableTotalPages}</span>
              <button onClick={() => setTablePage(tablePageSafe + 1)} disabled={tablePageSafe >= tableTotalPages} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
