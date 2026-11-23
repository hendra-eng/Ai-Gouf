'use client';

// Upload File untuk Cash & Bank -- dipakai tombol di header (CashBankTabs), tampil di SEMUA tab.
// Alur sama dengan panel "Import Bank Statement" lama di Source Data: akun tujuan Auto-detect
// (bank mapping) -> preview -> bila pola sudah dikenal & saldo cocok langsung import, selain itu
// tampil StatementReviewModal. Bila akun tidak bisa dideteksi (BANK_ACCOUNT_REQUIRED), muncul
// dialog kecil untuk memilih akun tujuan lalu upload dilanjutkan dengan file yang sama.

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import StatementReviewModal from './StatementReviewModal';
import { useBankFeed } from '../context/BankFeedContext';
import { useActiveClient } from '@/lib/activeClient';
import { useBcAccounts, type BcPreview, type BcUploadResult } from '@/lib/bankCashStore';
import { kodeAkun } from '@/lib/accountCode';

/** Pilihan akun "Auto-detect": akun tujuan dari mapping bank (nomor rekening / judul dokumen / template). */
const AUTO = '';

export function toastImport({ data, message }: { data: BcUploadResult; message: string }) {
  const tpl = data.template
    ? data.template.action === 'used'
      ? ` Read with template “${data.template.name}”.`
      : ` Saved as extraction template “${data.template.name}”.`
    : '';
  const map = data.bank_mapping
    ? data.bank_mapping.action === 'created'
      ? ` Bank mapping saved: ${data.bank_mapping.bank_name}${data.bank_mapping.account_number ? ` ${data.bank_mapping.account_number}` : ''} → ${kodeAkun(data.bank_account_code)}.`
      : ''
    : '';
  const auto = data.auto_match;
  const arahan = auto
    ? `Auto-match: ${auto.matched} matched to invoices, ${auto.rule_matched} recorded by auto rules (saved as DRAFT, review in Journal Preview). ${auto.skipped} line(s) still need matching in the Reconciliation tab.`
      + (data.confidence?.low ? ' Lines marked “Needs review” are skipped until you review them in Source Data.' : '')
    : data.confidence?.low
      ? 'Lines marked “Needs review” are skipped by auto-match until you review them in Source Data.'
      : 'Match the imported lines in the Reconciliation tab.';
  toast.success(`${message} Posted to ${kodeAkun(data.bank_account_code)} - ${data.bank_account_name}.`, {
    description: arahan + tpl + map,
  });
  if (data.warnings.length) toast.warning(data.warnings.join(' '));
}

export function useStatementUpload() {
  const { previewFile, importFile, importing } = useBankFeed();
  const { activeClientId } = useActiveClient();
  const { accounts } = useBcAccounts(activeClientId ? String(activeClientId) : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<{ file: File; preview: BcPreview } | null>(null);
  // File yang akunnya tidak terdeteksi -> user memilih akun tujuan (fallback, bukan alur utama).
  const [pilihAkun, setPilihAkun] = useState<{ file: File; pesan: string } | null>(null);
  const [akunId, setAkunId] = useState('');

  const akunBank = useMemo(() => accounts.filter((a) => a.cash_type === 'bank' && a.is_active), [accounts]);
  const akunKas = useMemo(
    () => accounts.filter((a) => (a.cash_type === 'cash_on_hand' || a.cash_type === 'petty_cash') && a.is_active),
    [accounts],
  );

  const prosesFile = async (file: File, bankCoaId: string) => {
    try {
      const preview = await previewFile(file, bankCoaId);
      // Pola sudah dikenal (template) & seluruh saldo cocok & akun tidak bentrok dengan mapping
      // -> langsung import tanpa modal, ke akun hasil mapping / pilihan user.
      if (preview.template_matched && preview.validation.status === 'verified' && !preview.already_uploaded_on
          && !preview.bank_mapping?.conflict) {
        toastImport(await importFile(file, preview.bank_coa_id));
      } else {
        setReview({ file, preview });
      }
    } catch (e: any) {
      if (e?.code === 'BANK_ACCOUNT_REQUIRED') {
        setAkunId('');
        setPilihAkun({ file, pesan: e.message });
      } else {
        toast.error(e?.message || 'Failed to import the bank statement.');
      }
    }
  };

  const openPicker = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    inputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    if (file) await prosesFile(file, AUTO);
  };

  const ui = (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" disabled={importing} onChange={onFileChange} />

      {pilihAkun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setPilihAkun(null)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-300 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-900">Select target account</h3>
            <p className="mt-1 text-xs font-medium text-neutral-500">{pilihAkun.pesan}</p>
            <p className="mt-2 truncate text-xs font-semibold text-neutral-800">{pilihAkun.file.name}</p>
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
              <button type="button" onClick={() => setPilihAkun(null)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50">Cancel</button>
              <button
                type="button"
                disabled={!akunId || importing}
                onClick={() => { const f = pilihAkun.file; setPilihAkun(null); void prosesFile(f, akunId); }}
                className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {review && (
        <StatementReviewModal
          file={review.file}
          bankCoaId={review.preview.bank_coa_id}
          bankLabel={`${kodeAkun(review.preview.bank_account_code)} - ${review.preview.bank_account_name}`}
          initial={review.preview}
          onClose={() => setReview(null)}
          onImported={(hasil) => {
            setReview(null);
            toastImport(hasil);
          }}
        />
      )}
    </>
  );

  return { openPicker, importing, canUpload: !!activeClientId, ui };
}