'use client';

// Komponen & kelas bersama untuk tab Source Data Cash & Bank. Desainnya disamakan
// dengan Source Data Sales / Purchase (SourceKpiTile, SourcePanel, pill status,
// tombol aksi, tabel header abu + garis hitam, paginasi) supaya ketiga halaman
// terasa satu tema elegan monokrom. Ubah di sini untuk mengubah semua bagian
// Source Data Cash & Bank sekaligus.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Kelas dasar                                                         */
/* ------------------------------------------------------------------ */

const ACTION_BTN_BASE =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
export const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;

export const PANEL_ICON_CHIP =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';

/** Header tabel: abu + garis hitam atas/bawah (sama dengan tabel Sales). */
export const TH_CLS = 'py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800';
/** Baris tabel: garis pemisah abu + hover abu (sama dengan tabel Sales). */
export const TR_CLS = 'text-xs text-neutral-900 [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200';
export const TD_CLS = 'py-2 px-2 whitespace-nowrap';

/** Tombol ikon kecil di kolom aksi tabel. */
export const ICON_BTN =
  'rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40';
export const ICON_BTN_DANGER =
  'rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40';

/** Input / select / textarea form. */
export const FIELD_CLS =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-400 focus:border-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-800 disabled:opacity-60';
export const FIELD_LABEL_CLS = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-600';
export const CHECKBOX_CLS = 'h-3.5 w-3.5 rounded border-neutral-400 accent-neutral-800';

/* ------------------------------------------------------------------ */
/* Dropdown (pengganti <select> bawaan browser yang berwarna biru)      */
/* ------------------------------------------------------------------ */

export interface SelectOption { value: string; label: string; group?: string }

/**
 * Dropdown netral -- sama dengan FilterSelect di Sales / Purchase (border neutral-300,
 * fokus neutral-700, opsi terpilih neutral-200 + centang). Mendukung grup opsi,
 * pencarian otomatis (>10 opsi) dan menu dirender lewat portal (fixed) supaya tidak
 * terpotong tabel / modal yang bisa di-scroll.
 */
export function FilterSelect({ value, onChange, options, disabled, className = '', size = 'md', placeholder, ariaLabel, openUp = false, menuMaxWidth = 340 }: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  placeholder?: string;
  ariaLabel?: string;
  openUp?: boolean;
  menuMaxWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Tinggi daftar dibatasi sesuai ruang yang tersisa di arah buka, supaya menu selalu muat di layar
    // (arah buka sendiri TIDAK berubah: ke bawah kecuali openUp).
    const cari = options.length > 10 ? 56 : 0;
    const ruang = (openUp ? r.top : window.innerHeight - r.bottom) - 16 - cari;
    const maxH = Math.max(140, Math.min(288, ruang));
    setPos(openUp
      ? { left: r.left, bottom: window.innerHeight - r.top + 4, width: r.width, maxH }
      : { left: r.left, top: r.bottom + 4, width: r.width, maxH });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onMove = (e: Event) => { if (menuRef.current?.contains(e.target as Node)) return; setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const groups: { name: string; items: SelectOption[] }[] = [];
  shown.forEach((o) => {
    const name = o.group || '';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(o);
  });

  const pad = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  const item = size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2 text-xs';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center justify-between gap-2 rounded-[6px] border bg-white font-medium text-neutral-900 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pad} ${
          open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'
        } ${className}`}
      >
        <span className={`truncate ${current ? '' : 'text-neutral-400'}`}>{current?.label ?? placeholder ?? 'Select...'}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxWidth: menuMaxWidth }}
          className="fixed z-[70] w-max rounded-[6px] border border-neutral-300 bg-white shadow-xl"
        >
          {searchable && (
            <div className="border-b border-neutral-200 p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}
          <ul role="listbox" style={{ maxHeight: pos.maxH }} className="scrollbar-thin max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-xs text-neutral-500">Not found</li>}
            {groups.map((g) => (
              <li key={g.name || '_'} role="presentation">
                {g.name && <p className="px-4 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wider text-black">{g.name}</p>}
                <ul role="group">
                  {g.items.map((o) => {
                    const selected = o.value === value;
                    return (
                      <li key={o.value} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onClick={() => { onChange(o.value); setOpen(false); }}
                          className={`flex w-full items-center justify-between gap-3 text-left transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${item} ${
                            selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'
                          }`}
                        >
                          <span className="truncate">{o.label}</span>
                          {selected && <Check size={14} className="shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pill status                                                         */
/* ------------------------------------------------------------------ */

export type PillTone = 'emerald' | 'blue' | 'amber' | 'red' | 'neutral';

const PILL_STYLE: Record<PillTone, { pill: string; dot: string }> = {
  emerald: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  blue: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  amber: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  red: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  neutral: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
};

export function StatusPill({ tone = 'neutral', label, title }: { tone?: PillTone; label: string; title?: string }) {
  const st = PILL_STYLE[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {label}
    </span>
  );
}

/** Chip ekstensi file (PDF / XLS / CSV) -- sama dengan chip file di tabel Sales. */
export function FileTypeChip({ name, type }: { name?: string | null; type?: string | null }) {
  const ext = (type || (name || '').split('.').pop() || '?').replace('.', '').slice(0, 3).toUpperCase();
  return (
    <div className="flex h-5 min-w-[28px] items-center justify-center rounded bg-blue-600 px-1 text-[9px] font-bold uppercase tracking-wider text-white">
      {ext}
    </div>
  );
}

/** Bar proporsi kecil + angka persen (dipakai untuk % terverifikasi). */
export function MiniBar({ pct }: { pct: number | null | undefined }) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct as number) ? (pct as number) : 0)));
  const color = p >= 90 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-neutral-600">{pct === null || pct === undefined ? '—' : `${p}%`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kartu KPI & panel                                                   */
/* ------------------------------------------------------------------ */

export function SourceKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string;
  count: number;
  detail: string;
  detailUnit: string;
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
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Varian SourceKpiTile dengan nilai berupa teks (mis. "Rp 1.250.000") dan baris sub opsional.
// Desain identik dengan PostedKpiTile di Sales Posted (garis aksen hitam tipis di atas, ikon netral,
// bar proporsi netral, teks persentase di bawah).
export function PostedKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
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
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? ''}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

export function SourcePanel({ title, subtitle, leading, action, children, flush = false, onHeaderClick, open = true, compact = false }: {
  title: string;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  /** true = isi tanpa padding (untuk tabel penuh lebar). */
  flush?: boolean;
  /** Kalau diisi, area judul bisa diklik (panel lipat). */
  onHeaderClick?: () => void;
  /** Hanya dipakai panel lipat: kalau false garis bawah header & isi disembunyikan. */
  open?: boolean;
  /** true = header tipis (hanya judul), dipakai panel pengaturan yang tertutup secara default. */
  compact?: boolean;
}) {
  const heading = (
    <div className="flex min-w-0 items-center gap-3 text-left">
      {leading}
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs font-medium text-neutral-500">{subtitle}</p>}
      </div>
    </div>
  );
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className={`flex items-center justify-between gap-3 bg-neutral-50 px-4 ${compact ? 'py-2.5' : 'pb-3 pt-4'} ${open ? 'border-b border-neutral-300' : ''}`}>
        {onHeaderClick ? (
          <button type="button" onClick={onHeaderClick} className="min-w-0 flex-1">{heading}</button>
        ) : heading}
        {action}
      </div>
      {open && children !== undefined && <div className={flush ? '' : 'p-4'}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paginasi                                                            */
/* ------------------------------------------------------------------ */

export function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

export function TablePagination({ total, page, pageSize, onPage, onPageSize, unit }: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  unit: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safe - 1) * pageSize + 1;
  const to = Math.min(safe * pageSize, total);
  const navBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-300 px-4 py-3 text-xs text-neutral-500">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <FilterSelect
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
            ariaLabel="Rows per page"
            openUp
            className="min-w-[64px]"
          />
        </label>
        <span className="hidden text-neutral-300 sm:inline">|</span>
        <span>
          <span className="font-semibold text-neutral-900">{from}–{to}</span> of{' '}
          <span className="font-semibold text-neutral-900">{total.toLocaleString('id-ID')}</span> {unit}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(safe - 1)} disabled={safe <= 1} aria-label="Previous page" className={navBtn}><ChevronLeft size={16} /></button>
        {buildPageItems(safe, totalPages).map((p, idx) =>
          p === '…' ? (
            <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-neutral-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === safe ? 'page' : undefined}
              className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === safe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
            >
              {p}
            </button>
          ),
        )}
        <button onClick={() => onPage(safe + 1)} disabled={safe >= totalPages} aria-label="Next page" className={navBtn}><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cangkang modal bergaya elegan (garis aksen hitam, header abu muda, footer
 * terpisah). Dirender lewat portal ke <body> supaya tidak terpotong container.
 */
export function ModalShell({ title, subtitle, icon, onClose, closeDisabled, maxWidth = 'max-w-lg', children, footer }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidth?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !closeDisabled) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closeDisabled]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4 backdrop-blur-[1px]">
      <div className={`relative flex max-h-[94vh] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-xl`}>
        <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
        <div className="flex items-start justify-between gap-4 border-b border-neutral-300 bg-neutral-50 px-5 pb-3 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className={PANEL_ICON_CHIP}>{icon}</span>}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-neutral-900">{title}</h3>
              {subtitle && <div className="mt-0.5 text-xs font-medium text-neutral-500">{subtitle}</div>}
            </div>
          </div>
          <button onClick={onClose} disabled={closeDisabled} aria-label="Close" className={ICON_BTN}><X size={16} /></button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-3 border-t border-neutral-300 bg-neutral-50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}