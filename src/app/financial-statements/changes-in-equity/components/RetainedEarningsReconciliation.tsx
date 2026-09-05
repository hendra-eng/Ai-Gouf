import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/language';

const items = [
  { id: 'rec-1', label: 'Opening Retained Earnings',   value: '1,980,000',  sign: null,       isResult: false },
  { id: 'rec-2', label: '+ Current Period Net Profit', value: '1,840,000',  sign: 'positive', isResult: false },
  { id: 'rec-3', label: '− Dividends Declared',        value: '(420,000)',  sign: 'negative', isResult: false },
  { id: 'rec-4', label: '± Other Adjustments',         value: '(35,000)',   sign: 'negative', isResult: false },
  { id: 'rec-5', label: '= Closing Retained Earnings', value: '3,365,000',  sign: null,       isResult: true  },
];

export default function RetainedEarningsReconciliation() {
  const { t } = useLanguage();
  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Retained Earnings Reconciliation')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('Movement from opening to closing balance')}</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)] text-[10px] font-semibold">
          <CheckCircle2 size={9} />
          {t('Reconciled')}
        </span>
      </div>

      <div className="space-y-1">
        {items?.map((item, idx) => {
          const isLast = idx === items?.length - 1;
          return (
            <div key={item?.id}>
              {isLast && <div className="border-t-2 border-foreground/15 my-3" />}
              <div className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${
                item?.isResult ? 'bg-primary/5 border border-primary/15' : 'hover:bg-muted/50'
              }`}>
                <span className={`text-[13px] ${item?.isResult ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                  {t(item?.label)}
                </span>
                <span className={`tabular-nums font-semibold text-[13px] ${
                  item?.sign === 'positive' ? 'text-positive' :
                  item?.sign === 'negative'? 'text-negative' : item?.isResult ?'text-primary font-bold text-[15px]': 'text-foreground'
                }`}>
                  {item?.value}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 bg-[var(--positive-bg)] border border-[var(--positive-light)] rounded-lg">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-positive">{t('✓ Verified:')}</span> {t('Opening retained earnings of $1,980,000 plus current period movements reconcile to the closing balance of $3,365,000.')}
        </p>
      </div>
    </div>
  );
}