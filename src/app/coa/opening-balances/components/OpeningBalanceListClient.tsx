'use client';

// Daftar opening balance (saldo awal) klien aktif per tahun buku & cabang.
// Buat baru -> /coa/opening-balances/new; buka 1 set -> /coa/opening-balances/[id].
// Aturan bisnis: 1 klien hanya boleh punya 1 opening balance -> tombol New
// dimatikan begitu klien sudah punya (backend juga menolak, kode ALREADY_EXISTS).

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronRight, GitBranch, ListTree, Plus, RefreshCcw, Scale } from 'lucide-react';
import PageHeading from '@/components/shared/PageHeading';
import { btnPrimary, tabBarCls, tabCls, tabListCls } from '@/components/arap/arapSalesUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useActiveClient } from '@/lib/activeClient';
import { formatAmount, useOpeningBalances } from '@/lib/openingBalanceStore';
import { StatusBadge, branchLabel, formatDate } from './obUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

export default function OpeningBalanceListClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { clients, activeClientId, setActiveClient } = useActiveClient();
  const { items, loading, error, refresh } = useOpeningBalances(activeClientId);
  const [tahun, setTahun] = useState<number | 'all'>('all');
  const bisaBuat = !!activeClientId && !loading && items.length === 0;

  const daftarTahun = useMemo(() => [...new Set(items.map(i => i.fiscal_year))].sort((a, b) => b - a), [items]);
  const tampil = tahun === 'all' ? items : items.filter(i => i.fiscal_year === tahun);
  const perTahun = useMemo(() => {
    const g = new Map<number, typeof tampil>();
    for (const i of tampil) g.set(i.fiscal_year, [...(g.get(i.fiscal_year) ?? []), i]);
    return [...g.entries()].sort((a, b) => b[0] - a[0]);
  }, [tampil]);

  return (
    <div className={`${salesFont.className} min-h-screen bg-background pb-16`}>
      <div>
        <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 lg:px-8 xl:px-10">
          <nav className="flex items-center gap-1 text-xs font-medium text-neutral-500">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-neutral-900">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <span className="font-semibold text-neutral-900">Opening balances</span>
          </nav>

          <PageHeading
            title="Opening Balances"
            description="Starting balances per fiscal year and branch, posted as an opening journal."
            actions={(
              <>
                <label className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white py-1 pl-3 pr-1.5 shadow-sm">
                  <Building2 size={14} className="text-neutral-500" />
                  <select
                    value={activeClientId ?? ''}
                    onChange={e => {
                      const c = clients.find(x => x.id === e.target.value);
                      setActiveClient(c?.id ?? null, c?.companyName ?? null);
                    }}
                    className="min-w-[200px] bg-transparent py-1 text-xs font-semibold text-neutral-900 focus:outline-none"
                  >
                    <option value="" disabled>Select client</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}{c.clientCode ? ` (${c.clientCode})` : ''}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading || !activeClientId}
                  title="Refresh"
                  className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40"
                >
                  <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
                <Link
                  href="/coa/opening-balances/new"
                  aria-disabled={!bisaBuat}
                  className={`${btnPrimary} ${bisaBuat ? '' : 'pointer-events-none opacity-40'}`}
                >
                  <Plus size={14} /> New opening balance
                </Link>
              </>
            )}
          />

          {activeClientId && items.length > 0 && (
            <p className="text-xs font-medium text-neutral-500">
              This client already has its opening balance. Only one is allowed per client — use Revise on it to make corrections.
            </p>
          )}

          {daftarTahun.length > 1 && (
            <div className={tabBarCls}>
              <div className={tabListCls}>
                {(['all', ...daftarTahun] as const).map(t => (
                  <button key={t} type="button" onClick={() => setTahun(t)} className={tabCls(tahun === t)}>
                    {t === 'all' ? 'All years' : `FY ${t}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-8 px-6 pt-5 pb-6 lg:px-8 xl:px-10">
        {!activeClientId ? (
          <Kosong icon={Building2} title="No client selected" hint="Pick a client above to manage its opening balances." />
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-[10px] bg-neutral-100" />)}
          </div>
        ) : items.length === 0 ? (
          <Kosong
            icon={Scale}
            title="No opening balances yet"
            hint="Each client has one opening balance — create it once, then correct it with Revise. Unbalanced amounts are parked in a suspense account for you to resolve."
            action={<Link href="/coa/opening-balances/new" className={`${btnPrimary} mt-4`}><Plus size={14} /> New opening balance</Link>}
          />
        ) : perTahun.map(([fy, sets]) => (
          <section key={fy}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <CalendarDays size={15} className="text-neutral-500" /> Fiscal year {fy}
              <span className="rounded-full bg-neutral-800 px-1.5 py-px text-[10px] font-semibold text-white">{sets.length}</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sets.map(s => {
                const selisih = Math.abs(s.difference) > 0.004;
                return (
                  <Link
                    key={s.id}
                    href={`/coa/opening-balances/${s.id}`}
                    className="group relative flex flex-col overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-5 pt-6 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700"
                  >
                    <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                          <GitBranch size={14} className="text-neutral-500" /> {branchLabel(s.branch)}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-neutral-500">
                          As of {formatDate(s.as_of_date)} · {s.is_year_start ? 'Start of year' : 'Mid-year cut-off'}
                        </p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Debit</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-neutral-900">{formatAmount(s.total_debit)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Credit</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-neutral-900">{formatAmount(s.total_credit)}</p>
                      </div>
                    </div>

                    {selisih && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        <AlertTriangle size={13} className="mt-px shrink-0" />
                        Out of balance by {formatAmount(Math.abs(s.difference))}
                        {s.status !== 'draft' && s.suspense_account ? ` — parked in ${kodeAkun(s.suspense_account.acc_no)}` : ''}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between pt-4 text-xs font-medium text-neutral-500">
                      <span>
                        {s.line_count} account{s.line_count === 1 ? '' : 's'}
                        {s.journal && <> · <span className="font-mono">{s.journal.je_number}</span></>}
                      </span>
                      <ArrowRight size={14} className="text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-900" />
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
    <div className="relative flex flex-col items-center overflow-hidden rounded-lg border border-neutral-300 bg-white px-6 py-16 text-center shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-neutral-800">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"><Icon size={20} /></span>
      <p className="text-sm font-semibold text-neutral-900">{title}</p>
      <p className="mt-1 max-w-md text-xs font-medium text-neutral-500">{hint}</p>
      {action}
    </div>
  );
}