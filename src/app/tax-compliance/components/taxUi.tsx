'use client';

// Komponen kecil halaman Tax Compliance: badge status, tabel baris pajak,
// drawer lengkapi / adjustment baris pajak.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { fmtDate, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  addLedgerAdjustment, deleteLedger, fetchTaxAccounts, PAYMENT_STYLE, REPORTING_STYLE, SEVERITY_STYLE, SOURCE_LABEL, TAX_LABEL, updateLedger, useTaxData,
  type LedgerRow, type PaymentStatus, type ReportingStatus, type Severity, type TaxAccountsData, type TaxType,
} from '@/lib/taxComplianceStore';
import { btnOutline, btnPrimary, Drawer, EmptyRow, Field, inputCls, Menu, MenuItem } from '@/components/arap/arapUi';
import { AccountSelect, FormField, Pill, tdCls } from '@/components/shared/moduleUi';

export const PayPill = ({ s }: { s: PaymentStatus }) => <DotPill {...PAYMENT_STYLE[s]} />;
export const RepPill = ({ s }: { s: ReportingStatus }) => <DotPill {...REPORTING_STYLE[s]} />;

export function DotPill({ label, style }: { label: string; style: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{label}
    </span>
  );
}

export function SeverityPill({ s }: { s: Severity }) {
  const x = SEVERITY_STYLE[s];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${x.style}`}><span className={`h-2 w-2 rounded-full ${x.dot}`} />{x.label}</span>;
}

export const angka = (n: number | null | undefined) => (n === null || n === undefined ? '—' : rupiah(n).replace('Rp ', ''));

/** Tabel baris pajak dengan kolom yang bisa dipilih + aksi lengkapi / hapus adjustment. */
export function LedgerTable({ rows, loading, clientId, kolom, empty, docLabel = 'e-Faktur / e-Bupot' }: {
  rows: LedgerRow[]; loading: boolean; clientId: string; empty: string; docLabel?: string;
  kolom: ('date' | 'doc' | 'party' | 'module' | 'type' | 'code' | 'dpp' | 'rate' | 'amount' | 'gl' | 'taxdoc' | 'match' | 'pay' | 'rep' | 'billing')[];
}) {
  const [edit, setEdit] = useState<LedgerRow | null>(null);
  const H: Record<string, { h: string; right?: boolean }> = {
    date: { h: 'Date' }, doc: { h: 'Source Document' }, party: { h: 'Party' }, module: { h: 'Source Module' }, type: { h: 'Tax Type' }, code: { h: 'Tax Code' },
    dpp: { h: 'DPP (Tax Base)', right: true }, rate: { h: 'Rate', right: true }, amount: { h: 'Tax Amount', right: true }, gl: { h: 'GL Account' },
    taxdoc: { h: docLabel }, match: { h: 'Match Status' }, pay: { h: 'Payment Status' }, rep: { h: 'Reporting Status' }, billing: { h: 'Billing / Doc No.' },
  };
  return (
    <>
      <div className="overflow-x-auto px-2">
        <table className="w-full min-w-[1100px] text-sm">
          <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
            {kolom.map(k => <th key={k} className={`px-3 py-2.5 font-medium ${H[k].right ? 'text-right' : 'text-left'}`}>{H[k].h}</th>)}
            <th className="w-10" />
          </tr></thead>
          <tbody className="divide-y divide-border">
            {(loading || !rows.length) && <EmptyRow cols={kolom.length + 1} loading={loading} text={empty} />}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                {kolom.map(k => (
                  <td key={k} className={`${tdCls} ${H[k].right ? 'text-right' : ''}`}>
                    {k === 'date' && fmtDate(r.date)}
                    {k === 'doc' && <span className="font-medium">{r.source_document ?? '—'}</span>}
                    {k === 'party' && <span>{r.party_name ?? '—'}{r.party_type && <span className="block text-[11px] capitalize text-muted-foreground">{r.party_type}</span>}</span>}
                    {k === 'module' && SOURCE_LABEL[r.source_module]}
                    {k === 'type' && <span>{TAX_LABEL[r.tax_type]}{r.tax_object && <span className="block max-w-[200px] truncate text-[11px] text-muted-foreground">{r.tax_object}</span>}</span>}
                    {k === 'code' && (r.tax_code ?? '—')}
                    {k === 'dpp' && <span>{angka(r.dpp)}{r.dpp_estimated && <span className="ml-1 text-[10px] text-amber-600" title="Estimated from the standard rate">est.</span>}</span>}
                    {k === 'rate' && (r.rate !== null ? `${r.rate}%` : '—')}
                    {k === 'amount' && <span className="font-medium">{angka(r.tax_amount)}</span>}
                    {k === 'gl' && (r.gl_account_code ? <span className="whitespace-nowrap">{r.gl_account_code}<span className="block max-w-[160px] truncate text-[11px] text-muted-foreground">{r.gl_account_name}</span></span> : '—')}
                    {k === 'taxdoc' && (r.tax_document_no ?? <span className="text-muted-foreground">—</span>)}
                    {k === 'match' && <DotPill label={r.match_status === 'matched' ? 'Matched' : 'Unmatched'} style={r.match_status === 'matched' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'} />}
                    {k === 'pay' && <PayPill s={r.payment_status} />}
                    {k === 'rep' && <RepPill s={r.reporting_status} />}
                    {k === 'billing' && (r.tax_document_no ?? '—')}
                  </td>
                ))}
                <td className={tdCls}>
                  <Menu width="w-44" button={() => <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
                    {close => <>
                      <MenuItem onClick={() => { close(); setEdit(r); }}>View / complete</MenuItem>
                      {r.is_manual && <MenuItem danger onClick={async () => {
                        close();
                        if (!window.confirm('Delete this manual adjustment?')) return;
                        try { toast.success((await deleteLedger(clientId, r.id)).message); } catch (e) { toast.error((e as Error).message); }
                      }}>Delete adjustment</MenuItem>}
                    </>}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <LedgerDrawer clientId={clientId} row={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const JENIS: TaxType[] = ['vat_output', 'vat_input', 'pph21', 'pph22', 'pph23', 'pph26', 'pph4_2', 'pph15', 'pph25', 'pph29', 'pph_credit', 'pbb', 'other'];

/** Lengkapi baris pajak (nomor e-Faktur / e-Bupot, kode objek, NPWP, DPP) atau buat Add Adjustment (row null). */
export function LedgerDrawer({ clientId, row, onClose }: { clientId: string; row: LedgerRow | null; onClose: () => void }) {
  const akun = useTaxData<TaxAccountsData | null>(row ? null : `tacc:${clientId}`, s => fetchTaxAccounts(clientId, s), null);
  const manual = !row || row.is_manual;
  const [f, setF] = useState({
    entry_date: row?.date ?? todayIso(), tax_type: (row?.tax_type ?? 'pph23') as TaxType, tax_code: row?.tax_code ?? '', tax_object: row?.tax_object ?? '',
    source_document: row?.source_document ?? '', party_name: row?.party_name ?? '', party_type: row?.party_type ?? '', party_npwp: row?.party_npwp ?? '',
    dpp: row?.dpp != null ? String(row.dpp) : '', rate: row?.rate != null ? String(row.rate) : '', tax_amount: row ? String(row.tax_amount) : '',
    tax_document_no: row?.tax_document_no ?? '', tax_document_date: row?.tax_document_date ?? '', notes: row?.notes ?? '', gl_coa_id: null as string | null,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const hitung = () => {
    const d = num(f.dpp), r = num(f.rate);
    if (d !== null && r !== null) set('tax_amount', String(Math.round(d * r) / 100));
  };

  const simpan = async () => {
    setBusy(true);
    try {
      const umum = {
        tax_code: f.tax_code, tax_object: f.tax_object, party_npwp: f.party_npwp, party_type: f.party_type || null,
        dpp: num(f.dpp), rate: num(f.rate), tax_document_no: f.tax_document_no, tax_document_date: f.tax_document_date || null, notes: f.notes,
      };
      if (!row) {
        if (!num(f.tax_amount)) { toast.error('Enter the tax amount.'); setBusy(false); return; }
        toast.success((await addLedgerAdjustment(clientId, {
          ...umum, entry_date: f.entry_date, tax_type: f.tax_type, source_document: f.source_document || null, party_name: f.party_name || null,
          tax_amount: num(f.tax_amount), gl_coa_id: f.gl_coa_id,
        })).message);
      } else {
        toast.success((await updateLedger(clientId, row.id, manual
          ? { ...umum, tax_type: f.tax_type, entry_date: f.entry_date, tax_amount: num(f.tax_amount) }
          : { ...umum, tax_type: f.tax_type })).message);
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={row ? `${row.source_document ?? 'Tax entry'} · ${TAX_LABEL[row.tax_type]}` : 'Add Tax Adjustment'}
      subtitle={row ? `${SOURCE_LABEL[row.source_module]} · ${fmtDate(row.date)}${row.journal_no ? ` · ${row.journal_no}` : ''}` : 'Manual tax ledger entry (e.g. correction, payroll PPh 21, tax not captured by a transaction)'}
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
      </>}>
      {row && (
        <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-3">
          <Field label="Tax Amount">{rupiah(row.tax_amount)}</Field>
          <Field label="Outstanding">{rupiah(row.outstanding)}</Field>
          <Field label="Payment">{<PayPill s={row.payment_status} />} {row.payment_due && <span className="text-[11px] text-muted-foreground">due {fmtDate(row.payment_due)}</span>}</Field>
          <Field label="Reporting">{<RepPill s={row.reporting_status} />} {row.filing_due && <span className="text-[11px] text-muted-foreground">due {fmtDate(row.filing_due)}</span>}</Field>
          <Field label="Party">{row.party_name ?? '—'}</Field>
          <Field label="GL Account">{row.gl_account_code ? `${row.gl_account_code} · ${row.gl_account_name}` : '—'}</Field>
        </div>
      )}
      {!manual && <p className="text-[11px] text-muted-foreground">Date, amount and party follow the source transaction. Complete the tax document details below.</p>}
      <div className="grid grid-cols-2 gap-3">
        {manual && <FormField label="Date" required><input type="date" value={f.entry_date} onChange={e => set('entry_date', e.target.value)} className={inputCls} /></FormField>}
        <FormField label="Tax Type" className={manual ? '' : 'col-span-2'}>
          <select value={f.tax_type} onChange={e => set('tax_type', e.target.value as TaxType)} className={inputCls}>{JENIS.map(j => <option key={j} value={j}>{TAX_LABEL[j]}</option>)}</select>
        </FormField>
        {!row && <>
          <FormField label="Document No."><input value={f.source_document} onChange={e => set('source_document', e.target.value)} className={inputCls} placeholder="Auto" /></FormField>
          <FormField label="Party"><input value={f.party_name} onChange={e => set('party_name', e.target.value)} className={inputCls} /></FormField>
        </>}
        <FormField label="Party Type">
          <select value={f.party_type} onChange={e => set('party_type', e.target.value)} className={inputCls}>
            <option value="">—</option><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="employee">Employee</option><option value="other">Other</option>
          </select>
        </FormField>
        <FormField label="Party NPWP / NIK"><input value={f.party_npwp} onChange={e => set('party_npwp', e.target.value)} className={inputCls} maxLength={30} /></FormField>
        <FormField label="Tax Object Code"><input value={f.tax_code} onChange={e => set('tax_code', e.target.value)} className={inputCls} maxLength={30} placeholder="e.g. 24-104-01" /></FormField>
        <FormField label="Tax Object"><input value={f.tax_object} onChange={e => set('tax_object', e.target.value)} className={inputCls} maxLength={255} placeholder="e.g. Consulting services" /></FormField>
        <FormField label="DPP (Tax Base)"><input type="number" min={0} value={f.dpp} onChange={e => set('dpp', e.target.value)} onBlur={manual ? hitung : undefined} className={inputCls} /></FormField>
        <FormField label="Rate (%)"><input type="number" min={0} max={100} step="0.01" value={f.rate} onChange={e => set('rate', e.target.value)} onBlur={manual ? hitung : undefined} className={inputCls} /></FormField>
        {manual && <FormField label="Tax Amount" required hint="Negative for a correction"><input type="number" value={f.tax_amount} onChange={e => set('tax_amount', e.target.value)} className={inputCls} /></FormField>}
        <FormField label="e-Faktur / e-Bupot No."><input value={f.tax_document_no} onChange={e => set('tax_document_no', e.target.value)} className={inputCls} maxLength={60} /></FormField>
        <FormField label="Tax Document Date"><input type="date" value={f.tax_document_date} onChange={e => set('tax_document_date', e.target.value)} className={inputCls} /></FormField>
        {!row && akun.data && (
          <FormField label="GL Account (optional)" className="col-span-2">
            <AccountSelect accounts={akun.data.accounts} value={f.gl_coa_id} onChange={v => set('gl_coa_id', v)} filter={a => !!a.tax_type} placeholder="Tax account" />
          </FormField>
        )}
        <FormField label="Notes" className="col-span-2"><textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} className={inputCls} /></FormField>
      </div>
    </Drawer>
  );
}

export function SeverityDot({ s }: { s: Severity }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${SEVERITY_STYLE[s].dot}`} />;
}

export { Pill };
