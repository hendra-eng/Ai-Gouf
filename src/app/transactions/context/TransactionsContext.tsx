'use client';
// [BARU] Sumber data transaksi TUNGGAL untuk seluruh halaman Transaksi
// (halaman utama /transactions + 5 sub halaman: Sales, Expense, Cash
// Payment, Cash Receipt, Other). Sebelumnya tiap sub halaman punya data
// dummy sendiri-sendiri yang tidak nyambung ke tabel di halaman utama.
// Sekarang `transactions` di sini adalah satu-satunya sumber: kalau ada
// transaksi baru ditambahkan/diimpor/diedit/diposting di halaman utama,
// seluruh sub halaman otomatis ikut berubah karena semuanya membaca dari
// context yang sama (dan sebaliknya juga berlaku).
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ALL_TRANSACTIONS, Transaction, TransactionGroup, getTransactionGroup } from '../components/transactionData';
import {
  transactionsFromJurnalPosting,
  extractPostingId,
  buildUpdatePayloadFromPair,
  buildManualCreatePayload,
  type BackendJurnalRow,
} from '../lib/jurnalBridge';
import { useActiveClient } from '@/lib/activeClient';
// [BARU] Dengarkan notifikasi "data client berubah" yang dikirim Agent AI
// begitu selesai upload & auto-posting file (lihat dataSync.ts) -- supaya
// tabel Transaksi otomatis refresh tanpa user harus ganti client atau
// reload halaman manual dulu.
import { listenClientDataChanged } from '@/lib/dataSync';
// [BARU] Sumber transaksi sekarang REAL: diambil dari backend
// GET /api/client/{id}/jurnal-posting (semua status) dan diterjemahkan lewat
// jurnalBridge.ts. Data statis ALL_TRANSACTIONS (transactionData.ts) hanya
// dipakai sbg FALLBACK — saat belum ada client aktif dipilih, atau saat
// fetch ke backend gagal/belum ada data sama sekali — supaya UI tidak
// pernah kosong total dan tetap bisa didemokan tanpa backend menyala.
import { daftarJurnalPosting, updateJurnalPosting, buatJurnalManual, postingMassalByIds, tolakPosting } from '@/app/agent-ai/lib/api';

interface TransactionsContextValue {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  unpostedCount: number;
  /** true selagi memuat data transaksi (jurnal) dari backend untuk client aktif. */
  loading: boolean;
  /** Pesan error terakhir dari fetch ke backend (null kalau tidak ada / lagi pakai data contoh). */
  error: string | null;
  /** true kalau `transactions` saat ini adalah data contoh (fallback), bukan data asli client. */
  isSampleData: boolean;
  /** Muat ulang transaksi dari backend untuk client aktif. */
  refetch: () => void;
  /**
   * Timpa satu transaksi (dicocokkan lewat id) — dipakai TransactionEditModal.
   * [DIUBAH — persist ke backend] Kalau baris ini berasal dari jurnal_posting
   * backend asli (jeId berformat "JE-<id>"), perubahan dikirim PATCH ke
   * server dulu (lewat jurnalBridge.buildUpdatePayloadFromPair) sebelum
   * state lokal ikut berubah; kalau gagal, state lokal TIDAK diubah dan
   * toast error ditampilkan. Baris lokal murni (data contoh / hasil import
   * yang belum sempat direfetch) tetap hanya mengubah state lokal seperti
   * sebelumnya, dengan toast yang menjelaskan itu belum tersimpan permanen.
   *
   * [DIUBAH — sinkron otomatis kaki pasangan] `syncedSibling` opsional:
   * diisi TransactionEditModal kalau nominal `updated` berubah dan
   * pasangannya (jeId sama) ikut disesuaikan otomatis di modal supaya
   * jurnal tetap balance. Kalau diisi, PATCH ke backend memakai nominal
   * pasangan yang SUDAH disesuaikan itu (bukan versi lama di state), dan
   * state lokal kedua leg ikut diperbarui sekaligus.
   */
  saveEdit: (updated: Transaction, syncedSibling?: Transaction) => Promise<void>;
  /**
   * Ubah status seluruh transaksi Unposted jadi Posted sekaligus.
   * [DIUBAH — persist ke backend] Baris yang berasal dari backend asli
   * diposting lewat POST posting-massal-by-ids, lalu data di-refetch ulang
   * dari server supaya status yang tampil selalu sesuai database. Baris
   * lokal murni (tanpa padanan di backend) tetap diposting di state saja.
   */
  postAllUnposted: () => Promise<void>;
  /** Ganti seluruh tabel dengan hasil import rekening koran baru. */
  importTransactions: (rows: Transaction[]) => void;
  /** Ambil transaksi milik satu kelompok saja (Sales/Expense/dll), dipakai di 5 sub halaman. */
  getByGroup: (group: TransactionGroup) => Transaction[];
  // [BARU] Tambahkan baris hasil import TANPA menghapus transaksi yang sudah
  // ada — dipakai oleh panel aksi jurnal di 5 sub halaman (Sales, Expense,
  // Cash Payment, Cash Receipt, Other), supaya upload data pembelian/penjualan
  // dari sub halaman tidak menghapus data dari halaman lain (beda perilaku
  // dari importTransactions() di atas, yang memang mengganti total tabel dan
  // hanya dipakai di halaman Transaksi utama).
  addTransactions: (rows: Transaction[]) => void;
  // [BARU] Ganti transaksi milik SATU kelompok saja (mis. Expense) dengan
  // hasil import baru — transaksi kelompok lain (Sales, Cash Payment, dst)
  // tidak disentuh sama sekali. Dipakai saat sub halaman mengimpor file yang
  // dimaksudkan untuk MENGGANTIKAN daftar transaksi kelompok itu, bukan
  // ditambahkan (beda dari addTransactions di atas).
  replaceGroup: (group: TransactionGroup, rows: Transaction[]) => void;
  /**
   * Tambahkan satu jurnal baru (dipakai tombol "+ Jurnal Baru" di halaman
   * utama & 5 sub halaman). [DIUBAH — persist ke backend] Menerima SEPASANG
   * Transaction (leg debet + leg kredit, lihat TransactionEditModal mode
   * isNew) karena backend jurnal_posting selalu menyimpan kedua sisi
   * sekaligus dalam satu baris. Dikirim lewat POST jurnal-posting/manual,
   * lalu data di-refetch dari backend supaya jurnal baru punya id/jeId asli
   * (bukan id sementara "JE-MANUAL-...").
   */
  addTransaction: (txs: Transaction[]) => Promise<void>;
  /** Posting semua transaksi Unposted, tapi dibatasi pada satu kelompok saja (lihat catatan postAllUnposted). */
  postAllUnpostedInGroup: (group: TransactionGroup) => Promise<void>;
  /**
   * [FIX - audit #2] Hapus satu/beberapa transaksi (dicocokkan lewat id) —
   * dipakai tombol Hapus per-baris & bulk-action di halaman Transaksi utama.
   * Baris yang benar-benar berasal dari jurnal_posting backend TIDAK
   * dihapus permanen dari database (tidak ada endpoint DELETE untuk
   * jurnal_posting, dan menghapus baris ledger begitu saja bukan praktik
   * akuntansi yang benar) — sebagai gantinya baris tsb (beserta pasangan
   * leg-nya, jeId sama) ditandai TOLAK lewat endpoint /tolak yang memang
   * sudah ada (dbc.tolak_posting_jurnal), sehingga tidak lagi masuk ke
   * laporan keuangan, lalu disembunyikan dari tabel. Baris lokal murni
   * (data contoh / hasil import yang belum sempat direfetch) langsung
   * dibuang dari state.
   */
  deleteTransactions: (ids: string[]) => Promise<void>;
  /**
   * [FIX - audit #2] Arsipkan satu/beberapa transaksi — backend tidak
   * punya konsep "arsip" sama sekali untuk jurnal_posting, jadi ini murni
   * state lokal (field `archived`, lihat transactionData.ts): baris
   * ditandai & disembunyikan dari tabel Transaksi utama selama sesi ini
   * (lihat TransactionsContent.tsx), TIDAK dihapus dan TIDAK dikirim ke
   * server — beda sengaja dari deleteTransactions di atas.
   */
  archiveTransactions: (ids: string[]) => void;
  /**
   * [FIX - audit #7] Set/lepas tanda centang "Cek" (rekonsiliasi manual) —
   * field ini murni lokal, backend jurnal_posting tidak punya kolom
   * setara, jadi cukup diubah di state di sini (tidak ada PATCH ke server).
   */
  toggleCek: (id: string) => void;
}

const TransactionsContext = createContext<TransactionsContextValue | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { activeClientId } = useActiveClient();
  const [transactions, setTransactions] = useState<Transaction[]>(ALL_TRANSACTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSampleData, setIsSampleData] = useState(true);
  // Dipakai supaya respons fetch client LAMA yang telat datang (mis. user
  // pindah client dengan cepat) tidak menimpa data client yang sekarang aktif.
  const requestIdRef = useRef(0);

  const loadFromBackend = React.useCallback(() => {
    if (!activeClientId) {
      setTransactions(ALL_TRANSACTIONS);
      setIsSampleData(true);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    daftarJurnalPosting(activeClientId, '') // '' -> semua status (draft + terposting + ditolak)
      .then((res: { jurnal: BackendJurnalRow[] }) => {
        if (requestIdRef.current !== requestId) return; // sudah usang, ada request client lain setelah ini
        const rows = res?.jurnal || [];
        if (rows.length === 0) {
          // Client aktif belum punya jurnal sama sekali — tampilkan data
          // contoh supaya halaman tidak kosong total, tapi tandai jelas
          // lewat isSampleData supaya UI bisa kasih tahu user.
          setTransactions(ALL_TRANSACTIONS);
          setIsSampleData(true);
        } else {
          setTransactions(transactionsFromJurnalPosting(rows));
          setIsSampleData(false);
        }
      })
      .catch((err: Error) => {
        if (requestIdRef.current !== requestId) return;
        console.error('Gagal memuat jurnal dari backend:', err);
        setError(err?.message || 'Gagal memuat transaksi dari server.');
        // Fallback ke data contoh supaya halaman tetap bisa dipakai/didemokan.
        setTransactions(ALL_TRANSACTIONS);
        setIsSampleData(true);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [activeClientId]);

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  // [BARU] Begitu Agent AI selesai upload & auto-posting untuk CLIENT YANG
  // SAMA dengan yang sedang aktif di sini, muat ulang jurnal dari backend --
  // supaya baris transaksi baru langsung muncul di tabel tanpa perlu ganti
  // client atau reload halaman manual. Kalau notifikasi datang untuk client
  // LAIN (bukan yang lagi aktif di layar ini), diabaikan -- nanti otomatis
  // ke-fetch sendiri begitu user pindah ke client itu (efek activeClientId
  // di atas).
  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) {
        loadFromBackend();
      }
    });
  }, [activeClientId, loadFromBackend]);

  const unpostedCount = useMemo(
    () => transactions.filter((tx) => tx.status === 'Unposted').length,
    [transactions]
  );

  // [DIUBAH — persist ke backend] Kirim PATCH ke server dulu untuk baris
  // yang benar-benar berasal dari jurnal_posting backend (jeId "JE-<id>");
  // baris lokal murni (data contoh / import belum direfetch / jurnal manual
  // yang gagal tersimpan) tetap diedit di state saja seperti sebelumnya.
  const saveEdit = async (updated: Transaction, syncedSibling?: Transaction) => {
    const postingId = extractPostingId(updated.jeId);
    if (postingId === null || !activeClientId) {
      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.id === updated.id) return updated;
          if (syncedSibling && tx.id === syncedSibling.id) return syncedSibling;
          return tx;
        })
      );
      toast.success('Perubahan disimpan (lokal)', {
        description: `${updated.txId} diperbarui — data ini belum tersinkron ke server, akan hilang saat refresh.`,
      });
      return;
    }
    // [DIUBAH — sinkron otomatis kaki pasangan] Kalau modal sudah mengirim
    // pasangan yang nominalnya disesuaikan (syncedSibling), pakai itu
    // sebagai sibling utk payload PATCH -- BUKAN versi lama di `transactions`
    // -- supaya backend menerima kedua sisi jurnal yang sudah balance,
    // bukan nominal sibling yang belum diubah.
    const sibling = syncedSibling ?? transactions.find((tx) => tx.jeId === updated.jeId && tx.id !== updated.id) ?? null;
    const payload = buildUpdatePayloadFromPair(updated, sibling);
    try {
      await updateJurnalPosting(activeClientId, postingId, payload);
      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.id === updated.id) return updated;
          if (syncedSibling && tx.id === syncedSibling.id) return syncedSibling;
          return tx;
        })
      );
      toast.success('Perubahan disimpan', {
        description: syncedSibling
          ? `${updated.txId} berhasil diperbarui di server — pasangan jurnalnya ikut disesuaikan supaya tetap balance`
          : `${updated.txId} berhasil diperbarui di server`,
      });
    } catch (err) {
      console.error('Gagal menyimpan edit ke backend:', err);
      toast.error('Gagal menyimpan perubahan', {
        description: (err as Error)?.message || 'Server menolak perubahan, coba lagi.',
      });
    }
  };

  // [DIUBAH — persist ke backend] Pisahkan baris yang punya padanan asli di
  // backend (diposting lewat postingMassalByIds lalu di-refetch supaya
  // status yang tampil = sumber kebenaran database) dari baris lokal murni
  // (tetap diposting di state saja, sama seperti perilaku lama).
  const postAllUnposted = async () => {
    const unposted = transactions.filter((tx) => tx.status === 'Unposted');
    if (unposted.length === 0) return;
    const backendIds = Array.from(
      new Set(unposted.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const adaBarisLokal = unposted.some((tx) => extractPostingId(tx.jeId) === null);

    if (backendIds.length > 0 && activeClientId) {
      try {
        const hasil = await postingMassalByIds(activeClientId, backendIds);
        toast.success('Transaksi berhasil diposting', {
          description: `${hasil.diposting} transaksi Unposted kini berstatus Posted${
            hasil.dilewati_placeholder ? `, ${hasil.dilewati_placeholder} dilewati (akun placeholder)` : ''
          }`,
        });
        loadFromBackend(); // sinkronkan ulang status dari server
      } catch (err) {
        console.error('Gagal posting ke backend:', err);
        toast.error('Gagal posting transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan posting.',
        });
        return;
      }
    }

    if (adaBarisLokal) {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === 'Unposted' && extractPostingId(tx.jeId) === null ? { ...tx, status: 'Posted' } : tx
        )
      );
      if (backendIds.length === 0) {
        toast.success('Transaksi berhasil diposting (lokal)', {
          description: 'Baris ini belum tersinkron ke server — status akan kembali saat refresh.',
        });
      }
    }
  };

  // [DIUBAH KEMBALI — sesuai keputusan user] Sempat diubah supaya
  // memuat ulang SEMUA transaksi dari backend setiap kali ada import (biar
  // "sumber kebenaran" selalu database) -- tapi itu bikin tabel Transaksi
  // selalu menggabung seluruh histori (mis. 20.630 lama + 4.000 baru jadi
  // 24.630 tampil sekaligus), padahal yang diinginkan user: tabel di LAYAR
  // hanya menampilkan batch yang BARU SAJA diimpor (reset tampilan), sambil
  // data lama tetap 100% aman di database (backend memang selalu INSERT,
  // tidak pernah menghapus apa pun saat upload -- lihat POST /api/proses-file
  // di ImportRekeningKoranModal.tsx). Jadi cukup ganti state lokal dengan
  // `rows` batch ini saja, TANPA fetch ulang ke server.
  //
  // CATATAN dedup: sama seperti sebelumnya, guard anti-duplikat
  // (pisahkanTransaksiDuplikat) murni di frontend dan backend belum
  // men-dedup baris yang masuk -- baris yang dilewati user di step
  // "konfirmasi duplikat" tetap sudah tersimpan di server sejak upload,
  // tapi karena sekarang TIDAK ada refetch otomatis, baris itu juga tidak
  // akan tiba-tiba muncul lagi di tabel ini (beda dari sebelumnya).
  const importTransactions = (rows: Transaction[]) => {
    setTransactions(rows);
  };

  const getByGroup = (group: TransactionGroup) => transactions.filter((tx) => getTransactionGroup(tx) === group);

  // [BARU] Menambahkan (bukan mengganti) — dipakai saat import rekening koran
  // atau upload data pembelian/penjualan dilakukan dari salah satu dari 5 sub
  // halaman Transaksi, supaya data yang sudah ada di kelompok lain tetap aman.
  const addTransactions = (rows: Transaction[]) => {
    if (rows.length === 0) return;
    setTransactions((prev) => [...rows, ...prev]);
  };

  // [DIUBAH KEMBALI — sesuai keputusan user, sama seperti importTransactions()
  // di atas] Cukup buang baris grup ini dari state lokal lalu ganti dengan
  // `rows` batch baru -- TANPA fetch ulang ke backend. Grup lain tidak
  // disentuh. Data grup ini yang tidak ikut ke-parse di batch ini tetap aman
  // di database (backend selalu INSERT, tidak pernah menghapus), hanya
  // sengaja tidak ditampilkan lagi di layar sampai user reload/pindah client.
  const replaceGroup = (group: TransactionGroup, rows: Transaction[]) => {
    setTransactions((prev) => [...rows, ...prev.filter((tx) => getTransactionGroup(tx) !== group)]);
  };

  // [DIUBAH — persist ke backend] Selalu menerima sepasang leg (debet +
  // kredit) — lihat TransactionEditModal mode isNew. Dikirim lewat POST
  // jurnal-posting/manual, lalu di-refetch supaya baris baru langsung punya
  // id/jeId asli dari backend (bukan id sementara "JE-MANUAL-..."). Kalau
  // belum ada client aktif, tidak mungkin tersimpan permanen — jatuh ke
  // penambahan state lokal saja (sama seperti perilaku lama).
  const addTransaction = async (txs: Transaction[]) => {
    if (txs.length < 2) return;
    const [a, b] = txs;
    const debetLeg = a.type === 'credit' ? b : a;
    const kreditLeg = a.type === 'credit' ? a : b;

    if (!activeClientId) {
      setTransactions((prev) => [...txs, ...prev]);
      toast.success('Jurnal baru ditambahkan (lokal)', {
        description: `${debetLeg.txId} dibuat — pilih client aktif dulu supaya tersimpan permanen ke server.`,
      });
      return;
    }

    const payload = buildManualCreatePayload(debetLeg, kreditLeg);
    try {
      await buatJurnalManual(activeClientId, payload);
      toast.success('Jurnal baru ditambahkan', { description: `${debetLeg.txId} berhasil disimpan ke server` });
      loadFromBackend();
    } catch (err) {
      console.error('Gagal menyimpan jurnal baru ke backend:', err);
      toast.error('Gagal menyimpan jurnal baru', {
        description: (err as Error)?.message || 'Server menolak permintaan.',
      });
    }
  };

  const postAllUnpostedInGroup = async (group: TransactionGroup) => {
    const unposted = transactions.filter((tx) => tx.status === 'Unposted' && getTransactionGroup(tx) === group);
    if (unposted.length === 0) return;
    const backendIds = Array.from(
      new Set(unposted.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const adaBarisLokal = unposted.some((tx) => extractPostingId(tx.jeId) === null);

    if (backendIds.length > 0 && activeClientId) {
      try {
        const hasil = await postingMassalByIds(activeClientId, backendIds);
        toast.success('Transaksi berhasil diposting', {
          description: `${hasil.diposting} transaksi Unposted kini berstatus Posted${
            hasil.dilewati_placeholder ? `, ${hasil.dilewati_placeholder} dilewati (akun placeholder)` : ''
          }`,
        });
        loadFromBackend();
      } catch (err) {
        console.error('Gagal posting ke backend:', err);
        toast.error('Gagal posting transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan posting.',
        });
        return;
      }
    }

    if (adaBarisLokal) {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === 'Unposted' && getTransactionGroup(tx) === group && extractPostingId(tx.jeId) === null
            ? { ...tx, status: 'Posted' }
            : tx
        )
      );
      if (backendIds.length === 0) {
        toast.success('Transaksi berhasil diposting (lokal)', {
          description: 'Baris ini belum tersinkron ke server — status akan kembali saat refresh.',
        });
      }
    }
  };

  // [FIX - audit #2] Lihat komentar deleteTransactions di interface di atas.
  const deleteTransactions = async (ids: string[]) => {
    const targets = transactions.filter((tx) => ids.includes(tx.id));
    if (targets.length === 0) return;
    const backendPostingIds = Array.from(
      new Set(targets.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const jeIdsBackend = new Set(
      targets.filter((tx) => extractPostingId(tx.jeId) !== null).map((tx) => tx.jeId)
    );
    const localIds = new Set(
      targets.filter((tx) => extractPostingId(tx.jeId) === null).map((tx) => tx.id)
    );

    if (backendPostingIds.length > 0 && activeClientId) {
      try {
        await Promise.all(
          backendPostingIds.map((postingId) =>
            tolakPosting(activeClientId, postingId, 'Dihapus dari halaman Transaksi')
          )
        );
      } catch (err) {
        console.error('Gagal menghapus transaksi di backend:', err);
        toast.error('Gagal menghapus transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan, coba lagi.',
        });
        return;
      }
    }

    // Baris backend yang berhasil ditolak: buang KEDUA leg (jeId sama) dari
    // tampilan. Baris lokal murni: buang langsung lewat id.
    setTransactions((prev) => prev.filter((tx) => !localIds.has(tx.id) && !jeIdsBackend.has(tx.jeId)));

    toast.success(`${targets.length} transaksi dihapus`, {
      description: backendPostingIds.length > 0
        ? 'Jurnal yang tersinkron ke server ditandai ditolak (tidak lagi masuk laporan keuangan) — jurnal ledger tidak dihapus permanen dari database, sesuai praktik akuntansi.'
        : undefined,
    });
  };

  // [FIX - audit #2] Lihat komentar archiveTransactions di interface di atas.
  const archiveTransactions = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setTransactions((prev) => prev.map((tx) => (idSet.has(tx.id) ? { ...tx, archived: true } : tx)));
    toast.success(`${ids.length} transaksi diarsipkan`, {
      description: 'Disembunyikan dari tabel Transaksi selama sesi ini (belum ada penyimpanan arsip permanen di server).',
    });
  };

  // [FIX - audit #7] Lihat komentar toggleCek di interface di atas.
  const toggleCek = (id: string) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, cek: !tx.cek } : tx)));
  };

  const value: TransactionsContextValue = {
    transactions,
    setTransactions,
    unpostedCount,
    loading,
    error,
    isSampleData,
    refetch: loadFromBackend,
    saveEdit,
    postAllUnposted,
    importTransactions,
    getByGroup,
    addTransactions,
    replaceGroup,
    addTransaction,
    postAllUnpostedInGroup,
    deleteTransactions,
    archiveTransactions,
    toggleCek,
  };

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions() {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions harus dipakai di dalam TransactionsProvider (lihat src/app/transactions/layout.tsx)');
  return ctx;
}