'use client';
import React, { useMemo, useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { useBudgetData } from '../lib/budgetBridge';

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

export default function ForecastAssumptions() {
  const { PL_CORE, lines } = useBudgetData();

  // Nilai default DIAMBIL dari rasio real client aktif (bukan angka tetap) --
  // sekali dimuat, angka ini menjadi titik awal untuk simulasi what-if;
  // slider tetap lokal/interaktif karena memang alat simulasi, bukan data
  // yang tersimpan di backend.
  const ASSUMPTIONS: Assumption[] = useMemo(() => {
    const revenueGrowth = lines.revenue.budget !== 0 ? ((lines.revenue.forecast - lines.revenue.budget) / lines.revenue.budget) * 100 : 12.8;
    const cogsPct = PL_CORE.revenue !== 0 ? (PL_CORE.cogs / PL_CORE.revenue) * 100 : 54.6;
    const opexGrowth = lines.operatingExpenses.budget !== 0 ? ((lines.operatingExpenses.forecast - lines.operatingExpenses.budget) / lines.operatingExpenses.budget) * 100 : 6.4;
    const taxRate = PL_CORE.ebt !== 0 ? (PL_CORE.incomeTax / PL_CORE.ebt) * 100 : 22.0;

    return [
      { id: 'rev-growth', label: 'Revenue Growth', value: Math.round(revenueGrowth * 10) / 10, unit: '%', min: -20, max: 50, step: 0.5, description: 'YoY revenue growth rate' },
      { id: 'cogs-pct', label: 'COGS %', value: Math.round(cogsPct * 10) / 10, unit: '%', min: 30, max: 80, step: 0.5, description: 'COGS as % of Revenue' },
      { id: 'payroll-growth', label: 'Payroll Growth', value: 8.2, unit: '%', min: 0, max: 30, step: 0.5, description: 'Annual payroll increase (not tracked separately from OpEx)' },
      { id: 'opex-growth', label: 'OpEx Growth', value: Math.round(opexGrowth * 10) / 10, unit: '%', min: -10, max: 30, step: 0.5, description: 'Operating expense growth' },
      { id: 'collection-rate', label: 'Collection Rate', value: 94.2, unit: '%', min: 70, max: 100, step: 0.5, description: 'Customer payment rate' },
      { id: 'tax-rate', label: 'Tax Rate', value: Math.round(taxRate * 10) / 10, unit: '%', min: 15, max: 30, step: 0.5, description: 'Effective corporate tax rate' },
      { id: 'capex', label: 'CapEx (Rp M)', value: 420, unit: 'M', min: 0, max: 2000, step: 10, description: 'Capital expenditure budget (not yet tracked in Assets module)' },
      { id: 'interest-exp', label: 'Interest Expense', value: PL_CORE.interestExpense || 84, unit: 'M', min: 0, max: 500, step: 5, description: 'Annual interest expense (Rp M)' },
    ];
  }, [PL_CORE, lines]);

  const [values, setValues] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  const getValue = (a: Assumption) => (a.id in values ? values[a.id] : a.value);

  const handleChange = (id: string, val: number) => {
    setValues((prev) => ({ ...prev, [id]: val }));
    setSaved(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Forecast Assumptions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Defaults from this client&apos;s actuals — adjust to simulate scenarios</p>
        </div>
        <button
          onClick={() => setSaved(true)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 ${
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
          const val = getValue(a);
          const pct = ((val - a.min) / (a.max - a.min)) * 100;
          return (
            <div key={a.id} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{a.label}</span>
                  <span className="text-2xs text-muted-foreground">{a.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={val}
                    onChange={(e) => handleChange(a.id, parseFloat(e.target.value) || 0)}
                    min={a.min}
                    max={a.max}
                    step={a.step}
                    className="w-20 text-right text-sm font-semibold tabular-nums text-foreground bg-muted border border-border rounded-lg px-2 py-1 outline-none focus:border-primary transition-colors"
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
