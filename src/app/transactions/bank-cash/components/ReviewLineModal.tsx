'use client';

// Koreksi 1 baris Bank Feed hasil ekstraksi (tanggal, keterangan, uang masuk/
// keluar, saldo) lalu tandai sudah direview -> confidence jadi 'high' dan
// baris ikut auto-match lagi. Baris yang sudah dicocokkan tidak bisa diubah.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { ClipboardCheck } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import { useBankFeed, type BankFeedMutation } from '../context/BankFeedContext';
import { ACTION_BTN_PRIMARY, ACTION_BTN_SECONDARY, FIELD_CLS, FIELD_LABEL_CLS, ModalShell } from './sourceUi';

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

  return (
    <ModalShell
      title="Review bank line"
      subtitle={`Compare with the original statement${line.pageNo ? ` (page ${line.pageNo} of ${line.sourceFile})` : line.sourceFile ? ` (${line.sourceFile})` : ''}, fix anything that was misread, then save.`}
      icon={<ClipboardCheck size={17} />}
      onClose={onClose}
      closeDisabled={menyimpan}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} disabled={menyimpan} className={ACTION_BTN_SECONDARY}>Cancel</button>
          <button onClick={simpan} disabled={menyimpan} className={ACTION_BTN_PRIMARY}>
            {menyimpan ? 'Saving…' : 'Save & mark reviewed'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {line.confidenceNotes.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs">
            <ConfidenceBadge value={line.confidence} />
            {line.confidenceNotes.map((n, i) => <p key={i} className="font-medium text-neutral-600">{n}</p>)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block sm:col-span-1">
            <span className={FIELD_LABEL_CLS}>Date</span>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={FIELD_CLS} />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <span className={FIELD_LABEL_CLS}>Balance after (optional)</span>
            <input inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} className={`${FIELD_CLS} tabular-nums`} />
          </label>
          <label className="col-span-2 block">
            <span className={FIELD_LABEL_CLS}>Description</span>
            <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} rows={2} className={FIELD_CLS} />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLS}>Money in</span>
            <input inputMode="decimal" value={masuk} onChange={(e) => { setMasuk(e.target.value); if (e.target.value) setKeluar(''); }} className={`${FIELD_CLS} tabular-nums`} />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLS}>Money out</span>
            <input inputMode="decimal" value={keluar} onChange={(e) => { setKeluar(e.target.value); if (e.target.value) setMasuk(''); }} className={`${FIELD_CLS} tabular-nums`} />
          </label>
        </div>
      </div>
    </ModalShell>
  );
}
