'use client';

// Gaya tabel halaman Fixed Assets -- disamakan dengan tabel Sales (tab Transaction:
// "Sales Invoice List"): font Inter, header abu (bg-neutral-300) bergaris hitam
// atas-bawah, teks header text-xs bold hitam, baris text-xs dengan garis pemisah
// abu (#b4b4b4), hover baris abu (neutral-200), pill status bergaris + titik,
// footer "Baris per halaman" + nomor halaman. Kelas-kelas di sini sengaja identik
// dengan SalesTransaction.tsx; ubah di satu tempat ini untuk semua tabel Asset.

import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useLanguage } from '@/lib/language';

export const faTableCls = `${salesFont.className} w-full select-text border-separate border-spacing-0`;
export const tableHeadRow = 'bg-neutral-300';
export const thCls = 'py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 text-left';
export const tdCls = 'py-2 px-2 whitespace-nowrap tabular-nums';
export const faRow = '[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs text-neutral-900';
export const faRowClickable = `cursor-pointer ${faRow}`;
export const faInputCls = 'w-full rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300';
export const faBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50';
export const faRowSelected = '[&>td]:bg-neutral-100';

/** Kartu tabel: judul 2xl + subjudul (bila ada), garis bawah, lalu isi. Tanpa judul -> hanya pembungkus font.
 *  `toolbar` (opsional) = baris filter/cari di bawah judul, di dalam header sebelum garis (gaya Purchase Source Data). */
export function FaCard({ title, subtitle, action, toolbar, children, className = '' }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const baris = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {title && <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h3>}
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
  return (
    <section className={`${salesFont.className} ${className}`}>
      {(title || action || toolbar) && (toolbar ? (
        <div className="flex flex-col gap-3 border-b border-border px-0 pb-3 pt-1">{baris}{toolbar}</div>
      ) : (
        <div className="border-b border-border px-0 pb-3 pt-1">{baris}</div>
      ))}
      {children}
    </section>
  );
}

/** Pill status bergaris + titik (gaya StatusPill Sales). `style` = kelas lama (mis. "bg-emerald-50 text-emerald-700"); warna dasarnya diambil dari situ. */
const PILL: Record<string, { pill: string; dot: string }> = {
  emerald: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  green:   { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  teal:    { pill: 'bg-teal-100 text-teal-800 border-teal-300',          dot: 'bg-teal-600' },
  rose:    { pill: 'bg-rose-100 text-rose-800 border-rose-300',          dot: 'bg-rose-600' },
  red:     { pill: 'bg-rose-100 text-rose-800 border-rose-300',          dot: 'bg-rose-600' },
  amber:   { pill: 'bg-amber-100 text-amber-900 border-amber-300',       dot: 'bg-amber-600' },
  yellow:  { pill: 'bg-amber-100 text-amber-900 border-amber-300',       dot: 'bg-amber-600' },
  orange:  { pill: 'bg-orange-100 text-orange-800 border-orange-300',    dot: 'bg-orange-600' },
  sky:     { pill: 'bg-sky-100 text-sky-800 border-sky-300',             dot: 'bg-sky-600' },
  blue:    { pill: 'bg-blue-100 text-blue-800 border-blue-300',          dot: 'bg-blue-600' },
  violet:  { pill: 'bg-violet-100 text-violet-800 border-violet-300',    dot: 'bg-violet-600' },
  indigo:  { pill: 'bg-indigo-100 text-indigo-800 border-indigo-300',    dot: 'bg-indigo-600' },
  slate:   { pill: 'bg-slate-200 text-slate-800 border-slate-400',       dot: 'bg-slate-500' },
  gray:    { pill: 'bg-slate-200 text-slate-800 border-slate-400',       dot: 'bg-slate-500' },
  neutral: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
};

export function FaPill({ label, style }: { label: string; style: string }) {
  const warna = /(?:bg|text)-([a-z]+)-\d{2,3}/.exec(style)?.[1] ?? 'neutral';
  const st = PILL[warna] ?? PILL.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

/** Header kolom yang bisa diurutkan, gaya header tabel Sales. */
export function FaSortTh<K extends string>({ label, k, sort, onSort, align = 'left', className = '', iconFirst = false }: {
  label: string; k: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (k: K) => void; align?: 'left' | 'right'; className?: string; iconFirst?: boolean;
}) {
  const aktif = sort.key === k;
  const Ikon = !aktif ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`${thCls} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 text-black hover:text-neutral-700 ${iconFirst ? 'flex-row-reverse' : ''}`}>
        {label} <Ikon size={12} className={aktif ? '' : 'opacity-50'} />
      </button>
    </th>
  );
}

/** Baris kosong / skeleton loading, gaya tabel Sales. */
export function FaEmptyRow({ cols, text, loading }: { cols: number; text: string; loading?: boolean }) {
  if (loading) {
    return (
      <>
        {[0, 1, 2].map(i => (
          <tr key={i}><td colSpan={cols} className="px-2 py-2"><div className="h-5 animate-pulse rounded bg-neutral-100" /></td></tr>
        ))}
      </>
    );
  }
  return <tr><td colSpan={cols} className="px-2 py-2 text-center text-xs text-neutral-500">{text}</td></tr>;
}

/** Footer tabel: "Baris per halaman" + rentang + nomor halaman (gaya Sales). `page` berbasis 0. */
export function FaPager({ page, pageSize, total, onPage, onPageSize, noun = 'rows', sizes = [10, 25, 50] }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; noun?: string; sizes?: number[];
}) {
  const { t } = useLanguage();
  const halaman = Math.max(1, Math.ceil(total / pageSize));
  const dari = total ? page * pageSize + 1 : 0;
  const sampai = Math.min(total, (page + 1) * pageSize);
  const item: (number | '…')[] = [];
  for (let i = 0; i < halaman; i += 1) {
    if (i === 0 || i === halaman - 1 || Math.abs(i - page) <= 1) item.push(i);
    else if (item[item.length - 1] !== '…') item.push('…');
  }
  const ukuran = sizes.includes(pageSize) ? sizes : [...sizes, pageSize].sort((a, b) => a - b);
  return (
    <div className={`${salesFont.className} flex flex-wrap items-center justify-between gap-3 border-t border-border px-0 py-3 text-xs text-neutral-500`}>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span>{t('Baris per halaman')}</span>
          <select value={pageSize} onChange={ev => onPageSize(Number(ev.target.value))} className="rounded-lg border border-neutral-300 bg-card px-2 py-1.5 text-xs font-medium text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300">
            {ukuran.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="hidden text-slate-300 sm:inline">|</span>
        <span>
          <span className="font-semibold text-neutral-900">{dari}–{sampai}</span>{' '}
          {t('dari')} <span className="font-semibold text-neutral-900">{total}</span> {noun}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label={t('Halaman sebelumnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"><ChevronLeft size={16} /></button>
        {item.map((p, idx) => p === '…' ? (
          <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
        ) : (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === page ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p + 1}</button>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= halaman - 1} aria-label={t('Halaman berikutnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}