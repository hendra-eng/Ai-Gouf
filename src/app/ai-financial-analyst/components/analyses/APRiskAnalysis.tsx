'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { vendors, bills, apAgingData, formatRupiah, riskColors, apStatusColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-600 text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`aptt2-${i}`} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-600">{fx(`Rp ${(p.value / 1000000).toFixed(0)}M`)}</span>
        </div>
      ))}
    </div>
  );
};

export default function APRiskAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();
  const overdueVendors = vendors.filter((v) => v.overdueAP > 0).sort((a, b) => b.overdueAP - a.overdueAP);
  const urgentBills = bills.filter((b) => b.status === 'Overdue' || b.status === 'Due Soon').sort((a, b) => b.daysOverdue - a.daysOverdue);

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-600 text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Total AP stands at <strong>{fx('Rp 860M')}</strong> with <strong>{fx('Rp 96M')} (11.2%) overdue</strong> — primarily concentrated in PT Infratech Solusi ({fx('Rp 185M')} total, {fx('Rp 96M')} overdue).
          An additional <strong>{fx('Rp 142M')} is due this week</strong> requiring immediate cash allocation. Average payment days have drifted to 36 days,
          slightly above the 30-day target. Cash requirement for the next 30 days is {fx('Rp 320M')}. Vendor relationship risk is elevated with PT Infratech Solusi.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total AP', value: 'Rp 860M', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Overdue AP', value: 'Rp 96M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Due This Week', value: 'Rp 142M', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Due This Month', value: 'Rp 320M', color: 'text-info', bg: 'bg-info-bg' },
          { label: 'Avg Payment Days', value: '36 days', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Vendor Concentration', value: '62%', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Current AP', value: 'Rp 540M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Payment Forecast', value: 'Rp 480M', color: 'text-primary', bg: 'bg-info-bg' },
        ].map((m) => (
          <div key={`apm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-700 tabular-nums ${m.color}`}>{fx(m.value)}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-4">AP Aging Distribution</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={apAgingData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
              {apAgingData.map((entry, index) => (
                <Cell key={`ap-age-cell2-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-600 text-foreground">Overdue Vendor Obligations</h3>
          <button onClick={() => router.push('/accounts-payable')} className="text-xs text-primary hover:underline font-500">View All →</button>
        </div>
        <div className="space-y-3">
          {overdueVendors.map((v) => (
            <div key={`ap-risk-vend-${v.id}`} className="flex items-center gap-3 p-3 border border-danger/20 bg-danger-bg/30 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-600 text-foreground truncate">{v.name}</p>
                  <StatusBadge label={v.riskLevel} className={riskColors[v.riskLevel]} />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Overdue: <strong className="text-danger">{fx(formatRupiah(v.overdueAP, true))}</strong></span>
                  <span>Total AP: <strong>{fx(formatRupiah(v.totalAP, true))}</strong></span>
                  <span>Terms: <strong>{v.paymentTerms}</strong></span>
                </div>
              </div>
              <button onClick={() => router.push('/accounts-payable')} className="text-xs text-primary hover:underline font-500 flex-shrink-0">
                Pay Now →
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-600 text-foreground">Urgent Bills Requiring Action</h3>
          <button onClick={() => router.push('/accounts-payable')} className="text-xs text-primary hover:underline font-500">View All Bills →</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Bill', 'Vendor', 'Amount', 'Due Date', 'Status'].map((h) => (
                  <th key={`apb-${h}`} className="pb-2 text-left text-2xs font-600 text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {urgentBills.slice(0, 6).map((bill) => (
                <tr key={bill.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-500 text-primary">{bill.number}</td>
                  <td className="py-2.5 text-foreground truncate max-w-[140px]">{bill.vendorName}</td>
                  <td className="py-2.5 tabular-nums font-600">{fx(formatRupiah(bill.outstanding, true))}</td>
                  <td className="py-2.5 text-xs text-muted-foreground">{bill.dueDate}</td>
                  <td className="py-2.5">
                    <StatusBadge label={bill.status} className={apStatusColors[bill.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-600 text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'Critical', title: 'Pay PT Infratech Solusi Immediately', desc: 'Rp 96M overdue 69 days. Service disruption risk is high. Wire payment today and negotiate remaining Rp 89M for next week.', action: 'Schedule Payment', route: '/accounts-payable' },
            { priority: 'High', title: 'Allocate Cash for This Week\'s Obligations', desc: 'Rp 142M due this week across 3 bills. Ensure cash reserves are sufficient and approve payments before due dates.', action: 'Payment Planning', route: '/accounts-payable' },
            { priority: 'Medium', title: 'Review Vendor Concentration Risk', desc: 'PT Infratech Solusi represents 21.5% of total AP. Consider diversifying IT infrastructure vendors to reduce dependency.', action: 'View Vendors', route: '/accounts-payable' },
          ].map((rec) => (
            <div key={`ap-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
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