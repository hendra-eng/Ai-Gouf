'use client';

// ─── STATE BANK FEED — MODE SESI (TIDAK DISIMPAN DI DATABASE) ──────────────
// [DIUBAH] Sebelumnya context ini membaca/menulis tabel `bank_feed_mutation`
// lewat backend, jadi hasil upload rekening koran tersimpan permanen dan
// muncul lagi tiap halaman dibuka. Sesuai permintaan user, Bank Feed
// sekarang sifatnya SEMENTARA:
//   - Upload -> backend hanya mengekstrak & membalas baris mutasi
//     (importBankFeed(..., simpan=false)), TIDAK menulis ke database.
//   - Hasilnya hidup di state React + sessionStorage per client
//     (src/lib/bankFeedSession.ts): tetap ada saat pindah halaman/refresh di
//     tab yang sama, hilang otomatis saat tab ditutup, dan dikosongkan
//     eksplisit saat logout.
//   - Hapus / match / unmatch berlaku lokal di sesi ini saja (tanpa panggilan
//     backend). Artinya status Reconciliation ikut ter-reset bersama Bank Feed.
// Endpoint list/hapus/match/unmatch di backend (bank_feed_v1.py) sengaja
// dibiarkan ada (tidak dihapus) tapi tidak dipanggil lagi dari sini.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { importBankFeed } from '@/app/agent-ai/lib/api';
import { bacaSesiBankFeed, tulisSesiBankFeed } from '@/lib/bankFeedSession';

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
  // Saldo awal resmi file sumber (footer PDF rekening koran), dipakai sebagai
  // saldo pembuka saat menghitung saldo berjalan. null/undefined = tidak
  // diketahui (mis. file Excel, atau sesi lama) -> mulai dari 0 seperti dulu.
  fileOpeningBalance?: number | null;
}

// Bentuk baris apa adanya dari backend (respons POST /import) -- sejumlah
// field boleh null, dinormalisasi di normalisasiMutasi() sebelum masuk state.
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
  fileOpeningBalance?: number | null;
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
    fileOpeningBalance: typeof m.fileOpeningBalance === 'number' ? m.fileOpeningBalance : null,
  };
}

// Urutkan terbaru dulu (tanggal desc, stabil -- baris yang lebih baru masuk
// ke sesi tampil lebih atas untuk tanggal yang sama), lalu hitung ulang saldo
// berjalan BERSAMBUNG per akun bank dari seluruh baris sesi. Backend hanya
// menghitung saldo per-file mulai dari 0, jadi kalau ada beberapa file untuk
// akun yang sama, saldonya harus disambung di sini.
//
// Saldo pembuka: tiap file membawa `fileOpeningBalance` (saldo awal resmi dari
// footer PDF). Pada baris PERTAMA tiap file (urut kronologis) saldo berjalan
// di-set ke saldo awal file itu, sehingga saldo = saldo awal + kredit - debit
// -- sama dengan kolom SALDO di rekening koran. Untuk file yang bersambung
// (bulan berikutnya) hasilnya identik dengan menyambung saldo file sebelumnya;
// kalau ada bulan yang bolong, saldo tetap benar karena di-anchor ulang.
// Re-anchor dilewati kalau tanggal file baru tumpang tindih dengan data akun
// yang sudah ada (mencegah saldo loncat). File tanpa saldo awal (Excel / sesi
// lama) diperlakukan seperti dulu: lanjut dari saldo berjalan (atau 0).
function urutkanDanHitungSaldo(list: BankFeedMutation[]): BankFeedMutation[] {
  const tampil = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const saldoPerAkun = new Map<string, number>();
  const tanggalTerakhirPerAkun = new Map<string, string>();
  const fileSudahDiproses = new Set<string>();
  const kronologis = [...tampil].reverse().map((m) => {
    let saldoSebelum = saldoPerAkun.get(m.bankAccount) ?? 0;
    const kunciFile = `${m.bankAccount}|${m.sourceFile}|${m.uploadedAt}`;
    if (!fileSudahDiproses.has(kunciFile)) {
      fileSudahDiproses.add(kunciFile);
      const pembuka = m.fileOpeningBalance;
      const tanggalTerakhir = tanggalTerakhirPerAkun.get(m.bankAccount);
      if (
        typeof pembuka === 'number' &&
        Number.isFinite(pembuka) &&
        (tanggalTerakhir === undefined || m.date > tanggalTerakhir)
      ) {
        saldoSebelum = pembuka;
      }
    }
    const saldo = saldoSebelum + m.credit - m.debit;
    saldoPerAkun.set(m.bankAccount, saldo);
    const tglSebelumnya = tanggalTerakhirPerAkun.get(m.bankAccount);
    if (tglSebelumnya === undefined || m.date > tglSebelumnya) tanggalTerakhirPerAkun.set(m.bankAccount, m.date);
    return { ...m, balanceAfter: saldo };
  });
  return kronologis.reverse();
}

interface BankFeedContextType {
  mutations: BankFeedMutation[];
  /** Selalu false -- tidak ada fetch daftar dari server lagi (mode sesi). */
  loading: boolean;
  /** Selalu null -- dipertahankan supaya halaman pemakai tidak perlu diubah. */
  error: string | null;
  /** Baca ulang state dari penyimpanan sesi (dipertahankan untuk kompatibilitas). */
  refetch: () => void;
  /** true selagi upload+ekstraksi rekening koran sedang berjalan. */
  importing: boolean;
  /**
   * Upload rekening koran (PDF/Excel) untuk satu akun bank. Hasil ekstraksi
   * TIDAK disimpan di database -- hanya ditambahkan ke state sesi ini.
   * Melempar Error kalau gagal; pemanggil (UploadPanel) yang menampilkan toast.
   */
  importFile: (file: File, bankAccount: string, pakaiAi?: boolean) => Promise<{ diimpor: number; peringatan: string[] }>;
  /** Hapus satu baris mutasi dari sesi ini. */
  removeMutation: (id: string) => Promise<void>;
  /** Tandai satu mutasi cocok dengan satu Transaction sistem (lokal di sesi). */
  matchMutation: (mutationId: string, txId: string) => Promise<void>;
  /** Batalkan pencocokan (lokal di sesi). */
  unmatchMutation: (mutationId: string) => Promise<void>;
  /** Kosongkan seluruh Bank Feed (dan status match-nya) untuk client aktif. */
  clearAll: () => void;
  /** Dipertahankan untuk kompatibilitas -- selalu kosong (operasi lokal, instan). */
  pendingIds: Set<string>;
}

const BankFeedContext = createContext<BankFeedContextType | undefined>(undefined);

const PENDING_KOSONG: Set<string> = new Set();

// State disimpan bersama clientId pemiliknya supaya data client lama tidak
// pernah tertulis ke kunci client baru saat user pindah client.
interface SesiBankFeed {
  clientId: string | null;
  list: BankFeedMutation[];
}

export function BankFeedProvider({ children }: { children: React.ReactNode }) {
  const { activeClientId } = useActiveClient();
  const [sesi, setSesi] = useState<SesiBankFeed>({ clientId: null, list: [] });
  const [importing, setImporting] = useState(false);
  const activeClientIdRef = useRef<string | null>(null);

  const clientIdStr = activeClientId ? String(activeClientId) : null;
  activeClientIdRef.current = clientIdStr;

  // Muat dari sessionStorage tiap client aktif berubah.
  useEffect(() => {
    if (!clientIdStr) {
      setSesi({ clientId: null, list: [] });
      return;
    }
    setSesi((prev) =>
      prev.clientId === clientIdStr
        ? prev
        : { clientId: clientIdStr, list: urutkanDanHitungSaldo(bacaSesiBankFeed<BankFeedMutation>(clientIdStr)) }
    );
  }, [clientIdStr]);

  // Simpan tiap state berubah (ke kunci milik sesi.clientId, bukan client aktif).
  useEffect(() => {
    if (sesi.clientId) tulisSesiBankFeed(sesi.clientId, sesi.list);
  }, [sesi]);

  const mutations = useMemo(
    () => (sesi.clientId && sesi.clientId === clientIdStr ? sesi.list : []),
    [sesi, clientIdStr]
  );

  const ubahList = useCallback(
    (fn: (prev: BankFeedMutation[]) => BankFeedMutation[]) => {
      const cid = activeClientIdRef.current;
      if (!cid) return;
      setSesi((prev) => (prev.clientId === cid ? { clientId: cid, list: fn(prev.list) } : prev));
    },
    []
  );

  const refetch = useCallback(() => {
    const cid = activeClientIdRef.current;
    if (!cid) return;
    setSesi({ clientId: cid, list: urutkanDanHitungSaldo(bacaSesiBankFeed<BankFeedMutation>(cid)) });
  }, []);

  const importFile = useCallback(
    async (file: File, bankAccount: string, pakaiAi: boolean = true) => {
      const cid = activeClientIdRef.current;
      if (!cid) {
        throw new Error('Belum ada client aktif — pilih client dulu di Topbar.');
      }
      setImporting(true);
      try {
        // simpan=false -> backend cuma mengekstrak, tidak menulis ke database.
        const res = await importBankFeed(cid, bankAccount, file, pakaiAi, false);
        const baru = ((res?.mutations || []) as BankFeedMutationBackend[]).map(normalisasiMutasi);
        if (activeClientIdRef.current === cid) {
          ubahList((prev) => urutkanDanHitungSaldo([...baru, ...prev]));
        } else {
          // User pindah client selagi upload berjalan -- simpan ke sesi client
          // asalnya, jangan campur ke client yang sekarang aktif.
          tulisSesiBankFeed(
            cid,
            urutkanDanHitungSaldo([...baru, ...bacaSesiBankFeed<BankFeedMutation>(cid)])
          );
        }
        return { diimpor: res?.diimpor || baru.length, peringatan: (res?.peringatan || []) as string[] };
      } finally {
        setImporting(false);
      }
    },
    [ubahList]
  );

  const removeMutation = useCallback(
    async (id: string) => {
      ubahList((prev) => urutkanDanHitungSaldo(prev.filter((m) => m.id !== id)));
    },
    [ubahList]
  );

  const matchMutation = useCallback(
    async (mutationId: string, txId: string) => {
      ubahList((prev) =>
        prev.map((m) => (m.id === mutationId ? { ...m, status: 'matched' as const, matchedTxId: txId } : m))
      );
    },
    [ubahList]
  );

  const unmatchMutation = useCallback(
    async (mutationId: string) => {
      ubahList((prev) =>
        prev.map((m) => (m.id === mutationId ? { ...m, status: 'unmatched' as const, matchedTxId: null } : m))
      );
    },
    [ubahList]
  );

  const clearAll = useCallback(() => {
    ubahList(() => []);
  }, [ubahList]);

  const value = useMemo(
    () => ({
      mutations,
      loading: false,
      error: null,
      refetch,
      importing,
      importFile,
      removeMutation,
      matchMutation,
      unmatchMutation,
      clearAll,
      pendingIds: PENDING_KOSONG,
    }),
    [mutations, refetch, importing, importFile, removeMutation, matchMutation, unmatchMutation, clearAll]
  );

  return <BankFeedContext.Provider value={value}>{children}</BankFeedContext.Provider>;
}

export function useBankFeed() {
  const ctx = useContext(BankFeedContext);
  if (!ctx) throw new Error('useBankFeed harus dipakai di dalam BankFeedProvider (lihat layout.tsx bank-cash)');
  return ctx;
}