'use client';

// [BARU] Sambungkan halaman Documents ke data ASLI client aktif -- pola SAMA
// dengan halaman lain yang sudah tersambung (lihat src/lib/neracaBridge.ts /
// src/app/liabilities/lib/useLiabilitiesData.ts): hook return { loading,
// isSampleData, companyName, ... }, pemanggil (DocumentsPageClient.tsx)
// fallback ke data contoh (documentsMockData.tsx) selama isSampleData true.
//
// SUMBER BACKEND: GET /api/client/{client_id}/riwayat (lihat
// riwayatHasilClient() di agent-ai/lib/api.js, dan
// backend/main.py::api_riwayat_client) -- tabel "hasil", 1 baris per file
// yang sudah diproses AI (jenis_dokumen + nama_file + tanggal + payload
// ringkasan lengkap). ITU JUGA satu-satunya sumber "dokumen" yang benar2
// tersimpan di backend saat ini; belum ada tabel dokumen terpisah dengan
// folder/tag/status seperti di UI (folder & status di bawah ini diTURUNKAN
// dari jenis_dokumen + isi ringkasan, bukan field asli backend).
//
// KETERBATASAN (jujur, bukan tebakan pasti benar):
//  - fileFormat diTEBAK dari ekstensi nama_file, bukan field asli.
//  - status 'Processed' vs 'Needs Attention' diTURUNKAN dari ada/tidaknya
//    indikasi bermasalah di ringkasan (selisih != 0, jumlah_perlu_review > 0,
//    dst) -- backend TIDAK punya status dokumen eksplisit. Tidak ada
//    padanan 'Pending Review' / 'Archived' di data asli, jadi kedua status
//    itu tidak pernah muncul untuk dokumen real (hanya ada di data contoh).
//  - aiAnalysis.confidence TIDAK diisi (dihilangkan, bukan diisi angka
//    karangan) karena backend generik /riwayat tidak menyimpan skor
//    keyakinan per dokumen.
//  - uploadedBy TIDAK ada di tabel "hasil" (siapa yang upload) -- backend
//    hanya catat itu di audit_log (aksi terpisah), jadi kolom ini kosong
//    ('-') untuk dokumen real.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { riwayatHasilClient } from '@/app/agent-ai/lib/api';
import {
  documents as sampleDocuments,
  documentFolders as sampleDocumentFolders,
  type FinancialDocument,
  type DocumentFolder,
  type DocumentType,
  type FileFormat,
} from '@/lib/documentsMockData';

// jenis_dokumen (backend, lihat agent-ai/lib/documentTypes.js) -> { DocumentType, folder id }
// dipakai UI (folder card, filter). Pemetaan best-effort -- lihat catatan
// keterbatasan di atas.
const JENIS_KE_TIPE: Record<string, { type: DocumentType; folderId: string }> = {
  rekening_koran: { type: 'Bank Statement', folderId: 'folder-bank' },
  rekonsiliasi_bank: { type: 'Bank Statement', folderId: 'folder-bank' },
  penjualan: { type: 'Invoice', folderId: 'folder-invoices' },
  pembelian: { type: 'Invoice', folderId: 'folder-invoices' },
  buku_bantu_piutang: { type: 'Invoice', folderId: 'folder-invoices' },
  bukti_kas: { type: 'Receipt', folderId: 'folder-receipts' },
  faktur_pajak: { type: 'Tax Document', folderId: 'folder-tax' },
  bukti_potong_pajak: { type: 'Tax Document', folderId: 'folder-tax' },
  spt_masa: { type: 'Tax Document', folderId: 'folder-tax' },
  aset_tetap: { type: 'Audit Evidence', folderId: 'folder-audit' },
  ap_aging: { type: 'Financial Report', folderId: 'folder-reports' },
  penilaian_klien: { type: 'Other', folderId: 'folder-other' },
  slip_gaji: { type: 'Other', folderId: 'folder-other' },
  kartu_stok: { type: 'Other', folderId: 'folder-other' },
  absensi: { type: 'Other', folderId: 'folder-other' },
};

const FOLDER_META: { id: string; name: string; icon: string }[] = [
  { id: 'folder-all', name: 'All Documents', icon: 'FolderOpen' },
  { id: 'folder-invoices', name: 'Invoices', icon: 'FileText' },
  { id: 'folder-receipts', name: 'Receipts', icon: 'Receipt' },
  { id: 'folder-bank', name: 'Bank Statements', icon: 'Landmark' },
  { id: 'folder-tax', name: 'Tax Documents', icon: 'FileCheck' },
  { id: 'folder-contracts', name: 'Contracts', icon: 'ScrollText' },
  { id: 'folder-audit', name: 'Audit Evidence', icon: 'ShieldCheck' },
  { id: 'folder-reports', name: 'Financial Reports', icon: 'BarChart3' },
  { id: 'folder-other', name: 'Other', icon: 'Folder' },
];

function tebakFormat(namaFile: string): FileFormat {
  const ext = (namaFile.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (['xlsx', 'xls'].includes(ext)) return 'Excel';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'Image';
  if (ext === 'csv') return 'CSV';
  if (['doc', 'docx'].includes(ext)) return 'Word';
  return 'PDF';
}

function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Cari indikasi "perlu perhatian" di ringkasan hasil -- best-effort, field beda2 per jenis dokumen. */
function turunkanFlags(ringkasan: Record<string, unknown>): string[] {
  const flags: string[] = [];
  const num = (k: string) => Number(ringkasan?.[k] ?? 0);
  if (Math.abs(num('selisih')) > 0.01) flags.push(`Selisih jurnal: Rp${num('selisih').toLocaleString('id-ID')}`);
  if (num('jumlah_perlu_review_total') > 0) flags.push(`${num('jumlah_perlu_review_total')} item perlu direview`);
  if (num('jumlah_duplikat') > 0) flags.push(`${num('jumlah_duplikat')} kemungkinan duplikat`);
  if (num('jumlah_sheet_tidak_balance') > 0) flags.push(`${num('jumlah_sheet_tidak_balance')} sheet tidak balance`);
  if (num('jumlah_ambigu_masuk_keluar') > 0) flags.push(`${num('jumlah_ambigu_masuk_keluar')} baris ambigu`);
  if (num('jumlah_lewat_90_hari') > 0) flags.push(`${num('jumlah_lewat_90_hari')} invoice lewat 90 hari`);
  return flags;
}

/** Ambil 1 angka "amount" yang paling relevan dari ringkasan -- beda field per jenis dokumen. */
function turunkanAmount(ringkasan: Record<string, unknown>): number | undefined {
  const kandidat = [
    'total_penjualan', 'total_nilai_invoice', 'total_nilai_po', 'total_piutang',
    'total_ppn', 'total_pph', 'total_kurang_bayar', 'total_gaji_bruto',
    'saldo_bersih_periode', 'total_harga_perolehan', 'total_sisa_utang', 'total_debet',
  ];
  for (const k of kandidat) {
    const v = Number((ringkasan as any)?.[k]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return undefined;
}

function petakanRiwayat(riwayat: any[], companyName: string | null): FinancialDocument[] {
  return riwayat.map((h, i) => {
    const jenis: string = h.jenis_dokumen || 'other';
    const meta = JENIS_KE_TIPE[jenis] || { type: 'Other' as DocumentType, folderId: 'folder-other' };
    const namaFile: string = h.nama_file || `Dokumen ${i + 1}`;
    const ringkasan: Record<string, unknown> =
      (h.hasil && (h.hasil.ringkasan_gabungan || h.hasil.ringkasan)) || {};
    const flags = turunkanFlags(ringkasan);

    return {
      id: `hasil-${h.id ?? i}`,
      name: namaFile,
      type: meta.type,
      fileFormat: tebakFormat(namaFile),
      date: formatTanggal(h.tanggal),
      company: companyName || '-',
      relatedRecord: jenis.replace(/_/g, ' '),
      relatedRecordId: `${jenis}-${h.id ?? i}`,
      uploadedBy: '-',
      status: flags.length > 0 ? 'Needs Attention' : 'Processed',
      size: '-',
      tags: [jenis.replace(/_/g, ' ')],
      aiAnalysis: {
        amount: turunkanAmount(ringkasan),
        flags,
      },
      // dipakai internal untuk filter folder (lihat folderId di bawah, bukan field FinancialDocument asli)
      __folderId: meta.folderId,
    } as FinancialDocument & { __folderId: string };
  });
}

function susunFolders(docs: (FinancialDocument & { __folderId?: string })[]): DocumentFolder[] {
  const byId: Record<string, number> = {};
  for (const d of docs) {
    const fid = (d as any).__folderId || 'folder-other';
    byId[fid] = (byId[fid] || 0) + 1;
  }
  return FOLDER_META.map((f) => ({
    id: f.id,
    name: f.name,
    icon: f.icon,
    count: f.id === 'folder-all' ? docs.length : byId[f.id] || 0,
    size: '-',
  })).filter((f) => f.id === 'folder-all' || f.count > 0 || f.id === 'folder-contracts');
}

export interface DocumentsData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  documents: FinancialDocument[];
  documentFolders: DocumentFolder[];
}

export function useDocumentsData(): DocumentsData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<FinancialDocument[] | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeClientId) {
      setDocs(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);

    (async () => {
      try {
        const res: any = await riwayatHasilClient(activeClientId);
        if (requestIdRef.current !== requestId) return;
        const riwayat: any[] = res?.riwayat || [];
        setDocs(riwayat.length > 0 ? petakanRiwayat(riwayat, activeClientName) : []);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setDocs(null); // gagal fetch -> fallback ke sample, bukan halaman kosong
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    })();
  }, [activeClientId, activeClientName]);

  const adaDataReal = !!docs && docs.length > 0;

  return {
    loading,
    isSampleData: !adaDataReal,
    companyName: activeClientName,
    documents: adaDataReal ? (docs as FinancialDocument[]) : sampleDocuments,
    documentFolders: adaDataReal ? susunFolders(docs as FinancialDocument[]) : sampleDocumentFolders,
  };
}
