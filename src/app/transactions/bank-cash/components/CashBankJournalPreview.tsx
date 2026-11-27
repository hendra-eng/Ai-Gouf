'use client';

// Tab Journal Preview (Cash & Bank): antrean transaksi DRAFT / APPROVED dari
// Reconciliation maupun input manual, beserta jurnalnya (dihitung backend dari
// baris transaksi -- sama persis dengan yang masuk buku besar saat diposting).
// Alur: Draft --Approve (Supervisor+)--> Approved --Post (Manager+)--> Posted.
// Draft bisa diedit / dihapus; Approved bisa dikembalikan ke Draft.
//
// Tampilan: SAMA dengan Journal Preview Purchase (transactions/purchase/preview) --
// KPI tile, daftar kartu di kiri, panel "Journal Preview Detail" + stepper,
// StepCard bernomor, tabel header abu + garis hitam, dan bar aksi yang menempel di bawah.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Search, CheckCircle, Check, X, Undo2, Pencil, Trash2, Send, Eye, FileText, BookOpen, Info,
  Clock, ShieldCheck, ArrowDownLeft, ArrowUpRight, Inbox, FileSpreadsheet, Layers,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import {
  approveBcTransactions,
  deleteBcTransaction,
  postBcTransactions,
  returnBcTransactionsToDraft,
  useBcTransactions,
  TX_STATUS_LABEL,
  type BcBulkResult,
  type BcTransaction,
} from '@/lib/bankCashStore';
import SalesLoading from '@/app/transactions/sales/components/SalesLoading';
import { PickerPagination } from '@/app/transactions/components/PreviewLayout';
import CashBankTabs from './CashBankTabs';
import CashBankTransactionModal from './CashBankTransactionModal';
import { CHECKBOX_CLS } from './sourceUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { formatIDR, formatAngka } from '../lib/formatMoney';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatTanggal = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

// ── Pill status bergaris + titik berwarna -- sama dengan StatusPill di Purchase Journal Preview ──
type Tone = 'slate' | 'amber' | 'blue' | 'orange' | 'emerald' | 'red' | 'neutral';
const PILL: Record<Tone, { pill: string; dot: string }> = {
  slate: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
  amber: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  blue: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
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

const STATUS_TONE: Record<string, Tone> = {
  draft: 'amber',
  approved: 'blue',
};

// Sama dengan LEVEL_POST di backend (bank_cash_v1.py); backend tetap yang menentukan.
const LEVEL_POST = 4;
const levelDariRole = (role?: string | null) => {
  if (role === 'super_admin') return 999;
  const m = /^tahap_(\d+)$/.exec(role ?? '');
  return m ? Number(m[1]) : 0;
};

const ITEMS_PER_PAGE = 8;

const SOURCE_LABEL: Record<string, string> = {
  bank_feed: 'from Source Data',
  manual: 'manual entry',
  ar: 'from Accounts Receivable',
  ap: 'from Accounts Payable',
  tax: 'from Tax Compliance',
};

// Stepper: 4 langkah. Antrean ini hanya berisi Draft / Approved, jadi langkah 1-3 selalu selesai
// dan langkah terakhir (Approve/Post) yang aktif.
const STEPS = [
  { n: 1, label: 'Transaction Information', sub: 'Source & parties' },
  { n: 2, label: 'Settled Lines', sub: 'Invoices & accounts' },
  { n: 3, label: 'Journal', sub: 'Accounting entry' },
  { n: 4, label: 'Approve/Post', sub: 'Approval' },
];
const ACTIVE_STEP = 4;

// ── Gaya kontrol -- sama dengan Purchase Journal Preview ──
const BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY = `${BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const BTN_PRIMARY = `${BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;

// Gaya tombol aksi di baris tab -- sama dengan Approve All / Post All di Purchase Journal Preview.
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;

// Approve All / Post All dikirim per kelompok kecil supaya progres ("Approving 3/40...") bisa ditampilkan.
const UKURAN_BATCH = 25;

const iconBadge = (node: React.ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200">{node}</span>
);

// Panel putih dengan header terpisah garis -- sama dengan JPanel di Purchase Journal Preview.
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

// Kartu KPI -- sama dengan JournalKpiTile di Purchase Journal Preview (+ baris `sub` opsional).
function JournalKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string; value: string; sub?: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-700" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50">
          <Icon size={16} className="text-neutral-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      {sub && <p className="relative truncate text-[11px] font-medium text-neutral-600">{sub}</p>}
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-neutral-700">{p}% {pctLabel}</p>
    </div>
  );
}

// Kartu langkah: badge nomor mengikuti progres stepper -- sama dengan StepCard di Purchase.
type SectionState = 'done' | 'active' | 'todo';
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

// Daftar label : nilai (label kiri, nilai rata kanan) -- sama dengan Rows di Purchase Journal Preview.
function Rows({ rows }: { rows: (RowSpec | false)[] }) {
  return (
    <dl className="divide-y divide-neutral-200 text-xs">
      {rows.filter((r): r is RowSpec => !!r).map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 font-medium text-neutral-700">{r.label}</dt>
          <dd className={`min-w-0 break-words text-right tabular-nums ${r.strong ? 'text-sm font-bold text-neutral-900' : 'font-semibold text-neutral-900'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TAG = 'inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-800';
const TH = 'whitespace-nowrap border-b border-t border-neutral-800 px-3 py-2 text-xs font-bold text-black';
const TR = 'text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200';

function ringkasHasil(r: BcBulkResult, label: string) {
  if (r.failed.length) {
    toast.warning(`${r.done.length} transactions ${label}, ${r.failed.length} skipped`, {
      description: r.failed.slice(0, 3).map((f) => `${f.tx_number ?? ''} ${f.reason}`).join(' · '),
    });
  } else {
    toast.success(`${r.done.length} transactions ${label}`, { description: r.done.slice(0, 5).join(', ') });
  }
}

export default function CashBankJournalPreview() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { user } = useAuth();
  const bisaPost = levelDariRole(user?.role) >= LEVEL_POST;
  const { transactions, loading, error } = useBcTransactions(clientId, { status: ['draft', 'approved'] });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BcTransaction | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) =>
      (statusFilter === 'all' || t.status === statusFilter) &&
      (!q || [t.tx_number, t.counterparty, t.category, t.description, t.bank_account_name, ...t.lines.map((l) => l.invoice_no)]
        .some((v) => (v || '').toLowerCase().includes(q))));
  }, [transactions, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);
  const selected = transactions.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    setChecked((prev) => new Set(Array.from(prev).filter((id) => transactions.some((t) => t.id === id))));
  }, [transactions]);

  const jalankan = async (fn: () => Promise<unknown>) => {
    if (!clientId) {
      toast.error('Select an active company in the top bar first.');
      return;
    }
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const aksiMassal = (ids: string[], jenis: 'approve' | 'draft' | 'post') => jalankan(async () => {
    const fn = jenis === 'approve' ? approveBcTransactions : jenis === 'draft' ? returnBcTransactionsToDraft : postBcTransactions;
    const { data } = await fn(clientId!, ids);
    ringkasHasil(data, jenis === 'approve' ? 'approved' : jenis === 'draft' ? 'returned to draft' : 'posted');
    setChecked(new Set());
  });

  const hapus = (t: BcTransaction) => {
    const ket = t.mutation ? ' Its Source Data line will return to Unmatched.' : '';
    if (!window.confirm(`Delete ${t.tx_number}?${ket}`)) return;
    jalankan(async () => {
      await deleteBcTransaction(clientId!, t.id);
      toast.success(`${t.tx_number} deleted.`);
      setSelectedId(null);
    });
  };

  const pilihan = Array.from(checked);
  const pilihanDraft = pilihan.filter((id) => transactions.find((t) => t.id === id)?.status === 'draft');
  const pilihanApproved = pilihan.filter((id) => transactions.find((t) => t.id === id)?.status === 'approved');

  // Ringkasan antrean untuk KPI tile.
  const jmlDraft = transactions.filter((t) => t.status === 'draft').length;
  const jmlApproved = transactions.filter((t) => t.status === 'approved').length;
  const receipts = transactions.filter((t) => t.direction === 'receipt');
  const payments = transactions.filter((t) => t.direction === 'payment');
  const sumReceipt = receipts.reduce((n, t) => n + t.amount, 0);
  const sumPayment = payments.reduce((n, t) => n + t.amount, 0);
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  // ---- Approve All / Post All (tombol di baris tab) ----
  // Berlaku untuk SEMUA transaksi di antrean Journal Preview (tidak terpengaruh pencarian/filter di panel kiri):
  //   Approve All -> yang masih Draft;  Post All -> yang sudah Approved (Ready to Post).
  // Tiap tombol hanya dirender kalau masih ada transaksi yang bisa diproses; kalau sudah habis, tombolnya hilang.
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'post' | null>(null);
  const bisaDiapprove = useMemo(() => transactions.filter((t) => t.status === 'draft'), [transactions]);
  const bisaDipost = useMemo(() => transactions.filter((t) => t.status === 'approved'), [transactions]);

  const ringkasDilewati = (gagal: BcBulkResult['failed']) =>
    gagal.slice(0, 3).map((f) => `${f.tx_number ?? f.id}: ${f.reason}`).join('\n') +
    (gagal.length > 3 ? `\n…and ${gagal.length - 3} more` : '');

  const jalankanBertahap = async (
    ids: string[],
    fn: (cid: string, ids: string[]) => Promise<{ data: BcBulkResult }>,
    onProgress: (selesai: number, total: number) => void,
  ): Promise<BcBulkResult> => {
    const hasil: BcBulkResult = { done: [], failed: [] };
    for (let i = 0; i < ids.length; i += UKURAN_BATCH) {
      const { data } = await fn(clientId!, ids.slice(i, i + UKURAN_BATCH));
      hasil.done.push(...data.done);
      hasil.failed.push(...data.failed);
      onProgress(Math.min(i + UKURAN_BATCH, ids.length), ids.length);
    }
    return hasil;
  };

  const handleApproveAll = async () => {
    const target = bisaDiapprove;
    if (target.length === 0 || bulkBusy) return;
    if (!clientId) { toast.error('Select an active company in the top bar first.'); return; }
    if (!window.confirm(`Approve ${target.length} cash & bank transactions at once?`)) return;
    setBulkBusy('approve');
    const toastId = toast.loading(`Approving 0/${target.length}...`);
    try {
      const res = await jalankanBertahap(target.map((t) => t.id), approveBcTransactions, (s, total) =>
        toast.loading(`Approving ${s}/${total}...`, { id: toastId }));
      toast.dismiss(toastId);
      if (res.done.length) {
        toast.success(`${res.done.length} transactions approved`);
      }
      if (res.failed.length) {
        toast.error(`${res.failed.length} transactions failed to approve`, { description: ringkasDilewati(res.failed), duration: 12000 });
      }
      if (!res.done.length && !res.failed.length) toast.info('No transactions need approval.');
      setChecked(new Set());
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setBulkBusy(null);
    }
  };

  const handlePostAll = async () => {
    const target = bisaDipost;
    if (target.length === 0 || bulkBusy) return;
    if (!clientId) { toast.error('Select an active company in the top bar first.'); return; }
    if (!window.confirm(`Post ${target.length} cash & bank transactions to the general ledger at once?`)) return;
    setBulkBusy('post');
    const toastId = toast.loading(`Posting 0/${target.length}...`);
    try {
      const res = await jalankanBertahap(target.map((t) => t.id), postBcTransactions, (s, total) =>
        toast.loading(`Posting ${s}/${total}...`, { id: toastId }));
      toast.dismiss(toastId);
      if (res.done.length) {
        toast.success(`${res.done.length} transactions posted`, {
          description: 'They now appear in the Posted tab and the financial statements.',
        });
      }
      if (res.failed.length) {
        toast.error(`${res.failed.length} transactions failed to post`, { description: ringkasDilewati(res.failed), duration: 12000 });
      }
      if (!res.done.length && !res.failed.length) toast.info('No transactions need posting.');
      setChecked(new Set());
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(err instanceof Error ? err.message : 'Failed to post journal');
    } finally {
      setBulkBusy(null);
    }
  };

  const actionBar = bisaDiapprove.length === 0 && bisaDipost.length === 0 ? null : (
    <div className="flex flex-wrap items-center justify-end gap-2 pb-2 lg:pb-0">
      {bisaDiapprove.length > 0 && (
        <button onClick={handleApproveAll} disabled={bulkBusy !== null} className={ACTION_BTN_SECONDARY}>
          <CheckCircle size={14} /> {bulkBusy === 'approve' ? 'Approving...' : 'Approve All'} ({bisaDiapprove.length})
        </button>
      )}
      {bisaDipost.length > 0 && (
        <button
          onClick={handlePostAll}
          disabled={bulkBusy !== null || !bisaPost}
          title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
          className={ACTION_BTN_PRIMARY}
        >
          <Send size={14} /> {bulkBusy === 'post' ? 'Posting...' : 'Post All'} ({bisaDipost.length})
        </button>
      )}
    </div>
  );

  const kpiRow = (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <JournalKpiTile
        label="Draft" icon={Clock}
        value={String(jmlDraft)} sub="awaiting approval"
        pct={pct(jmlDraft, transactions.length)} pctLabel="of queue"
      />
      <JournalKpiTile
        label="Approved" icon={ShieldCheck}
        value={String(jmlApproved)} sub="ready to post"
        pct={pct(jmlApproved, transactions.length)} pctLabel="of queue"
      />
      <JournalKpiTile
        label="Cash Receipt" icon={ArrowDownLeft}
        value={formatIDR(sumReceipt)} sub={`${receipts.length} transactions`}
        pct={pct(sumReceipt, sumReceipt + sumPayment)} pctLabel="of total value"
      />
      <JournalKpiTile
        label="Cash Payment" icon={ArrowUpRight}
        value={formatIDR(sumPayment)} sub={`${payments.length} transactions`}
        pct={pct(sumPayment, sumReceipt + sumPayment)} pctLabel="of total value"
      />
    </div>
  );

  if (!selected) {
    return (
      <div className="space-y-5">
        <CashBankTabs actions={actionBar} />
        {kpiRow}
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <SalesLoading
          loading={loading}
          emptyIcon={Inbox}
          message={loading ? 'Loading...' : 'No pending transactions. They appear here after a line is matched in Reconciliation or created with New Transaction.'}
        />
      </div>
    );
  }

  const totalDebit = selected.journal.reduce((n, j) => n + j.debit, 0);
  const totalKredit = selected.journal.reduce((n, j) => n + j.credit, 0);
  const seimbang = Math.abs(totalDebit - totalKredit) < 0.01;
  const receipt = selected.direction === 'receipt';
  const kode = receipt ? 'CR' : 'CP';
  const bisaApprove = selected.status === 'draft';
  const bisaPostIni = selected.status === 'approved';

  const statusTabs: { key: 'all' | 'draft' | 'approved'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: transactions.length },
    { key: 'draft', label: TX_STATUS_LABEL.draft, count: jmlDraft },
    { key: 'approved', label: TX_STATUS_LABEL.approved, count: jmlApproved },
  ];

  const footerMessage = selected.status === 'draft'
    ? 'Review the lines & journal, then Approve. Invoices and the ledger only change once posted.'
    : 'Approved. When posted, the journal goes to the ledger and invoice settlements are applied. Posting requires Manager or above.';
  const FooterIcon = selected.status === 'approved' ? Info : Clock;
  const footerIconTone = selected.status === 'approved' ? 'text-blue-700' : 'text-amber-700';

  return (
    <div className="space-y-5">
      <CashBankTabs actions={actionBar} />
      {kpiRow}

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        {/* Kiri: daftar transaksi */}
        <JPanel
          className="w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-80"
          title="Awaiting Approve / Post"
          leading={iconBadge(<FileSpreadsheet size={17} />)}
          flush
        >
          <div className="space-y-2.5 border-b border-neutral-200 p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search no., party, or invoice..."
                className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusTabs.map((tab) => {
                const on = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setStatusFilter(tab.key); setPage(1); }}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'border-neutral-300 bg-neutral-200 text-neutral-900' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'}`}
                  >
                    {tab.label} <span className="text-neutral-600">{tab.count}</span>
                  </button>
                );
              })}
            </div>
            {pilihan.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {pilihanDraft.length > 0 && (
                  <button disabled={busy} onClick={() => aksiMassal(pilihanDraft, 'approve')} className={BTN_PRIMARY}>
                    <CheckCircle size={13} /> Approve {pilihanDraft.length}
                  </button>
                )}
                {pilihanApproved.length > 0 && (
                  <button
                    disabled={busy || !bisaPost}
                    title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                    onClick={() => aksiMassal(pilihanApproved, 'post')}
                    className={BTN_PRIMARY}
                  >
                    <Send size={13} /> Post {pilihanApproved.length}
                  </button>
                )}
                <button onClick={() => setChecked(new Set())} className="px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:text-neutral-900">
                  Clear selection
                </button>
              </div>
            )}
          </div>

          <div className="scrollbar-thin max-h-[560px] space-y-2 overflow-y-auto p-3">
            {paged.length === 0 && (
              <div className="py-8 text-center text-xs text-neutral-600">{loading ? 'Loading...' : 'No transactions match.'}</div>
            )}
            {paged.map((t) => {
              const aktif = selected.id === t.id;
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(t.id); } }}
                  aria-current={aktif ? 'true' : undefined}
                  className={`group flex w-full cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${aktif ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50'}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${aktif ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-600'}`}>
                    {t.direction === 'receipt' ? 'CR' : 'CP'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="block break-words text-xs font-semibold leading-snug text-blue-700">{t.tx_number}</span>
                      <input
                        type="checkbox"
                        checked={checked.has(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setChecked((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(t.id); else n.delete(t.id);
                          return n;
                        })}
                        aria-label={`Select ${t.tx_number}`}
                        className={`${CHECKBOX_CLS} mt-0.5 shrink-0`}
                      />
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-neutral-800">{t.counterparty || t.category || '—'}</span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-neutral-700">{formatTanggal(t.tx_date)}</span>
                      <StatusPill tone={STATUS_TONE[t.status]} label={TX_STATUS_LABEL[t.status]} />
                    </span>
                    <span className="mt-1 block text-sm font-semibold tabular-nums text-neutral-900">
                      {t.direction === 'receipt' ? '+' : '−'}{formatIDR(t.amount)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <PickerPagination
            page={safePage}
            totalPages={totalPages}
            total={filtered.length}
            itemLabel="transactions"
            onPageChange={setPage}
            className="p-3"
          />
        </JPanel>

        {/* Kanan: detail */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Header: ringkasan transaksi + stepper */}
          <JPanel
            title="Journal Preview Detail"
            subtitle="See how the cash & bank transaction is turned into an accounting journal"
            leading={iconBadge(<Eye size={17} />)}
            action={
              <>
                <StatusPill tone={receipt ? 'emerald' : 'orange'} label={receipt ? 'Cash Receipt' : 'Cash Payment'} />
                <StatusPill tone={STATUS_TONE[selected.status]} label={TX_STATUS_LABEL[selected.status]} />
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200">{kode}</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-blue-700">{selected.tx_number}</p>
                  <p className="truncate text-xs font-semibold text-neutral-700">
                    {selected.counterparty || selected.category || '—'} · {formatTanggal(selected.tx_date)}
                  </p>
                </div>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-600">{receipt ? 'Total Received' : 'Total Paid'}</p>
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{formatIDR(selected.amount)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs font-medium text-neutral-700">
              {selected.category || '—'} · {SOURCE_LABEL[selected.source] ?? selected.source}
            </p>

            {/* Stepper */}
            <ol className="mt-5 grid grid-cols-4">
              {STEPS.map((s, i) => {
                const done = s.n < ACTIVE_STEP;
                const active = s.n === ACTIVE_STEP;
                const sub = s.n === ACTIVE_STEP ? (selected.status === 'approved' ? 'Ready to post' : 'Awaiting approval') : s.sub;
                return (
                  <li key={s.n} className="relative flex flex-col items-center px-1 text-center">
                    {i > 0 && (
                      <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 rounded-full ${s.n <= ACTIVE_STEP ? 'bg-neutral-300' : 'bg-neutral-200'}`} />
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
                    <p className="hidden text-[10px] font-medium leading-tight text-neutral-600 sm:block">{sub}</p>
                  </li>
                );
              })}
            </ol>
          </JPanel>

          {/* 1. Transaction Information */}
          <StepCard step={1} state="done" icon={Info} title="Transaction Information">
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
              <Rows rows={[
                { label: 'Date', value: formatTanggal(selected.tx_date) },
                { label: 'Cash / bank account', value: `${kodeAkun(selected.bank_account_code)} · ${selected.bank_account_name}` },
                { label: 'Party', value: selected.counterparty || '—' },
                { label: 'Category', value: <span className={TAG}>{selected.category || '—'}</span> },
                !!selected.reference && { label: 'Reference', value: selected.reference },
              ]} />
              <Rows rows={[
                { label: 'Description', value: selected.description || '—' },
                !!selected.mutation && {
                  label: 'Source Data line',
                  value: `${formatTanggal(selected.mutation.date)} · ${selected.mutation.description || '—'} · ${formatIDR(selected.mutation.credit || selected.mutation.debit)}`,
                },
                { label: 'Created by', value: `${selected.created_by_name || '—'} · ${formatTanggal(selected.created_at)}` },
                { label: 'Approved by', value: selected.approved_at ? `${selected.approved_by_name || '—'} · ${formatTanggal(selected.approved_at)}` : '— Pending —' },
              ]} />
            </div>
          </StepCard>

          {/* 2. Settled lines */}
          <StepCard
            step={2}
            state="done"
            icon={Layers}
            title={receipt ? 'Received for' : 'Paid for'}
            flush
            aside={<span className="text-[11px] font-semibold text-neutral-600">{selected.lines.length} line{selected.lines.length === 1 ? '' : 's'}</span>}
          >
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className={`${TH} w-12 text-left`}>No.</th>
                    <th className={`${TH} text-left`}>Type</th>
                    <th className={`${TH} text-left`}>Invoice / Account</th>
                    <th className={`${TH} text-left`}>Description</th>
                    <th className={`${TH} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-600">No lines.</td></tr>
                  )}
                  {selected.lines.map((l, i) => (
                    <tr key={l.id} className={TR}>
                      <td className="px-3 py-2.5 text-neutral-600">{i + 1}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-neutral-900">{l.line_type === 'sales_invoice' ? 'Sales Invoice' : l.line_type === 'purchase' ? 'Purchase' : 'Account'}</td>
                      <td className="min-w-[200px] px-3 py-2.5">
                        {l.invoice_no ? <span className="font-semibold tabular-nums text-neutral-900">{l.invoice_no}</span> : null}
                        {l.party ? <span className="text-neutral-600"> · {l.party}</span> : null}
                        <span className="block text-neutral-600">{kodeAkun(l.account_code)} · {l.account_name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-600">{l.description || '—'}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums ${l.amount < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{formatIDR(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StepCard>

          {/* 3. Journal Entry */}
          <StepCard
            step={3}
            state="done"
            icon={BookOpen}
            title="Journal Entry"
            flush
            aside={
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${seimbang ? 'border-neutral-200 bg-neutral-50 text-neutral-700' : 'border-red-300 bg-red-100 text-red-700'}`}>
                {seimbang ? <Check size={12} strokeWidth={3} /> : <X size={12} />} {seimbang ? 'Balanced' : 'Unbalanced'}
              </span>
            }
          >
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className={`${TH} w-12 text-left`}>No.</th>
                    <th className={`${TH} text-left`}>Account Code</th>
                    <th className={`${TH} text-left`}>Account Name</th>
                    <th className={`${TH} text-left`}>Description</th>
                    <th className={`${TH} text-right`}>Debit (IDR)</th>
                    <th className={`${TH} text-right`}>Credit (IDR)</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.journal.map((j, i) => (
                    <tr key={j.line_no} className={TR}>
                      <td className="px-3 py-2.5 text-neutral-600">{i + 1}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-neutral-900">{kodeAkun(j.account_code) || '—'}</td>
                      <td className="px-3 py-2.5 font-medium text-neutral-900">{j.account_name || '—'}</td>
                      <td className="px-3 py-2.5 text-neutral-600">{j.description || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{j.debit > 0 ? formatAngka(j.debit) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{j.credit > 0 ? formatAngka(j.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`text-xs font-semibold ${seimbang ? 'bg-neutral-100 text-neutral-900' : 'bg-red-50 text-red-700'}`}>
                    <td colSpan={4} className="border-t border-neutral-800 px-3 py-3">{seimbang ? 'Total — Debit = Credit' : 'Total — Debit ≠ Credit'}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-3 py-3 text-right tabular-nums">{formatAngka(totalDebit)}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-3 py-3 text-right tabular-nums">{formatAngka(totalKredit)}</td>
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
                  Created {formatTanggal(selected.created_at)}{selected.approved_at ? ` · Approved ${formatTanggal(selected.approved_at)}` : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {bisaApprove && (
                <button disabled={busy} onClick={() => setEditing(selected)} className={BTN_SECONDARY}>
                  <Pencil size={12} /> Edit
                </button>
              )}
              {bisaPostIni && (
                <button disabled={busy} onClick={() => aksiMassal([selected.id], 'draft')} className={BTN_SECONDARY}>
                  <Undo2 size={12} /> Return to Draft
                </button>
              )}
              <button disabled={busy} onClick={() => hapus(selected)} className={`${BTN_SECONDARY} !text-red-700`}>
                <Trash2 size={12} /> Delete
              </button>
              <button
                disabled={busy || !bisaApprove || !seimbang}
                title={seimbang ? undefined : 'Journal is not balanced'}
                onClick={() => aksiMassal([selected.id], 'approve')}
                className={BTN_SECONDARY}
              >
                <CheckCircle size={13} /> Approve
              </button>
              <button
                disabled={busy || !bisaPostIni || !bisaPost || !seimbang}
                title={!seimbang ? 'Journal is not balanced' : bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                onClick={() => aksiMassal([selected.id], 'post')}
                className={BTN_PRIMARY}
              >
                <Send size={12} /> Post to Ledger
              </button>
            </div>
          </div>
        </div>
      </div>

      <CashBankTransactionModal open={!!editing} initial={editing} onClose={() => setEditing(null)} />
    </div>
  );
}