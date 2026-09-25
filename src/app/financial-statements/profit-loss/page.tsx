'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import KPICard from '@/components/financial/KPICard';
import AIInsightsPanel from '@/components/financial/AIInsightsPanel';
import { ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  REVENUE_BY_CUSTOMER, BUDGET_VS_ACTUAL,
} from '@/lib/financialData';
import InteractiveAgingDonut, { AgingLivePreview } from '../../components/InteractiveAgingDonut';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
// [BARU] Angka P&L (PL_CORE, MARGINS, MONTHLY_PL, REVENUE_BY_CATEGORY,
// EXPENSE_BREAKDOWN) & nama/periode perusahaan sekarang REAL -- diambil
// dari client aktif lewat useProfitLossData() (lihat lib/useProfitLossData.ts
// utk detail sumber & keterbatasannya). REVENUE_BY_CUSTOMER di atas TETAP
// data contoh (financialData.tsx) -- belum ada sumber data backend utk itu.
// [FIX] Kolom "Budget" di bagian Budget vs Actual TIDAK LAGI pakai
// BUDGET_VS_ACTUAL.budget (isinya 0 semua) -- sekarang disambungkan ke
// tabel ..._profit and loss_finance_budget_li (schema 3_Financial) lewat
// ambilPlBudget(). BUDGET_VS_ACTUAL tetap dipakai sbg daftar nama item
// (row.item) saja.
// [BARU] Panel "AI Performance Insights" sekarang dari tabel
// ..._profit and loss_finance_insights lewat usePLInsights() (bukan lagi
// PL_AI_INSIGHTS hardcoded).
import { useProfitLossData, type MonthlyPLRow } from '../lib/useProfitLossData';
import { useActiveClient } from '@/lib/activeClient';
import { ambilPlBudget } from '@/app/agent-ai/lib/api';
import { usePLInsights } from '../lib/usePLInsights';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import {
  ChevronDownIcon, ChevronRightIcon, FunnelIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, CalendarIcon, BuildingOfficeIcon,
  ChevronUpDownIcon, ChevronUpIcon, ArrowTrendingUpIcon, XMarkIcon,
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

// [BARU] Import CSV (fitur tahap awal -- parsing sederhana di browser, BELUM
// tersambung ke backend/jurnal seperti ImportRekeningKoranModal di halaman
// Transaksi). Cukup untuk menimpa tampilan tabel & chart P&L bulanan supaya
// fitur upload file bisa langsung dipakai, meski hasilnya masih sederhana.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { result.push(cur); cur = ''; }
      else cur += c;
    }
    result.push(cur);
    return result.map((v) => v.trim());
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// Kolom yang dikenali (case-insensitive): Month, Revenue, COGS, OpEx, D&A,
// Interest, Tax. Gross Profit/EBITDA/EBIT/Net Profit dihitung ulang dari
// angka-angka itu supaya selalu konsisten (bukan diambil mentah dari file).
function csvRowsToMonthlyPL(rows: Record<string, string>[]): MonthlyPLRow[] {  const ambil = (row: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase());
      if (found) return row[found];
    }
    return undefined;
  };
  const num = (v: string | undefined) => {
    const n = parseFloat((v ?? '0').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  return rows
    .filter((r) => (ambil(r, 'Month') ?? '').trim() !== '')
    .map((r) => {
      const month = (ambil(r, 'Month') ?? '').trim();
      const revenue = num(ambil(r, 'Revenue'));
      const cogs = num(ambil(r, 'COGS'));
      const opEx = num(ambil(r, 'OpEx', 'Operating Expenses'));
      const da = num(ambil(r, 'D&A', 'DA'));
      const interest = num(ambil(r, 'Interest'));
      const tax = num(ambil(r, 'Tax'));
      const grossProfit = revenue - cogs;
      const ebitda = grossProfit - opEx;
      const ebit = ebitda - da;
      const netProfit = revenue - (cogs + opEx + da + interest + tax);
      return { month, revenue, cogs, grossProfit, opEx, ebitda, da, ebit, interest, tax, netProfit };
    });
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

// ─── Hero chart drag-to-preview: types & helpers ───────────────────────────
// Mirrors the interaction model of RevenueExpenseChartInner.tsx (financial
// overview's "Revenue vs Expenses vs Net Profit" chart): each series' hover
// dot can be dragged vertically for a temporary "what-if" preview, then
// springs back to the real value on release. Kept local to this file since
// the P&L hero chart isn't extracted into its own component.
type PLSeriesKey = 'revenue' | 'totalExpenses' | 'cogs' | 'grossProfit' | 'opEx' | 'ebitda' | 'netProfit';

const PL_SERIES_COLOR: Record<PLSeriesKey, string> = {
  revenue: '#0d9488',
  totalExpenses: '#ef4444',
  cogs: '#dc2626',
  grossProfit: '#10b981',
  opEx: '#f97316',
  ebitda: '#6366f1',
  netProfit: '#059669',
};

interface PLDragPreview {
  index: number;
  seriesKey: PLSeriesKey;
  value: number;
}

const PL_SPRING_DURATION_MS = 420;
const plEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// ─── Custom Tooltip ─────────────────────────────────────────────────────────
const ProfitTooltip = ({ active, payload, label, dragPreview }: any) => {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const grossMargin = d.revenue ? ((d.grossProfit / d.revenue) * 100).toFixed(1) : 0;
  const netMargin = d.revenue ? ((d.netProfit / d.revenue) * 100).toFixed(1) : 0;
  const rows: { label: string; val: number; color: string; key?: PLSeriesKey }[] = [
    { label: 'Revenue', val: d.revenue, color: '#0d9488', key: 'revenue' },
    { label: 'Total Expenses', val: d.totalExpenses, color: '#ef4444', key: 'totalExpenses' },
    { label: 'COGS', val: d.cogs, color: '#ef4444' },
    { label: 'Gross Profit', val: d.grossProfit, color: '#10b981' },
    { label: 'Operating Expenses', val: d.opEx, color: '#f97316' },
    { label: 'EBITDA', val: d.ebitda, color: '#6366f1' },
    { label: 'Net Profit', val: d.netProfit, color: '#059669', key: 'netProfit' },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 text-xs min-w-[210px]">
      <p className="font-semibold text-slate-800 mb-2 text-sm">{label}</p>
      {rows.map(r => {
        const isDragged = !!dragPreview && r.key === dragPreview.seriesKey;
        return (
          <div key={r.label} className="flex justify-between gap-4 py-0.5">
            <span className="text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: r.color }} />
              {t(r.label)}
            </span>
            <span className="font-semibold text-slate-800">
              {isDragged ? `${t('estimate')} · ` : ''}
              {fx(r.val)}
            </span>
          </div>
        );
      })}
      <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between">
        <span className="text-slate-500">{t('Gross Margin')}</span>
        <span className="font-semibold text-teal-600">{grossMargin}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">{t('Net Margin')}</span>
        <span className="font-semibold text-emerald-600">{netMargin}%</span>
      </div>
    </div>
  );
};

// ─── Margin Card ─────────────────────────────────────────────────────────────
function MarginCard({ label, value, prev, change, benchmark }: {
  label: string; value: number; prev: number; change: number; benchmark: number;
}) {
  const { t } = useLanguage();
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
        <span>{t('Prev')}: {prev.toFixed(1)}%</span>
        <span>{t('Benchmark')}: {benchmark.toFixed(1)}%</span>
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
  const { t } = useLanguage();
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
                <p className="font-semibold text-slate-600 mb-1.5">{t('Revenue Breakdown')}</p>
                {revenueByCategory.slice(0, 3).map(r => (
                  <div key={r.name} className="flex justify-between py-0.5">
                    <span className="text-slate-500">{t(r.name)}</span>
                    <span className="font-medium text-slate-700">{fx(Math.round(row.revenue * r.pct / 100))}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5">{t('Expense Breakdown')}</p>
                {expenseBreakdown.slice(0, 3).map(e => (
                  <div key={e.name} className="flex justify-between py-0.5">
                    <span className="text-slate-500">{t(e.name)}</span>
                    <span className="font-medium text-slate-700">{fx(Math.round(row.opEx * e.pct / 100))}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1.5">{t('Key Metrics')}</p>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">{t('Gross Margin')}</span>
                  <span className="font-medium text-emerald-600">{gm}%</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">{t('Net Margin')}</span>
                  <span className="font-medium text-teal-600">{nm}%</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">{t('EBITDA Margin')}</span>
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
    PL_CORE: hookPLCore, MARGINS: hookMargins, MONTHLY_PL: hookMonthlyPL,
    REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN,
  } = useProfitLossData();
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const { activeClientId } = useActiveClient();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);

  // ── [BARU] Import data P&L dari file CSV (fitur tahap awal) ─────────────
  // Kalau ada hasil import, MONTHLY_PL/PL_CORE/MARGINS di bawah dihitung
  // dari file yang diupload, bukan dari data client aktif/data contoh lagi.
  // "Reset" mengembalikan ke data asli (hookMonthlyPL dkk).
  const [importedMonthlyPL, setImportedMonthlyPL] = useState<MonthlyPLRow[] | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MONTHLY_PL = importedMonthlyPL ?? hookMonthlyPL;
  const PL_CORE = useMemo(() => {
    if (!importedMonthlyPL) return hookPLCore;
    const sum = (key: keyof MonthlyPLRow) => importedMonthlyPL.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    const revenue = sum('revenue');
    const cogs = sum('cogs');
    const grossProfit = sum('grossProfit');
    const operatingExpenses = sum('opEx');
    const ebitda = sum('ebitda');
    const da = sum('da');
    const ebit = sum('ebit');
    const interestExpense = sum('interest');
    const incomeTax = sum('tax');
    const netProfit = sum('netProfit');
    const ebt = ebit - interestExpense;
    return { revenue, cogs, grossProfit, operatingExpenses, ebitda, da, ebit, interestExpense, ebt, incomeTax, netProfit };
  }, [importedMonthlyPL, hookPLCore]);
  const MARGINS = useMemo(() => {
    if (!importedMonthlyPL) return hookMargins;
    const persen = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    return {
      grossMargin: persen(PL_CORE.grossProfit, PL_CORE.revenue),
      ebitdaMargin: persen(PL_CORE.ebitda, PL_CORE.revenue),
      ebitMargin: persen(PL_CORE.ebit, PL_CORE.revenue),
      netMargin: persen(PL_CORE.netProfit, PL_CORE.revenue),
    };
  }, [importedMonthlyPL, hookMargins, PL_CORE]);

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const monthly = csvRowsToMonthlyPL(parseCsv(text));
        if (monthly.length === 0) {
          setImportError(t('File tidak berisi baris data yang valid. Pastikan ada kolom "Month" & "Revenue".'));
          return;
        }
        setImportedMonthlyPL(monthly);
        setImportError(null);
        setShowImportModal(false);
        toast.success(t('Import berhasil'), { description: `${monthly.length} ${t('baris data P&L dimuat dari file.')}` });
      } catch {
        setImportError(t('Gagal membaca file. Pastikan formatnya CSV.'));
      }
    };
    reader.readAsText(file);
  }

  function handleExportMonthly() {
    const rows = MONTHLY_PL.map((r) => ({
      Month: r.month, Revenue: r.revenue, COGS: r.cogs, OpEx: r.opEx, 'D&A': r.da,
      Interest: r.interest, Tax: r.tax, 'Gross Profit': r.grossProfit, EBITDA: r.ebitda,
      EBIT: r.ebit, 'Net Profit': r.netProfit,
    }));
    downloadCsv(rows, `profit-loss-monthly-${companyName.replace(/\s+/g, '-')}-${Date.now()}.csv`);
    toast.success(t('Export berhasil'), { description: t('Data bulanan P&L diunduh sebagai CSV.') });
  }

  const [chartRange, setChartRange] = useState<'6M' | 'YTD' | '12M'>('YTD');
  const [revenueTab, setRevenueTab] = useState<'category' | 'customer'>('category');
  // ── Revenue Composition donut: klik/hover/drag "what-if" -- pola sama
  // persis dengan AR Aging Donut di Financial Overview (InteractiveAgingDonut).
  const [activeRevenueSlice, setActiveRevenueSlice] = useState<number | null>(null);
  const [revenueLivePreview, setRevenueLivePreview] = useState<AgingLivePreview[] | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedWaterfall, setSelectedWaterfall] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);
  const [monthlySortCol, setMonthlySortCol] = useState<string>('month');
  const [monthlySortDir, setMonthlySortDir] = useState<'asc' | 'desc'>('asc');
  const [monthlyFilter, setMonthlyFilter] = useState<'all' | 'strong'>('all');

  // ── Hero chart drag-to-preview state (see PLSeriesKey block above) ──────
  // Pixel <-> value calibration, refreshed on every render from the
  // (invisible) per-point dots of every series — all three lines share one
  // Y axis, so a single linear mapping works for all of them.
  const plDotsRef = useRef<Record<PLSeriesKey, { value: number; cy: number }[]>>({
    revenue: [], totalExpenses: [], cogs: [], grossProfit: [], opEx: [], ebitda: [], netProfit: [],
  });
  // The one point currently being dragged (or springing back), if any.
  const [plDragPreview, setPlDragPreview] = useState<PLDragPreview | null>(null);
  const plDragStateRef = useRef<{
    index: number;
    seriesKey: PLSeriesKey;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number; // negative: dragging up (smaller clientY) increases value
  } | null>(null);
  const plAnimRef = useRef<number | null>(null);

  const stopPlSpring = () => {
    if (plAnimRef.current) cancelAnimationFrame(plAnimRef.current);
    plAnimRef.current = null;
  };

  // Reset any in-flight drag + stale calibration points when switching
  // 6M/YTD/12M (indices and pixel positions differ between them).
  useEffect(() => {
    stopPlSpring();
    plDragStateRef.current = null;
    setPlDragPreview(null);
    plDotsRef.current = { revenue: [], totalExpenses: [], cogs: [], grossProfit: [], opEx: [], ebitda: [], netProfit: [] };
  }, [chartRange]);

  useEffect(() => stopPlSpring, []);

  const plSpringBack = useCallback(() => {
    const drag = plDragStateRef.current;
    if (!drag) return;
    stopPlSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index, seriesKey } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / PL_SPRING_DURATION_MS);
      const eased = plEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (plDragStateRef.current) plDragStateRef.current.currentValue = next;
      setPlDragPreview({ index, seriesKey, value: next });
      if (elapsed < 1) {
        plAnimRef.current = requestAnimationFrame(step);
      } else {
        plDragStateRef.current = null;
        plAnimRef.current = null;
        setPlDragPreview(null);
      }
    };
    plAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handlePlDotPointerDown = useCallback(
    (seriesKey: PLSeriesKey) => (e: React.PointerEvent, index: number, cy: number, originalValue: number) => {
      e.preventDefault();
      e.stopPropagation();
      stopPlSpring();

      // Derive px-per-unit from two other calibration points of the same
      // series (excluding the one being dragged) — linear, so any two work.
      const samples = plDotsRef.current[seriesKey].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
      let pxPerUnit = -1;
      if (samples.length >= 2) {
        const a = samples[0];
        const b = samples[samples.length - 1];
        if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
      }
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;

      plDragStateRef.current = {
        index, seriesKey, originalValue, currentValue: originalValue,
        startClientY: e.clientY, pxPerUnit,
      };
      setPlDragPreview({ index, seriesKey, value: originalValue });
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* noop */
      }
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = plDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      let value = drag.originalValue + deltaY / drag.pxPerUnit;
      value = Math.max(0, value);
      drag.currentValue = value;
      setPlDragPreview({ index: drag.index, seriesKey: drag.seriesKey, value });
    };
    const handleUp = () => {
      if (plDragStateRef.current) plSpringBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [plSpringBack]);

  // Always-visible, always-draggable dot for every month on every series —
  // deliberately NOT gated behind Recharts' hover/`activeDot` state. That
  // state is recalculated on every mousemove (nearest-index tracking), which
  // can swap/unmount the dot mid-drag the instant the pointer isn't
  // perfectly vertical, killing the interaction. Rendering via the plain
  // `dot` prop keeps the same DOM node mounted for the whole gesture.
  const makePlDraggableDot = (seriesKey: PLSeriesKey) => function PlDraggableDot(props: any) {
    const { cx, cy, index, payload } = props;
    // Keep calibration ref up to date every render (used to convert
    // vertical drag distance in px back into a value delta).
    plDotsRef.current[seriesKey][index] = { value: payload[seriesKey], cy };
    const isDragging = plDragPreview?.index === index && plDragPreview?.seriesKey === seriesKey;
    return (
      <g key={`pldot-${seriesKey}-${index}`}>
        {/* Visible dot — purely decorative, sits under the hit area below. */}
        <circle
          cx={cx}
          cy={cy}
          r={isDragging ? 6 : 3.5}
          fill={PL_SERIES_COLOR[seriesKey]}
          stroke="#ffffff"
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
        {/* Invisible, much larger hit-area so the drag is easy to grab even
            with an imprecise cursor/finger — same visible dot, bigger target. */}
        <circle
          cx={cx}
          cy={cy}
          r={14}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handlePlDotPointerDown(seriesKey)(e, index, cy, payload[seriesKey])}
        />
      </g>
    );
  };

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
      toast.info(t('Perbandingan Tahun Sebelumnya'), { description: t('Perubahan YoY sudah ditampilkan pada tiap kartu KPI di atas.') });
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
    toast.success(t('Export berhasil'), { description: t('Profit & Loss Statement diunduh sebagai CSV.') });
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
      toast.info(next === 'strong' ? t('Menampilkan bulan performa kuat') : t('Menampilkan semua bulan'), {
        description: next === 'strong' ? `${t('Net margin ≥ rata-rata')} (${avgNetMargin.toFixed(1)}%)` : undefined,
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

  // 6M/YTD/12M range filter for the hero chart — YTD shows the full
  // (already year-to-date) monthly dataset, 6M/12M take the trailing slice.
  const plChartRangeData = useMemo(() => {
    if (chartRange === '6M') return chartData.slice(-6);
    if (chartRange === '12M') return chartData.slice(-12);
    return chartData;
  }, [chartData, chartRange]);

  // Applies the in-flight drag preview (if any) on top of the range-filtered
  // data, same pattern as RevenueExpenseChartInner's `displayData`.
  const plChartDisplayData = useMemo(() => {
    if (!plDragPreview) return plChartRangeData;
    return plChartRangeData.map((d, i) =>
      i === plDragPreview.index ? { ...d, [plDragPreview.seriesKey]: plDragPreview.value } : d
    );
  }, [plChartRangeData, plDragPreview]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — fitur yang sama persis
  // dengan chart Financial Overview (OverviewCharts.tsx) & PLWaterfallChart:
  // tarik sumbu Y ke atas = zoom in (skala makin rinci), ke bawah = zoom out.
  // Domain chart tetap kontinu (baseMax / priceZoom) supaya terasa smooth;
  // cuma label/gridline yang dibulatkan ke angka "nice" lewat getNiceTicksFromZero.
  const plBaseMax = useMemo(() => {
    const maxVal = Math.max(0, ...plChartRangeData.map(d =>
      Math.max(d.revenue, d.totalExpenses, d.cogs, d.grossProfit, d.opEx, d.ebitda, d.netProfit)
    ));
    return maxVal * 1.08 || 1;
  }, [plChartRangeData]);
  const [plPriceZoom, setPlPriceZoom] = useState(1);
  const plZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: plYTicks } = useMemo(
    () => getNiceTicksFromZero(plBaseMax / plPriceZoom, 6),
    [plBaseMax, plPriceZoom]
  );
  const plYDomain = useMemo<[number, number]>(() => [0, plBaseMax / plPriceZoom], [plBaseMax, plPriceZoom]);

  const handlePlAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    plZoomDragRef.current = { startY: e.clientY, startZoom: plPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!plZoomDragRef.current) return;
      const deltaY = plZoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, plZoomDragRef.current.startZoom * factor));
      setPlPriceZoom(next);
    };
    const onUp = () => {
      plZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetPlZoom = () => setPlPriceZoom(1);

  // Reset zoom too when the range changes (6M/YTD/12M) — same as the drag
  // preview reset right below, since baseMax shifts with the new dataset.
  useEffect(() => {
    setPlPriceZoom(1);
  }, [chartRange]);

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
  const revenueDonutData = useMemo(
    () => revenueData.map((item, i) => ({
      name: item.name,
      value: item.value,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    })),
    [revenueData]
  );

  // Reset highlight/preview tiap kali tab By Category <-> By Customer
  // berpindah, supaya index slice yang aktif tidak "nyasar" ke item lain
  // (jumlah kategori & customer berbeda).
  useEffect(() => {
    setActiveRevenueSlice(null);
    setRevenueLivePreview(null);
  }, [revenueTab]);

  const waterfallBars = useMemo(() => buildWaterfallBars(PL_CORE), [PL_CORE]);

  // ── Waterfall (Revenue → Net Profit): drag sumbu Y (zoom skala harga) &
  // drag badan bar (preview nilai realtime, spring-back saat dilepas) — pola
  // sama persis dengan chart Financial Overview & PLWaterfallChart.tsx.
  // Arah drag per warna: teal/hijau (total/subtotal) tarik ATAS = besar;
  // merah (COGS/Tax) tarik BAWAH = potongan makin dalam (dibalik); orange
  // (OpEx/D&A/Interest) bisa ditarik ATAS & BAWAH secara natural (tidak dibalik).
  const [waterfallDrag, setWaterfallDrag] = useState<{ index: number; liveValue: number } | null>(null);
  const waterfallDragRef = useRef<{
    index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
    clampMin: number; clampMax: number;
  } | null>(null);
  const waterfallAnimRef = useRef<number | null>(null);
  // true kalau pointer sudah bergerak (dianggap "drag", bukan klik biasa) —
  // dipakai untuk mencegah drag ikut men-toggle drill-down saat dilepas.
  const waterfallJustDraggedRef = useRef(false);

  const stopWaterfallSpring = () => {
    if (waterfallAnimRef.current) cancelAnimationFrame(waterfallAnimRef.current);
    waterfallAnimRef.current = null;
  };

  const waterfallSpringBack = useCallback(() => {
    const drag = waterfallDragRef.current;
    if (!drag) return;
    stopWaterfallSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / PL_SPRING_DURATION_MS);
      const eased = plEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (waterfallDragRef.current) waterfallDragRef.current.liveValue = next;
      setWaterfallDrag({ index, liveValue: next });
      if (elapsed < 1) {
        waterfallAnimRef.current = requestAnimationFrame(step);
      } else {
        waterfallDragRef.current = null;
        waterfallAnimRef.current = null;
        setWaterfallDrag(null);
      }
    };
    waterfallAnimRef.current = requestAnimationFrame(step);
  }, []);

  // Data yang benar-benar dikirim ke chart: sama seperti waterfallBars,
  // kecuali satu bar yang sedang ditarik/spring-back diganti nilai live-nya.
  // Bar 'decrease' merah (COGS/Tax) menggantung dari level kumulatif sebelumnya
  // (anchorTop tetap, hanya magnitude >=0). Bar orange (OpEx/D&A/Interest)
  // BUKAN cuma magnitude -- nilainya SIGNED, bisa negatif (potongan, badan di
  // BAWAH anchor, seperti biasa) maupun positif (kebalikan/kredit, badan
  // menembus ke ATAS anchor), persis seperti kategori "Financing" (kuning) di
  // CashFlowChart.tsx yang bebas dua arah dari titik nol -- bedanya di sini
  // "titik nol" lokalnya bukan 0 mutlak, tapi anchorTop (level kumulatif
  // sebelum item ini). delta di-clamp supaya anchorTop+delta tidak pernah < 0
  // (keluar domain sumbu Y).
  const waterfallDisplayBars = useMemo(() => {
    if (!waterfallDrag) return waterfallBars;
    return waterfallBars.map((d, i) => {
      if (i !== waterfallDrag.index) return d;
      const isOrangeBar = d.color === '#f97316';
      // Merah (COGS/Tax): anchor ATAS tetap, badan tumbuh ke BAWAH -- drag dibalik
      // (tarik bawah = besar), searah sama tarikan.
      if (d.type === 'decrease' && !isOrangeBar) {
        const anchorTop = d.base + d.bar;
        const newBar = waterfallDrag.liveValue;
        return { ...d, base: anchorTop - newBar, bar: newBar, value: -newBar };
      }
      // Orange: liveValue = delta bertanda dari anchorTop (bukan magnitude).
      // Tarik ATAS -> delta makin positif (badan naik ATAS anchor).
      // Tarik BAWAH -> delta makin negatif (badan turun BAWAH anchor, seperti biasa).
      if (d.type === 'decrease' && isOrangeBar) {
        const anchorTop = d.base + d.bar;
        const delta = Math.max(-anchorTop, waterfallDrag.liveValue);
        const top = Math.max(anchorTop, anchorTop + delta);
        const bottom = Math.min(anchorTop, anchorTop + delta);
        return { ...d, base: bottom, bar: top - bottom, value: delta };
      }
      return { ...d, bar: waterfallDrag.liveValue, value: waterfallDrag.liveValue };
    });
  }, [waterfallBars, waterfallDrag]);

  const waterfallBaseMax = useMemo(
    () => Math.max(0, ...waterfallBars.map((d) => d.base + d.bar)) * 1.15 || 1,
    [waterfallBars]
  );
  const [waterfallPriceZoom, setWaterfallPriceZoom] = useState(1);
  const waterfallZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: waterfallYTicks } = useMemo(
    () => getNiceTicksFromZero(waterfallBaseMax / waterfallPriceZoom, 5),
    [waterfallBaseMax, waterfallPriceZoom]
  );
  const waterfallYDomain = useMemo<[number, number]>(
    () => [0, waterfallBaseMax / waterfallPriceZoom],
    [waterfallBaseMax, waterfallPriceZoom]
  );

  const handleWaterfallAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    waterfallZoomDragRef.current = { startY: e.clientY, startZoom: waterfallPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!waterfallZoomDragRef.current) return;
      const deltaY = waterfallZoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, waterfallZoomDragRef.current.startZoom * factor));
      setWaterfallPriceZoom(next);
    };
    const onUp = () => {
      waterfallZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetWaterfallZoom = () => setWaterfallPriceZoom(1);

  // Reset drag & zoom kalau data PL_CORE berubah (mis. ganti client aktif) —
  // index bar & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopWaterfallSpring();
    waterfallDragRef.current = null;
    setWaterfallDrag(null);
    setWaterfallPriceZoom(1);
  }, [PL_CORE]);

  const handleWaterfallBarPointerDown = (
    index: number, startValue: number, barHeight: number, invertDrag: boolean,
    clampMin = 0, clampMax = Infinity
  ) => (
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    stopWaterfallSpring();
    waterfallJustDraggedRef.current = false;
    // Math.abs(startValue): startValue boleh NEGATIF untuk bar orange (nilai
    // bertanda), tapi rasio piksel-per-unit selalu dihitung dari magnitude-nya.
    const magnitude = Math.abs(startValue);
    let pxPerUnit = magnitude !== 0 ? -barHeight / magnitude : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    if (invertDrag) pxPerUnit = -pxPerUnit;
    waterfallDragRef.current = { index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit, clampMin, clampMax };
    setWaterfallDrag({ index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = waterfallDragRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      if (Math.abs(deltaY) > 3) waterfallJustDraggedRef.current = true;
      const next = Math.max(drag.clampMin, Math.min(drag.clampMax, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setWaterfallDrag({ index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (waterfallDragRef.current) waterfallSpringBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [waterfallSpringBack]);

  // Custom bar shape: seluruh badan bar bisa digenggam & ditarik. Merah
  // ('#ef4444' — COGS/Tax) arah drag dibalik (bawah = makin dalam), anchor di
  // ATAS tetap, magnitude selalu >= 0. Orange ('#f97316' — OpEx/D&A/Interest)
  // nilainya SIGNED & bebas dua arah dari anchorTop (lihat waterfallDisplayBars)
  // -- tarik ATAS bisa menembus jadi positif, tarik BAWAH tetap negatif seperti
  // biasa. Klik biasa (tanpa drag) tetap men-toggle drill-down seperti semula.
  const renderWaterfallBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isOrange = payload.color === '#f97316';
    const invertDrag = payload.type === 'decrease' && !isOrange;
    const isDraggingThis = waterfallDrag?.index === index;
    // Sama seperti CashFlowChart.tsx: jangan clamp height negatif pakai
    // Math.max(0, height) (itu yang bikin bar hilang) -- normalisasi pakai
    // Math.abs + geser y.
    const h = Math.abs(height);
    const rectY = height < 0 ? y + height : y;
    const handleClick = () => {
      if (waterfallJustDraggedRef.current) {
        waterfallJustDraggedRef.current = false;
        return;
      }
      setSelectedWaterfall(payload.name);
    };
    const maxValue = (waterfallBaseMax / waterfallPriceZoom) * 1.4;
    // Orange mulai dari payload.value (bertanda, mis. -1180) supaya bisa gerak
    // ke arah positif (menembus anchor) maupun makin negatif; merah/lainnya
    // tetap dari payload.bar (magnitude, >=0 saja).
    const dragStartValue = isOrange ? payload.value : payload.bar;
    const clampMin = isOrange ? -maxValue : 0;
    const dragHandlers = handleWaterfallBarPointerDown(index, dragStartValue, height, invertDrag, clampMin, maxValue);
    return (
      <g>
        <rect
          x={x}
          y={rectY}
          width={width}
          height={h}
          fill={payload.color}
          opacity={selectedWaterfall && selectedWaterfall !== payload.name ? 0.4 : 1}
          rx={4}
          ry={4}
          stroke={isDraggingThis ? payload.color : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
          onClick={handleClick}
        />
        {/* Perluas area genggam ke atas sedikit, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={rectY - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={dragHandlers}
          onClick={handleClick}
        />
        {/* Orange bisa ditarik dua arah -> genggaman diperluas ke bawah juga */}
        {isOrange && (
          <rect
            x={x}
            y={rectY + h}
            width={width}
            height={10}
            fill="transparent"
            style={{ cursor: 'ns-resize' }}
            onPointerDown={dragHandlers}
            onClick={handleClick}
          />
        )}
      </g>
    );
  };
  renderWaterfallBar.displayName = 'RenderWaterfallBar';

  // [BARU] Anggaran P&L REAL untuk kolom "Budget" di tabel Budget vs Actual,
  // sumber tabel ..._profit and loss_finance_budget_li (schema 3_Financial)
  // lewat GET /api/client/{id}/pl-budget. Dijumlahkan YTD sebanyak bulan
  // aktual yang tampil (MONTHLY_PL.length), supaya Budget & Actual sejajar.
  // Diambil setiap ada client aktif (bukan hanya saat mode "Budget"),
  // karena kartu Budget vs Actual selalu tampil. Flag `cancelled` mencegah
  // hasil request lama menimpa data saat client/jumlah bulan berubah.
  const elapsedMonthsUntukBudget = Math.max(1, MONTHLY_PL.length);
  const anchorYearUntukBudget = new Date().getFullYear();
  const [budgetDataPL, setBudgetDataPL] = useState<{
    revenue: number; cogs: number; grossProfit: number;
    operatingExpenses: number; ebitda: number; netProfit: number; ada_data: boolean;
  } | null>(null);
  useEffect(() => {
    if (isSampleData || !activeClientId) { setBudgetDataPL(null); return; }
    let cancelled = false;
    ambilPlBudget(activeClientId, anchorYearUntukBudget, elapsedMonthsUntukBudget)
      .then((res) => { if (!cancelled) setBudgetDataPL(res?.ada_data ? res : null); })
      .catch(() => { if (!cancelled) setBudgetDataPL(null); });
    return () => { cancelled = true; };
  }, [isSampleData, activeClientId, anchorYearUntukBudget, elapsedMonthsUntukBudget]);
  // [BARU] Insight P&L dari tabel ..._profit and loss_finance_insights.
  const { insights: plInsights } = usePLInsights();

  // Kolom "Actual" & variance-nya disinkronkan ke PL_CORE ASLI, supaya
  // tidak beda dengan angka Revenue/EBITDA/dst yang sudah ditampilkan di
  // bagian lain halaman ini. Kolom "Budget" sekarang dari budgetDataPL
  // (Rupiah mentah -> dikonversi ke Jt supaya sejajar dengan PL_CORE);
  // kalau belum ada data anggaran utk client ini, fallback ke 0 (bukan
  // BUDGET_VS_ACTUAL.budget lama yang statis).
  const ACTUAL_DARI_PL_CORE: Record<string, number> = {
    Revenue: PL_CORE.revenue, COGS: PL_CORE.cogs, 'Gross Profit': PL_CORE.grossProfit,
    'Operating Expenses': PL_CORE.operatingExpenses, EBITDA: PL_CORE.ebitda, 'Net Profit': PL_CORE.netProfit,
  };
  const BUDGET_DARI_REAL: Record<string, number> = budgetDataPL ? {
    Revenue: budgetDataPL.revenue / 1e6, COGS: budgetDataPL.cogs / 1e6, 'Gross Profit': budgetDataPL.grossProfit / 1e6,
    'Operating Expenses': budgetDataPL.operatingExpenses / 1e6, EBITDA: budgetDataPL.ebitda / 1e6, 'Net Profit': budgetDataPL.netProfit / 1e6,
  } : {};
  const budgetVsActual = BUDGET_VS_ACTUAL.map(row => {
    const actual = ACTUAL_DARI_PL_CORE[row.item] ?? row.actual;
    const budget = BUDGET_DARI_REAL[row.item] ?? 0;
    const variance = actual - budget;
    const variancePct = budget ? (variance / Math.abs(budget)) * 100 : 0;
    return { ...row, budget, actual, variance, variancePct };
  });

  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('Profit & Loss')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('Analyze revenue, expenses, profitability, and financial performance')}</p>
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
                  {t('Showing sample data')}
                </span>
              )}
              {loading && (
                <span className="text-xs font-medium text-slate-400">{t('Memuat data…')}</span>
              )}
              {importedMonthlyPL && (
                <span className="text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  {t('Data hasil import')}
                  <button
                    onClick={() => { setImportedMonthlyPL(null); toast.info(t('Kembali ke data asli')); }}
                    className="underline hover:text-teal-900"
                  >
                    {t('Reset')}
                  </button>
                </span>
              )}
            </div>
            <p className="text-slate-500 text-sm">{MONTHLY_PL.length} {MONTHLY_PL.length !== 1 ? t('months') : t('month')} {t('YTD')}</p>
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
                {t(m)}
              </button>
            ))}
            <button onClick={() => { setImportError(null); setShowImportModal(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
              <ArrowUpTrayIcon className="w-3.5 h-3.5" />
              {t('Import')}
            </button>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              {t('Export')}
            </button>
          </div>
        </div>

        {/* ── Profitability Snapshot ── */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-teal-500" />
            {t('Profitability Snapshot')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard title={t('Revenue')} value={fx(PL_CORE.revenue)} change={hitungPerubahan(bulanTerakhir?.revenue ?? 0, bulanSebelumnya?.revenue)} previousValue={fx(bulanSebelumnya?.revenue ?? 0)} sparkline={sparkRevenue} status={statusDari(hitungPerubahan(bulanTerakhir?.revenue ?? 0, bulanSebelumnya?.revenue))} />
            <KPICard title={t('Gross Profit')} value={fx(PL_CORE.grossProfit)} change={hitungPerubahan(bulanTerakhir?.grossProfit ?? 0, bulanSebelumnya?.grossProfit)} previousValue={fx(bulanSebelumnya?.grossProfit ?? 0)} sparkline={sparkGP} status={statusDari(hitungPerubahan(bulanTerakhir?.grossProfit ?? 0, bulanSebelumnya?.grossProfit))} />
            <KPICard title={t('EBITDA')} value={fx(PL_CORE.ebitda)} change={hitungPerubahan(bulanTerakhir?.ebitda ?? 0, bulanSebelumnya?.ebitda)} previousValue={fx(bulanSebelumnya?.ebitda ?? 0)} sparkline={sparkEBITDA} status={statusDari(hitungPerubahan(bulanTerakhir?.ebitda ?? 0, bulanSebelumnya?.ebitda))} />
            <KPICard title={t('EBIT')} value={fx(PL_CORE.ebit)} change={hitungPerubahan(bulanTerakhir?.ebit ?? 0, bulanSebelumnya?.ebit)} previousValue={fx(bulanSebelumnya?.ebit ?? 0)} sparkline={sparkEBITDA} status={statusDari(hitungPerubahan(bulanTerakhir?.ebit ?? 0, bulanSebelumnya?.ebit))} />
            <KPICard title={t('Net Profit')} value={fx(PL_CORE.netProfit)} change={hitungPerubahan(bulanTerakhir?.netProfit ?? 0, bulanSebelumnya?.netProfit)} previousValue={fx(bulanSebelumnya?.netProfit ?? 0)} sparkline={sparkNP} status={statusDari(hitungPerubahan(bulanTerakhir?.netProfit ?? 0, bulanSebelumnya?.netProfit))} />
            <KPICard title={t('Net Margin')} value={`${MARGINS.netMargin}%`} change={MARGINS.netMargin - (bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin)} previousValue={`${(bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin).toFixed(1)}%`} sparkline={sparkNP.map(v => v / 10)} status={statusDari(MARGINS.netMargin - (bulanSebelumnya && bulanSebelumnya.revenue ? (bulanSebelumnya.netProfit / bulanSebelumnya.revenue) * 100 : MARGINS.netMargin))} />
          </div>
        </div>

        {/* ── Hero Chart: Revenue vs Expenses vs Net Profit ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800">{t('Revenue vs Expenses vs Net Profit')}</h3>
              <p className="text-slate-500 text-xs mt-0.5">{t('Monthly performance trend analysis')}</p>
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
          <div className="p-5 relative">
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={plChartDisplayData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')}
                  ticks={plYTicks}
                  domain={plYDomain}
                  allowDataOverflow
                  width={54}
                />
                <Tooltip content={<ProfitTooltip dragPreview={plDragPreview} />} cursor={false} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                {/* Revenue is the only series with a fill (its Area's gradient
                    fades from the line down to 0). Total Expenses and Net
                    Profit are plain Lines with no fill — each Area's fill
                    reaches all the way down to the zero baseline, so a second
                    or third overlapping fill in the same lower band blends
                    into a muddy grey/brown tint instead of a clean color.
                    Keeping only one filled series avoids that entirely. */}
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name={t('Revenue')}
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  fill="url(#gradRevenue)"
                  dot={makePlDraggableDot('revenue')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="totalExpenses"
                  name={t('Total Expenses')}
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={makePlDraggableDot('totalExpenses')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="cogs"
                  name={t('COGS')}
                  stroke="#dc2626"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  dot={makePlDraggableDot('cogs')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="grossProfit"
                  name={t('Gross Profit')}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={makePlDraggableDot('grossProfit')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="opEx"
                  name={t('Operating Expenses')}
                  stroke="#f97316"
                  strokeWidth={1.5}
                  dot={makePlDraggableDot('opEx')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ebitda"
                  name={t('EBITDA')}
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  dot={makePlDraggableDot('ebitda')}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="netProfit"
                  name={t('Net Profit')}
                  stroke="#059669"
                  strokeWidth={2.5}
                  strokeDasharray="5 3"
                  dot={makePlDraggableDot('netProfit')}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga — sama seperti chart Financial Overview */}
            <div
              onMouseDown={handlePlAxisMouseDown}
              onDoubleClick={resetPlZoom}
              title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
              className="absolute top-0 left-0 h-full cursor-ns-resize"
              style={{ width: 64 }}
            />
          </div>
        </div>

        {/* ── Waterfall + Margins ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Waterfall */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{t('Revenue to Net Profit')}</h3>
              <p className="text-slate-500 text-xs mt-0.5">{t('Profitability waterfall — click any bar to drill down')}</p>
            </div>
            <div className="p-5 relative">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={waterfallDisplayBars} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')}
                    ticks={waterfallYTicks}
                    domain={waterfallYDomain}
                    allowDataOverflow
                    width={56}
                  />
                  <Tooltip
                    formatter={(value: any, name: string, props: any) => {
                      const d = props.payload;
                      if (name === 'bar') return [fx(d.value), d.name];
                      return [null, null];
                    }}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    cursor={false}
                  />
                  <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={!waterfallDrag} />
                  <Bar dataKey="bar" stackId="a" shape={renderWaterfallBar as any} isAnimationActive={!waterfallDrag} />
                </BarChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleWaterfallAxisMouseDown}
                onDoubleClick={resetWaterfallZoom}
                title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: 66 }}
              />
              {selectedWaterfall && (
                <div className="mt-3 p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-teal-700 font-medium">
                    {t('Drilling into:')} <strong>{selectedWaterfall}</strong>
                  </span>
                  <button onClick={() => setSelectedWaterfall(null)} className="text-xs text-teal-600 hover:text-teal-800">{t('Clear')}</button>
                </div>
              )}
            </div>
          </div>

          {/* Margins */}
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3 border-b border-b-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">{t('Profitability Margins')}</h3>
              <p className="text-slate-500 text-xs">{t('vs previous period & industry benchmark')}</p>
            </div>
            {/* [BARU] "value" = margin ASLI dari PL_CORE/MARGINS. "prev" &
                "benchmark" tetap ilustratif -- backend belum expose margin
                periode sebelumnya / benchmark industri lewat API. */}
            <MarginCard label={t('Gross Margin')} value={MARGINS.grossMargin} prev={MARGINS.grossMargin - 1.2} change={1.2} benchmark={42.0} />
            <MarginCard label={t('EBITDA Margin')} value={MARGINS.ebitdaMargin} prev={MARGINS.ebitdaMargin - 0.6} change={0.6} benchmark={25.0} />
            <MarginCard label={t('EBIT Margin')} value={MARGINS.ebitMargin} prev={MARGINS.ebitMargin - 0.7} change={0.7} benchmark={24.0} />
            <MarginCard label={t('Net Margin')} value={MARGINS.netMargin} prev={MARGINS.netMargin - 0.4} change={0.4} benchmark={18.5} />
          </div>
        </div>

        {/* ── Revenue Breakdown + Expense Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Revenue Composition */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">{t('Revenue Composition')}</h3>
                <p className="text-slate-500 text-xs mt-0.5">{t('Total')}: {fx(PL_CORE.revenue)}</p>
              </div>
              <div className="flex gap-1">
                {(['category', 'customer'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRevenueTab(tab)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${
                      revenueTab === tab ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t(`By ${tab}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              <div className="flex gap-4">
                <div className="flex-shrink-0" style={{ width: 140 }}>
                  <InteractiveAgingDonut
                    data={revenueDonutData}
                    activeIndex={activeRevenueSlice}
                    onActiveChange={setActiveRevenueSlice}
                    onLiveChange={setRevenueLivePreview}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  {revenueData.map((item, i) => {
                    const preview = revenueLivePreview?.[i];
                    const displayValue = preview ? preview.value : item.value;
                    const displayPct = preview ? preview.pct : item.pct;
                    const isActive = activeRevenueSlice === i;
                    return (
                      <div
                        key={item.name}
                        onClick={() => setActiveRevenueSlice(prev => (prev === i ? null : i))}
                        className={`flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                          isActive ? 'bg-slate-100' : ''
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className={`text-xs flex-1 truncate ${isActive ? 'text-slate-800 font-semibold' : 'text-slate-600'}`}>{t(item.name)}</span>
                        <span className="text-xs font-semibold text-slate-800">{fx(displayValue)}</span>
                        <span className="text-xs text-slate-400 w-10 text-right">{displayPct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{t('Operating Expense Breakdown')}</h3>
              <p className="text-slate-500 text-xs mt-0.5">{t('Total OpEx')}: {fx(PL_CORE.operatingExpenses)}</p>
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
                      {t(item.name)}
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
                      {item.pct}% {t('of total OpEx')} ({fx(PL_CORE.operatingExpenses)})
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
            <h3 className="font-semibold text-slate-800">{t('Profitability vs Budget')}</h3>
            <p className="text-slate-500 text-xs mt-0.5">{t('Actual performance compared to budget targets')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Metric')}</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Budget')}</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Actual')}</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Variance')}</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Var %')}</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {budgetVsActual.map((row, i) => {
                  const isPos = row.variance >= 0;
                  const isRevOrProfit = ['Revenue', 'Gross Profit', 'EBITDA', 'Net Profit'].includes(row.item);
                  const good = isRevOrProfit ? isPos : !isPos;
                  return (
                    <tr key={row.item} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                      <td className="px-5 py-3 font-medium text-slate-700">{t(row.item)}</td>
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
                          {good ? t('▲ Above') : t('▼ Below')}
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
              <h3 className="font-semibold text-slate-800">{t('Monthly Profit & Loss')}</h3>
              <p className="text-slate-500 text-xs mt-0.5">{t('Click a row to expand details')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportMonthly}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 bg-slate-100 transition-colors"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                {t('Export CSV')}
              </button>
              <button
                onClick={toggleMonthlyFilter}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  monthlyFilter === 'strong' ? 'bg-teal-100 text-teal-700' : 'text-slate-500 hover:text-slate-700 bg-slate-100'
                }`}
              >
                <FunnelIcon className="w-3.5 h-3.5" />
                {monthlyFilter === 'strong' ? t('Strong Months') : t('Filter')}
              </button>
            </div>
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
                          {t(h)}
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
                  <td className="px-4 py-3 text-sm text-teal-800">{t('YTD Total')}</td>
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
        <AIInsightsPanel title="AI Performance Insights" insights={plInsights} />

      </div>

      {/* ── [BARU] Import Data P&L Modal (tahap awal) ── */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowImportModal(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">{t('Import Data Profit & Loss')}</h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {t('Upload file CSV berisi data bulanan dengan kolom: Month, Revenue, COGS, OpEx, D&A, Interest, Tax. Fitur ini masih tahap awal — tampilan hasil import belum sepenuhnya rapi.')}
            </p>
            <button onClick={handleExportMonthly} className="text-xs text-teal-600 hover:underline mb-3 block">
              {t('Unduh contoh format (data saat ini) sebagai CSV')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-8 text-slate-500 hover:border-teal-400 hover:text-teal-600 transition-colors"
            >
              <ArrowUpTrayIcon className="w-6 h-6" />
              <span className="text-sm font-medium">{t('Klik untuk pilih file CSV')}</span>
            </button>
            {importError && <p className="text-xs text-red-500 mt-2">{importError}</p>}
          </div>
        </div>
      )}
    </>
  );
}