'use client';

// [DIUBAH] Sebelumnya halaman Documents menebak-nebak data (folder/status/
// tag) dari tabel generik "hasil" karena belum ada tabel khusus. Sekarang
// sudah ada tabel khusus "7_Management"."Management_Documents_Documents"
// (dibuat manual oleh user lewat Supabase SQL Editor) yang field-nya 1:1
// dengan tipe FinancialDocument -- lihat src/app/documents/lib/
// documentsDbBridge.ts untuk pemetaan raw -> FinancialDocument, dan
// backend/db_client.py::ambil_data_documents + main.py
// GET /api/client/{id}/documents untuk sisi backend.
//
// Hook ini dipertahankan (bukan diganti langsung di DocumentsPageClient.tsx)
// supaya pemanggil tidak perlu berubah: masih return
// { loading, isSampleData, companyName, documents, documentFolders },
// fallback ke data contoh (documentsMockData.tsx) selama isSampleData true
// -- pola SAMA dengan halaman lain (lihat useLiabilitiesData.ts dst).

import { useDocumentsDbData } from './documentsDbBridge';
import {
  documents as sampleDocuments,
  documentFolders as sampleDocumentFolders,
} from '@/lib/documentsMockData';

export type {
  DocumentFolder,
  FinancialDocument,
  DocumentType,
  DocumentStatus,
  FileFormat,
} from '@/lib/documentsMockData';

export interface DocumentsData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  documents: ReturnType<typeof useDocumentsDbData>['documents'];
  documentFolders: ReturnType<typeof useDocumentsDbData>['documentFolders'];
}

export function useDocumentsData(): DocumentsData {
  const { loading, isSampleData, companyName, documents, documentFolders } = useDocumentsDbData();

  return {
    loading,
    isSampleData,
    companyName,
    documents: isSampleData ? sampleDocuments : documents,
    documentFolders: isSampleData ? sampleDocumentFolders : documentFolders,
  };
}