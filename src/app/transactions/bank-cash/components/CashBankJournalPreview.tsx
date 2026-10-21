'use client';

// Tab Journal Preview (Cash & Bank): antrean transaksi DRAFT / APPROVED dari
// Reconciliation maupun input manual, beserta jurnalnya (dihitung backend dari
// baris transaksi -- sama persis dengan yang masuk buku besar saat diposting).
// Alur: Draft --Approve (Supervisor+)--> Approved --Post (Manager+)--> Posted.
// Draft bisa diedit / dihapus; Approved bisa dikembalikan ke Draft.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, CheckCircle, Undo2, Pencil, Trash2, Send } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { PreviewSection, FieldList, JournalTable, PickerPagination, PREVIEW_CARD } from '@/app/transactions/components/PreviewLayout';
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

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatTanggal = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
};

// Sama dengan LEVEL_POST di backend (bank_cash_v1.py); backend tetap yang menentukan.
const LEVEL_POST = 4;
const levelDariRole = (role?: string | null) => {
  if (role === 'super_admin') return 999;
  const m = /^tahap_(\d+)$/.exec(role ?? '');
  return m ? Number(m[1]) : 0;
};

const ITEMS_PER_PAGE = 8;

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

  if (!selected) {
    return (
      <div className={`${PREVIEW_CARD} p-8 text-center text-xs text-muted-foreground space-y-2`}>
        {error && <p className="text-rose-600">{error}</p>}
        <p>
          {loading
            ? 'Loading...'
            : 'No pending transactions. Transactions appear here after a line is matched in the Reconciliation tab or created with the New Transaction button.'}
        </p>
      </div>
    );
  }

  const totalDebit = selected.journal.reduce((n, j) => n + j.debit, 0);
  const totalKredit = selected.journal.reduce((n, j) => n + j.credit, 0);
  const receipt = selected.direction === 'receipt';

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Kiri: daftar transaksi */}
      <div className={`lg:w-80 flex-shrink-0 ${PREVIEW_CARD} overflow-hidden self-start`}>
        <div className="p-3 border-b border-border space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Awaiting Approve / Post</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search no., party, invoice…"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-border rounded-lg bg-card"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border">
            {(['all', 'draft', 'approved'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold ${statusFilter === s ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground'}`}
              >
                {s === 'all' ? `All (${transactions.length})` : `${TX_STATUS_LABEL[s]} (${transactions.filter((t) => t.status === s).length})`}
              </button>
            ))}
          </div>
          {pilihan.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pilihanDraft.length > 0 && (
                <button disabled={busy} onClick={() => aksiMassal(pilihanDraft, 'approve')} className="px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold disabled:opacity-50">
                  Approve {pilihanDraft.length}
                </button>
              )}
              {pilihanApproved.length > 0 && (
                <button
                  disabled={busy || !bisaPost}
                  title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                  onClick={() => aksiMassal(pilihanApproved, 'post')}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-semibold disabled:opacity-50"
                >
                  Post {pilihanApproved.length}
                </button>
              )}
              <button onClick={() => setChecked(new Set())} className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">Clear selection</button>
            </div>
          )}
        </div>
        <div className="divide-y divide-border/60">
          {paged.map((t) => (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`px-3 py-2.5 cursor-pointer flex gap-2 ${selected.id === t.id ? 'bg-blue-50' : 'hover:bg-muted/40'}`}
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
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold text-foreground">{t.tx_number}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[t.status]}`}>{TX_STATUS_LABEL[t.status]}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{t.counterparty || t.category || '—'}</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{formatTanggal(t.tx_date)}</span>
                  <span className={`font-mono font-semibold ${t.direction === 'receipt' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {t.direction === 'receipt' ? '+' : '−'}{formatIDR(t.amount)}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {paged.length === 0 && <p className="text-xs text-muted-foreground p-4 text-center">No transactions match this filter.</p>}
        </div>
        <div className="px-3 pb-3">
          <PickerPagination page={safePage} totalPages={totalPages} total={filtered.length} itemLabel="transactions" onPageChange={setPage} />
        </div>
      </div>

      {/* Kanan: detail */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className={`${PREVIEW_CARD} p-5 flex flex-wrap items-start justify-between gap-3`}>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground font-mono">{selected.tx_number}</h2>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[selected.status]}`}>{TX_STATUS_LABEL[selected.status]}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {receipt ? 'Cash Receipt' : 'Cash Payment'} · {selected.category || '—'} · {{ bank_feed: 'from Source Data', manual: 'manual entry', ar: 'from Accounts Receivable', ap: 'from Accounts Payable', tax: 'from Tax Compliance' }[selected.source]}
            </p>
          </div>
          <p className={`text-xl font-bold font-mono ${receipt ? 'text-emerald-700' : 'text-rose-700'}`}>{formatIDR(selected.amount)}</p>
        </div>

        <PreviewSection title="Transaction Information" step={1}>
          <FieldList rows={[
            { label: 'Date', value: formatTanggal(selected.tx_date) },
            { label: 'Cash / bank account', value: `${selected.bank_account_code} · ${selected.bank_account_name}` },
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
        </PreviewSection>

        <PreviewSection title={receipt ? 'Received for' : 'Paid for'} step={2} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-semibold">Type</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Invoice / Account</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Description</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{l.line_type === 'sales_invoice' ? 'Sales Invoice' : l.line_type === 'purchase' ? 'Purchase' : 'Account'}</td>
                    <td className="px-4 py-2.5">
                      {l.invoice_no ? <span className="font-mono">{l.invoice_no}</span> : null}
                      {l.party ? <span className="text-muted-foreground"> · {l.party}</span> : null}
                      <span className="block text-muted-foreground">{l.account_code} · {l.account_name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{l.description || '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap ${l.amount < 0 ? 'text-rose-600' : ''}`}>{formatIDR(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PreviewSection>

        <PreviewSection title="Journal" step={3} stepColor="purple" flush>
          <JournalTable
            lines={selected.journal.map((j) => ({ key: j.line_no, code: j.account_code, name: j.account_name, description: j.description, debit: j.debit, credit: j.credit }))}
            totalDebit={totalDebit}
            totalCredit={totalKredit}
            formatAmount={formatIDR}
            showDescription
          />
        </PreviewSection>

        <div className={`${PREVIEW_CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-xs text-muted-foreground max-w-xl">
            {selected.status === 'draft'
              ? 'Review the lines & journal, then Approve. Invoices and the ledger only change once posted.'
              : 'Approved. When posted, the journal goes to the ledger and invoice settlements are applied. Posting requires Manager or above.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {selected.status === 'draft' && (
              <>
                <button disabled={busy} onClick={() => setEditing(selected)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50">
                  <Pencil size={13} /> Edit
                </button>
                <button disabled={busy} onClick={() => hapus(selected)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  <Trash2 size={13} /> Delete
                </button>
                <button disabled={busy} onClick={() => aksiMassal([selected.id], 'approve')} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">
                  <CheckCircle size={13} /> Approve
                </button>
              </>
            )}
            {selected.status === 'approved' && (
              <>
                <button disabled={busy} onClick={() => aksiMassal([selected.id], 'draft')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50">
                  <Undo2 size={13} /> Return to Draft
                </button>
                <button disabled={busy} onClick={() => hapus(selected)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  <Trash2 size={13} /> Delete
                </button>
                <button
                  disabled={busy || !bisaPost}
                  title={bisaPost ? undefined : 'Posting requires Manager (level 4) or above'}
                  onClick={() => aksiMassal([selected.id], 'post')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Send size={13} /> Post to Ledger
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <CashBankTransactionModal open={!!editing} initial={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
