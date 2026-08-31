'use client';
import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, ArrowRight } from 'lucide-react';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

// Backend integration point: replace with /api/transactions/recent?limit=8
const recentTxs = [
  { id: 'tx-001', date: '25 Aug', txId: 'TXN-2026-08502', description: 'Pembayaran Invoice #INV-2026-0342', party: 'PT Teknindo Maju', amount: 'Rp 320.000.000', type: 'credit' as const, category: 'Revenue', status: 'Posted' },
  { id: 'tx-002', date: '25 Aug', txId: 'TXN-2026-08498', description: 'Pembayaran Gaji Agustus 2026', party: 'Payroll', amount: 'Rp 485.000.000', type: 'debit' as const, category: 'Payroll', status: 'Posted' },
  { id: 'tx-003', date: '24 Aug', txId: 'TXN-2026-08491', description: 'Pembelian Software License Q3', party: 'PT Mitra Digital', amount: 'Rp 42.500.000', type: 'debit' as const, category: 'Software', status: 'Posted' },
  { id: 'tx-004', date: '24 Aug', txId: 'TXN-2026-08488', description: 'Pembayaran Sewa Kantor Jakarta', party: 'PT Graha Sentosa', amount: 'Rp 95.000.000', type: 'debit' as const, category: 'Rent', status: 'Posted' },
  { id: 'tx-005', date: '23 Aug', txId: 'TXN-2026-08475', description: 'Penerimaan DP Proyek #PRJ-0088', party: 'PT Cahaya Nusantara', amount: 'Rp 180.000.000', type: 'credit' as const, category: 'Revenue', status: 'Posted' },
  { id: 'tx-006', date: '23 Aug', txId: 'TXN-2026-08469', description: 'Pembayaran PPN Masa Juli 2026', party: 'Direktorat Pajak', amount: 'Rp 28.400.000', type: 'debit' as const, category: 'Tax', status: 'Posted' },
  { id: 'tx-007', date: '22 Aug', txId: 'TXN-2026-08455', description: 'Biaya Iklan & Promosi Agustus', party: 'Meta Ads Indonesia', amount: 'Rp 38.000.000', type: 'debit' as const, category: 'Marketing', status: 'Posted' },
  { id: 'tx-008', date: '22 Aug', txId: 'TXN-2026-08448', description: 'Pembayaran Invoice #INV-2026-0339', party: 'CV Solusi Kreatif', amount: 'Rp 75.000.000', type: 'credit' as const, category: 'Revenue', status: 'Posted' },
];

const categoryColors: Record<string, string> = {
  Revenue: 'badge-positive',
  Payroll: 'badge-neutral',
  Software: 'badge-info',
  Rent: 'badge-neutral',
  Tax: 'badge-warning',
  Marketing: 'badge-warning',
  Default: 'badge-neutral',
};

export default function RecentTransactionsMini() {
  const { fx } = useCurrency();
  const { t } = useLanguage();
  return (
    <div className="card-elevated-md rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-bold text-foreground">{t('Recent Transactions')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Latest 8 posted journal entries')}</p>
        </div>
        <Link href="/transactions" className="btn-ghost text-xs py-1.5">
          {t('View All')}
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('Date')}</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('TX ID')}</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Description')}</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('Party')}</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('Category')}</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('Amount')}</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{t('Type')}</th>
            </tr>
          </thead>
          <tbody>
            {recentTxs.map((tx, i) => (
              <tr key={tx.id} className={`border-b border-border table-row-hover ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                <td className="px-5 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{tx.date}</td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono text-primary">{tx.txId}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-foreground truncate max-w-[240px]">{t(tx.description)}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{tx.party}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={categoryColors[tx.category] || categoryColors.Default}>
                    {t(tx.category)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-sm font-semibold font-mono ${tx.type === 'credit' ? 'text-positive' : 'text-foreground'}`}>
                    {tx.type === 'debit' ? '−' : '+'}{fx(tx.amount)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className={`flex items-center gap-1 text-xs font-semibold ${tx.type === 'credit' ? 'text-positive' : 'text-muted-foreground'}`}>
                    {tx.type === 'credit'
                      ? <ArrowDownLeft size={13} />
                      : <ArrowUpRight size={13} />}
                    {tx.type === 'credit' ? t('Credit') : t('Debit')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
