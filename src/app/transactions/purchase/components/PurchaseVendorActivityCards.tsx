'use client';

import React from 'react';
import { Store, Receipt } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import type { PurchaseTransaction } from '@/data/purchaseData';

// Kartu "Top Vendors by Spend" & "Recent Purchase Activity" di tab Overview Purchase.
// Isinya sama seperti sebelumnya (peringkat vendor + bar proporsi, 6 transaksi terakhir);
// tampilannya disamakan dengan kartu Overview lain / Sales: card-elevated-md, header ber-ikon,
// baris bergaya kartu mini dengan hover hijau, palet hijau brand.

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function CardHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ElementType; title: string; subtitle?: string; right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm ring-1 ring-white">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export interface TopVendor { id: string; name: string; totalSpend: number; txCount: number }

export function PurchaseTopVendorsCard({ vendors }: { vendors: TopVendor[] }) {
  const { t } = useLanguage();
  const max = vendors[0]?.totalSpend || 1;
  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <CardHeader icon={Store} title={t('Top Vendors by Spend')} subtitle={t('Based on purchase amount')} />
      {vendors.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <ul className="space-y-2">
          {vendors.map((v, idx) => {
            const pct = Math.max(3, Math.round((v.totalSpend / max) * 100));
            return (
              <li
                key={v.id}
                className="group relative overflow-hidden rounded-[10px] border border-primary/30 bg-gradient-to-br from-white via-white to-[#F0FDF7] px-3 py-2.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-transparent hover:shadow-md"
              >
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#0F7D4E] to-[#0B5E5C] opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100" />
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full bg-[#D1FAE5] px-1.5 text-[11px] font-extrabold text-[#065F46] transition-colors duration-300 group-hover:bg-white/20 group-hover:text-white">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground transition-colors duration-300 group-hover:text-white" title={v.name}>{v.name}</p>
                      <p className="text-[11px] font-semibold text-slate-500 transition-colors duration-300 group-hover:text-white/75">
                        {v.txCount} transaction{v.txCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#064E3B] transition-colors duration-300 group-hover:text-white">{fmt(v.totalSpend)}</span>
                </div>
                <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 transition-colors duration-300 group-hover:bg-white/20">
                  <div className="h-full rounded-full bg-[#0F7D4E] transition-colors duration-300 group-hover:bg-white" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-[#D1FAE5] text-[#065F46]',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
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
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <CardHeader
        icon={Receipt}
        title={t('Recent Purchase Activity')}
        subtitle={t('Latest purchase transactions')}
        right={
          <span className="shrink-0 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-bold text-[#047857] ring-1 ring-[#A7F3D0]">
            Last {transactions.length} transactions
          </span>
        }
      />
      {transactions.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <ul className="space-y-2">
          {transactions.map((tx) => (
            <li
              key={tx.id}
              className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-slate-50/50 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-[#ECFDF5]/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[#047857]">{tx.purchaseId}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_PILL[tx.status] ?? 'bg-slate-100 text-slate-700'}`}>
                    {STATUS_LABEL[tx.status] ?? tx.status}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-foreground" title={tx.vendor}>{tx.vendor}</p>
                <p className="text-[11px] font-medium text-slate-500">{tx.purchaseDate} · {tx.category}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-extrabold tabular-nums text-[#064E3B]">{fmt(tx.total)}</p>
                <p className="text-[11px] font-semibold text-slate-500">{tx.currency}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}