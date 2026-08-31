'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';


const TrendExplorerChartInner = dynamic(() => import('./TrendExplorerChartInner'), { ssr: false, loading: () => (
  <div className="h-72 animate-pulse bg-muted rounded-xl" />
) });

const ALL_METRICS = ['Revenue', 'COGS', 'Gross Profit', 'EBITDA', 'Net Profit', 'Cash', 'AR', 'AP', 'Assets', 'Liabilities', 'Equity'];
const PERIODS = ['Monthly', 'Quarterly', 'Yearly'];
const HORIZONS = ['6M', 'YTD', '12M', '3Y'];

const METRIC_COLORS = [
  'var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--negative)', 'var(--warning)',
];

export default function TrendExplorer() {
  const [selected, setSelected] = useState<string[]>(['Revenue', 'EBITDA', 'Net Profit']);
  const [period, setPeriod] = useState('Monthly');
  const [horizon, setHorizon] = useState('12M');

  const toggleMetric = (m: string) => {
    if (selected.includes(m)) {
      if (selected.length > 1) setSelected(selected.filter((s) => s !== m));
    } else {
      if (selected.length < 5) setSelected([...selected, m]);
    }
  };

  return (
    <div className="card-base p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-xl font-600 text-foreground">Financial Trend Explorer</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Select up to 5 metrics to compare · Click metric to toggle</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <button
                key={`trend-period-${p}`}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-500 transition-all ${
                  p === period ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
            {HORIZONS.map((h) => (
              <button
                key={`trend-horizon-${h}`}
                onClick={() => setHorizon(h)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-500 transition-all ${
                  h === horizon ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric selector */}
      <div className="flex flex-wrap gap-2 mb-5">
        {ALL_METRICS.map((m, mi) => {
          const isSelected = selected.includes(m);
          const color = METRIC_COLORS[selected.indexOf(m)] || 'var(--muted-foreground)';
          return (
            <button
              key={`trend-metric-${m}`}
              onClick={() => toggleMetric(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-500 transition-all border ${
                isSelected
                  ? 'bg-card text-foreground border-border shadow-card'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:border-border hover:text-foreground'
              }`}
            >
              {isSelected && (
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
              )}
              {m}
            </button>
          );
        })}
        <span className="text-2xs text-muted-foreground self-center ml-2">
          {selected.length}/5 selected
        </span>
      </div>

      <TrendExplorerChartInner selected={selected} horizon={horizon} />

      {/* Selected metrics legend */}
      <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border">
        {selected.map((m, i) => (
          <div key={`trend-leg-${m}`} className="flex items-center gap-2">
            <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: METRIC_COLORS[i] }} />
            <span className="text-xs text-muted-foreground">{m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
