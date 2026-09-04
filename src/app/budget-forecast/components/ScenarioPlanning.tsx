'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';
import { useCashFlowData } from '@/app/financial-statements/lib/useCashFlowData';

type ScenarioKey = 'Base Case' | 'Optimistic' | 'Conservative';

export default function ScenarioPlanning() {
  const [active, setActive] = useState<ScenarioKey>('Base Case');
  const { fx } = useCurrency();
  const { lines } = useBudgetData();
  const { CF_CORE } = useCashFlowData();

  // Base Case = proyeksi full-year run-rate (real, dari budgetBridge).
  // Optimistic/Conservative menerapkan sensitivitas pertumbuhan +/-6pp
  // terhadap base case -- pola umum skenario planning, bukan angka acak.
  const SCENARIOS: Record<ScenarioKey, { description: string; revenueGrowth: number; revenue: number; ebitda: number; netProfit: number; endingCash: number; confidence: number }> = useMemo(() => {
    const baseGrowth = lines.revenue.budget !== 0 ? ((lines.revenue.forecast - lines.revenue.budget) / lines.revenue.budget) * 100 : 0;
    const scale = (v: number, factor: number) => Math.round(v * factor * 1_000_000);
    return {
      'Base Case': {
        description: 'Full-year run-rate projection based on posted transactions',
        revenueGrowth: Math.round(baseGrowth * 10) / 10,
        revenue: scale(lines.revenue.forecast, 1),
        ebitda: scale(lines.ebitda.forecast, 1),
        netProfit: scale(lines.netProfit.forecast, 1),
        endingCash: CF_CORE.endingCash * 1_000_000,
        confidence: 80,
      },
      'Optimistic': {
        description: 'Higher revenue growth driven by new deals, controlled expenses',
        revenueGrowth: Math.round((baseGrowth + 6) * 10) / 10,
        revenue: scale(lines.revenue.forecast, 1.08),
        ebitda: scale(lines.ebitda.forecast, 1.14),
        netProfit: scale(lines.netProfit.forecast, 1.18),
        endingCash: Math.round(CF_CORE.endingCash * 1.12 * 1_000_000),
        confidence: 58,
      },
      'Conservative': {
        description: 'Lower revenue growth due to market headwinds, higher cost pressure',
        revenueGrowth: Math.round((baseGrowth - 6) * 10) / 10,
        revenue: scale(lines.revenue.forecast, 0.92),
        ebitda: scale(lines.ebitda.forecast, 0.84),
        netProfit: scale(lines.netProfit.forecast, 0.8),
        endingCash: Math.round(CF_CORE.endingCash * 0.88 * 1_000_000),
        confidence: 84,
      },
    };
  }, [lines, CF_CORE]);

  const METRICS = [
    { label: 'Revenue', key: 'revenue' as const },
    { label: 'EBITDA', key: 'ebitda' as const },
    { label: 'Net Profit', key: 'netProfit' as const },
    { label: 'Ending Cash', key: 'endingCash' as const },
  ];

  return (
    <div className="card-base p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Scenario Planning</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Compare financial outcomes under different assumptions</p>
        </div>
        <button
          onClick={() => toast.info('Form skenario baru dibuka')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 bg-muted border border-border rounded-lg"
        >
          <Icon name="PlusIcon" size={14} />
          New Scenario
        </button>
      </div>

      {/* Scenario selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {(Object.entries(SCENARIOS) as [ScenarioKey, typeof SCENARIOS['Base Case']][]).map(([name, s]) => (
          <button
            key={`scenario-card-${name}`}
            onClick={() => setActive(name)}
            className={`text-left p-4 rounded-xl border-2 transition-all duration-200 ${
              active === name
                ? 'border-primary bg-primary/5' :'border-border bg-muted/30 hover:border-border hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">{name}</span>
              {active === name && <Icon name="CheckCircleIcon" size={16} className="text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{s.description}</p>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-2xs text-muted-foreground">Revenue Growth</p>
                <p className={`text-base font-bold tabular-nums ${name === 'Optimistic' ? 'text-positive' : name === 'Conservative' ? 'text-warning' : 'text-foreground'}`}>
                  {s.revenueGrowth >= 0 ? '+' : ''}{s.revenueGrowth}%
                </p>
              </div>
              <div>
                <p className="text-2xs text-muted-foreground">Confidence</p>
                <p className="text-base font-bold tabular-nums text-foreground">{s.confidence}%</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Side-by-side comparison */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Metric</th>
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((name) => (
                <th
                  key={`sh-${name}`}
                  className={`px-4 py-3 text-right text-xs font-semibold ${active === name ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {name}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Opt vs Cons</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={`sc-row-${m.key}`} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{m.label}</td>
                {(Object.entries(SCENARIOS) as [ScenarioKey, typeof SCENARIOS['Base Case']][]).map(([name, s]) => (
                  <td
                    key={`sc-val-${name}-${m.key}`}
                    className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${active === name ? 'text-primary' : 'text-foreground'}`}
                  >
                    {fx(formatIDR(s[m.key], true))}
                  </td>
                ))}
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  <span className={`font-semibold ${SCENARIOS['Optimistic'][m.key] > SCENARIOS['Conservative'][m.key] ? 'text-positive' : 'text-negative'}`}>
                    {fx(formatIDR(SCENARIOS['Optimistic'][m.key] - SCENARIOS['Conservative'][m.key], true))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
