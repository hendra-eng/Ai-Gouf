'use client';
import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/language';

interface Detail { id: string; label: string; value: string; sign?: 'pos' | 'neg' | null }
interface Account {
  id: string; name: string; opening: string; closing: string;
  movement: string; movSign: 'pos' | 'neg' | 'neutral';
  details: Detail[];
}

const accounts: Account[] = [
  {
    id: 'a-sc', name: 'Share Capital',
    opening: '$5,000,000', closing: '$5,500,000', movement: '+$500,000', movSign: 'pos',
    details: [
      { id: 'sc-d1', label: 'Opening Balance',                    value: '5,000,000' },
      { id: 'sc-d2', label: 'Capital Contributions — Jul 2026',   value: '500,000',  sign: 'pos' },
      { id: 'sc-d3', label: 'Other Adjustments',                  value: '—' },
      { id: 'sc-d4', label: 'Closing Balance',                    value: '5,500,000' },
    ],
  },
  {
    id: 'a-ap', name: 'Additional Paid-in Capital',
    opening: '$1,200,000', closing: '$1,450,000', movement: '+$250,000', movSign: 'pos',
    details: [
      { id: 'ap-d1', label: 'Opening Balance',                   value: '1,200,000' },
      { id: 'ap-d2', label: 'Share Premium — New Issue Jul 2026',value: '250,000',  sign: 'pos' },
      { id: 'ap-d3', label: 'Closing Balance',                   value: '1,450,000' },
    ],
  },
  {
    id: 'a-re', name: 'Retained Earnings',
    opening: '$1,980,000', closing: '$3,365,000', movement: '+$1,385,000', movSign: 'pos',
    details: [
      { id: 're-d1', label: 'Opening Balance',          value: '1,980,000' },
      { id: 're-d2', label: 'Net Profit for Period',    value: '1,840,000', sign: 'pos' },
      { id: 're-d3', label: 'Dividends Declared',       value: '(420,000)', sign: 'neg' },
      { id: 're-d4', label: 'Other Adjustments',        value: '(35,000)',  sign: 'neg' },
      { id: 're-d5', label: 'Closing Balance',          value: '3,365,000' },
    ],
  },
  {
    id: 'a-oci', name: 'Other Comprehensive Income',
    opening: '$140,000', closing: '$90,000', movement: '($50,000)', movSign: 'neg',
    details: [
      { id: 'oci-d1', label: 'Opening Balance',                   value: '140,000' },
      { id: 'oci-d2', label: 'Foreign Currency Translation Loss', value: '(32,000)', sign: 'neg' },
      { id: 'oci-d3', label: 'Fair Value Revaluation',            value: '(18,000)', sign: 'neg' },
      { id: 'oci-d4', label: 'Closing Balance',                   value: '90,000' },
    ],
  },
  {
    id: 'a-oe', name: 'Other Equity',
    opening: '$100,000', closing: '$100,000', movement: '$0', movSign: 'neutral',
    details: [
      { id: 'oe-d1', label: 'Opening Balance',              value: '100,000' },
      { id: 'oe-d2', label: 'No movements during period',   value: '—' },
      { id: 'oe-d3', label: 'Closing Balance',              value: '100,000' },
    ],
  },
];

export default function EquityAccountBreakdown() {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggle = (id: string) =>
    setExpanded(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-[14px] font-bold text-foreground">{t('Equity Account Details')}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">{t('Click any account to view supporting movements')}</p>
      </div>

      <div className="divide-y divide-border">
        {accounts.map(acct => {
          const isOpen = expanded.includes(acct.id);
          const movCls = acct.movSign === 'pos' ? 'text-positive' : acct.movSign === 'neg' ? 'text-negative' : 'text-muted-foreground';

          return (
            <div key={acct.id}>
              <button
                onClick={() => toggle(acct.id)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/40 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <ChevronRight
                    size={14}
                    className={`text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="text-[13px] font-semibold text-foreground">{t(acct.name)}</span>
                </div>
                <div className="flex items-center gap-6 text-[12px] tabular-nums">
                  <div className="hidden sm:block text-right">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">{t('Opening')}</div>
                    <div className="font-medium text-foreground">{acct.opening}</div>
                  </div>
                  <div className="hidden md:block text-right">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">{t('Movement')}</div>
                    <div className={`font-semibold ${movCls}`}>{acct.movement}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">{t('Closing')}</div>
                    <div className="font-bold text-foreground">{acct.closing}</div>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 pt-2 bg-muted/20 border-t border-border/50 fade-in">
                  <div className="max-w-md space-y-0.5">
                    {acct.details.map((d, di) => {
                      const isLast = di === acct.details.length - 1;
                      return (
                        <div key={d.id}>
                          {isLast && <div className="border-t border-border/60 my-2" />}
                          <div className={`flex items-center justify-between py-2 px-3 rounded-lg ${isLast ? 'bg-primary/5' : 'hover:bg-muted/50'} transition-colors`}>
                            <span className={`text-[12px] ${isLast ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                              {t(d.label)}
                            </span>
                            <span className={`text-[12px] tabular-nums font-semibold ${
                              d.sign === 'pos' ? 'text-positive' :
                              d.sign === 'neg'? 'text-negative' : isLast ?'text-primary font-bold' :
                              d.value === '—' ? 'text-muted-foreground/40' :
                              'text-foreground'
                            }`}>
                              {d.value}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}