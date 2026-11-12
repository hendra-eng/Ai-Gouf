'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Check, Search, ShoppingCart, FileText, Calculator, Clock, CheckCircle, Scale, Percent, Landmark, CreditCard, Banknote, AlertTriangle } from 'lucide-react';
import { formatIDR, CHART_COLORS } from '../../lib/groupAnalytics';
import { AreaChart, Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import { useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesInvoices, formatTanggalSingkat, type BackendSalesInvoice } from '@/lib/salesStore';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Financial
// Overview / Balance Sheet): width YAxis (65) + margin.left AreaChart (10). ──
const SALES_AXIS_WIDTH = 65;
const SALES_AXIS_OVERLAY_WIDTH = SALES_AXIS_WIDTH + 10;
const SALES_SPRING_MS = 380;
const salesEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// Kartu KPI Overview -- desain sama dengan kartu KPI di tab Source Data, Sales
// Transaction & Posted (garis aksen atas, gradasi hijau lembut, kilau di sudut,
// ikon, bar proporsi). Nada hijau brand; 'warn'/'danger' hanya dipakai saat ada
// peringatan (belum diposting, piutang, jatuh tempo).
type KpiTone = 'slate' | 'amber' | 'green' | 'sky' | 'warn' | 'danger';
const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string; glow: string; border: string }> = {
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]', glow: 'bg-[#6EE7B7]', border: 'border-primary/60' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]', glow: 'bg-[#22C55E]', border: 'border-primary/60' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]', glow: 'bg-[#0F7D4E]', border: 'border-primary/60' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]', glow: 'bg-[#0B5E5C]', border: 'border-primary/60' },
  warn: { strip: 'bg-[#F59E0B]', iconBg: 'bg-[#FEF3C7]', iconText: 'text-[#B45309]', bar: 'bg-[#F59E0B]', glow: 'bg-[#F59E0B]', border: 'border-amber-300' },
  danger: { strip: 'bg-[#EF4444]', iconBg: 'bg-[#FEE2E2]', iconText: 'text-[#DC2626]', bar: 'bg-[#EF4444]', glow: 'bg-[#EF4444]', border: 'border-red-300' },
};

function OverviewKpiTile({ label, value, sub, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className={`relative overflow-hidden rounded-[10px] border ${c.border} bg-gradient-to-br from-white via-white to-[#F0FDF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <span className={`pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full opacity-[0.12] blur-xl ${c.glow}`} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-extrabold uppercase tracking-wide text-slate-700" title={label}>{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-white ${c.iconBg}`}>
          <Icon size={16} className={c.iconText} />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-extrabold tabular-nums text-[#064E3B]" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-semibold text-slate-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-slate-600">{p}% {pctLabel}</p>
    </div>
  );
}

const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

// Dropdown filter kustom -- sama dengan FilterSelect di tab Sales Transaction
// & Posted: selalu terbuka ke bawah, bisa di-scroll, hover/terpilih hijau brand.
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[#6EE7B7] hover:text-[#064E3B] ${selected ? 'bg-[#D1FAE5] font-semibold text-[#065F46]' : 'text-foreground'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

const STATUS_PILL: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  negative: 'bg-red-100 text-red-700',
  neutral: 'bg-muted text-muted-foreground',
};
const STATUS_DOT: Record<string, string> = {
  positive: 'bg-emerald-500', info: 'bg-blue-500', warning: 'bg-amber-500', negative: 'bg-red-500', neutral: 'bg-slate-400',
};
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

// Garis yang bisa ditarik: 'total' (mode Actual) atau 'thisYear'/'lastYear' (mode Previous Year).
type SalesLineKey = 'total' | 'thisYear' | 'lastYear';
type SalesPeriod = '6M' | 'YTD' | '12M' | '3Y';
type SalesViewMode = 'Actual' | 'Previous Year';
const SALES_PERIODS: SalesPeriod[] = ['6M', 'YTD', '12M', '3Y'];
const SALES_VIEW_MODES: SalesViewMode[] = ['Actual', 'Previous Year'];

interface SalesDragPreview {
  key: SalesLineKey;
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
  payload?: { value: number; name: string; color?: string; stroke?: string; dataKey?: string }[];
  label?: string;
  dragPreview?: SalesDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1.5">{label}</p>
      {payload.map((p, i) => {
        const isDragged = !!dragPreview && dragPreview.key === p.dataKey;
        const value = isDragged ? dragPreview!.value : p.value;
        return (
          <div key={`sales-tt-${i}`} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <span className="text-slate-500">{p.name}:</span>
            <span className="font-semibold text-slate-800">
              {isDragged ? 'Estimated · ' : ''}
              {formatIDR(value)}
            </span>
          </div>
        );
      })}
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

const NUMERIC_COLS = ['DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding'];

// Tab "Overview" halaman Transactions > Sales. Seluruh angkanya dihitung dari
// invoice di financial_transaction_sales_invoices (useSalesInvoices, sumber
// yang SAMA dengan tab Sales Transaction / Journal Preview / Posted) --
// bukan lagi dari TransactionsContext (pipeline jurnal-posting lama Agent AI).
// Jadi invoice hasil "Create Invoice" dari Source Data maupun input manual di
// Sales Transaction langsung tampil di sini.
//
// clientId = company aktif (Switch Company), sama seperti tab Sales lainnya & Purchase --
// invoices.client_id mengacu ke management_clients (company), bukan ke akun user yang login.
//
// Definisi angka:
//  - Total Sales / Invoices / DPP / VAT / PPh : SEMUA invoice (Draft s/d Paid),
//    supaya invoice yang baru diimport langsung terlihat.
//  - Posted / Reconciliation                  : hanya invoice berstatus Posted/Partial/Paid.
//  - Paid / Accounts Receivable / Overdue     : hanya invoice yang sudah diposting
//    (piutang baru sah setelah diposting; sama dengan kolom AR di tab Posted).
export default function SalesOverview() {
  const { t } = useLanguage();
  const { activeClientId, activeClientName } = useActiveClient();
  const clientId = activeClientId ?? null;
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

  // ── Tren bulanan (berdasarkan invoice_date) -- sama seperti chart Financial
  // Overview: filter periode 6M / YTD / 12M / 3Y, ujung PALING KANAN selalu
  // bulan berjalan (dari jam sistem), plus mode Actual vs Previous Year. ──
  const [period, setPeriod] = useState<SalesPeriod>('YTD');
  const [viewMode, setViewMode] = useState<SalesViewMode>('Actual');

  const now = new Date();
  const anchorYear = now.getFullYear();
  const anchorMonthIdx = now.getMonth(); // 0 = Jan
  const anchorAbs = anchorYear * 12 + anchorMonthIdx;

  // Total & jumlah invoice per bulan absolut (tahun * 12 + indeks bulan).
  const monthlyTotals = useMemo(() => {
    const map = new Map<number, { total: number; count: number }>();
    invoices.forEach((i) => {
      const y = yearOf(i.invoice_date);
      const m = Number((i.invoice_date || '').slice(5, 7)) - 1;
      if (!y || m < 0 || m > 11) return;
      const key = y * 12 + m;
      const cur = map.get(key) ?? { total: 0, count: 0 };
      cur.total += num(i.gross_amount);
      cur.count += 1;
      map.set(key, cur);
    });
    return map;
  }, [invoices]);

  // Mode Actual: deret kronologis dipotong sesuai periode. Kalau rentang
  // melewati beberapa tahun, label bulan diberi akhiran tahun (mis. Jan '25).
  const trend = useMemo(() => {
    const windowSize = period === '6M' ? 6 : period === '12M' ? 12 : period === '3Y' ? 36 : null; // null = YTD
    const lowerBound = windowSize ? anchorAbs - (windowSize - 1) : anchorYear * 12; // YTD: dari Jan tahun ini
    const rows: { year: number; mon: string; total: number; count: number }[] = [];
    for (let abs = lowerBound; abs <= anchorAbs; abs++) {
      const v = monthlyTotals.get(abs);
      rows.push({ year: Math.floor(abs / 12), mon: MONTH_LABELS[abs % 12], total: v?.total ?? 0, count: v?.count ?? 0 });
    }
    const spansMultipleYears = rows.some((r) => r.year !== rows[0].year);
    return rows.map((r) => ({
      month: spansMultipleYears ? `${r.mon} '${String(r.year).slice(-2)}` : r.mon,
      total: r.total,
      count: r.count,
    }));
  }, [monthlyTotals, period, anchorAbs, anchorYear]);

  // Mode Previous Year: penjualan bulanan tahun berjalan vs tahun lalu,
  // sejajar per nama bulan, dari Jan sampai bulan berjalan.
  const yoyTrend = useMemo(() => {
    const rows: { month: string; thisYear: number; lastYear: number }[] = [];
    for (let m = 0; m <= anchorMonthIdx; m++) {
      rows.push({
        month: MONTH_LABELS[m],
        thisYear: monthlyTotals.get(anchorYear * 12 + m)?.total ?? 0,
        lastYear: monthlyTotals.get((anchorYear - 1) * 12 + m)?.total ?? 0,
      });
    }
    return rows;
  }, [monthlyTotals, anchorYear, anchorMonthIdx]);

  const hasChartData = viewMode === 'Previous Year'
    ? yoyTrend.some((d) => d.thisYear > 0 || d.lastYear > 0)
    : trend.some((d) => d.total > 0);

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
  const [tablePageSize, setTablePageSize] = useState(10);
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
  const tableTotalPages = Math.max(1, Math.ceil(tableRows.length / tablePageSize));
  const tablePageSafe = Math.min(tablePage, tableTotalPages);
  const pagedRows = tableRows.slice((tablePageSafe - 1) * tablePageSize, tablePageSafe * tablePageSize);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // Financial Overview / Balance Sheet. ──
  const salesBaseMax = useMemo(() => {
    const maxVal = viewMode === 'Previous Year'
      ? Math.max(0, ...yoyTrend.map((d) => Math.max(d.thisYear, d.lastYear)))
      : Math.max(0, ...trend.map((d) => d.total));
    return Math.max(1, maxVal) * 1.08;
  }, [trend, yoyTrend, viewMode]);
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
  const salesDotsRef = useRef<Record<SalesLineKey, { value: number; cy: number }[]>>({ total: [], thisYear: [], lastYear: [] });
  const [salesDragPreview, setSalesDragPreview] = useState<SalesDragPreview | null>(null);
  const salesDragStateRef = useRef<{
    key: SalesLineKey;
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

  // Reset drag kalau data / periode / mode berganti (index bulan & kalibrasi piksel tidak relevan lagi).
  useEffect(() => {
    stopSalesSpring();
    salesDragStateRef.current = null;
    setSalesDragPreview(null);
    salesDotsRef.current = { total: [], thisYear: [], lastYear: [] };
  }, [trend, yoyTrend, period, viewMode]);

  useEffect(() => stopSalesSpring, []);

  const springBackSales = useCallback(() => {
    const drag = salesDragStateRef.current;
    if (!drag) return;
    stopSalesSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { key, index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SALES_SPRING_MS);
      const eased = salesEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (salesDragStateRef.current) salesDragStateRef.current.currentValue = next;
      setSalesDragPreview({ key, index, value: next });
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

  const handleSalesDotPointerDown = useCallback((e: React.PointerEvent, key: SalesLineKey, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSalesSpring();

    const samples = salesDotsRef.current[key].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
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
      key,
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setSalesDragPreview({ key, index, value: originalValue });
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
      setSalesDragPreview({ key: drag.key, index: drag.index, value });
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
    return trend.map((d, i) => (i === salesDragPreview.index ? { ...d, [salesDragPreview.key]: salesDragPreview.value } : d));
  }, [trend, salesDragPreview]);

  const salesDisplayYoy = useMemo(() => {
    if (!salesDragPreview) return yoyTrend;
    return yoyTrend.map((d, i) => (i === salesDragPreview.index ? { ...d, [salesDragPreview.key]: salesDragPreview.value } : d));
  }, [yoyTrend, salesDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderSalesCalibrationDot = (key: SalesLineKey) => function SalesCalibrationDot(props: any) {
    const { cx, cy, index, payload } = props;
    salesDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`sales-cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderSalesActiveDot = (key: SalesLineKey, color: string) => function SalesActiveDot(props: any) {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = salesDragPreview?.key === key && salesDragPreview?.index === index;
    return (
      <g key={`sales-pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleSalesDotPointerDown(e, key, index, payload[key])}
        />
      </g>
    );
  };


  return (
    <div className="space-y-6">
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

      {/* KPI Cards -- desain sama dengan KPI di tab lain */}
      {(() => {
        const maxGross = invoices.reduce((m, i) => Math.max(m, num(i.gross_amount)), 0);
        const label = (txt: string) => (
          <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
            <span className="h-3.5 w-1 rounded-full bg-[#0F7D4E]" />{txt}
          </p>
        );
        return (
          <>
            <div>
              {label(t('Performa Penjualan'))}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                <OverviewKpiTile
                  label={t('Total Sales')} value={formatIDR(grossSales)} tone="green" icon={ShoppingCart}
                  sub={txCount > 0 ? `${formatIDR(postedTotal, true)} ${t('posted')}` : undefined}
                  pct={pctOf(postedTotal, grossSales)} pctLabel={t('of sales posted')}
                />
                <OverviewKpiTile
                  label={t('Number of Transactions')} value={String(txCount)} tone="slate" icon={FileText}
                  sub={`${postedInvoices.length} ${t('posted')}`}
                  pct={pctOf(postedInvoices.length, txCount)} pctLabel={t('of transactions posted')}
                />
                <OverviewKpiTile
                  label={t('Average per Transaction')} value={formatIDR(avgTxValue)} tone="sky" icon={Calculator}
                  sub={maxGross > 0 ? `${t('Largest')} ${formatIDR(maxGross, true)}` : undefined}
                  pct={pctOf(avgTxValue, maxGross)} pctLabel={t('of largest invoice')}
                />
                <OverviewKpiTile
                  label={t('Not Posted')} value={String(pendingCount)} tone={pendingCount > 0 ? 'warn' : 'amber'} icon={Clock}
                  sub={pendingCount > 0 ? `${t('Worth')} ${formatIDR(pendingTotal, true)}` : undefined}
                  pct={pctOf(pendingCount, txCount)} pctLabel={t('of all transactions')}
                />
                <OverviewKpiTile
                  label={t('Reconciliation')} value={`${reconciledPct.toFixed(0)}%`} tone="green" icon={CheckCircle}
                  sub={`${reconciledCount} / ${postedInvoices.length} ${t('posted')}`}
                  pct={reconciledPct} pctLabel={t('of posted reconciled')}
                />
              </div>
            </div>

            <div>
              {label(t('Pajak & Piutang'))}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <OverviewKpiTile
                  label={t('Total Tax Base (DPP)')} value={formatIDR(totalDPP)} tone="slate" icon={Scale}
                  pct={pctOf(totalDPP, grossSales)} pctLabel={t('of total sales')}
                />
                <OverviewKpiTile
                  label={t('VAT Output')} value={formatIDR(totalPPN)} tone="amber" icon={Percent}
                  pct={pctOf(totalPPN, totalDPP)} pctLabel={t('of tax base')}
                />
                <OverviewKpiTile
                  label={t('Total Withholding Tax (PPh)')} value={formatIDR(totalPPh)} tone="sky" icon={Landmark}
                  pct={pctOf(totalPPh, totalDPP)} pctLabel={t('of tax base')}
                />
                <OverviewKpiTile
                  label={t('Paid')} value={formatIDR(totalPaid)} tone="green" icon={CreditCard}
                  pct={pctOf(totalPaid, postedTotal)} pctLabel={t('of posted sales')}
                />
                <OverviewKpiTile
                  label={t('Accounts Receivable')} value={formatIDR(totalOutstanding)} tone={totalOutstanding > 0 ? 'warn' : 'amber'} icon={Banknote}
                  pct={pctOf(totalOutstanding, postedTotal)} pctLabel={t('of posted sales')}
                />
                <OverviewKpiTile
                  label={t('Overdue Invoices')} value={String(overdue.count)} tone={overdue.count > 0 ? 'danger' : 'sky'} icon={AlertTriangle}
                  sub={overdue.count > 0 ? `${t('Worth')} ${formatIDR(overdue.total, true)}` : undefined}
                  pct={pctOf(overdue.count, postedInvoices.length)} pctLabel={t('of posted invoices')}
                />
              </div>
            </div>
          </>
        );
      })()}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('Tren Sales Bulanan')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[
                  activeClientName,
                  viewMode === 'Previous Year'
                    ? `${anchorYear - 1} vs ${anchorYear}`
                    : trend.length > 1 ? `${trend[0].month} – ${trend[trend.length - 1].month}` : trend[0]?.month,
                  t('Based on invoice date, gross amount'),
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex gap-1">
                {SALES_VIEW_MODES.map((m) => (
                  <button
                    key={`sales-mode-${m}`}
                    onClick={() => setViewMode(m)}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                      viewMode === m ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {t(m)}
                  </button>
                ))}
              </div>
              {viewMode === 'Actual' && (
                <div className="flex gap-1">
                  {SALES_PERIODS.map((p) => (
                    <button
                      key={`sales-period-${p}`}
                      onClick={() => setPeriod(p)}
                      className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                        period === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {!hasChartData ? (
            <p className="text-xs text-muted-foreground py-10 text-center">
              {loading ? t('Loading...') : invoices.length > 0 ? t('No sales invoices in this period — try a longer period.') : t('No sales invoices to display yet.')}
            </p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={340}>
                {viewMode === 'Previous Year' ? (
                  <ComposedChart data={salesDisplayYoy} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
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
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => t(v as string)} />
                    <Line
                      type="monotone"
                      dataKey="thisYear"
                      name={t('Tahun Ini')}
                      stroke="#0F7D4E"
                      strokeWidth={2.5}
                      dot={renderSalesCalibrationDot('thisYear') as any}
                      activeDot={renderSalesActiveDot('thisYear', '#0F7D4E') as any}
                      isAnimationActive={!salesDragPreview}
                    />
                    <Line
                      type="monotone"
                      dataKey="lastYear"
                      name={t('Tahun Lalu')}
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      dot={renderSalesCalibrationDot('lastYear') as any}
                      activeDot={renderSalesActiveDot('lastYear', '#94a3b8') as any}
                      isAnimationActive={!salesDragPreview}
                    />
                  </ComposedChart>
                ) : (
                  <AreaChart data={salesDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSalesMain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0F7D4E" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#0F7D4E" stopOpacity={0} />
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
                      stroke="#0F7D4E"
                      strokeWidth={2.5}
                      fill="url(#gradSalesMain)"
                      dot={renderSalesCalibrationDot('total') as any}
                      activeDot={renderSalesActiveDot('total', '#0F7D4E') as any}
                      isAnimationActive={!salesDragPreview}
                    />
                  </AreaChart>
                )}
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

        <div className="space-y-4">
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

        {/* Top Customers */}
        <div className="card-elevated-md rounded-xl p-5">
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
                  <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-primary ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
        </div>
      </div>

      {/* Tabel invoice Sales (read-only ringkasan -- edit/approve/posting ada di tab Sales Transaction) */}
      {invoices.length === 0 ? (
        <div className="card p-8 text-center text-xs text-muted-foreground">
          {loading ? t('Loading...') : t('No sales invoices yet. Upload a file in Source Data and create invoices, or add one in Sales Transaction.')}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border">
            <h3 className="text-2xl font-bold text-foreground">{t('Daftar Invoice Penjualan')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tableRows.length === 0
                ? t('Menampilkan 0 dari 0 transaksi')
                : `${t('Menampilkan')} ${(tablePageSafe - 1) * tablePageSize + 1} - ${Math.min(tablePageSafe * tablePageSize, tableRows.length)} ${t('dari')} ${tableRows.length} ${t('transaksi')}`}
            </p>
          </div>

          {/* Filter -- desain sama dengan filter di Sales Transaction */}
          <div className="py-3 flex flex-wrap items-center gap-2 border-b border-border">
            <FilterSelect
              value={branchFilter}
              onChange={(v) => { setBranchFilter(v); setTablePage(1); }}
              options={[{ value: 'all', label: t('All Branches') }, ...branches.map((b) => ({ value: b, label: b }))]}
            />
            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setTablePage(1); }}
                placeholder={t('Cari Invoice, deskripsi, customer, no. jurnal...')}
                className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1300px] select-text">
              <thead>
                <tr className="bg-[#8FE3B5]">
                  {['Date', 'Invoice', 'Customer', 'Cabang', 'DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding', 'Due Date', 'Journal', 'Status'].map((h) => (
                    <th key={h} className={`py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32] ${NUMERIC_COLS.includes(h) ? 'text-right' : 'text-left'}`}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {pagedRows.map((r) => {
                  const variant = statusVariant[r.posting_status] || 'neutral';
                  const money = (v: unknown, extra = '') => (
                    <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap ${num(v) < 0 ? 'text-red-600' : ''} ${extra}`}>{formatIDR(num(v))}</td>
                  );
                  return (
                    <tr key={r.id} className="border-b border-slate-300/70 hover:bg-slate-200/70 transition-colors text-xs">
                      <td className="py-2 px-2 text-foreground whitespace-nowrap">{formatTanggalSingkat(r.invoice_date)}</td>
                      <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{r.invoice_no}</td>
                      <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap">{r.customer_name}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.cabang || '—'}</td>
                      {money(r.dpp)}
                      {money(r.ppn)}
                      {money(r.pph)}
                      {money(r.gross_amount, 'font-semibold')}
                      {money(r.paid_amount)}
                      {money(r.outstanding_amount, isPosted(r) && num(r.outstanding_amount) > 0 ? '!text-amber-600 font-semibold' : '')}
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.due_date ? formatTanggalSingkat(r.due_date) : '—'}</td>
                      <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{r.journal_entry_id ? `JE-${r.journal_entry_id}` : '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[variant]}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[variant]}`} />{t(r.posting_status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={tablePageSize} onChange={(e) => { setTablePageSize(Number(e.target.value)); setTablePage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {tableRows.length === 0 ? 0 : (tablePageSafe - 1) * tablePageSize + 1}–{Math.min(tablePageSafe * tablePageSize, tableRows.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-foreground">{tableRows.length}</span> {t('transaksi')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setTablePage(tablePageSafe - 1)} disabled={tablePageSafe <= 1} aria-label={t('Halaman sebelumnya')} className={NAV_BTN}><ChevronLeft size={16} /></button>
              {buildPageItems(tablePageSafe, tableTotalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => setTablePage(p)} aria-current={p === tablePageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === tablePageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => setTablePage(tablePageSafe + 1)} disabled={tablePageSafe >= tableTotalPages} aria-label={t('Halaman berikutnya')} className={NAV_BTN}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}