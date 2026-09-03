'use client';
// [BARU] Sumber data transaksi TUNGGAL untuk seluruh halaman Transaksi
// (halaman utama /transactions + 5 sub halaman: Sales, Expense, Cash
// Payment, Cash Reserve, Other). Sebelumnya tiap sub halaman punya data
// dummy sendiri-sendiri yang tidak nyambung ke tabel di halaman utama.
// Sekarang `transactions` di sini adalah satu-satunya sumber: kalau ada
// transaksi baru ditambahkan/diimpor/diedit/diposting di halaman utama,
// seluruh sub halaman otomatis ikut berubah karena semuanya membaca dari
// context yang sama (dan sebaliknya juga berlaku).
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ALL_TRANSACTIONS, Transaction, TransactionGroup, getTransactionGroup } from '../components/transactionData';
import { transactionsFromJurnalPosting, type BackendJurnalRow } from '../lib/jurnalBridge';
import { useActiveClient } from '@/lib/activeClient';
// [BARU] Sumber transaksi sekarang REAL: diambil dari backend
// GET /api/client/{id}/jurnal-posting (semua status) dan diterjemahkan lewat
// jurnalBridge.ts. Data statis ALL_TRANSACTIONS (transactionData.ts) hanya
// dipakai sbg FALLBACK — saat belum ada client aktif dipilih, atau saat
// fetch ke backend gagal/belum ada data sama sekali — supaya UI tidak
// pernah kosong total dan tetap bisa didemokan tanpa backend menyala.
import { daftarJurnalPosting } from '@/app/agent-ai/lib/api';

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
  /** Timpa satu transaksi (dicocokkan lewat id) — dipakai TransactionEditModal. */
  saveEdit: (updated: Transaction) => void;
  /** Ubah status seluruh transaksi Unposted jadi Posted sekaligus. */
  postAllUnposted: () => void;
  /** Ganti seluruh tabel dengan hasil import rekening koran baru. */
  importTransactions: (rows: Transaction[]) => void;
  /** Ambil transaksi milik satu kelompok saja (Sales/Expense/dll), dipakai di 5 sub halaman. */
  getByGroup: (group: TransactionGroup) => Transaction[];
  // [BARU] Tambahkan baris hasil import TANPA menghapus transaksi yang sudah
  // ada — dipakai oleh panel aksi jurnal di 5 sub halaman (Sales, Expense,
  // Cash Payment, Cash Reserve, Other), supaya upload data pembelian/penjualan
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
  /** Tambahkan satu transaksi baru (dipakai tombol "+ Jurnal Baru" di 5 sub halaman). */
  addTransaction: (tx: Transaction) => void;
  /** Posting semua transaksi Unposted, tapi dibatasi pada satu kelompok saja. */
  postAllUnpostedInGroup: (group: TransactionGroup) => void;
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

  const unpostedCount = useMemo(
    () => transactions.filter((tx) => tx.status === 'Unposted').length,
    [transactions]
  );

  const saveEdit = (updated: Transaction) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === updated.id ? updated : tx)));
    toast.success('Perubahan disimpan', { description: `${updated.txId} berhasil diperbarui` });
  };

  const postAllUnposted = () => {
    setTransactions((prev) => {
      const count = prev.filter((tx) => tx.status === 'Unposted').length;
      if (count === 0) return prev;
      toast.success('Transaksi berhasil diposting', {
        description: `${count} transaksi Unposted kini berstatus Posted`,
      });
      return prev.map((tx) => (tx.status === 'Unposted' ? { ...tx, status: 'Posted' } : tx));
    });
  };

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

  // [BARU] Buang seluruh transaksi lama milik `group`, ganti dengan `rows`
  // hasil import baru. Transaksi kelompok lain tetap dipertahankan apa
  // adanya — hanya baris yang getTransactionGroup()-nya cocok dengan
  // `group` yang dihapus.
  const replaceGroup = (group: TransactionGroup, rows: Transaction[]) => {
    setTransactions((prev) => [...rows, ...prev.filter((tx) => getTransactionGroup(tx) !== group)]);
  };

  const addTransaction = (tx: Transaction) => {
    setTransactions((prev) => [tx, ...prev]);
    toast.success('Jurnal baru ditambahkan', { description: `${tx.txId} berhasil dibuat` });
  };

  const postAllUnpostedInGroup = (group: TransactionGroup) => {
    setTransactions((prev) => {
      const count = prev.filter((tx) => tx.status === 'Unposted' && getTransactionGroup(tx) === group).length;
      if (count === 0) return prev;
      toast.success('Transaksi berhasil diposting', {
        description: `${count} transaksi Unposted kini berstatus Posted`,
      });
      return prev.map((tx) =>
        tx.status === 'Unposted' && getTransactionGroup(tx) === group ? { ...tx, status: 'Posted' } : tx
      );
    });
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
  };

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions() {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions harus dipakai di dalam TransactionsProvider (lihat src/app/transactions/layout.tsx)');
  return ctx;
}