'use client';
import React, { useState } from 'react';
import { Search, ExternalLink, FileText, Scale, TrendingUp, Activity,
  Wallet, Package, Building2, ShoppingCart, CreditCard, Layers,
  BarChart3, Receipt, Users, AlertCircle, Clock, BookOpen } from 'lucide-react';
import { useLanguage } from '@/lib/language';

const notesMeta = [
  { id: 'nm-01', num: '01', title: 'General Information',         desc: 'Company profile, legal structure, and principal activities.',           statement: 'All Statements',  tag: 'Policy Note',         icon: <FileText size={13} /> },
  { id: 'nm-02', num: '02', title: 'Basis of Preparation',        desc: 'Framework, going concern, and presentation currency.',                  statement: 'All Statements',  tag: 'Policy Note',         icon: <Scale size={13} /> },
  { id: 'nm-03', num: '03', title: 'Material Accounting Policies',desc: 'Significant accounting policies applied in these statements.',          statement: 'All Statements',  tag: 'Policy Note',         icon: <BookOpen size={13} /> },
  { id: 'nm-04', num: '04', title: 'Cash & Cash Equivalents',     desc: 'Cash on hand and bank balances available for operations.',              statement: 'Balance Sheet',   tag: 'Disclosed',           icon: <Wallet size={13} /> },
  { id: 'nm-05', num: '05', title: 'Trade Receivables',           desc: 'Gross receivables, ECL allowance, and aging analysis.',                 statement: 'Balance Sheet',   tag: 'Disclosed',           icon: <Receipt size={13} /> },
  { id: 'nm-06', num: '06', title: 'Inventories',                 desc: 'Raw materials, WIP, finished goods, and write-downs.',                  statement: 'Balance Sheet',   tag: 'Supporting Schedule', icon: <Package size={13} /> },
  { id: 'nm-07', num: '07', title: 'Property & Equipment',        desc: 'PPE movements, depreciation, and carrying amounts.',                    statement: 'Balance Sheet',   tag: 'Supporting Schedule', icon: <Building2 size={13} /> },
  { id: 'nm-08', num: '08', title: 'Trade Payables',              desc: 'Trade payables, accrued expenses, and other payables.',                 statement: 'Balance Sheet',   tag: 'Disclosed',           icon: <ShoppingCart size={13} /> },
  { id: 'nm-09', num: '09', title: 'Borrowings',                  desc: 'Short and long-term debt obligations and maturity schedule.',           statement: 'Balance Sheet',   tag: 'Disclosed',           icon: <CreditCard size={13} /> },
  { id: 'nm-10', num: '10', title: 'Equity',                      desc: 'Share capital, APIC, retained earnings, and other equity.',             statement: 'Equity Statement',tag: 'Disclosed',           icon: <Layers size={13} /> },
  { id: 'nm-11', num: '11', title: 'Revenue',                     desc: 'Revenue breakdown by product, service, and income stream.',             statement: 'Profit & Loss',   tag: 'Disclosed',           icon: <TrendingUp size={13} /> },
  { id: 'nm-12', num: '12', title: 'Operating Expenses',          desc: 'Selling, G&A, personnel, depreciation, and other costs.',               statement: 'Profit & Loss',   tag: 'Disclosed',           icon: <BarChart3 size={13} /> },
  { id: 'nm-13', num: '13', title: 'Income Tax',                  desc: 'Current and deferred tax expense, effective tax rate.',                 statement: 'Profit & Loss',   tag: 'Disclosed',           icon: <Activity size={13} /> },
  { id: 'nm-14', num: '14', title: 'Related Parties',             desc: 'Transactions and balances with related parties.',                       statement: 'All Statements',  tag: 'Disclosed',           icon: <Users size={13} /> },
  { id: 'nm-15', num: '15', title: 'Commitments & Contingencies', desc: 'Lease commitments, contingent liabilities, and legal matters.',         statement: 'Balance Sheet',   tag: 'Disclosed',           icon: <AlertCircle size={13} /> },
  { id: 'nm-16', num: '16', title: 'Subsequent Events',           desc: 'Material events after the balance sheet date.',                         statement: 'All Statements',  tag: 'Disclosed',           icon: <Clock size={13} /> },
];

const TAG_STYLE: Record<string, string> = {
  'Policy Note':         'bg-violet-50 text-violet-600 border border-violet-200',
  'Disclosed':           'bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)]',
  'Supporting Schedule': 'bg-primary/8 text-primary border border-primary/20',
};

export default function NotesOverviewGrid() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');

  const filtered = notesMeta.filter(n =>
    n.num.includes(search) ||
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.desc.toLowerCase().includes(search.toLowerCase()) ||
    n.statement.toLowerCase().includes(search.toLowerCase())
  );

  const scrollTo = (num: string) => {
    document.getElementById(`ns-${num}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[14px] font-bold text-foreground">{t('Notes Overview')}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t('Navigate through accounting policies and supporting disclosures')}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-1.5 w-full sm:w-52">
          <Search size={12} className="text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder={t('Search notes...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none flex-1 min-w-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-2.5">
        {filtered.map(note => (
          <button
            key={note.id}
            onClick={() => scrollTo(note.num)}
            className="note-card-hover text-left p-3.5 rounded-xl border border-border bg-background group"
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-black text-muted-foreground/15 group-hover:text-primary/15 transition-colors leading-none tabular-nums">
                  {note.num}
                </span>
                <span className="p-1 rounded-md bg-primary/8 text-primary">{note.icon}</span>
              </div>
              <ExternalLink size={11} className="text-muted-foreground/30 group-hover:text-primary/50 transition-colors mt-0.5" />
            </div>
            <div className="text-[12px] font-semibold text-foreground group-hover:text-primary transition-colors leading-tight mb-1">
              {t(note.title)}
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed mb-2.5 line-clamp-2">
              {t(note.desc)}
            </div>
            <div className="flex items-center justify-between gap-1 flex-wrap">
              <span className={`disclosure-badge ${TAG_STYLE[note.tag]}`}>{t(note.tag)}</span>
              <span className="text-[9px] text-muted-foreground/60 truncate">{t(note.statement)}</span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-10 text-center">
            <p className="text-[13px] text-muted-foreground">{t('No notes match')} &quot;{search}&quot;</p>
            <button onClick={() => setSearch('')} className="text-primary text-[12px] mt-2 hover:underline">
              {t('Clear search')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}