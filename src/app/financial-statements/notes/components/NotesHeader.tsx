'use client';
import React from 'react';
import { Printer, FileDown, Download, CheckCircle2, ShieldCheck, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useNotesStatement, useStatementMeta } from '../../lib/useStatementData';

export default function NotesHeader() {
  const { t } = useLanguage();
  // Data dari API /api/v1/financial-statements (transaksi posted).
  const { counts, periodLabel, companyName, asOfLabel } = useNotesStatement();
  const { data } = useStatementMeta();
  const seimbang = data ? data.balance_sheet.seimbang && data.trial_balance.seimbang : null;
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-[22px] font-bold text-foreground tracking-tight leading-tight">
            {t('Notes to Financial Statements')}
          </h1>
          {seimbang !== null && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${seimbang ? 'bg-[var(--positive-bg)] text-positive border-[var(--positive-light)]' : 'bg-[var(--negative-bg)] text-negative border-[var(--negative-light)]'}`}>
              <CheckCircle2 size={10} />
              {seimbang ? t('Balanced ✓') : t('Not balanced')}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary border border-primary/20 text-[11px] font-semibold">
            <ShieldCheck size={10} />
            {t('Posted transactions only')}
          </span>
        </div>
        <p className="text-muted-foreground text-[13px]">
          {t('Accounting policies, supporting details, and financial disclosures')}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
          <span className="text-primary font-semibold">{periodLabel}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground font-medium">{companyName}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">IDR</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">{counts.total} {t('Notes')}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <RefreshCw size={9} />
            {asOfLabel || '—'}
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