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

type View = 'client' | 'unassigned';
type StatusFilter = 'all' | 'active' | 'inactive';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: React.ElementType; label: string; value: number | string; tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function CoaPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { clients, activeClientId, activeClientName, setActiveClient } = useActiveClient();
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
      return [a.acc_no, a.account_name].some(v => v?.toLowerCase().includes(q));
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
    if (!window.confirm(`Delete account ${akun.acc_no} "${akun.account_name}"?`)) return;
    try {
      await deleteCoaAccount(akun.id);
      toast.success('Account deleted', { description: `${akun.acc_no} — ${akun.account_name}` });
    } catch (err) {
      toast.error('Failed to delete account', { description: err instanceof Error ? err.message : undefined });
    }
  }

  function handleExport() {
    const header = ['ACC NO', 'ACCOUNT NAME', 'ACCOUNT CLASSIFICATION', 'ACCOUNT HEAD', 'ACCOUNT SUB', 'NORMAL BALANCE',
      'DESCRIPTION', 'INTERNATIONAL STANDARD GROUP (IFRS-ALIGNED)', 'STANDARD ACCOUNT CODE', 'IFRS TAXONOMY REFERENCE', 'STATUS',
      ...(isUnassignedView ? [] : ['BALANCE'])];
    const rows = filtered.map(a => [a.acc_no, a.account_name, a.account_classification, a.account_head, a.account_sub,
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
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-screen-2xl px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-blue-600/25">
                <ListTree size={20} />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Chart of Accounts</h1>
                <p className="text-sm text-muted-foreground">Master accounts per client, mapped to the IFRS-aligned standard layer.</p>
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
                onClick={() => { refresh(); if (!isUnassignedView) saldoCoa.refresh(); }}
                disabled={loading || (!isUnassignedView && !activeClientId)}
                title="Refresh"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-slate-50 hover:text-foreground disabled:opacity-40"
              >
                <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={handleExport}
                disabled={filtered.length === 0}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <Download size={14} /> Export
              </button>
              <Link
                href="/coa/opening-balances"
                className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-slate-50"
              >
                <Scale size={14} /> Opening Balances
              </Link>
              <Link
                href={`/coa/new${qsView}`}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-800"
              >
                <Plus size={15} /> New Account
              </Link>
            </div>
          </div>

          {/* Tab pill */}
          <div className="mt-6 inline-flex rounded-xl bg-slate-100 p-1">
            {([
              ['client', Building2, activeClientName ?? 'Client accounts', clientCoa.accounts.length],
              ['unassigned', Inbox, 'Unassigned', unassignedCoa.accounts.length],
            ] as const).map(([v, Icon, label, n]) => {
              const aktif = view === v;
              return (
                <button
                  key={v}
                  onClick={() => switchView(v)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                    aktif ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon size={14} className={aktif ? 'text-primary' : ''} />
                  <span className="max-w-[220px] truncate">{label}</span>
                  <span className={`rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${aktif ? 'bg-blue-50 text-primary' : 'bg-slate-200 text-slate-600'}`}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
        {/* Ringkasan */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Layers} label="Total accounts" value={accounts.length} tone="bg-blue-50 text-blue-600" />
          <StatCard icon={CheckCircle2} label="Active" value={jumlahAktif} tone="bg-emerald-50 text-emerald-600" />
          <StatCard icon={CircleSlash} label="Inactive" value={accounts.length - jumlahAktif} tone="bg-slate-100 text-slate-500" />
          <StatCard icon={Inbox} label="Unassigned pool" value={unassignedCoa.accounts.length} tone="bg-violet-50 text-violet-600" />
        </div>

        {isUnassignedView && (
          <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
            <Inbox size={16} className="mt-0.5 shrink-0 text-violet-600" />
            <p className="text-xs leading-relaxed text-violet-900">
              Accounts not linked to any client yet. Tick the ones you need and add them to{' '}
              <span className="font-semibold">{activeClientName ?? 'the active client (select one above)'}</span>.
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {/* Toolbar */}
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search ACC No or account name…"
                  className="w-full rounded-xl border border-border bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-foreground placeholder:text-slate-400 transition-shadow focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-foreground" aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
                {(['all', 'active', 'inactive'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                      statusFilter === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  classification === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      aktif ? t.badge : 'bg-card text-slate-600 ring-border hover:bg-slate-50'
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
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {isUnassignedView && (
                    <th className="w-10 py-3 pl-5">
                      <input type="checkbox" checked={semuaTerpilih} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Select all" className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
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
              <tbody className="divide-y divide-slate-100">
                {!isUnassignedView && !activeClientId ? (
                  <EmptyRow colSpan={kolom} icon={Building2} title="No client selected" hint="Pick a client above to see its chart of accounts." />
                ) : loading && accounts.length === 0 ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={kolom} className="px-5 py-3.5">
                        <div className="h-4 animate-pulse rounded-md bg-slate-100" style={{ width: `${60 + ((i * 7) % 35)}%` }} />
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
                    <tr key={a.id} className={`group transition-colors hover:bg-slate-50 ${terpilih ? 'bg-blue-50 hover:bg-blue-50' : ''} ${a.is_active ? '' : 'text-muted-foreground'}`}>
                      {isUnassignedView && (
                        <td className="py-3 pl-5">
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} aria-label={`Select ${a.acc_no}`} className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`h-8 w-1 shrink-0 rounded-full ${t.dot} ${a.is_active ? '' : 'opacity-30'}`} />
                          <div className="min-w-0">
                            <p className="font-mono text-[11px] text-slate-500">{a.acc_no}</p>
                            <p className={`truncate font-medium ${a.is_active ? 'text-foreground' : 'text-slate-500'}`} title={a.description ?? undefined}>{a.account_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{labelClassification(a.account_classification)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.normal_balance ? (
                          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${a.normal_balance === 'DEBIT' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                            {a.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      {!isUnassignedView && <SaldoCell saldo={saldoCoa.balances[a.acc_no]} normal={a.normal_balance} loading={saldoCoa.loading} />}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${a.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${a.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
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
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-primary disabled:opacity-30"
                            >
                              <Link2 size={14} />
                            </button>
                          )}
                          <Link href={`/coa/${a.id}/edit${qsView}`} title="Edit" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-foreground">
                            <Pencil size={14} />
                          </Link>
                          <button onClick={() => handleDelete(a)} title="Delete" className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600">
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
            <div className="flex items-center justify-between border-t border-border bg-slate-50 px-5 py-2.5 text-xs text-slate-500">
              <span>Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {accounts.length} accounts</span>
              {filterAktif && (
                <button
                  onClick={() => { setSearch(''); setClassification('all'); setStatusFilter('all'); }}
                  className="font-medium text-primary hover:underline"
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
          <div className="flex items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-white shadow-2xl shadow-slate-900/30">
            <span className="text-sm"><span className="font-semibold tabular-nums">{selected.size}</span> selected</span>
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white">Clear</button>
            <button
              onClick={() => handleAssign([...selected])}
              disabled={!activeClientId || assigning}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold transition-colors hover:bg-blue-500 disabled:opacity-50"
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
        {loading ? <span className="inline-block h-3.5 w-16 animate-pulse rounded bg-slate-100" /> : <span className="text-slate-300">—</span>}
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
      <span className={`font-mono text-sm tabular-nums ${nol ? 'text-slate-400' : abnormal ? 'font-semibold text-red-600' : 'font-semibold text-foreground'}`}>
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
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Icon size={20} />
          </span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>
        </div>
      </td>
    </tr>
  );
}
