'use client';

// Daftar opening balance (saldo awal) klien aktif per tahun buku & cabang.
// Buat baru -> /coa/opening-balances/new; buka 1 set -> /coa/opening-balances/[id].

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronRight, GitBranch, ListTree, Plus, RefreshCcw, Scale } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { formatAmount, useOpeningBalances } from '@/lib/openingBalanceStore';
import { StatusBadge, branchLabel, formatDate } from './obUi';

export default function OpeningBalanceListClient() {
  const { clients, activeClientId, setActiveClient } = useActiveClient();
  const { items, loading, error, refresh } = useOpeningBalances(activeClientId);
  const [tahun, setTahun] = useState<number | 'all'>('all');

  const daftarTahun = useMemo(() => [...new Set(items.map(i => i.fiscal_year))].sort((a, b) => b - a), [items]);
  const tampil = tahun === 'all' ? items : items.filter(i => i.fiscal_year === tahun);
  const perTahun = useMemo(() => {
    const g = new Map<number, typeof tampil>();
    for (const i of tampil) g.set(i.fiscal_year, [...(g.get(i.fiscal_year) ?? []), i]);
    return [...g.entries()].sort((a, b) => b[0] - a[0]);
  }, [tampil]);

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="pb-2">
        <div className="mx-auto max-w-screen-2xl">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-foreground">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">Opening balances</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-600 text-white shadow-md shadow-emerald-600/25">
                <Scale size={20} />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Opening Balances</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Starting balances per fiscal year and branch, posted as an opening journal.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-3 pr-1.5 shadow-sm">
                <Building2 size={14} className="text-muted-foreground" />
                <select
                  value={activeClientId ?? ''}
                  onChange={e => {
                    const c = clients.find(x => x.id === e.target.value);
                    setActiveClient(c?.id ?? null, c?.companyName ?? null);
                  }}
                  className="min-w-[200px] bg-transparent py-0.5 text-sm font-medium text-foreground focus:outline-none"
                >
                  <option value="" disabled>Select client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}{c.clientCode ? ` (${c.clientCode})` : ''}</option>)}
                </select>
              </label>
              <button
                onClick={refresh}
                disabled={loading || !activeClientId}
                title="Refresh"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-slate-50 hover:text-foreground disabled:opacity-40"
              >
                <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <Link
                href="/coa/opening-balances/new"
                aria-disabled={!activeClientId}
                className={`flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-800 ${activeClientId ? '' : 'pointer-events-none opacity-40'}`}
              >
                <Plus size={15} /> New opening balance
              </Link>
            </div>
          </div>

          {daftarTahun.length > 1 && (
            <div className="mt-6 inline-flex rounded-xl bg-slate-100 p-1">
              {(['all', ...daftarTahun] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTahun(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${tahun === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t === 'all' ? 'All years' : `FY ${t}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-8 pt-4 pb-6">
        {!activeClientId ? (
          <Kosong icon={Building2} title="No client selected" hint="Pick a client above to manage its opening balances." />
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : items.length === 0 ? (
          <Kosong
            icon={Scale}
            title="No opening balances yet"
            hint="Create one per fiscal year (and per branch if needed). Unbalanced amounts are parked in a suspense account for you to resolve."
            action={<Link href="/coa/opening-balances/new" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-800"><Plus size={15} /> New opening balance</Link>}
          />
        ) : perTahun.map(([fy, sets]) => (
          <section key={fy}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <CalendarDays size={15} className="text-muted-foreground" /> Fiscal year {fy}
              <span className="rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">{sets.length}</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sets.map(s => {
                const selisih = Math.abs(s.difference) > 0.004;
                return (
                  <Link
                    key={s.id}
                    href={`/coa/opening-balances/${s.id}`}
                    className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          <GitBranch size={14} className="text-muted-foreground" /> {branchLabel(s.branch)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          As of {formatDate(s.as_of_date)} · {s.is_year_start ? 'Start of year' : 'Mid-year cut-off'}
                        </p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Debit</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatAmount(s.total_debit)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Credit</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatAmount(s.total_credit)}</p>
                      </div>
                    </div>

                    {selisih && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        <AlertTriangle size={13} className="mt-px shrink-0" />
                        Out of balance by {formatAmount(Math.abs(s.difference))}
                        {s.status !== 'draft' && s.suspense_account ? ` — parked in ${s.suspense_account.acc_no}` : ''}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                      <span>
                        {s.line_count} account{s.line_count === 1 ? '' : 's'}
                        {s.journal && <> · <span className="font-mono">{s.journal.je_number}</span></>}
                      </span>
                      <ArrowRight size={14} className="text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Kosong({ icon: Icon, title, hint, action }: { icon: React.ElementType; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon size={20} /></span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}
