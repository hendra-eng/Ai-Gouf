'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Plus, Trash2 } from 'lucide-react';
import {
  createJeDraftWithLines,
  updateJeDraftFull,
  type BackendJeDraftWithLines,
  type JeDraftLineInput,
} from '@/lib/journalEntryStore';
import { useActiveClient } from '@/lib/activeClient';
import { useClientCoa, type CoaAccount } from '@/lib/coaStore';
import AccountNameAutocomplete from '../../journal-entry/components/AccountNameAutocomplete';
import { OTHER_SOURCE_TYPE } from '../lib/otherStore';

// Form tambah & edit jurnal Other. Disimpan sebagai draft Journal Entry
// (source_type = "Other"); approve & posting dilakukan dari tab Journal Preview.

const MIN_LINES = 2;

interface LineDraft {
  key: number;
  account_code: string;
  account_name: string;
  description: string;
  debit: string;
  credit: string;
}

const emptyLine = (key: number): LineDraft => ({ key, account_code: '', account_name: '', description: '', debit: '', credit: '' });

function periodOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ` ${d.getFullYear()}`;
}

function defaultNumber(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `OTH-${now.getFullYear()}-${mm}-${Math.floor(Math.random() * 9000) + 1000}`;
}

const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

export default function OtherJournalModal({
  clientId,
  createdByName,
  draft,
  onClose,
  onSaved,
}: {
  clientId: string;
  createdByName: string;
  /** Diisi = mode edit; kosong = jurnal baru. */
  draft?: BackendJeDraftWithLines | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const editing = !!draft;
  const today = new Date().toISOString().slice(0, 10);
  const { activeClientId } = useActiveClient();
  const { accounts: coaAccounts, loading: coaLoading } = useClientCoa(activeClientId, { activeOnly: true });
  const coaByNo = useMemo(() => new Map(coaAccounts.map((a) => [a.acc_no, a])), [coaAccounts]);

  const [jeNumber, setJeNumber] = useState(draft?.je_number ?? defaultNumber());
  const [entryDate, setEntryDate] = useState(draft?.entry_date ?? today);
  const [description, setDescription] = useState(draft?.description ?? '');
  const [reference, setReference] = useState(draft?.source_reference ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (draft && draft.lines?.length) {
      return draft.lines.map((l, i) => ({
        key: i + 1,
        account_code: l.account_code,
        account_name: l.account_name ?? '',
        description: l.description ?? '',
        debit: Number(l.debit) ? String(Number(l.debit)) : '',
        credit: Number(l.credit) ? String(Number(l.credit)) : '',
      }));
    }
    return [emptyLine(1), emptyLine(2)];
  });
  const [nextKey, setNextKey] = useState((draft?.lines?.length ?? 2) + 1);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const setField = (key: number, field: keyof LineDraft, value: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  const pickAccount = (key: number, a: CoaAccount) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, account_code: a.acc_no, account_name: a.account_name } : l)));

  const fillFromCode = (key: number, code: string) => {
    const a = coaByNo.get(code.trim());
    if (a) pickAccount(key, a);
  };

  const addLine = () => { setLines((p) => [...p, emptyLine(nextKey)]); setNextKey((k) => k + 1); };
  const removeLine = (key: number) => setLines((p) => (p.length <= MIN_LINES ? p : p.filter((l) => l.key !== key)));

  const submit = async () => {
    if (!jeNumber.trim() || !entryDate) { toast.error('Nomor jurnal dan tanggal wajib diisi.'); return; }
    const clean: JeDraftLineInput[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const debit = Number(l.debit) || 0;
      const credit = Number(l.credit) || 0;
      if (!l.account_code.trim()) { toast.error(`Baris ${i + 1}: kode akun wajib diisi.`); return; }
      if (debit > 0 && credit > 0) { toast.error(`Baris ${i + 1}: isi debit ATAU kredit, bukan keduanya.`); return; }
      if (debit === 0 && credit === 0) { toast.error(`Baris ${i + 1}: debit atau kredit wajib diisi.`); return; }
      clean.push({
        account_code: l.account_code.trim(),
        account_name: l.account_name.trim() || undefined,
        description: l.description.trim() || undefined,
        debit, credit,
      });
    }
    if (!totals.balanced) { toast.error(`Jurnal tidak balance: debit ${rp(totals.debit)} ≠ kredit ${rp(totals.credit)}.`); return; }

    setSaving(true);
    try {
      if (editing && draft) {
        await updateJeDraftFull(draft.id, {
          je_number: jeNumber.trim(),
          entry_date: entryDate,
          period_label: periodOf(entryDate),
          description: description.trim(),
          source_reference: reference.trim(),
          notes: notes.trim() || null,
          lines: clean,
        });
        toast.success('Jurnal diperbarui', { description: jeNumber });
      } else {
        const payload = {
          client_id: clientId,
          management_client_id: activeClientId,
          je_number: jeNumber.trim(),
          entry_date: entryDate,
          period_label: periodOf(entryDate) || 'N/A',
          description: description.trim() || undefined,
          source_type: OTHER_SOURCE_TYPE,
          source_reference: reference.trim() || undefined,
          currency: 'IDR',
          status: 'draft',
          created_by_name: createdByName,
          notes: notes.trim() || undefined,
          lines: clean,
        };
        try {
          await createJeDraftWithLines(payload);
        } catch (err) {
          // nomor acak bentrok -> coba sekali lagi dengan nomor baru
          if (err instanceof Error && /already used/i.test(err.message)) {
            await createJeDraftWithLines({ ...payload, je_number: defaultNumber() });
          } else {
            throw err;
          }
        }
        toast.success('Jurnal Other dibuat sebagai Draft', { description: 'Approve & posting dari tab Journal Preview.' });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan jurnal');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full mt-0.5 px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{editing ? 'Edit Jurnal Other' : 'Jurnal Other Baru'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded" aria-label="Tutup"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">No. Jurnal</label>
            <input value={jeNumber} onChange={(e) => setJeNumber(e.target.value)} className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Tanggal</label>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">Pihak / Referensi (opsional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="mis. PT Sumber Makmur / INV-1847" className={inputCls} />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="text-[11px] text-muted-foreground">Deskripsi</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Keterangan jurnal" className={inputCls} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-foreground">Baris Jurnal</label>
            <button onClick={addLine} type="button" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              <Plus size={13} /> Tambah Baris
            </button>
          </div>
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">Kode Akun</th>
                  <th className="px-2 py-2 font-semibold">Nama Akun</th>
                  <th className="px-2 py-2 font-semibold">Keterangan</th>
                  <th className="px-2 py-2 font-semibold text-right w-28">Debit</th>
                  <th className="px-2 py-2 font-semibold text-right w-28">Kredit</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="px-2 py-1.5"><input value={l.account_code} onChange={(e) => setField(l.key, 'account_code', e.target.value)} onBlur={(e) => fillFromCode(l.key, e.target.value)} placeholder="1100" className={`${inputCls} mt-0 font-mono`} /></td>
                    <td className="px-2 py-1.5 min-w-[180px]">
                      <AccountNameAutocomplete
                        value={l.account_name}
                        accounts={coaAccounts}
                        loading={coaLoading}
                        noClient={!activeClientId}
                        onChange={(v) => setField(l.key, 'account_name', v)}
                        onSelect={(a) => pickAccount(l.key, a)}
                        placeholder="Cari akun…"
                        className={`${inputCls} mt-0`}
                      />
                    </td>
                    <td className="px-2 py-1.5"><input value={l.description} onChange={(e) => setField(l.key, 'description', e.target.value)} className={`${inputCls} mt-0`} /></td>
                    <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setField(l.key, 'debit', e.target.value)} placeholder="0" className={`${inputCls} mt-0 text-right`} /></td>
                    <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setField(l.key, 'credit', e.target.value)} placeholder="0" className={`${inputCls} mt-0 text-right`} /></td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => removeLine(l.key)} type="button" disabled={lines.length <= MIN_LINES} className="text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Hapus baris">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t ${totals.balanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <td colSpan={3} className={`px-2 py-2 text-right font-semibold ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>{totals.balanced ? 'Balance' : 'Belum balance'}</td>
                  <td className={`px-2 py-2 text-right font-bold tabular-nums ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>{rp(totals.debit)}</td>
                  <td className={`px-2 py-2 text-right font-bold tabular-nums ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>{rp(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground">Catatan review (opsional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <button onClick={onClose} type="button" className="flex-1 py-2 border border-border rounded-lg text-xs font-medium hover:bg-muted">Batal</button>
          <button onClick={submit} type="button" disabled={saving} className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50">
            {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan sebagai Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
