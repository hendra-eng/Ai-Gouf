'use client';

import React from 'react';
import { Store, Receipt, Trophy } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import type { PurchaseTransaction } from '@/data/purchaseData';
import {
  PurchaseCardHeader, StatusPill, HEADER_CHIP_CLS, MINI_ROW_CLS, type PillStyle,
} from '@/app/transactions/purchase/components/PurchaseKpiTile';

// Kartu "Top Vendors by Spend" & "Recent Purchase Activity" di tab Overview Purchase.
// Isinya sama seperti sebelumnya (peringkat vendor + bar proporsi, 6 transaksi terakhir); tampilannya
// memakai tema elegant monokrom yang sama dengan kartu Top Customer & tabel Sales Overview:
// peringkat #1 hitam (ikon piala), lainnya abu; bar abu gelap; pill status lembut bertitik.

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export interface TopVendor { id: string; name: string; totalSpend: number; txCount: number }

export function PurchaseTopVendorsCard({ vendors }: { vendors: TopVendor[] }) {
  const { t } = useLanguage();
  const max = vendors[0]?.totalSpend || 1;
  return (
    <div className={`${salesFont.className} card-elevated-md flex h-full flex-col rounded-xl p-5`}>
      <PurchaseCardHeader icon={Store} title={t('Top Vendors by Spend')} subtitle={t('Based on purchase amount')} />
      {vendors.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-500">{t('Belum ada data.')}</p>
      ) : (
        <ul className="space-y-2">
          {vendors.map((v, idx) => {
            const first = idx === 0;
            const pct = Math.max(3, Math.round((v.totalSpend / max) * 100));
            const badge = first ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700';
            return (
              <li key={v.id} className={`${MINI_ROW_CLS} px-3 py-2.5`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ${badge}`}>
                      {first ? <Trophy size={12} /> : null}#{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900" title={v.name}>{v.name}</p>
                      <p className="text-[11px] font-medium text-neutral-500">
                        {v.txCount} transaction{v.txCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums tracking-tight text-neutral-900">{fmt(v.totalSpend)}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div className="h-full rounded-full bg-neutral-800" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Warna status: tint -100, teks -800, garis -300 -- selaras dengan STATUS_STYLE Sales Overview
// (Draft abu, Review kuning, Approved biru, Posted teal).
const STATUS_STYLE: Record<string, PillStyle> = {
  draft: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
  pending_review: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  approved: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  pending_posting: { pill: 'bg-sky-100 text-sky-800 border-sky-300', dot: 'bg-sky-600' },
  posted: { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' },
  rejected: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  exception: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  cancelled: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

export function PurchaseRecentActivityCard({ transactions }: { transactions: PurchaseTransaction[] }) {
  const { t } = useLanguage();
  return (
    <div className={`${salesFont.className} card-elevated-md flex h-full flex-col rounded-xl p-5`}>
      <PurchaseCardHeader
        icon={Receipt}
        title={t('Recent Purchase Activity')}
        subtitle={t('Latest purchase transactions')}
        right={<span className={HEADER_CHIP_CLS}>Last {transactions.length} transactions</span>}
      />
      {transactions.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-500">{t('Belum ada data.')}</p>
      ) : (
        <ul className="space-y-2">
          {transactions.map((tx) => (
            <li key={tx.id} className={`${MINI_ROW_CLS} flex items-start justify-between gap-3 px-3 py-2.5`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-blue-700">{tx.purchaseId}</span>
                  <StatusPill style={STATUS_STYLE[tx.status]} label={STATUS_LABEL[tx.status] ?? tx.status} />
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-neutral-900" title={tx.vendor}>{tx.vendor}</p>
                <p className="text-[11px] font-medium text-neutral-500">{tx.purchaseDate} · {tx.category}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums tracking-tight text-neutral-900">{fmt(tx.total)}</p>
                <p className="text-[11px] font-medium text-neutral-500">{tx.currency}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}