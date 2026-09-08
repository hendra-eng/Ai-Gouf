'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

const LPEBridgeChart = dynamic(() => import('./LPEBridgeChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[280px] w-full rounded-xl" />,
});

// Backend integration point: replace with /api/statements/equity?company=&period=
// Same period totals as the full Statement of Changes in Equity page — summarized
// to component-level totals only (no opening/capital/profit/dividend/adj split per row).
const lpeRows = [
  { label: 'Share Capital', opening: 5000, movement: 500, closing: 5500 },
  { label: 'Additional Paid-in Capital', opening: 1200, movement: 250, closing: 1450 },
  { label: 'Retained Earnings', opening: 1980, movement: 1385, closing: 3365 },
  { label: 'Other Comprehensive Income', opening: 140, movement: -50, closing: 90 },
  { label: 'Other Equity', opening: 100, movement: 0, closing: 100 },
];

const totals = { opening: 8420, movement: 2085, closing: 10505 };
const summaryCards = [
  { label: 'Opening Equity', value: totals.opening, color: 'text-foreground' },
  { label: 'Net Movement', value: totals.movement, color: 'text-positive', prefix: '+' },
  { label: 'Closing Equity', value: totals.closing, color: 'text-primary' },
];

export default function LPEStatement() {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const growthPct = ((totals.movement / totals.opening) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Bridge chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-base font-bold text-foreground mb-1">{t('Equity Movement Bridge')}</h3>
        <p className="text-xs text-muted-foreground mb-4">{t('How opening equity changed to closing equity — Jan to Aug 2026')}</p>
        <LPEBridgeChart />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((c) => (
          <div key={`lpesum-${c.label}`} className="card-elevated rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t(c.label)}</p>
            <p className={`text-xl font-bold font-mono ${c.color}`}>
              {c.prefix || ''}{formatRp(c.value)}
            </p>
          </div>
        ))}
        <div className="card-elevated rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t('Equity Growth')}</p>
          <p className="text-xl font-bold font-mono text-positive">+{growthPct}%</p>
        </div>
      </div>

      {/* Simplified statement table */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">{t('Laporan Perubahan Ekuitas')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Periode: Januari – Agustus 2026 · Ringkasan per komponen ekuitas')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Equity Component')}</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Opening Balance')}</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Net Movement')}</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Closing Balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lpeRows.map((row) => (
                <tr key={row.label} className="hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{t(row.label)}</td>
                  <td className="px-5 py-3 text-right text-sm font-mono text-muted-foreground">{formatRp(row.opening)}</td>
                  <td className={`px-5 py-3 text-right text-sm font-mono ${row.movement > 0 ? 'text-positive' : row.movement < 0 ? 'text-negative' : 'text-muted-foreground'}`}>
                    {row.movement === 0 ? '—' : `${row.movement > 0 ? '+' : '−'}${formatRp(Math.abs(row.movement))}`}
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-semibold font-mono text-foreground">{formatRp(row.closing)}</td>
                </tr>
              ))}
              <tr className="bg-primary/5 border-t-2 border-primary/20">
                <td className="px-5 py-3 text-sm font-bold text-primary">{t('TOTAL EQUITY')}</td>
                <td className="px-5 py-3 text-right text-sm font-bold font-mono text-primary">{formatRp(totals.opening)}</td>
                <td className="px-5 py-3 text-right text-sm font-bold font-mono text-positive">+{formatRp(totals.movement)}</td>
                <td className="px-5 py-3 text-right text-base font-bold font-mono text-primary">{formatRp(totals.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{t('Detail per transaksi (kontribusi modal, dividen, laba berjalan, penyesuaian OCI) tersedia di halaman lengkap.')}</p>
          <Link href="/financial-statements/changes-in-equity" className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 flex-shrink-0 ml-4">
            {t('View Full Statement')}
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
