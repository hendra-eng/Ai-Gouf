'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import KPICard from '@/components/financial/KPICard';
import AIInsightsPanel from '@/components/financial/AIInsightsPanel';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import {
  BS_CORE, BS_MONTHLY_TREND, BS_AI_INSIGHTS, COMPANY
} from '@/lib/financialData';
import { useCurrency, formatMoney } from '@/lib/currency';
import {
  ChevronDownIcon, ChevronRightIcon, ArrowDownTrayIcon,
  CalendarIcon, BuildingOfficeIcon, CheckCircleIcon, ScaleIcon,
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

// ─── Balance Sheet Account Data ──────────────────────────────────────────────
const ASSETS_STRUCTURE = {
  currentAssets: {
    label: 'Current Assets',
    total: BS_CORE.cash + BS_CORE.accountsReceivable + BS_CORE.inventory + BS_CORE.prepaidExpenses + BS_CORE.otherCurrentAssets,
    items: [
      { name: 'Cash & Cash Equivalents', current: BS_CORE.cash, prev: 2480, href: '/assets' },
      { name: 'Accounts Receivable', current: BS_CORE.accountsReceivable, prev: 1080, href: '/accounts-receivable' },
      { name: 'Inventory', current: BS_CORE.inventory, prev: 320, href: '/assets' },
      { name: 'Prepaid Expenses', current: BS_CORE.prepaidExpenses, prev: 100, href: '/assets' },
      { name: 'Other Current Assets', current: BS_CORE.otherCurrentAssets, prev: 60, href: '/assets' },
    ],
  },
  nonCurrentAssets: {
    label: 'Non-Current Assets',
    total: BS_CORE.property + BS_CORE.equipment + BS_CORE.vehicles + BS_CORE.computerEquipment + BS_CORE.intangibleAssets + BS_CORE.otherNonCurrentAssets,
    items: [
      { name: 'Property', current: BS_CORE.property, prev: 820, href: '/assets' },
      { name: 'Equipment', current: BS_CORE.equipment, prev: 580, href: '/assets' },
      { name: 'Vehicles', current: BS_CORE.vehicles, prev: 180, href: '/assets' },
      { name: 'Computer Equipment', current: BS_CORE.computerEquipment, prev: 180, href: '/assets' },
      { name: 'Intangible Assets', current: BS_CORE.intangibleAssets, prev: 130, href: '/assets' },
      { name: 'Other Non-Current Assets', current: BS_CORE.otherNonCurrentAssets, prev: 50, href: '/assets' },
    ],
  },
};

const LIABILITIES_STRUCTURE = {
  currentLiabilities: {
    label: 'Current Liabilities',
    total: BS_CORE.accountsPayable + BS_CORE.taxPayable + BS_CORE.accruedExpenses + BS_CORE.payrollLiabilities + BS_CORE.shortTermDebt + BS_CORE.otherCurrentLiabilities,
    items: [
      { name: 'Accounts Payable', current: BS_CORE.accountsPayable, prev: 920, href: '/accounts-payable' },
      { name: 'Tax Payable', current: BS_CORE.taxPayable, prev: 210, href: '/liabilities' },
      { name: 'Accrued Expenses', current: BS_CORE.accruedExpenses, prev: 280, href: '/liabilities' },
      { name: 'Payroll Liabilities', current: BS_CORE.payrollLiabilities, prev: 200, href: '/liabilities' },
      { name: 'Short-Term Debt', current: BS_CORE.shortTermDebt, prev: 380, href: '/liabilities' },
      { name: 'Other Current Liabilities', current: BS_CORE.otherCurrentLiabilities, prev: 110, href: '/liabilities' },
    ],
  },
  nonCurrentLiabilities: {
    label: 'Non-Current Liabilities',
    total: BS_CORE.longTermDebt + BS_CORE.leaseLiabilities + BS_CORE.otherLongTermLiabilities,
    items: [
      { name: 'Long-Term Debt', current: BS_CORE.longTermDebt, prev: 200, href: '/liabilities' },
      { name: 'Lease Liabilities', current: BS_CORE.leaseLiabilities, prev: 80, href: '/liabilities' },
      { name: 'Other Long-Term Liabilities', current: BS_CORE.otherLongTermLiabilities, prev: 30, href: '/liabilities' },
    ],
  },
};

const EQUITY_STRUCTURE = {
  label: 'Shareholders\' Equity',
  total: BS_CORE.totalEquity,
  items: [
    { name: 'Paid-in Capital', current: BS_CORE.paidInCapital, prev: 1500, href: '/equity' },
    { name: 'Additional Paid-in Capital', current: BS_CORE.additionalPaidInCapital, prev: 500, href: '/equity' },
    { name: 'Retained Earnings', current: BS_CORE.retainedEarnings, prev: 440, href: '/equity' },
    { name: 'Current Year Profit', current: BS_CORE.currentYearProfit, prev: 1600, href: '/equity' },
    { name: 'Other Equity', current: BS_CORE.otherEquity, prev: 0, href: '/equity' },
  ],
};

const currentAssets = ASSETS_STRUCTURE.currentAssets.total;
const currentLiabilities = LIABILITIES_STRUCTURE.currentLiabilities.total;
const workingCapital = currentAssets - currentLiabilities;
const currentRatio = currentAssets / currentLiabilities;
const quickRatio = (currentAssets - BS_CORE.inventory) / currentLiabilities;
const cashRatio = BS_CORE.cash / currentLiabilities;
const debtToEquity = BS_CORE.totalLiabilities / BS_CORE.totalEquity;

// Asset Composition for Donut
const ASSET_COMPOSITION = [
  { name: 'Cash & Bank', value: BS_CORE.cash, color: '#0d9488' },
  { name: 'Accounts Receivable', value: BS_CORE.accountsReceivable, color: '#6366f1' },
  { name: 'Inventory', value: BS_CORE.inventory, color: '#f97316' },
  { name: 'Fixed Assets', value: BS_CORE.property + BS_CORE.equipment + BS_CORE.vehicles + BS_CORE.computerEquipment, color: '#10b981' },
  { name: 'Intangible Assets', value: BS_CORE.intangibleAssets, color: '#3b82f6' },
  { name: 'Other Assets', value: BS_CORE.prepaidExpenses + BS_CORE.otherCurrentAssets + BS_CORE.otherNonCurrentAssets, color: '#8b5cf6' },
];

const LIABILITY_COMPOSITION = [
  { name: 'Accounts Payable', value: BS_CORE.accountsPayable, color: '#ef4444' },
  { name: 'Tax Payable', value: BS_CORE.taxPayable, color: '#f97316' },
  { name: 'Short-Term Debt', value: BS_CORE.shortTermDebt, color: '#f59e0b' },
  { name: 'Long-Term Debt', value: BS_CORE.longTermDebt, color: '#dc2626' },
  { name: 'Lease Liabilities', value: BS_CORE.leaseLiabilities, color: '#b91c1c' },
  { name: 'Other Liabilities', value: BS_CORE.accruedExpenses + BS_CORE.payrollLiabilities + BS_CORE.otherCurrentLiabilities + BS_CORE.otherLongTermLiabilities, color: '#9f1239' },
];

const EQUITY_COMPOSITION = [
  { name: 'Paid-in Capital', value: BS_CORE.paidInCapital, color: '#0d9488' },
  { name: 'Additional Paid-in Capital', value: BS_CORE.additionalPaidInCapital, color: '#6366f1' },
  { name: 'Retained Earnings', value: BS_CORE.retainedEarnings, color: '#10b981' },
  { name: 'Current Year Profit', value: BS_CORE.currentYearProfit, color: '#059669' },
];

// ─── Account Section Component ───────────────────────────────────────────────
function AccountSection({
  title, items, total, prevTotal, indent = false, colorClass = 'text-slate-800',
}: {
  title: string;
  items: { name: string; current: number; prev: number; href?: string }[];
  total: number;
  prevTotal: number;
  indent?: boolean;
  colorClass?: string;
}) {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  const change = total - prevTotal;
  const changePct = prevTotal ? ((change / prevTotal) * 100) : 0;
  const totalPct = (total / BS_CORE.totalAssets) * 100;

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
          {items.map(item => {
            const ch = item.current - item.prev;
            const chPct = item.prev ? ((ch / item.prev) * 100) : 0;
            const pct = (item.current / BS_CORE.totalAssets) * 100;
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
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BalanceSheetPage() {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const bsTrendData = BS_MONTHLY_TREND;
  const prevAssets = 5820;
  const prevLiabilities = 2380;
  const prevEquity = 3440;

  function handleExport() {
    const rows = [
      ...ASSETS_STRUCTURE.currentAssets.items.map(i => ({ Section: 'Current Assets', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      ...ASSETS_STRUCTURE.nonCurrentAssets.items.map(i => ({ Section: 'Non-Current Assets', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Assets', Account: 'Total Assets', 'Current Period': BS_CORE.totalAssets, 'Previous Period': prevAssets },
      ...LIABILITIES_STRUCTURE.currentLiabilities.items.map(i => ({ Section: 'Current Liabilities', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      ...LIABILITIES_STRUCTURE.nonCurrentLiabilities.items.map(i => ({ Section: 'Non-Current Liabilities', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Liabilities', Account: 'Total Liabilities', 'Current Period': BS_CORE.totalLiabilities, 'Previous Period': prevLiabilities },
      ...EQUITY_STRUCTURE.items.map(i => ({ Section: 'Equity', Account: i.name, 'Current Period': i.current, 'Previous Period': i.prev })),
      { Section: 'Equity', Account: 'Total Equity', 'Current Period': BS_CORE.totalEquity, 'Previous Period': prevEquity },
    ];
    downloadCsv(rows, `balance-sheet-${COMPANY.name.replace(/\s+/g, '-')}-${Date.now()}.csv`);
    toast.success('Export berhasil', { description: 'Balance Sheet diunduh sebagai CSV.' });
  }

  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Balance Sheet</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyze the company&apos;s financial position, assets, liabilities, and equity</p>
      </div>
      <div className="p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5" />
              As of August 31, 2026
            </span>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <BuildingOfficeIcon className="w-3.5 h-3.5" />
              {COMPANY.name}
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
                <p className="text-2xl font-bold">✓ Balanced</p>
                <p className="text-teal-200 text-xs mt-0.5">Difference: Rp 0 · Assets = Liabilities + Equity</p>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-4 lg:ml-8">
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Assets</p>
                <p className="text-xl font-bold">{fx(BS_CORE.totalAssets)}</p>
                <p className="text-teal-200 text-xs mt-1">+{(((BS_CORE.totalAssets - prevAssets) / prevAssets) * 100).toFixed(1)}% YTD</p>
              </div>
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Liabilities</p>
                <p className="text-xl font-bold">{fx(BS_CORE.totalLiabilities)}</p>
                <p className="text-teal-200 text-xs mt-1">{(((BS_CORE.totalLiabilities - prevLiabilities) / prevLiabilities) * 100).toFixed(1)}% YTD</p>
              </div>
              <div className="bg-white/15 rounded-xl p-4 text-center">
                <p className="text-teal-100 text-xs font-medium mb-1">Total Equity</p>
                <p className="text-xl font-bold">{fx(BS_CORE.totalEquity)}</p>
                <p className="text-teal-200 text-xs mt-1">+{(((BS_CORE.totalEquity - prevEquity) / prevEquity) * 100).toFixed(1)}% YTD</p>
              </div>
            </div>
          </div>
          {/* Equation Visual */}
          <div className="mt-5 flex items-center justify-center gap-3 bg-white/10 rounded-xl py-3 px-4">
            <div className="text-center">
              <p className="text-xs text-teal-200">Assets</p>
              <p className="font-bold text-lg">{fx(BS_CORE.totalAssets)}</p>
            </div>
            <span className="text-2xl font-light text-teal-300">=</span>
            <div className="text-center">
              <p className="text-xs text-teal-200">Liabilities</p>
              <p className="font-bold text-lg">{fx(BS_CORE.totalLiabilities)}</p>
            </div>
            <span className="text-2xl font-light text-teal-300">+</span>
            <div className="text-center">
              <p className="text-xs text-teal-200">Equity</p>
              <p className="font-bold text-lg">{fx(BS_CORE.totalEquity)}</p>
            </div>
          </div>
        </div>

        {/* ── Financial Position KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard title="Total Assets" value={fx(BS_CORE.totalAssets)} change={17.5} previousValue={fx(prevAssets)} sparkline={bsTrendData.map(d => d.assets)} status="positive" />
          <KPICard title="Total Liabilities" value={fx(BS_CORE.totalLiabilities)} change={-10.1} previousValue={fx(prevLiabilities)} sparkline={bsTrendData.map(d => d.liabilities)} status="positive" />
          <KPICard title="Total Equity" value={fx(BS_CORE.totalEquity)} change={36.6} previousValue={fx(prevEquity)} sparkline={bsTrendData.map(d => d.equity)} status="positive" />
          <KPICard title="Working Capital" value={fx(workingCapital)} change={22.4} previousValue={fx(1750)} status="positive" />
          <KPICard title="Current Ratio" value={`${currentRatio.toFixed(2)}x`} change={8.2} previousValue="2.63x" status="positive" />
          <KPICard title="Debt-to-Equity" value={`${debtToEquity.toFixed(2)}x`} change={-34.2} previousValue="0.69x" status="positive" />
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
                  <AreaChart data={bsTrendData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
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
                    { label: 'Assets', value: BS_CORE.totalAssets, total: BS_CORE.totalAssets, color: '#0d9488' },
                    { label: 'Equity', value: BS_CORE.totalEquity, total: BS_CORE.totalAssets, color: '#6366f1' },
                    { label: 'Liabilities', value: BS_CORE.totalLiabilities, total: BS_CORE.totalAssets, color: '#ef4444' },
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
                          style={{ width: `${(item.value / item.total) * 100}%`, background: item.color }}
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
          <CompositionChart title="Asset Composition" data={ASSET_COMPOSITION} total={BS_CORE.totalAssets} href="/assets" />
          <CompositionChart title="Liability Composition" data={LIABILITY_COMPOSITION} total={BS_CORE.totalLiabilities} href="/liabilities" />
          <CompositionChart title="Equity Composition" data={EQUITY_COMPOSITION} total={BS_CORE.totalEquity} href="/equity" />
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
                    <span className="text-sm font-bold text-slate-800">{fx(currentAssets)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Current Liabilities</span>
                    <span className="text-sm font-bold text-red-600">({fx(currentLiabilities)})</span>
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
              title={ASSETS_STRUCTURE.currentAssets.label}
              items={ASSETS_STRUCTURE.currentAssets.items}
              total={ASSETS_STRUCTURE.currentAssets.total}
              prevTotal={4040}
              colorClass="text-slate-600"
            />
            <AccountSection
              title={ASSETS_STRUCTURE.nonCurrentAssets.label}
              items={ASSETS_STRUCTURE.nonCurrentAssets.items}
              total={ASSETS_STRUCTURE.nonCurrentAssets.total}
              prevTotal={1780}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-teal-50 border-t border-teal-100">
              <span className="text-sm font-bold text-teal-800 flex-1">Total Assets</span>
              <span className="text-sm font-bold text-right w-28 text-teal-800">{fx(BS_CORE.totalAssets)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevAssets)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">+{fx(BS_CORE.totalAssets - prevAssets)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">+{(((BS_CORE.totalAssets - prevAssets) / prevAssets) * 100).toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">100%</span>
            </div>
          </div>

          {/* LIABILITIES */}
          <div className="border-b border-slate-200">
            <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
              <span className="text-sm font-bold text-red-800 uppercase tracking-wide">LIABILITIES</span>
            </div>
            <AccountSection
              title={LIABILITIES_STRUCTURE.currentLiabilities.label}
              items={LIABILITIES_STRUCTURE.currentLiabilities.items}
              total={LIABILITIES_STRUCTURE.currentLiabilities.total}
              prevTotal={2100}
              colorClass="text-slate-600"
            />
            <AccountSection
              title={LIABILITIES_STRUCTURE.nonCurrentLiabilities.label}
              items={LIABILITIES_STRUCTURE.nonCurrentLiabilities.items}
              total={LIABILITIES_STRUCTURE.nonCurrentLiabilities.total}
              prevTotal={280}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-red-50 border-t border-red-100">
              <span className="text-sm font-bold text-red-800 flex-1">Total Liabilities</span>
              <span className="text-sm font-bold text-right w-28 text-red-800">{fx(BS_CORE.totalLiabilities)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevLiabilities)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">{fx(BS_CORE.totalLiabilities - prevLiabilities)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">{(((BS_CORE.totalLiabilities - prevLiabilities) / prevLiabilities) * 100).toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">{((BS_CORE.totalLiabilities / BS_CORE.totalAssets) * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* EQUITY */}
          <div>
            <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
              <span className="text-sm font-bold text-indigo-800 uppercase tracking-wide">EQUITY</span>
            </div>
            <AccountSection
              title={EQUITY_STRUCTURE.label}
              items={EQUITY_STRUCTURE.items}
              total={EQUITY_STRUCTURE.total}
              prevTotal={prevEquity}
              colorClass="text-slate-600"
            />
            <div className="flex items-center gap-2 py-3 px-4 bg-indigo-50 border-t border-indigo-100">
              <span className="text-sm font-bold text-indigo-800 flex-1">Total Equity</span>
              <span className="text-sm font-bold text-right w-28 text-indigo-800">{fx(BS_CORE.totalEquity)}</span>
              <span className="text-sm text-right w-28 text-slate-500">{fx(prevEquity)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-600">+{fx(BS_CORE.totalEquity - prevEquity)}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-600">+{(((BS_CORE.totalEquity - prevEquity) / prevEquity) * 100).toFixed(1)}%</span>
              <span className="text-xs text-slate-400 text-right w-14">{((BS_CORE.totalEquity / BS_CORE.totalAssets) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-2 py-3 px-4 bg-slate-800 border-t-2 border-slate-700">
              <span className="text-sm font-bold text-white flex-1">Total Liabilities + Equity</span>
              <span className="text-sm font-bold text-right w-28 text-white">{fx(BS_CORE.totalLiabilities + BS_CORE.totalEquity)}</span>
              <span className="text-sm text-right w-28 text-slate-400">{fx(prevLiabilities + prevEquity)}</span>
              <span className="text-xs font-bold text-right w-20 text-emerald-400">+{fx((BS_CORE.totalLiabilities + BS_CORE.totalEquity) - (prevLiabilities + prevEquity))}</span>
              <span className="text-xs font-bold text-right w-16 text-emerald-400">+{((((BS_CORE.totalLiabilities + BS_CORE.totalEquity) - (prevLiabilities + prevEquity)) / (prevLiabilities + prevEquity)) * 100).toFixed(1)}%</span>
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