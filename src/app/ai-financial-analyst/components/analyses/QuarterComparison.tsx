'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import Icon from '@/components/ui/AppIcon';

const comparisonData = [
  { metric: 'Revenue', q1: 3050, q2: 3260, change: 6.9, unit: 'M' },
  { metric: 'Gross Profit', q1: 1315, q2: 1355, change: 3.0, unit: 'M' },
  { metric: 'Gross Margin', q1: 43.1, q2: 41.6, change: -1.5, unit: '%' },
  { metric: 'Operating Exp', q1: 512, q2: 555, change: 8.4, unit: 'M' },
  { metric: 'EBITDA', q1: 803, q2: 800, change: -0.4, unit: 'M' },
  { metric: 'Net Profit', q1: 680, q2: 710, change: 4.4, unit: 'M' },
  { metric: 'Cash Flow', q1: 373, q2: 287, change: -23.1, unit: 'M' },
  { metric: 'AR Balance', q1: 1038, q2: 1155, change: 11.3, unit: 'M' },
  { metric: 'AP Balance', q1: 678, q2: 795, change: 17.3, unit: 'M' },
];

const chartData = [
  { name: 'Revenue', Q1: 3050, Q2: 3260 },
  { name: 'Gross Profit', Q1: 1315, Q2: 1355 },
  { name: 'EBITDA', Q1: 803, Q2: 800 },
  { name: 'Net Profit', Q1: 680, Q2: 710 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`qtt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">Rp {p.value}M</span>
        </div>
      ))}
    </div>
  );
};

export default function QuarterComparison() {
  return (
    <div className="space-y-6">
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Q2 2026 showed <strong>revenue growth of +6.9%</strong> vs Q1, driven by new contract wins. However, gross margin contracted 1.5pp to 41.6%
          due to higher COGS. Operating expenses grew +8.4%, outpacing revenue growth — the primary margin compression driver.
          EBITDA was essentially flat (-0.4%) while net profit improved +4.4% due to lower tax provisions.
          A concerning trend is the <strong>AR balance growing +11.3%</strong> and <strong>AP growing +17.3%</strong> — working capital deterioration that warrants attention.
        </p>
      </div>

      {/* Side-by-side comparison table */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card overflow-x-auto">
        <h3 className="text-md font-semibold text-foreground mb-4">Q1 vs Q2 2026 — Detailed Comparison</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Metric</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Q1 2026</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Q2 2026</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
              <th className="pb-2 text-right text-2xs font-semibold text-muted-foreground uppercase tracking-wider">% Change</th>
            </tr>
          </thead>
          <tbody>
            {comparisonData.map((row) => {
              const isPositive = row.metric === 'Operating Exp' || row.metric === 'AR Balance' || row.metric === 'AP Balance'
                ? row.change < 0
                : row.change > 0;
              const isNeutral = Math.abs(row.change) < 1;
              return (
                <tr key={`qc-${row.metric}`} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-medium text-foreground">{row.metric}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.unit === '%' ? `${row.q1}%` : `Rp ${row.q1}M`}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {row.unit === '%' ? `${row.q2}%` : `Rp ${row.q2}M`}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    <span className={isNeutral ? 'text-muted-foreground' : isPositive ? 'text-success' : 'text-danger'}>
                      {row.change > 0 ? '+' : ''}{row.unit === '%' ? `${row.change}pp` : `Rp ${Math.abs(row.q2 - row.q1)}M`}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                      isNeutral ? 'bg-secondary text-muted-foreground' :
                      isPositive ? 'bg-success-bg text-success-foreground': 'bg-danger-bg text-danger-foreground'
                    }`}>
                      {row.change > 0 ? '+' : ''}{row.change}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-4">Key Metrics — Q1 vs Q2 (Rp Million)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${v}M`} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Q1" name="Q1 2026" fill="var(--muted)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Q2" name="Q2 2026" fill="var(--primary)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Interpretation</h3>
        </div>
        <div className="space-y-3">
          {[
            { type: 'positive', title: 'Revenue momentum is strong', desc: '+6.9% Q-on-Q revenue growth is above industry average. New contracts are materializing into bookings.' },
            { type: 'warning', title: 'Opex growing faster than revenue', desc: '+8.4% opex vs +6.9% revenue — margin compression will continue unless opex is controlled in Q3.' },
            { type: 'negative', title: 'Working capital deteriorating', desc: 'AR +11.3% and AP +17.3% Q-on-Q indicates cash conversion cycle is lengthening. Requires immediate management attention.' },
            { type: 'neutral', title: 'EBITDA stability maintained', desc: 'Despite margin pressure, EBITDA remained flat — operational efficiency is largely preserved.' },
          ].map((insight) => (
            <div
              key={`qi-${insight.title}`}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                insight.type === 'positive' ? 'bg-success-bg border-green-200' :
                insight.type === 'warning' ? 'bg-warning-bg border-yellow-200' :
                insight.type === 'negative'? 'bg-danger-bg border-red-200' : 'bg-secondary border-border'
              }`}
            >
              <Icon
                name={insight.type === 'positive' ? 'CheckCircleIcon' : insight.type === 'warning' ? 'ExclamationTriangleIcon' : insight.type === 'negative' ? 'XCircleIcon' : 'InformationCircleIcon'}
                size={16}
                className={insight.type === 'positive' ? 'text-success' : insight.type === 'warning' ? 'text-warning' : insight.type === 'negative' ? 'text-danger' : 'text-muted-foreground'}
              />
              <div>
                <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{insight.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}