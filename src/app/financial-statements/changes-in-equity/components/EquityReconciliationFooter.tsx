'use client';
import React from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityStatement } from '../../lib/useStatementData';

export default function EquityReconciliationFooter() {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { summary: s, balanceSheetEquity } = useEquityStatement();
  const rp = (v: number) => (v < 0 ? `(${formatMoney(Math.abs(v) * 1_000_000, currency)})` : formatMoney(v * 1_000_000, currency));
  const mutasi = Math.round((s.closingEquity - s.openingEquity) * 100) / 100;
  const cocokNeraca = Math.abs(s.closingEquity - balanceSheetEquity) < 0.01;
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-5">
        {/* Reconciliation equation */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-primary" />
            <h2 className="text-[14px] font-bold text-foreground">{t('Equity Reconciliation')}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
            <div className="flex flex-col items-center p-3 rounded-lg bg-muted/60 border border-border min-w-[110px]">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">{t('Opening Equity')}</span>
              <span className="text-[15px] font-bold text-foreground tabular-nums">{rp(s.openingEquity)}</span>
            </div>
            <span className="text-xl font-light text-muted-foreground">+</span>
            <div className="flex flex-col items-center p-3 rounded-lg bg-muted/60 border border-border min-w-[110px]">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">{t('Total Movements')}</span>
              <span className={`text-[15px] font-bold tabular-nums ${mutasi >= 0 ? 'text-positive' : 'text-negative'}`}>{mutasi >= 0 ? '+' : ''}{rp(mutasi)}</span>
            </div>
            <span className="text-xl font-light text-muted-foreground">=</span>
            <div className="flex flex-col items-center p-3 rounded-lg bg-primary/5 border border-primary/20 min-w-[110px]">
              <span className="text-[9px] text-primary uppercase tracking-wide mb-1 font-semibold">{t('Closing Equity')}</span>
              <span className="text-[15px] font-bold text-primary tabular-nums">{rp(s.closingEquity)}</span>
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-col gap-2 lg:border-l lg:border-border lg:pl-5">
          <div className={`flex items-center gap-2.5 p-3 rounded-xl border ${cocokNeraca ? 'bg-[var(--positive-bg)] border-[var(--positive-light)]' : 'bg-[var(--negative-bg)] border-[var(--negative-light)]'}`}>
            <CheckCircle2 size={16} className={`${cocokNeraca ? 'text-positive' : 'text-negative'} flex-shrink-0`} />
            <div>
              <div className="text-[12px] font-bold text-foreground">{cocokNeraca ? t('Balanced ✓') : t('Not reconciled')}</div>
              <div className="text-[10px] text-muted-foreground">
                {cocokNeraca ? t('Closing equity matches the Balance Sheet') : `${t('Balance Sheet equity')}: ${rp(balanceSheetEquity)}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/5 border border-primary/15">
            <ShieldCheck size={15} className="text-primary flex-shrink-0" />
            <div>
              <div className="text-[11px] font-semibold text-foreground">{t('Posted transactions only')}</div>
              <div className="text-[10px] text-muted-foreground">{t('Draft transactions are excluded from actual statements')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}