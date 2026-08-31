'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import KPICard from '@/components/financial/KPICard';
import AIInsightsPanel from '@/components/financial/AIInsightsPanel';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import {
  CF_CORE, CF_MONTHLY, CF_FORECAST, CF_AI_INSIGHTS, COMPANY, PL_CORE
} from '@/lib/financialData';
import { useCurrency, formatMoney } from '@/lib/currency';
import {
  ArrowDownTrayIcon, CalendarIcon, BuildingOfficeIcon,
  BanknotesIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon,
  ExclamationTriangleIcon, ChevronDownIcon, ChevronRightIcon,
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

// ─── Cash Flow Waterfall Data ─────────────────────────────────────────────────
const cfWaterfallRaw = [
  { name: 'Beginning Cash', value: CF_CORE.beginningCash, type: 'total', color: '#6366f1' },
  { name: 'Operating CF', value: CF_CORE.netOperatingCF, type: 'increase', color: '#0d9488' },
  { name: 'Investing CF', value: CF_CORE.netInvestingCF, type: 'decrease', color: '#ef4444' },
  { name: 'Financing CF', value: CF_CORE.netFinancingCF, type: 'decrease', color: '#f97316' },
  { name: 'Ending Cash', value: CF_CORE.endingCash, type: 'total', color: '#059669' },
];

function buildCFWaterfall() {
  let running = 0;
  return cfWaterfallRaw.map(d => {
    if (d.type === 'total') {
      running = d.value;
      return { ...d, base: 0, bar: d.value };
    } else if (d.type === 'increase') {
      const base = running;
      running += d.value;
      return { ...d, base, bar: d.value };
    } else {
      const base = running + d.value;
      running += d.value;
      return { ...d, base, bar: Math.abs(d.value) };
    }
  });
}
const cfWaterfall = buildCFWaterfall();

// ─── Operating Activities ─────────────────────────────────────────────────────
const OPERATING_ITEMS = [
  { name: 'Customer Collections', inflow: CF_CORE.customerCollections, outflow: 0, href: '/accounts-receivable' },
  { name: 'Other Operating Income', inflow: Math.abs(CF_CORE.otherOperatingCF), outflow: 0, href: '/transactions' },
  { name: 'Supplier Payments', inflow: 0, outflow: Math.abs(CF_CORE.supplierPayments), href: '/accounts-payable' },
  { name: 'Payroll Payments', inflow: 0, outflow: Math.abs(CF_CORE.payrollPayments), href: '/transactions' },
  { name: 'Tax Payments', inflow: 0, outflow: Math.abs(CF_CORE.taxPayments), href: '/transactions' },
  { name: 'Operating Expenses', inflow: 0, outflow: Math.abs(CF_CORE.operatingExpensesCF), href: '/transactions' },
];

const INVESTING_ITEMS = [
  { name: 'Asset Sales', inflow: Math.abs(CF_CORE.assetSales), outflow: 0, href: '/assets' },
  { name: 'Asset Purchases', inflow: 0, outflow: Math.abs(CF_CORE.assetPurchases), href: '/assets' },
  { name: 'Equipment Purchases', inflow: 0, outflow: Math.abs(CF_CORE.equipmentPurchases), href: '/assets' },
  { name: 'Investments', inflow: 0, outflow: Math.abs(CF_CORE.investments), href: '/assets' },
];

const FINANCING_ITEMS = [
  { name: 'Debt Proceeds', inflow: Math.abs(CF_CORE.debtProceeds), outflow: 0, href: '/liabilities' },
  { name: 'Debt Repayment', inflow: 0, outflow: Math.abs(CF_CORE.debtRepayment), href: '/liabilities' },
  { name: 'Dividend Payments', inflow: 0, outflow: Math.abs(CF_CORE.dividendPayments), href: '/equity' },
  { name: 'Lease Payments', inflow: 0, outflow: Math.abs(CF_CORE.leasePayments), href: '/liabilities' },
  { name: 'Other Financing', inflow: 0, outflow: Math.abs(CF_CORE.otherFinancingCF), href: '/transactions' },
];

// ─── Cash Flow Drivers ────────────────────────────────────────────────────────
const CF_INFLOWS = [
  { name: 'Customer Payments', value: CF_CORE.customerCollections, color: '#0d9488' },
  { name: 'Debt Proceeds', value: Math.abs(CF_CORE.debtProceeds), color: '#6366f1' },
  { name: 'Asset Sales', value: Math.abs(CF_CORE.assetSales), color: '#10b981' },
  { name: 'Other Income', value: Math.abs(CF_CORE.otherOperatingCF), color: '#3b82f6' },
];

const CF_OUTFLOWS = [
  { name: 'Vendor Payments', value: Math.abs(CF_CORE.supplierPayments), color: '#ef4444' },
  { name: 'Payroll', value: Math.abs(CF_CORE.payrollPayments), color: '#f97316' },
  { name: 'Taxes', value: Math.abs(CF_CORE.taxPayments), color: '#f59e0b' },
  { name: 'Operating Expenses', value: Math.abs(CF_CORE.operatingExpensesCF), color: '#dc2626' },
  { name: 'Asset Purchases', value: Math.abs(CF_CORE.assetPurchases) + Math.abs(CF_CORE.equipmentPurchases), color: '#b91c1c' },
  { name: 'Debt Repayment', value: Math.abs(CF_CORE.debtRepayment), color: '#9f1239' },
  { name: 'Dividends', value: Math.abs(CF_CORE.dividendPayments), color: '#7f1d1d' },
];

// ─── Recent Transactions ──────────────────────────────────────────────────────
const RECENT_TRANSACTIONS = [
  { date: '2026-08-28', id: 'TXN-2026-0842', type: 'Receipt', desc: 'Customer Payment - Bank Mandiri', account: 'Cash', inflow: 420, outflow: 0, party: 'Bank Mandiri', ref: 'INV-2026-0234', status: 'Completed' },
  { date: '2026-08-27', id: 'TXN-2026-0841', type: 'Payment', desc: 'Vendor Payment - PT Infratech', account: 'Bank BCA', inflow: 0, outflow: 180, party: 'PT Infratech', ref: 'PO-2026-0198', status: 'Completed' },
  { date: '2026-08-26', id: 'TXN-2026-0840', type: 'Payment', desc: 'Payroll - August 2026', account: 'Bank BCA', inflow: 0, outflow: 85, party: 'Employees', ref: 'PAY-2026-08', status: 'Completed' },
  { date: '2026-08-25', id: 'TXN-2026-0839', type: 'Receipt', desc: 'Customer Payment - Telkom', account: 'Cash', inflow: 315, outflow: 0, party: 'Telkom Indonesia', ref: 'INV-2026-0228', status: 'Completed' },
  { date: '2026-08-24', id: 'TXN-2026-0838', type: 'Payment', desc: 'Tax Payment - PPh 25', account: 'Bank BRI', inflow: 0, outflow: 54, party: 'DJP', ref: 'TAX-2026-08', status: 'Completed' },
  { date: '2026-08-22', id: 'TXN-2026-0837', type: 'Payment', desc: 'Equipment Purchase', account: 'Bank BCA', inflow: 0, outflow: 120, party: 'PT Lenovo Indonesia', ref: 'PO-2026-0195', status: 'Completed' },
];

// ─── Activity Section ─────────────────────────────────────────────────────────
function ActivitySection({
  title, items, totalInflow, totalOutflow, netCF, color, href,
}: {
  title: string;
  items: { name: string; inflow: number; outflow: number; href?: string }[];
  totalInflow: number;
  totalOutflow: number;
  netCF: number;
  color: string;
  href: string;
}) {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  const isPositive = netCF >= 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
      >
        {expanded ? <ChevronDownIcon className="w-4 h-4 text-slate-400" /> : <ChevronRightIcon className="w-4 h-4 text-slate-400" />}
        <div className="flex-1 text-left">
          <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-600 font-medium">In: {fx(totalInflow)}</span>
          <span className="text-red-500 font-medium">Out: ({fx(totalOutflow)})</span>
          <span className={`font-bold px-3 py-1 rounded-full text-xs ${isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
            Net: {isPositive ? '+' : ''}{fx(netCF)}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Activity</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-emerald-600 uppercase tracking-wide">Inflow</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-red-500 uppercase tracking-wide">Outflow</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Net</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const net = item.inflow - item.outflow;
                  return (
                    <tr key={item.name} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-2.5">
                        <Link href={item.href || '#'} className="text-slate-600 hover:text-teal-600 transition-colors">
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-emerald-600">
                        {item.inflow > 0 ? fx(item.inflow) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-red-500">
                        {item.outflow > 0 ? `(${fx(item.outflow)})` : '—'}
                      </td>
                      <td className={`px-5 py-2.5 text-right font-semibold ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {net >= 0 ? '+' : ''}{fx(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-bold">
                  <td className="px-5 py-3 text-sm text-slate-700">Net {title}</td>
                  <td className="px-5 py-3 text-right text-emerald-600">{fx(totalInflow)}</td>
                  <td className="px-5 py-3 text-right text-red-500">({fx(totalOutflow)})</td>
                  <td className={`px-5 py-3 text-right text-base ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {isPositive ? '+' : ''}{fx(netCF)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function CashFlowPage() {
  const { currency } = useCurrency();
  const fx = (v: number) => formatMoney(v * 1_000_000, currency);
  const [forecastRange, setForecastRange] = useState<'3M' | '6M' | '12M'>('6M');
  const [chartView, setChartView] = useState<'area' | 'bar'>('area');
  const [periodMode, setPeriodMode] = useState<'Actual' | 'Forecast'>('Actual');

  const monthlyBurn = Math.abs(CF_CORE.netOperatingCF - CF_CORE.customerCollections) / 8;
  const runway = CF_CORE.endingCash / monthlyBurn;
  const freeCashFlow = CF_CORE.netOperatingCF + CF_CORE.netInvestingCF;
  const cashConversion = (CF_CORE.netOperatingCF / PL_CORE.netProfit) * 100;
  const minCashThreshold = 800;

  const allCFData = [
    ...CF_MONTHLY.map(d => ({ ...d, isForecast: false })),
    ...CF_FORECAST.slice(0, forecastRange === '3M' ? 3 : forecastRange === '6M' ? 6 : 12),
  ];

  const operatingInflow = CF_CORE.customerCollections + Math.abs(CF_CORE.otherOperatingCF);
  const operatingOutflow = Math.abs(CF_CORE.supplierPayments) + Math.abs(CF_CORE.payrollPayments) + Math.abs(CF_CORE.taxPayments) + Math.abs(CF_CORE.operatingExpensesCF);
  const investingInflow = Math.abs(CF_CORE.assetSales);
  const investingOutflow = Math.abs(CF_CORE.assetPurchases) + Math.abs(CF_CORE.equipmentPurchases) + Math.abs(CF_CORE.investments);
  const financingInflow = Math.abs(CF_CORE.debtProceeds);
  const financingOutflow = Math.abs(CF_CORE.debtRepayment) + Math.abs(CF_CORE.dividendPayments) + Math.abs(CF_CORE.leasePayments) + Math.abs(CF_CORE.otherFinancingCF);

  function handlePeriodModeChange(mode: 'Actual' | 'Forecast') {
    setPeriodMode(mode);
    if (mode === 'Forecast') {
      document.getElementById('cash-flow-forecast')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleExport() {
    const rows = [
      { Item: 'Beginning Cash', Amount: CF_CORE.beginningCash },
      { Item: 'Operating Cash Flow', Amount: CF_CORE.netOperatingCF },
      { Item: 'Investing Cash Flow', Amount: CF_CORE.netInvestingCF },
      { Item: 'Financing Cash Flow', Amount: CF_CORE.netFinancingCF },
      { Item: 'Ending Cash', Amount: CF_CORE.endingCash },
      { Item: 'Net Change', Amount: CF_CORE.endingCash - CF_CORE.beginningCash },
      { Item: 'Operating Inflow', Amount: operatingInflow },
      { Item: 'Operating Outflow', Amount: operatingOutflow },
      { Item: 'Investing Inflow', Amount: investingInflow },
      { Item: 'Investing Outflow', Amount: investingOutflow },
      { Item: 'Financing Inflow', Amount: financingInflow },
      { Item: 'Financing Outflow', Amount: financingOutflow },
      { Item: 'Cash Runway (months)', Amount: Number(runway.toFixed(1)) },
      { Item: 'Free Cash Flow', Amount: freeCashFlow },
    ];
    downloadCsv(rows, `cash-flow-${COMPANY.name.replace(/\s+/g, '-')}-${Date.now()}.csv`);
    toast.success('Export berhasil', { description: 'Cash Flow Statement diunduh sebagai CSV.' });
  }

  return (
    <>
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Cash Flow</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor cash inflows, outflows, liquidity, and future cash position</p>
      </div>
      <div className="p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5" />
              January 2026 – August 2026
            </span>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <BuildingOfficeIcon className="w-3.5 h-3.5" />
              {COMPANY.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(['Actual', 'Forecast'] as const).map(m => (
              <button
                key={m}
                onClick={() => handlePeriodModeChange(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${periodMode === m ? 'bg-teal-500 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {m}
              </button>
            ))}
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        </div>

        {/* ── Cash Position Hero ── */}
        <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
                <BanknotesIcon className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="text-indigo-200 text-sm font-medium">Cash Position</p>
                <p className="text-4xl font-bold">{fx(CF_CORE.endingCash)}</p>
                <p className="text-indigo-200 text-xs mt-1">As of August 31, 2026</p>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-3 lg:ml-6">
              {[
                { label: 'Beginning Cash', value: CF_CORE.beginningCash, icon: '●' },
                { label: 'Cash Inflows', value: operatingInflow + investingInflow + financingInflow, icon: '▲', positive: true },
                { label: 'Cash Outflows', value: operatingOutflow + investingOutflow + financingOutflow, icon: '▼', positive: false },
                { label: 'Net Change', value: CF_CORE.endingCash - CF_CORE.beginningCash, icon: '◆', positive: (CF_CORE.endingCash - CF_CORE.beginningCash) >= 0 },
                { label: 'Ending Cash', value: CF_CORE.endingCash, icon: '●' },
              ].map(item => (
                <div key={item.label} className="bg-white/15 rounded-xl p-3 text-center">
                  <p className="text-indigo-200 text-[10px] font-medium mb-1">{item.label}</p>
                  <p className={`text-base font-bold ${item.positive === true ? 'text-emerald-300' : item.positive === false ? 'text-red-300' : 'text-white'}`}>
                    {item.positive === false ? `(${fx(item.value)})` : fx(Math.abs(item.value))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <KPICard title="Operating CF" value={fx(CF_CORE.netOperatingCF)} change={8.4} previousValue={fx(2620)} status="positive" sparkline={CF_MONTHLY.map(d => d.operatingCF)} />
          <KPICard title="Investing CF" value={fx(CF_CORE.netInvestingCF)} change={-12.0} previousValue={fx(-590)} status="neutral" sparkline={CF_MONTHLY.map(d => Math.abs(d.investingCF))} />
          <KPICard title="Financing CF" value={fx(CF_CORE.netFinancingCF)} change={-5.2} previousValue={fx(-686)} status="neutral" sparkline={CF_MONTHLY.map(d => Math.abs(d.financingCF))} />
          <KPICard title="Net Change" value={fx(CF_CORE.endingCash - CF_CORE.beginningCash)} change={22.1} previousValue={fx(920)} status="positive" sparkline={CF_MONTHLY.map(d => d.netChange)} />
          <KPICard title="Ending Cash" value={fx(CF_CORE.endingCash)} change={17.5} previousValue={fx(2520)} status="positive" sparkline={CF_MONTHLY.map(d => d.endCash)} />
          <KPICard title="Cash Runway" value={`${runway.toFixed(1)} mo`} change={4.3} previousValue="4.6 mo" status="positive" />
          <KPICard title="Free Cash Flow" value={fx(freeCashFlow)} change={6.8} previousValue={fx(2100)} status="positive" sparkline={CF_MONTHLY.map(d => d.operatingCF + d.investingCF)} />
          <KPICard title="Cash Conversion" value={`${cashConversion.toFixed(1)}%`} change={2.1} previousValue="152.5%" status="positive" />
        </div>

        {/* ── Cash Flow Movement Chart ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800">Cash Inflow vs Outflow</h3>
              <p className="text-slate-500 text-xs mt-0.5">Monthly cash movement by activity type</p>
            </div>
            <div className="flex items-center gap-2">
              {(['area', 'bar'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setChartView(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${chartView === v ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {v === 'area' ? 'Area' : 'Bar'}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={300}>
              {chartView === 'area' ? (
                <AreaChart data={CF_MONTHLY} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradOCF" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradEndCash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                  <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="operatingCF" name="Operating CF" stroke="#0d9488" strokeWidth={2.5} fill="url(#gradOCF)" dot={false} />
                  <Area type="monotone" dataKey="endCash" name="Ending Cash" stroke="#6366f1" strokeWidth={2} fill="url(#gradEndCash)" dot={false} />
                  <Area type="monotone" dataKey="netChange" name="Net Change" stroke="#f97316" strokeWidth={2} fill="none" dot={false} strokeDasharray="4 2" />
                </AreaChart>
              ) : (
                <ComposedChart data={CF_MONTHLY} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                  <Tooltip formatter={(v: any) => fx(v)} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="operatingCF" name="Operating CF" fill="#0d9488" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="netChange" name="Net Change" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Cash Flow Waterfall ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Cash Movement Waterfall</h3>
              <p className="text-slate-500 text-xs mt-0.5">Beginning Cash → Operating → Investing → Financing → Ending Cash</p>
            </div>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cfWaterfall} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
                  <Bar dataKey="bar" stackId="a" radius={[4, 4, 0, 0]}>
                    {cfWaterfall.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cash Runway */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Cash Runway</h3>
              <p className="text-slate-500 text-xs mt-0.5">Estimated months of operations</p>
            </div>
            <div className="p-5">
              <div className="text-center mb-5">
                <div className="relative w-32 h-32 mx-auto">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                    <circle
                      cx="60" cy="60" r="50" fill="none"
                      stroke={runway > 6 ? '#0d9488' : runway > 3 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="10"
                      strokeDasharray={`${(Math.min(runway, 12) / 12) * 314} 314`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-slate-800">{runway.toFixed(1)}</span>
                    <span className="text-xs text-slate-500">months</span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-3 text-center px-2">
                  Current cash reserves can cover approximately <strong>{runway.toFixed(1)} months</strong> of projected operating expenses.
                </p>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'Current Cash', value: fx(CF_CORE.endingCash) },
                  { label: 'Avg Monthly Burn', value: fx(monthlyBurn) },
                  { label: 'Estimated Runway', value: `${runway.toFixed(1)} months` },
                  { label: 'Min Cash Threshold', value: fx(minCashThreshold) },
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-slate-50">
                    <span className="text-xs text-slate-500">{item.label}</span>
                    <span className="text-xs font-semibold text-slate-800">{item.value}</span>
                  </div>
                ))}
              </div>
              {runway < 6 && (
                <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">Cash runway below 6-month threshold. Monitor cash position closely.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Activity Sections ── */}
        <ActivitySection
          title="Operating Cash Flow"
          items={OPERATING_ITEMS}
          totalInflow={operatingInflow}
          totalOutflow={operatingOutflow}
          netCF={CF_CORE.netOperatingCF}
          color="#0d9488"
          href="/transactions"
        />
        <ActivitySection
          title="Investing Activities"
          items={INVESTING_ITEMS}
          totalInflow={investingInflow}
          totalOutflow={investingOutflow}
          netCF={CF_CORE.netInvestingCF}
          color="#6366f1"
          href="/assets"
        />
        <ActivitySection
          title="Financing Activities"
          items={FINANCING_ITEMS}
          totalInflow={financingInflow}
          totalOutflow={financingOutflow}
          netCF={CF_CORE.netFinancingCF}
          color="#f97316"
          href="/liabilities"
        />

        {/* ── Cash Flow Drivers ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <ArrowTrendingUpIcon className="w-4 h-4 text-emerald-500" />
                Cash Inflow Drivers
              </h3>
            </div>
            <div className="p-5 space-y-3">
              {CF_INFLOWS.map(item => (
                <div key={item.name}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-600 font-medium">{item.name}</span>
                    <span className="text-xs font-bold text-slate-800">{fx(item.value)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${(item.value / CF_INFLOWS[0].value) * 100}%`, background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
                Cash Outflow Drivers
              </h3>
            </div>
            <div className="p-5 space-y-3">
              {CF_OUTFLOWS.map(item => (
                <div key={item.name}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-600 font-medium">{item.name}</span>
                    <span className="text-xs font-bold text-slate-800">({fx(item.value)})</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${(item.value / CF_OUTFLOWS[0].value) * 100}%`, background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Cash Flow Forecast ── */}
        <div id="cash-flow-forecast" className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800">Cash Flow Forecast</h3>
              <p className="text-slate-500 text-xs mt-0.5">
                <span className="text-teal-600 font-medium">Actual</span> data through Aug 2026 ·
                <span className="text-indigo-500 font-medium ml-1">Forecast</span> shown with dashed line — not actual results
              </p>
            </div>
            <div className="flex gap-1">
              {(['3M', '6M', '12M'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setForecastRange(r)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${forecastRange === r ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  +{r}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={allCFData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fx(v).replace(/^(Rp|S?\$)\s?/, '')} />
                <Tooltip
                  formatter={(v: any, name: string, props: any) => [fx(v), props.payload?.isForecast ? `${name} (Forecast)` : name]}
                  contentStyle={{ borderRadius: 8, fontSize: 11 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x="Aug" stroke="#94a3b8" strokeDasharray="4 2" label={{ value: 'Forecast →', position: 'top', fontSize: 10, fill: '#94a3b8' }} />
                <ReferenceLine y={minCashThreshold} stroke="#ef4444" strokeDasharray="4 2" label={{ value: 'Min Threshold', position: 'right', fontSize: 9, fill: '#ef4444' }} />
                <Area type="monotone" dataKey="endCash" name="Cash Position" stroke="#0d9488" strokeWidth={2.5} fill="url(#gradActual)" dot={false} />
                <Area type="monotone" dataKey="operatingCF" name="Operating CF" stroke="#6366f1" strokeWidth={2} fill="url(#gradForecast)" dot={false} strokeDasharray="0" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Forecast Table ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Projected Cash Position</h3>
            <p className="text-slate-500 text-xs mt-0.5">Forecast values are projections only — not actual financial results</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Month', 'Beginning Cash', 'Operating CF', 'Investing CF', 'Financing CF', 'Net Change', 'Ending Cash', 'Status'].map(h => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide ${h === 'Month' || h === 'Status' ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...CF_MONTHLY, ...CF_FORECAST.slice(0, forecastRange === '3M' ? 3 : 6)].map((row, i) => {
                  const isForecast = Boolean('isForecast' in row && row.isForecast);
                  const isWarning = row.endCash < minCashThreshold * 1.5;
                  return (
                    <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isForecast ? 'bg-indigo-50/30' : ''}`}>
                      <td className="px-4 py-2.5 text-sm font-medium text-slate-700">
                        {String(row.month)}
                        {isForecast && <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold">Forecast</span>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-slate-600">{fx(row.beginCash)}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium ${row.operatingCF >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fx(row.operatingCF)}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium ${row.investingCF >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fx(row.investingCF)}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-medium ${row.financingCF >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fx(row.financingCF)}</td>
                      <td className={`px-4 py-2.5 text-sm text-right font-bold ${row.netChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {row.netChange >= 0 ? '+' : ''}{fx(row.netChange)}
                      </td>
                      <td className={`px-4 py-2.5 text-sm text-right font-bold ${isWarning ? 'text-amber-600' : 'text-slate-800'}`}>{fx(row.endCash)}</td>
                      <td className="px-4 py-2.5 text-sm text-left">
                        {isForecast ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isWarning ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                            {isWarning ? '⚠ Watch' : '◆ Projected'}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ Actual</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Cash Flow Health ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Cash Flow Health</h3>
            <p className="text-slate-500 text-xs mt-0.5">Key cash flow quality metrics</p>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'OCF Margin', current: `${((CF_CORE.netOperatingCF / 8420) * 100).toFixed(1)}%`, prev: '31.1%', trend: 'up', benchmark: '28%' },
              { label: 'Free Cash Flow', current: fx(freeCashFlow), prev: fx(2100), trend: 'up', benchmark: '—' },
              { label: 'Cash Conversion', current: `${cashConversion.toFixed(1)}%`, prev: '152.5%', trend: 'up', benchmark: '100%' },
              { label: 'OCF / Net Profit', current: `${(CF_CORE.netOperatingCF / PL_CORE.netProfit).toFixed(2)}x`, prev: '1.52x', trend: 'up', benchmark: '1.0x' },
              { label: 'CapEx', current: fx(Math.abs(CF_CORE.assetPurchases) + Math.abs(CF_CORE.equipmentPurchases)), prev: fx(580), trend: 'down', benchmark: '—' },
              { label: 'Cash Burn Rate', current: fx(monthlyBurn) + '/mo', prev: fx(monthlyBurn * 0.95) + '/mo', trend: 'neutral', benchmark: '—' },
            ].map(m => (
              <div key={m.label} className="bg-slate-50 rounded-xl p-3.5">
                <p className="text-xs text-slate-500 font-medium mb-2">{m.label}</p>
                <p className="text-base font-bold text-slate-800 mb-1">{m.current}</p>
                <p className="text-xs text-slate-400">Prev: {m.prev}</p>
                {m.benchmark !== '—' && <p className="text-xs text-teal-600 mt-0.5">Benchmark: {m.benchmark}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Cash Transactions ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">Recent Cash Transactions</h3>
              <p className="text-slate-500 text-xs mt-0.5">Click a transaction to view details</p>
            </div>
            <Link href="/transactions" className="text-xs text-teal-600 hover:text-teal-700 font-medium">View All →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Date', 'ID', 'Type', 'Description', 'Account', 'Inflow', 'Outflow', 'Party', 'Status'].map(h => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide ${['Inflow', 'Outflow'].includes(h) ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECENT_TRANSACTIONS.map(tx => (
                  <tr key={tx.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5 text-xs text-slate-500">{tx.date}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-teal-600">{tx.id}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tx.type === 'Receipt' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-700 max-w-[180px] truncate">{tx.desc}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{tx.account}</td>
                    <td className="px-4 py-2.5 text-xs text-right font-semibold text-emerald-600">
                      {tx.inflow > 0 ? fx(tx.inflow) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right font-semibold text-red-500">
                      {tx.outflow > 0 ? `(${fx(tx.outflow)})` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{tx.party}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── AI Insights ── */}
        <AIInsightsPanel title="AI Cash Flow Insights" insights={CF_AI_INSIGHTS} />

      </div>
    </>
  );
}