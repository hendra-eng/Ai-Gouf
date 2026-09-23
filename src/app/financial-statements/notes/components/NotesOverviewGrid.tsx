'use client';
import React, { useState } from 'react';
import { Search, ExternalLink, FileText, Scale, TrendingUp, Activity,
  Wallet, Package, Building2, ShoppingCart, CreditCard, Layers,
  BarChart3, Receipt, Users, AlertCircle, Clock, BookOpen } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useNotesStatement } from '../../lib/useStatementData';

// Ikon per catatan (key dari API /api/v1/financial-statements/notes).
const ICON_CATATAN: Record<string, React.ReactNode> = {
  general_information: <FileText size={13} />, basis_of_preparation: <Scale size={13} />,
  accounting_policies: <BookOpen size={13} />, cash: <Wallet size={13} />, receivables: <Receipt size={13} />,
  inventories: <Package size={13} />, prepayments: <Clock size={13} />, fixed_assets: <Building2 size={13} />,
  trade_payables: <ShoppingCart size={13} />, tax_payables: <Activity size={13} />, accruals: <AlertCircle size={13} />,
  borrowings: <CreditCard size={13} />, equity: <Layers size={13} />, revenue: <TrendingUp size={13} />,
  cost_of_sales: <BarChart3 size={13} />, operating_expenses: <BarChart3 size={13} />,
  finance_costs_tax: <Activity size={13} />, related_parties: <Users size={13} />,
};

const TAG_STYLE: Record<string, string> = {
  'Policy Note':         'bg-violet-50 text-violet-600 border border-violet-200',
  'Disclosed':           'bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)]',
  'Supporting Schedule': 'bg-primary/8 text-primary border border-primary/20',
};

export default function NotesOverviewGrid() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  // Data dari API /api/v1/financial-statements (transaksi posted).
  const { notes } = useNotesStatement();
  const notesMeta = notes.map((n) => ({
    id: `nm-${n.no}`, num: n.no, title: n.title, desc: n.narasi, statement: n.statement, tag: n.tag,
    icon: ICON_CATATAN[n.key] ?? <FileText size={13} />,
  }));

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