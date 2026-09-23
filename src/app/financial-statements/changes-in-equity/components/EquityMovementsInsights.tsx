'use client';
import React from 'react';
import { TrendingUp, TrendingDown, Lightbulb, Info } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityStatement } from '../../lib/useStatementData';

const WARNA_KOMPOSISI = ['bg-primary', 'bg-primary/50', 'bg-positive', 'bg-muted-foreground', 'bg-border', 'bg-warning'];

export default function EquityMovementInsights() {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { summary: s, rows, periodLabel } = useEquityStatement();
  const rp = (v: number) => formatMoney(Math.abs(v) * 1_000_000, currency);

  const mutasi = [
    { label: 'Net Profit', value: s.netProfit },
    { label: 'Capital Contributions', value: s.capitalContributions },
    { label: 'Dividends / Drawings', value: s.dividends },
    { label: 'Other Adjustments', value: s.otherAdjustments },
  ];
  const positifTerbesar = mutasi.filter((m) => m.value > 0).sort((a, b) => b.value - a.value)[0];
  const negatifTerbesar = mutasi.filter((m) => m.value < 0).sort((a, b) => a.value - b.value)[0];
  const selisih = s.closingEquity - s.openingEquity;

  // Komposisi = porsi |saldo akhir| tiap komponen (ekuitas negatif tetap terbaca porsinya).
  const totalAbs = rows.reduce((sum, r) => sum + Math.abs(r.closing), 0);
  const composition = rows
    .filter((r) => Math.abs(r.closing) >= 0.005)
    .map((r, i) => ({ id: r.key, label: r.label, pct: totalAbs ? Math.round((Math.abs(r.closing) / totalAbs) * 1000) / 10 : 0, color: WARNA_KOMPOSISI[i % WARNA_KOMPOSISI.length] }));

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <Lightbulb size={14} className="text-primary" />
        </div>
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Equity Movement Analysis')}</h2>
          <p className="text-[11px] text-muted-foreground">{periodLabel}</p>
        </div>
      </div>

      <div className="p-3 bg-muted/50 rounded-xl border border-border/60">
        <p className="text-[12px] text-foreground leading-relaxed">
          {selisih >= 0 ? t('Closing equity increased by') : t('Closing equity decreased by')}{' '}
          <span className={`font-semibold ${selisih >= 0 ? 'text-positive' : 'text-negative'}`}>
            {rp(selisih)}{s.growthPct != null ? ` (${s.growthPct >= 0 ? '+' : ''}${s.growthPct.toFixed(1)}%)` : ''}
          </span>{' '}
          {t('with current-period net profit/(loss) of')}{' '}
          <span className="font-semibold">{s.netProfit < 0 ? `(${rp(s.netProfit)})` : rp(s.netProfit)}</span>.
        </p>
      </div>

      <div className="space-y-2">
        {positifTerbesar && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--positive-bg)] border border-[var(--positive-light)]">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-[var(--positive-light)]">
                <TrendingUp size={12} className="text-positive" />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">{t('Largest Positive Movement')}</div>
                <div className="text-[12px] font-semibold text-foreground">{t(positifTerbesar.label)}</div>
              </div>
            </div>
            <span className="text-[13px] font-bold text-positive tabular-nums">+{rp(positifTerbesar.value)}</span>
          </div>
        )}

        {negatifTerbesar && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--negative-bg)] border border-[var(--negative-light)]">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-[var(--negative-light)]">
                <TrendingDown size={12} className="text-negative" />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">{t('Largest Negative Movement')}</div>
                <div className="text-[12px] font-semibold text-foreground">{t(negatifTerbesar.label)}</div>
              </div>
            </div>
            <span className="text-[13px] font-bold text-negative tabular-nums">({rp(negatifTerbesar.value)})</span>
          </div>
        )}
      </div>

      {/* Composition bar */}
      {composition.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('Equity Composition')}</div>
          <div className="flex rounded-full overflow-hidden h-2">
            {composition.map(c => (
              <div key={c.id} className={c.color} style={{ width: `${c.pct}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {composition.map(c => (
              <div key={`leg-${c.id}`} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${c.color}`} />
                <span className="text-[10px] text-muted-foreground">{t(c.label)}</span>
                <span className="text-[10px] font-semibold text-foreground">{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground mt-auto">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>{t('Based on posted transactions only. Subject to year-end audit adjustments.')}</span>
      </div>
    </div>
  );
}
