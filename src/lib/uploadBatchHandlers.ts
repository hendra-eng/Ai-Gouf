// Handler upload batch untuk Sales & Purchase (dipakai mulaiBatch() di header kedua halaman dan
// oleh <UploadBatchResumer /> untuk melanjutkan batch setelah refresh). Isi per-file sama persis
// dengan loop lama di SalesClient / PurchaseTabs -- hanya dipindah keluar dari komponen supaya
// tetap jalan walau user pindah tab / halaman.

import { toast } from 'sonner';
import { uploadSalesSourceFile } from '@/lib/salesStore';
import { uploadPurchaseSourceFile } from '@/lib/purchaseStore';
import type { BatchHandler, HasilFile, RingkasanBatch } from '@/lib/uploadBatch';

function peringatanTerputus(r: RingkasanBatch, pesan: (nama: string) => string) {
  if (r.terputus.length) toast.warning(r.terputus.map(pesan).join('\n'));
}

export function buatHandlerSales(clientId: string, t: (text: string) => string): BatchHandler {
  return {
    // Upload Sales belum tentu ditolak backend kalau dikirim 2x -> file yang terputus tidak diulang otomatis.
    ulangiYangTerputus: false,
    proses: async (file): Promise<HasilFile> => {
      try {
        const hasil = await uploadSalesSourceFile(file, clientId);
        if (hasil.template_matched) {
          toast.success(t('File berhasil diekstrak'), {
            description: `${file.name}: ${hasil.rows_extracted} ${t('baris ditemukan.')}`,
          });
          return { ok: true, stats: { berhasil: 1 } };
        }
        toast.info(t('Belum ada template yang cocok'), {
          description: `${file.name} ${t('ditandai "Butuh Review" -- perlu template baru untuk klien/format ini.')}`,
        });
        return { ok: false, stats: { butuhReview: 1 } };
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : t('Gagal mengunggah file')}`);
        return { ok: false, stats: { gagal: 1 } };
      }
    },
    selesai: (r) => {
      if (r.total > 1) {
        toast.message(t('Upload selesai'), {
          description: `${r.stats.berhasil ?? 0} ${t('berhasil diekstrak')}, ${r.stats.butuhReview ?? 0} ${t('butuh review')}.`,
        });
      }
      peringatanTerputus(r, (nama) => `${nama}: upload terputus karena halaman di-refresh. Cek di Source Data, upload ulang kalau belum ada.`);
    },
  };
}

export function buatHandlerPurchase(clientId: string): BatchHandler {
  return {
    ulangiYangTerputus: false,
    proses: async (file): Promise<HasilFile> => {
      try {
        const hasil = await uploadPurchaseSourceFile(file, clientId);
        if (!hasil.template_matched) {
          toast.info('No purchase template matches', {
            description: `${file.name}: this file format has not been set up for the active company yet.`,
          });
          return { ok: false, stats: { tidakCocok: 1 } };
        }
        const tersimpan = hasil.staged ?? hasil.created;
        const dilewati = hasil.transactions.filter((r) => !r.ok).length;
        toast.success('File imported', {
          description: `${file.name}: ${tersimpan} of ${hasil.transactions_detected} purchase transactions saved to Source Data${dilewati ? ` (${dilewati} skipped)` : ''}.`,
        });
        return { ok: true, stats: { berhasil: 1, totalCreated: tersimpan, totalDetected: hasil.transactions_detected } };
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : 'Failed to upload file'}`);
        return { ok: false, stats: { gagal: 1 } };
      }
    },
    selesai: (r) => {
      if (r.total > 1) {
        toast.message('Upload finished', {
          description: `${r.stats.berhasil ?? 0} imported (${r.stats.totalCreated ?? 0} of ${r.stats.totalDetected ?? 0} transactions), ${r.stats.tidakCocok ?? 0} not recognized.`,
        });
      }
      peringatanTerputus(r, (nama) => `${nama}: upload was interrupted by a page refresh. Check Source Data and upload it again if it is missing.`);
    },
  };
}
