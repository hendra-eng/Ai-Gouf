'use client';

// State Bank Feed bersama untuk semua tab Cash & Bank (dipasang di layout.tsx).
// Sumbernya tabel financial_transaction_bank_cash_statements/_mutations lewat
// src/lib/bankCashStore.ts -- upload rekening koran tersimpan permanen di
// database, status cocok/belum cocok juga dari backend (bukan sesi browser).
// Satu provider = satu kali fetch dipakai bersama Overview, Bank Feed,
// Reconciliation & Exceptions; ikut dimuat ulang tiap BANK_CASH_EVENT.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import {
  deleteBankStatement,
  deleteMutation,
  ignoreMutation,
  previewBankStatement,
  restoreMutation,
  reviewMutation,
  uploadBankStatement,
  useBcMutations,
  useBcStatements,
  type BcMappingRules,
  type BcMutation,
  type BcMutationTx,
  type BcPreview,
  type BcReviewInput,
  type BcStatement,
  type BcUploadResult,
  type Confidence,
  type MutationStatus,
} from '@/lib/bankCashStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

export type MatchStatus = MutationStatus;

export interface BankFeedMutation {
  id: string;
  statementId: string;
  bankCoaId: string;
  date: string;
  description: string;
  /** Label akun bank "<kode> - <nama>". */
  bankAccount: string;
  /** Uang keluar dari rekening (mutasi debet bank). */
  debit: number;
  /** Uang masuk ke rekening (mutasi kredit bank). */
  credit: number;
  balanceAfter: number | null;
  status: MatchStatus;
  ignoreReason: string | null;
  /** Transaksi Cash & Bank hasil pencocokan (null kalau belum cocok). */
  transaction: BcMutationTx | null;
  sourceFile: string;
  /** Keyakinan ekstraksi: low = wajib review (dilewati auto-match); null = baris lama. */
  confidence: Confidence | null;
  confidenceNotes: string[];
  pageNo: number | null;
  reviewedBy: string | null;
}

function keMutasi(m: BcMutation): BankFeedMutation {
  return {
    id: m.id,
    statementId: m.statement_id,
    bankCoaId: m.bank_coa_id,
    date: m.date,
    description: m.description || '',
    bankAccount: m.bank_account_code ? `${kodeAkun(m.bank_account_code)} - ${m.bank_account_name ?? ''}` : '',
    debit: m.debit,
    credit: m.credit,
    balanceAfter: m.balance_after,
    status: m.status,
    ignoreReason: m.ignore_reason,
    transaction: m.transaction,
    sourceFile: m.file_name || '',
    confidence: m.confidence,
    confidenceNotes: m.confidence_notes || [],
    pageNo: m.page_no,
    reviewedBy: m.reviewed_by_name,
  };
}

export interface ImportOptions {
  /** Koreksi peran kolom dari modal review (kosong = deteksi otomatis / template). */
  mappingRules?: BcMappingRules | null;
  saveTemplate?: boolean;
  /** Catat mapping bank baru kalau rekening/bank file ini belum ter-mapping (default true). */
  saveMapping?: boolean;
}

interface BankFeedContextType {
  /** Semua mutasi klien aktif (terbaru dulu), termasuk yang diabaikan. */
  mutations: BankFeedMutation[];
  statements: BcStatement[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** true selagi upload + ekstraksi rekening koran berjalan. */
  importing: boolean;
  /** Baca rekening koran tanpa menyimpan (kolom, template, validasi, confidence per baris). */
  previewFile: (file: File, bankCoaId: string, mappingRules?: BcMappingRules | null) => Promise<BcPreview>;
  /** Upload rekening koran ke 1 akun bank (id COA). Melempar Error kalau ditolak. */
  importFile: (file: File, bankCoaId: string, opsi?: ImportOptions) => Promise<{ data: BcUploadResult; message: string }>;
  /** Koreksi baris hasil ekstraksi & tandai sudah direview (confidence -> high). */
  reviewLine: (id: string, input?: BcReviewInput) => Promise<void>;
  removeMutation: (id: string) => Promise<void>;
  ignoreMutation: (id: string, reason?: string | null) => Promise<void>;
  restoreMutation: (id: string) => Promise<void>;
  removeStatement: (id: string) => Promise<void>;
}

const BankFeedContext = createContext<BankFeedContextType | undefined>(undefined);

function wajibKlien(id: string | null): string {
  if (!id) throw new Error('No active company — select one in the top bar first.');
  return id;
}

export function BankFeedProvider({ children }: { children: React.ReactNode }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const mu = useBcMutations(clientId);
  const st = useBcStatements(clientId);
  const [importing, setImporting] = useState(false);

  const mutations = useMemo(() => mu.mutations.map(keMutasi), [mu.mutations]);

  const refetch = useCallback(() => {
    mu.refresh();
    st.refresh();
  }, [mu.refresh, st.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewFile = useCallback(async (file: File, bankCoaId: string, mappingRules?: BcMappingRules | null) => {
    const cid = wajibKlien(clientId);
    setImporting(true);
    try {
      return (await previewBankStatement(cid, bankCoaId, file, mappingRules)).data;
    } finally {
      setImporting(false);
    }
  }, [clientId]);

  const importFile = useCallback(async (file: File, bankCoaId: string, opsi: ImportOptions = {}) => {
    const cid = wajibKlien(clientId);
    setImporting(true);
    try {
      return await uploadBankStatement(cid, bankCoaId, file, opsi);
    } finally {
      setImporting(false);
    }
  }, [clientId]);

  const value = useMemo<BankFeedContextType>(() => ({
    mutations,
    statements: st.statements,
    loading: mu.loading || st.loading,
    error: mu.error || st.error,
    refetch,
    importing,
    previewFile,
    importFile,
    reviewLine: async (id, input) => { await reviewMutation(wajibKlien(clientId), id, input); },
    removeMutation: async (id) => { await deleteMutation(wajibKlien(clientId), id); },
    ignoreMutation: async (id, reason) => { await ignoreMutation(wajibKlien(clientId), id, reason); },
    restoreMutation: async (id) => { await restoreMutation(wajibKlien(clientId), id); },
    removeStatement: async (id) => { await deleteBankStatement(wajibKlien(clientId), id); },
  }), [mutations, st.statements, mu.loading, st.loading, mu.error, st.error, refetch, importing, previewFile, importFile, clientId]);

  return <BankFeedContext.Provider value={value}>{children}</BankFeedContext.Provider>;
}

export function useBankFeed() {
  const ctx = useContext(BankFeedContext);
  if (!ctx) throw new Error('useBankFeed must be used inside BankFeedProvider (see bank-cash/layout.tsx)');
  return ctx;
}
