'use client';
import React from 'react';
import {
  DollarSign, TrendingUp, TrendingDown,
  PlusCircle, MinusCircle, Activity,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityStatement } from '../../lib/useStatementData';

interface CardDef {
  id: string;
  label: string;
  value: string;
  desc: string;
  sub?: string;
  variant: 'neutral' | 'positive' | 'negative' | 'featured';
  icon: React.ReactNode;
}

export default function EquitySummaryCards() {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { summary: s } = useEquityStatement();
  const rp = (v: number) => formatMoney(Math.abs(v) * 1_000_000, currency);
  const bertanda = (v: number) => (v < 0 ? `(${rp(v)})` : `+${rp(v)}`);
  const varian = (v: number): CardDef['variant'] => (v < 0 ? 'negative' : 'positive');
  const selisih = s.closingEquity - s.openingEquity;
  const cards: CardDef[] = [
    { id: 'c-opening', label: 'OPENING EQUITY', value: s.openingEquity < 0 ? `(${rp(s.openingEquity)})` : rp(s.openingEquity), desc: 'Balance at beginning of period', variant: 'neutral', icon: <DollarSign size={15} /> },
    { id: 'c-profit', label: 'NET PROFIT', value: bertanda(s.netProfit), desc: 'Current period earnings', variant: varian(s.netProfit), icon: s.netProfit < 0 ? <TrendingDown size={15} /> : <TrendingUp size={15} /> },
    { id: 'c-capital', label: 'CAPITAL CONTRIBUTIONS', value: bertanda(s.capitalContributions), desc: 'Additional owner/shareholder capital', variant: varian(s.capitalContributions), icon: <PlusCircle size={15} /> },
    { id: 'c-dividends', label: 'DIVIDENDS', value: bertanda(s.dividends), desc: 'Distributions during period', variant: s.dividends < 0 ? 'negative' : 'neutral', icon: <MinusCircle size={15} /> },
    { id: 'c-adj', label: 'OTHER ADJUSTMENTS', value: bertanda(s.otherAdjustments), desc: 'Other equity movements', variant: varian(s.otherAdjustments), icon: <TrendingDown size={15} /> },
    {
      id: 'c-closing', label: 'CLOSING EQUITY', value: s.closingEquity < 0 ? `(${rp(s.closingEquity)})` : rp(s.closingEquity),
      desc: 'Balance at end of period', sub: `${selisih < 0 ? '−' : '+'}${rp(selisih)} ${t('from opening')}`, variant: 'featured', icon: <Activity size={15} />,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(card => {
        if (card.variant === 'featured') {
          return (
            <div
              key={card.id}
              className="rounded-xl p-4 bg-primary text-primary-foreground shadow-elevated col-span-1 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/70">
                  {t(card.label)}
                </span>
                <span className="p-1 rounded-md bg-white/15">{card.icon}</span>
              </div>
              <div className="text-[22px] font-bold tabular-nums leading-tight text-primary-foreground">
                {card.value}
              </div>
              <div className="text-[11px] text-primary-foreground/70 leading-tight">{t(card.desc)}</div>
              {card.sub && (
                <div className="text-[11px] font-semibold text-primary-foreground/90 mt-0.5">{t(card.sub)}</div>
              )}
            </div>
          );
        }

        const borderCls =
          card.variant === 'positive' ? 'border-[var(--positive-light)]' :
          card.variant === 'negative' ? 'border-[var(--negative-light)]' :
          'border-border';
        const bgCls =
          card.variant === 'positive' ? 'bg-[var(--positive-bg)]' :
          card.variant === 'negative' ? 'bg-[var(--negative-bg)]' :
          'bg-card';
        const valCls =
          card.variant === 'positive' ? 'text-positive' :
          card.variant === 'negative'? 'text-negative' : 'text-foreground';
        const iconBg =
          card.variant === 'positive' ? 'bg-[var(--positive-light)] text-positive' :
          card.variant === 'negative' ? 'bg-[var(--negative-light)] text-negative' :
          'bg-muted text-muted-foreground';

        return (
          <div key={card.id} className={`kpi-card border ${borderCls} ${bgCls} flex flex-col gap-1.5`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t(card.label)}
              </span>
              <span className={`p-1 rounded-md ${iconBg}`}>{card.icon}</span>
            </div>
            <div className={`text-[20px] font-bold tabular-nums leading-tight ${valCls}`}>
              {card.value}
            </div>
            <div className="text-[11px] text-muted-foreground leading-tight">{t(card.desc)}</div>
            {card.sub && (
              <div className={`text-[11px] font-medium mt-0.5 ${valCls}`}>{t(card.sub)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}