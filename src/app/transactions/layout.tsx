import React from 'react';

// [DIUBAH] TransactionsProvider TIDAK lagi dipasang di sini — sudah
// dinaikkan ke src/components/AppLayout.tsx (bungkus seluruh aplikasi),
// supaya halaman di luar /transactions (khususnya Account Payable) bisa ikut
// berbagi state transaksi yang sama lewat useTransactions(). Kalau provider
// dipasang dua kali (di sini DAN di AppLayout), /transactions dan
// /accounts-payable akan punya dua instance data yang terpisah — Expense dan
// AP jadi TIDAK sinkron lagi. Layout ini disisakan sebagai passthrough saja
// supaya struktur folder Next.js (dan kemungkinan config per-route lain di
// masa depan) tetap utuh.
export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
