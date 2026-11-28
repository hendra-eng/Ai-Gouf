// Upload rekening koran Cash & Bank -- bagian yang TIDAK terikat ke komponen React:
//   - toastImport()           : toast hasil import (dipindah dari useStatementUpload.tsx)
//   - cobaFileBank()          : preview -> import langsung bila pola dikenal & saldo cocok, selain itu masuk antrian
//   - buatHandlerBank()       : handler untuk engine batch (lib/uploadBatch.ts)
//   - antrian review          : file yang butuh review / pilih akun tujuan. Disimpan global per client
//                               (+ IndexedDB), jadi tidak hilang saat pindah tab/halaman maupun refresh.

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { previewBankStatement, uploadBankStatement, type BcPreview, type BcUploadResult } from '@/lib/bankCashStore';
import { kodeAkun } from '@/lib/accountCode';
import { STORE_REVIEW, idbAmbilSemua, idbHapus, idbSimpan, metaDari, pulihkanFile, type BatchHandler, type CatatanBatch, type HasilFile, type MetaFile } from '@/lib/uploadBatch';

/** Pilihan akun "Auto-detect": akun tujuan dari mapping bank (nomor rekening / judul dokumen / template). */
export const AUTO = '';

/**
 * true  = SETIAP file yang diupload selalu menanyakan akun tujuan (dropdown "Select target account"),
 *         tidak ada Auto-detect. Berguna kalau beberapa rekening memakai format file yang sama
 *         (mis. dua rekening BRI dengan CSV core banking identik) sehingga tebakan otomatis bisa salah.
 * false = perilaku lama: Auto-detect via bank mapping, dialog akun hanya muncul bila akun tak terdeteksi.
 */
export const SELALU_PILIH_AKUN = true;

export type HasilImport = { data: BcUploadResult; message: string };

export function toastImport({ data, message }: HasilImport) {
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

// ───────────────────────── Antrian review (global per client) ─────────────────────────

export type ItemAntrian =
  | { jenis: 'review'; file: File; preview: BcPreview }
  | { jenis: 'akun'; file: File; pesan: string };

const KOSONG: ItemAntrian[] = [];
const antrianPerKlien = new Map<string, ItemAntrian[]>();
const listeners = new Set<() => void>();

function setAntrian(clientId: string, items: ItemAntrian[]) {
  if (items.length) {
    antrianPerKlien.set(clientId, items);
    void idbSimpan(STORE_REVIEW, { clientId, items, meta: items.map((i) => metaDari(i.file)) });
  } else {
    antrianPerKlien.delete(clientId);
    void idbHapus(STORE_REVIEW, clientId);
  }
  listeners.forEach((l) => l());
}

export const tambahAntrian = (clientId: string, items: ItemAntrian[]) => setAntrian(clientId, [...(antrianPerKlien.get(clientId) ?? KOSONG), ...items]);
/** Item pertama selesai (diimport / dibatalkan / dilewati) -> tampilkan yang berikutnya. */
export const lanjutAntrian = (clientId: string) => setAntrian(clientId, (antrianPerKlien.get(clientId) ?? KOSONG).slice(1));
/** Ganti item pertama (mis. file yang tadinya minta pilih akun kini jadi modal review). */
export const gantiKepala = (clientId: string, item: ItemAntrian) => setAntrian(clientId, [item, ...(antrianPerKlien.get(clientId) ?? KOSONG).slice(1)]);

export function useAntrianReview(clientId: string | null): ItemAntrian[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => (clientId ? antrianPerKlien.get(clientId) ?? KOSONG : KOSONG),
    () => KOSONG,
  );
}

/** Muat antrian review yang tersimpan (setelah refresh). Dipanggil <UploadBatchResumer />. */
export async function pulihkanAntrianReview() {
  const tersimpan = await idbAmbilSemua<{ clientId: string; items: ItemAntrian[]; meta?: MetaFile[] }>(STORE_REVIEW);
  let berubah = false;
  for (const row of tersimpan) {
    if (antrianPerKlien.has(row.clientId) || !row.items?.length) continue;
    antrianPerKlien.set(row.clientId, row.items.map((it, i) => ({ ...it, file: pulihkanFile(it.file, row.meta?.[i]) })));
    berubah = true;
  }
  if (berubah) listeners.forEach((l) => l());
}

// ───────────────────────── Baca & import 1 file ─────────────────────────

export type HasilCoba = { status: 'imported'; hasil: HasilImport } | { status: 'antri'; item: ItemAntrian };

/**
 * Pola sudah dikenal (template) & seluruh saldo cocok & akun tidak bentrok dengan mapping -> langsung
 * import tanpa modal, ke akun hasil mapping / pilihan user. Selain itu dikembalikan sebagai item
 * antrian. Error lain dilempar ke pemanggil.
 */
export async function cobaFileBank(clientId: string, file: File, bankCoaId: string): Promise<HasilCoba> {
  try {
    const preview = (await previewBankStatement(clientId, bankCoaId, file)).data;
    if (preview.template_matched && preview.validation.status === 'verified' && !preview.already_uploaded_on
        && !preview.bank_mapping?.conflict) {
      return { status: 'imported', hasil: await uploadBankStatement(clientId, preview.bank_coa_id, file) };
    }
    return { status: 'antri', item: { jenis: 'review', file, preview } };
  } catch (e: any) {
    if (e?.code === 'BANK_ACCOUNT_REQUIRED') return { status: 'antri', item: { jenis: 'akun', file, pesan: e.message } };
    throw e;
  }
}

// ───────────────────────── Handler batch ─────────────────────────

export function buatHandlerBank(clientId: string): BatchHandler {
  return {
    // Rekening koran yang sama dideteksi backend (already_uploaded_on) dan masuk ke modal review,
    // jadi aman mengirim ulang file yang terputus saat refresh.
    ulangiYangTerputus: !SELALU_PILIH_AKUN,
    proses: async (file, { total }): Promise<HasilFile> => {
      if (SELALU_PILIH_AKUN) {
        // Tanpa Auto-detect: file masuk antrian, dialog pilih akun tampil satu per satu setelah semua file dipilih.
        tambahAntrian(clientId, [{ jenis: 'akun', file, pesan: 'Choose the bank / cash account this file belongs to.' }]);
        return { ok: false, stats: { antri: 1 } };
      }
      try {
        const r = await cobaFileBank(clientId, file, AUTO);
        if (r.status === 'imported') {
          if (total === 1) toastImport(r.hasil); // 1 file: toast lengkap seperti sebelumnya
          const am = r.hasil.data.auto_match;
          const catatan: CatatanBatch[] = (r.hasil.data.warnings ?? []).map((teks) => ({ jenis: 'peringatan', teks }));
          return { ok: true, stats: { matched: am?.matched ?? 0, byRule: am?.rule_matched ?? 0, skipped: am?.skipped ?? 0 }, catatan };
        }
        tambahAntrian(clientId, [r.item]); // modal review/pilih akun tampil setelah batch selesai
        return { ok: false, stats: { antri: 1 } };
      } catch (e: any) {
        const pesan = e?.message || 'Failed to import the bank statement.';
        if (total === 1) toast.error(pesan);
        return { ok: false, stats: { gagal: 1 }, catatan: [{ jenis: 'gagal', teks: `${file.name}: ${pesan}` }] };
      }
    },
    selesai: (r) => {
      if (r.total > 1) {
        const baris: string[] = [];
        if (r.berhasil) baris.push(`Auto-match: ${r.stats.matched ?? 0} matched to invoices, ${r.stats.byRule ?? 0} recorded by auto rules (DRAFT), ${r.stats.skipped ?? 0} line(s) still need matching in the Reconciliation tab.`);
        if (r.stats.antri) baris.push(SELALU_PILIH_AKUN ? `${r.stats.antri} file(s) are waiting for you to choose the target account — they will open one by one.` : `${r.stats.antri} file(s) need your review — they will open one by one.`);
        const gagal = r.catatan.filter((c) => c.jenis === 'gagal').map((c) => c.teks);
        baris.push(...gagal);
        const judul = `${r.berhasil} of ${r.total} file(s) imported.`;
        if (gagal.length) toast.error(judul, { description: baris.join('\n') });
        else if (r.berhasil) toast.success(judul, { description: baris.join('\n') });
        else toast.info(`${r.total} file(s) read.`, { description: baris.join('\n') });
        const peringatan = Array.from(new Set(r.catatan.filter((c) => c.jenis === 'peringatan').map((c) => c.teks)));
        if (peringatan.length) toast.warning(peringatan.join(' '));
      }
    },
  };
}