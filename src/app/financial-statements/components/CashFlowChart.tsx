'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useLanguage } from '@/lib/language';

// Backend integration point: replace with /api/statements/cash-flow/monthly
const cfMonthly = [
  { month: 'Jan', operating: 195, investing: -88, financing: -42 },
  { month: 'Feb', operating: 218, investing: -120, financing: -28 },
  { month: 'Mar', operating: 240, investing: -65, financing: -185 },
  { month: 'Apr', operating: 225, investing: -95, financing: 120 },
  { month: 'May', operating: 198, investing: -72, financing: -18 },
  { month: 'Jun', operating: 262, investing: -110, financing: -22 },
  { month: 'Jul', operating: 244, investing: -58, financing: -5 },
  { month: 'Aug', operating: 218, investing: -47, financing: -5 },
];

function CustomTooltip({ active, payload, label, t }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; t: (text: string) => string }) {
  if (!active || !payload?.length) return null;
  const net = (payload[0]?.value || 0) + (payload[1]?.value || 0) + (payload[2]?.value || 0);
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-4">
      <p className="text-sm font-bold text-foreground mb-2 pb-2 border-b border-border">{label}</p>
      {payload.map((entry) => (
        <div key={`cftip-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-xs text-muted-foreground">{t(entry.name)}</span>
          </div>
          <span className={`text-xs font-semibold font-mono ${entry.value >= 0 ? 'text-positive' : 'text-negative'}`}>
            {entry.value >= 0 ? '+' : ''}Rp {entry.value}Jt
          </span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('Net Cash')}</span>
        <span className={`text-xs font-bold font-mono ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
          {net >= 0 ? '+' : ''}Rp {net}Jt
        </span>
      </div>
    </div>
  );
}

export default function CashFlowChart() {
  const { t } = useLanguage();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={cfMonthly} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barSize={20} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${v}Jt`}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip content={<CustomTooltip t={t} />} />
        <Legend
          iconType="square"
          iconSize={10}
          wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-plus-jakarta-sans)', paddingTop: 12 }}
          formatter={(value: string) => t(value)}
        />
        <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
        <Bar dataKey="operating" name="Operating" fill="var(--positive)" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
        <Bar dataKey="investing" name="Investing" fill="var(--negative)" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
        <Bar dataKey="financing" name="Financing" fill="var(--warning)" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
