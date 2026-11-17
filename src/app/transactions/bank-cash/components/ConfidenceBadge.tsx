'use client';

// Badge keyakinan hasil ekstraksi rekening koran per baris (lihat
// backend modules/transactions/bank_statement_extractor.py):
//   high   -> terverifikasi saldo berjalan / total resmi rekening koran
//   medium -> tidak ada data untuk verifikasi
//   low    -> tidak cocok / angka meragukan -> wajib review (dilewati auto-match)
// Baris lama (sebelum fitur ini, confidence null) tidak diberi badge.

import React from 'react';
import { CONFIDENCE_LABEL, type Confidence } from '@/lib/bankCashStore';

const WARNA: Record<Confidence, { pill: string; dot: string }> = {
  high: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  medium: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
  low: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${WARNA[value].pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${WARNA[value].dot}`} />
      {CONFIDENCE_LABEL[value]}
    </span>
  );
}
