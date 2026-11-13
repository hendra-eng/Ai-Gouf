import React from 'react';

// Kartu KPI -- keluarga hijau brand. Fokus ke data: angka besar, nilai/keterangan dalam chip, bar proporsi
// bergradasi + badge persen. Ikon dibuat kecil & pucat agar tidak menyaingi angka.
// Dipakai bersama oleh Purchase Source Data dan Purchase Overview supaya desainnya konsisten.
export type KpiTone = 'slate' | 'amber' | 'green' | 'sky';

export const KPI_TONE: Record<KpiTone, { strip: string; bar: string; badge: string }> = {
  slate: { strip: 'from-[#6EE7B7] to-[#10B981]', bar: 'from-[#6EE7B7] to-[#10B981]', badge: 'bg-[#ECFDF5] text-[#047857]' },
  amber: { strip: 'from-[#22C55E] to-[#15803D]', bar: 'from-[#4ADE80] to-[#16A34A]', badge: 'bg-[#DCFCE7] text-[#15803D]' },
  green: { strip: 'from-[#0F7D4E] to-[#064E3B]', bar: 'from-[#34D399] to-[#0F7D4E]', badge: 'bg-[#D1FAE5] text-[#065F46]' },
  sky: { strip: 'from-[#0F766E] to-[#134E4A]', bar: 'from-[#5EEAD4] to-[#0F766E]', badge: 'bg-[#CCFBF1] text-[#0F766E]' },
};

interface ProgressKpiTileProps {
  label: string;
  /** Angka utama. Number -> diformat id-ID; string dipakai apa adanya (mis. "Rp 12.500.000"). */
  value: number | string;
  detail: string;
  detailUnit: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
  /** Perkecil angka utama (untuk nilai Rupiah yang panjang). */
  compactValue?: boolean;
  /** Bar proporsi diisi hanya bila true. Default: value > 0 (number) atau pct > 0 (string). */
  barActive?: boolean;
}

export default function ProgressKpiTile({
  label, value, detail, detailUnit, pct, pctLabel, tone, icon: Icon, compactValue = false, barActive,
}: ProgressKpiTileProps) {
  const c = KPI_TONE[tone];
  const shownValue = typeof value === 'number' ? value.toLocaleString('id-ID') : value;
  const active = barActive ?? (typeof value === 'number' ? value > 0 : pct > 0);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-white via-white to-[#F3FBF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-lg">
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.strip}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-extrabold uppercase tracking-wider text-slate-600">{label}</p>
          <p className={`mt-2 truncate font-extrabold leading-none tabular-nums text-[#064E3B] ${compactValue ? 'text-2xl xl:text-[26px]' : 'text-4xl'}`} title={shownValue}>
            {shownValue}
          </p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.badge}`}>
          <Icon size={18} />
        </span>
      </div>
      <div className="relative mt-3 flex w-fit max-w-full items-baseline gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 shadow-sm">
        <span className="truncate text-sm font-bold text-slate-900">{detail}</span>
        <span className="shrink-0 text-[11px] font-semibold text-slate-500">{detailUnit}</span>
      </div>
      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
        <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${c.bar}`} style={{ width: `${active ? Math.min(Math.max(pct, 3), 100) : 0}%` }} />
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-slate-500">{pctLabel}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${c.badge}`}>{pct}%</span>
      </div>
    </div>
  );
}
