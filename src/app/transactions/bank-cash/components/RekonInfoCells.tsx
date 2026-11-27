'use client';

// Sel tabel pelengkap untuk tab Cash Payment / Cash Receipt: mutasi bank dan jurnal yang melunasi invoice
// (dari hasil Reconciliation), plus badge "Dalam proses". Read-only: tidak mengubah sumber datanya.

import React from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDate } from '../../lib/groupAnalytics';
import { formatIDR } from '../lib/formatMoney';
import { sudahDiterapkan, tahapPembayaran, type PembayaranRekon } from '../lib/useBankCashRekon';

const VARIAN_TAHAP: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Posted: 'positive',
  Approved: 'info',
  Draft: 'warning',
};

/** Mutasi bank yang melunasi invoice (satu baris per pembayaran). */
export function MutasiBankCell({ items }: { items: PembayaranRekon[] }) {
  if (!items.length) return <span className="text-xs text-neutral-500">—</span>;
  return (
    <div className="space-y-1 max-w-[220px]">
      {items.map((p) => (
        <div key={p.id} className="text-xs leading-tight">
          <span className="tabular-nums">{formatDate(p.payment_date)}</span>
          <span className="text-neutral-500"> · {p.bank_account || 'Bank'} · </span>
          <span className="tabular-nums font-semibold">{formatIDR(p.amount, true)}</span>
          {p.mutation_description ? (
            <span className="block truncate text-neutral-500" title={p.mutation_description}>{p.mutation_description}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Nomor jurnal yang melunasi invoice + tahapnya; link ke Posted (sudah diposting) atau Journal Preview. */
export function JurnalCell({ items }: { items: PembayaranRekon[] }) {
  const ada = items.filter((p) => p.journal_no);
  if (!ada.length) return <span className="text-xs text-neutral-500">—</span>;
  return (
    <div className="space-y-1">
      {ada.map((p) => {
        const tahap = tahapPembayaran(p);
        const href = sudahDiterapkan(p) ? '/transactions/bank-cash/posted' : '/transactions/bank-cash/journal-preview';
        return (
          <div key={p.id} className="flex items-center gap-1.5 flex-wrap">
            <Link href={href} className="tabular-nums text-xs text-neutral-700 hover:underline">{p.journal_no}</Link>
            <StatusBadge variant={VARIAN_TAHAP[tahap]} label={tahap} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Catatan kecil di bawah angka Paid/Received:
 *  - `outside` > 0: sebagian nominal tercatat sudah dibayar TANPA transaksi Cash & Bank (saldo awal, tunai saat import,
 *    atau ditandai lunas manual), jadi tidak punya mutasi bank/jurnal di kolom sebelah.
 *  - `mismatch`: catatan paid_amount di invoice tertinggal dari pembayaran yang sudah diposting. Angkanya tetap benar
 *    (mengikuti pembayaran yang diposting); ini hanya penanda supaya data lamanya bisa dirapikan.
 */
export function PaidNote({ outside, mismatch }: { outside: number; mismatch: boolean }) {
  if (outside <= 0.005 && !mismatch) return null;
  return (
    <span className="mt-1 block space-y-0.5 text-[10px] font-normal leading-tight text-neutral-500">
      {outside > 0.005 ? (
        <span
          className="block"
          title="Counted as paid but not through a Cash & Bank transaction (opening balance, cash sale at import, or marked paid manually), so there is no bank line or journal for it."
        >
          incl. {formatIDR(outside, true)} outside Cash & Bank
        </span>
      ) : null}
      {mismatch ? (
        <span
          className="block text-amber-700"
          title="The paid amount stored on the invoice is behind the posted payments. The figures shown follow the posted payments."
        >
          stored paid record is behind
        </span>
      ) : null}
    </span>
  );
}

/** Badge "Dalam proses" kalau ada pembayaran yang sudah dicocokkan tetapi jurnalnya belum diposting. */
export function DalamProsesBadge({ nominal }: { nominal: number }) {
  if (nominal <= 0) return null;
  return (
    <span className="block mt-1" title="Matched to a bank line; the invoice is updated once the journal is posted">
      <StatusBadge variant="info" label={`In process · ${formatIDR(nominal, true)}`} dot />
    </span>
  );
}