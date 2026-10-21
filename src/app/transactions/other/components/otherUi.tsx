'use client';

// Komponen bersama halaman Transactions > Other: form jurnal, panel detail
// jurnal (+ aksi approve / reject / post / reverse), badge, ekspor CSV.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  deleteOtherJournal, fetchOtherAccounts, fetchOtherJournals, OTHER_CATEGORY, OTHER_STATUS, otherAction, reverseOtherJournal, saveOtherJournal, useOtherData,
  type OtherAccount, type OtherCategory, type OtherJournal, type OtherStatus,
} from '@/lib/otherJournalStore';
import { downloadTable } from '@/lib/tableExport';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { FormField, JournalLines, Modal, Pill, ReasonDialog } from '@/components/shared/moduleUi';

export const StatusPill = ({ s }: { s: OtherStatus }) => <Pill {...OTHER_STATUS[s]} />;

export async function exportJournalsCsv(journals: OtherJournal[], name: string) {
  const rows = journals.flatMap(j => j.lines.map(l => ({ j, l })));
  await downloadTable('csv', {
    title: 'Other Journals', clientName: '', rows, fileName: name, columns: [
      { header: 'Journal No.', value: r => r.j.journal_no }, { header: 'Date', value: r => r.j.journal_date }, { header: 'Category', value: r => r.j.category_label },
      { header: 'Party / Reference', value: r => r.j.reference }, { header: 'Description', value: r => r.l.description || r.j.description },
      { header: 'Account Code', value: r => r.l.account_code }, { header: 'Account Name', value: r => r.l.account_name },
      { header: 'Debit', value: r => r.l.debit, type: 'money' }, { header: 'Credit', value: r => r.l.credit, type: 'money' },
      { header: 'Status', value: r => OTHER_STATUS[r.j.status].label },
    ],
  });
}

export async function runAction(clientId: string, action: 'approve' | 'return-to-draft' | 'reject' | 'post', ids: string[], reason?: string) {
  try {
    toast.success((await otherAction(clientId, action, ids, reason)).message);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

interface Baris { key: number; coa_id: string | null; text: string; description: string; debit: string; credit: string }
let urut = 0;
const kosong = (): Baris => ({ key: ++urut, coa_id: null, text: '', description: '', debit: '', credit: '' });

/** Modal "New Other Journal" / edit (template other/3.png). */
export function JournalFormModal({ clientId, journal, onClose }: { clientId: string; journal: OtherJournal | null; onClose: () => void }) {
  const akun = useOtherData<OtherAccount[]>(`oacc:${clientId}`, s => fetchOtherAccounts(clientId, s), []);
  const meta = useOtherData(journal ? null : `ojn:${clientId}`, s => fetchOtherJournals(clientId, s), null as Awaited<ReturnType<typeof fetchOtherJournals>> | null);
  const [h, setH] = useState({
    journal_no: journal?.journal_no ?? '', journal_date: journal?.journal_date ?? todayIso(), category: (journal?.category ?? 'general') as OtherCategory,
    reference: journal?.reference ?? '', description: journal?.description ?? '', review_note: journal?.review_note ?? '',
  });
  const [baris, setBaris] = useState<Baris[]>(() => journal?.lines.length
    ? journal.lines.map(l => ({ key: ++urut, coa_id: l.coa_id, text: `${l.account_code} · ${l.account_name}`, description: l.description ?? '',
      debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '' }))
    : [kosong(), kosong()]);
  const [busy, setBusy] = useState(false);
  const peta = useMemo(() => new Map(akun.data.map(a => [`${a.code} · ${a.name}`, a])), [akun.data]);
  const kode = useMemo(() => new Map(akun.data.map(a => [a.code, a])), [akun.data]);
  const ubah = (key: number, p: Partial<Baris>) => setBaris(b => b.map(x => (x.key === key ? { ...x, ...p } : x)));
  const pilih = (key: number, teks: string) => {
    const a = peta.get(teks) ?? kode.get(teks.trim());
    ubah(key, { text: a ? `${a.code} · ${a.name}` : teks, coa_id: a?.id ?? null });
  };
  const d = baris.reduce((n, b) => n + (Number(b.debit) || 0), 0);
  const k = baris.reduce((n, b) => n + (Number(b.credit) || 0), 0);
  const seimbang = d > 0 && Math.abs(d - k) < 0.005;

  const simpan = async () => {
    const isi = baris.filter(b => Number(b.debit) || Number(b.credit));
    if (isi.some(b => !b.coa_id)) { toast.error('Choose an account from the list for every line with an amount.'); return; }
    if (!isi.length) { toast.error('Enter at least one line with an amount.'); return; }
    setBusy(true);
    try {
      const r = await saveOtherJournal(clientId, {
        journal_no: h.journal_no.trim() || null, journal_date: h.journal_date, category: h.category, reference: h.reference.trim() || null,
        description: h.description.trim() || null, review_note: h.review_note.trim() || null,
        lines: isi.map(b => ({ coa_id: b.coa_id, description: b.description.trim() || null, debit: Number(b.debit) || 0, credit: Number(b.credit) || 0 })),
      }, journal?.id);
      toast.success(seimbang ? r.message : `${r.message} It is not balanced yet — fix it before approval.`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={journal ? `Edit ${journal.journal_no}` : 'New Other Journal'}
      footer={<>
        <button type="button" onClick={onClose} className={`${btnOutline} flex-1`}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={`${btnPrimary} flex-1`}>{busy && <Loader2 size={14} className="animate-spin" />} Save as Draft</button>
      </>}>
      <datalist id="other-accounts">{akun.data.filter(a => a.is_active).map(a => <option key={a.id} value={`${a.code} · ${a.name}`} />)}</datalist>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <FormField label="Journal No."><input value={h.journal_no} onChange={e => setH({ ...h, journal_no: e.target.value })} className={`${inputCls} font-mono`} placeholder={meta.data?.next_number ?? 'Auto'} maxLength={40} /></FormField>
        <FormField label="Date"><input type="date" value={h.journal_date} onChange={e => setH({ ...h, journal_date: e.target.value })} className={inputCls} /></FormField>
        <FormField label="Party / Reference (optional)" className="md:col-span-2"><input value={h.reference} onChange={e => setH({ ...h, reference: e.target.value })} className={inputCls} placeholder="e.g. PT Sumber Makmur / INV-1847" maxLength={255} /></FormField>
        <FormField label="Description" className="md:col-span-3"><input value={h.description} onChange={e => setH({ ...h, description: e.target.value })} className={inputCls} placeholder="Journal description" /></FormField>
        <FormField label="Category">
          <select value={h.category} onChange={e => setH({ ...h, category: e.target.value as OtherCategory })} className={inputCls}>
            {(Object.keys(OTHER_CATEGORY) as OtherCategory[]).map(c => <option key={c} value={c}>{OTHER_CATEGORY[c]}</option>)}
          </select>
        </FormField>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Journal Lines</span>
        <button type="button" onClick={() => setBaris(b => [...b, kosong()])} className="inline-flex items-center gap-1 text-sm font-medium text-[#0F7D4E] hover:underline"><Plus size={14} /> Add Line</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 font-medium">Line Description</th>
            <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th><th className="w-8" /></tr></thead>
          <tbody className="divide-y divide-border">
            {baris.map(b => (
              <tr key={b.key}>
                <td className="px-2 py-1.5"><input list="other-accounts" value={b.text} onChange={e => pilih(b.key, e.target.value)} placeholder="Search account code or name..."
                  className={`${inputCls} ${b.text && !b.coa_id ? 'border-rose-300' : ''}`} /></td>
                <td className="px-2 py-1.5"><input value={b.description} onChange={e => ubah(b.key, { description: e.target.value })} className={inputCls} /></td>
                <td className="w-36 px-2 py-1.5"><input type="number" min={0} value={b.debit} onChange={e => ubah(b.key, { debit: e.target.value, credit: e.target.value ? '' : b.credit })} className={`${inputCls} text-right`} placeholder="0" /></td>
                <td className="w-36 px-2 py-1.5"><input type="number" min={0} value={b.credit} onChange={e => ubah(b.key, { credit: e.target.value, debit: e.target.value ? '' : b.debit })} className={`${inputCls} text-right`} placeholder="0" /></td>
                <td className="px-1"><button type="button" onClick={() => setBaris(x => (x.length > 2 ? x.filter(y => y.key !== b.key) : x))} className="rounded p-1 text-muted-foreground hover:text-rose-600" aria-label="Remove line"><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className={seimbang ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}>
            <td colSpan={2} className="px-3 py-2 text-right text-sm font-medium">{seimbang ? 'Balanced' : 'Not balanced'}</td>
            <td className="px-3 py-2 text-right font-semibold">{rupiah(d)}</td><td className="px-3 py-2 text-right font-semibold">{rupiah(k)}</td><td />
          </tr></tfoot>
        </table>
      </div>
      <FormField label="Review note (optional)"><textarea rows={2} value={h.review_note} onChange={e => setH({ ...h, review_note: e.target.value })} className={inputCls} /></FormField>
    </Modal>
  );
}

/** Panel detail 1 jurnal + aksi sesuai status. */
export function JournalDetail({ clientId, j, onEdit, onDone }: { clientId: string; j: OtherJournal; onEdit: (j: OtherJournal) => void; onDone?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'reject' | 'reverse'>(null);
  const jalan = async (label: string, fn: () => Promise<boolean>) => { setBusy(label); await fn(); setBusy(null); };
  const tombol = (label: string, fn: () => Promise<boolean>, utama = false) => (
    <button type="button" disabled={!!busy} onClick={() => jalan(label, fn)}
      className={utama ? `${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]` : btnSmall}>
      {busy === label && <Loader2 size={12} className="animate-spin" />} {label}
    </button>
  );
  const err = j.issues.filter(i => i.level === 'error');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold">{j.journal_no}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(j.journal_date)} · {j.category_label}{j.reference ? ` · ${j.reference}` : ''}</p>
        </div>
        <StatusPill s={j.status} />
      </div>
      {j.description && <p className="text-sm">{j.description}</p>}
      <JournalLines lines={j.lines} />
      {j.issues.length > 0 && j.status !== 'posted' && j.status !== 'reversed' && (
        <ul className="space-y-1 rounded-xl border border-border p-3 text-xs">
          {j.issues.map(i => (
            <li key={i.message} className={`flex gap-2 ${i.level === 'error' ? 'text-rose-600' : 'text-amber-700'}`}><AlertTriangle size={13} className="mt-0.5 shrink-0" />{i.message}</li>
          ))}
        </ul>
      )}
      {!j.issues.length && j.status !== 'posted' && j.status !== 'reversed' && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} /> All checks passed.</p>}
      {j.rejected_reason && j.status === 'rejected' && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Rejected: {j.rejected_reason}</p>}
      {j.review_note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs">Review note: {j.review_note}</p>}
      {j.status === 'reversed' && <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs">Reversed on {fmtDate(j.reversal_date)} by {j.reversed_by_name ?? '—'} (journal RV-{j.journal_no}). Reason: {j.reversal_reason}</p>}
      <div className="grid grid-cols-1 gap-1 text-[11px] text-muted-foreground sm:grid-cols-3">
        <span>Created: {j.created_by_name ?? '—'} · {fmtDateTime(j.created_at)}</span>
        <span>Approved: {j.approved_by_name ?? '—'} · {fmtDateTime(j.approved_at)}</span>
        <span>Posted: {j.posted_by_name ?? '—'} · {fmtDateTime(j.posted_at)}</span>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {['draft', 'approved', 'rejected'].includes(j.status) && <button type="button" className={btnSmall} onClick={() => onEdit(j)}>Edit</button>}
        {['draft', 'approved', 'rejected'].includes(j.status) && (
          <button type="button" disabled={!!busy} className={`${btnSmall} text-rose-600`} onClick={() => { if (window.confirm(`Delete ${j.journal_no}?`)) jalan('Delete', async () => { try { toast.success((await deleteOtherJournal(clientId, j.id)).message); onDone?.(); return true; } catch (e) { toast.error((e as Error).message); return false; } }); }}>Delete</button>
        )}
        {j.status === 'rejected' && tombol('Return to Draft', () => runAction(clientId, 'return-to-draft', [j.id]))}
        {j.status === 'approved' && tombol('Return to Draft', () => runAction(clientId, 'return-to-draft', [j.id]))}
        {(j.status === 'draft' || j.status === 'approved') && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setDialog('reject')}>Reject</button>}
        {j.status === 'draft' && tombol('Approve', () => runAction(clientId, 'approve', [j.id]), !err.length)}
        {j.status === 'approved' && tombol('Post to Ledger', () => runAction(clientId, 'post', [j.id]), true)}
        {j.status === 'posted' && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setDialog('reverse')}>Reverse</button>}
      </div>
      <ReasonDialog open={dialog === 'reject'} title={`Reject ${j.journal_no}`} confirmLabel="Reject" onClose={() => setDialog(null)}
        onConfirm={async reason => { if (!(await runAction(clientId, 'reject', [j.id], reason))) throw new Error('failed'); }} />
      <ReasonDialog open={dialog === 'reverse'} title={`Reverse ${j.journal_no}`} withDate minDate={j.journal_date} defaultDate={todayIso()}
        subtitle="A reversing journal (RV-) is posted on the reversal date." onClose={() => setDialog(null)}
        onConfirm={async (reason, d) => { try { toast.success((await reverseOtherJournal(clientId, j.id, reason, d)).message); } catch (e) { toast.error((e as Error).message); throw e; } }} />
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${inputCls} pl-9`} />
    </div>
  );
}

export const cocok = (j: OtherJournal, q: string) => !q || [j.journal_no, j.reference, j.description, ...j.lines.map(l => `${l.account_code} ${l.account_name}`)]
  .some(x => (x || '').toLowerCase().includes(q.toLowerCase()));
