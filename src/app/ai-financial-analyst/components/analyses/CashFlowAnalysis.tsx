'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const cashFlowData = [
  { month: 'Jan', operating: 285000000, investing: -120000000, financing: -45000000, net: 120000000 },
  { month: 'Feb', operating: 310000000, investing: -85000000, financing: -50000000, net: 175000000 },
  { month: 'Mar', operating: 265000000, investing: -145000000, financing: -42000000, net: 78000000 },
  { month: 'Apr', operating: 298000000, investing: -98000000, financing: -48000000, net: 152000000 },
  { month: 'May', operating: 245000000, investing: -210000000, financing: -52000000, net: -17000000 },
  { month: 'Jun', operating: 322000000, investing: -115000000, financing: -55000000, net: 152000000 },
  { month: 'Jul', operating: 338000000, investing: -92000000, financing: -58000000, net: 188000000 },
  { month: 'Aug', operating: 195000000, investing: -68000000, financing: -42000000, net: 85000000 },
];

const fmtM = (v: number) => `${(v / 1000000).toFixed(0)}M`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-600 text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`cftt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className={`font-600 ${p.value < 0 ? 'text-danger' : 'text-foreground'}`}>{fx(`Rp ${fmtM(p.value)}`)}</span>
        </div>
      ))}
    </div>
  );
};

export default function CashFlowAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-600 text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Operating cash flow YTD is <strong>{fx('Rp 2.26M')}</strong>, healthy and sufficient to cover operations.
          However, investing activities consumed <strong>{fx('Rp 933M')}</strong> — primarily the IT infrastructure investment in Q2.
          Net cash position stands at <strong>{fx('Rp 2.96M')}</strong> with an estimated <strong>4.8 month runway</strong> at current burn rate.
          May was the only negative net cash flow month (-{fx('Rp 17M')}) due to peak infrastructure spend. Cash runway is adequate but AR collection improvement would significantly strengthen the position.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Opening Cash (Jan)', value: 'Rp 2.07M', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Operating CF', value: 'Rp 2.26M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Investing CF', value: '-Rp 933M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Financing CF', value: '-Rp 392M', color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Net Cash Flow', value: 'Rp 933M', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Closing Cash (Aug)', value: 'Rp 2.96M', color: 'text-primary', bg: 'bg-info-bg' },
          { label: 'Cash Runway', value: '4.8 months', color: 'text-success', bg: 'bg-success-bg' },
          { label: 'AR Impact', value: 'Rp 320M', color: 'text-warning', bg: 'bg-warning-bg' },
        ].map((m) => (
          <div key={`cfm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-700 tabular-nums ${m.color}`}>{fx(m.value)}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-1">Monthly Cash Flow Components</h3>
        <p className="text-xs text-muted-foreground mb-4">Operating, Investing, Financing, and Net Cash Flow — Jan–Aug 2026</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={cashFlowData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="operating" name="Operating CF" fill="var(--success)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="investing" name="Investing CF" fill="var(--danger)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="financing" name="Financing CF" fill="var(--warning)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="net" name="Net CF" fill="var(--primary)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-600 text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'High', title: 'Accelerate AR Collections to Improve Cash', desc: 'Collecting Rp 320M overdue AR would increase cash position by 10.8%, extending runway to 5.3+ months.', action: 'View AR', route: '/accounts-receivable' },
            { priority: 'Medium', title: 'Monitor Investing Outflows', desc: 'IT infrastructure investment is winding down. Ensure Q4 investing CF stays below Rp 100M to maintain healthy net cash.', action: 'View Transactions', route: '/transactions' },
            { priority: 'Low', title: 'Review AP Payment Timing', desc: 'Optimizing AP payment timing (pay closer to due dates) could improve working capital by Rp 80–120M.', action: 'View AP', route: '/accounts-payable' },
          ].map((rec) => (
            <div key={`cf-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-600 flex-shrink-0 mt-0.5 ${
                rec.priority === 'High' ? 'bg-orange-50 text-orange-700' :
                rec.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                'bg-secondary text-muted-foreground'
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