'use client';

// Varian bertema SALES dari arapUi.tsx -- dipakai HANYA oleh halaman AR, AP, FX Transfers, FX Revaluation.
// arapUi.tsx sengaja tidak diubah karena dipakai juga oleh Assets, Tax, Inventory, Other, dan Purchase.

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react';
import {
  BUCKET_LABEL, BUCKET_STYLE, DOC_STATUS_DOT, DOC_STATUS_LABEL, DOC_STATUS_TEXT, fmtDate, fmtDateTime, PAYMENT_METHOD_LABEL,
  reverseSettlement, rupiah, SETTLEMENT_STATUS_LABEL, SETTLEMENT_STATUS_STYLE, SOURCE_LABEL, todayIso,
  type AgingBucket, type ArApDoc, type DocStatus, type Settlement, type SettlementStatus, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Komponen kecil bersama halaman Accounts Receivable & Accounts Payable.

export function Card({ title, subtitle, action, children, className = '' }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <section className={`relative rounded-lg border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-xl before:bg-neutral-800 ${className}`}>
      {(title || action) && (
        <div className="flex flex-col gap-3 rounded-t-xl border-b border-neutral-300 bg-neutral-50 px-5 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs font-medium text-neutral-500">{subtitle}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function AgingBadge({ bucket }: { bucket: AgingBucket | null }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  if (!bucket) return <span className="text-xs text-neutral-500">—</span>;
  return <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${BUCKET_STYLE[bucket]}`}>{BUCKET_LABEL[bucket]}</span>;
}

export function DocStatusLabel({ status }: { status: DocStatus }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${DOC_STATUS_TEXT[status]}`}>
      <span className={`h-2 w-2 rounded-full ${DOC_STATUS_DOT[status]}`} />
      {DOC_STATUS_LABEL[status]}
    </span>
  );
}

export function SettlementBadge({ status }: { status: SettlementStatus }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${SETTLEMENT_STATUS_STYLE[status]}`}>{SETTLEMENT_STATUS_LABEL[status]}</span>;
}

export type SortDir = 'asc' | 'desc';

export function SortTh<K extends string>({ label, k, sort, onSort, align = 'left', className = '' }: {
  label: string; k: K; sort: { key: K; dir: SortDir }; onSort: (k: K) => void; align?: 'left' | 'right'; className?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const aktif = sort.key === k;
  const Ikon = !aktif ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-neutral-900 ${aktif ? 'text-neutral-900' : ''}`}>
        {label} <Ikon size={12} className={aktif ? '' : 'opacity-50'} />
      </button>
    </th>
  );
}

export function useSort<K extends string>(awal: K, arah: SortDir = 'desc') {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: awal, dir: arah });
  const onSort = (k: K) => setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));
  return { sort, onSort };
}

export function sortRows<T>(rows: T[], get: (r: T) => string | number | null, dir: SortDir): T[] {
  const k = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * k;
  });
}

export function Pager({ page, pageSize, total, onPage, onPageSize, sizes = [5, 10, 25, 50] }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; sizes?: number[];
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const halaman = Math.max(1, Math.ceil(total / pageSize));
  const dari = total ? page * pageSize + 1 : 0;
  const sampai = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-end gap-4 px-5 py-3 text-xs text-neutral-500">
      <label className="flex items-center gap-2">
        Rows per page:
        <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 bg-card px-2 py-1.5 text-xs font-medium text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300">
          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span>{dari}–{sampai} of {total}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page"
          className="rounded-md p-1 hover:bg-neutral-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
        <button type="button" disabled={page >= halaman - 1} onClick={() => onPage(page + 1)} aria-label="Next page"
          className="rounded-md p-1 hover:bg-neutral-100 disabled:opacity-30"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/** Paginasi bernomor: "Showing 1 - 10 of 28 {noun}" + rows per page + tombol halaman. */
export function NumberPager({ page, pageSize, total, onPage, onPageSize, noun = 'rows', sizes = [10, 25, 50, 100] }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; noun?: string; sizes?: number[];
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const halaman = Math.max(1, Math.ceil(total / pageSize));
  const dari = total ? page * pageSize + 1 : 0;
  const sampai = Math.min(total, (page + 1) * pageSize);
  const nomor: (number | '…')[] = [];
  for (let i = 0; i < halaman; i += 1) {
    if (i === 0 || i === halaman - 1 || Math.abs(i - page) <= 1) nomor.push(i);
    else if (nomor[nomor.length - 1] !== '…') nomor.push('…');
  }
  const tombol = 'flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-xs';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-neutral-500">
      <span>Showing {dari} - {sampai} of {total} {noun}</span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          Rows per page:
          <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
            className="rounded-lg border border-neutral-300 bg-card px-2 py-1.5 text-xs font-medium text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300">
            {sizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page"
            className={`${tombol} border-neutral-300 hover:bg-neutral-50 disabled:opacity-30`}><ChevronLeft size={14} /></button>
          {nomor.map((n, i) => n === '…' ? <span key={`e${i}`} className="px-1">…</span> : (
            <button key={n} type="button" onClick={() => onPage(n)}
              className={`${tombol} ${n === page ? 'border-neutral-800 bg-neutral-800 font-semibold text-white' : 'border-neutral-300 text-neutral-900 hover:bg-neutral-50'}`}>{n + 1}</button>
          ))}
          <button type="button" disabled={page >= halaman - 1} onClick={() => onPage(page + 1)} aria-label="Next page"
            className={`${tombol} border-neutral-300 hover:bg-neutral-50 disabled:opacity-30`}><ChevronRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/** Menu dropdown sederhana (tutup saat klik di luar). */
export function Menu({ button, children, align = 'right', width = 'w-56' }: {
  button: (open: boolean) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; width?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const tutup = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(o => !o)}>{button(open)}</div>
      {open && (
        <div className={`absolute z-30 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} rounded-lg border border-neutral-300 bg-white p-1 shadow-lg`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, href, children, danger, disabled, strong }: {
  onClick?: () => void; href?: string; children: React.ReactNode; danger?: boolean; disabled?: boolean;
  /** Hover abu-abu pekat (konsisten dengan dropdown di Sales/Purchase/Journal Entry/Cash & Bank/Other). */
  strong?: boolean;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const cls = `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${danger ? 'text-rose-600 hover:bg-rose-50' : strong ? 'text-neutral-800 hover:bg-neutral-300 hover:text-neutral-900' : 'text-neutral-900 hover:bg-neutral-50'} ${disabled ? 'pointer-events-none opacity-40' : ''}`;
  if (href) return <Link href={href} className={cls} onClick={onClick}>{children}</Link>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-neutral-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-neutral-300 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-neutral-900">{title}</h3>
            {subtitle && <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-300 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="mt-0.5 text-sm text-neutral-900">{children}</div>
    </div>
  );
}

export function EmptyRow({ cols, text, loading }: { cols: number; text: string; loading?: boolean }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  if (loading) {
    return (
      <>
        {[0, 1, 2].map(i => (
          <tr key={i}><td colSpan={cols} className="px-3 py-3"><div className="h-5 animate-pulse rounded bg-neutral-100" /></td></tr>
        ))}
      </>
    );
  }
  return <tr><td colSpan={cols} className="px-3 py-10 text-center text-xs text-neutral-500">{text}</td></tr>;
}

export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50';
export const btnOutline = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50';
export const btnSmall = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50';
export const inputCls = 'w-full rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:bg-neutral-50';

export function DocDrawer({ cfg, doc, settlements, onClose }: {
  cfg: SideConfig; doc: ArApDoc | null; settlements: Settlement[]; onClose: () => void;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  if (!doc) return null;
  const kolom = cfg.side === 'ar' ? 'sales_invoice_id' : 'purchase_transaction_id';
  const riwayat = settlements
    .map(s => ({ s, amount: s.lines.filter(l => l[kolom] === doc.id).reduce((n, l) => n + l.amount, 0) }))
    .filter(x => x.amount !== 0);
  const settlePath = `${cfg.basePath}/${cfg.side === 'ar' ? 'receipts' : 'payments'}/new`;
  return (
    <Drawer open onClose={onClose} title={doc.no} subtitle={<>{doc.party}{doc.ref_no ? ` · ${doc.ref_no}` : ''}</>}
      footer={<>
        <Link href={`${cfg.basePath}?tab=statements&party=${encodeURIComponent(doc.party)}`} className={btnSmall} onClick={onClose}>{cfg.party} Statement</Link>
        {doc.available > 0 && (
          <Link href={`${settlePath}?party=${encodeURIComponent(doc.party)}&invoice=${doc.id}`} className={`${btnSmall} border-transparent bg-neutral-800 text-white hover:bg-neutral-700`}>
            Record {cfg.settle}
          </Link>
        )}
      </>}>
      <div className="flex flex-wrap items-center gap-3">
        <DocStatusLabel status={doc.status} />
        <AgingBadge bucket={doc.bucket} />
        {doc.days_overdue > 0 && <span className="text-xs text-rose-600">{doc.days_overdue} days overdue</span>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`${cfg.doc} Date`}>{fmtDate(doc.date)}</Field>
        <Field label="Due Date">{fmtDate(doc.due_date)}{doc.due_date_estimated && <span className="ml-1 text-[11px] text-neutral-500">(from terms)</span>}</Field>
        <Field label="Total">{rupiah(doc.total)}</Field>
        <Field label={cfg.settled}>{rupiah(doc.paid)}</Field>
        <Field label="Outstanding"><span className="font-semibold">{rupiah(doc.outstanding)}</span></Field>
        <Field label="In Process (not posted)">{rupiah(doc.in_process)}</Field>
        <Field label={cfg.side === 'ar' ? 'Receivable Account' : 'Payable Account'}>{kodeAkun(doc.account_code)} · {doc.account_name || '—'}</Field>
        <Field label={`Last ${cfg.settle}`}>{fmtDate(doc.last_payment_date)}</Field>
      </div>
      {doc.description && <Field label="Description"><span className="whitespace-pre-line text-neutral-500">{doc.description}</span></Field>}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-900">{cfg.settle} History</h4>
        {riwayat.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-xs text-neutral-500">No {cfg.settle.toLowerCase()}s recorded through Cash & Bank yet.</p>
        ) : (
          <div className="divide-y divide-neutral-300 rounded-lg border border-neutral-300">
            {riwayat.map(({ s, amount }) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{s.tx_number}</p>
                  <p className="text-[11px] text-neutral-500">{fmtDate(s.tx_date)} · {s.payment_method ? PAYMENT_METHOD_LABEL[s.payment_method] : SOURCE_LABEL[s.source]} · {kodeAkun(s.bank_account_code)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-neutral-900">{rupiah(amount)}</p>
                  <SettlementBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Detail 1 receipt / payment + jurnalnya. */
export function SettlementDrawer({ cfg, s, onClose, actions }: {
  cfg: SideConfig; s: Settlement | null; onClose: () => void; actions?: React.ReactNode;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  if (!s) return null;
  const totalD = s.journal.reduce((n, j) => n + j.debit, 0);
  const totalK = s.journal.reduce((n, j) => n + j.credit, 0);
  return (
    <Drawer open onClose={onClose} title={s.tx_number} subtitle={<>{s.counterparty || '—'} · {fmtDate(s.tx_date)}</>} footer={actions}>
      <div className="flex flex-wrap items-center gap-2">
        <SettlementBadge status={s.status} />
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{SOURCE_LABEL[s.source]}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount"><span className="font-semibold">{rupiah(s.amount)}</span></Field>
        <Field label="Payment Method">{s.payment_method ? PAYMENT_METHOD_LABEL[s.payment_method] : '—'}</Field>
        <Field label={cfg.side === 'ar' ? 'Deposited To' : 'Paid From'}>{kodeAkun(s.bank_account_code)} · {s.bank_account_name}</Field>
        <Field label="Reference">{s.reference || '—'}{s.reference_date ? ` · ${fmtDate(s.reference_date)}` : ''}</Field>
        <Field label="Allocated">{rupiah(s.allocated)}</Field>
        <Field label="Unapplied">{rupiah(s.unapplied)}</Field>
      </div>
      {s.description && <Field label="Notes"><span className="text-neutral-500">{s.description}</span></Field>}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-900">Allocation</h4>
        <div className="divide-y divide-neutral-300 rounded-lg border border-neutral-300">
          {s.lines.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{l.invoice_no ?? `${kodeAkun(l.account_code)} · ${l.account_name}`}</span>
              <span className="font-medium">{rupiah(l.amount)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-900">Journal</h4>
        <table className="w-full text-xs">
          <thead><tr className="bg-neutral-300 text-left text-xs text-black [&>th]:border-y [&>th]:border-neutral-800 [&>th]:py-2 [&>th]:font-bold">
            <th className="py-1.5">Account</th><th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th>
          </tr></thead>
          <tbody className="divide-y divide-neutral-300">
            {s.journal.map(j => (
              <tr key={j.line_no}>
                <td className="py-1.5 pr-2"><span className="font-medium">{kodeAkun(j.account_code)}</span> · {j.account_name}</td>
                <td className="py-1.5 text-right">{j.debit ? rupiah(j.debit) : ''}</td>
                <td className="py-1.5 text-right">{j.credit ? rupiah(j.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-neutral-300 font-semibold">
            <td className="py-1.5">Total</td><td className="py-1.5 text-right">{rupiah(totalD)}</td><td className="py-1.5 text-right">{rupiah(totalK)}</td>
          </tr></tfoot>
        </table>
        {s.status === 'reversed' && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Reversed on {fmtDate(s.reversal_date)} by {s.reversed_by_name || '—'} (journal RV-{s.tx_number}). Reason: {s.reversal_reason}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs text-neutral-500">
        <span>Created: {fmtDateTime(s.created_at)} · {s.created_by_name || '—'}</span>
        <span>Posted: {fmtDateTime(s.posted_at)} · {s.posted_by_name || '—'}</span>
      </div>
      {s.source !== cfg.side && (
        <Link href="/transactions/bank-cash/posted" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
          Open in Cash & Bank <ExternalLink size={12} />
        </Link>
      )}
    </Drawer>
  );
}

/** Modal balik receipt / payment posted. */
export function ReverseModal({ cfg, clientId, s, onClose }: { cfg: SideConfig; clientId: string; s: Settlement | null; onClose: () => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [reason, setReason] = useState('');
  const [tanggal, setTanggal] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setTanggal(todayIso()); }, [s]);
  if (!s) return null;
  const kirim = async () => {
    setBusy(true);
    try {
      const r = await reverseSettlement(cfg.side, clientId, s.id, reason.trim(), tanggal);
      toast.success(r.message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-900">Reverse {s.tx_number}</h3>
        <p className="mt-1 text-xs text-neutral-500">
          A reversing journal (RV-{s.tx_number}) is posted on the reversal date and the {cfg.docs.toLowerCase()} become outstanding again.
        </p>
        <label className="mt-4 block text-xs font-medium text-neutral-900">Reversal date</label>
        <input type="date" value={tanggal} min={s.tx_date} onChange={e => setTanggal(e.target.value)} className={`${inputCls} mt-1`} />
        <label className="mt-3 block text-xs font-medium text-neutral-900">Reason</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} className={`${inputCls} mt-1`}
          placeholder="e.g. Recorded against the wrong customer" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" onClick={kirim} disabled={busy || reason.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />} Reverse
          </button>
        </div>
      </div>
    </div>
  );
}

/** Label field gaya Sales. */
export function FormField({ label, hint, required, children, className = '' }: {
  label: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-neutral-500">{hint}</span>}
    </label>
  );
}

// Gaya tab halaman Sales -- garis bawah hitam, ikon garis tipis (salinan dari SalesClient.tsx).
export const tabBarCls = 'flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between';
export const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
export const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
export const tabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-neutral-800 px-1.5 py-px text-[10px] font-semibold text-white';