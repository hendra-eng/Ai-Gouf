'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const waterfallData = [
  { name: 'Revenue', value: 8420000000, type: 'positive' },
  { name: 'COGS', value: -4700000000, type: 'negative' },
  { name: 'Gross Profit', value: 3720000000, type: 'subtotal' },
  { name: 'Opex', value: -1390000000, type: 'negative' },
  { name: 'EBITDA', value: 2330000000, type: 'subtotal' },
  { name: 'D&A', value: -180000000, type: 'negative' },
  { name: 'EBIT', value: 2150000000, type: 'subtotal' },
  { name: 'Tax', value: -310000000, type: 'negative' },
  { name: 'Net Profit', value: 1840000000, type: 'result' },
];

const monthlyProfit = [
  { month: 'Jan', revenue: 950, cogs: 545, grossProfit: 405, opex: 165, netProfit: 190 },
  { month: 'Feb', revenue: 1020, cogs: 580, grossProfit: 440, opex: 170, netProfit: 230 },
  { month: 'Mar', revenue: 1080, cogs: 610, grossProfit: 470, opex: 175, netProfit: 260 },
  { month: 'Apr', revenue: 1050, cogs: 620, grossProfit: 430, opex: 182, netProfit: 210 },
  { month: 'May', revenue: 1120, cogs: 645, grossProfit: 475, opex: 185, netProfit: 250 },
  { month: 'Jun', revenue: 1090, cogs: 640, grossProfit: 450, opex: 188, netProfit: 230 },
  { month: 'Jul', revenue: 1150, cogs: 665, grossProfit: 485, opex: 190, netProfit: 260 },
  { month: 'Aug', revenue: 1160, cogs: 680, grossProfit: 480, opex: 195, netProfit: 240 },
];

const drivers = [
  { category: 'Revenue Growth', impact: +285000000, type: 'positive', description: 'New contracts from PT Global Teknindo and CV Berkah Mandiri' },
  { category: 'COGS Increase', impact: -195000000, type: 'negative', description: 'Raw material costs +8.4%, partially offset by volume efficiency' },
  { category: 'Opex Increase', impact: -142000000, type: 'negative', description: 'IT infrastructure +Rp 96M, marketing +Rp 46M' },
  { category: 'Collection Improvement', impact: +68000000, type: 'positive', description: 'AR collection rate improved in Feb–Mar' },
  { category: 'Tax Adjustment', impact: -28000000, type: 'negative', description: 'Prior year tax provision adjustment' },
];

const fmt = (v: number) => `${(v / 1000000000).toFixed(2)}B`;
const fmtM = (v: number) => `${v}M`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-600 text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`ptt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-600 text-foreground">{fx(`Rp ${p.value}M`)}</span>
        </div>
      ))}
    </div>
  );
};

export default function ProfitAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [drillLevel, setDrillLevel] = useState(0);
  const [drillPath, setDrillPath] = useState<string[]>([]);

  const handleDrill = (item: string) => {
    setDrillLevel((l) => l + 1);
    setDrillPath((p) => [...p, item]);
  };

  return (
    <div className="space-y-5">
      {/* Executive Summary */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-600 text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Net profit for Jan–Aug 2026 is <strong>{fx('Rp 1.84B')}</strong>, representing a margin of <strong>21.8%</strong> on revenue of {fx('Rp 8.42B')}.
          While revenue grew +12.8% vs the same period last year, net profit growth was constrained to +8.4% due to two primary pressures:
          operating expenses increased +7.1% driven by IT infrastructure investment, and COGS rose +8.4% due to raw material cost inflation.
          The margin compression is <strong>partially structural</strong> and partially cyclical — Q3 should see normalization as the IT project completes.
        </p>
      </div>

      {/* Key Findings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: 'ArrowTrendingUpIcon', color: 'text-success', bg: 'bg-success-bg', label: 'Revenue Growth', value: '+12.8%', desc: 'vs Jan–Aug 2025' },
          { icon: 'ArrowTrendingDownIcon', color: 'text-danger', bg: 'bg-danger-bg', label: 'Margin Compression', value: '-1.2pp', desc: 'Gross margin vs prior year' },
          { icon: 'ExclamationTriangleIcon', color: 'text-warning', bg: 'bg-warning-bg', label: 'Opex Growth', value: '+7.1%', desc: 'Above revenue growth rate' },
        ].map((f) => (
          <div key={`finding-${f.label}`} className={`${f.bg} border rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon name={f.icon as any} size={16} className={f.color} />
              <span className="text-sm font-600 text-foreground">{f.label}</span>
            </div>
            <p className={`text-2xl font-700 tabular-nums ${f.color}`}>{f.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Monthly Trend Chart */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-1">Monthly P&L Trend</h3>
        <p className="text-xs text-muted-foreground mb-4">Revenue, COGS, Gross Profit, Opex, Net Profit — Jan–Aug 2026 (Rp Million)</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={monthlyProfit} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cogs" name="COGS" stroke="var(--danger)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="grossProfit" name="Gross Profit" stroke="var(--success)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="opex" name="Opex" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="var(--ai-purple)" strokeWidth={2} dot={{ fill: 'var(--ai-purple)', r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Performance Drivers */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-4">Performance Drivers</h3>
        <div className="space-y-3">
          {drivers.map((d) => (
            <div key={`driver-${d.category}`} className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${d.type === 'positive' ? 'bg-success-bg' : 'bg-danger-bg'}`}>
                <Icon name={d.type === 'positive' ? 'ArrowTrendingUpIcon' : 'ArrowTrendingDownIcon'} size={14} className={d.type === 'positive' ? 'text-success' : 'text-danger'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-600 text-foreground">{d.category}</p>
                  <span className={`text-sm font-700 tabular-nums flex-shrink-0 ${d.type === 'positive' ? 'text-success' : 'text-danger'}`}>
                    {d.impact < 0 ? '-' : '+'}{fx(`Rp ${(Math.abs(d.impact) / 1000000).toFixed(0)}M`)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{fx(d.description)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Investigation Drill-Down */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="MagnifyingGlassIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-600 text-foreground">Investigation: Why is Opex Increasing?</h3>
        </div>

        {/* Drill path */}
        {drillPath.length > 0 && (
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <button onClick={() => { setDrillLevel(0); setDrillPath([]); }} className="text-xs text-primary hover:underline">Operating Expenses</button>
            {drillPath.map((p, i) => (
              <React.Fragment key={`drill-path-${i}`}>
                <Icon name="ChevronRightIcon" size={12} className="text-muted-foreground" />
                <button onClick={() => { setDrillLevel(i + 1); setDrillPath(drillPath.slice(0, i + 1)); }} className="text-xs text-primary hover:underline">{p}</button>
              </React.Fragment>
            ))}
          </div>
        )}

        {drillLevel === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">{fx('Total Opex: Rp 1.39B — click to investigate each category')}</p>
            {[
              { name: 'IT Infrastructure', amount: 385000000, change: '+28.4%', pct: 27.7, color: 'bg-danger' },
              { name: 'Salaries & Benefits', amount: 420000000, change: '+5.2%', pct: 30.2, color: 'bg-primary' },
              { name: 'Marketing', amount: 198000000, change: '+12.8%', pct: 14.2, color: 'bg-warning' },
              { name: 'Rent & Utilities', amount: 145000000, change: '+2.1%', pct: 10.4, color: 'bg-info' },
              { name: 'Other Opex', amount: 242000000, change: '+4.5%', pct: 17.5, color: 'bg-muted-foreground' },
            ].map((item) => (
              <div
                key={`opex-${item.name}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(item.name)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-500 text-foreground">{item.name}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-600 ${item.change.startsWith('+') ? 'text-danger' : 'text-success'}`}>{item.change}</span>
                      <span className="text-sm font-600 tabular-nums text-foreground">{fx(`Rp ${(item.amount / 1000000).toFixed(0)}M`)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
          </div>
        )}

        {drillLevel === 1 && drillPath[0] === 'IT Infrastructure' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">{fx('IT Infrastructure: Rp 385M — drilling into vendor breakdown')}</p>
            {[
              { vendor: 'PT Infratech Solusi', amount: 185000000, category: 'Server & Network', invoices: 2, status: 'Overdue' },
              { vendor: 'PT Daya Cipta Digital', amount: 68000000, category: 'Software Licenses', invoices: 1, status: 'Due Soon' },
              { vendor: 'PT Cloud Asia', amount: 82000000, category: 'Cloud Services', invoices: 3, status: 'Paid' },
              { vendor: 'CV Tech Support', amount: 50000000, category: 'Maintenance', invoices: 2, status: 'Open' },
            ].map((item) => (
              <div
                key={`it-${item.vendor}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(item.vendor)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-500 text-foreground">{item.vendor}</span>
                    <span className="text-sm font-600 tabular-nums text-foreground">{fx(`Rp ${(item.amount / 1000000).toFixed(0)}M`)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">{item.category}</span>
                    <span className="text-xs text-muted-foreground">{item.invoices} invoice{item.invoices > 1 ? 's' : ''}</span>
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full font-600 ${item.status === 'Overdue' ? 'bg-danger-bg text-danger-foreground' : item.status === 'Due Soon' ? 'bg-warning-bg text-warning-foreground' : item.status === 'Paid' ? 'bg-success-bg text-success-foreground' : 'bg-secondary text-muted-foreground'}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
          </div>
        )}

        {drillLevel === 2 && drillPath[1] === 'PT Infratech Solusi' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-3">PT Infratech Solusi — outstanding invoices</p>
            {[
              { number: 'BILL-2026-0142', date: '2026-05-20', due: '2026-06-20', amount: 96000000, daysOverdue: 69 },
              { number: 'BILL-2026-0158', date: '2026-07-15', due: '2026-08-15', amount: 89000000, daysOverdue: 13 },
            ].map((bill) => (
              <div
                key={`bill-drill-${bill.number}`}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                onClick={() => handleDrill(bill.number)}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-600 text-primary">{bill.number}</span>
                    <span className="text-sm font-600 tabular-nums text-danger">{fx(`Rp ${(bill.amount / 1000000).toFixed(0)}M`)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">Due: {bill.due}</span>
                    <span className="text-xs font-600 text-danger">{bill.daysOverdue}d overdue</span>
                  </div>
                </div>
                <Icon name="ChevronRightIcon" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            ))}
            <div className="mt-3 p-3 bg-ai-purple-bg border border-purple-200 rounded-lg">
              <p className="text-xs text-ai-purple-foreground leading-relaxed">
                <strong>AI Insight:</strong> {fx('PT Infratech Solusi has Rp 185M overdue across 2 bills. This is the primary driver of IT infrastructure cost overrun. Immediate payment action required. Consider negotiating extended terms given the relationship size.')}
              </p>
              <button
                onClick={() => toast.info('Navigating to AP...')}
                className="text-xs text-ai-purple font-600 mt-1.5 hover:underline"
              >
                View in Accounts Payable →
              </button>
            </div>
          </div>
        )}

        {drillLevel >= 3 && (
          <div className="p-4 bg-secondary rounded-lg">
            <p className="text-sm font-600 text-foreground mb-2">{drillPath[drillPath.length - 1]}</p>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Journal Entry', value: 'JE-2026-4821' },
                { label: 'GL Account', value: '5200 — IT Expenses' },
                { label: 'Cost Center', value: 'CC-IT-001' },
                { label: 'Approved By', value: 'Rizky Wardana' },
                { label: 'Posted Date', value: '2026-06-20' },
              ].map((row) => (
                <div key={`je-${row.label}`} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-500 text-foreground">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recommendations */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-600 text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'High', title: 'Resolve IT Infrastructure Overrun', desc: 'Pay overdue bills to PT Infratech Solusi (Rp 185M) and renegotiate contract terms to prevent recurrence.', action: 'View AP', route: '/accounts-payable' },
            { priority: 'Medium', title: 'Accelerate AR Collections', desc: 'PT Mitra Solusi Digital owes Rp 320M overdue. Escalate to senior management and consider credit limit suspension.', action: 'View AR', route: '/accounts-receivable' },
            { priority: 'Low', title: 'Review Marketing Spend ROI', desc: 'Marketing expenses grew +12.8% but revenue attribution is unclear. Request performance analysis from marketing team.', action: 'View Transactions', route: '/transactions' },
          ].map((rec) => (
            <div key={`rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-600 flex-shrink-0 mt-0.5 ${
                rec.priority === 'High' ? 'bg-danger-bg text-danger-foreground' :
                rec.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                'bg-secondary text-muted-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-600 text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec.desc)}</p>
              </div>
              <button
                onClick={() => router.push(rec.route)}
                className="text-xs text-primary hover:underline font-500 flex-shrink-0 whitespace-nowrap"
              >
                {rec.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}