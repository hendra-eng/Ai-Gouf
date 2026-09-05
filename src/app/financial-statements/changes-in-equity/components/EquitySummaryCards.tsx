import React from 'react';
import {
  DollarSign, TrendingUp, TrendingDown,
  PlusCircle, MinusCircle, Activity,
} from 'lucide-react';

interface CardDef {
  id: string;
  label: string;
  value: string;
  desc: string;
  sub?: string;
  variant: 'neutral' | 'positive' | 'negative' | 'featured';
  icon: React.ReactNode;
}

const cards: CardDef[] = [
  {
    id: 'c-opening',
    label: 'OPENING EQUITY',
    value: '$8.42M',
    desc: 'Balance at beginning of period',
    variant: 'neutral',
    icon: <DollarSign size={15} />,
  },
  {
    id: 'c-profit',
    label: 'NET PROFIT',
    value: '+$1.84M',
    desc: 'Current period earnings',
    sub: '+12.4% vs prior period',
    variant: 'positive',
    icon: <TrendingUp size={15} />,
  },
  {
    id: 'c-capital',
    label: 'CAPITAL CONTRIBUTIONS',
    value: '+$750K',
    desc: 'Additional owner/shareholder capital',
    sub: 'New capital injection Jul 2026',
    variant: 'positive',
    icon: <PlusCircle size={15} />,
  },
  {
    id: 'c-dividends',
    label: 'DIVIDENDS',
    value: '($420K)',
    desc: 'Distributions during period',
    sub: 'Declared Jul 2026',
    variant: 'negative',
    icon: <MinusCircle size={15} />,
  },
  {
    id: 'c-adj',
    label: 'OTHER ADJUSTMENTS',
    value: '($85K)',
    desc: 'OCI and other equity movements',
    sub: 'FX translation loss',
    variant: 'negative',
    icon: <TrendingDown size={15} />,
  },
  {
    id: 'c-closing',
    label: 'CLOSING EQUITY',
    value: '$10.51M',
    desc: 'Balance at end of period',
    sub: '+$2.09M from opening',
    variant: 'featured',
    icon: <Activity size={15} />,
  },
];

export default function EquitySummaryCards() {
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
                  {card.label}
                </span>
                <span className="p-1 rounded-md bg-white/15">{card.icon}</span>
              </div>
              <div className="text-[22px] font-bold tabular-nums leading-tight text-primary-foreground">
                {card.value}
              </div>
              <div className="text-[11px] text-primary-foreground/70 leading-tight">{card.desc}</div>
              {card.sub && (
                <div className="text-[11px] font-semibold text-primary-foreground/90 mt-0.5">{card.sub}</div>
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
                {card.label}
              </span>
              <span className={`p-1 rounded-md ${iconBg}`}>{card.icon}</span>
            </div>
            <div className={`text-[20px] font-bold tabular-nums leading-tight ${valCls}`}>
              {card.value}
            </div>
            <div className="text-[11px] text-muted-foreground leading-tight">{card.desc}</div>
            {card.sub && (
              <div className={`text-[11px] font-medium mt-0.5 ${valCls}`}>{card.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}