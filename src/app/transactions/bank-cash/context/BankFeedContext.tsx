'use client';

// ─── STATE BANK FEED — SEKARANG REAL, DARI BACKEND ─────────────────────────
// [DIUBAH] Sebelumnya context ini cuma nyimpen state React lokal per sesi
// (addMockMutationsFromFile menggenerate baris acak) sambil menunggu tabel
// & endpoint backend selesai dibuat. Backend itu SUDAH ADA sekarang:
//   - Tabel `bank_feed_mutation` (db_client.py::BankFeedMutation) — mutasi
//     rekening koran MENTAH, terpisah dari `finance_transaction_bank_cash`
//     yang sudah berbentuk jurnal.
//   - Router modules/finance/bank_feed_v1.py — GET /list, POST /import,
//     DELETE /{id}, POST /{id}/match, POST /{id}/unmatch.
//   - Wrapper frontend: daftarBankFeed/importBankFeed/hapusBankFeed/
//     matchBankFeed/unmatchBankFeed di agent-ai/lib/api.js.
//
// Context ini sekarang murni lapisan state di atas API itu — polanya
// disamakan dengan TransactionsContext.tsx (loadFromBackend + requestIdRef
// supaya respons client lama yang telat tidak menimpa data client aktif
// yang sekarang, useEffect re-fetch saat activeClientId berubah).
//
// (Riwayat: sebelumnya di sini ada `addMockMutationsFromFile` yang generate
// 3–5 baris mutasi acak per upload, murni untuk mendemokan UI Bank Feed +
// Reconciliation sebelum backend selesai. Sudah tidak dipakai lagi.)

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { daftarBankFeed, importBankFeed, hapusBankFeed, matchBankFeed, unmatchBankFeed } from '@/app/agent-ai/lib/api';

export type MatchStatus = 'unmatched' | 'matched';

export interface BankFeedMutation {
  id: string;
  date: string;
  description: string;
  bankAccount: string;
  debit: number; // uang keluar dari rekening (mutasi debet bank)
  credit: number; // uang masuk ke rekening (mutasi kredit bank)
  balanceAfter: number;
  status: MatchStatus;
  // id Transaction (dari TransactionsContext, group cash_payment/cash_receipt)
  // yang dicocokkan ke mutasi ini — null kalau belum ada.
  matchedTxId: string | null;
  sourceFile: string;
  uploadedAt: string;
}

// Bentuk baris apa adanya dari backend (lihat db_client.py::_bank_feed_ke_dict)
// -- field-nya sudah persis sama nama & tipe dengan BankFeedMutation di atas,
// tapi sejumlah field boleh null dari server (mis. bankAccount/date belum
// terisi kalau ekstraksi gagal membaca kolom itu) sehingga dinormalisasi di
// normalisasiMutasi() sebelum masuk ke state.
interface BankFeedMutationBackend {
  id: string;
  bankAccount?: string | null;
  date?: string | null;
  description?: string | null;
  debit?: number | null;
  credit?: number | null;
  balanceAfter?: number | null;
  status: string;
  matchedTxId?: string | null;
  sourceFile?: string | null;
  uploadedAt?: string | null;
}

function normalisasiMutasi(m: BankFeedMutationBackend): BankFeedMutation {
  return {
    id: m.id,
    date: m.date || '',
    description: m.description || '',
    bankAccount: m.bankAccount || '',
    debit: m.debit || 0,
    credit: m.credit || 0,
    balanceAfter: m.balanceAfter || 0,
    status: m.status === 'matched' ? 'matched' : 'unmatched',
    matchedTxId: m.matchedTxId || null,
    sourceFile: m.sourceFile || '',
    uploadedAt: m.uploadedAt || '',
  };
}

interface BankFeedContextType {
  mutations: BankFeedMutation[];
  /** true selagi memuat daftar mutasi Bank Feed dari backend untuk client aktif. */
  loading: boolean;
  /** Pesan error terakhir dari fetch daftar (null kalau tidak ada error). */
  error: string | null;
  /** Muat ulang daftar mutasi dari backend untuk client aktif. */
  refetch: () => void;
  /** true selagi upload+ekstraksi rekening koran sedang berjalan. */
  importing: boolean;
  /**
   * Upload rekening koran (PDF/Excel) untuk satu akun bank — hasil ekstraksi
   * langsung tersimpan di backend sebagai mutasi baru berstatus 'unmatched',
   * lalu daftar di-refetch supaya `mutations` selalu cermin data server
   * (termasuk saldo berjalan yang dihitung backend, bukan cuma baris baru).
   * Melempar Error kalau gagal (mis. file tidak terbaca sama sekali) —
   * pemanggil (UploadPanel) yang menampilkan toast-nya.
   */
  importFile: (file: File, bankAccount: string, pakaiAi?: boolean) => Promise<{ diimpor: number; peringatan: string[] }>;
  /** Hapus satu baris mutasi Bank Feed. Melempar Error kalau gagal. */
  removeMutation: (id: string) => Promise<void>;
  /** Tandai satu mutasi Bank Feed cocok dengan satu Transaction sistem. Melempar Error kalau gagal. */
  matchMutation: (mutationId: string, txId: string) => Promise<void>;
  /** Batalkan pencocokan (dipakai dari tab Reconciliation, riwayat matched). Melempar Error kalau gagal. */
  unmatchMutation: (mutationId: string) => Promise<void>;
  /**
   * Id mutasi yang sedang diproses (hapus/match/unmatch) — dipakai UI untuk
   * menonaktifkan tombol baris terkait selagi request-nya berjalan, supaya
   * tidak diklik dobel.
   */
  pendingIds: Set<string>;
}

const BankFeedContext = createContext<BankFeedContextType | undefined>(undefined);

export function BankFeedProvider({ children }: { children: React.ReactNode }) {
  const { activeClientId } = useActiveClient();
  const [mutations, setMutations] = useState<BankFeedMutation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Dipakai supaya respons fetch client LAMA yang telat datang (mis. user
  // pindah client dengan cepat) tidak menimpa data client yang sekarang aktif
  // -- pola sama seperti TransactionsContext.tsx.
  const requestIdRef = useRef(0);

  const loadFromBackend = useCallback(() => {
    if (!activeClientId) {
      setMutations([]);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    daftarBankFeed(activeClientId, '')
      .then((res: { mutations: BankFeedMutationBackend[] }) => {
        if (requestIdRef.current !== requestId) return; // sudah usang
        setMutations((res?.mutations || []).map(normalisasiMutasi));
      })
      .catch((err: Error) => {
        if (requestIdRef.current !== requestId) return;
        console.error('Gagal memuat mutasi Bank Feed dari backend:', err);
        setError(err?.message || 'Gagal memuat mutasi Bank Feed dari server.');
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [activeClientId]);

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  const withPending = useCallback(async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      return await fn();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const importFile = useCallback(
    async (file: File, bankAccount: string, pakaiAi: boolean = true) => {
      if (!activeClientId) {
        throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      }
      setImporting(true);
      try {
        const res = await importBankFeed(activeClientId, bankAccount, file, pakaiAi);
        // Refetch daripada menggabungkan manual ke state -- saldo berjalan
        // (balanceAfter) dihitung backend bersambung dari baris tersimpan
        // sebelumnya, jadi sumber kebenarannya tetap server.
        loadFromBackend();
        return { diimpor: res?.diimpor || 0, peringatan: res?.peringatan || [] };
      } finally {
        setImporting(false);
      }
    },
    [activeClientId, loadFromBackend]
  );

  const removeMutation = useCallback(
    async (id: string) => {
      if (!activeClientId) return;
      await withPending(id, () => hapusBankFeed(activeClientId, id));
      setMutations((prev) => prev.filter((m) => m.id !== id));
    },
    [activeClientId, withPending]
  );

  const matchMutation = useCallback(
    async (mutationId: string, txId: string) => {
      if (!activeClientId) return;
      const res = await withPending(mutationId, () => matchBankFeed(activeClientId, mutationId, txId));
      const updated = normalisasiMutasi(res.mutation);
      setMutations((prev) => prev.map((m) => (m.id === mutationId ? updated : m)));
    },
    [activeClientId, withPending]
  );

  const unmatchMutation = useCallback(
    async (mutationId: string) => {
      if (!activeClientId) return;
      const res = await withPending(mutationId, () => unmatchBankFeed(activeClientId, mutationId));
      const updated = normalisasiMutasi(res.mutation);
      setMutations((prev) => prev.map((m) => (m.id === mutationId ? updated : m)));
    },
    [activeClientId, withPending]
  );

  const value = useMemo(
    () => ({
      mutations,
      loading,
      error,
      refetch: loadFromBackend,
      importing,
      importFile,
      removeMutation,
      matchMutation,
      unmatchMutation,
      pendingIds,
    }),
    [mutations, loading, error, loadFromBackend, importing, importFile, removeMutation, matchMutation, unmatchMutation, pendingIds]
  );

  return <BankFeedContext.Provider value={value}>{children}</BankFeedContext.Provider>;
}

export function useBankFeed() {
  const ctx = useContext(BankFeedContext);
  if (!ctx) throw new Error('useBankFeed harus dipakai di dalam BankFeedProvider (lihat layout.tsx bank-cash)');
  return ctx;
}