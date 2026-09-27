'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { useCashFlowStatement, useProfitLossStatement } from '../lib/useStatementData';

const CashFlowChart = dynamic(() => import('./CashFlowChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
});

interface CFSectionData {
  label: string;
  items: { label: string; value: number }[];
  total: number;
}

interface CFSectionProps {
  section: CFSectionData;
  colorClass: string;
}

function CFSection({ section, colorClass }: CFSectionProps) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-5 py-3 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground">{t(section.label)}</span>
        <div className="ml-auto">
          <span className={`text-sm font-bold font-mono ${section.total >= 0 ? 'text-positive' : 'text-negative'}`}>
            {section.total >= 0 ? '+' : ''}{formatRp(section.total)}
          </span>
        </div>
      </button>
      {expanded && (
        <>
          {section.items.map((item, i) => (
            <div key={`cfitem-${section.label}-${i}`} className={`flex items-center justify-between px-8 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'bg-muted/10' : ''}`}>
              <span className="text-sm text-muted-foreground">{t(item.label)}</span>
              <span className={`text-sm font-semibold font-mono ${item.value >= 0 ? 'text-foreground' : 'text-negative'}`}>
                {item.value >= 0 ? '' : '('}{formatRp(Math.abs(item.value))}{item.value < 0 ? ')' : ''}
              </span>
            </div>
          ))}
          <div className={`flex items-center justify-between px-5 py-3 bg-muted/20 border-b border-border`}>
            <span className={`text-sm font-bold ${colorClass}`}>{t('Net')} {t(section.label)}</span>
            <span className={`text-sm font-bold font-mono ${colorClass}`}>
              {section.total >= 0 ? '+' : ''}{formatRp(section.total)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function CashFlowStatement() {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [forecastPeriod, setForecastPeriod] = useState('3M');
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { INDIRECT, CF_MONTHLY, periodLabel } = useCashFlowStatement();
  const { PL_CORE, MONTHLY_PL } = useProfitLossStatement();
  const cfData = {
    operating: INDIRECT.operating,
    investing: INDIRECT.investing,
    financing: INDIRECT.financing,
    beginning: INDIRECT.beginning,
    netChange: INDIRECT.netChange,
    ending: INDIRECT.ending,
  };
  // Runway = kas akhir / rata-rata beban kas bulanan (semua beban kecuali
  // penyusutan & amortisasi yang non-kas).
  const bulanAktif = Math.max(MONTHLY_PL.length, 1);
  const bebanKasBulanan = (PL_CORE.cogs + PL_CORE.operatingExpenses + PL_CORE.interestExpense + PL_CORE.incomeTax) / bulanAktif;
  const runwayMonths = bebanKasBulanan > 0 && cfData.ending > 0 ? Math.round((cfData.ending / bebanKasBulanan) * 10) / 10 : null;
  const runwayAman = runwayMonths != null && runwayMonths >= 3;

  return (
    <div className="space-y-6">
      {/* Chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-foreground">{t('Cash Flow by Activity')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{periodLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
              {['3M', '6M', '12M'].map((p) => (
                <button
                  key={`cf-forecast-${p}`}
                  onClick={() => setForecastPeriod(p)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150 ${
                    forecastPeriod === p ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
        <CashFlowChart data={CF_MONTHLY.map((m) => ({ month: m.month, operating: m.operatingCF, investing: m.investingCF, financing: m.financingCF }))} />
      </div>

      {/* Cash summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Beginning Cash', value: cfData.beginning, color: 'text-foreground' },
          { label: 'Net Change', value: cfData.netChange, color: cfData.netChange >= 0 ? 'text-positive' : 'text-negative', prefix: cfData.netChange >= 0 ? '+' : '' },
          { label: 'Ending Cash', value: cfData.ending, color: 'text-primary' },
          { label: 'Cash Runway', value: null, display: runwayMonths == null ? '—' : `${runwayMonths} ${t('months')}`, color: runwayAman ? 'text-positive' : 'text-warning' },
        ].map((c) => (
          <div key={`cfsum-${c.label}`} className="card-elevated rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t(c.label)}</p>
            <p className={`text-xl font-bold font-mono ${c.color}`}>
              {c.value !== null ? `${c.prefix || ''}${formatRp(c.value)}` : c.display}
            </p>
          </div>
        ))}
      </div>

      {/* Cash flow runway alert */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${runwayAman ? 'bg-positive-subtle border-positive/20' : 'bg-warning-subtle border-warning/20'}`}>
        <TrendingUp size={18} className={`${runwayAman ? 'text-positive' : 'text-warning'} flex-shrink-0 mt-0.5`} />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t('Cash Runway')}: {runwayMonths == null ? '—' : `${runwayMonths} ${t('months')}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {runwayMonths == null
              ? t('Belum cukup data kas & beban posted untuk menghitung runway.')
              : `${t('Kas akhir')} ${formatRp(cfData.ending)} ${t('menutup sekitar')} ${runwayMonths} ${t('bulan beban kas')} (${t('rata-rata')} ${formatRp(bebanKasBulanan)}/${t('bulan')}).`}
          </p>
        </div>
      </div>

      {/* Statement table */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">{t('Laporan Arus Kas')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Periode')}: {periodLabel} ({t('Metode Tidak Langsung')})</p>
        </div>

        <CFSection section={cfData.operating} colorClass="text-positive" />
        <CFSection section={cfData.investing} colorClass="text-negative" />
        <CFSection section={cfData.financing} colorClass="text-warning" />

        <div className="divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30">
            <span className="text-sm font-semibold text-foreground">{t('Kenaikan (Penurunan) Bersih Kas')}</span>
            <span className={`text-sm font-bold font-mono ${cfData.netChange >= 0 ? 'text-positive' : 'text-negative'}`}>{cfData.netChange >= 0 ? '+' : ''}{formatRp(cfData.netChange)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-muted-foreground">{t('Saldo Kas Awal Periode')}</span>
            <span className="text-sm font-semibold font-mono text-foreground">{formatRp(cfData.beginning)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-t-2 border-primary/20">
            <span className="text-base font-bold text-primary">{t('SALDO KAS AKHIR PERIODE')}</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(cfData.ending)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
