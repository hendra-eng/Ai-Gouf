'use client';

import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import KPICard from '@/components/financial/KPICard';
import AIInsightsPanel from '@/components/financial/AIInsightsPanel';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import {
  REVENUE_BY_CUSTOMER, BUDGET_VS_ACTUAL, PL_AI_INSIGHTS,
} from '@/lib/financialData';
// [BARU] Angka P&L (PL_CORE, MARGINS, MONTHLY_PL, REVENUE_BY_CATEGORY,
// EXPENSE_BREAKDOWN) & nama/periode perusahaan sekarang REAL -- diambil
// dari client aktif lewat useProfitLossData() (lihat lib/useProfitLossData.ts
// utk detail sumber & keterbatasannya). REVENUE_BY_CUSTOMER/BUDGET_VS_ACTUAL/
// PL_AI_INSIGHTS di atas TETAP data contoh (financialData.tsx) -- belum ada
// sumber data backend utk itu.
import { useProfitLossData, type MonthlyPLRow } from '../lib/useProfitLossData';
import { useCurrency, formatMoney } from '@/lib/currency';
import {
  ChevronDownIcon, ChevronRightIcon, FunnelIcon,
  ArrowDownTrayIcon, CalendarIcon, BuildingOfficeIcon,
  ChevronUpDownIcon, ChevronUpIcon, ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';

// ─── CSV helper ───────────────────────────────────────────────────────────────
function downloadCsv(rows: Record<string, string | number>[], filename: string) {
  if (rows.length === 0) return;
  const header = Object.keys(rows[0]);
  const csvRows = rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [header.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Maps table header labels to MONTHLY_PL row keys for sorting
const MONTHLY_COL_KEY: Record<string, string> = {
  Month: 'month',
  Revenue: 'revenue',
  COGS: 'cogs',
  'Gross Profit': 'grossProfit',
  'GM%': 'grossMargin',
  OpEx: 'opEx',
  EBITDA: 'ebitda',
  'D&A': 'da',
  EBIT: 'ebit',
  Interest: 'interest',
  Tax: 'tax',
  'Net Profit': 'netProfit',
  'NM%': 'netMargin',
};

// ─── Waterfall Chart Data ───────────────────────────────────────────────────
// [BARU] Sekarang diturunkan dari PL_CORE ASLI (lihat pemanggilan
// buildWaterfallBars(PL_CORE) di komponen ProfitLossPage), bukan array
// hardcoded lagi -- supaya chart ini otomatis ikut angka client aktif.
function buatWaterfallData(pl: { revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; ebitda: number; da: number; ebit: number; interestExpense: number; ebt: number; incomeTax: number; netProfit: number }) {
  return [
    { name: 'Revenue', value: pl.revenue, type: 'total', color: '#0d9488' },
    { name: 'COGS', value: -pl.cogs, type: 'decrease', color: '#ef4444' },
    { name: 'Gross Profit', value: pl.grossProfit, type: 'subtotal', color: '#0d9488' },
    { name: 'OpEx', value: -pl.operatingExpenses, type: 'decrease', color: '#f97316' },
    { name: 'EBITDA', value: pl.ebitda, type: 'subtotal', color: '#0d9488' },
    { name: 'D&A', value: -pl.da, type: 'decrease', color: '#f97316' },
    { name: 'EBIT', value: pl.ebit, type: 'subtotal', color: '#0d9488' },
    { name: 'Interest', value: -pl.interestExpense, type: 'decrease', color: '#f97316' },
    { name: 'EBT', value: pl.ebt, type: 'subtotal', color: '#0d9488' },
    { name: 'Tax', value: -pl.incomeTax, type: 'decrease', color: '#ef4444' },
    { name: 'Net Profit', value: pl.netProfit, type: 'total', color: '#059669' },
  ];
}

// Build waterfall bars with base (invisible) + value
function buildWaterfallBars(pl: Parameters<typeof buatWaterfallData>[0]) {
  const waterfallData = buatWaterfallData(pl);
  let running = 0;
  return waterfallData.map(d => {
    if (d.type === 'total' || d.type === 'subtotal') {
      const base = 0;
      running = d.value;
      return { ...d, base, bar: d.value };
    } else {
      const base = running + d.value;
      running = running + d.value;
      return { ...d, base, bar: Math.abs(d.value) };
    }
  });
}

// ─── Custom Tooltip ─────────────────────────────────────────────────────────
const ProfitTooltip = ({ active, payload, label }: any) => {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const grossMargin = d.revenue ? ((d.grossProfit / d.revenue) * 100).toFixed(1) : 0;
  const netMargin = d.revenue ? ((d.netProfit / d.revenue) * 100).toFixed(1) : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 text-xs min-w-[200px]">
      <p className="font-semibold text-slate-800 mb-2 text-sm">{label}</p>
      {[
        { label: 'Revenue', val: d.revenue, color: '#0d9488' },
        { label: 'COGS', val: d.cogs, color: '#ef4444' },
        { label: 'Gross Profit', val: d.grossProfit, color: '#10b981' },
        { label: 'Operating Expenses', val: d.opEx, color: '#f97316' },
        { label: 'EBITDA', val: d.ebitda, color: '#6366f1' },
        { label: 'Net Profit', val: d.netProfit, color: '#059669' },
      ].map(r => (
        <div key={r.label} className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-500 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-semibold text-slate-800">{fx(r.val)}</span>
        </div>
      ))}
      <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between">
        <span className="text-slate-500">Gross Margin</span>
        <span className="font-semibold text-teal-600">{grossMargin}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">Net Margin</span>
        <span className="font-semibold text-emerald-600">{netMargin}%</span>
      </div>
    </div>
  );
};

// ─── Margin Card ─────────────────────────────────────────────────────────────
function MarginCard({ label, value, prev, change, benchmark }: {
  label: string; value: number; prev: number; change: number; benchmark: number;
}) {
  const isPos = change >= 0;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">{label}</p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isPos ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {isPos ? '+' : ''}{change.toFixed(1)}pp
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-900 mb-3">{value.toFixed(1)}%</p>
      <div className="relative h-2 bg-slate-100 rounded-full mb-3">
        <div
          className="absolute left-0 top-0 h-2 rounded-full bg-teal-500 transition-all duration-700"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
        <div
          className="absolute top-0 h-2 w-0.5 bg-slate-400 rounded-full"
          style={{ left: `${Math.min(benchmark, 100)}%` }}
          title={`Benchmark: ${benchmark}%`}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Prev: {prev.toFixed(1)}%</span>
        <span>Benchmark: {benchmark.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Monthly Table Row ────────────────────────────────────────────────────────
function MonthlyRow({
  row, expanded, onToggle, revenueByCategory, expenseBreakdown,
}: {
  row: MonthlyPLRow & { grossMargin: number; netMargin: number };
  expanded: boolean;
  onToggle: () => void;
  revenueByCategory: { name: string; pct: number }[];
  expenseBreakdown: { name: string; pct: number }[];
}) {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const gm = row.revenue ? ((row.grossProfit / row.revenue) * 100).toFixed(1) : '0.0';
  const nm = row.revenue ? ((row.netProfit / row.revenue) * 100).toFixed(1) : '0.0';
  return (
    <>
      <tr
        className="hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-sm font-medium text-slate-700 flex items-center gap-2">
          {expanded ? <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400" />}
          {row.month} 2026
        </td>
        <td className="px-4 py-3 text-sm text-right font-medium text-slate-800">{fx(row.revenue)}</td>
        <td className="px-4 py-3 text-sm text-right text-slate-600">{fx(row.cogs)}</td>
        <td className="px-4 py-3 text-sm text-right text-emerald-700 font-medium">{fx(row.grossProfit)}</td>
        <td className="px-4 py-3 text-sm text-right">
          <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-semibold">{gm}%</span>
        </td>
        <td className="px-4 py-3 text-sm text-right text-slate-600">{fx(row.opEx)}</td>
        <td className="px-4 py-3 text-sm text-right text-indigo-700 font-medium">{fx(row.ebitda)}</td>
        <td className="px-4 py-3 text-sm text-right text-slate-500">{fx(row.da)}</td>
        <td className="px-4 py-3 text-sm text-right text-slate-700">{fx(row.ebit)}</td>
        <td className="px-4 py-3 text-sm text-right text-slate-500">{fx(row.interest)}</td>
        <td className="px-4 py-3 text-sm text-right text-red-600">({fx(row.tax)})</td>
        <td className="px-4 py-3 text-sm text-right font-bold text-teal-700">{fx(row.netProfit)}</td>
        <td className="px-4 py-3 text-sm text-right">
          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs font-semibold">{nm}%</span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/80">
          <td colSpan={13} className="px-8 py-3">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="font-semibold text-slate-600 mb-1.5">Revenue Breakdown</p>
                {revenueByCategory.slice(0, 3).map(r => (
                  <div key={r.name} className="flex justify-between py-0.5">
                    <span className="text-slate-500">{r.name}</span>
                    <span className="font-medium text-slate-700">{fx(Math.round(row.revenue * r.pct / 100))}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5">Expense Breakdown</p>
                {expenseBreakdown.slice(0, 3).map(e => (
                  <div key={e.name} className="flex justify-between py-0.5">
                    <span className="text-slate-500">{e.name}</span>
                    <span className="font-medium text-slate-700">{fx(Math.round(row.opEx * e.pct / 100))}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5">Key Metrics</p>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Gross Margin</span>
                  <span className="font-medium text-emerald-600">{gm}%</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Net Margin</span>
                  <span className="font-medium text-teal-600">{nm}%</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">EBITDA Margin</span>
                  <span className="font-medium text-indigo-600">{(row.revenue ? (row.ebitda / row.revenue) * 100 : 0).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Revenue Breakdown Tabs ──────────────────────────────────────────────────
const DONUT_COLORS = ['#0d9488', '#6366f1', '#f97316', '#10b981', '#3b82f6', '#8b5cf6'];

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function ProfitLossPage() {
  const {
    loading, isSampleData, companyName, periodLabel,
    PL_CORE, MARGINS, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN,
  } = useProfitLossData();
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const [chartRange, setChartRange] = useState<'6M' | 'YTD' | '12M'>('YTD');
  const [revenueTab, setRevenueTab] = useState<'category' | 'customer'>('category');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedWaterfall, setSelectedWaterfall] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);
  const [monthlySortCol, setMonthlySortCol] = useState<string>('month');
  const [monthlySortDir, setMonthlySortDir] = useState<'asc' | 'desc'>('asc');
  const [monthlyFilter, setMonthlyFilter] = useState<'all' | 'strong'>('all');

  const toggleMonth = (m: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  };

  function handleViewModeChange(mode: 'Actual' | 'Budget' | 'Previous Year') {
    setViewMode(mode);
    if (mode === 'Budget') {
      document.getElementById('pl-budget-vs-actual')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (mode === 'Previous Year') {
      toast.info('Perbandingan Tahun Sebelumnya', { description: 'Perubahan YoY sudah ditampilkan pada tiap kartu KPI di atas.' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleExport() {
    const rows = [
      { Item: 'Revenue', Amount: PL_CORE.revenue },
      { Item: 'COGS', Amount: PL_CORE.cogs },
      { Item: 'Gross Profit', Amount: PL_CORE.grossProfit },
      { Item: 'Operating Expenses', Amount: PL_CORE.operatingExpenses },
      { Item: 'EBITDA', Amount: PL_CORE.ebitda },
      { Item: 'D&A', Amount: PL_CORE.da },
      { Item: 'EBIT', Amount: PL_CORE.ebit },
      { Item: 'Interest Expense', Amount: PL_CORE.interestExpense },
      { Item: 'Income Tax', Amount: PL_CORE.incomeTax },
      { Item: 'Net Profit', Amount: PL_CORE.netProfit },
      { Item: 'Gross Margin %', Amount: MARGINS.grossMargin },
      { Item: 'Net Margin %', Amount: MARGINS.netMargin },
    ];
    downloadCsv(rows, `profit-loss-${companyName.replace(/\s+/g, '-')}-${Date.now()}.csv`);
    toast.success('Export berhasil', { description: 'Profit & Loss Statement diunduh sebagai CSV.' });
  }

  function toggleMonthlySort(col: string | null) {
    if (!col) return;
    if (monthlySortCol === col) setMonthlySortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setMonthlySortCol(col); setMonthlySortDir('asc'); }
  }

  const enrichedMonthlyPL = MONTHLY_PL.map(row => ({
    ...row,
    grossMargin: row.revenue ? (row.grossProfit / row.revenue) * 100 : 0,
    netMargin: row.revenue ? (row.netProfit / row.revenue) * 100 : 0,
  }));

  const avgNetMargin = enrichedMonthlyPL.length
    ? enrichedMonthlyPL.reduce((s, r) => s + r.netMargin, 0) / enrichedMonthlyPL.length
    : 0;

  const sortedMonthlyPL = [...enrichedMonthlyPL]
    .filter(row => (monthlyFilter === 'strong' ? row.netMargin >= avgNetMargin : true))
    .sort((a, b) => {
      const va = (a as any)[monthlySortCol];
      const vb = (b as any)[monthlySortCol];
      if (typeof va === 'string') {
        return monthlySortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return monthlySortDir === 'asc' ? va - vb : vb - va;
    });

  function toggleMonthlyFilter() {
    setMonthlyFilter(prev => {
      const next = prev === 'all' ? 'strong' : 'all';
      toast.info(next === 'strong' ? 'Menampilkan bulan performa kuat' : 'Menampilkan semua bulan', {
        description: next === 'strong' ? `Net margin ≥ rata-rata (${avgNetMargin.toFixed(1)}%)` : undefined,
      });
      return next;
    });
  }

  const chartData = MONTHLY_PL.map(d => ({
    month: d.month,
    revenue: d.revenue,
    cogs: d.cogs,
    grossProfit: d.grossProfit,
    opEx: d.opEx,
    ebitda: d.ebitda,
    da: d.da,
    ebit: d.ebit,
    interest: d.interest,
    tax: d.tax,
    netProfit: d.netProfit,
    totalExpenses: d.cogs + d.opEx,
  }));

  const sparkRevenue = MONTHLY_PL.map(d => d.revenue);
  const sparkGP = MONTHLY_PL.map(d => d.grossProfit);
  const sparkEBITDA = MONTHLY_PL.map(d => d.ebitda);
  const sparkNP = MONTHLY_PL.map(d => d.netProfit);

  // [BARU] "change"/"previousValue" tiap KPI sekarang dihitung MoM (bulan
  // terakhir vs bulan sebelumnya) dari MONTHLY_PL asli, bukan angka
  // hardcoded lagi.
  const bulanTerakhir = MONTHLY_PL[MONTHLY_PL.length - 1];
  const bulanSebelumnya = MONTHLY_PL.length > 1 ? MONTHLY_PL[MONTHLY_PL.length - 2] : undefined;
  const hitungPerubahan = (skrg: number, dulu?: number) => (dulu ? ((skrg - dulu) / Math.abs(dulu)) * 100 : 0);
  const statusDari = (v: number) => (v >= 0 ? 'positive' as const : 'negative' as const);

  const revenueData = revenueTab === 'category' ? REVENUE_BY_CATEGORY : REVENUE_BY_CUSTOMER;

  const waterfallBars = useMemo(() => buildWaterfallBars(PL_CORE), [PL_CORE]);

  // [BARU] Kolom "Budget" tetap target ilustratif (belum ada modul Budget
  // yang expose data lewat API) -- tapi kolom "Actual" & variance-nya
  // sekarang disinkronkan ke PL_CORE ASLI, supaya tidak beda dengan angka
  // Revenue/EBITDA/dst yang sudah ditampilkan di bagian lain halaman ini.
  const ACTUAL_DARI_PL_CORE: Record<string, number> = {
    Revenue: PL_CORE.revenue, COGS: PL_CORE.cogs, 'Gross Profit': PL_CORE.grossProfit,
    'Operating Expenses': PL_CORE.operatingExpenses, EBITDA: PL_CORE.ebitda, 'Net Profit': PL_CORE.netProfit,
  };
  const budgetVsActual = BUDGET_VS_ACTUAL.map(row => {
    const actual = ACTUAL_DARI_PL_CORE[row.item] ?? row.actual;
    const variance = actual - row.budget;
    const variancePct = row.budget ? (variance / Math.abs(row.budget)) * 100 : 0;
    return { ...row, actual, variance, variancePct };
  });

  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Profit & Loss</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyze revenue, expenses, profitability, and financial performance</p>
      </div>
      <div className="p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                {periodLabel}
              </span>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <BuildingOfficeIcon className="w-3.5 h-3.5" />
                {companyName}
              </span>
              {isSampleData && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                  Showing sample data
                </span>
              )}
              {loading && (
                <span className="text-xs font-medium text-slate-400">Memuat data…</span>
              )}
            </div>
            <p className="text-slate-500 text-sm">{MONTHLY_PL.length} month{MONTHLY_PL.length !== 1 ? 's' : ''} YTD</p>
          </div>
          <div className="flex items-center gap-2">
            {(['Actual', 'Budget', 'Previous Year'] as const).map(m => (
              <button
                key={m}
                onClick={() => handleViewModeChange(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  viewMode === m
                    ? 'bg-teal-500 text-white' :'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {m}
              </button>
            ))}
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        </div>

        {/* ── Profitability Snapshot ── */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-teal-500" />
            Profitability Snapshot
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard title="Revenue" value={fx(PL_CORE.revenue)} change={hitungPerubahan(bulanTerakhir?.revenue ?? 0, bulanSebelumnya?.revenue)} previousValue={fx(bulanSebelumnya?.revenue ?? 0)} sparkline={sparkRevenue} status={statusDari(hitungPerubahan(bulanTerakhir?.revenue ?? 0, bulanSebelumnya?.revenue))} />
            <KPICard title="Gross Profit" value={fx(PL_CORE.grossProfit)} change={hitungPerubahan(bulanTerakhir?.grossProfit ?? 0, bulanSebelumnya?.grossProfit)} previousValue={fx(bulanSebelumnya?.grossProfit ?? 0)} sparkline={sparkGP} status={statusDari(hitungPerubahan(bulanTerakhir?.grossProfit ?? 0, bulanSebelumnya?.grossProfit))} />
            <KPICard title="EBITDA" value={fx(PL_CORE.ebitda)} change={hitungPerubahan(bulanTerakhir?.ebitda ?? 0, bulanSebelumnya?.ebitda)} previousValue={fx(bulanSebelumnya?.ebitda ?? 0)} sparkline={sparkEBITDA} status={statusDari(hitungPerubahan(bulanTerakhir?.ebitda ?? 0, bulanSebelumnya?.ebitda))} />
            <KPICard title="EBIT" value={fx(PL_CORE.ebit)} change={hitungPerubahan(bulanTerakhir?.ebit ?? 0, bulanSebelumnya?.ebit)} previousValue={fx(bulanSebelumnya?.ebit ?? 0)} sparkline={sparkEBITDA} status={statusDari(hitungPerubahan(bulanTerakhir?.ebit ?? 0, bulanSebelumnya?.ebit))} />
            <KPICard title="Net Profit" value={fx(PL_CORE.netProfit)} change={hitungPerubahan(bulanTerakhir?.netProfit ?? 0, bulanSebelumnya?.netProfit)} previousValue={fx(bulanSebelumnya?.netProfit ?? 0)} sparkline={sparkNP} status={statusDari(hitungPerubahan(bulanTerakhir?.netProfit ?? 0, bulanSebelumnya?.netProfit))} />
            <KPICard title="Net Margin" value={`${MARGINS.netMargin}%`} change={MARGINS.netMargin - (bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin)} previousValue={`${(bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin).toFixed(1)}%`} sparkline={sparkNP.map(v => v / 10)} status={statusDari(MARGINS.netMargin - (bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin))} />
          </div>
        </div>

        {/* ── Hero Chart: Revenue vs Expenses vs Net Profit ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800">Revenue vs Expenses vs Net Profit</h3>
              <p className="text-slate-500 text-xs mt-0.5">Monthly performance trend analysis</p>
            </div>
            <div className="flex items-center gap-2">
              {(['6M', 'YTD', '12M'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    chartRange === r ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradNetProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                <Tooltip content={<ProfitTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#0d9488" strokeWidth={2.5} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="totalExpenses" name="Total Expenses" stroke="#ef4444" strokeWidth={2} fill="url(#gradExpenses)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="netProfit" name="Net Profit" stroke="#059669" strokeWidth={2.5} fill="url(#gradNetProfit)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Waterfall + Margins ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Waterfall */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Revenue to Net Profit</h3>
              <p className="text-slate-500 text-xs mt-0.5">Profitability waterfall — click any bar to drill down</p>
            </div>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={waterfallBars} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                  <Tooltip
                    formatter={(value: any, name: string, props: any) => {
                      const d = props.payload;
                      if (name === 'bar') return [fx(d.type === 'decrease' ? -d.bar : d.bar), d.name];
                      return [null, null];
                    }}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Bar dataKey="base" stackId="a" fill="transparent" />
                  <Bar
                    dataKey="bar"
                    stackId="a"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => setSelectedWaterfall(d.name)}
                  >
                    {waterfallBars.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.color}
                        opacity={selectedWaterfall && selectedWaterfall !== entry.name ? 0.4 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {selectedWaterfall && (
                <div className="mt-3 p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-teal-700 font-medium">
                    Drilling into: <strong>{selectedWaterfall}</strong>
                  </span>
                  <button onClick={() => setSelectedWaterfall(null)} className="text-xs text-teal-600 hover:text-teal-800">Clear</button>
                </div>
              )}
            </div>
          </div>

          {/* Margins */}
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3 border-b border-b-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">Profitability Margins</h3>
              <p className="text-slate-500 text-xs">vs previous period & industry benchmark</p>
            </div>
            {/* [BARU] "value" = margin ASLI dari PL_CORE/MARGINS. "prev" &
                "benchmark" tetap ilustratif -- backend belum expose margin
                periode sebelumnya / benchmark industri lewat API. */}
            <MarginCard label="Gross Margin" value={MARGINS.grossMargin} prev={MARGINS.grossMargin - 1.2} change={1.2} benchmark={42.0} />
            <MarginCard label="EBITDA Margin" value={MARGINS.ebitdaMargin} prev={MARGINS.ebitdaMargin - 0.6} change={0.6} benchmark={25.0} />
            <MarginCard label="EBIT Margin" value={MARGINS.ebitMargin} prev={MARGINS.ebitMargin - 0.7} change={0.7} benchmark={24.0} />
            <MarginCard label="Net Margin" value={MARGINS.netMargin} prev={MARGINS.netMargin - 0.4} change={0.4} benchmark={18.5} />
          </div>
        </div>

        {/* ── Revenue Breakdown + Expense Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Revenue Composition */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">Revenue Composition</h3>
                <p className="text-slate-500 text-xs mt-0.5">Total: {fx(PL_CORE.revenue)}</p>
              </div>
              <div className="flex gap-1">
                {(['category', 'customer'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setRevenueTab(t)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${
                      revenueTab === t ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    By {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={revenueData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                        {revenueData.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {revenueData.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-xs text-slate-600 flex-1 truncate">{item.name}</span>
                      <span className="text-xs font-semibold text-slate-800">{fx(item.value)}</span>
                      <span className="text-xs text-slate-400 w-10 text-right">{item.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Operating Expense Breakdown</h3>
              <p className="text-slate-500 text-xs mt-0.5">Total OpEx: {fx(PL_CORE.operatingExpenses)}</p>
            </div>
            <div className="p-5 space-y-3">
              {EXPENSE_BREAKDOWN.map((item, i) => (
                <div
                  key={item.name}
                  className="group cursor-pointer"
                  onClick={() => setSelectedExpense(prev => (prev === item.name ? null : item.name))}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium transition-colors ${selectedExpense === item.name ? 'text-teal-600' : 'text-slate-600 group-hover:text-teal-600'}`}>
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-800">{fx(item.value)}</span>
                      <span className="text-xs text-slate-400 w-8 text-right">{item.pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full transition-all duration-500 group-hover:opacity-80"
                      style={{
                        width: `${item.pct}%`,
                        background: `hsl(${160 + i * 25}, 70%, 45%)`,
                        opacity: selectedExpense && selectedExpense !== item.name ? 0.4 : 1,
                      }}
                    />
                  </div>
                  {selectedExpense === item.name && (
                    <p className="text-[11px] text-teal-600 mt-1">
                      {item.pct}% of total OpEx ({fx(PL_CORE.operatingExpenses)})
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Budget vs Actual ── */}
        <div id="pl-budget-vs-actual" className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden scroll-mt-6">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Profitability vs Budget</h3>
            <p className="text-slate-500 text-xs mt-0.5">Actual performance compared to budget targets</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Metric</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Budget</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actual</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Variance</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Var %</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {budgetVsActual.map((row, i) => {
                  const isPos = row.variance >= 0;
                  const isRevOrProfit = ['Revenue', 'Gross Profit', 'EBITDA', 'Net Profit'].includes(row.item);
                  const good = isRevOrProfit ? isPos : !isPos;
                  return (
                    <tr key={row.item} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                      <td className="px-5 py-3 font-medium text-slate-700">{row.item}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{fx(row.budget)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-800">{fx(row.actual)}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                        {row.variance >= 0 ? '+' : ''}{fx(row.variance)}
                      </td>
                      <td className={`px-5 py-3 text-right font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                        {row.variancePct >= 0 ? '+' : ''}{row.variancePct.toFixed(1)}%
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${good ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {good ? '▲ Above' : '▼ Below'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Monthly P&L Table ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">Monthly Profit & Loss</h3>
              <p className="text-slate-500 text-xs mt-0.5">Click a row to expand details</p>
            </div>
            <button
              onClick={toggleMonthlyFilter}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                monthlyFilter === 'strong' ? 'bg-teal-100 text-teal-700' : 'text-slate-500 hover:text-slate-700 bg-slate-100'
              }`}
            >
              <FunnelIcon className="w-3.5 h-3.5" />
              {monthlyFilter === 'strong' ? 'Strong Months' : 'Filter'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Month', 'Revenue', 'COGS', 'Gross Profit', 'GM%', 'OpEx', 'EBITDA', 'D&A', 'EBIT', 'Interest', 'Tax', 'Net Profit', 'NM%'].map(h => {
                    const col = MONTHLY_COL_KEY[h] ?? null;
                    return (
                      <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide ${h === 'Month' ? 'text-left' : 'text-right'}`}>
                        <button
                          onClick={() => toggleMonthlySort(col)}
                          className="flex items-center gap-1 hover:text-slate-700 transition-colors ml-auto"
                        >
                          {h}
                          {monthlySortCol === col ? (
                            monthlySortDir === 'asc' ? <ChevronUpIcon className="w-3 h-3 text-teal-600" /> : <ChevronDownIcon className="w-3 h-3 text-teal-600" />
                          ) : (
                            <ChevronUpDownIcon className="w-3 h-3" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedMonthlyPL.map(row => (
                  <MonthlyRow
                    key={row.month}
                    row={row}
                    expanded={expandedMonths.has(row.month)}
                    onToggle={() => toggleMonth(row.month)}
                    revenueByCategory={REVENUE_BY_CATEGORY}
                    expenseBreakdown={EXPENSE_BREAKDOWN}
                  />
                ))}
                {/* Totals Row */}
                <tr className="bg-teal-50 border-t-2 border-teal-200 font-bold">
                  <td className="px-4 py-3 text-sm text-teal-800">YTD Total</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-800">{fx(PL_CORE.revenue)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-700">{fx(PL_CORE.cogs)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-800">{fx(PL_CORE.grossProfit)}</td>
                  <td className="px-4 py-3 text-sm text-right"><span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full text-xs">{MARGINS.grossMargin}%</span></td>
                  <td className="px-4 py-3 text-sm text-right text-teal-700">{fx(PL_CORE.operatingExpenses)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-800">{fx(PL_CORE.ebitda)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-700">{fx(PL_CORE.da)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-800">{fx(PL_CORE.ebit)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-700">{fx(PL_CORE.interestExpense)}</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-700">({fx(PL_CORE.incomeTax)})</td>
                  <td className="px-4 py-3 text-sm text-right text-teal-800">{fx(PL_CORE.netProfit)}</td>
                  <td className="px-4 py-3 text-sm text-right"><span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full text-xs">{MARGINS.netMargin}%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── AI Insights ── */}
        <AIInsightsPanel title="AI Performance Insights" insights={PL_AI_INSIGHTS} />

      </div>
    </>
  );
}