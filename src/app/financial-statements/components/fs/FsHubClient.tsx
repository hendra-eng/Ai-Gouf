'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, CheckCircle2, AlertTriangle, NotebookText, RefreshCcw, Scale, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fetchBalanceSheet, fetchProfitLoss, type BalanceSheet, type ProfitLoss } from '@/lib/fsStore';
import FsShell, { NoClient } from './FsShell';
import { defaultPeriod } from './PeriodPicker';
import { fmtAmount, fmtDate, todayIso } from './fsFormat';

// Halaman indeks Financial Statements: ringkasan cepat + pintu ke tiap laporan.

const CARDS = [
  { href: '/financial-statements/balance-sheet', title: 'Balance Sheet', icon: Scale, text: 'Assets, liabilities and equity at a date, with comparative period and drill-down to the GL.' },
  { href: '/financial-statements/profit-loss', title: 'Profit & Loss', icon: TrendingUp, text: 'Revenue to net profit by month, year to date or custom range, with segment filters.' },
  { href: '/financial-statements/changes-in-equity', title: 'Changes in Equity', icon: RefreshCcw, text: 'Opening to closing equity by component, reconciled to the Balance Sheet.' },
  { href: '/financial-statements/cash-flow', title: 'Cash Flow', icon: Activity, text: 'Indirect method from the GL using the client cash flow mapping; flags unmapped accounts.' },
  { href: '/financial-statements/notes', title: 'Notes (CALK)', icon: NotebookText, text: 'Template, client and period notes with GL-linked tables, controlled overrides and audit trail.' },
  { href: '/financial-statements/mapping', title: 'Mapping', icon: SlidersHorizontal, text: 'Per-client master mapping of COA accounts to statement lines, equity components, cash flow and notes.' },
];

export default function FsHubClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [pl, setPl] = useState<ProfitLoss | null>(null);

  useEffect(() => {
    setBs(null);
    setPl(null);
    if (!hydrated || !activeClientId) return;
    fetchBalanceSheet(activeClientId, { as_of: todayIso(), compare: 'none' }).then(setBs).catch(() => setBs(null));
    fetchProfitLoss(activeClientId, { ...defaultPeriod(), compare: 'none' }).then(setPl).catch(() => setPl(null));
  }, [hydrated, activeClientId]);

  return (
    <FsShell
      title="Financial Statements"
      subtitle={<>Built from posted General Ledger transactions and each client&apos;s COA mapping{bs?.client.company_name ? ` · ${bs.client.company_name}` : ''}</>}
    >
      {hydrated && !activeClientId ? <NoClient /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={`Total assets · ${bs ? fmtDate(bs.as_of) : 'today'}`} value={bs ? fmtAmount(bs.totals.assets) : '…'} />
            <Stat label="Total equity" value={bs ? fmtAmount(bs.totals.equity) : '…'} />
            <Stat label={`Net profit · ${pl ? pl.period_info.label : 'YTD'}`} value={pl ? fmtAmount(pl.summary.net_profit.amount) : '…'} />
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance check</p>
              {bs ? (
                bs.check.balanced
                  ? <p className="flex items-center gap-1.5 text-emerald-700 font-semibold mt-1"><CheckCircle2 size={16} /> Balanced</p>
                  : <p className="flex items-center gap-1.5 text-rose-700 font-semibold mt-1"><AlertTriangle size={16} /> Off by {fmtAmount(bs.check.difference)}</p>
              ) : <p className="text-lg font-bold mt-0.5">…</p>}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CARDS.map(c => {
              const Icon = c.icon;
              return (
                <Link key={c.href} href={c.href} className="group bg-card border border-border rounded-xl p-5 hover:shadow-card transition-shadow flex gap-4">
                  <span className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><Icon size={22} className="text-blue-600" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-bold text-foreground">{c.title} <ArrowRight size={15} className="opacity-0 group-hover:opacity-100 transition-opacity" /></span>
                    <span className="block text-sm text-muted-foreground mt-1 leading-relaxed">{c.text}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </FsShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className="text-lg font-bold text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
