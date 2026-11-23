import React from 'react';

// Kartu KPI & label seksi untuk tab Overview Purchase -- tema elegant monokrom, disalin 1:1 dari
// OverviewKpiTile & label seksi di Sales Overview (garis aksen hitam tipis, chip ikon abu, angka tabular,
// bar proporsi abu gelap). Sengaja terpisah dari ProgressKpiTile (hijau) yang masih dipakai Source Data.

export function PurchaseKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

export function KpiSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
      <span className="h-3.5 w-1 rounded-full bg-blue-600" />{children}
    </p>
  );
}

// Header kartu bersama (chip ikon abu + judul + subjudul) -- sama dengan SalesCardHeader (neutral).
export function PurchaseCardHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

// Pill status lembut (tint -100, teks -800, garis -300 + titik) -- sama dengan STATUS_STYLE Sales Overview
// dan Pill di Purchase Exceptions.
export interface PillStyle { pill: string; dot: string }
export const PILL_FALLBACK: PillStyle = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

export function StatusPill({ style, label }: { style?: PillStyle; label: string }) {
  const st = style ?? PILL_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

// Chip ringkas di kanan header kartu (mis. "Top 5 · 40% of total sales" di Sales).
export const HEADER_CHIP_CLS = 'shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-300';

// Kotak baris mini (rank / legenda / daftar) -- sama dengan kartu Top Customer Sales.
export const MINI_ROW_CLS = 'rounded-[10px] border border-neutral-300 bg-white transition-colors duration-200 hover:border-neutral-500 hover:bg-neutral-50';