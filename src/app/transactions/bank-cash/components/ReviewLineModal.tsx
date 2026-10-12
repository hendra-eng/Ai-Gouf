'use client';

// Koreksi 1 baris Bank Feed hasil ekstraksi (tanggal, keterangan, uang masuk/
// keluar, saldo) lalu tandai sudah direview -> confidence jadi 'high' dan
// baris ikut auto-match lagi. Baris yang sudah dicocokkan tidak bisa diubah.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { XMarkIcon } from '@heroicons/react/24/outline';
import ConfidenceBadge from './ConfidenceBadge';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';

export default function ReviewLineModal({ line, onClose }: { line: BankFeedMutation; onClose: () => void }) {
  const { reviewLine } = useBankFeed();
  const [tanggal, setTanggal] = useState(line.date);
  const [keterangan, setKeterangan] = useState(line.description);
  const [masuk, setMasuk] = useState(line.credit ? String(line.credit) : '');
  const [keluar, setKeluar] = useState(line.debit ? String(line.debit) : '');
  const [saldo, setSaldo] = useState(line.balanceAfter === null ? '' : String(line.balanceAfter));
  const [menyimpan, setMenyimpan] = useState(false);

  const simpan = async () => {
    const credit = Number(masuk || 0);
    const debit = Number(keluar || 0);
    if (Number.isNaN(credit) || Number.isNaN(debit) || credit < 0 || debit < 0) {
      toast.error('Amounts must be positive numbers.');
      return;
    }
    if ((credit > 0) === (debit > 0)) {
      toast.error('Fill in either money in or money out (one of them).');
      return;
    }
    if (saldo !== '' && Number.isNaN(Number(saldo))) {
      toast.error('Balance must be a number.');
      return;
    }
    setMenyimpan(true);
    try {
      await reviewLine(line.id, {
        mutation_date: tanggal,
        description: keterangan,
        debit,
        credit,
        balance_after: saldo === '' ? undefined : Number(saldo),
      });
      toast.success('Bank line reviewed.');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the review.');
    } finally {
      setMenyimpan(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Review bank line</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Compare with the original statement{line.pageNo ? ` (page ${line.pageNo} of ${line.sourceFile})` : line.sourceFile ? ` (${line.sourceFile})` : ''}, fix anything that was misread, then save.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        {line.confidenceNotes.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
            <ConfidenceBadge value={line.confidence} />
            {line.confidenceNotes.map((n, i) => <p key={i} className="text-muted-foreground">{n}</p>)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-[11px] text-muted-foreground">Date</span>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={input} />
          </label>
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-[11px] text-muted-foreground">Balance after (optional)</span>
            <input inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} className={`${input} font-mono`} />
          </label>
          <label className="block col-span-2">
            <span className="text-[11px] text-muted-foreground">Description</span>
            <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} rows={2} className={input} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Money in</span>
            <input inputMode="decimal" value={masuk} onChange={(e) => { setMasuk(e.target.value); if (e.target.value) setKeluar(''); }} className={`${input} font-mono`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Money out</span>
            <input inputMode="decimal" value={keluar} onChange={(e) => { setKeluar(e.target.value); if (e.target.value) setMasuk(''); }} className={`${input} font-mono`} />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={menyimpan} className="btn-secondary text-xs py-1.5 disabled:opacity-50">Cancel</button>
          <button onClick={simpan} disabled={menyimpan} className="btn-primary text-xs py-1.5 disabled:opacity-50">
            {menyimpan ? 'Saving…' : 'Save & mark reviewed'}
          </button>
        </div>
      </div>
    </div>
  );
}
