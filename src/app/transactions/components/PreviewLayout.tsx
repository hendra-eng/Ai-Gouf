import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

// Blok-blok tampilan Journal Preview (Sales, Purchase, Journal Entry, Cash & Bank).
// Setiap bagian ditumpuk satu kolom dari atas ke bawah, dan isinya berupa daftar
// "label : nilai" per baris -- bukan grid kartu berdampingan -- supaya mudah dibaca.

/** Kartu putih standar untuk blok di halaman preview (header, action bar). */
export const PREVIEW_CARD = 'bg-card border border-border rounded-xl shadow-sm';

const STEP_BADGE: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
};

interface PreviewSectionProps {
  title: React.ReactNode;
  /** Nomor langkah (1, 2, ...) atau ikon kecil di badge kiri judul. */
  step?: React.ReactNode;
  stepColor?: keyof typeof STEP_BADGE;
  /** Konten di sisi kanan header (badge status, tombol, dll). */
  aside?: React.ReactNode;
  /** Header bisa diklik (mis. untuk buka/tutup isi). */
  onHeaderClick?: () => void;
  /** Isi tanpa padding (untuk tabel yang menempel ke tepi kartu). */
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function PreviewSection({
  title, step, stepColor = 'blue', aside, onHeaderClick, flush, className = '', children,
}: PreviewSectionProps) {
  const header = (
    <>
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        {step !== undefined && (
          <span className={`w-6 h-6 rounded text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${STEP_BADGE[stepColor]}`}>
            {step}
          </span>
        )}
        {title}
      </h4>
      {aside && <div className="flex items-center gap-2 flex-shrink-0">{aside}</div>}
    </>
  );
  const headerClass = 'w-full px-5 py-3 border-b border-border bg-slate-50 flex items-center justify-between gap-3 text-left';
  return (
    <section className={`${PREVIEW_CARD} overflow-hidden ${className}`}>
      {onHeaderClick ? (
        <button type="button" onClick={onHeaderClick} className={headerClass}>{header}</button>
      ) : (
        <div className={headerClass}>{header}</div>
      )}
      {children !== undefined && children !== null && children !== false && (
        <div className={flush ? '' : 'p-5'}>{children}</div>
      )}
    </section>
  );
}

export interface FieldRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Tebalkan baris (mis. total). */
  strong?: boolean;
}

/** Daftar label : nilai, satu baris per field, dibaca dari atas ke bawah. */
export function FieldList({ rows, className = '' }: { rows: (FieldRow | false | null | undefined)[]; className?: string }) {
  return (
    <dl className={`divide-y divide-slate-100 text-xs ${className}`}>
      {rows.filter((r): r is FieldRow => !!r).map((r, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-0.5 sm:gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className={`text-foreground break-words ${r.strong ? 'font-bold' : 'font-medium'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Judul kecil pemisah grup field di dalam satu section. */
export function FieldGroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-5 mb-2 first:mt-0">{children}</p>
  );
}

export interface JournalLine {
  key: React.Key;
  code: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
  costCenter?: React.ReactNode;
  debit: number;
  credit: number;
}

/**
 * Tabel jurnal: satu baris per akun, kolom Kode / Nama Akun / (Keterangan) /
 * Debit / Kredit terpisah -- tidak ada kode+nama yang digabung dalam satu sel.
 */
export function JournalTable({
  lines, totalDebit, totalCredit, formatAmount, showDescription = false, showCostCenter = false, labels,
}: {
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  formatAmount: (n: number) => string;
  showDescription?: boolean;
  showCostCenter?: boolean;
  labels?: { no?: string; code?: string; name?: string; description?: string; costCenter?: string; debit?: string; credit?: string; total?: string };
}) {
  const L = {
    no: 'No.', code: 'Account Code', name: 'Account Name', description: 'Description', costCenter: 'Cost Center',
    debit: 'Debit', credit: 'Credit', total: 'Total', ...labels,
  };
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const th = 'px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide';
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-slate-50">
            <th className={`${th} text-left w-12`}>{L.no}</th>
            <th className={`${th} text-left whitespace-nowrap`}>{L.code}</th>
            <th className={`${th} text-left`}>{L.name}</th>
            {showDescription && <th className={`${th} text-left`}>{L.description}</th>}
            {showCostCenter && <th className={`${th} text-left whitespace-nowrap`}>{L.costCenter}</th>}
            <th className={`${th} text-right whitespace-nowrap`}>{L.debit}</th>
            <th className={`${th} text-right whitespace-nowrap`}>{L.credit}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
              <td className="px-4 py-2.5 font-mono font-semibold text-primary whitespace-nowrap">{l.code || '—'}</td>
              <td className="px-4 py-2.5 text-foreground">{l.name || '—'}</td>
              {showDescription && <td className="px-4 py-2.5 text-muted-foreground">{l.description || '—'}</td>}
              {showCostCenter && <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{l.costCenter || '—'}</td>}
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{l.debit > 0 ? formatAmount(l.debit) : '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{l.credit > 0 ? formatAmount(l.credit) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={`border-t-2 font-bold ${balanced ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            <td colSpan={3 + (showDescription ? 1 : 0) + (showCostCenter ? 1 : 0)} className="px-4 py-2.5">{L.total}</td>
            <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatAmount(totalDebit)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{formatAmount(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Pagination list pilihan di kiri halaman preview (model "Select Purchase"):
 * ‹  Page X of Y · N items  ›  -- disembunyikan kalau cuma 1 halaman.
 */
export function PickerPagination({
  page, totalPages, total, itemLabel, onPageChange, className = 'pt-3 mt-3',
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={`flex items-center justify-between border-t border-border text-xs text-muted-foreground ${className}`}>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        <ChevronLeftIcon className="w-3.5 h-3.5" />
      </button>
      <span>
        Page <span className="font-medium text-foreground">{page}</span> of {totalPages} · {total} {itemLabel}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        <ChevronRightIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
