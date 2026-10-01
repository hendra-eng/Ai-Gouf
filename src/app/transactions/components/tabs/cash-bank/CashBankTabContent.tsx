'use client';
// Tab "Cash & Bank" di halaman Transaksi dulu berisi data dummy. Modul aslinya ada di
// /transactions/bank-cash (Overview, Cash Payment, Cash Receipt, Bank Feed, Reconciliation,
// Journal Preview, Exceptions, Posted), jadi tab ini hanya mengarahkan ke sana.
import React from 'react';
import Link from 'next/link';

export default function CashBankTabContent() {
  return (
    <div className="card-elevated-md rounded-xl p-8 text-center">
      <h2 className="text-base font-bold text-foreground">Cash &amp; Bank</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
        Rekonsiliasi bank, Cash Payment/Receipt, dan jurnal kas sekarang ada di modul Cash &amp; Bank tersendiri.
      </p>
      <Link
        href="/transactions/bank-cash"
        className="inline-flex mt-4 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold"
      >
        Buka Cash &amp; Bank
      </Link>
    </div>
  );
}
