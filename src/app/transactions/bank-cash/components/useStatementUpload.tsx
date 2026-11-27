'use client';

// Upload File untuk Cash & Bank -- dipakai tombol di header (CashBankTabs), tampil di SEMUA tab.
// Alur: akun tujuan Auto-detect (bank mapping) -> preview -> bila pola sudah dikenal & saldo cocok
// langsung import, selain itu tampil StatementReviewModal. Bila akun tidak bisa dideteksi
// (BANK_ACCOUNT_REQUIRED), muncul dialog kecil untuk memilih akun tujuan.
//
// [MULTI-FILE + TAHAN PINDAH HALAMAN] Bisa memilih banyak file sekaligus. File diproses berurutan oleh
// engine global (lib/uploadBatch.ts) -- BUKAN oleh state komponen ini -- jadi progres di tombol
// ("Uploading 2/5...") tetap benar walau user pindah tab / halaman, dan batch dilanjutkan otomatis
// setelah refresh (lihat <UploadBatchResumer /> di AppLayout). File yang butuh review / pilih akun
// masuk ANTRIAN global (bank-cash/lib/bankUploadBatch.ts) dan dibuka satu per satu setelah batch selesai.

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import StatementReviewModal from './StatementReviewModal';
import { useBankFeed } from '../context/BankFeedContext';
import { useActiveClient } from '@/lib/activeClient';
import { useBcAccounts } from '@/lib/bankCashStore';
import { kodeAkun } from '@/lib/accountCode';
import { mulaiBatch, useProgresBatch } from '@/lib/uploadBatch';
import {
  buatHandlerBank,
  cobaFileBank,
  gantiKepala,
  lanjutAntrian,
  toastImport,
  useAntrianReview,
  type ItemAntrian,
} from '../lib/bankUploadBatch';

export { toastImport };

export function useStatementUpload() {
  const { importing } = useBankFeed();
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { accounts } = useBcAccounts(clientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [akunId, setAkunId] = useState('');
  const [lanjutBusy, setLanjutBusy] = useState(false);

  // Progres batch & antrian review dibaca dari store global -> sama persis walau komponen ini di-mount ulang.
  const progres = useProgresBatch('bankcash', clientId);
  const antrian = useAntrianReview(clientId);
  const sibuk = importing || !!progres || lanjutBusy;

  // Modal baru muncul setelah seluruh file selesai dibaca (tidak menimpa layar selagi batch berjalan).
  const aktif: ItemAntrian | null = progres ? null : antrian[0] ?? null;
  const review = aktif?.jenis === 'review' ? aktif : null;
  const pilihAkun = aktif?.jenis === 'akun' ? aktif : null;
  const sisaAntrian = antrian.length;

  const akunBank = useMemo(() => accounts.filter((a) => a.cash_type === 'bank' && a.is_active), [accounts]);
  const akunKas = useMemo(
    () => accounts.filter((a) => (a.cash_type === 'cash_on_hand' || a.cash_type === 'petty_cash') && a.is_active),
    [accounts],
  );

  /** Lanjutan dari dialog "Select target account" untuk item pertama antrian. */
  const lanjutDenganAkun = async (item: Extract<ItemAntrian, { jenis: 'akun' }>, bankCoaId: string) => {
    if (!clientId) return;
    setLanjutBusy(true);
    try {
      const r = await cobaFileBank(clientId, item.file, bankCoaId);
      if (r.status === 'imported') {
        toastImport(r.hasil);
        lanjutAntrian(clientId);
      } else {
        gantiKepala(clientId, r.item); // mis. jadi modal review untuk file yang sama
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to import the bank statement.');
      lanjutAntrian(clientId);
    } finally {
      setLanjutBusy(false);
    }
  };

  const openPicker = () => {
    if (!clientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    inputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !clientId) return;
    mulaiBatch('bankcash', clientId, files, buatHandlerBank(clientId));
  };

  const ui = (
    <>
      <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" className="hidden" disabled={sibuk} onChange={onFileChange} />

      {pilihAkun && clientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => lanjutAntrian(clientId)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-300 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-900">Select target account</h3>
            <p className="mt-1 text-xs font-medium text-neutral-500">{pilihAkun.pesan}</p>
            <p className="mt-2 truncate text-xs font-semibold text-neutral-800">{pilihAkun.file.name}</p>
            {sisaAntrian > 1 && (
              <p className="mt-1 text-xs font-medium text-neutral-500">{sisaAntrian - 1} more file(s) waiting after this one.</p>
            )}
            <select
              value={akunId}
              onChange={(e) => setAkunId(e.target.value)}
              className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
              aria-label="Target account"
            >
              <option value="">Select account...</option>
              {akunBank.length > 0 && (
                <optgroup label="Bank accounts">
                  {akunBank.map((a) => <option key={a.id} value={a.id}>{kodeAkun(a.code)} - {a.name}</option>)}
                </optgroup>
              )}
              {akunKas.length > 0 && (
                <optgroup label="Cash accounts">
                  {akunKas.map((a) => <option key={a.id} value={a.id}>{kodeAkun(a.code)} - {a.name}</option>)}
                </optgroup>
              )}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => lanjutAntrian(clientId)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50">{sisaAntrian > 1 ? 'Skip' : 'Cancel'}</button>
              <button
                type="button"
                disabled={!akunId || sibuk}
                onClick={() => { const id = akunId; setAkunId(''); void lanjutDenganAkun(pilihAkun, id); }}
                className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {review && clientId && (
        <StatementReviewModal
          // key = file ini, supaya state modal (koreksi kolom dll) ter-reset saat pindah ke file berikutnya.
          key={`${review.file.name}-${review.file.size}-${review.file.lastModified}`}
          file={review.file}
          bankCoaId={review.preview.bank_coa_id}
          bankLabel={`${kodeAkun(review.preview.bank_account_code)} - ${review.preview.bank_account_name}${sisaAntrian > 1 ? ` · ${sisaAntrian - 1} more file(s) waiting` : ''}`}
          initial={review.preview}
          onClose={() => lanjutAntrian(clientId)}
          onImported={(hasil) => {
            lanjutAntrian(clientId);
            toastImport(hasil);
          }}
        />
      )}
    </>
  );

  const progressLabel = progres ? `Uploading ${progres.berhasil}/${progres.total}...` : null;

  return { openPicker, importing: sibuk, progressLabel, canUpload: !!clientId, ui };
}
