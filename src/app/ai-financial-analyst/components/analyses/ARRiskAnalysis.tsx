'use client';
import React from 'react';
import { useRouter } from 'next/navigation';

import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { customers, invoices, arAgingData, formatRupiah, riskColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-600 text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`artt-${i}`} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-600">{typeof p.value === 'number' && p.value > 1000 ? fx(`Rp ${(p.value / 1000000).toFixed(0)}M`) : `${p.value}%`}</span>
        </div>
      ))}
    </div>
  );
};

export default function ARRiskAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  const overdueCustomers = customers.filter((c) => c.overdueAR > 0).sort((a, b) => b.overdueAR - a.overdueAR);
  const overdueInvoices = invoices.filter((i) => i.status === 'Overdue').sort((a, b) => b.daysOverdue - a.daysOverdue);

  return (
    <div className="space-y-5">
      {/* Executive Summary */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-600 text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Total AR stands at <strong>{fx('Rp 1.24M')}</strong> with <strong>{fx('Rp 320M')} (25.8%) overdue</strong> — a concerning trend that has grown +18.4% vs the prior period.
          DSO has deteriorated to 42 days against a target of 35 days. The risk is concentrated in 2 customers:
          PT Mitra Solusi Digital ({fx('Rp 185M')}, 90+ days) and PT Sinar Harapan Nusantara ({fx('Rp 105M')}, 31–60 days).
          Immediate collection action is required on the critical accounts. Bad debt exposure of {fx('Rp 72M')} warrants provisioning review.
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total AR', value: 'Rp 1.24M', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Overdue AR', value: 'Rp 320M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: '90+ Days', value: 'Rp 85M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'DSO', value: '42 days', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Collection Rate', value: '87.4%', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Bad Debt Exposure', value: 'Rp 72M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Current AR', value: 'Rp 620M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Due This Week', value: 'Rp 142M', color: 'text-info', bg: 'bg-info-bg' },
        ].map((m) => (
          <div key={`arm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-700 tabular-nums ${m.color}`}>{fx(m.value)}</p>
          </div>
        ))}
      </div>

      {/* AR Aging Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5 shadow-card">
          <h3 className="text-md font-600 text-foreground mb-4">AR Aging Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={arAgingData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
                {arAgingData.map((entry, index) => (
                  <Cell key={`ar-age-cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 shadow-card">
          <h3 className="text-md font-600 text-foreground mb-4">Customer Concentration Risk</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={customers.slice(0, 5).map((c) => ({ name: c.name.replace('PT ', '').replace('CV ', ''), value: c.totalAR }))}
                cx="50%" cy="50%" outerRadius={80} paddingAngle={2} dataKey="value"
              >
                {customers.slice(0, 5).map((_, i) => (
                  <Cell key={`conc-ar-cell-${i}`} fill={['#DC2626', '#D97706', '#2563EB', '#16A34A', '#94A3B8'][i]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => [fx(`Rp ${(v / 1000000).toFixed(0)}M`), '']} />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-xs text-center text-muted-foreground mt-1">Top 3 customers = 59.1% of total AR</p>
        </div>
      </div>

      {/* High Risk Customers */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-600 text-foreground">High Risk Customer Analysis</h3>
          <button onClick={() => router.push('/accounts-receivable')} className="text-xs text-primary hover:underline font-500">View All →</button>
        </div>
        <div className="space-y-3">
          {overdueCustomers.slice(0, 4).map((c) => (
            <div key={`ar-risk-cust-${c.id}`} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-600 text-foreground truncate">{c.name}</p>
                  <StatusBadge label={c.riskLevel} className={riskColors[c.riskLevel]} />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Overdue: <strong className="text-danger">{fx(formatRupiah(c.overdueAR, true))}</strong></span>
                  <span>DSO: <strong className="text-warning">{c.dso}d</strong></span>
                  <span>Collection: <strong>{c.collectionRate}%</strong></span>
                </div>
              </div>
              <button
                onClick={() => router.push('/accounts-receivable')}
                className="text-xs text-primary hover:underline font-500 flex-shrink-0"
              >
                Collect →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Overdue Invoices */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-600 text-foreground">Critical Overdue Invoices</h3>
          <button onClick={() => router.push('/accounts-receivable')} className="text-xs text-primary hover:underline font-500">View All Invoices →</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Invoice', 'Customer', 'Amount', 'Days Overdue', 'Risk'].map((h) => (
                  <th key={`arri-${h}`} className="pb-2 text-left text-2xs font-600 text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overdueInvoices.slice(0, 5).map((inv) => (
                <tr key={inv.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-500 text-primary">{inv.number}</td>
                  <td className="py-2.5 text-foreground">{inv.customerName}</td>
                  <td className="py-2.5 tabular-nums font-600">{fx(formatRupiah(inv.outstanding, true))}</td>
                  <td className="py-2.5">
                    <span className={`font-600 ${inv.daysOverdue > 60 ? 'text-danger' : 'text-warning'}`}>{inv.daysOverdue}d</span>
                  </td>
                  <td className="py-2.5">
                    <StatusBadge
                      label={inv.priority}
                      className={inv.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' : 'bg-orange-50 text-orange-700'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-600 text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'Critical', title: 'Escalate PT Mitra Solusi Digital', desc: 'Rp 185M overdue 74+ days. Suspend credit, escalate to senior management, initiate legal review if no response within 7 days.', action: 'View Customer', route: '/accounts-receivable' },
            { priority: 'High', title: 'Contact PT Sinar Harapan Nusantara', desc: 'Rp 105M overdue 31 days. Schedule call with CFO, offer payment plan to prevent aging to 90+ days bucket.', action: 'View Customer', route: '/accounts-receivable' },
            { priority: 'Medium', title: 'Review Bad Debt Provision', desc: 'Rp 72M exposure warrants provisioning review. Consult with auditors on appropriate provision rate given current aging.', action: 'View Report', route: '/reports' },
          ].map((rec) => (
            <div key={`ar-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-600 flex-shrink-0 mt-0.5 ${
                rec.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' :
                rec.priority === 'High'? 'bg-orange-50 text-orange-700' : 'bg-warning-bg text-warning-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-600 text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec.desc)}</p>
              </div>
              <button onClick={() => router.push(rec.route)} className="text-xs text-primary hover:underline font-500 flex-shrink-0 whitespace-nowrap">
                {rec.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}