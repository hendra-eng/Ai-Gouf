'use client';

import React, { useMemo } from 'react';
import { toast } from 'sonner';
import KPICard from '@/components/financial/KPICard';
import AIInsightsPanel from '@/components/financial/AIInsightsPanel';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import { BS_AI_INSIGHTS } from '@/lib/financialData';
// [BARU] Angka Balance Sheet (total aset/liabilitas/ekuitas, rincian per akun,
// tren bulanan) & nama perusahaan sekarang REAL -- diambil dari client aktif
// lewat useBalanceSheetData() (lihat lib/useBalanceSheetData.ts utk detail
// sumber & keterbatasannya). Pola koneksinya SAMA dengan halaman Profit & Loss
// (useProfitLossData) yang sudah duluan tersambung. BS_AI_INSIGHTS di atas
// TETAP data contoh -- belum ada modul AI-insight utk Balance Sheet yang
// expose data terstruktur lewat API saat ini.
import { useBalanceSheetData, type BSSection, type BSItem } from '../lib/useBalanceSheetData';
import { useCurrency, formatMoney } from '@/lib/currency';
import {
  ChevronDownIcon, ChevronRightIcon, ArrowDownTrayIcon,
  CalendarIcon, BuildingOfficeIcon, CheckCircleIcon, ExclamationTriangleIcon, ScaleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

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

// ─── Account Section Component ───────────────────────────────────────────────
function AccountSection({
  title, items, total, prevTotal, totalAssetsForPct, indent = false, colorClass = 'text-slate-800',
}: {
  title: string;
  items: BSItem[];
  total: number;
  prevTotal: number;
  totalAssetsForPct: number;
  indent?: boolean;
  colorClass?: string;
}) {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = React.useState(true);
  const change = total - prevTotal;
  const changePct = prevTotal ? ((change / prevTotal) * 100) : 0;
  const totalPct = totalAssetsForPct ? (total / totalAssetsForPct) * 100 : 0;

  return (
    <div className={indent ? 'ml-4' : ''}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 py-2.5 px-4 hover:bg-slate-50 transition-colors group"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        )}
        <span className="text-sm font-semibold text-slate-700 flex-1 text-left">{title}</span>
        <span className="text-sm font-bold text-right w-28 text-slate-800">{fx(total)}</span>
        <span className="text-sm text-right w-28 text-slate-500">{fx(prevTotal)}</span>
        <span className={`text-xs font-semibold text-right w-20 ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {change >= 0 ? '+' : ''}{fx(change)}
        </span>
        <span className={`text-xs font-semibold text-right w-16 ${changePct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
        </span>
        <span className="text-xs text-slate-400 text-right w-14">{totalPct.toFixed(1)}%</span>
      </button>
      {expanded && (
        <div className="border-l-2 border-slate-100 ml-6">
          {items.length === 0 && (
            <p className="text-xs text-slate-400 italic px-4 py-3">No accounts in this section yet.</p>
          )}
          {items.map(item => {
            const ch = item.current - item.prev;
            const chPct = item.prev ? ((ch / item.prev) * 100) : 0;
            const pct = totalAssetsForPct ? (item.current / totalAssetsForPct) * 100 : 0;
            return (
              <div key={item.name} className="flex items-center gap-2 py-2 px-4 hover:bg-slate-50/80 transition-colors group/row">
                <span className="w-3.5 flex-shrink-0" />
                <Link href={item.href || '#'} className={`text-sm flex-1 ${colorClass} hover:text-teal-600 transition-colors`}>
                  {item.name}
                </Link>
                <span className="text-sm font-medium text-right w-28 text-slate-800">{fx(item.current)}</span>
                <span className="text-sm text-right w-28 text-slate-400">{fx(item.prev)}</span>
                <span className={`text-xs font-medium text-right w-20 ${ch >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {ch >= 0 ? '+' : ''}{fx(ch)}
                </span>
                <span className={`text-xs font-medium text-right w-16 ${chPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {chPct >= 0 ? '+' : ''}{chPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 text-right w-14">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Composition Chart ────────────────────────────────────────────────────────
function CompositionChart({ title, data, total, href }: {
  title: string; data: { name: string; value: number; color: string }[]; total: number; href: string;
}) {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
          <p className="text-slate-500 text-xs mt-0.5">Total: {fx(total)}</p>
        </div>
        <Link href={href} className="text-xs text-teal-600 hover:text-teal-700 font-medium">View Details →</Link>
      </div>
      <div className="p-4">
        {data.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No data yet.</p>
        ) : (
          <div className="flex gap-3">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={32} outerRadius={55} dataKey="value" paddingAngle={2}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {data.map(item => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className="text-[11px] text-slate-600 flex-1 truncate">{item.name}</span>
                  <span className="text-[11px] font-semibold text-slate-800">{fx(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const COMPOSITION_COLORS = ['#0d9488', '#6366f1', '#f97316', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#dc2626', '#f59e0b', '#b91c1c', '#9f1239'];

function seksiKeComposition(section: BSSection): { name: string; value: number; color: string }[] {
  return section.items
    .filter((i) => i.current > 0.5)
    .slice(0, 6)
    .map((i, idx) => ({ name: i.name, value: i.current, color: COMPOSITION_COLORS[idx % COMPOSITION_COLORS.length] }));
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BalanceSheetPage() {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const data = useBalanceSheetData();

  const {
    totalAssets, prevTotalAssets, totalLiabilities, prevTotalLiabilities, totalEquity, prevTotalEquity,
    currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities, equity,
    BS_MONTHLY_TREND, companyName, periodLabel, isSampleData, loading,
  } = data;

  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1;
  const workingCapital = currentAssets.total - currentLiabilities.total;
  const currentRatio = currentLiabilities.total ? currentAssets.total / currentLiabilities.total : 0;
  const inventoryItem = currentAssets.items.find((i) => /persediaan|inventory/i.test(i.name));
  const quickRatio = currentLiabilities.total ? (currentAssets.total - (inventoryItem?.current || 0)) / currentLiabilities.total : 0;
  const cashItem = currentAssets.items.find((i) => /kas|bank|cash/i.test(i.name));
  const cashRatio = currentLiabilities.total ? (cashItem?.current || 0) / currentLiabilities.total : 0;
  const debtToEquity = totalEquity ? totalLiabilities / totalEquity : 0;

  const assetsChangePct = prevTotalAssets ? ((totalAssets - prevTotalAssets) / prevTotalAssets) * 100 : 0;
  const liabChangePct = prevTotalLiabilities ? ((totalLiabilities - prevTotalLiabilities) / prevTotalLiabilities) * 100 : 0;
  const equityChangePct = prevTotalEquity ? ((totalEquity - prevTotalEquity) / prevTotalEquity) * 100 : 0;

  const ASSET_COMPOSITION = useMemo(() => seksiKeComposition({ label: '', items: [...currentAssets.items, ...nonCurrentAssets.items], total: 0, prevTotal: 0 }), [currentAssets, nonCurrentAssets]);
  const LIABILITY_COMPOSITION = useMemo(() => seksiKeComposition({ label: '', items: [...currentLiabilities.items, ...nonCurrentLiabilities.items], total: 0, prevTotal: 0 }), [currentLiabilities, nonCurrentLiabilities]);
  const EQUITY_COMPOSITION = useMemo(() => seksiKeComposition(equity), [equity]);

  function handleExport() {
    const rows = [
      ...currentAssets.items.map(i => ({ Section: 'Current Assets', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      ...nonCurrentAssets.items.map(i => ({ Section: 'Non-Current Assets', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Assets', Account: 'Total Assets', 'Current Period': totalAssets, 'Previous Period': prevTotalAssets },
      ...currentLiabilities.items.map(i => ({ Section: 'Current Liabilities', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      ...nonCurrentLiabilities.items.map(i => ({ Section: 'Non-Current Liabilities', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Liabilities', Account: 'Total Liabilities', 'Current Period': totalLiabilities, 'Previous Period': prevTotalLiabilities },
      ...equity.items.map(i => ({ Section: 'Equity', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Equity', Account: 'Total Equity', 'Current Period': totalEquity, 'Previous Period': prevTotalEquity },
    ];
    downloadCsv(rows, `balance-sheet-${companyName.replace(/\s+/g, '-')}-${Date.now()}.csv`);
    toast.success('Export berhasil', { description: 'Balance Sheet diunduh sebagai CSV.' });
  }

  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Balance Sheet</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyze the company&apos;s financial position, assets, liabilities, and equity</p>
      </div>
      <div className="p-6 space-y-6">

        {isSampleData && !loading && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
            Showing sample data — select a client with posted journals to see real figures.
          </div>
        )}

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5" />
              {periodLabel}
            </span>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <BuildingOfficeIcon className="w-3.5 h-3.5" />
              {companyName}
            </span>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors self-start"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            Export
          </button>
        </div>

        {/* ── Balance Validation Hero ── */}
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <CheckCircleIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <p className="text-teal-100 text-sm font-medium">Balance Sheet Status</p>
                <p className="text-2xl font-bold">{isBalanced ? '✓ Balanced' : '⚠ Not Balanced'}</p>
                <p className="text-teal-200 text-xs mt-0.5">Difference: {fx(totalAssets - (totalLiabilities + totalEquity))} · Assets = Liabilities + Equity</p>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-4 lg:ml-8">
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Assets</p>
                <p className="text-xl font-bold">{fx(totalAssets)}</p>
                <p className="text-teal-200 text-xs mt-1">{assetsChangePct >= 0 ? '+' : ''}{assetsChangePct.toFixed(1)}% MoM</p>
              </div>
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Liabilities</p>
                <p className="text-xl font-bold">{fx(totalLiabilities)}</p>
                <p className="text-teal-200 text-xs mt-1">{liabChangePct >= 0 ? '+' : ''}{liabChangePct.toFixed(1)}% MoM</p>
              </div>
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Equity</p>
                <p className="text-xl font-bold">{fx(totalEquity)}</p>
                <p className="text-teal-200 text-xs mt-1">{equityChangePct >= 0 ? '+' : ''}{equityChangePct.toFixed(1)}% MoM</p>
              </div>
            </div>
          </div>
          {/* Equation Visual */}
          <div className="mt-5 flex items-center justify-center gap-3 bg-white/10 rounded-xl py-3 px-4">
            <div className="text-center">
              <p className="text-xs text-teal-200">Assets</p>
              <p className="font-bold text-lg">{fx(totalAssets)}</p>
            </div>
            <span className="text-2xl font-light text-teal-300">=</span>
            <div className="text-center">
              <p className="text-xs text-teal-200">Liabilities</p>
              <p className="font-bold text-lg">{fx(totalLiabilities)}</p>
            </div>
            <span className="text-2xl font-light text-teal-300">+</span>
            <div className="text-center">
              <p className="text-xs text-teal-200">Equity</p>
              <p className="font-bold text-lg">{fx(totalEquity)}</p>
            </div>
          </div>
        </div>

        {/* ── Financial Position KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard title="Total Assets" value={fx(totalAssets)} change={assetsChangePct} previousValue={fx(prevTotalAssets)} sparkline={BS_MONTHLY_TREND.map(d => d.assets)} status="positive" />
          <KPICard title="Total Liabilities" value={fx(totalLiabilities)} change={liabChangePct} previousValue={fx(prevTotalLiabilities)} sparkline={BS_MONTHLY_TREND.map(d => d.liabilities)} status="positive" />
          <KPICard title="Total Equity" value={fx(totalEquity)} change={equityChangePct} previousValue={fx(prevTotalEquity)} sparkline={BS_MONTHLY_TREND.map(d => d.equity)} status="positive" />
          <KPICard title="Working Capital" value={fx(workingCapital)} change={0} previousValue={fx(0)} status="positive" />
          <KPICard title="Current Ratio" value={`${currentRatio.toFixed(2)}x`} change={0} previousValue="—" status="positive" />
          <KPICard title="Debt-to-Equity" value={`${debtToEquity.toFixed(2)}x`} change={0} previousValue="—" status="positive" />
        </div>

        {/* ── Financial Position Visual ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Financial Position — Assets vs Liabilities & Equity</h3>
            <p className="text-slate-500 text-xs mt-0.5">Visual representation of the accounting equation over time</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Stacked Bar */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Monthly Trend</p>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={BS_MONTHLY_TREND} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradAssets" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                    <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="assets" name="Assets" stroke="#0d9488" strokeWidth={2.5} fill="url(#gradAssets)" dot={false} />
                    <Area type="monotone" dataKey="equity" name="Equity" stroke="#6366f1" strokeWidth={2} fill="url(#gradEquity)" dot={false} />
                    <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke="#ef4444" strokeWidth={2} fill="none" dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {/* Current Composition */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Current Composition</p>
                <div className="space-y-3">
                  {[
                    { label: 'Assets', value: totalAssets, total: totalAssets || 1, color: '#0d9488' },
                    { label: 'Equity', value: totalEquity, total: totalAssets || 1, color: '#6366f1' },
                    { label: 'Liabilities', value: totalLiabilities, total: totalAssets || 1, color: '#ef4444' },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-slate-700">{item.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{fx(item.value)}</span>
                          <span className="text-xs text-slate-400">{((item.value / item.total) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-3 rounded-full transition-all duration-700"
                          style={{ width: `${Math.min((item.value / item.total) * 100, 100)}%`, background: item.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Ratios */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Current Ratio', value: currentRatio.toFixed(2) + 'x', good: currentRatio > 1.5 },
                    { label: 'Quick Ratio', value: quickRatio.toFixed(2) + 'x', good: quickRatio > 1.0 },
                    { label: 'Cash Ratio', value: cashRatio.toFixed(2) + 'x', good: cashRatio > 0.5 },
                  ].map(r => (
                    <div key={r.label} className={`rounded-lg p-3 text-center ${r.good ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                      <p className="text-xs text-slate-500 mb-1">{r.label}</p>
                      <p className={`text-lg font-bold ${r.good ? 'text-emerald-700' : 'text-amber-700'}`}>{r.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Composition Charts ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CompositionChart title="Asset Composition" data={ASSET_COMPOSITION} total={totalAssets} href="/assets" />
          <CompositionChart title="Liability Composition" data={LIABILITY_COMPOSITION} total={totalLiabilities} href="/liabilities" />
          <CompositionChart title="Equity Composition" data={EQUITY_COMPOSITION} total={totalEquity} href="/equity" />
        </div>

        {/* ── Working Capital Analysis ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Working Capital Analysis</h3>
            <p className="text-slate-500 text-xs mt-0.5">Current Assets − Current Liabilities = Working Capital</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-1">
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Current Assets</span>
                    <span className="text-sm font-bold text-slate-800">{fx(currentAssets.total)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Current Liabilities</span>
                    <span className="text-sm font-bold text-red-600">({fx(currentLiabilities.total)})</span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">Working Capital</span>
                    <span className="text-lg font-bold text-emerald-600">{fx(workingCapital)}</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Current', value: currentRatio.toFixed(2) + 'x' },
                    { label: 'Quick', value: quickRatio.toFixed(2) + 'x' },
                    { label: 'Cash', value: cashRatio.toFixed(2) + 'x' },
                  ].map(r => (
                    <div key={r.label} className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-teal-600 font-medium">{r.label} Ratio</p>
                      <p className="text-base font-bold text-teal-700">{r.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lg:col-span-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Monthly Working Capital Trend</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={BS_MONTHLY_TREND.map(d => ({
                    month: d.month,
                    workingCapital: (d.assets * 0.72) - (d.liabilities * 0.78),
                  }))} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                    <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="workingCapital" name="Working Capital" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* ── Balance Sheet Statement ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <ScaleIcon className="w-4 h-4 text-teal-500" />
                Balance Sheet Statement
              </h3>
              <p className="text-slate-500 text-xs mt-0.5">Expandable account hierarchy with period comparison</p>
            </div>
          </div>
          {/* Table Header */}
          <div className="flex items-center gap-2 py-2.5 px-4 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span className="flex-1">Account</span>
            <span className="w-28 text-right">Current Period</span>
            <span className="w-28 text-right">Previous Period</span>
            <span className="w-20 text-right">Change</span>
            <span className="w-16 text-right">Change %</span>
            <span className="w-14 text-right">% of Total</span>
          </div>

          {/* ASSETS */}
          <div className="border-b border-slate-200">
            <div className="px-4 py-2.5 bg-teal-50 border-b border-teal-100">
              <span className="text-sm font-bold text-teal-800 uppercase tracking-wide">ASSETS</span>
            </div>
            <AccountSection
              title={currentAssets.label}
              items={currentAssets.items}
              total={currentAssets.total}
              prevTotal={currentAssets.prevTotal}
              totalAssetsForPct={totalAssets}
              colorClass="text-slate-600"
            />
            <AccountSection
              title={nonCurrentAssets.label}
              items={nonCurrentAssets.items}
              total={nonCurrentAssets.total}
              prevTotal={nonCurrentAssets.prevTotal}
              totalAssetsForPct={totalAssets}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-teal-50 border-t border-teal-100">
              <span className="text-sm font-bold text-teal-800 flex-1">Total Assets</span>
              <span className="text-sm font-bold text-right w-28 text-teal-800">{fx(totalAssets)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevTotalAssets)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">{assetsChangePct >= 0 ? '+' : ''}{fx(totalAssets - prevTotalAssets)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">{assetsChangePct >= 0 ? '+' : ''}{assetsChangePct.toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">100%</span>
            </div>
          </div>

          {/* LIABILITIES */}
          <div className="border-b border-slate-200">
            <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
              <span className="text-sm font-bold text-red-800 uppercase tracking-wide">LIABILITIES</span>
            </div>
            <AccountSection
              title={currentLiabilities.label}
              items={currentLiabilities.items}
              total={currentLiabilities.total}
              prevTotal={currentLiabilities.prevTotal}
              totalAssetsForPct={totalAssets}
              colorClass="text-slate-600"
            />
            <AccountSection
              title={nonCurrentLiabilities.label}
              items={nonCurrentLiabilities.items}
              total={nonCurrentLiabilities.total}
              prevTotal={nonCurrentLiabilities.prevTotal}
              totalAssetsForPct={totalAssets}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-red-50 border-t border-red-100">
              <span className="text-sm font-bold text-red-800 flex-1">Total Liabilities</span>
              <span className="text-sm font-bold text-right w-28 text-red-800">{fx(totalLiabilities)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevTotalLiabilities)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">{fx(totalLiabilities - prevTotalLiabilities)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">{liabChangePct.toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">{totalAssets ? ((totalLiabilities / totalAssets) * 100).toFixed(1) : '0.0'}%</span>
            </div>
          </div>

          {/* EQUITY */}
          <div>
            <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
              <span className="text-sm font-bold text-indigo-800 uppercase tracking-wide">EQUITY</span>
            </div>
            <AccountSection
              title={equity.label}
              items={equity.items}
              total={equity.total}
              prevTotal={equity.prevTotal}
              totalAssetsForPct={totalAssets}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-indigo-50 border-t border-indigo-100">
              <span className="text-sm font-bold text-indigo-800 flex-1">Total Equity</span>
              <span className="text-sm font-bold text-right w-28 text-indigo-800">{fx(totalEquity)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevTotalEquity)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">{equityChangePct >= 0 ? '+' : ''}{fx(totalEquity - prevTotalEquity)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">{equityChangePct >= 0 ? '+' : ''}{equityChangePct.toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">{totalAssets ? ((totalEquity / totalAssets) * 100).toFixed(1) : '0.0'}%</span>
            </div>
            <div className="flex items-center gap-2 py-3 px-4 bg-slate-800 border-t-2 border-slate-700">
              <span className="text-sm font-bold text-white flex-1">Total Liabilities + Equity</span>
              <span className="text-sm font-bold text-right w-28 text-white">{fx(totalLiabilities + totalEquity)}</span>
              <span className="text-sm text-right w-28 text-slate-400">{fx(prevTotalLiabilities + prevTotalEquity)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-400">{fx((totalLiabilities + totalEquity) - (prevTotalLiabilities + prevTotalEquity))}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-400">
                {(prevTotalLiabilities + prevTotalEquity) ? ((((totalLiabilities + totalEquity) - (prevTotalLiabilities + prevTotalEquity)) / (prevTotalLiabilities + prevTotalEquity)) * 100).toFixed(1) : '0.0'}%
              </span>
              <span className="text-xs text-slate-400 text-right w-14">100%</span>
            </div>
          </div>
        </div>

        {/* ── AI Insights ── */}
        <AIInsightsPanel title="AI Financial Position Insights" insights={BS_AI_INSIGHTS} />

      </div>
    </>
  );
}