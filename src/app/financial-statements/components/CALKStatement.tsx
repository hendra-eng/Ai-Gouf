'use client';
import React from 'react';
import Link from 'next/link';
import {
  ArrowRight, FileText, Scale, BookOpen, Wallet, Receipt, Package,
  Building2, ShoppingCart, CreditCard, Layers, TrendingUp, BarChart3,
  Activity, Users, AlertCircle, Clock,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useNotesStatement } from '../lib/useStatementData';

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
  'Policy Note': 'bg-violet-50 text-violet-600 border border-violet-200',
  'Disclosed': 'bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)]',
  'Supporting Schedule': 'bg-primary/8 text-primary border border-primary/20',
};

export default function CALKStatement() {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const { notes, counts, periodLabel } = useNotesStatement();
  const notesSummary = notes.map((n) => ({ num: n.no, title: n.title, statement: n.statement, tag: n.tag, icon: ICON_CATATAN[n.key] ?? <FileText size={13} />, total: n.total }));
  // Sorotan: catatan kebijakan dasar penyusunan + 2 pos bersaldo terbesar.
  const highlights = [
    ...notes.filter((n) => n.key === 'basis_of_preparation'),
    ...notes.filter((n) => n.total != null).sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0)).slice(0, 2),
  ].map((n) => ({ num: n.no, title: n.title, desc: n.total != null ? `${n.narasi} ${t('Saldo')}: ${formatRp(n.total)}.` : n.narasi }));

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
          <p className="text-xs text-muted-foreground mt-0.5">{t('Periode')}: {periodLabel} · {t('Daftar ringkas')} {counts.total} {t('catatan')}</p>
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
