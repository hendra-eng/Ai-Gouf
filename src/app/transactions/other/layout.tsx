import React from 'react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

// Semua tab & halaman di Other (Overview, Categories, Review Queue, Journal Preview,
// Exceptions, Posted, Source Data, Transaction, Create) memakai font yang sama dengan
// halaman Sales (Inter). Ganti font di salesFont.ts untuk mengubah keduanya sekaligus.
export default function OtherLayout({ children }: { children: React.ReactNode }) {
  return <div className={salesFont.className}>{children}</div>;
}