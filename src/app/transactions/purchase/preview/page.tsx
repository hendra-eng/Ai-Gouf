'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Search, CheckCircle, Check, X, Eye, Info, FileText, Clock, ShieldCheck, BookOpen,
  Landmark, Scale, Inbox, Send, FileSpreadsheet, Layers, Undo2, Ban, AlertTriangle,
} from 'lucide-react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import SalesLoading from '@/app/transactions/sales/components/SalesLoading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import type { PurchaseStatus, PaymentStatus, PurchaseTransaction } from '@/data/purchaseData';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi, updatePurchaseTransaction } from '@/lib/purchaseStore';
import { PickerPagination } from '@/app/transactions/components/PreviewLayout';
import { runPurchaseStatusAction } from '@/app/transactions/purchase/components/purchaseStatusActions';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const ITEMS_PER_PAGE = 5;

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const formatAngka = (n: number) => n.toLocaleString('id-ID');

// ── Pill status bergaris + titik berwarna -- sama dengan StatusPill di Sales Journal Preview ──
type Tone = 'slate' | 'amber' | 'blue' | 'sky' | 'teal' | 'orange' | 'emerald' | 'red' | 'neutral';
const PILL: Record<Tone, { pill: string; dot: string }> = {
  slate: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
  amber: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  blue: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  sky: { pill: 'bg-sky-100 text-sky-800 border-sky-300', dot: 'bg-sky-600' },
  teal: { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' },
  orange: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  emerald: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  red: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  neutral: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
};

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const st = PILL[tone] || PILL.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {label}
    </span>
  );
}

const statusTones: Record<PurchaseStatus, Tone> = {
  draft: 'slate',
  pending_review: 'amber',
  approved: 'blue',
  pending_posting: 'sky',
  posted: 'teal',
  rejected: 'red',
  exception: 'orange',
  cancelled: 'neutral',
};

const statusLabels: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

const paymentTones: Record<PaymentStatus, Tone> = {
  unpaid: 'red',
  partially_paid: 'orange',
  paid: 'emerald',
  overdue: 'red',
  on_hold: 'neutral',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

// Kelompok status untuk filter antrian & KPI.
type QueueGroup = 'pending' | 'approved' | 'posted' | 'other';
const groupOf = (s: PurchaseStatus): QueueGroup =>
  s === 'draft' || s === 'pending_review' ? 'pending'
  : s === 'approved' || s === 'pending_posting' ? 'approved'
  : s === 'posted' ? 'posted'
  : 'other';

// Posisi stepper per status (Sales: Diproses -> 4, Siap Posting -> 5, Diposting -> 6).
const stepForStatus = (s: PurchaseStatus) => {
  const g = groupOf(s);
  if (g === 'posted') return 6;
  if (g === 'approved') return 5;
  return 4;
};

const STEPS = [
  { n: 1, label: 'Source Document', sub: 'Source document' },
  { n: 2, label: 'Purchase Information', sub: 'Vendor & reference' },
  { n: 3, label: 'Line Items', sub: 'Items & GL accounts' },
  { n: 4, label: 'Tax Treatment', sub: 'Input VAT' },
  { n: 5, label: 'Journal', sub: 'Accounting entry' },
  { n: 6, label: 'Approve/Post', sub: 'Approval' },
];

// ── Gaya kontrol -- sama dengan Sales Journal Preview ──
const BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY = `${BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const BTN_PRIMARY = `${BTN_BASE} border border-neutral-800 bg-neutral-800 text-white hover:bg-neutral-700`;

const iconBadge = (node: React.ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200">{node}</span>
);

// Panel putih dengan header terpisah garis -- sama dengan JPanel di Sales Journal Preview.
function JPanel({ title, subtitle, leading, action, children, className = '', flush }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-neutral-900">{title}</h3>
            {subtitle && <p className="truncate text-xs font-medium text-neutral-700">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children !== undefined && children !== null && children !== false && (
        <div className={`flex flex-1 flex-col ${flush ? '' : 'p-4'}`}>{children}</div>
      )}
    </section>
  );
}

// Kartu KPI -- sama dengan JournalKpiTile di Sales Journal Preview.
function JournalKpiTile({ label, value, pct, pctLabel, icon: Icon }: {
  label: string; value: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-700" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50">
          <Icon size={16} className="text-neutral-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-neutral-700">{p}% {pctLabel}</p>
    </div>
  );
}

type SectionState = 'done' | 'active' | 'todo';

// Kartu langkah (1-5): badge nomor mengikuti progres stepper -- sama dengan StepCard di Sales.
function StepCard({ step, state, icon: Icon, title, aside, flush, children }: {
  step: number;
  state: SectionState;
  icon: React.ElementType;
  title: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  const badge =
    state === 'done' ? 'bg-neutral-100 text-neutral-700'
    : state === 'active' ? 'bg-white text-neutral-900 ring-1 ring-neutral-400'
    : 'bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200';
  return (
    <section className={`flex h-full flex-col overflow-hidden rounded-[10px] border bg-white transition-colors ${state === 'active' ? 'border-neutral-400' : 'border-neutral-200'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${badge}`}>
            {state === 'done' ? <Check size={14} strokeWidth={2.5} /> : step}
          </span>
          <h4 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-neutral-900">
            <Icon size={15} className="shrink-0 text-neutral-700" />
            <span className="truncate">{title}</span>
          </h4>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className={`flex-1 ${flush ? '' : 'p-4'}`}>{children}</div>
    </section>
  );
}

interface RowSpec { label: React.ReactNode; value: React.ReactNode; strong?: boolean }

// Daftar label : nilai (label kiri, nilai rata kanan) -- sama dengan Rows di Sales Journal Preview.
function Rows({ rows }: { rows: RowSpec[] }) {
  return (
    <dl className="divide-y divide-neutral-200 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="font-medium text-neutral-700">{r.label}</dt>
          <dd className={`min-w-0 break-words text-right tabular-nums ${r.strong ? 'text-sm font-bold text-neutral-900' : 'font-semibold text-neutral-900'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TAG = 'inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-800';
const MONO = 'rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-neutral-900';

// Accounting impact for a purchase transaction
function getAccountingEntries(tx: PurchaseTransaction) {
  const entries: { account: string; code: string; debit: number; credit: number; description: string }[] = [];

  // Group lines by account
  const accountMap: Record<string, { name: string; amount: number }> = {};
  tx.lines.forEach(line => {
    if (!accountMap[line.accountCode]) {
      accountMap[line.accountCode] = { name: line.accountName, amount: 0 };
    }
    accountMap[line.accountCode].amount += line.subtotal - line.discount;
  });

  // Debit: Expense/Inventory/Asset accounts
  Object.entries(accountMap).forEach(([code, info]) => {
    entries.push({ account: info.name, code, debit: info.amount, credit: 0, description: tx.description });
  });

  // Debit: Input Tax -- akun per transaksi, fallback akun default backend
  // (db_client._AKUN_DEFAULT_PURCHASE) supaya preview == jurnal yang diposting.
  if (tx.taxAmount > 0) {
    entries.push({
      account: tx.taxAccountName || 'VAT Recoverable (Input Tax)',
      code: tx.taxAccountCode || '1300',
      debit: tx.taxAmount, credit: 0, description: 'Input VAT',
    });
  }

  // Credit: Accounts Payable
  entries.push({
    account: tx.apAccountName || 'Accounts Payable',
    code: tx.apAccountCode || '2100',
    debit: 0, credit: tx.accountsPayable,
    description: [tx.vendor, tx.invoiceNumber].filter(Boolean).join(' — '),
  });

  return entries;
}

export default function PurchasePreviewPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const { transactions: backendTransactions, loading } = usePurchaseTransactions(activeClientId ?? null);
  const purchaseTransactions = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'post' | 'status' | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QueueGroup>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Begitu daftar transaksi datang, pilih yang pertama secara default.
  useEffect(() => {
    if (!selectedId && purchaseTransactions.length > 0) setSelectedId(purchaseTransactions[0].id);
  }, [selectedId, purchaseTransactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchaseTransactions.filter(t => {
      if (statusFilter !== 'all' && groupOf(t.status) !== statusFilter) return false;
      if (!q) return true;
      return t.purchaseId.toLowerCase().includes(q) || t.vendor.toLowerCase().includes(q) || t.invoiceNumber.toLowerCase().includes(q);
    });
  }, [purchaseTransactions, search, statusFilter]);

  // Ringkasan antrian untuk kartu KPI di atas.
  const stats = useMemo(() => {
    const byGroup = (g: QueueGroup) => purchaseTransactions.filter(t => groupOf(t.status) === g);
    const sum = (list: PurchaseTransaction[]) => list.reduce((n, t) => n + t.total, 0);
    const pending = byGroup('pending');
    const approved = byGroup('approved');
    const posted = byGroup('posted');
    const other = byGroup('other');
    return {
      total: purchaseTransactions.length,
      pending: pending.length,
      approved: approved.length,
      posted: posted.length,
      other: other.length,
      unpostedValue: sum(pending) + sum(approved),
      totalValue: sum(purchaseTransactions),
    };
  }, [purchaseTransactions]);
  const persen = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedItems = filtered.slice(pageStart, pageStart + ITEMS_PER_PAGE);
  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const txHeader = purchaseTransactions.find(t => t.id === selectedId) || purchaseTransactions[0];
  const { lines: selectedLines, loading: linesLoading } = usePurchaseTransactionLines(txHeader?.id);
  const tx = useMemo(
    () => (txHeader ? { ...txHeader, lines: selectedLines.map(mapTransactionLineToUi) } : null),
    [txHeader, selectedLines],
  );

  // Memuat / kosong -- kartu status yang sama dengan Sales (SalesLoading), tab & header tetap tampil.
  if (!tx) {
    return (
      <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
        <PurchaseTabs variant="elegant" />
        <div className={`${salesFont.className} pt-5`}>
          <SalesLoading
            loading={loading}
            emptyIcon={Inbox}
            message={loading ? 'Loading...' : 'No purchase transactions to process into journals yet.'}
          />
        </div>
      </div>
    );
  }

  const runAction = async (action: 'approve' | 'post') => {
    setBusy(action);
    await runPurchaseStatusAction(action, [tx.id]);
    setBusy(null);
  };

  // Reject / Return for Correction cukup ubah status (tidak menyentuh jurnal).
  const setStatus = async (status: 'rejected' | 'draft') => {
    setBusy('status');
    try {
      await updatePurchaseTransaction(tx.id, { status });
      toast.success(status === 'draft' ? 'Returned to draft for correction' : 'Transaction rejected', { description: tx.purchaseId });
    } catch (err) {
      toast.error('Failed to update status', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const accountingEntries = getAccountingEntries(tx);
  const totalDebit = accountingEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = accountingEntries.reduce((s, e) => s + e.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const isTaxable = tx.taxAmount > 0;

  const group = groupOf(tx.status);
  const activeStep = stepForStatus(tx.status);
  const isPosted = group === 'posted';
  const canReview = tx.status === 'draft' || tx.status === 'pending_review';
  const canPost = tx.status === 'approved';

  // Status tiap bagian mengikuti progres stepper.
  const stateOf = (n: number): SectionState => (isPosted || n < activeStep ? 'done' : n === activeStep ? 'active' : 'todo');

  const statusTabs: { key: 'all' | QueueGroup; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'approved', label: 'Approved', count: stats.approved },
    { key: 'posted', label: 'Posted', count: stats.posted },
    { key: 'other', label: 'Other', count: stats.other },
  ];

  // Notifikasi: kotak netral tipis, hanya ikon yang diberi warna status.
  const footerMessage =
    group === 'posted' ? 'This journal has been posted to the general ledger.'
    : group === 'approved' ? 'This journal is ready to post. Review the account classification and make sure it is correct before posting to the general ledger.'
    : tx.status === 'rejected' ? 'This purchase was rejected. It cannot be posted.'
    : tx.status === 'exception' ? 'This purchase has an exception that needs review before it can continue.'
    : tx.status === 'cancelled' ? 'This purchase was cancelled.'
    : 'This journal is still being processed. Approve the purchase first before it can be posted.';
  const footerIconTone =
    group === 'posted' ? 'text-teal-700' : group === 'approved' ? 'text-blue-700'
    : group === 'other' ? 'text-orange-700' : 'text-amber-700';
  const FooterIcon = group === 'posted' ? ShieldCheck : group === 'approved' ? Info : group === 'other' ? AlertTriangle : Clock;

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      <PurchaseTabs variant="elegant" />

      <div className={`${salesFont.className} pt-5 space-y-5`}>
        {/* KPI -- desain sama dengan Sales Journal Preview */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <JournalKpiTile label="Journal Queue" value={String(stats.total)} pct={100} pctLabel="purchase transactions" icon={FileText} />
          <JournalKpiTile label="Pending Approval" value={String(stats.pending)} pct={persen(stats.pending, stats.total)} pctLabel="of queue" icon={Clock} />
          <JournalKpiTile label="Ready to Post" value={String(stats.approved)} pct={persen(stats.approved, stats.total)} pctLabel="of queue" icon={ShieldCheck} />
          <JournalKpiTile label="Unposted Value" value={fmt(stats.unpostedValue)} pct={persen(stats.unpostedValue, stats.totalValue)} pctLabel="of total queue value" icon={BookOpen} />
        </div>

        <div className="flex flex-col items-start gap-4 lg:flex-row">
          {/* Kiri: daftar purchase */}
          <JPanel
            className="w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-80"
            title="Purchase List"
            leading={iconBadge(<FileSpreadsheet size={17} />)}
            flush
          >
            <div className="space-y-2.5 border-b border-neutral-200 p-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                  placeholder="Search purchase ID, vendor, or invoice..."
                  className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {statusTabs.map(tab => {
                  const on = statusFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => { setStatusFilter(tab.key); setCurrentPage(1); }}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'border-neutral-300 bg-neutral-200 text-neutral-900' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'}`}
                    >
                      {tab.label} <span className="text-neutral-600">{tab.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="scrollbar-thin max-h-[560px] space-y-2 overflow-y-auto p-3">
              {pagedItems.length === 0 && (
                <div className="py-8 text-center text-xs text-neutral-600">{loading ? 'Loading...' : 'No purchases match.'}</div>
              )}
              {pagedItems.map(t => {
                const aktif = tx.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    aria-current={aktif ? 'true' : undefined}
                    className={`group flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${aktif ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${aktif ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-600'}`}>PUR</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-xs font-semibold leading-snug text-blue-700">{t.purchaseId}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold text-neutral-800">{t.vendor}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-neutral-700">{t.purchaseDate || '—'}</span>
                        <StatusPill tone={statusTones[t.status]} label={statusLabels[t.status]} />
                      </span>
                      <span className="mt-1 block text-sm font-semibold tabular-nums text-neutral-900">{fmt(t.total)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <PickerPagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              itemLabel="purchases"
              onPageChange={goToPage}
              className="p-3"
            />
          </JPanel>

          {/* Kanan: detail */}
          <div className="min-w-0 flex-1 space-y-4">
            {/* Header: ringkasan purchase + stepper */}
            <JPanel
              title="Journal Preview Detail"
              subtitle="See how the purchase transaction is turned into an accounting journal"
              leading={iconBadge(<Eye size={17} />)}
              action={
                <>
                  <StatusPill tone={paymentTones[tx.paymentStatus]} label={paymentLabels[tx.paymentStatus]} />
                  <StatusPill tone={statusTones[tx.status]} label={statusLabels[tx.status]} />
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200">PUR</span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-blue-700">{tx.purchaseId}</p>
                    <p className="truncate text-xs font-semibold text-neutral-700">{tx.vendor} · {tx.purchaseDate || '—'}</p>
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-600">Total Payable</p>
                  <p className="mt-1 text-xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{fmt(tx.total)}</p>
                </div>
              </div>
              {tx.description && <p className="mt-3 text-xs font-medium text-neutral-700">{tx.description}</p>}

              {/* Stepper */}
              <ol className="mt-5 grid grid-cols-6">
                {STEPS.map((s, i) => {
                  const done = isPosted || s.n < activeStep;
                  const active = !isPosted && s.n === activeStep;
                  return (
                    <li key={s.n} className="relative flex flex-col items-center px-1 text-center">
                      {i > 0 && (
                        <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 rounded-full ${s.n <= activeStep || isPosted ? 'bg-neutral-300' : 'bg-neutral-200'}`} />
                      )}
                      <span
                        className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                          done ? 'border-neutral-300 bg-neutral-100 text-neutral-700'
                          : active ? 'border-neutral-500 bg-white text-neutral-900'
                          : 'border-neutral-200 bg-white text-neutral-500'
                        }`}
                      >
                        {done ? <Check size={14} strokeWidth={2.5} /> : s.n}
                      </span>
                      <p className={`mt-2 text-[11px] font-semibold leading-tight ${done || active ? 'text-neutral-900' : 'text-neutral-600'}`}>{s.label}</p>
                      <p className="hidden text-[10px] font-medium leading-tight text-neutral-600 sm:block">{s.sub}</p>
                    </li>
                  );
                })}
              </ol>
            </JPanel>

            {/* 1 & 2 */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <StepCard step={1} state={stateOf(1)} icon={FileText} title="Source Document">
                <Rows rows={[
                  { label: 'Invoice Number', value: tx.invoiceNumber || '—' },
                  { label: 'PO Number', value: tx.poNumber || '—' },
                  { label: 'Purchase ID', value: tx.purchaseId },
                  { label: 'Source', value: <span className={TAG}>{tx.sourceDocType || '—'}</span> },
                  { label: 'Invoice Date', value: tx.invoiceDate || '—' },
                  { label: 'Total Payable', value: fmt(tx.total), strong: true },
                ]} />
              </StepCard>

              <StepCard step={2} state={stateOf(2)} icon={Layers} title="Purchase Information">
                <Rows rows={[
                  { label: 'Vendor Name', value: tx.vendor },
                  { label: 'Vendor ID', value: tx.vendorId ? <span className={MONO}>{tx.vendorId}</span> : '—' },
                  { label: 'Category', value: <span className={TAG}>{tx.category || '—'}</span> },
                  { label: 'Period', value: tx.period || '—' },
                  { label: 'Due Date', value: <span className={tx.paymentStatus === 'overdue' ? 'text-red-700' : ''}>{tx.dueDate || '—'}</span> },
                  { label: 'Payment Terms', value: tx.paymentTerms || '—' },
                  { label: 'Currency', value: tx.currency || '—' },
                  { label: 'Prepared by', value: tx.createdBy || '—' },
                  { label: 'Approved by', value: tx.approvedBy || '— Pending —' },
                  ...(tx.postedBy ? [{ label: 'Posted by', value: tx.postedBy }] : []),
                ]} />
              </StepCard>
            </div>

            {/* 3. Line Items */}
            <StepCard
              step={3}
              state={stateOf(3)}
              icon={Landmark}
              title="Purchase Line Items & Classification"
              flush
              aside={<span className="text-[11px] font-semibold text-neutral-600">{tx.lines.length} line{tx.lines.length === 1 ? '' : 's'}</span>}
            >
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[1000px] select-text border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-neutral-300">
                      {[
                        { h: 'No.', cls: 'w-12 text-left' },
                        { h: 'Item / Service', cls: 'text-left' },
                        { h: 'Code', cls: 'text-left' },
                        { h: 'Qty', cls: 'text-right' },
                        { h: 'Unit', cls: 'text-left' },
                        { h: 'Unit Price', cls: 'text-right' },
                        { h: 'Discount', cls: 'text-right' },
                        { h: 'Tax Rate', cls: 'text-right' },
                        { h: 'Tax Amt', cls: 'text-right' },
                        { h: 'Total', cls: 'text-right' },
                        { h: 'GL Code', cls: 'text-left' },
                        { h: 'GL Account', cls: 'text-left' },
                      ].map(c => (
                        <th key={c.h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2 text-xs font-bold text-black ${c.cls}`}>{c.h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linesLoading && tx.lines.length === 0 && (
                      <tr><td colSpan={12} className="px-4 py-6 text-center text-xs text-neutral-600">Loading...</td></tr>
                    )}
                    {!linesLoading && tx.lines.length === 0 && (
                      <tr><td colSpan={12} className="px-4 py-6 text-center text-xs text-neutral-600">No line items.</td></tr>
                    )}
                    {tx.lines.map((line, i) => (
                      <tr key={line.id} className="text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                        <td className="px-3 py-2.5 text-neutral-600">{i + 1}</td>
                        <td className="min-w-[180px] px-3 py-2.5 font-medium text-neutral-900">{line.description}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-neutral-600">{line.itemCode || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{line.quantity.toLocaleString('id-ID')}</td>
                        <td className="px-3 py-2.5 text-neutral-600">{line.unit || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-red-700">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{line.taxRate}%</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmt(line.taxAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{fmt(line.total)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-neutral-900">{kodeAkun(line.accountCode) || '—'}</td>
                        <td className="min-w-[160px] px-3 py-2.5 text-neutral-900">{line.accountName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </StepCard>

            {/* 4. Tax Treatment + ringkasan nilai */}
            <StepCard step={4} state={stateOf(4)} icon={Scale} title="Tax Treatment">
              <div className="mb-3 flex items-start gap-2.5 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-600">
                  {isTaxable ? <CheckCircle size={15} /> : <Info size={15} />}
                </span>
                <div>
                  <p className="text-xs font-semibold text-neutral-900">
                    {isTaxable ? 'Subject to Input VAT (Taxable)' : 'No Input VAT'}
                  </p>
                  <p className="text-[11px] font-medium text-neutral-700">
                    {isTaxable ? 'This purchase carries recoverable input VAT.' : 'This purchase does not generate input VAT.'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
                <Rows rows={[
                  { label: 'Subtotal', value: fmt(tx.subtotal) },
                  ...(tx.discount > 0 ? [{ label: 'Discount', value: <span className="text-red-700">-{fmt(tx.discount)}</span> }] : []),
                  { label: 'Input VAT', value: fmt(tx.taxAmount) },
                  { label: 'Total Payable', value: fmt(tx.total), strong: true },
                ]} />
                <Rows rows={[
                  { label: 'Input VAT Account', value: <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5"><span className={MONO}>{kodeAkun(tx.taxAccountCode || '1300')}</span><span>{tx.taxAccountName || 'VAT Recoverable (Input Tax)'}</span></span> },
                  { label: 'Accounts Payable Account', value: <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5"><span className={MONO}>{kodeAkun(tx.apAccountCode || '2100')}</span><span>{tx.apAccountName || 'Accounts Payable'}</span></span> },
                  { label: 'Accounts Payable', value: <span className="text-red-700">{fmt(tx.accountsPayable)}</span>, strong: true },
                ]} />
              </div>
            </StepCard>

            {/* 5. Journal Entry */}
            <StepCard
              step={5}
              state={stateOf(5)}
              icon={BookOpen}
              title="Journal Entry"
              flush
              aside={
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${balanced ? 'border-neutral-200 bg-neutral-50 text-neutral-700' : 'border-red-300 bg-red-100 text-red-700'}`}>
                  {balanced ? <Check size={12} strokeWidth={3} /> : <X size={12} />} {balanced ? 'Balanced' : 'Unbalanced'}
                </span>
              }
            >
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[640px] select-text border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-neutral-300">
                      {[
                        { h: 'No.', cls: 'w-12 text-left' },
                        { h: 'Account Code', cls: 'text-left' },
                        { h: 'Account Name', cls: 'text-left' },
                        { h: 'Description', cls: 'text-left' },
                        { h: 'Debit (IDR)', cls: 'text-right' },
                        { h: 'Credit (IDR)', cls: 'text-right' },
                      ].map(c => (
                        <th key={c.h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-4 py-2 text-xs font-bold text-black ${c.cls}`}>{c.h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accountingEntries.map((e, idx) => (
                      <tr key={idx} className="text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                        <td className="px-4 py-2.5 text-neutral-600">{idx + 1}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold text-neutral-900">{e.code ? kodeAkun(e.code) : '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-neutral-900">{e.account || '—'}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{e.description || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{e.debit !== 0 ? formatAngka(e.debit) : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{e.credit !== 0 ? formatAngka(e.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`text-xs font-semibold ${balanced ? 'bg-neutral-100 text-neutral-900' : 'bg-red-50 text-red-700'}`}>
                      <td colSpan={4} className="border-t border-neutral-800 px-4 py-3">{balanced ? 'Total — Debit = Credit' : 'Total — Debit ≠ Credit'}</td>
                      <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{formatAngka(totalDebit)}</td>
                      <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{formatAngka(totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </StepCard>

            {/* Bar aksi -- menempel di bawah supaya tombol selalu terjangkau */}
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">
                <FooterIcon size={15} className={`mt-0.5 shrink-0 ${footerIconTone}`} />
                <div className="min-w-0">
                  <span className="font-medium leading-snug">{footerMessage}</span>
                  <p className="mt-1 text-[11px] font-medium text-neutral-600">
                    Created {tx.createdDate} · Updated {tx.updatedDate}{tx.postedTimestamp ? ` · Posted ${tx.postedTimestamp}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {canReview && (
                  <button onClick={() => setStatus('rejected')} disabled={busy !== null} className={`${BTN_SECONDARY} !text-red-700`}>
                    <Ban size={12} /> Reject
                  </button>
                )}
                {canPost && (
                  <button onClick={() => setStatus('draft')} disabled={busy !== null} className={BTN_SECONDARY}>
                    <Undo2 size={12} /> Return for Correction
                  </button>
                )}
                {tx.status === 'exception' && (
                  <Link href="/transactions/purchase/exceptions" className={BTN_SECONDARY}>
                    <AlertTriangle size={12} /> View Exception
                  </Link>
                )}
                <button
                  onClick={() => runAction('approve')}
                  disabled={busy !== null || !canReview || !balanced}
                  title={balanced ? undefined : 'Journal is not balanced'}
                  className={BTN_SECONDARY}
                >
                  <CheckCircle size={13} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button
                  onClick={() => runAction('post')}
                  disabled={busy !== null || !canPost || !balanced}
                  title={balanced ? undefined : 'Journal is not balanced'}
                  className={BTN_PRIMARY}
                >
                  <Send size={12} /> {busy === 'post' ? 'Posting…' : 'Post to GL'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}