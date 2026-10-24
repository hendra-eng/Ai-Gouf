'use client';

// Mapping bank / rekening -> akun kas-bank COA milik klien aktif
// (financial_transaction_bank_cash_bank_mappings, migration 36). Dipakai
// upload Bank Feed dengan pilihan "Auto-detect": file dicocokkan lewat nomor
// rekening di header dokumen, kata kunci judul (mis. "LAPORAN KAS KASIR"),
// template ekstraksi, atau nama bank (kalau hanya 1 mapping untuk bank itu).
// Mapping baru juga tercatat otomatis saat file di-import ke akun pilihan
// manual. Seed SAU: migrations/seed_template_sau_bank_cash.sql.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon, PencilSquareIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useActiveClient } from '@/lib/activeClient';
import {
  createBcBankMapping,
  deleteBcBankMapping,
  updateBcBankMapping,
  useBcAccounts,
  useBcBankMappings,
  useBcTemplates,
  type BcBankMapping,
  type BcBankMappingInput,
} from '@/lib/bankCashStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const KOSONG: BcBankMappingInput = { bank_name: '', bank_coa_id: '', account_number: '', match_keyword: '', template_id: '', notes: '', is_active: true };

const keInput = (m: BcBankMapping): BcBankMappingInput => ({
  bank_name: m.bank_name, bank_coa_id: m.bank_coa_id, account_number: m.account_number ?? '', match_keyword: m.match_keyword ?? '',
  template_id: m.template_id ?? '', notes: m.notes ?? '', is_active: m.is_active,
});

function MappingForm({ clientId, awal, onClose }: { clientId: string; awal: BcBankMapping | null; onClose: () => void }) {
  const { accounts } = useBcAccounts(clientId);
  const { templates } = useBcTemplates(clientId);
  const akunKas = useMemo(() => accounts.filter((a) => a.cash_type && a.cash_type !== 'transit' && a.is_active), [accounts]);
  const [isi, setIsi] = useState<BcBankMappingInput>(awal ? keInput(awal) : KOSONG);
  const [busy, setBusy] = useState(false);
  const ubah = (k: keyof BcBankMappingInput, v: string | boolean) => setIsi((s) => ({ ...s, [k]: v }));

  const simpan = async () => {
    if (!isi.bank_name.trim() || !isi.bank_coa_id) {
      toast.error('Bank name and target account are required.');
      return;
    }
    if (!isi.account_number?.trim() && !isi.match_keyword?.trim() && !isi.template_id) {
      toast.warning('Without an account number, title keyword or template, this mapping only matches by bank name.');
    }
    const payload: BcBankMappingInput = {
      ...isi,
      account_number: isi.account_number?.trim() || null,
      match_keyword: isi.match_keyword?.trim() || null,
      template_id: isi.template_id || null,
      notes: isi.notes?.trim() || null,
    };
    setBusy(true);
    try {
      if (awal) await updateBcBankMapping(clientId, awal.id, payload);
      else await createBcBankMapping(clientId, payload);
      toast.success(awal ? 'Bank mapping updated.' : 'Bank mapping saved.');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the bank mapping.');
    } finally {
      setBusy(false);
    }
  };

  const kelasInput = 'w-full px-3 py-2 text-xs bg-card border border-border rounded-lg focus:outline-none text-foreground';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{awal ? 'Edit bank mapping' : 'Add bank mapping'}</h3>
          <button onClick={onClose} disabled={busy} className="p-1 hover:bg-muted rounded disabled:opacity-40"><XMarkIcon className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block text-xs">
            <span className="font-semibold text-foreground">Bank / source name</span>
            <input value={isi.bank_name} onChange={(e) => ubah('bank_name', e.target.value)} placeholder="e.g. BCA, Mandiri, Kas Kasir" className={`${kelasInput} mt-1`} />
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-foreground">Target account (COA)</span>
            <select value={isi.bank_coa_id} onChange={(e) => ubah('bank_coa_id', e.target.value)} className={`${kelasInput} mt-1`}>
              <option value="">Select account...</option>
              {akunKas.map((a) => <option key={a.id} value={a.id}>{kodeAkun(a.code)} - {a.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="font-semibold text-foreground">Account number</span>
              <input value={isi.account_number ?? ''} onChange={(e) => ubah('account_number', e.target.value)} placeholder="Printed on the statement" className={`${kelasInput} mt-1 font-mono`} />
            </label>
            <label className="block text-xs">
              <span className="font-semibold text-foreground">Title keyword</span>
              <input value={isi.match_keyword ?? ''} onChange={(e) => ubah('match_keyword', e.target.value)} placeholder="e.g. LAPORAN KAS KASIR" className={`${kelasInput} mt-1`} />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-semibold text-foreground">Extraction template (optional)</span>
            <select value={isi.template_id ?? ''} onChange={(e) => ubah('template_id', e.target.value)} className={`${kelasInput} mt-1`}>
              <option value="">— None —</option>
              {templates.filter((t) => t.is_active || t.id === isi.template_id).map((t) => (
                <option key={t.id} value={t.id}>{t.template_name || t.id} ({t.file_type})</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-foreground">Notes</span>
            <input value={isi.notes ?? ''} onChange={(e) => ubah('notes', e.target.value)} className={`${kelasInput} mt-1`} />
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={isi.is_active ?? true} onChange={(e) => ubah('is_active', e.target.checked)} className="rounded border-border" />
            Active
          </label>
          <p className="text-[11px] text-muted-foreground">
            Files are matched by account number first, then title keyword, then extraction template, then bank name
            (only when this is the company&apos;s only mapping for that bank).
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted disabled:opacity-40">Cancel</button>
          <button onClick={simpan} disabled={busy} className="px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BankMappings() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { mappings, loading } = useBcBankMappings(clientId);
  const [buka, setBuka] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ awal: BcBankMapping | null } | null>(null);

  if (!clientId) return null;

  const jalankan = async (id: string, fn: () => Promise<unknown>, pesan: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(pesan);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update the bank mapping.');
    } finally {
      setBusy(null);
    }
  };

  const hapus = (m: BcBankMapping) => {
    if (!window.confirm(`Delete bank mapping "${m.bank_name}${m.account_number ? ` ${m.account_number}` : ''}"? Files from this account will need the account selected manually.`)) return;
    jalankan(m.id, () => deleteBcBankMapping(clientId, m.id), 'Bank mapping deleted.');
  };

  const aktif = mappings.filter((m) => m.is_active).length;

  return (
    <div className="card-elevated-md rounded-xl overflow-hidden mb-6">
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => setBuka((b) => !b)} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">Bank Mapping</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading && mappings.length === 0
                ? 'Loading...'
                : `${aktif} active mapping(s) — uploads with “Auto-detect” are posted to the account mapped to the bank / account number in the file.`}
            </p>
          </div>
          <ChevronDownIcon className={`w-4 h-4 ml-auto shrink-0 text-muted-foreground transition-transform ${buka ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={() => setForm({ awal: null })}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border hover:bg-muted text-foreground shrink-0"
        >
          <PlusIcon className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {buka && (
        mappings.length === 0 ? (
          <p className="text-xs text-muted-foreground px-5 pb-5">
            No bank mapping yet. Add one, or import a statement with the account selected — the mapping is saved automatically.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Bank / Source', 'Account No.', 'Title Keyword', 'Target Account', 'Template', 'Used', 'Active', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className={`border-b border-border/50 ${m.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-semibold text-foreground">{m.bank_name}</span>
                      {m.notes && <span className="block text-[11px] text-muted-foreground max-w-[260px] truncate" title={m.notes}>{m.notes}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono whitespace-nowrap">{m.account_number || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{m.match_keyword || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{kodeAkun(m.bank_account_code)} - {m.bank_account_name}</td>
                    <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-[220px] truncate" title={m.template_name || undefined}>{m.template_name || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {m.usage_count}×
                      {m.last_used_at && <span className="block text-[11px] text-muted-foreground">{m.last_used_at.slice(0, 10)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={m.is_active}
                        disabled={busy === m.id}
                        onChange={(e) => jalankan(m.id, () => updateBcBankMapping(clientId, m.id, {
                          bank_name: m.bank_name, bank_coa_id: m.bank_coa_id, account_number: m.account_number, match_keyword: m.match_keyword,
                          template_id: m.template_id, notes: m.notes, is_active: e.target.checked,
                        }), e.target.checked ? 'Bank mapping activated.' : 'Bank mapping deactivated.')}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setForm({ awal: m })} disabled={busy === m.id} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Edit">
                        <PencilSquareIcon className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => hapus(m)} disabled={busy === m.id} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 disabled:opacity-40" title="Delete mapping">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {form && <MappingForm clientId={clientId} awal={form.awal} onClose={() => setForm(null)} />}
    </div>
  );
}
