'use client';

// Halaman Management > Chart of Accounts (/coa). Tambah & edit akun TIDAK lagi
// pakai pop-up -- pindah ke halaman penuh /coa/new & /coa/[id]/edit
// (CoaFormPage.tsx). Tab aktif disimpan di URL (?view=unassigned) supaya
// setelah simpan/batal di halaman form, user kembali ke tab yang sama.
//
// CATATAN Tailwind: warna tema (primary/muted/border/...) didefinisikan sbg
// var(--x) TANPA <alpha-value>, jadi modifier opacity (bg-primary/5 dst)
// TIDAK menghasilkan CSS apa pun -- pakai palet bawaan (blue-50, slate-50).

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2, CheckCircle2, CircleSlash, Download, Inbox, Layers, Link2, ListTree, Pencil, Plus, RefreshCcw, Scale, Search, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  ACCOUNT_CLASSIFICATIONS,
  assignCoaAccounts,
  deleteCoaAccount,
  useClientCoa,
  useUnassignedCoa,
  balanceOnNormalSide,
  useCoaBalances,
  type CoaBalance,
  type NormalBalance,
  type CoaAccount,
} from '@/lib/coaStore';
import { labelClassification, themeOf } from './coaTheme';
import PageHeading from '@/components/shared/PageHeading';
import { btnOutline, btnPrimary, tabBadgeCls, tabBarCls, tabCls, tabListCls } from '@/components/arap/arapSalesUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

type View = 'client' | 'unassigned';
type StatusFilter = 'all' | 'active' | 'inactive';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function StatCard({ icon: Icon, label, value, note }: {
  icon: React.ElementType; label: string; value: number | string; note?: string;
}) {
  // Desain sama dengan kartu KPI Accounts Receivable/Payable (ArApWorkspace.KartuGrid).
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <div className="mt-1 min-h-4 text-[11px] text-neutral-500">{note}</div>
    </div>
  );
}

export default function CoaPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const clientCoa = useClientCoa(activeClientId);
  const saldoCoa = useCoaBalances(activeClientId);
  const unassignedCoa = useUnassignedCoa();

  const view: View = searchParams.get('view') === 'unassigned' ? 'unassigned' : 'client';
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Pilihan akun unassigned yang akan ditambahkan ke klien aktif.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const isUnassignedView = view === 'unassigned';
  const { accounts, loading, error, refresh } = isUnassignedView ? unassignedCoa : clientCoa;
  const qsView = isUnassignedView ? '?view=unassigned' : '';

  // Pilihan yang sudah tidak ada di daftar (mis. sudah di-assign/dihapus) dibuang.
  useEffect(() => {
    setSelected(prev => {
      const ids = new Set(unassignedCoa.accounts.map(a => a.id));
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [unassignedCoa.accounts]);

  const counts = useMemo(() => {
    const byClass: Record<string, number> = {};
    for (const a of accounts) byClass[a.account_classification] = (byClass[a.account_classification] ?? 0) + 1;
    return byClass;
  }, [accounts]);

  const jumlahAktif = useMemo(() => accounts.filter(a => a.is_active).length, [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      if (classification !== 'all' && a.account_classification !== classification) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (!q) return true;
      return [a.acc_no, a.source_acc_no, a.account_name].some(v => v?.toLowerCase().includes(q));
    });
  }, [accounts, search, classification, statusFilter]);

  const semuaTerpilih = filtered.length > 0 && filtered.every(a => selected.has(a.id));

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (semuaTerpilih) filtered.forEach(a => next.delete(a.id));
      else filtered.forEach(a => next.add(a.id));
      return next;
    });
  };

  async function handleAssign(ids: string[]) {
    if (!activeClientId || ids.length === 0) return;
    setAssigning(true);
    try {
      const hasil = await assignCoaAccounts(activeClientId, ids);
      if (hasil.assigned.length > 0) {
        toast.success(`${hasil.assigned.length} account(s) added to ${activeClientName ?? 'client'}`, {
          description: hasil.skipped.length ? `${hasil.skipped.length} skipped — see next message.` : undefined,
        });
      }
      if (hasil.skipped.length > 0) {
        toast.warning(`${hasil.skipped.length} account(s) skipped`, {
          description: hasil.skipped.slice(0, 5).map(s => `${s.acc_no ?? '?'}: ${s.reason}`).join('\n'),
          duration: 10000,
        });
      }
    } catch (err) {
      toast.error('Failed to add accounts to client', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setAssigning(false);
    }
  }

  async function handleDelete(akun: CoaAccount) {
    if (!window.confirm(`Delete account ${akun.source_acc_no || akun.acc_no} "${akun.account_name}"?`)) return;
    try {
      await deleteCoaAccount(akun.id);
      toast.success('Account deleted', { description: `${akun.source_acc_no || akun.acc_no} — ${akun.account_name}` });
    } catch (err) {
      toast.error('Failed to delete account', { description: err instanceof Error ? err.message : undefined });
    }
  }

  function handleExport() {
    const header = ['ACCOUNT CODE', 'ZAFEB CODE', 'ACCOUNT NAME', 'ACCOUNT CLASSIFICATION', 'ACCOUNT HEAD', 'ACCOUNT SUB', 'NORMAL BALANCE',
      'DESCRIPTION', 'INTERNATIONAL STANDARD GROUP (IFRS-ALIGNED)', 'STANDARD ACCOUNT CODE', 'IFRS TAXONOMY REFERENCE', 'STATUS',
      ...(isUnassignedView ? [] : ['BALANCE'])];
    const rows = filtered.map(a => [(a.source_acc_no || a.acc_no), a.acc_no, a.account_name, a.account_classification, a.account_head, a.account_sub,
      a.normal_balance, a.description, a.international_standard_group, a.standard_account_code, a.ifrs_taxonomy_reference,
      a.is_active ? 'Active' : 'Inactive',
      ...(isUnassignedView ? [] : [balanceOnNormalSide(saldoCoa.balances[a.acc_no]?.balance ?? 0, a.normal_balance)])]);
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    const nama = isUnassignedView ? 'unassigned' : (activeClientName || 'client');
    link.download = `COA_${nama.replace(/[^\w-]+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const switchView = (v: View) => {
    router.replace(v === 'unassigned' ? `${pathname}?view=unassigned` : pathname, { scroll: false });
    setClassification('all');
    setSearch('');
  };

  const kolom = 6;
  const filterAktif = search || classification !== 'all' || statusFilter !== 'all';

  return (
    <div className={`${salesFont.className} min-h-screen bg-background pb-24`}>
      {/* Header: gaya Sales / AR / AP (PageHeading + tab garis bawah) */}
      <div>
        <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 lg:px-8 xl:px-10">
          <PageHeading
            title="Chart of Accounts"
            description="Master accounts per client, mapped to the IFRS-aligned standard layer."
          />

          {/* Tab */}
          <div className={tabBarCls}>
            <div className={tabListCls}>
              {([
                ['client', Building2, activeClientName ?? 'Client accounts', clientCoa.accounts.length],
                ['unassigned', Inbox, 'Unassigned', unassignedCoa.accounts.length],
              ] as const).map(([v, Icon, label, n]) => (
                <button key={v} type="button" onClick={() => switchView(v)} className={tabCls(view === v)}>
                  <Icon size={15} />
                  <span className="max-w-[220px] truncate">{label}</span>
                  <span className={tabBadgeCls}>{n}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-2 lg:pb-0">
                <button
                  type="button"
                  onClick={() => { refresh(); if (!isUnassignedView) saldoCoa.refresh(); }}
                  disabled={loading || (!isUnassignedView && !activeClientId)}
                  title="Refresh"
                  className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40"
                >
                  <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
                <button type="button" onClick={handleExport} disabled={filtered.length === 0} className={btnOutline}>
                  <Download size={14} /> Export
                </button>
                <Link href="/coa/opening-balances" className={btnOutline}>
                  <Scale size={14} /> Opening Balances
                </Link>
                <Link href={`/coa/new${qsView}`} className={btnPrimary}>
                  <Plus size={14} /> New Account
                </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 pb-6 lg:px-8 xl:px-10">
        {/* Ringkasan */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Layers} label="Total accounts" value={accounts.length} note="In this client's chart" />
          <StatCard icon={CheckCircle2} label="Active" value={jumlahAktif} note={accounts.length ? `${Math.round((jumlahAktif / accounts.length) * 100)}% of total accounts` : '—'} />
          <StatCard icon={CircleSlash} label="Inactive" value={accounts.length - jumlahAktif} note={accounts.length ? `${Math.round(((accounts.length - jumlahAktif) / accounts.length) * 100)}% of total accounts` : '—'} />
          <StatCard icon={Inbox} label="Unassigned pool" value={unassignedCoa.accounts.length} note="Waiting to be assigned" />
        </div>

        {isUnassignedView && (
          <div className="flex items-start gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
            <Inbox size={16} className="mt-0.5 shrink-0 text-neutral-700" />
            <p className="text-xs font-medium leading-relaxed text-neutral-700">
              Accounts not linked to any client yet. Tick the ones you need and add them to{' '}
              <span className="font-semibold">{activeClientName ?? 'the active client (select one in the header)'}</span>.
            </p>
          </div>
        )}

        <div className="relative overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-0.5 before:bg-neutral-800">
          {/* Toolbar */}
          <div className="space-y-3 border-b border-neutral-300 bg-neutral-50 px-5 pb-4 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search ACC No or account name…"
                  className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-10 pr-9 text-sm text-neutral-900 placeholder:text-neutral-400 transition-shadow focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-900" aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="inline-flex shrink-0 rounded-lg border border-neutral-300 bg-white p-0.5">
                {(['all', 'active', 'inactive'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      statusFilter === s ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Chip klasifikasi = filter cepat */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setClassification('all')}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  classification === 'all' ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-700'
                }`}
              >
                All <span className="ml-0.5 tabular-nums opacity-70">{accounts.length}</span>
              </button>
              {ACCOUNT_CLASSIFICATIONS.filter(c => counts[c]).map(c => {
                const t = themeOf(c);
                const aktif = classification === c;
                return (
                  <button
                    key={c}
                    onClick={() => setClassification(aktif ? 'all' : c)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      aktif ? 'border-neutral-800 bg-neutral-100 text-neutral-900 ring-1 ring-neutral-800' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-700'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                    {labelClassification(c)}
                    <span className="tabular-nums opacity-60">{counts[c]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tabel */}
          <div className="max-h-[64vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:shadow-[inset_0_1px_0_0_#262626,inset_0_-1px_0_0_#262626] [&>th]:font-bold">
                  {isUnassignedView && (
                    <th className="w-10 py-3 pl-5">
                      <input type="checkbox" checked={semuaTerpilih} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Select all" className="h-4 w-4 rounded border-neutral-300 accent-neutral-800" />
                    </th>
                  )}
                  <th className="px-5 py-3">Account</th>
                  <th className="px-4 py-3">Classification</th>
                  <th className="px-4 py-3 text-center">Normal</th>
                  {!isUnassignedView && (
                    <th className="px-4 py-3 text-right" title="From all posted journals (same source as the financial statements)">Balance</th>
                  )}
                  <th className="px-4 py-3">Status</th>
                  <th className="w-28 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-400">
                {!isUnassignedView && !activeClientId ? (
                  <EmptyRow colSpan={kolom} icon={Building2} title="No client selected" hint="Pick a client in the header (Switch Company) to see its chart of accounts." />
                ) : loading && accounts.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={kolom} className="px-5 py-3.5">
                        <div className="h-4 animate-pulse rounded-md bg-neutral-100" style={{ width: `${60 + ((i * 7) % 35)}%` }} />
                      </td>
                    </tr>
                  ))
                ) : error ? (
                  <tr><td colSpan={kolom} className="py-14 text-center text-sm text-red-600">{error}</td></tr>
                ) : filtered.length === 0 ? (
                  accounts.length > 0 ? (
                    <EmptyRow colSpan={kolom} icon={Search} title="No matching accounts" hint="Try another keyword or clear the filters." />
                  ) : isUnassignedView ? (
                    <EmptyRow colSpan={kolom} icon={Inbox} title="The pool is empty" hint="Create an account and choose “Unassigned” to keep it here." />
                  ) : (
                    <EmptyRow colSpan={kolom} icon={ListTree} title="No accounts yet" hint="Start with “New Account” or pull accounts from the Unassigned pool." />
                  )
                ) : filtered.map(a => {
                  const t = themeOf(a.account_classification);
                  const terpilih = isUnassignedView && selected.has(a.id);
                  return (
                    <tr key={a.id} className={`group transition-colors hover:bg-neutral-50 ${terpilih ? 'bg-neutral-100 hover:bg-neutral-100' : ''} ${a.is_active ? '' : 'text-neutral-500'}`}>
                      {isUnassignedView && (
                        <td className="py-3 pl-5">
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} aria-label={`Select ${a.acc_no}`} className="h-4 w-4 rounded border-neutral-300 accent-neutral-800" />
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`h-8 w-0.5 shrink-0 rounded-full bg-neutral-800 ${a.is_active ? '' : 'opacity-20'}`} />
                          <div className="min-w-0">
                            <p className="font-mono text-[11px] text-neutral-500">
                              {a.source_acc_no || a.acc_no}
                              {a.source_acc_no && a.source_acc_no !== a.acc_no && <span className="ml-1.5 text-neutral-400" title="ZAFEB standard code">· ZAFEB {a.acc_no}</span>}
                            </p>
                            <p className={`truncate text-sm font-medium ${a.is_active ? 'text-neutral-900' : 'text-neutral-500'}`} title={a.description ?? undefined}>{a.account_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{labelClassification(a.account_classification)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.normal_balance ? (
                          <span className={`inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-700 ring-1 ring-neutral-200`}>
                            {a.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'}
                          </span>
                        ) : <span className="text-neutral-300">—</span>}
                      </td>
                      {!isUnassignedView && <SaldoCell saldo={saldoCoa.balances[a.acc_no]} normal={a.normal_balance} loading={saldoCoa.loading} />}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${a.is_active ? 'text-emerald-700' : 'text-neutral-400'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${a.is_active ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                          {a.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          {isUnassignedView && (
                            <button
                              onClick={() => handleAssign([a.id])}
                              disabled={!activeClientId || assigning}
                              title={activeClientName ? `Add to ${activeClientName}` : 'Select a client first'}
                              className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30"
                            >
                              <Link2 size={14} />
                            </button>
                          )}
                          <Link href={`/coa/${a.id}/edit${qsView}`} title="Edit" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                            <Pencil size={14} />
                          </Link>
                          <button onClick={() => handleDelete(a)} title="Delete" className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {accounts.length > 0 && (
            <div className="flex items-center justify-between border-t border-neutral-300 bg-neutral-50 px-5 py-2.5 text-xs text-neutral-500">
              <span>Showing <span className="font-semibold text-neutral-900">{filtered.length}</span> of {accounts.length} accounts</span>
              {filterAktif && (
                <button
                  onClick={() => { setSearch(''); setClassification('all'); setStatusFilter('all'); }}
                  className="font-semibold text-neutral-900 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action bar mengambang: bulk assign akun unassigned */}
      {isUnassignedView && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl bg-neutral-900 py-2 pl-4 pr-2 text-white shadow-2xl shadow-neutral-900/30">
            <span className="text-sm"><span className="font-semibold tabular-nums">{selected.size}</span> selected</span>
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white">Clear</button>
            <button
              onClick={() => handleAssign([...selected])}
              disabled={!activeClientId || assigning}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              <Link2 size={14} />
              {assigning ? 'Adding…' : `Add to ${activeClientName ?? 'client'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const fmtSaldo = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Saldo akun dilihat dari sisi saldo normalnya. Negatif = abnormal (mis. kas minus). */
function SaldoCell({ saldo, normal, loading }: { saldo?: CoaBalance; normal: NormalBalance | null; loading: boolean }) {
  if (!saldo) {
    return (
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {loading ? <span className="inline-block h-3.5 w-16 animate-pulse rounded bg-neutral-100" /> : <span className="text-neutral-300">—</span>}
      </td>
    );
  }
  const nilai = balanceOnNormalSide(saldo.balance, normal);
  const nol = Math.abs(nilai) < 0.005;
  const abnormal = nilai < 0 && !nol;
  return (
    <td
      className="whitespace-nowrap px-4 py-3 text-right"
      title={`Debit ${fmtSaldo.format(saldo.debit)} · Credit ${fmtSaldo.format(saldo.credit)}${abnormal ? ' · balance is on the opposite side of the normal balance' : ''}`}
    >
      <span className={`font-mono text-sm tabular-nums ${nol ? 'text-neutral-400' : abnormal ? 'font-semibold text-rose-600' : 'font-semibold text-neutral-900'}`}>
        {abnormal ? `(${fmtSaldo.format(Math.abs(nilai))})` : fmtSaldo.format(nilai)}
      </span>
    </td>
  );
}

function EmptyRow({ colSpan, icon: Icon, title, hint }: { colSpan: number; icon: React.ElementType; title: string; hint: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-16">
        <div className="flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200">
            <Icon size={20} />
          </span>
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="mt-1 max-w-sm text-xs text-neutral-500">{hint}</p>
        </div>
      </td>
    </tr>
  );
}