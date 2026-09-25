'use client';

import React from 'react';
import { BankFeedProvider } from './context/BankFeedContext';

// [BARU] Supaya state mock Bank Feed (lihat context/BankFeedContext.tsx)
// bisa dibaca bareng oleh tab Bank Feed & Reconciliation tanpa hilang saat
// pindah tab. Tidak mengubah apa pun di tab Cash Payment/Cash Receipt yang
// sudah ada — keduanya tetap render <CashBankTabs /> sendiri seperti semula.
export default function BankCashLayout({ children }: { children: React.ReactNode }) {
  return <BankFeedProvider>{children}</BankFeedProvider>;
}
