'use client';

// Komponen & konfigurasi bersama Other Transactions (dataset/picture/Template UI/other/1-8.jpeg):
// ikon/warna per jenis, isian khusus per jenis untuk form, badge status, drawer detail + aksi.
// Backend: modules/assets_and_equity/other_transactions_v1.py.

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, BarChart3, CheckCircle2, Coins, Download, FileText, Loader2, MoreHorizontal, Network, Paperclip, ShieldCheck, Undo2, User, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { fmtDate, fmtDateTime, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  attachmentUrl, bulkAction, deleteTransaction, fetchTransaction, reverseTransaction, TX_STATUS, useOtherTxData,
  type BulkAction, type OtherTx, type TxStatus, type TypeKey,
} from '@/lib/otherTransactionStore';
import { btnSmall, Drawer, Field, inputCls } from '@/components/arap/arapUi';
import { Pill, ReasonDialog } from '@/components/shared/moduleUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// ============================================================
// KONFIGURASI PER JENIS
// ============================================================

export interface DetailField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'date' | 'percent';
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export interface TypeUi {
  icon: React.ElementType;
  /** kartu Quick Create + ikon header form */
  card: string;
  iconBg: string;
  dot: string;
  title: string;
  subtitle: string;
  about: string;
  partyCodeLabel?: string;
  referenceLabel: string;
  referenceRequired?: boolean;
  descriptionLabel: string;
  dueDateLabel?: string;
  claimPeriod?: boolean;
  details: DetailField[];
}

export const TYPE_UI: Record<TypeKey, TypeUi> = {
  employee_advance: {
    icon: User, card: 'border-emerald-100 bg-emerald-50/50', iconBg: 'bg-emerald-100 text-emerald-700', dot: '#22C55E',
    title: 'Employee Advance', subtitle: 'Record advances paid to employees before expense settlement.',
    about: 'This form records cash or bank advances paid to employees for business purposes such as travel, project expenses, or operational needs. The advance is settled against actual expenses at a later date.',
    partyCodeLabel: 'Employee ID', referenceLabel: 'Reference No.', descriptionLabel: 'Purpose', dueDateLabel: 'Settlement Due Date', details: [],
  },
  security_deposit: {
    icon: ShieldCheck, card: 'border-sky-100 bg-sky-50/50', iconBg: 'bg-sky-100 text-sky-700', dot: '#0EA5E9',
    title: 'Security Deposit', subtitle: 'Record refundable deposits paid to others or received from others.',
    about: 'This form records rent, utility, and other refundable deposits. A deposit paid is recorded as an asset and is reversed when refunded; a deposit received (e.g. from a tenant or customer) is recorded as a liability and is reversed when returned.',
    referenceLabel: 'Reference No.', descriptionLabel: 'Deposit Purpose / Description', dueDateLabel: 'Refund / Review Date',
    details: [{ key: 'deposit_type', label: 'Deposit Type', kind: 'select', required: true,
      options: ['Rent Deposit', 'Utility Deposit', 'Lease Deposit', 'Tender / Bid Bond', 'Customs Deposit', 'Other Deposit'] }],
  },
  loan_financing: {
    icon: Coins, card: 'border-amber-100 bg-amber-50/50', iconBg: 'bg-amber-100 text-amber-700', dot: '#F59E0B',
    title: 'Loan & Financing', subtitle: 'Record loan proceeds, loan repayment, and interest transactions.',
    about: 'This form records loans received from banks or other lenders, principal repayments (optionally with an interest portion), and interest payments.',
    referenceLabel: 'Loan Agreement No.', descriptionLabel: 'Loan Description', dueDateLabel: 'Maturity Date',
    details: [
      { key: 'interest_rate', label: 'Interest Rate (per year)', kind: 'percent', placeholder: '0,00' },
      { key: 'loan_term_months', label: 'Loan Term (Months)', kind: 'number', placeholder: '0' },
    ],
  },
  capital_injection: {
    icon: BarChart3, card: 'border-violet-100 bg-violet-50/50', iconBg: 'bg-violet-100 text-violet-700', dot: '#8B5CF6',
    title: 'Capital & Owner Withdrawal', subtitle: 'Record owner investment, capital changes, and owner withdrawals.',
    about: 'This form records capital paid in by shareholders or owners (split between share capital and additional paid-in capital), capital reductions, and owner withdrawals (drawings) charged to the owner drawings account.',
    referenceLabel: 'Subscription / Resolution No.', descriptionLabel: 'Description',
    details: [{ key: 'effective_date', label: 'Effective Date', kind: 'date', required: true }],
  },
  intercompany: {
    icon: Network, card: 'border-teal-100 bg-teal-50/50', iconBg: 'bg-teal-100 text-teal-700', dot: '#0B5E5C',
    title: 'Intercompany', subtitle: 'Record transactions between related entities and intercompany balances.',
    about: 'This form records funding and settlements between related entities. Due From balances are receivables from the related entity; Due To balances are payables.',
    referenceLabel: 'Reference No.', descriptionLabel: 'Description', dueDateLabel: 'Due Date',
    details: [
      { key: 'from_entity', label: 'From Entity', kind: 'text', required: true },
      { key: 'to_entity', label: 'To Entity', kind: 'text', required: true },
      { key: 'settlement_type', label: 'Settlement Type', kind: 'select', required: true, options: ['Bank Transfer', 'Offset / Netting', 'Cash', 'Other'] },
    ],
  },
  refund_reimbursement: {
    icon: Undo2, card: 'border-rose-100 bg-rose-50/50', iconBg: 'bg-rose-100 text-rose-600', dot: '#F43F5E',
    title: 'Refund & Reimbursement', subtitle: 'Record customer refunds and employee expense reimbursements.',
    about: 'This form records reimbursements of expenses paid by employees, refunds paid to customers, and refunds received from vendors.',
    partyCodeLabel: 'Employee / Customer ID', referenceLabel: 'Reference No.', referenceRequired: true, descriptionLabel: 'Description', claimPeriod: true,
    details: [
      { key: 'tax_treatment', label: 'Tax Treatment', kind: 'select',
        options: ['Non-Taxable (Not subject to VAT)', 'Taxable - VAT Included', 'Taxable - VAT Excluded'] },
      { key: 'reimbursement_category', label: 'Reimbursement Category', kind: 'select', required: true,
        options: ['Travel & Transportation', 'Meals & Entertainment', 'Office Supplies', 'Medical', 'Communication', 'Training', 'Customer Refund', 'Other'] },
    ],
  },
  other_event: {
    icon: MoreHorizontal, card: 'border-slate-200 bg-slate-50', iconBg: 'bg-slate-200 text-slate-700', dot: '#64748B',
    title: 'Other Approved Events', subtitle: 'Record miscellaneous approved business events with predefined accounting rules.',
    about: 'This form records miscellaneous business events approved by management that do not fit the other templates. Choose the debit and credit accounts explicitly.',
    referenceLabel: 'Approval Reference No.', referenceRequired: true, descriptionLabel: 'Description',
    details: [
      { key: 'event_category', label: 'Event Category', kind: 'select', required: true,
        options: ['General Expense', 'Accrual', 'Reclassification', 'Correction', 'Write-off', 'Provision', 'Other'] },
      { key: 'approval_owner', label: 'Approval Owner', kind: 'text', required: true },
    ],
  },
};

export const TYPE_ORDER: TypeKey[] = ['employee_advance', 'security_deposit', 'loan_financing', 'capital_injection', 'intercompany', 'refund_reimbursement', 'other_event'];

export function TypeIcon({ type, size = 'sm' }: { type: TypeKey; size?: 'sm' | 'md' | 'lg' }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const u = TYPE_UI[type] ?? TYPE_UI.other_event;
  const Ikon = u.icon;
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : size === 'md' ? 'h-10 w-10 rounded-xl' : 'h-7 w-7 rounded-lg';
  return <span className={`inline-flex shrink-0 items-center justify-center ${box} ${u.iconBg}`}><Ikon size={size === 'lg' ? 26 : size === 'md' ? 19 : 14} /></span>;
}

export const StatusPill = ({ s }: { s: TxStatus }) => <Pill label={TX_STATUS[s]?.label ?? s} style={TX_STATUS[s]?.style ?? 'bg-slate-100 text-slate-600'} />;

export function MonoTypeIcon({ type, size = 'sm' }: { type: TypeKey; size?: 'sm' | 'md' }) {
  const Ikon = (TYPE_UI[type] ?? TYPE_UI.other_event).icon;
  const box = size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  return <span className={`flex ${box} shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200`}><Ikon size={size === 'md' ? 17 : 14} strokeWidth={1.5} /></span>;
}

// Tabel baris jurnal bergaya elegan monokrom (angka tabular, header kapital, total bergaris tegas).
export function PreviewLines({ lines }: { lines: OtherTx['lines'] }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const d = lines.reduce((n, l) => n + l.debit, 0);
  const k = lines.reduce((n, l) => n + l.credit, 0);
  const f = (n: number) => (n ? n.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '');
  const th = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600';
  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr className="bg-neutral-50 text-left">
          <th className={`${th} border-y border-neutral-200`}>Account</th>
          <th className={`${th} border-y border-neutral-200 text-right`}>Debit</th>
          <th className={`${th} border-y border-neutral-200 text-right`}>Credit</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="[&>td]:border-b [&>td]:border-neutral-100 [&:hover>td]:bg-neutral-50">
            <td className="px-3 py-2 pr-2 align-top">
              <span className="font-mono font-semibold text-neutral-900">{kodeAkun(l.account_code)}</span>
              <span className="text-neutral-800"> · {l.account_name}</span>
              {l.description && <span className="mt-0.5 block text-[10px] font-medium text-neutral-500">{l.description}</span>}
            </td>
            <td className="px-3 py-2 text-right align-top font-medium tabular-nums text-neutral-900">{f(l.debit)}</td>
            <td className="px-3 py-2 text-right align-top font-medium tabular-nums text-neutral-900">{f(l.credit)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-neutral-50 [&>td]:border-t [&>td]:border-neutral-800">
          <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-700">Total</td>
          <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-neutral-900">{f(d)}</td>
          <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-neutral-900">{f(k)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export const createHref = (type: TypeKey, templateId?: string | null) =>
  `/transactions/other/create?type=${type}${templateId ? `&template=${templateId}` : ''}`;
export const editHref = (id: string) => `/transactions/other/create?id=${id}`;

export const cocok = (t: OtherTx, q: string) => !q || [t.journal_no, t.counterparty, t.reference_no, t.description, t.type_name, t.subtype_label,
  ...t.lines.map(l => `${l.account_code} ${kodeAkun(l.account_code)} ${l.account_name}`)].some(x => (x || '').toLowerCase().includes(q.toLowerCase()));

export const EDITABLE: TxStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];

/** Jalankan aksi massal + toast hasilnya. */
export async function runBulk(clientId: string, action: BulkAction, ids: string[], reason?: string): Promise<boolean> {
  try {
    const r = await bulkAction(clientId, action, ids, reason);
    (r.data.failed.length ? toast.warning : toast.success)(r.message);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

export function SearchBox({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <div className={`relative ${className}`}>
      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-neutral-300 bg-card py-2 pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
    </div>
  );
}

export function IssueList({ issues }: { issues: OtherTx['issues'] }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  if (!issues.length) return <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-700"><CheckCircle2 size={14} className="text-neutral-800" /> All checks passed.</p>;
  return (
    <ul className="space-y-1.5 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3 text-xs">
      {issues.map(i => (
        <li key={i.message} className={`flex gap-2 ${i.level === 'error' ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-600'}`}>{i.level === 'error' ? <XCircle size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-neutral-500" />}{i.message}</li>
      ))}
    </ul>
  );
}

const AKSI: Record<string, string> = {
  created: 'Created', edited: 'Edited', submitted: 'Submitted for review', approved: 'Approved', rejected: 'Rejected', returned_to_draft: 'Returned to draft',
  posted: 'Posted to the General Ledger', reversed: 'Reversed', deleted: 'Deleted', attachment_added: 'Document uploaded', attachment_removed: 'Document removed',
};

// ============================================================
// DRAWER DETAIL
// ============================================================

/** Drawer detail 1 transaksi; `txId` null = tertutup. Detail (lampiran + riwayat) dimuat ulang dari backend. */
export function TransactionDrawer({ clientId, txId, canPost, onClose }: { clientId: string; txId: string | null; canPost: boolean; onClose: () => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const d = useOtherTxData<OtherTx | null>(txId ? `otx:${clientId}:${txId}` : null, s => fetchTransaction(clientId, txId as string, s), null);
  if (!txId) return null;
  if (!d.data || d.data.id !== txId) {
    return (
      <Drawer open onClose={onClose} title="Transaction">
        {d.error ? <p className="text-sm font-semibold text-neutral-900">{d.error}</p> : <div className="h-40 animate-pulse rounded-[10px] bg-neutral-100" />}
      </Drawer>
    );
  }
  return <DrawerIsi clientId={clientId} tx={d.data} canPost={canPost} onClose={onClose} />;
}

function DrawerIsi({ clientId, tx, canPost, onClose }: { clientId: string; tx: OtherTx; canPost: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'reject' | 'reverse'>(null);
  const jalan = async (label: string, fn: () => Promise<boolean>) => {
    setBusy(label);
    const ok = await fn();
    setBusy(null);
    if (ok) onClose();
  };
  const tombol = (label: string, action: BulkAction, utama = false) => (
    <button type="button" disabled={!!busy} onClick={() => jalan(label, () => runBulk(clientId, action, [tx.id]))}
      className={utama ? `${btnSmall} border-blue-600 bg-blue-600 text-white hover:bg-blue-700` : btnSmall}>
      {busy === label && <Loader2 size={12} className="animate-spin" />} {label}
    </button>
  );
  const ui = TYPE_UI[tx.type_key];
  const detail = ui.details.filter(d => tx.details[d.key] !== undefined && tx.details[d.key] !== '');
  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2"><MonoTypeIcon type={tx.type_key} /> {tx.journal_no}</span>}
      subtitle={`${tx.type_name} · ${tx.subtype_label} · ${fmtDate(tx.journal_date)}`}
      footer={<>
        {EDITABLE.includes(tx.status) && tx.source !== 'legacy' && <Link href={editHref(tx.id)} className={btnSmall}>Edit</Link>}
        {EDITABLE.includes(tx.status) && (
          <button type="button" disabled={!!busy} className={`${btnSmall} text-neutral-900`} onClick={() => {
            if (!window.confirm(`Delete ${tx.journal_no}?`)) return;
            jalan('Delete', async () => { try { toast.success((await deleteTransaction(clientId, tx.id)).message); return true; } catch (e) { toast.error((e as Error).message); return false; } });
          }}>Delete</button>
        )}
        {['pending_review', 'approved', 'rejected'].includes(tx.status) && tombol('Return to Draft', 'return-to-draft')}
        {['pending_review', 'approved'].includes(tx.status) && <button type="button" className={`${btnSmall} text-neutral-900`} onClick={() => setDialog('reject')}>Reject</button>}
        {['draft', 'rejected'].includes(tx.status) && tombol('Submit for Review', 'submit', !tx.has_error)}
        {tx.status === 'pending_review' && tombol('Approve', 'approve', !tx.has_error)}
        {tx.status === 'approved' && canPost && tombol('Post to GL', 'post', true)}
        {tx.status === 'posted' && canPost && <button type="button" className={`${btnSmall} text-neutral-900`} onClick={() => setDialog('reverse')}>Reverse</button>}
      </>}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">{rupiah(tx.amount_idr)}</p>
          {tx.currency !== 'IDR' && <p className="text-xs text-neutral-600">{tx.currency} {tx.amount.toLocaleString('id-ID')} @ {tx.exchange_rate.toLocaleString('id-ID')}</p>}
        </div>
        <StatusPill s={tx.status} />
      </div>
      {tx.description && <p className="text-sm">{tx.description}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Counterparty">{tx.counterparty || '—'}{tx.counterparty_code ? ` (${tx.counterparty_code})` : ''}</Field>
        <Field label={ui.referenceLabel}>{tx.reference_no || '—'}</Field>
        {ui.dueDateLabel && <Field label={ui.dueDateLabel}>{fmtDate(tx.due_date)}</Field>}
        {ui.claimPeriod && <Field label="Claim Period">{tx.period_start ? `${fmtDate(tx.period_start)} – ${fmtDate(tx.period_end)}` : '—'}</Field>}
        {detail.map(d => <Field key={d.key} label={d.label}>{d.kind === 'date' ? fmtDate(String(tx.details[d.key])) : `${tx.details[d.key]}${d.kind === 'percent' ? '%' : ''}`}</Field>)}
        {tx.branch && <Field label="Branch">{tx.branch}</Field>}
        {tx.department && <Field label="Department">{tx.department}</Field>}
        {tx.project && <Field label="Project">{tx.project}</Field>}
        {tx.cost_center && <Field label="Cost Center">{tx.cost_center}</Field>}
        <Field label="Template">{tx.template_name}</Field>
        <Field label="Requires Approval">{tx.requires_approval ? 'Yes' : 'No'}</Field>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">Journal</p>
        <div className="overflow-x-auto rounded-[10px] border border-neutral-200"><PreviewLines lines={tx.lines} /></div>
      </div>
      {tx.status !== 'posted' && tx.status !== 'reversed' && <IssueList issues={tx.issues} />}
      {tx.status === 'rejected' && tx.rejected_reason && <p className="rounded-[10px] border border-neutral-800 bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-900">Rejected by {tx.rejected_by_name ?? '—'}: {tx.rejected_reason}</p>}
      {tx.status === 'reversed' && <p className="rounded-[10px] border border-neutral-300 bg-neutral-100 px-3 py-2 text-xs text-neutral-800">Reversed on {fmtDate(tx.reversal_date)} by {tx.reversed_by_name ?? '—'} (journal RV-{tx.journal_no}). Reason: {tx.reversal_reason}</p>}
      {tx.notes && <p className="rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">Notes: {tx.notes}</p>}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600"><Paperclip size={13} /> Supporting Documents</p>
        {!tx.attachments?.length ? <p className="text-xs text-neutral-600">{tx.attachment_count ? `${tx.attachment_count} document(s)` : 'No documents attached.'}</p> : (
          <ul className="space-y-1 text-xs">
            {tx.attachments.map(a => (
              <li key={a.id} className="flex items-center gap-2 rounded-[10px] border border-neutral-200 px-3 py-2">
                <FileText size={14} className="text-neutral-600" /><span className="flex-1 truncate">{a.file_name}</span>
                <span className="text-neutral-600">{(a.size_bytes / 1024).toFixed(0)} KB</span>
                <a href={attachmentUrl(clientId, a.id)} target="_blank" rel="noreferrer" className="text-neutral-800 hover:text-neutral-900"><Download size={14} /></a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!!tx.events?.length && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">Activity</p>
          <ol className="space-y-1.5 border-l border-neutral-300 pl-3 text-[11px]">
            {tx.events.map((e, i) => (
              <li key={i}><span className="font-medium">{AKSI[e.action] ?? e.action}</span> · {e.actor_name ?? '—'} · <span className="text-neutral-600">{fmtDateTime(e.created_at)}</span>
                {e.note && <span className="block text-neutral-600">{e.note}</span>}</li>
            ))}
          </ol>
        </div>
      )}
      <ReasonDialog open={dialog === 'reject'} title={`Reject ${tx.journal_no}`} confirmLabel="Reject" onClose={() => setDialog(null)}
        onConfirm={async reason => { if (!(await runBulk(clientId, 'reject', [tx.id], reason))) throw new Error('failed'); onClose(); }} />
      <ReasonDialog open={dialog === 'reverse'} title={`Reverse ${tx.journal_no}`} withDate minDate={tx.journal_date} defaultDate={todayIso()}
        subtitle="A reversing journal (RV-) is posted on the reversal date." onClose={() => setDialog(null)}
        onConfirm={async (reason, d) => {
          try { toast.success((await reverseTransaction(clientId, tx.id, reason, d)).message); onClose(); } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </Drawer>
  );
}