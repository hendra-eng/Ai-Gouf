'use client';

// Komponen kecil bersama modul Fixed Assets, Inventory, Tax Compliance (kartu KPI, badge, pilih akun,
// dialog konfirmasi / reverse). Tombol, Card, Drawer, Menu memakai
// src/components/arap/arapUi.tsx supaya gaya halaman sama dengan AR/AP.

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { pctChange, todayIso } from '@/lib/receivablesPayablesStore';
import type { CoaAccount } from '@/lib/fixedAssetsStore';  // bentuk sama dengan akun COA Inventory
import { btnOutline, inputCls } from '@/components/arap/arapUi';

export function Delta({ now, prev, goodWhenDown = false, suffix, unit = 'pct' }: {
  now: number | null | undefined; prev: number | null | undefined; goodWhenDown?: boolean; suffix: string; unit?: 'pct' | 'abs';
}) {
  if (now === null || now === undefined || prev === null || prev === undefined) return <span className="text-[11px] text-muted-foreground">{suffix}</span>;
  const selisih = unit === 'pct' ? pctChange(now, prev) : now - prev;
  if (selisih === null) {
    return <span className="text-[11px] text-muted-foreground">{now ? `New ${suffix}` : `No change ${suffix}`}</span>;
  }
  if (Math.abs(selisih) < 0.05) return <span className="text-[11px] text-muted-foreground">No change {suffix}</span>;
  const naik = selisih > 0;
  const baik = goodWhenDown ? !naik : naik;
  const Ikon = naik ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold ${baik ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
        <Ikon size={11} /> {unit === 'pct' ? `${Math.abs(selisih).toFixed(1)}%` : Math.abs(selisih).toLocaleString('en-US')}
      </span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

export interface KpiCardSpec {
  label: string;
  value: string;
  icon: React.ElementType;
  /** green / red / blue / amber -- warna latar kartu & ikon seperti template. */
  tone: 'green' | 'red' | 'blue' | 'amber';
  delta: React.ReactNode;
}

const TONE: Record<KpiCardSpec['tone'], { card: string; icon: string }> = {
  green: { card: 'border-border bg-card', icon: 'bg-emerald-50 text-emerald-600' },
  red: { card: 'border-rose-100 bg-rose-50/40', icon: 'bg-rose-100 text-rose-600' },
  blue: { card: 'border-sky-100 bg-sky-50/40', icon: 'bg-sky-100 text-sky-600' },
  amber: { card: 'border-amber-100 bg-amber-50/40', icon: 'bg-amber-100 text-amber-600' },
};

const KOLOM_KPI: Record<4 | 5 | 6, string> = { 4: 'xl:grid-cols-4', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' };

export function KpiGrid({ cards, loading, cols = 4 }: { cards: KpiCardSpec[]; loading?: boolean; cols?: 4 | 5 | 6 }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${KOLOM_KPI[cols]}`}>
      {cards.map(c => {
        const Ikon = c.icon;
        const t = TONE[c.tone];
        return (
          <div key={c.label} className={`rounded-2xl border p-4 shadow-sm ${t.card}`}>
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.icon}`}><Ikon size={20} /></span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-muted-foreground">{c.label}</p>
                {loading ? <div className="mt-1 h-6 w-28 animate-pulse rounded bg-slate-100" /> : (
                  <p className="mt-0.5 truncate text-xl font-bold text-foreground">{c.value}</p>
                )}
                <div className="mt-1">{c.delta}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Pill({ label, style }: { label: string; style: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{label}</span>;
}

/** Pilih akun COA dengan pencarian kode/nama; `filter` membatasi daftar (mis. hanya akun kas). */
export function AccountSelect<A extends CoaAccount>({ accounts, value, onChange, placeholder = 'Select account', filter, disabled, allowEmpty = true }: {
  accounts: A[]; value: string | null | undefined; onChange: (id: string | null) => void; placeholder?: string;
  filter?: (a: A) => boolean; disabled?: boolean; allowEmpty?: boolean;
}) {
  const daftar = useMemo(() => {
    const d = filter ? accounts.filter(filter) : accounts;
    // Akun terpilih tetap tampil walau di luar filter.
    if (value && !d.some(a => a.id === value)) {
      const x = accounts.find(a => a.id === value);
      if (x) return [x, ...d];
    }
    return d;
  }, [accounts, filter, value]);
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} disabled={disabled} className={inputCls}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {daftar.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
    </select>
  );
}

export function FormField({ label, hint, required, children, className = '' }: {
  label: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-foreground">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-md' }: {
  open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl`} onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-4 space-y-3">{children}</div>
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Dialog alasan + tanggal untuk reverse / reject. */
export function ReasonDialog({ open, title, subtitle, withDate, minDate, defaultDate, confirmLabel = 'Reverse', danger = true, onClose, onConfirm }: {
  open: boolean; title: string; subtitle?: string; withDate?: boolean; minDate?: string; defaultDate?: string; confirmLabel?: string; danger?: boolean;
  onClose: () => void; onConfirm: (reason: string, date: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [tanggal, setTanggal] = useState(defaultDate || todayIso());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setTanggal(defaultDate || todayIso()); } }, [open, defaultDate]);
  const kirim = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim(), tanggal);
      onClose();
    } catch {
      // Pemanggil sudah menampilkan toast error; dialog tetap terbuka.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} footer={<>
      <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
      <button type="button" onClick={kirim} disabled={busy || reason.trim().length < 3}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#0F7D4E] hover:bg-[#0c6a42]'}`}>
        {busy && <Loader2 size={14} className="animate-spin" />} {confirmLabel}
      </button>
    </>}>
      {withDate && (
        <FormField label="Date">
          <input type="date" value={tanggal} min={minDate} onChange={e => setTanggal(e.target.value)} className={inputCls} />
        </FormField>
      )}
      <FormField label="Reason" required>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} className={inputCls} />
      </FormField>
    </Modal>
  );
}

/** Tabel jurnal (akun, debit, kredit) + total. */
export function JournalLines({ lines }: { lines: { account_code: string; account_name: string; debit: number; credit: number; description?: string | null }[] }) {
  const d = lines.reduce((n, l) => n + l.debit, 0);
  const k = lines.reduce((n, l) => n + l.credit, 0);
  const f = (n: number) => (n ? n.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '');
  return (
    <table className="w-full text-xs">
      <thead><tr className="border-b border-border text-left text-muted-foreground">
        <th className="py-1.5">Account</th><th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        {lines.map((l, i) => (
          <tr key={i}>
            <td className="py-1.5 pr-2"><span className="font-medium">{l.account_code}</span> · {l.account_name}
              {l.description && <span className="block text-[10px] text-muted-foreground">{l.description}</span>}</td>
            <td className="py-1.5 text-right">{f(l.debit)}</td>
            <td className="py-1.5 text-right">{f(l.credit)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr className="border-t border-border font-semibold">
        <td className="py-1.5">Total</td><td className="py-1.5 text-right">{f(d)}</td><td className="py-1.5 text-right">{f(k)}</td>
      </tr></tfoot>
    </table>
  );
}

export const thCls = 'px-3 py-2.5 text-left font-medium';
export const tdCls = 'px-3 py-2.5';
export const tableHeadRow = 'bg-slate-50 text-xs text-muted-foreground';

/** Gaya tab halaman (acuan: Transactions > Other) — underline hijau, ikon 16px.
 *  tabNavCls = nav berdiri sendiri; tabBarCls + tabListCls = nav + kontrol di kanan. */
export const tabNavCls = '-mb-px flex gap-1 overflow-x-auto border-b border-border';
export const tabBarCls = 'flex flex-col gap-2 border-b border-border lg:flex-row lg:items-center lg:justify-between';
export const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
export const tabCls = (active: boolean) =>
  `flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${active ? 'border-[#0F7D4E] font-semibold text-[#0F7D4E]' : 'border-transparent text-muted-foreground hover:text-foreground'}`;
export const tabBadgeCls = 'inline-flex min-w-[16px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800';

/** Klasifikasi akun dari COA untuk filter dropdown. */
export const isCashAccount = (a: CoaAccount) => (a.standard_code || '').startsWith('std_asset_current_cash') || (a.sub || '').toUpperCase().includes('CASH');
export const isPpeAccount = (a: CoaAccount) => (a.standard_code || '').startsWith('std_asset_noncurrent_ppe') && !(a.standard_code || '').includes('accum');
export const isAccumAccount = (a: CoaAccount) => (a.standard_code || '').includes('accum_depreciation') || /akumulasi|accumulated/i.test(a.name);
export const isDepExpense = (a: CoaAccount) => (a.standard_code || '').includes('depreciation') && (a.classification || '').toUpperCase().includes('EXPENSE')
  || /penyusutan|depreciation/i.test(a.name) && (a.classification || '').toUpperCase().includes('EXPENSE');
export const isPnlAccount = (a: CoaAccount) => /REVENUE|INCOME|EXPENSE|COST/i.test(a.classification || '');
