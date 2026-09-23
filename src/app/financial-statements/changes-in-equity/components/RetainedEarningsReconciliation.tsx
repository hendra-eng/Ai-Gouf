'use client';
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityStatement } from '../../lib/useStatementData';

export default function RetainedEarningsReconciliation() {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { retainedEarnings: re } = useEquityStatement();
  const rp = (v: number) => (v < 0 ? `(${formatMoney(Math.abs(v) * 1_000_000, currency)})` : formatMoney(v * 1_000_000, currency));
  const tanda = (v: number) => (v > 0 ? 'positive' : v < 0 ? 'negative' : null);

  const items = [
    { id: 'rec-1', label: 'Opening Retained Earnings', value: re.opening, sign: null, isResult: false },
    { id: 'rec-2', label: '+ Current Period Net Profit', value: re.netProfit, sign: tanda(re.netProfit), isResult: false },
    { id: 'rec-3', label: '− Dividends / Drawings', value: re.dividends, sign: tanda(re.dividends), isResult: false },
    { id: 'rec-4', label: '± Other Adjustments', value: re.adjustments, sign: tanda(re.adjustments), isResult: false },
    { id: 'rec-5', label: '= Closing Retained Earnings', value: re.closing, sign: null, isResult: true },
  ];
  const cocok = Math.abs(re.opening + re.netProfit + re.dividends + re.adjustments - re.closing) < 0.01;

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Retained Earnings Reconciliation')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('Movement from opening to closing balance')}</p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cocok ? 'bg-[var(--positive-bg)] text-positive border-[var(--positive-light)]' : 'bg-[var(--negative-bg)] text-negative border-[var(--negative-light)]'}`}>
          <CheckCircle2 size={9} />
          {cocok ? t('Reconciled') : t('Not reconciled')}
        </span>
      </div>

      <div className="space-y-1">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <div key={item.id}>
              {isLast && <div className="border-t-2 border-foreground/15 my-3" />}
              <div className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${
                item.isResult ? 'bg-primary/5 border border-primary/15' : 'hover:bg-muted/50'
              }`}>
                <span className={`text-[13px] ${item.isResult ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                  {t(item.label)}
                </span>
                <span className={`tabular-nums font-semibold text-[13px] ${
                  item.sign === 'positive' ? 'text-positive' :
                  item.sign === 'negative' ? 'text-negative' : item.isResult ? 'text-primary font-bold text-[15px]' : 'text-foreground'
                }`}>
                  {rp(item.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mt-4 p-3 rounded-lg border ${cocok ? 'bg-[var(--positive-bg)] border-[var(--positive-light)]' : 'bg-[var(--negative-bg)] border-[var(--negative-light)]'}`}>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className={`font-semibold ${cocok ? 'text-positive' : 'text-negative'}`}>{cocok ? t('✓ Verified:') : t('Check:')}</span>{' '}
          {t('Opening retained earnings of')} {rp(re.opening)} {t('plus current period movements reconcile to the closing balance of')} {rp(re.closing)}.
        </p>
      </div>
    </div>
  );
}
