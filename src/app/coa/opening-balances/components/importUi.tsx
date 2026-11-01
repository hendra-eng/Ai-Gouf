import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, Building2, CheckCircle2, Circle, Clock, FileText, Package, ShieldCheck, Users, XCircle } from 'lucide-react';
import type { ImportBatch, ImportBatchStatus, ImportControlStatus, ImportModule } from '@/lib/openingBalanceImportStore';
import { formatAmount } from '@/lib/openingBalanceStore';

// Metadata 5 modul import opening balance (dipakai tab Import Data & halaman
// monitoring/approval). Semua template dibuat server dari data klien.
// `amounts` = nominal batch yang ditampilkan (total_debit / total_credit artinya
// beda per modul: coa debit/kredit, asset biaya/akumulasi, ar/ap outstanding,
// inventory nilai stok).
export interface ImportModuleMeta {
  key: ImportModule;
  no: number;
  title: string;
  desc: string;
  icon: React.ElementType;
  iconCls: string;
  amounts: { label: string; field: 'total_debit' | 'total_credit' }[];
}

export const IMPORT_MODULE_META: ImportModuleMeta[] = [
  {
    key: 'coa',
    no: 1,
    title: 'Import Legacy COA + Non-Subledger Opening Balances',
    desc: 'Upload legacy chart of accounts and non-subledger balances in one file. New accounts are added to the COA on approval.',
    icon: FileText,
    iconCls: 'bg-sky-50 text-sky-600',
    amounts: [{ label: 'Debit', field: 'total_debit' }, { label: 'Credit', field: 'total_credit' }],
  },
  {
    key: 'ar',
    no: 2,
    title: 'Import Opening AR',
    desc: 'Upload outstanding customer invoices as opening Accounts Receivable.',
    icon: Users,
    iconCls: 'bg-emerald-50 text-emerald-600',
    amounts: [{ label: 'Outstanding', field: 'total_debit' }],
  },
  {
    key: 'ap',
    no: 3,
    title: 'Import Opening AP',
    desc: 'Upload outstanding vendor bills as opening Accounts Payable.',
    icon: Users,
    iconCls: 'bg-orange-50 text-orange-600',
    amounts: [{ label: 'Outstanding', field: 'total_credit' }],
  },
  {
    key: 'inventory',
    no: 4,
    title: 'Import Opening Stock Inventory',
    desc: 'Upload opening stock by item, warehouse, quantity, and unit cost.',
    icon: Package,
    iconCls: 'bg-violet-50 text-violet-600',
    amounts: [{ label: 'Stock value', field: 'total_debit' }],
  },
  {
    key: 'asset',
    no: 5,
    title: 'Import Asset Register',
    desc: 'Upload fixed asset register including cost, accumulated depreciation, and useful life.',
    icon: Building2,
    iconCls: 'bg-rose-50 text-rose-600',
    amounts: [{ label: 'Cost', field: 'total_debit' }, { label: 'Accum. dep.', field: 'total_credit' }],
  },
];

export const metaModul = (k: string) => IMPORT_MODULE_META.find(m => m.key === k) ?? null;

type BadgeKey = ImportBatchStatus | 'not_started' | 'has_errors';

const BADGE: Record<BadgeKey, { label: string; cls: string; icon: React.ElementType }> = {
  not_started: { label: 'Not Started', cls: 'bg-slate-100 text-slate-600', icon: Circle },
  has_errors: { label: 'Has Errors', cls: 'bg-red-50 text-red-700', icon: XCircle },
  validated: { label: 'Ready', cls: 'bg-sky-50 text-sky-700', icon: Clock },
  submitted: { label: 'Pending Approval', cls: 'bg-amber-50 text-amber-700', icon: ShieldCheck },
  approved: { label: 'Imported', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700', icon: XCircle },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500', icon: Ban },
};

export function badgeKey(batch: ImportBatch | null): BadgeKey {
  if (!batch) return 'not_started';
  if (batch.status === 'validated' && batch.error_rows > 0) return 'has_errors';
  return batch.status;
}

export function BatchStatusBadge({ batch, status, className = '' }: { batch?: ImportBatch | null; status?: BadgeKey; className?: string }) {
  const s = BADGE[status ?? badgeKey(batch ?? null)];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.cls} ${className}`}>
      <Icon size={13} /> {s.label}
    </span>
  );
}

const fmtWaktu = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : fmtWaktu.format(d);
}

// Status saldo akun kontrol per modul subledger (backend _status_kontrol): saldo dari
// file COA diterima SEMENTARA -> notifikasi "detail required" sampai modulnya di-approve,
// lalu dibandingkan dengan total subledger (subledger yang berlaku).
export function controlStatusText(s: ImportControlStatus): string {
  if (s.status === 'pending') return `Provisional balance ${formatAmount(s.opening_balance)} — detail required`;
  if (s.status === 'reconciled') return `Subledger ${formatAmount(s.opening_balance)} matches the COA import`;
  return `Subledger ${formatAmount(s.opening_balance)} vs COA import ${formatAmount(s.coa_amount ?? 0)} — difference ${formatAmount(s.difference ?? 0)}`;
}

export function ControlStatusLine({ status }: { status: ImportControlStatus }) {
  const cls = status.status === 'reconciled' ? 'text-emerald-700' : status.status === 'pending' ? 'text-amber-700' : 'text-red-700';
  const Icon = status.status === 'reconciled' ? CheckCircle2 : AlertTriangle;
  return (
    <p className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${cls}`}>
      <Icon size={12} className="shrink-0" /> {controlStatusText(status)}
    </p>
  );
}

/** Banner: modul subledger yang saldonya masih sementara / beda dengan file COA. */
export function ControlStatusBanner({ items, obId }: { items: ImportControlStatus[]; obId?: string }) {
  const tampil = items.filter(s => s.status !== 'reconciled');
  if (tampil.length === 0) return null;
  const pending = tampil.filter(s => s.status === 'pending');
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 text-xs leading-relaxed text-amber-900">
        {pending.length > 0 && (
          <p>
            <span className="font-semibold">Subledger detail still required:</span> the balances of{' '}
            {pending.map(s => s.label).join(', ')} are provisional (from the COA import). The opening balance can still be
            posted — import the detail through their modules later; the subledger total then replaces the provisional amount.
          </p>
        )}
        <ul className="mt-1 space-y-0.5">
          {tampil.map(s => (
            <li key={s.module}>
              {obId
                ? <Link href={`/coa/opening-balances/${obId}/imports/${s.module}`} className="font-semibold hover:underline">{s.module_label}</Link>
                : <span className="font-semibold">{s.module_label}</span>}
              {': '}{controlStatusText(s)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
