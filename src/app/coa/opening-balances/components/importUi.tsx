import React from 'react';
import { Ban, Building2, CheckCircle2, Circle, Clock, FileText, Package, ShieldCheck, Users, XCircle } from 'lucide-react';
import type { ImportBatch, ImportBatchStatus, ImportModule } from '@/lib/openingBalanceImportStore';

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
    desc: 'Upload legacy chart of accounts and non-subledger balances in one file.',
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
  if (batch.status === 'validated' && batch.blocking_issues.length > 0) return 'has_errors';
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
