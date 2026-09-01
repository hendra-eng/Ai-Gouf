'use client';
// [BARU] Sumber data transaksi TUNGGAL untuk seluruh halaman Transaksi
// (halaman utama /transactions + 5 sub halaman: Sales, Expense, Cash
// Payment, Cash Reserve, Other). Sebelumnya tiap sub halaman punya data
// dummy sendiri-sendiri yang tidak nyambung ke tabel di halaman utama.
// Sekarang `transactions` di sini adalah satu-satunya sumber: kalau ada
// transaksi baru ditambahkan/diimpor/diedit/diposting di halaman utama,
// seluruh sub halaman otomatis ikut berubah karena semuanya membaca dari
// context yang sama (dan sebaliknya juga berlaku).
import React, { createContext, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ALL_TRANSACTIONS, Transaction, TransactionGroup, getTransactionGroup } from '../components/transactionData';

interface TransactionsContextValue {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  unpostedCount: number;
  /** Timpa satu transaksi (dicocokkan lewat id) — dipakai TransactionEditModal. */
  saveEdit: (updated: Transaction) => void;
  /** Ubah status seluruh transaksi Unposted jadi Posted sekaligus. */
  postAllUnposted: () => void;
  /** Ganti seluruh tabel dengan hasil import rekening koran baru. */
  importTransactions: (rows: Transaction[]) => void;
  /** Ambil transaksi milik satu kelompok saja (Sales/Expense/dll), dipakai di 5 sub halaman. */
  getByGroup: (group: TransactionGroup) => Transaction[];
}

const TransactionsContext = createContext<TransactionsContextValue | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>(ALL_TRANSACTIONS);

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

  const value: TransactionsContextValue = {
    transactions,
    setTransactions,
    unpostedCount,
    saveEdit,
    postAllUnposted,
    importTransactions,
    getByGroup,
  };

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions() {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions harus dipakai di dalam TransactionsProvider (lihat src/app/transactions/layout.tsx)');
  return ctx;
}
