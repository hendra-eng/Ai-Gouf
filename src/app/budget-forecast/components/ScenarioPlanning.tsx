'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const SCENARIOS = {
  'Base Case': {
    description: 'Current assumptions with moderate growth trajectory',
    revenueGrowth: 12.8,
    revenue: 10_480_000_000,
    ebitda: 2_720_000_000,
    netProfit: 1_910_000_000,
    endingCash: 3_840_000_000,
    confidence: 87,
    color: 'primary',
  },
  'Optimistic': {
    description: 'Higher revenue growth driven by new enterprise deals, controlled expenses',
    revenueGrowth: 18.4,
    revenue: 11_240_000_000,
    ebitda: 3_180_000_000,
    netProfit: 2_310_000_000,
    endingCash: 4_620_000_000,
    confidence: 62,
    color: 'chart-2',
  },
  'Conservative': {
    description: 'Lower revenue growth due to market headwinds, higher cost pressure',
    revenueGrowth: 6.2,
    revenue: 9_340_000_000,
    ebitda: 2_140_000_000,
    netProfit: 1_480_000_000,
    endingCash: 3_120_000_000,
    confidence: 91,
    color: 'chart-3',
  },
};

type ScenarioKey = keyof typeof SCENARIOS;

export default function ScenarioPlanning() {
  const [active, setActive] = useState<ScenarioKey>('Base Case');
  const activeScenario = SCENARIOS[active];
  const { fx } = useCurrency();

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
          <h3 className="text-xl font-600 text-foreground">Scenario Planning</h3>
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
              <span className="text-sm font-600 text-foreground">{name}</span>
              {active === name && <Icon name="CheckCircleIcon" size={16} className="text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{s.description}</p>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-2xs text-muted-foreground">Revenue Growth</p>
                <p className={`text-base font-700 font-tabular ${name === 'Optimistic' ? 'text-positive' : name === 'Conservative' ? 'text-warning' : 'text-foreground'}`}>
                  +{s.revenueGrowth}%
                </p>
              </div>
              <div>
                <p className="text-2xs text-muted-foreground">Confidence</p>
                <p className="text-base font-700 font-tabular text-foreground">{s.confidence}%</p>
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
              <th className="px-4 py-3 text-left text-xs font-600 text-muted-foreground">Metric</th>
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((name) => (
                <th
                  key={`sh-${name}`}
                  className={`px-4 py-3 text-right text-xs font-600 ${active === name ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {name}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-600 text-muted-foreground">Opt vs Cons</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={`sc-row-${m.key}`} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-sm font-500 text-foreground">{m.label}</td>
                {(Object.entries(SCENARIOS) as [ScenarioKey, typeof SCENARIOS['Base Case']][]).map(([name, s]) => (
                  <td
                    key={`sc-val-${name}-${m.key}`}
                    className={`px-4 py-3 text-right text-sm font-600 font-tabular ${active === name ? 'text-primary' : 'text-foreground'}`}
                  >
                    {fx(formatIDR(s[m.key], true))}
                  </td>
                ))}
                <td className="px-4 py-3 text-right text-sm font-tabular">
                  <span className={`font-600 ${SCENARIOS['Optimistic'][m.key] > SCENARIOS['Conservative'][m.key] ? 'text-positive' : 'text-negative'}`}>
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
