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
import { ChevronDown, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
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
import {
  ACTION_BTN_PRIMARY, ACTION_BTN_SECONDARY, CHECKBOX_CLS, FIELD_CLS, FilterSelect, FIELD_LABEL_CLS, ICON_BTN, ICON_BTN_DANGER,
  ModalShell, PANEL_ICON_CHIP, SourcePanel, StatusPill, TD_CLS, TH_CLS, TR_CLS,
} from './sourceUi';

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

  return (
    <ModalShell
      title={awal ? 'Edit bank mapping' : 'Add bank mapping'}
      subtitle="Route uploaded statements to the right cash / bank account automatically."
      icon={<Landmark size={17} />}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} disabled={busy} className={ACTION_BTN_SECONDARY}>Cancel</button>
          <button onClick={simpan} disabled={busy} className={ACTION_BTN_PRIMARY}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className={FIELD_LABEL_CLS}>Bank / source name</span>
          <input value={isi.bank_name} onChange={(e) => ubah('bank_name', e.target.value)} placeholder="e.g. BCA, Mandiri, Kas Kasir" className={FIELD_CLS} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLS}>Target account (COA)</span>
          <FilterSelect
            value={isi.bank_coa_id}
            onChange={(v) => ubah('bank_coa_id', v)}
            placeholder="Select account..."
            className="w-full"
            options={akunKas.map((a) => ({ value: a.id, label: `${kodeAkun(a.code)} - ${a.name}` }))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={FIELD_LABEL_CLS}>Account number</span>
            <input value={isi.account_number ?? ''} onChange={(e) => ubah('account_number', e.target.value)} placeholder="Printed on the statement" className={`${FIELD_CLS} tabular-nums`} />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLS}>Title keyword</span>
            <input value={isi.match_keyword ?? ''} onChange={(e) => ubah('match_keyword', e.target.value)} placeholder="e.g. LAPORAN KAS KASIR" className={FIELD_CLS} />
          </label>
        </div>
        <label className="block">
          <span className={FIELD_LABEL_CLS}>Extraction template (optional)</span>
          <FilterSelect
            value={isi.template_id ?? ''}
            onChange={(v) => ubah('template_id', v)}
            className="w-full"
            options={[
              { value: '', label: '— None —' },
              ...templates.filter((t) => t.is_active || t.id === isi.template_id).map((t) => ({ value: t.id, label: `${t.template_name || t.id} (${t.file_type})` })),
            ]}
          />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLS}>Notes</span>
          <input value={isi.notes ?? ''} onChange={(e) => ubah('notes', e.target.value)} className={FIELD_CLS} />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-neutral-900">
          <input type="checkbox" checked={isi.is_active ?? true} onChange={(e) => ubah('is_active', e.target.checked)} className={CHECKBOX_CLS} />
          Active
        </label>
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium text-neutral-500">
          Files are matched by account number first, then title keyword, then extraction template, then bank name
          (only when this is the company&apos;s only mapping for that bank).
        </p>
      </div>
    </ModalShell>
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
    <>
      <SourcePanel
        title="Bank Mapping"
        subtitle={
          loading && mappings.length === 0
            ? 'Loading...'
            : `${aktif} active mapping(s) — uploads with “Auto-detect” are posted to the account mapped to the bank / account number in the file.`
        }
        leading={<span className={PANEL_ICON_CHIP}><Landmark size={17} /></span>}
        open={buka}
        onHeaderClick={() => setBuka((b) => !b)}
        flush
        action={
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setForm({ awal: null })} className={ACTION_BTN_PRIMARY}>
              <Plus size={13} /> Add
            </button>
            <button onClick={() => setBuka((b) => !b)} aria-label={buka ? 'Collapse' : 'Expand'} className={ICON_BTN}>
              <ChevronDown size={16} className={`transition-transform ${buka ? 'rotate-180' : ''}`} />
            </button>
          </div>
        }
      >
        {mappings.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs font-medium text-neutral-500">
            No bank mapping yet. Add one, or import a statement with the account selected — the mapping is saved automatically.
          </p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[900px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  {['Bank / Source', 'Account No.', 'Title Keyword', 'Target Account', 'Template', 'Used', 'Status', ''].map((h, i) => (
                    <th key={`${h}-${i}`} className={`${TH_CLS} text-left`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className={`${TR_CLS} ${m.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-2 py-2">
                      <span className="font-semibold text-neutral-900">{m.bank_name}</span>
                      {m.notes && <span className="block max-w-[260px] truncate text-[11px] text-neutral-500" title={m.notes}>{m.notes}</span>}
                    </td>
                    <td className={`${TD_CLS} tabular-nums`}>{m.account_number || '—'}</td>
                    <td className={TD_CLS}>{m.match_keyword || '—'}</td>
                    <td className={`${TD_CLS} font-medium`}>{kodeAkun(m.bank_account_code)} - {m.bank_account_name}</td>
                    <td className="max-w-[220px] truncate px-2 py-2 text-[11px] text-neutral-500" title={m.template_name || undefined}>{m.template_name || '—'}</td>
                    <td className={`${TD_CLS} tabular-nums`}>
                      {m.usage_count}×
                      {m.last_used_at && <span className="block text-[11px] text-neutral-500">{m.last_used_at.slice(0, 10)}</span>}
                    </td>
                    <td className={TD_CLS}>
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={m.is_active}
                          disabled={busy === m.id}
                          onChange={(e) => jalankan(m.id, () => updateBcBankMapping(clientId, m.id, {
                            bank_name: m.bank_name, bank_coa_id: m.bank_coa_id, account_number: m.account_number, match_keyword: m.match_keyword,
                            template_id: m.template_id, notes: m.notes, is_active: e.target.checked,
                          }), e.target.checked ? 'Bank mapping activated.' : 'Bank mapping deactivated.')}
                          className={CHECKBOX_CLS}
                        />
                        <StatusPill tone={m.is_active ? 'emerald' : 'neutral'} label={m.is_active ? 'Active' : 'Inactive'} />
                      </label>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <button onClick={() => setForm({ awal: m })} disabled={busy === m.id} className={ICON_BTN} title="Edit" aria-label="Edit mapping">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => hapus(m)} disabled={busy === m.id} className={ICON_BTN_DANGER} title="Delete mapping" aria-label="Delete mapping">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SourcePanel>
      {form && <MappingForm clientId={clientId} awal={form.awal} onClose={() => setForm(null)} />}
    </>
  );
}