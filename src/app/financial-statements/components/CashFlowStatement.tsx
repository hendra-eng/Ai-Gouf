'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';

const CashFlowChart = dynamic(() => import('./CashFlowChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
});

// Backend integration point: replace with /api/statements/cash-flow?company=&period=
const cfData = {
  operating: {
    label: 'Operating Activities',
    items: [
      { label: 'Net Income', value: 1840 },
      { label: 'Depreciation & Amortization', value: 210 },
      { label: 'Perubahan Piutang Usaha', value: -142 },
      { label: 'Perubahan Persediaan', value: -38 },
      { label: 'Perubahan Hutang Usaha', value: 86 },
      { label: 'Perubahan Kewajiban Akrual', value: 44 },
    ],
    total: 1800,
  },
  investing: {
    label: 'Investing Activities',
    items: [
      { label: 'Pembelian Peralatan & Mesin', value: -380 },
      { label: 'Pembelian Aset Tak Berwujud', value: -120 },
      { label: 'Investasi Jangka Panjang', value: -200 },
      { label: 'Penjualan Aset Tetap', value: 45 },
    ],
    total: -655,
  },
  financing: {
    label: 'Financing Activities',
    items: [
      { label: 'Penerimaan Hutang Bank', value: 500 },
      { label: 'Pembayaran Hutang Bank', value: -280 },
      { label: 'Pembayaran Dividen', value: -320 },
      { label: 'Pembayaran Sewa (Lease)', value: -85 },
    ],
    total: -185,
  },
  beginning: 1996,
  netChange: 960,
  ending: 2956,
};

const runwayMonths = 4.8;

interface CFSectionProps {
  section: typeof cfData.operating;
  colorClass: string;
}

function CFSection({ section, colorClass }: CFSectionProps) {
  const { currency } = useCurrency();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-5 py-3 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground">{section.label}</span>
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
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className={`text-sm font-semibold font-mono ${item.value >= 0 ? 'text-foreground' : 'text-negative'}`}>
                {item.value >= 0 ? '' : '('}{formatRp(Math.abs(item.value))}{item.value < 0 ? ')' : ''}
              </span>
            </div>
          ))}
          <div className={`flex items-center justify-between px-5 py-3 bg-muted/20 border-b border-border`}>
            <span className={`text-sm font-bold ${colorClass}`}>Net {section.label}</span>
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
  const { currency, fx } = useCurrency();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [forecastPeriod, setForecastPeriod] = useState('3M');

  return (
    <div className="space-y-6">
      {/* Chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-foreground">Cash Flow by Activity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Jan–Aug 2026 monthly breakdown</p>
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
        <CashFlowChart />
      </div>

      {/* Cash summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Beginning Cash', value: cfData.beginning, color: 'text-foreground' },
          { label: 'Net Change', value: cfData.netChange, color: 'text-positive', prefix: '+' },
          { label: 'Ending Cash', value: cfData.ending, color: 'text-primary' },
          { label: 'Cash Runway', value: null, display: `${runwayMonths} months`, color: 'text-positive' },
        ].map((c) => (
          <div key={`cfsum-${c.label}`} className="card-elevated rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{c.label}</p>
            <p className={`text-xl font-bold font-mono ${c.color}`}>
              {c.value !== null ? `${c.prefix || ''}${formatRp(c.value)}` : c.display}
            </p>
          </div>
        ))}
      </div>

      {/* Cash flow runway alert */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-positive-subtle border border-positive/20">
        <TrendingUp size={18} className="text-positive flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Cash Runway: 4.8 Months</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fx('Current cash of Rp 2.96M covers approximately 4.8 months of projected operating expenses (Rp 618Jt/month avg).')}
            {' '}Operating cash flow is positive and improving. No immediate liquidity risk.
          </p>
        </div>
      </div>

      {/* Statement table */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">Laporan Arus Kas</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Periode: Januari – Agustus 2026 (Metode Tidak Langsung)</p>
        </div>

        <CFSection section={cfData.operating} colorClass="text-positive" />
        <CFSection section={cfData.investing} colorClass="text-negative" />
        <CFSection section={cfData.financing} colorClass="text-warning" />

        <div className="divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30">
            <span className="text-sm font-semibold text-foreground">Kenaikan (Penurunan) Bersih Kas</span>
            <span className="text-sm font-bold font-mono text-positive">+{formatRp(cfData.netChange)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-muted-foreground">Saldo Kas Awal Periode</span>
            <span className="text-sm font-semibold font-mono text-foreground">{formatRp(cfData.beginning)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-t-2 border-primary/20">
            <span className="text-base font-bold text-primary">SALDO KAS AKHIR PERIODE</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(cfData.ending)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
