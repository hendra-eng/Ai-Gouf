import React from 'react';
import { TrendingUp, TrendingDown, Lightbulb, Info } from 'lucide-react';

const composition = [
  { id: 'ci-sc',  label: 'Share Capital',      pct: 52.4, color: 'bg-primary'          },
  { id: 'ci-ap',  label: 'APIC',               pct: 13.8, color: 'bg-primary/50'        },
  { id: 'ci-re',  label: 'Retained Earnings',  pct: 32.0, color: 'bg-positive'          },
  { id: 'ci-oci', label: 'OCI',                pct:  0.9, color: 'bg-muted-foreground'  },
  { id: 'ci-oe',  label: 'Other',              pct:  0.9, color: 'bg-border'            },
];

export default function EquityMovementInsights() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Lightbulb size={14} className="text-primary" />
        </div>
        <div>
          <h2 className="text-[14px] font-bold text-foreground">Equity Movement Analysis</h2>
          <p className="text-[11px] text-muted-foreground">Jan – Aug 2026</p>
        </div>
      </div>

      <div className="p-3 bg-muted/50 rounded-xl border border-border/60">
        <p className="text-[12px] text-foreground leading-relaxed">
          Closing equity increased by{' '}
          <span className="font-semibold text-positive">$2.09M (+24.8%)</span>{' '}
          primarily due to current-period profitability of{' '}
          <span className="font-semibold">$1.84M</span> and additional capital
          contributions of <span className="font-semibold">$750K</span>.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--positive-bg)] border border-[var(--positive-light)]">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-[var(--positive-light)]">
              <TrendingUp size={12} className="text-positive" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Largest Positive Movement</div>
              <div className="text-[12px] font-semibold text-foreground">Net Profit</div>
            </div>
          </div>
          <span className="text-[13px] font-bold text-positive tabular-nums">+$1.84M</span>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--negative-bg)] border border-[var(--negative-light)]">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-[var(--negative-light)]">
              <TrendingDown size={12} className="text-negative" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Largest Negative Movement</div>
              <div className="text-[12px] font-semibold text-foreground">Dividends</div>
            </div>
          </div>
          <span className="text-[13px] font-bold text-negative tabular-nums">($420K)</span>
        </div>
      </div>

      {/* Composition bar */}
      <div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Equity Composition</div>
        <div className="flex rounded-full overflow-hidden h-2">
          {composition?.map(c => (
            <div key={c?.id} className={c?.color} style={{ width: `${c?.pct}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {composition?.map(c => (
            <div key={`leg-${c?.id}`} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm ${c?.color}`} />
              <span className="text-[10px] text-muted-foreground">{c?.label}</span>
              <span className="text-[10px] font-semibold text-foreground">{c?.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground mt-auto">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>Based on unaudited interim figures. Subject to year-end audit adjustments.</span>
      </div>
    </div>
  );
}