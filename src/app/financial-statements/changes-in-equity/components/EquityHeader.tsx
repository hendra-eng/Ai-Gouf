'use client';
import React from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import PrintMenu from '@/components/shared/PrintMenu';
import { printReport, type PrintFormat } from '@/lib/printExport';
import { useEquityStatement } from '../../lib/useStatementData';
import { buildEquityReport } from './equityPrintReport';

export default function EquityHeader() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // Data dari API /api/v1/financial-statements (transaksi posted).
  const eq = useEquityStatement();
  const seimbang = Math.abs(eq.totals.closing - eq.balanceSheetEquity) < 0.01;

  const print = (format: PrintFormat) =>
    printReport(buildEquityReport(eq, t, user?.nama || user?.username || undefined), format);
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
      {/* Left */}
      <div>
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-[22px] font-bold text-foreground tracking-tight leading-tight">
            {t('Statement of Changes in Equity')}
          </h1>
          {!eq.loading && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${seimbang ? 'bg-[var(--positive-bg)] text-positive border-[var(--positive-light)]' : 'bg-negative-subtle text-negative border-negative/30'}`}>
              <CheckCircle2 size={10} />
              {seimbang ? t('Balanced ✓') : t('Not reconciled to Balance Sheet')}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary border border-primary/20 text-[11px] font-semibold">
            <ShieldCheck size={10} />
            {t('Posted transactions only')}
          </span>
        </div>
        <p className="text-muted-foreground text-[13px]">
          {t('Changes in equity during the reporting period')}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
          <span className="text-primary font-semibold">{eq.periodLabel}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground font-medium">{eq.companyName}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">IDR</span>
          {eq.asOfLabel && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground flex items-center gap-1">
                <RefreshCw size={9} />
                {eq.asOfLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <PrintMenu onPrint={print} label={t('Print')} disabled={eq.loading || !eq.adaData} />
      </div>
    </div>
  );
}