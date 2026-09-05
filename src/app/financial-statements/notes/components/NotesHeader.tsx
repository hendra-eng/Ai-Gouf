'use client';
import React from 'react';
import { Printer, FileDown, Download, CheckCircle2, ShieldCheck, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language';

export default function NotesHeader() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-[22px] font-bold text-foreground tracking-tight leading-tight">
            {t('Notes to Financial Statements')}
          </h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)] text-[11px] font-semibold">
            <CheckCircle2 size={10} />
            {t('Balanced ✓')}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary border border-primary/20 text-[11px] font-semibold">
            <ShieldCheck size={10} />
            {t('PSAK Compliant')}
          </span>
        </div>
        <p className="text-muted-foreground text-[13px]">
          {t('Accounting policies, supporting details, and financial disclosures')}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
          <span className="text-primary font-semibold">{t('January 2026 – August 2026')}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground font-medium">PT Nusantara Teknologi Indonesia</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">USD</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">{t('16 Notes')}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <RefreshCw size={9} />
            {t('Authorized: 5 Sep 2026')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button className="btn-ghost"><Printer size={13} />{t('Print')}</button>
        <button className="btn-ghost"><FileDown size={13} />{t('PDF')}</button>
        <button className="btn-secondary"><Download size={13} />{t('Export')}</button>
      </div>
    </div>
  );
}