'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';

interface Assumption {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

const ASSUMPTIONS: Assumption[] = [
  { id: 'rev-growth', label: 'Revenue Growth', value: 12.8, unit: '%', min: -20, max: 50, step: 0.5, description: 'YoY revenue growth rate' },
  { id: 'cogs-pct', label: 'COGS %', value: 54.6, unit: '%', min: 30, max: 80, step: 0.5, description: 'COGS as % of Revenue' },
  { id: 'payroll-growth', label: 'Payroll Growth', value: 8.2, unit: '%', min: 0, max: 30, step: 0.5, description: 'Annual payroll increase' },
  { id: 'opex-growth', label: 'OpEx Growth', value: 6.4, unit: '%', min: -10, max: 30, step: 0.5, description: 'Operating expense growth' },
  { id: 'collection-rate', label: 'Collection Rate', value: 94.2, unit: '%', min: 70, max: 100, step: 0.5, description: 'Customer payment rate' },
  { id: 'tax-rate', label: 'Tax Rate', value: 22.0, unit: '%', min: 15, max: 30, step: 0.5, description: 'Effective corporate tax rate' },
  { id: 'capex', label: 'CapEx (Rp M)', value: 420, unit: 'M', min: 0, max: 2000, step: 10, description: 'Capital expenditure budget' },
  { id: 'interest-exp', label: 'Interest Expense', value: 84, unit: 'M', min: 0, max: 500, step: 5, description: 'Annual interest expense (Rp M)' },
];

export default function ForecastAssumptions() {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(ASSUMPTIONS.map((a) => [a.id, a.value]))
  );
  const [saved, setSaved] = useState(false);

  const handleChange = (id: string, val: number) => {
    setValues((prev) => ({ ...prev, [id]: val }));
    setSaved(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">Forecast Assumptions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Adjust key drivers to update forecast projections</p>
        </div>
        <button
          onClick={() => setSaved(true)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-500 transition-all duration-150 active:scale-95 ${
            saved
              ? 'bg-positive-subtle text-positive border border-positive/20' :'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {saved ? (
            <><Icon name="CheckIcon" size={14} /> Saved</>
          ) : (
            <><Icon name="CloudArrowUpIcon" size={14} /> Apply</>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {ASSUMPTIONS.map((a) => {
          const pct = ((values[a.id] - a.min) / (a.max - a.min)) * 100;
          return (
            <div key={a.id} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-500 text-foreground">{a.label}</span>
                  <span className="text-2xs text-muted-foreground">{a.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={values[a.id]}
                    onChange={(e) => handleChange(a.id, parseFloat(e.target.value) || 0)}
                    min={a.min}
                    max={a.max}
                    step={a.step}
                    className="w-20 text-right text-sm font-600 font-tabular text-foreground bg-muted border border-border rounded-lg px-2 py-1 outline-none focus:border-primary transition-colors"
                  />
                  <span className="text-xs text-muted-foreground w-5">{a.unit}</span>
                </div>
              </div>
              <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-primary/60 rounded-full transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5 text-2xs text-muted-foreground">
                <span>{a.min}{a.unit}</span>
                <span>{a.max}{a.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
