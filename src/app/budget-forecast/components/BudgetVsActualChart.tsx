'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';


const BudgetChartInner = dynamic(() => import('./BudgetChartInner'), { ssr: false, loading: () => (
  <div className="h-80 animate-pulse bg-muted rounded-xl" />
) });

const METRICS = ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'EBITDA', 'Net Profit'];
const HORIZONS = ['3M', '6M', '12M'];

export default function BudgetVsActualChart() {
  const [metric, setMetric] = useState('Revenue');
  const [horizon, setHorizon] = useState('12M');

  return (
    <div className="card-base p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Financial Performance: Budget vs Actual vs Forecast</h3>
          <p className="text-sm text-muted-foreground mt-0.5">FY 2026 · PT Nusantara Teknologi Indonesia</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Metric switcher */}
          <div className="flex flex-wrap gap-1">
            {METRICS?.map((m) => (
              <button
                key={`metric-${m}`}
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 ${
                  m === metric ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {/* Horizon */}
          <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
            {HORIZONS?.map((h) => (
              <button
                key={`horizon-${h}`}
                onClick={() => setHorizon(h)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  h === horizon ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4">
        {[
          { label: 'Budget', color: 'bg-chart-2', type: 'bar' },
          { label: 'Actual', color: 'bg-primary', type: 'line' },
          { label: 'Forecast', color: 'bg-chart-3', type: 'dashed' },
          { label: 'Confidence Range', color: 'bg-primary/20', type: 'area' },
        ]?.map((l) => (
          <div key={`legend-${l?.label}`} className="flex items-center gap-2">
            {l?.type === 'dashed' ? (
              <div className="w-8 h-0.5 border-t-2 border-dashed border-chart-3" />
            ) : l?.type === 'area' ? (
              <div className="w-5 h-3 rounded-sm bg-primary/20 border border-primary/30" />
            ) : l?.type === 'bar' ? (
              <div className={`w-3 h-3 rounded-sm ${l?.color}`} />
            ) : (
              <div className={`w-5 h-0.5 ${l?.color} rounded-full`} />
            )}
            <span className="text-xs text-muted-foreground">{l?.label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/40 border-2 border-dashed border-muted-foreground/60" />
          <span>Forecast Period Starts Sep 2026</span>
        </div>
      </div>

      <BudgetChartInner metric={metric} horizon={horizon} />
    </div>
  );
}
