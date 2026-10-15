'use client';

// Badge keyakinan hasil ekstraksi rekening koran per baris (lihat
// backend modules/transactions/bank_statement_extractor.py):
//   high   -> terverifikasi saldo berjalan / total resmi rekening koran
//   medium -> tidak ada data untuk verifikasi
//   low    -> tidak cocok / angka meragukan -> wajib review (dilewati auto-match)
// Baris lama (sebelum fitur ini, confidence null) tidak diberi badge.

import React from 'react';
import { CONFIDENCE_LABEL, type Confidence } from '@/lib/bankCashStore';

const WARNA: Record<Confidence, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-slate-50 text-slate-600 border-slate-200',
  low: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function ConfidenceBadge({ value, notes, hideHigh = false }: {
  value: Confidence | null | undefined;
  notes?: string[];
  /** Sembunyikan badge untuk baris terverifikasi (tabel yang ramai). */
  hideHigh?: boolean;
}) {
  if (!value || (hideHigh && value === 'high')) return null;
  return (
    <span
      title={notes && notes.length ? notes.join('\n') : undefined}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${WARNA[value]}`}
    >
      {CONFIDENCE_LABEL[value]}
    </span>
  );
}
