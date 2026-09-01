import React from 'react';
import { TransactionsProvider } from './context/TransactionsContext';

// [BARU] Layout ini membungkus halaman Transaksi utama DAN ke-5 sub
// halamannya (sales, expense, cash-payment, cash-reserve, other) dengan satu
// TransactionsProvider yang sama, supaya semuanya berbagi data transaksi
// yang sama (state React tetap hidup selama masih di dalam /transactions/*,
// termasuk saat pindah antar sub halaman lewat sidebar).
export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return <TransactionsProvider>{children}</TransactionsProvider>;
}
