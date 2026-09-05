'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { useLanguage } from '@/lib/language';

/* Waterfall data: base = invisible stack, bar = visible portion */
const raw = [
  { id: 'w-open',    name: 'Opening\nEquity',         absolute: 8420,   type: 'base',     display: '$8.42M'  },
  { id: 'w-capital', name: 'Capital\nContributions',  absolute: 750,    type: 'positive', display: '+$750K'  },
  { id: 'w-profit',  name: 'Net\nProfit',             absolute: 1840,   type: 'positive', display: '+$1.84M' },
  { id: 'w-div',     name: 'Dividends',               absolute: -420,   type: 'negative', display: '($420K)' },
  { id: 'w-adj',     name: 'Other\nAdjustments',      absolute: -85,    type: 'negative', display: '($85K)'  },
  { id: 'w-close',   name: 'Closing\nEquity',         absolute: 10505,  type: 'base',     display: '$10.51M' },
];

const COLORS = {
  base:     'var(--primary)',
  positive: 'var(--positive)',
  negative: 'var(--negative)',
};

/* Compute base (transparent stack) and visible bar */
const data = raw.map((item, idx) => {
  if (item.type === 'base') return { ...item, base: 0, bar: item.absolute };
  let running = 8420;
  for (let i = 1; i < idx; i++) running += raw[i].absolute;
  if (item.absolute >= 0) return { ...item, base: running, bar: item.absolute };
  return { ...item, base: running + item.absolute, bar: Math.abs(item.absolute) };
});

const fmtY = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}M` : `$${v}K`;

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: typeof data[0] }>;
  t: (text: string) => string;
}

function CustomTooltip({ active, payload, t }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cls = d.type === 'positive' ? 'text-positive' : d.type === 'negative' ? 'text-negative' : 'text-primary';
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-float text-sm min-w-32">
      <div className="font-semibold text-foreground mb-1 text-xs">{d.name.replace('\n', ' ')}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>{d.display}</div>
      <div className="text-[10px] text-muted-foreground mt-1 capitalize">
        {d.type === 'base' ? t('Balance') : t(`${d.type} movement`)}
      </div>
    </div>
  );
}

export default function EquityBridgeChartInner() {
  const { t } = useLanguage();
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Equity Movement Bridge')}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {t('How opening equity changed to closing equity — Jan to Aug 2026')}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] flex-wrap">
          {[
            { id: 'leg-balance',  color: 'bg-primary',  label: 'Balance'  },
            { id: 'leg-positive', color: 'bg-positive', label: 'Positive' },
            { id: 'leg-negative', color: 'bg-negative', label: 'Negative' },
          ].map(l => (
            <div key={l.id} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
              <span className="text-muted-foreground">{t(l.label)}</span>
            </div>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.map(d => ({ ...d, name: t(d.name) }))} margin={{ top: 28, right: 16, left: 0, bottom: 16 }} barCategoryGap="32%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-sans)' }}
            axisLine={false} tickLine={false} interval={0}
          />
          <YAxis
            tickFormatter={fmtY}
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-sans)' }}
            axisLine={false} tickLine={false} domain={[0, 12000]} width={52}
          />
          <Tooltip content={<CustomTooltip t={t} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
          {/* Invisible base */}
          <Bar dataKey="base" stackId="wf" fill="transparent" />
          {/* Visible colored bar */}
          <Bar dataKey="bar" stackId="wf" radius={[5, 5, 0, 0]}>
            {data.map(entry => (
              <Cell key={`cell-${entry.id}`} fill={COLORS[entry.type as keyof typeof COLORS]} />
            ))}
            <LabelList
              dataKey="display"
              position="top"
              style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'var(--font-sans)',
                fill: 'var(--foreground)',
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-between mt-2 pt-3 border-t border-border text-[11px]">
        <span className="font-medium text-foreground">{t('Opening')}: $8,420,000</span>
        <span className="font-semibold text-positive">{t('Net change')}: +$2,085,000</span>
        <span className="font-medium text-foreground">{t('Closing')}: $10,505,000</span>
      </div>
    </div>
  );
}