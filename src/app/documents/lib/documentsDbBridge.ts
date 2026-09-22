// [BARU] ─── JEMBATAN DOCUMENTS (SUPABASE) → HALAMAN DOCUMENTS ────────────
// Satu-satunya tempat yang mengambil data mentah tabel Supabase
// "7_Management"."Management_Documents_Documents" (lihat
// GET /api/client/{id}/documents di main.py) dan memetakannya ke tipe
// FinancialDocument/DocumentFolder yang sudah dipakai
// DocumentsPageClient.tsx. Sebelum modul ini ada, halaman Documents
// menebak-nebak field (folder/status/tag) dari tabel generik "hasil" --
// lihat riwayat di git untuk versi lama useDocumentsData.ts.
//
// Field bebas (category/status/file_format di database cuma varchar
// dengan CHECK constraint, bukan enum) dinormalisasi lewat matchEnum() --
// toleran beda kapitalisasi/spasi/underscore, jatuh ke nilai default
// kalau tidak ada yang cocok, supaya satu baris tidak bikin seluruh
// daftar gagal tampil. Pola sama dengan
// src/app/transactions/purchase/purchasebridge.ts.
'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { documentsDataClient, tambahDokumen, ubahStatusDokumen } from '@/app/agent-ai/lib/api';
import type {
  FinancialDocument,
  DocumentFolder,
  DocumentType,
  DocumentStatus,
  FileFormat,
} from '@/lib/documentsMockData';

// ─── Bentuk mentah dari backend (lihat db_client.py::ambil_data_documents) ──
interface RawDocument {
  id: string;
  name: string;
  category: string | null;
  file_format: string | null;
  file_size: string | null;
  storage_url: string | null;
  uploaded_by: string | null;
  status: string | null;
  tags: string | null; // 1 string dipisah koma di database, bukan array
  related_record: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ─── Helper umum (sama seperti purchasebridge.ts) ──────────────────────────
function matchEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(raw);
  const found = allowed.find((a) => norm(a) === target);
  return found ?? fallback;
}

const DOCUMENT_TYPES: DocumentType[] = ['Invoice', 'Receipt', 'Bank Statement', 'Tax Document', 'Contract', 'Audit Evidence', 'Financial Report', 'Other'];
const DOCUMENT_STATUSES: DocumentStatus[] = ['Processed', 'Pending Review', 'Needs Attention', 'Archived'];
const FILE_FORMATS: FileFormat[] = ['PDF', 'Excel', 'Image', 'CSV', 'Word'];

// DocumentType -> folder id dipakai UI (folder card di sidebar kiri).
const TIPE_KE_FOLDER: Record<DocumentType, string> = {
  Invoice: 'folder-invoices',
  Receipt: 'folder-receipts',
  'Bank Statement': 'folder-bank',
  'Tax Document': 'folder-tax',
  Contract: 'folder-contracts',
  'Audit Evidence': 'folder-audit',
  'Financial Report': 'folder-reports',
  Other: 'folder-other',
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

function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

// ─── Helper tulis (upload/status) -- dipakai uploadDocuments() di bawah ────
function tebakFileFormat(fileName: string): FileFormat {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'PDF';
  if (['xlsx', 'xls'].includes(ext)) return 'Excel';
  if (ext === 'csv') return 'CSV';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'Image';
  if (['doc', 'docx'].includes(ext)) return 'Word';
  return 'PDF';
}

function formatUkuranFile(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function mapDocuments(raw: RawDocument[], companyName: string | null): (FinancialDocument & { __folderId: string })[] {
  return raw.map((d) => {
    const type = matchEnum(d.category, DOCUMENT_TYPES, 'Other');
    return {
      id: d.id,
      name: d.name || '-',
      type,
      fileFormat: matchEnum(d.file_format, FILE_FORMATS, 'PDF'),
      date: formatTanggal(d.created_at),
      company: companyName || '-',
      relatedRecord: d.related_record || '-',
      relatedRecordId: d.related_record || d.id,
      uploadedBy: d.uploaded_by || '-',
      status: matchEnum(d.status, DOCUMENT_STATUSES, 'Pending Review'),
      size: d.file_size || '-',
      tags: splitTags(d.tags),
      aiAnalysis: undefined,
      __folderId: TIPE_KE_FOLDER[type],
    };
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
  })).filter((f) => f.id === 'folder-all' || f.count > 0);
}

export interface DocumentsBridgeData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  documents: FinancialDocument[];
  documentFolders: DocumentFolder[];
  activeClientId: string | number | null;
  /** Ambil ulang data dari Supabase -- panggil setelah upload/mutasi
   * dokumen berhasil supaya daftar langsung menampilkan data terbaru. */
  refetch: () => void;
  /** [BARU] Catat metadata 1+ file baru (tombol "Upload"). Backend:
   * POST /api/v1/management/documents -> dbc.tambah_dokumen(). File FISIK
   * tidak diunggah lewat sini (belum ada integrasi storage) -- hanya
   * metadata (nama, format tebakan dari ekstensi, ukuran) yang tercatat.
   * `category` opsional, dipakai sebagai kategori semua file yang
   * diunggah kalau diisi (mis. folder aktif saat upload). */
  uploadDocuments: (files: File[], category?: DocumentType) => Promise<void>;
  /** [BARU] Ubah status satu dokumen. Backend:
   * PATCH /api/v1/management/documents/{id}/status -> dbc.ubah_status_dokumen(). */
  changeDocumentStatus: (documentId: string, status: DocumentStatus) => Promise<void>;
}

async function fetchDocumentsData(activeClientId: string | number, companyName: string | null) {
  const res = (await documentsDataClient(activeClientId)) as { documents: RawDocument[] };
  const documents = mapDocuments(res.documents || [], companyName);
  return {
    documents,
    documentFolders: susunFolders(documents),
  };
}

/**
 * Hook utama halaman Documents -- panggil ini sebagai pengganti
 * useDocumentsData lama. Otomatis mengikuti client aktif (Topbar "Switch
 * Company") dan di-cache per activeClientId lewat TanStack Query, sama
 * pola dengan usePurchaseData.
 */
export function useDocumentsDbData(): DocumentsBridgeData {
  const { activeClientId, activeClientName, hydrated } = useActiveClient();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['documents', activeClientId],
    queryFn: () => fetchDocumentsData(activeClientId as string | number, activeClientName),
    enabled: hydrated && !!activeClientId,
  });

  const refetch = useCallback(() => {
    if (!activeClientId) return;
    queryClient.invalidateQueries({ queryKey: ['documents', activeClientId] });
  }, [queryClient, activeClientId]);

  const uploadDocuments = useCallback(
    async (files: File[], category?: DocumentType) => {
      if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
      for (const file of files) {
        await tambahDokumen(activeClientId, {
          name: file.name,
          category,
          fileFormat: tebakFileFormat(file.name),
          fileSize: formatUkuranFile(file.size),
        });
      }
      refetch();
    },
    [activeClientId, refetch]
  );

  const changeDocumentStatus = useCallback(
    async (documentId: string, status: DocumentStatus) => {
      if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
      await ubahStatusDokumen(activeClientId, documentId, status);
      refetch();
    },
    [activeClientId, refetch]
  );

  const adaDataReal = !!data && data.documents.length > 0;
  const loading = !hydrated || isLoading;

  if (!data) {
    return {
      loading,
      isSampleData: true,
      companyName: activeClientName,
      documents: [],
      documentFolders: [],
      activeClientId: activeClientId ?? null,
      refetch,
      uploadDocuments,
      changeDocumentStatus,
    };
  }

  return {
    ...data,
    loading,
    isSampleData: !adaDataReal,
    companyName: activeClientName,
    activeClientId: activeClientId ?? null,
    refetch,
    uploadDocuments,
    changeDocumentStatus,
  };
}