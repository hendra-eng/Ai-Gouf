'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XMarkIcon, PlusIcon, TrashIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { createJeDraftWithLines, type JeDraftLineInput } from '@/lib/journalEntryStore';
import { useActiveClient } from '@/lib/activeClient';
import { exportJournalEntryPdf } from './exportJournalEntryPdf';

// Jumlah baris jurnal yang langsung tersedia saat form dibuka. Tetap bisa
// ditambah (Add Line) atau dikurangi sampai minimal 2 (syarat 1 debit + 1 kredit).
const DEFAULT_LINE_COUNT = 5;
const MIN_LINE_COUNT = 2;

const SOURCE_TYPES = ['Manual', 'Sales', 'Purchase', 'Expense', 'Cash', 'Bank', 'Payroll', 'Inventory', 'Fixed Assets', 'Tax'];

interface LineDraft {
  key: number;
  account_code: string;
  account_name: string;
  description: string;
  debit: string;
  credit: string;
  cost_center: string;
}

function baris_kosong(key: number): LineDraft {
  return { key, account_code: '', account_name: '', description: '', debit: '', credit: '', cost_center: '' };
}

function periodeDariTanggal(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '';
  }
}

function nomorJeDefault(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `JE-${yyyy}-${mm}-${rand}`;
}

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

export default function NewJournalEntryModal({
  clientId,
  createdByName,
  onClose,
}: {
  clientId: string;
  createdByName: string;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [jeNumber, setJeNumber] = useState(nomorJeDefault());
  const [entryDate, setEntryDate] = useState(today);
  const [periodLabel, setPeriodLabel] = useState(periodeDariTanggal(today));
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState('Manual');
  const [sourceReference, setSourceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => Array.from({ length: DEFAULT_LINE_COUNT }, (_, i) => baris_kosong(i + 1)));
  const [nextKey, setNextKey] = useState(DEFAULT_LINE_COUNT + 1);
  const [submitting, setSubmitting] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Kop PDF (nama + logo) mengikuti perusahaan yang sedang aktif di dropdown header.
  const { clients, activeClientId, activeClientName } = useActiveClient();
  const activeClient = clients.find(c => c.id === activeClientId) ?? null;

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const updateLine = (key: number, field: keyof LineDraft, value: string) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, [field]: value } : l)));
  };

  const addLine = () => {
    setLines(prev => [...prev, baris_kosong(nextKey)]);
    setNextKey(k => k + 1);
  };

  const removeLine = (key: number) => {
    setLines(prev => (prev.length <= MIN_LINE_COUNT ? prev : prev.filter(l => l.key !== key)));
  };

  // Cetak PDF dari isi form saat ini (tidak perlu sudah disimpan/balance).
  const printPdf = async () => {
    setPrinting(true);
    try {
      await exportJournalEntryPdf(
        {
          jeNumber, entryDate, period: periodLabel, sourceType, description, sourceReference, notes,
          lines,
        },
        {
          companyName: activeClient?.companyName || activeClientName || '',
          logoDataUrl: activeClient?.logo,
          printedBy: createdByName,
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate journal entry PDF');
    } finally {
      setPrinting(false);
    }
  };

  const submit = async () => {
    if (!jeNumber.trim() || !entryDate || !periodLabel.trim()) {
      toast.error('Please fill in JE Number, Entry Date, and Period first.');
      return;
    }
    const cleanedLines: JeDraftLineInput[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const debit = Number(l.debit) || 0;
      const credit = Number(l.credit) || 0;
      if (!l.account_code.trim()) {
        toast.error(`Line ${i + 1}: Account Code is required.`);
        return;
      }
      if (debit > 0 && credit > 0) {
        toast.error(`Line ${i + 1}: cannot fill both Debit and Credit.`);
        return;
      }
      if (debit === 0 && credit === 0) {
        toast.error(`Line ${i + 1}: Debit or Credit is required.`);
        return;
      }
      cleanedLines.push({
        account_code: l.account_code.trim(),
        account_name: l.account_name.trim() || undefined,
        description: l.description.trim() || undefined,
        debit, credit,
        cost_center: l.cost_center.trim() || undefined,
      });
    }
    if (!totals.balanced) {
      toast.error(`Journal entry is not balanced. Debit ${fmt(totals.debit)} ≠ Credit ${fmt(totals.credit)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const dibuat = await createJeDraftWithLines({
        client_id: clientId,
        je_number: jeNumber.trim(),
        entry_date: entryDate,
        period_label: periodLabel.trim(),
        description: description.trim() || undefined,
        source_type: sourceType,
        source_reference: sourceReference.trim() || undefined,
        currency: 'IDR',
        status: 'draft',
        created_by_name: createdByName,
        notes: notes.trim() || undefined,
        lines: cleanedLines,
      });
      toast.success('Journal entry created successfully', { description: dibuat.je_number });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create journal entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="je-card bg-card w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">New Journal Entry</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">JE Number</label>
            <input value={jeNumber} onChange={e => setJeNumber(e.target.value)} className="je-input w-full mt-0.5" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Entry Date</label>
            <input type="date" value={entryDate} onChange={e => { setEntryDate(e.target.value); setPeriodLabel(periodeDariTanggal(e.target.value)); }} className="je-input w-full mt-0.5" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Period</label>
            <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} className="je-input w-full mt-0.5" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Source Type</label>
            <select value={sourceType} onChange={e => setSourceType(e.target.value)} className="je-select w-full mt-0.5">
              {SOURCE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Journal entry description" className="je-input w-full mt-0.5" />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">Source Reference (optional)</label>
            <input value={sourceReference} onChange={e => setSourceReference(e.target.value)} placeholder="mis. INV-2026-1847" className="je-input w-full mt-0.5" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-foreground">Journal Lines</label>
            <button onClick={addLine} type="button" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              <PlusIcon className="w-3.5 h-3.5" /> Add Line
            </button>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Account Code</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Account Name</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Description</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Cost Center</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground w-28">Debit</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground w-28">Credit</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, idx) => (
                  <tr key={l.key}>
                    <td className="px-2 py-1.5"><input value={l.account_code} onChange={e => updateLine(l.key, 'account_code', e.target.value)} placeholder="1100" className="je-input w-full text-xs" /></td>
                    <td className="px-2 py-1.5"><input value={l.account_name} onChange={e => updateLine(l.key, 'account_name', e.target.value)} placeholder="Cash" className="je-input w-full text-xs" /></td>
                    <td className="px-2 py-1.5"><input value={l.description} onChange={e => updateLine(l.key, 'description', e.target.value)} className="je-input w-full text-xs" /></td>
                    <td className="px-2 py-1.5"><input value={l.cost_center} onChange={e => updateLine(l.key, 'cost_center', e.target.value)} className="je-input w-full text-xs" /></td>
                    <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={l.debit} onChange={e => updateLine(l.key, 'debit', e.target.value)} placeholder="0.00" className="je-input w-full text-xs text-right" /></td>
                    <td className="px-2 py-1.5"><input type="number" min="0" step="0.01" value={l.credit} onChange={e => updateLine(l.key, 'credit', e.target.value)} placeholder="0.00" className="je-input w-full text-xs text-right" /></td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => removeLine(l.key)} type="button" disabled={lines.length <= MIN_LINE_COUNT} className="text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t ${totals.balanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <td colSpan={4} className={`px-2 py-2 text-right font-semibold ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>
                    {totals.balanced ? 'Balanced' : 'Not balanced'}
                  </td>
                  <td className={`px-2 py-2 text-right font-bold tabular-nums ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totals.debit)}</td>
                  <td className={`px-2 py-2 text-right font-bold tabular-nums ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="je-input w-full mt-0.5" />
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <button onClick={onClose} type="button" className="flex-1 py-2 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={printPdf}
            type="button"
            disabled={printing}
            title={activeClient?.logo ? undefined : 'No logo uploaded for this company yet (add one in Clients > Edit Client)'}
            className="flex-1 py-2 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <PrinterIcon className="w-3.5 h-3.5" /> {printing ? 'Generating…' : 'Print PDF'}
          </button>
          <button
            onClick={submit}
            type="button"
            disabled={submitting}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save Journal Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
