'use client';
import React from 'react';
import Link from 'next/link';
import {
  ArrowRight, FileText, Scale, BookOpen, Wallet, Receipt, Package,
  Building2, ShoppingCart, CreditCard, Layers, TrendingUp, BarChart3,
  Activity, Users, AlertCircle, Clock,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';

// Backend integration point: replace with /api/statements/notes?company=&period=
// Condensed metadata only — full policy text, breakdown tables, and accordions
// live on the standalone Notes to Financial Statements page.
const notesSummary = [
  { num: '01', title: 'General Information', statement: 'All Statements', tag: 'Policy Note', icon: <FileText size={13} /> },
  { num: '02', title: 'Basis of Preparation', statement: 'All Statements', tag: 'Policy Note', icon: <Scale size={13} /> },
  { num: '03', title: 'Material Accounting Policies', statement: 'All Statements', tag: 'Policy Note', icon: <BookOpen size={13} /> },
  { num: '04', title: 'Cash & Cash Equivalents', statement: 'Balance Sheet', tag: 'Disclosed', icon: <Wallet size={13} /> },
  { num: '05', title: 'Trade Receivables', statement: 'Balance Sheet', tag: 'Disclosed', icon: <Receipt size={13} /> },
  { num: '06', title: 'Inventories', statement: 'Balance Sheet', tag: 'Supporting Schedule', icon: <Package size={13} /> },
  { num: '07', title: 'Property & Equipment', statement: 'Balance Sheet', tag: 'Supporting Schedule', icon: <Building2 size={13} /> },
  { num: '08', title: 'Trade Payables', statement: 'Balance Sheet', tag: 'Disclosed', icon: <ShoppingCart size={13} /> },
  { num: '09', title: 'Borrowings', statement: 'Balance Sheet', tag: 'Disclosed', icon: <CreditCard size={13} /> },
  { num: '10', title: 'Equity', statement: 'Equity Statement', tag: 'Disclosed', icon: <Layers size={13} /> },
  { num: '11', title: 'Revenue', statement: 'Profit & Loss', tag: 'Disclosed', icon: <TrendingUp size={13} /> },
  { num: '12', title: 'Operating Expenses', statement: 'Profit & Loss', tag: 'Disclosed', icon: <BarChart3 size={13} /> },
  { num: '13', title: 'Income Tax', statement: 'Profit & Loss', tag: 'Disclosed', icon: <Activity size={13} /> },
  { num: '14', title: 'Related Parties', statement: 'All Statements', tag: 'Disclosed', icon: <Users size={13} /> },
  { num: '15', title: 'Commitments & Contingencies', statement: 'Balance Sheet', tag: 'Disclosed', icon: <AlertCircle size={13} /> },
  { num: '16', title: 'Subsequent Events', statement: 'All Statements', tag: 'Disclosed', icon: <Clock size={13} /> },
];

const TAG_STYLE: Record<string, string> = {
  'Policy Note': 'bg-violet-50 text-violet-600 border border-violet-200',
  'Disclosed': 'bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)]',
  'Supporting Schedule': 'bg-primary/8 text-primary border border-primary/20',
};

const counts = {
  total: notesSummary.length,
  policy: notesSummary.filter((n) => n.tag === 'Policy Note').length,
  disclosed: notesSummary.filter((n) => n.tag === 'Disclosed').length,
  schedule: notesSummary.filter((n) => n.tag === 'Supporting Schedule').length,
};

// A few notes worth surfacing directly in the summary tab
const highlights = [
  { num: '02', title: 'Basis of Preparation', desc: '' },
  { num: '15', title: 'Commitments & Contingencies', desc: '' },
  { num: '16', title: 'Subsequent Events', desc: '' },
];

export default function CALKStatement() {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Notes', value: counts.total, color: 'text-primary' },
          { label: 'Policy Notes', value: counts.policy, color: 'text-foreground' },
          { label: 'Disclosures', value: counts.disclosed, color: 'text-foreground' },
          { label: 'Supporting Schedules', value: counts.schedule, color: 'text-foreground' },
        ].map((c) => (
          <div key={`calksum-${c.label}`} className="card-elevated rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t(c.label)}</p>
            <p className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Key highlights */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-base font-bold text-foreground mb-1">{t('Key Disclosures')}</h3>
        <p className="text-xs text-muted-foreground mb-4">{t('Catatan yang paling relevan untuk periode berjalan')}</p>
        <div className="space-y-3">
          {highlights.map((h) => (
            <div key={h.num} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border">
              <span className="text-sm font-black text-muted-foreground/30 tabular-nums mt-0.5">{h.num}</span>
              <div>
                <p className="text-sm font-semibold text-foreground">{t(h.title)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t(h.desc)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Condensed notes index */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">{t('Catatan atas Laporan Keuangan')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('Periode: Januari – Agustus 2026 · Daftar ringkas 16 catatan')}</p>
        </div>
        <div className="divide-y divide-border/50">
          {notesSummary.map((n) => (
            <div key={n.num} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/30 transition-colors">
              <span className="p-1 rounded-md bg-primary/8 text-primary flex-shrink-0">{n.icon}</span>
              <span className="text-xs font-black text-muted-foreground/30 tabular-nums w-5 flex-shrink-0">{n.num}</span>
              <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{t(n.title)}</span>
              <span className={`disclosure-badge hidden sm:inline-flex flex-shrink-0 ${TAG_STYLE[n.tag]}`}>{t(n.tag)}</span>
              <span className="text-[11px] text-muted-foreground/60 flex-shrink-0 hidden md:inline w-28 text-right">{t(n.statement)}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{t('Kebijakan akuntansi lengkap, tabel rincian, dan rekonsiliasi tersedia di halaman lengkap.')}</p>
          <Link href="/financial-statements/notes" className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 flex-shrink-0 ml-4">
            {t('View Full Notes')}
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}