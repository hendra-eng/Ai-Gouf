'use client';

// Sel tabel pelengkap untuk tab Cash Payment / Cash Receipt: mutasi bank dan jurnal yang melunasi invoice
// (dari hasil Reconciliation), plus badge "Dalam proses". Read-only: tidak mengubah sumber datanya.

import React from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import { sudahDiterapkan, tahapPembayaran, type PembayaranRekon } from '../lib/useBankCashRekon';

const VARIAN_TAHAP: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Diposting: 'positive',
  Disetujui: 'info',
  Draft: 'warning',
};

/** Mutasi bank yang melunasi invoice (satu baris per pembayaran). */
export function MutasiBankCell({ items }: { items: PembayaranRekon[] }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-1 max-w-[220px]">
      {items.map((p) => (
        <div key={p.id} className="text-xs leading-tight">
          <span className="font-mono">{formatDate(p.payment_date)}</span>
          <span className="text-muted-foreground"> · {p.bank_account || 'Bank'} · </span>
          <span className="font-mono font-semibold">{formatIDR(p.amount, true)}</span>
          {p.mutation_description ? (
            <span className="block truncate text-muted-foreground" title={p.mutation_description}>{p.mutation_description}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Nomor jurnal yang melunasi invoice + tahapnya; link ke Posted (sudah diposting) atau Journal Preview. */
export function JurnalCell({ items }: { items: PembayaranRekon[] }) {
  const ada = items.filter((p) => p.journal_no);
  if (!ada.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      {ada.map((p) => {
        const tahap = tahapPembayaran(p);
        const href = sudahDiterapkan(p) ? '/transactions/bank-cash/posted' : '/transactions/bank-cash/journal-preview';
        return (
          <div key={p.id} className="flex items-center gap-1.5 flex-wrap">
            <Link href={href} className="font-mono text-xs text-teal-600 hover:underline">{p.journal_no}</Link>
            <StatusBadge variant={VARIAN_TAHAP[tahap]} label={tahap} />
          </div>
        );
      })}
    </div>
  );
}

/** Badge "Dalam proses" kalau ada pembayaran yang sudah dicocokkan tetapi jurnalnya belum diposting. */
export function DalamProsesBadge({ nominal }: { nominal: number }) {
  if (nominal <= 0) return null;
  return (
    <span className="block mt-1" title="Sudah dicocokkan dengan mutasi bank, invoice berubah setelah jurnal diposting">
      <StatusBadge variant="info" label={`Dalam proses · ${formatIDR(nominal, true)}`} dot />
    </span>
  );
}