'use client';

import React, { useState, useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { purchaseTransactions, purchaseExceptions, purchaseOverviewKPIs, vendors } from '@/data/purchaseData';
import {
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';


const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const monthlyTrend = [
  { month: 'Apr', amount: 312000, count: 8 },
  { month: 'May', amount: 428000, count: 11 },
  { month: 'Jun', amount: 389000, count: 9 },
  { month: 'Jul', amount: 501000, count: 13 },
  { month: 'Aug', amount: 465000, count: 12 },
  { month: 'Sep', amount: 543862, count: 12 },
];

const categoryData = [
  { name: 'IT Equipment', value: 241840 },
  { name: 'Raw Materials', value: 158962 },
  { name: 'Professional Services', value: 71120 },
  { name: 'Logistics', value: 31976 },
  { name: 'Marketing', value: 39200 },
  { name: 'Office Supplies', value: 55549 },
  { name: 'Maintenance', value: 13888 },
];

const COLORS = ['#1E40AF', '#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B'];

const statusDist = [
  { name: 'Posted', value: 6, color: '#15803D' },
  { name: 'Approved', value: 2, color: '#0369A1' },
  { name: 'Pending Review', value: 2, color: '#D97706' },
  { name: 'Exception', value: 1, color: '#C2410C' },
  { name: 'Cancelled', value: 1, color: '#64748B' },
];

const paymentStatusDist = [
  { name: 'Unpaid', value: 4, color: '#DC2626' },
  { name: 'Paid', value: 5, color: '#15803D' },
  { name: 'Partially Paid', value: 1, color: '#D97706' },
  { name: 'Overdue', value: 1, color: '#C2410C' },
  { name: 'On Hold', value: 1, color: '#64748B' },
];

// Top vendors by spend
const topVendors = vendors
  .map(v => ({
    ...v,
    totalSpend: purchaseTransactions.filter(p => p.vendorId === v.id).reduce((s, p) => s + p.total, 0),
    txCount: purchaseTransactions.filter(p => p.vendorId === v.id).length,
  }))
  .filter(v => v.totalSpend > 0)
  .sort((a, b) => b.totalSpend - a.totalSpend)
  .slice(0, 6);

const recentActivity = purchaseTransactions
  .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
  .slice(0, 6);

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

export default function PurchaseOverviewPage() {
  const kpis = purchaseOverviewKPIs;

  const kpiCards = [
    {
      label: 'Total Purchases',
      value: kpis.totalPurchases.toString(),
      sub: 'All transactions',
      icon: 'ShoppingBagIcon',
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      trend: '+3 this week',
      up: true,
    },
    {
      label: 'Purchase Amount',
      value: fmt(kpis.totalAmount),
      sub: 'Gross purchase value',
      icon: 'CurrencyDollarIcon',
      color: 'text-slate-700',
      bg: 'bg-slate-50',
      trend: '+16.7% vs last month',
      up: true,
    },
    {
      label: 'Outstanding AP',
      value: fmt(kpis.totalAP),
      sub: 'Accounts payable balance',
      icon: 'BanknotesIcon',
      color: 'text-red-700',
      bg: 'bg-red-50',
      trend: 'Unpaid & overdue',
      up: false,
    },
    {
      label: 'Pending Review',
      value: kpis.pendingReview.toString(),
      sub: 'Awaiting approval',
      icon: 'ClockIcon',
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      trend: 'Action required',
      up: false,
    },
    {
      label: 'Posted',
      value: kpis.posted.toString(),
      sub: 'Finalized to GL',
      icon: 'CheckCircleIcon',
      color: 'text-green-700',
      bg: 'bg-green-50',
      trend: 'This period',
      up: true,
    },
    {
      label: 'Exceptions',
      value: kpis.exceptions.toString(),
      sub: 'Require attention',
      icon: 'ExclamationTriangleIcon',
      color: 'text-orange-700',
      bg: 'bg-orange-50',
      trend: `${purchaseExceptions.filter(e => e.status === 'Open').length} open`,
      up: false,
    },
    {
      label: 'Input Tax (VAT)',
      value: fmt(kpis.totalTax),
      sub: 'Recoverable input tax',
      icon: 'ChartBarIcon',
      color: 'text-purple-700',
      bg: 'bg-purple-50',
      trend: 'Avg 12% rate',
      up: true,
    },
    {
      label: 'Overdue Amount',
      value: fmt(kpis.overdueAmount),
      sub: 'Past payment due date',
      icon: 'ExclamationTriangleIcon',
      color: 'text-red-700',
      bg: 'bg-red-50',
      trend: 'Immediate action',
      up: false,
    },
  ];

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* KPI Grid — desain disamakan dengan shared KpiCard (dipakai di
            Sales), data & isi tetap sama seperti sebelumnya. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpiCards.map((card) => (
            <KpiCard
              key={card.label}
              title={card.label}
              value={card.value}
              subLabel={card.sub}
              icon={card.icon}
              iconColor={card.color}
              iconBg={card.bg}
              change={card.trend}
              changePositive={card.up}
            />
          ))}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Purchase Trend */}
          <div className="je-card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase Volume Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Monthly purchase amount (last 6 months)</p>
              </div>
              <ArrowTrendingUpIcon className="w-4 h-4 text-muted-foreground" />
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number) => [fmt(value), 'Amount']}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E2E8F0' }}
                />
                <Bar dataKey="amount" fill="#1E40AF" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Status Distribution */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase Status</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Current distribution</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={statusDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                  {statusDist.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number, name: string) => [v, name]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {statusDist.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-semibold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Category Breakdown */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase by Category</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Spend distribution by category</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v: number) => [fmt(v), 'Amount']} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                <Bar dataKey="value" fill="#0EA5E9" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Payment Status */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Payment Status Overview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">AP payment distribution</p>
              </div>
            </div>
            <div className="space-y-3 mt-2">
              {paymentStatusDist.map((item) => {
                const pct = Math.round((item.value / 12) * 100);
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-foreground font-medium">{item.name}</span>
                      </div>
                      <span className="text-muted-foreground tabular-nums">{item.value} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-3">
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-red-600 font-medium">Overdue AP</p>
                <p className="text-base font-bold text-red-700 tabular-nums mt-0.5">{fmt(kpis.overdueAmount)}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-600 font-medium">Outstanding AP</p>
                <p className="text-base font-bold text-amber-700 tabular-nums mt-0.5">{fmt(kpis.totalAP)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Top Vendors + Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Vendors */}
          <div className="je-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BuildingStorefrontIcon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Top Vendors by Spend</h3>
            </div>
            <div className="space-y-3">
              {topVendors.map((vendor, idx) => {
                const maxSpend = topVendors[0].totalSpend;
                const pct = Math.round((vendor.totalSpend / maxSpend) * 100);
                return (
                  <div key={vendor.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                        <div>
                          <p className="font-medium text-foreground">{vendor.name}</p>
                          <p className="text-muted-foreground">{vendor.txCount} transaction{vendor.txCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <span className="font-bold text-foreground tabular-nums">{fmt(vendor.totalSpend)}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 ml-7">
                      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Recent Purchase Activity</h3>
              <span className="text-xs text-muted-foreground">Last 6 transactions</span>
            </div>
            <div className="space-y-3">
              {recentActivity.map((tx) => (
                <div key={tx.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-primary">{tx.purchaseId}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[tx.status]}`}>
                        {statusLabels[tx.status]}
                      </span>
                    </div>
                    <p className="text-xs text-foreground mt-0.5 truncate">{tx.vendor}</p>
                    <p className="text-xs text-muted-foreground">{tx.purchaseDate} · {tx.category}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold tabular-nums text-foreground">{fmt(tx.total)}</p>
                    <p className="text-xs text-muted-foreground">{tx.currency}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Exception Summary */}
        <div className="je-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-foreground">Exception Summary</h3>
            </div>
            <a href="/purchase/exceptions" className="text-xs text-primary hover:underline font-medium">View all exceptions →</a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Exceptions', value: purchaseExceptions.length, color: 'text-slate-700', bg: 'bg-slate-50' },
              { label: 'Open', value: purchaseExceptions.filter(e => e.status === 'Open').length, color: 'text-red-700', bg: 'bg-red-50' },
              { label: 'Under Review', value: purchaseExceptions.filter(e => e.status === 'Under Review').length, color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Resolved', value: purchaseExceptions.filter(e => e.status === 'Resolved').length, color: 'text-green-700', bg: 'bg-green-50' },
            ].map(card => (
              <div key={card.label} className={`${card.bg} rounded-lg p-3`}>
                <p className={`text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
                <p className="text-xs font-medium text-foreground mt-1">{card.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {purchaseExceptions.filter(e => e.status === 'Open' || e.status === 'Under Review').slice(0, 3).map(exc => (
              <div key={exc.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${exc.severity === 'Critical' ? 'bg-red-500' : exc.severity === 'High' ? 'bg-orange-500' : 'bg-amber-400'}`} />
                  <span className="text-xs font-medium text-foreground">{exc.purchaseId}</span>
                  <span className="text-xs text-muted-foreground">— {exc.exceptionType}</span>
                </div>
                <span className={`text-xs font-semibold ${exc.severity === 'Critical' ? 'text-red-700' : exc.severity === 'High' ? 'text-orange-700' : 'text-amber-700'}`}>{exc.severity}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}