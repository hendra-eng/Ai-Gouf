'use client';

import React from 'react';
import { BankFeedProvider } from './context/BankFeedContext';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

// [BARU] Supaya state mock Bank Feed (lihat context/BankFeedContext.tsx)
// bisa dibaca bareng oleh tab Bank Feed & Reconciliation tanpa hilang saat
// pindah tab. Tidak mengubah apa pun di tab Cash Payment/Cash Receipt yang
// sudah ada — keduanya tetap render <CashBankTabs /> sendiri seperti semula.
export default function BankCashLayout({ children }: { children: React.ReactNode }) {
  // Font Inter + padding/lebar konten yang sama dengan halaman Sales (SalesClient.tsx),
  // berlaku untuk semua tab Cash & Bank (judul, deskripsi, tab, tabel, modal).
  return (
    <BankFeedProvider>
      <div className={`${salesFont.className} px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto`}>{children}</div>
    </BankFeedProvider>
  );
}