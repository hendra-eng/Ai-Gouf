'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData, useScenarios } from '../lib/budgetBridge';
import { useCashFlowData } from '@/app/financial-statements/lib/useCashFlowData';

type ScenarioKey = 'Base Case' | 'Optimistic' | 'Conservative';

export default function ScenarioPlanning() {
  const [active, setActive] = useState<ScenarioKey>('Base Case');
  const { fx } = useCurrency();
  const { lines } = useBudgetData();
  const { CF_CORE } = useCashFlowData();
  // [BARU] Skenario custom tersimpan (tabel scenario, schema 5_Planning) --
  // ditambahkan sbg daftar terpisah di bawah 3 skenario bawaan (yang tetap
  // dihitung dari run-rate aktual, tidak diganti, supaya perbandingan
  // Revenue/EBITDA/Net Profit/Ending Cash tetap konsisten & bisa dipercaya).
  const { scenarios: customScenarios, addScenario, removeScenario } = useScenarios();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nama: '', revenueGrowth: '', cogsPct: '', opexGrowth: '', taxRate: '' });
  const [savingScenario, setSavingScenario] = useState(false);

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
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 bg-muted border border-border rounded-lg"
        >
          <Icon name="PlusIcon" size={14} />
          New Scenario
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-xl border border-border bg-muted/30 space-y-3">
          <p className="text-sm font-semibold text-foreground">Simpan skenario custom</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input
              type="text" placeholder="Nama skenario" value={form.nama}
              onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
              className="col-span-2 md:col-span-1 text-sm bg-card border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <input
              type="number" placeholder="Revenue growth %" value={form.revenueGrowth}
              onChange={(e) => setForm((f) => ({ ...f, revenueGrowth: e.target.value }))}
              className="text-sm bg-card border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <input
              type="number" placeholder="COGS %" value={form.cogsPct}
              onChange={(e) => setForm((f) => ({ ...f, cogsPct: e.target.value }))}
              className="text-sm bg-card border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <input
              type="number" placeholder="OpEx growth %" value={form.opexGrowth}
              onChange={(e) => setForm((f) => ({ ...f, opexGrowth: e.target.value }))}
              className="text-sm bg-card border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <input
              type="number" placeholder="Tax rate %" value={form.taxRate}
              onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))}
              className="text-sm bg-card border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={savingScenario || !form.nama.trim()}
              onClick={async () => {
                setSavingScenario(true);
                try {
                  await addScenario({
                    nama_skenario: form.nama.trim(),
                    revenue_growth_pct: form.revenueGrowth ? parseFloat(form.revenueGrowth) : undefined,
                    cogs_pct: form.cogsPct ? parseFloat(form.cogsPct) : undefined,
                    opex_growth_pct: form.opexGrowth ? parseFloat(form.opexGrowth) : undefined,
                    tax_rate_pct: form.taxRate ? parseFloat(form.taxRate) : undefined,
                  });
                  toast.success(`Skenario "${form.nama.trim()}" tersimpan`);
                  setForm({ nama: '', revenueGrowth: '', cogsPct: '', opexGrowth: '', taxRate: '' });
                  setShowForm(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Gagal menyimpan skenario');
                } finally {
                  setSavingScenario(false);
                }
              }}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {savingScenario ? 'Menyimpan…' : 'Simpan'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">Batal</button>
          </div>
        </div>
      )}

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

      {/* [BARU] Skenario custom tersimpan (tabel scenario di Supabase) */}
      {customScenarios.length > 0 && (
        <div className="mt-6 pt-5 border-t border-border">
          <p className="text-sm font-semibold text-foreground mb-3">Saved Custom Scenarios</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {customScenarios.map((s) => (
              <div key={s.id} className="p-3 rounded-lg border border-border bg-muted/20">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-foreground">{s.nama_skenario}{s.is_base_case && ' (Base)'}</span>
                  <button
                    onClick={async () => {
                      try { await removeScenario(s.id); toast.success('Skenario dihapus'); }
                      catch (e) { toast.error(e instanceof Error ? e.message : 'Gagal menghapus skenario'); }
                    }}
                    className="text-muted-foreground hover:text-danger transition-colors"
                    title="Hapus skenario"
                  >
                    <Icon name="TrashIcon" size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
                  {s.revenue_growth_pct != null && <span>Revenue {s.revenue_growth_pct >= 0 ? '+' : ''}{s.revenue_growth_pct}%</span>}
                  {s.cogs_pct != null && <span>COGS {s.cogs_pct}%</span>}
                  {s.opex_growth_pct != null && <span>OpEx {s.opex_growth_pct >= 0 ? '+' : ''}{s.opex_growth_pct}%</span>}
                  {s.tax_rate_pct != null && <span>Tax {s.tax_rate_pct}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}