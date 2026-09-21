'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useActiveClient } from '@/lib/activeClient';
import { useQueryClient } from '@tanstack/react-query';
// [DIUBAH] Tombol "Apply" sekarang benar-benar menyimpan ke tabel
// forecast_assumption (schema 5_Planning) lewat simpanForecastAssumption(),
// bukan cuma set state lokal `saved`. Nilai awal slider diambil dari
// asumsi tersimpan (kalau client sudah pernah Apply sebelumnya), fallback
// ke rasio actual client seperti semula kalau belum pernah.
import { simpanForecastAssumption } from '@/app/agent-ai/lib/api';
import { useBudgetData, useForecastAssumption } from '../lib/budgetBridge';

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

// Kolom tabel forecast_assumption per id slider.
// [DITUNTASKAN] 'collection-rate' & 'capex' sekarang benar-benar dipakai
// (lihat capexBudget/expectedCollections di budgetBridge.ts, ditampilkan
// di PlanningStatusHero.tsx sbg "Expected Collections"/"CapEx Budget").
// 'payroll-growth' TETAP cuma tersimpan tanpa dipakai kalkulasi -- akun
// payroll (mis. "Beban Gaji") tidak punya sub_kategori tersendiri di COA
// client (ikut ke-grup "Beban Operasional" bareng akun opex lain), jadi
// tidak bisa dipisah jadi target budget sendiri tanpa breakdown per-akun
// (bukan per-kategori) di useProfitLossData.ts.
const KOLOM_PER_ID: Record<string, string> = {
  'rev-growth': 'revenue_growth_pct',
  'cogs-pct': 'cogs_pct',
  'payroll-growth': 'payroll_growth_pct',
  'opex-growth': 'opex_growth_pct',
  'collection-rate': 'collection_rate_pct',
  'tax-rate': 'tax_rate_pct',
  capex: 'capex',
  'interest-exp': 'interest_expense',
};

export default function ForecastAssumptions() {
  const { PL_CORE, lines } = useBudgetData();
  const { assumption, tahun, refetch } = useForecastAssumption();
  const { activeClientId } = useActiveClient();
  const queryClient = useQueryClient();

  // Nilai default: pakai tabel forecast_assumption kalau sudah pernah
  // di-Apply, kalau belum turunkan dari rasio real client aktif (titik
  // awal simulasi yang masuk akal).
  const ASSUMPTIONS: Assumption[] = useMemo(() => {
    const revenueGrowth = assumption?.revenue_growth_pct ??
      (lines.revenue.budget !== 0 ? ((lines.revenue.forecast - lines.revenue.budget) / lines.revenue.budget) * 100 : 0);
    const cogsPct = assumption?.cogs_pct ?? (PL_CORE.revenue !== 0 ? (PL_CORE.cogs / PL_CORE.revenue) * 100 : 0);
    const opexGrowth = assumption?.opex_growth_pct ??
      (lines.operatingExpenses.budget !== 0 ? ((lines.operatingExpenses.forecast - lines.operatingExpenses.budget) / lines.operatingExpenses.budget) * 100 : 0);
    const taxRate = assumption?.tax_rate_pct ?? (PL_CORE.ebt !== 0 ? (PL_CORE.incomeTax / PL_CORE.ebt) * 100 : 0);
    const payrollGrowth = assumption?.payroll_growth_pct ?? 0;
    const collectionRate = assumption?.collection_rate_pct ?? 0;
    const capex = assumption?.capex ?? 0;
    const interestExp = assumption?.interest_expense ?? (PL_CORE.interestExpense || 0);

    return [
      { id: 'rev-growth', label: 'Revenue Growth', value: Math.round(revenueGrowth * 10) / 10, unit: '%', min: -20, max: 50, step: 0.5, description: 'YoY revenue growth rate' },
      { id: 'cogs-pct', label: 'COGS %', value: Math.round(cogsPct * 10) / 10, unit: '%', min: 30, max: 80, step: 0.5, description: 'COGS as % of Revenue' },
      { id: 'payroll-growth', label: 'Payroll Growth', value: Math.round(payrollGrowth * 10) / 10, unit: '%', min: 0, max: 30, step: 0.5, description: 'Annual payroll increase (not tracked separately from OpEx)' },
      { id: 'opex-growth', label: 'OpEx Growth', value: Math.round(opexGrowth * 10) / 10, unit: '%', min: -10, max: 30, step: 0.5, description: 'Operating expense growth' },
      { id: 'collection-rate', label: 'Collection Rate', value: Math.round(collectionRate * 10) / 10, unit: '%', min: 70, max: 100, step: 0.5, description: 'Applied to Revenue Budget → "Expected Collections" below' },
      { id: 'tax-rate', label: 'Tax Rate', value: Math.round(taxRate * 10) / 10, unit: '%', min: 15, max: 30, step: 0.5, description: 'Effective corporate tax rate' },
      { id: 'capex', label: 'CapEx (Rp M)', value: Math.round(capex), unit: 'M', min: 0, max: 2000, step: 10, description: 'Shown as "CapEx Budget" below (not yet compared to Assets module actuals)' },
      { id: 'interest-exp', label: 'Interest Expense', value: Math.round(interestExp), unit: 'M', min: 0, max: 500, step: 5, description: 'Annual interest expense (Rp M)' },
    ];
  }, [PL_CORE, lines, assumption]);

  const [values, setValues] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Slider lokal ikut reset ke nilai tersimpan tiap kali asumsi dari
  // server berubah (mis. setelah Apply berhasil / ganti client aktif).
  useEffect(() => { setValues({}); setSaved(false); }, [assumption]);

  const getValue = (a: Assumption) => (a.id in values ? values[a.id] : a.value);

  const handleChange = (id: string, val: number) => {
    setValues((prev) => ({ ...prev, [id]: val }));
    setSaved(false);
  };

  const handleApply = async () => {
    if (!activeClientId) { toast.error('Belum ada client yang dipilih.'); return; }
    setSaving(true);
    try {
      const nilai: Record<string, number> = {};
      ASSUMPTIONS.forEach((a) => { nilai[KOLOM_PER_ID[a.id]] = getValue(a); });
      await simpanForecastAssumption(activeClientId, tahun, nilai);
      await queryClient.invalidateQueries({ queryKey: ['forecast-assumption', activeClientId, tahun] });
      refetch();
      setSaved(true);
      toast.success('Asumsi budget tersimpan');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan asumsi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Forecast Assumptions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {assumption ? 'Tersimpan di database — sesuaikan lalu Apply untuk memperbarui' : "Defaults from this client's actuals — adjust to simulate scenarios"}
          </p>
        </div>
        <button
          onClick={handleApply}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 disabled:opacity-60 ${
            saved
              ? 'bg-positive-subtle text-positive border border-positive/20' :'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {saving ? (
            <>Menyimpan…</>
          ) : saved ? (
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