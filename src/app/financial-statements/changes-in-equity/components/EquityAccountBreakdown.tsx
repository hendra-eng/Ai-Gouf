'use client';
import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityStatement } from '../../lib/useStatementData';

interface Detail { id: string; label: string; value: string; sign?: 'pos' | 'neg' | null }
interface Account {
  id: string; name: string; opening: string; closing: string;
  movement: string; movSign: 'pos' | 'neg' | 'neutral';
  details: Detail[];
}

export default function EquityAccountBreakdown() {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggle = (id: string) =>
    setExpanded(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);
  const { currency } = useCurrency();
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { rows } = useEquityStatement();
  const rp = (v: number) => (v < 0 ? `(${formatMoney(Math.abs(v) * 1_000_000, currency)})` : formatMoney(v * 1_000_000, currency));
  const tanda = (v: number): 'pos' | 'neg' | null => (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : null);
  const accounts: Account[] = rows.map((r) => {
    const mutasi = Math.round((r.closing - r.opening) * 100) / 100;
    const details: Detail[] = [{ id: `${r.key}-open`, label: 'Opening Balance', value: rp(r.opening) }];
    if (r.accounts.length > 0) {
      r.accounts.forEach((a, i) => details.push({
        id: `${r.key}-acc-${i}`,
        label: `${a.code ? `${a.code} · ` : ''}${a.name}`,
        value: Math.abs(a.movement) < 0.005 ? '—' : `${a.movement > 0 ? '+' : ''}${rp(a.movement)}`,
        sign: tanda(a.movement),
      }));
    } else if (Math.abs(mutasi) >= 0.005) {
      details.push({ id: `${r.key}-mov`, label: r.key === 'laba_berjalan' ? 'Net Profit for Period' : 'Movement', value: `${mutasi > 0 ? '+' : ''}${rp(mutasi)}`, sign: tanda(mutasi) });
    }
    details.push({ id: `${r.key}-close`, label: 'Closing Balance', value: rp(r.closing) });
    return {
      id: r.key, name: r.label, opening: rp(r.opening), closing: rp(r.closing),
      movement: `${mutasi > 0 ? '+' : ''}${rp(mutasi)}`,
      movSign: mutasi > 0.004 ? 'pos' : mutasi < -0.004 ? 'neg' : 'neutral',
      details,
    };
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-[14px] font-bold text-foreground">{t('Equity Account Details')}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">{t('Click any account to view supporting movements')}</p>
      </div>

      <div className="divide-y divide-border">
        {accounts.length === 0 && (
          <div className="px-5 py-6 text-center text-[12px] text-muted-foreground">{t('Belum ada saldo ekuitas dari transaksi posted.')}</div>
        )}
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