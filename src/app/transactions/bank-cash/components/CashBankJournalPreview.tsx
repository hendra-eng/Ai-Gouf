'use client';

// Tab Journal Preview (Cash & Bank): antrean transaksi DRAFT / APPROVED dari
// Reconciliation maupun input manual, beserta jurnalnya (dihitung backend dari
// baris transaksi -- sama persis dengan yang masuk buku besar saat diposting).
// Alur: Draft --Approve (Supervisor+)--> Approved --Post (Manager+)--> Posted.
// Draft bisa diedit / dihapus; Approved bisa dikembalikan ke Draft.
//
// Tampilan: tema elegant monokrom yang sama dengan tab Source Data / Posted
// (kit gaya di ./sourceUi): KPI tile bergaris hitam, panel bergaris aksen,
// pill status, tombol hitam/outline, tabel header abu + garis hitam.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Search, CheckCircle, Undo2, Pencil, Trash2, Send, Eye, FileText, BookOpen, Info,
  ChevronLeft, ChevronRight, Clock, ShieldCheck, ArrowDownLeft, ArrowUpRight, Inbox,
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
import CashBankTransactionModal from './CashBankTransactionModal';
import {
  SourcePanel, StatusPill, PostedKpiTile,
  ACTION_BTN_PRIMARY, ACTION_BTN_SECONDARY, CHECKBOX_CLS, FIELD_CLS, PANEL_ICON_CHIP,
  TH_CLS, TR_CLS, TD_CLS, type PillTone,
} from './sourceUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { formatIDR } from '../lib/formatMoney';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatTanggal = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

const STATUS_TONE: Record<string, PillTone> = {
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

const NAV_BTN_SM =
  'flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:bg-white';
const DANGER_BTN = `${ACTION_BTN_SECONDARY} !text-red-600 hover:!border-red-600 hover:!bg-red-50`;

function ringkasHasil(r: BcBulkResult, label: string) {
  if (r.failed.length) {
    toast.warning(`${r.done.length} transactions ${label}, ${r.failed.length} skipped`, {
      description: r.failed.slice(0, 3).map((f) => `${f.tx_number ?? ''} ${f.reason}`).join(' · '),
    });
  } else {
    toast.success(`${r.done.length} transactions ${label}`, { description: r.done.slice(0, 5).join(', ') });
  }
}

const chip = (Icon: React.ElementType) => (
  <span className={PANEL_ICON_CHIP}><Icon size={17} /></span>
);

// Daftar label : nilai -- label kiri, nilai rata kanan, pemisah abu (sama dengan panel detail Posted).
function Rows({ rows }: { rows: ({ label: React.ReactNode; value: React.ReactNode } | false)[] }) {
  return (
    <dl className="divide-y divide-neutral-200 text-xs">
      {rows.filter((r): r is { label: React.ReactNode; value: React.ReactNode } => !!r).map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-6 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 font-medium text-neutral-600">{r.label}</dt>
          <dd className="min-w-0 break-words text-right font-semibold text-neutral-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
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

  const kpiRow = (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <PostedKpiTile
        label="Draft" icon={Clock}
        value={String(jmlDraft)} sub="awaiting approval"
        pct={pct(jmlDraft, transactions.length)} pctLabel="of queue"
      />
      <PostedKpiTile
        label="Approved" icon={ShieldCheck}
        value={String(jmlApproved)} sub="ready to post"
        pct={pct(jmlApproved, transactions.length)} pctLabel="of queue"
      />
      <PostedKpiTile
        label="Cash Receipt" icon={ArrowDownLeft}
        value={formatIDR(sumReceipt)} sub={`${receipts.length} transactions`}
        pct={pct(sumReceipt, sumReceipt + sumPayment)} pctLabel="of total value"
      />
      <PostedKpiTile
        label="Cash Payment" icon={ArrowUpRight}
        value={formatIDR(sumPayment)} sub={`${payments.length} transactions`}
        pct={pct(sumPayment, sumReceipt + sumPayment)} pctLabel="of total value"
      />
    </div>
  );

  if (!selected) {
    return (
      <div className="space-y-5">
        {kpiRow}
        <SourcePanel title="Awaiting Approve / Post" subtitle="Cash & bank journals to review" leading={chip(Eye)}>
          <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-neutral-500">
            <Inbox size={22} className="text-neutral-400" />
            {error && <p className="font-medium text-red-600">{error}</p>}
            <p className="max-w-md">
              {loading
                ? 'Loading...'
                : 'No pending transactions. Transactions appear here after a line is matched in the Reconciliation tab or created with the New Transaction button.'}
            </p>
          </div>
        </SourcePanel>
      </div>
    );
  }

  const totalDebit = selected.journal.reduce((n, j) => n + j.debit, 0);
  const totalKredit = selected.journal.reduce((n, j) => n + j.credit, 0);
  const seimbang = Math.abs(totalDebit - totalKredit) < 0.01;
  const receipt = selected.direction === 'receipt';

  return (
    <div className="space-y-5">
      {kpiRow}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Kiri: daftar transaksi */}
        <div className="w-full shrink-0 lg:sticky lg:top-4 lg:w-80">
          <SourcePanel
            title="Awaiting Approve / Post"
            subtitle={`${filtered.length} of ${transactions.length} transactions`}
            leading={chip(Eye)}
            flush
          >
            <div className="space-y-2.5 border-b border-neutral-300 p-3">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search no., party, invoice…"
                  className={`${FIELD_CLS} !py-1.5 pl-8`}
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-50 p-1">
                {(['all', 'draft', 'approved'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${statusFilter === s ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900'}`}
                  >
                    {s === 'all' ? `All (${transactions.length})` : `${TX_STATUS_LABEL[s]} (${transactions.filter((t) => t.status === s).length})`}
                  </button>
                ))}
              </div>
              {pilihan.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {pilihanDraft.length > 0 && (
                    <button disabled={busy} onClick={() => aksiMassal(pilihanDraft, 'approve')} className={ACTION_BTN_PRIMARY}>
                      <CheckCircle size={13} /> Approve {pilihanDraft.length}
                    </button>
                  )}
                  {pilihanApproved.length > 0 && (
                    <button
                      disabled={busy || !bisaPost}
                      title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                      onClick={() => aksiMassal(pilihanApproved, 'post')}
                      className={ACTION_BTN_PRIMARY}
                    >
                      <Send size={13} /> Post {pilihanApproved.length}
                    </button>
                  )}
                  <button onClick={() => setChecked(new Set())} className="px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-900">
                    Clear selection
                  </button>
                </div>
              )}
            </div>

            <div>
              {paged.map((t) => {
                const aktif = selected.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`flex cursor-pointer gap-2.5 border-b border-neutral-200 border-l-2 px-3 py-2.5 transition-colors last:border-b-0 ${aktif ? 'border-l-neutral-800 bg-neutral-100' : 'border-l-transparent hover:bg-neutral-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setChecked((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(t.id); else n.delete(t.id);
                        return n;
                      })}
                      className={`${CHECKBOX_CLS} mt-0.5`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold tabular-nums text-neutral-900">{t.tx_number}</span>
                        <StatusPill tone={STATUS_TONE[t.status]} label={TX_STATUS_LABEL[t.status]} />
                      </div>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-neutral-500">{t.counterparty || t.category || '—'}</p>
                      <div className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span className="font-medium text-neutral-500">{formatTanggal(t.tx_date)}</span>
                        <span className="font-semibold tabular-nums text-neutral-900">
                          {t.direction === 'receipt' ? '+' : '−'}{formatIDR(t.amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {paged.length === 0 && <p className="p-4 text-center text-xs text-neutral-500">No transactions match this filter.</p>}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-600">
                <button onClick={() => setPage(safePage - 1)} disabled={safePage <= 1} className={NAV_BTN_SM} aria-label="Previous page">
                  <ChevronLeft size={14} />
                </button>
                <span>
                  Page <span className="font-semibold text-neutral-900">{safePage}</span> of {totalPages} · {filtered.length} transactions
                </span>
                <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages} className={NAV_BTN_SM} aria-label="Next page">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </SourcePanel>
        </div>

        {/* Kanan: detail */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="relative flex flex-wrap items-start justify-between gap-3 overflow-hidden rounded-xl border border-neutral-300 bg-white p-5 pt-6 shadow-sm">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold tracking-tight tabular-nums text-neutral-900">{selected.tx_number}</h2>
                <StatusPill tone={STATUS_TONE[selected.status]} label={TX_STATUS_LABEL[selected.status]} />
              </div>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                {receipt ? 'Cash Receipt' : 'Cash Payment'} · {selected.category || '—'} · {SOURCE_LABEL[selected.source] ?? selected.source}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Amount</p>
              <p className="text-xl font-semibold tabular-nums tracking-tight text-neutral-900">{formatIDR(selected.amount)}</p>
            </div>
          </div>

          <SourcePanel title="Transaction Information" subtitle="Step 1 · Source & parties" leading={chip(Info)}>
            <Rows rows={[
              { label: 'Date', value: formatTanggal(selected.tx_date) },
              { label: 'Cash / bank account', value: `${kodeAkun(selected.bank_account_code)} · ${selected.bank_account_name}` },
              { label: 'Party', value: selected.counterparty || '—' },
              { label: 'Description', value: selected.description || '—' },
              !!selected.reference && { label: 'Reference', value: selected.reference },
              !!selected.mutation && {
                label: 'Source Data line',
                value: `${formatTanggal(selected.mutation.date)} · ${selected.mutation.description || '—'} · ${formatIDR(selected.mutation.credit || selected.mutation.debit)}`,
              },
              { label: 'Created', value: `${selected.created_by_name || '—'} · ${formatTanggal(selected.created_at)}` },
              !!selected.approved_at && { label: 'Approved', value: `${selected.approved_by_name || '—'} · ${formatTanggal(selected.approved_at)}` },
            ]} />
          </SourcePanel>

          <SourcePanel title={receipt ? 'Received for' : 'Paid for'} subtitle="Step 2 · Settled lines" leading={chip(FileText)} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className={TH_CLS}>Type</th>
                    <th className={TH_CLS}>Invoice / Account</th>
                    <th className={TH_CLS}>Description</th>
                    <th className={`${TH_CLS} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l) => (
                    <tr key={l.id} className={TR_CLS}>
                      <td className={TD_CLS}>{l.line_type === 'sales_invoice' ? 'Sales Invoice' : l.line_type === 'purchase' ? 'Purchase' : 'Account'}</td>
                      <td className="px-2 py-2">
                        {l.invoice_no ? <span className="font-semibold tabular-nums">{l.invoice_no}</span> : null}
                        {l.party ? <span className="text-neutral-500"> · {l.party}</span> : null}
                        <span className="block text-neutral-500">{kodeAkun(l.account_code)} · {l.account_name}</span>
                      </td>
                      <td className="px-2 py-2 text-neutral-600">{l.description || '—'}</td>
                      <td className={`${TD_CLS} text-right font-semibold tabular-nums ${l.amount < 0 ? 'text-red-600' : ''}`}>{formatIDR(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SourcePanel>

          <SourcePanel
            title="Journal"
            subtitle="Step 3 · Entries that will hit the ledger"
            leading={chip(BookOpen)}
            action={<StatusPill tone={seimbang ? 'emerald' : 'red'} label={seimbang ? 'Balanced' : 'Unbalanced'} />}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className={`${TH_CLS} w-10`}>No.</th>
                    <th className={TH_CLS}>Account Code</th>
                    <th className={TH_CLS}>Account Name</th>
                    <th className={TH_CLS}>Description</th>
                    <th className={`${TH_CLS} text-right`}>Debit</th>
                    <th className={`${TH_CLS} text-right`}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.journal.map((j, i) => (
                    <tr key={j.line_no} className={TR_CLS}>
                      <td className={`${TD_CLS} text-neutral-500`}>{i + 1}</td>
                      <td className={`${TD_CLS} font-mono font-semibold`}>{kodeAkun(j.account_code) || '—'}</td>
                      <td className="px-2 py-2">{j.account_name || '—'}</td>
                      <td className="px-2 py-2 text-neutral-600">{j.description || '—'}</td>
                      <td className={`${TD_CLS} text-right tabular-nums`}>{j.debit > 0 ? formatIDR(j.debit) : '—'}</td>
                      <td className={`${TD_CLS} text-right tabular-nums`}>{j.credit > 0 ? formatIDR(j.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-bold text-neutral-900">
                    <td colSpan={4} className="border-b border-t border-neutral-800 px-2 py-2">Total</td>
                    <td className="whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-right tabular-nums">{formatIDR(totalDebit)}</td>
                    <td className="whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-right tabular-nums">{formatIDR(totalKredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SourcePanel>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
            <p className="max-w-xl text-xs font-medium text-neutral-600">
              {selected.status === 'draft'
                ? 'Review the lines & journal, then Approve. Invoices and the ledger only change once posted.'
                : 'Approved. When posted, the journal goes to the ledger and invoice settlements are applied. Posting requires Manager or above.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {selected.status === 'draft' && (
                <>
                  <button disabled={busy} onClick={() => setEditing(selected)} className={ACTION_BTN_SECONDARY}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button disabled={busy} onClick={() => hapus(selected)} className={DANGER_BTN}>
                    <Trash2 size={13} /> Delete
                  </button>
                  <button disabled={busy} onClick={() => aksiMassal([selected.id], 'approve')} className={ACTION_BTN_PRIMARY}>
                    <CheckCircle size={13} /> Approve
                  </button>
                </>
              )}
              {selected.status === 'approved' && (
                <>
                  <button disabled={busy} onClick={() => aksiMassal([selected.id], 'draft')} className={ACTION_BTN_SECONDARY}>
                    <Undo2 size={13} /> Return to Draft
                  </button>
                  <button disabled={busy} onClick={() => hapus(selected)} className={DANGER_BTN}>
                    <Trash2 size={13} /> Delete
                  </button>
                  <button
                    disabled={busy || !bisaPost}
                    title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                    onClick={() => aksiMassal([selected.id], 'post')}
                    className={ACTION_BTN_PRIMARY}
                  >
                    <Send size={13} /> Post to Ledger
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <CashBankTransactionModal open={!!editing} initial={editing} onClose={() => setEditing(null)} />
    </div>
  );
}