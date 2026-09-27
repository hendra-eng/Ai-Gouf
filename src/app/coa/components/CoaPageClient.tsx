'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ListTree, Plus, Download, Search, Pencil, Trash2, RefreshCcw, Building2, Link2, Inbox } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  ACCOUNT_CLASSIFICATIONS,
  assignCoaAccounts,
  createCoaAccount,
  deleteCoaAccount,
  updateCoaAccount,
  useClientCoa,
  useUnassignedCoa,
  type CoaAccount,
  type CoaAccountInput,
} from '@/lib/coaStore';
import CoaFormModal, { type CoaFormTarget } from './CoaFormModal';

const CLASSIFICATION_BADGE: Record<string, string> = {
  ASSET: 'bg-blue-50 text-blue-700',
  LIABILITY: 'bg-amber-50 text-amber-700',
  EQUITY: 'bg-violet-50 text-violet-700',
  REVENUE: 'bg-emerald-50 text-emerald-700',
  'COST OF SALES': 'bg-orange-50 text-orange-700',
  EXPENSE: 'bg-red-50 text-red-700',
  'OTHER INCOME': 'bg-teal-50 text-teal-700',
  'OTHER EXPENSE': 'bg-rose-50 text-rose-700',
  'INCOME TAX': 'bg-slate-100 text-slate-700',
};

type View = 'client' | 'unassigned';
type StatusFilter = 'all' | 'active' | 'inactive';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function CoaPageClient() {
  const { clients, activeClientId, activeClientName, setActiveClient } = useActiveClient();
  const clientCoa = useClientCoa(activeClientId);
  const unassignedCoa = useUnassignedCoa();

  const [view, setView] = useState<View>('client');
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CoaAccount | null>(null);
  // Pilihan akun unassigned yang akan ditambahkan ke klien aktif.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const isUnassignedView = view === 'unassigned';
  const { accounts, loading, error, refresh } = isUnassignedView ? unassignedCoa : clientCoa;

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      if (classification !== 'all' && a.account_classification !== classification) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (!q) return true;
      return [a.acc_no, a.account_name, a.account_head, a.account_sub, a.standard_account_code]
        .some(v => v?.toLowerCase().includes(q));
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

  async function handleCreate(data: CoaAccountInput, target: CoaFormTarget) {
    const clientId = target === 'client' ? activeClientId : null;
    try {
      const akun = await createCoaAccount(clientId, data);
      setShowAdd(false);
      toast.success(clientId ? 'Account added' : 'Unassigned account added', { description: `${akun.acc_no} — ${akun.account_name}` });
    } catch (err) {
      toast.error('Failed to add account', { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function handleUpdate(data: CoaAccountInput) {
    if (!editing) return;
    try {
      const akun = await updateCoaAccount(editing.id, data);
      setEditing(null);
      toast.success('Account updated', { description: `${akun.acc_no} — ${akun.account_name}` });
    } catch (err) {
      toast.error('Failed to update account', { description: err instanceof Error ? err.message : undefined });
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
      'DESCRIPTION', 'INTERNATIONAL STANDARD GROUP (IFRS-ALIGNED)', 'STANDARD ACCOUNT CODE', 'IFRS TAXONOMY REFERENCE', 'STATUS'];
    const rows = filtered.map(a => [a.acc_no, a.account_name, a.account_classification, a.account_head, a.account_sub,
      a.normal_balance, a.description, a.international_standard_group, a.standard_account_code, a.ifrs_taxonomy_reference,
      a.is_active ? 'Active' : 'Inactive']);
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
    setView(v);
    setClassification('all');
    setSearch('');
  };

  const kolomAksi = isUnassignedView ? 9 : 8;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ListTree size={20} className="text-primary" />
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Chart of Accounts</h1>
            </div>
            <p className="text-sm text-muted-foreground">Master chart of accounts per client, mapped to the IFRS-aligned standard account layer.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Building2 size={14} className="text-muted-foreground" />
              <select
                value={activeClientId ?? ''}
                onChange={e => {
                  const c = clients.find(x => x.id === e.target.value);
                  setActiveClient(c?.id ?? null, c?.companyName ?? null);
                }}
                className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 min-w-[220px]"
              >
                <option value="" disabled>Select client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}{c.clientCode ? ` (${c.clientCode})` : ''}</option>)}
              </select>
            </div>
            <button onClick={refresh} disabled={loading || (!isUnassignedView && !activeClientId)} title="Refresh" className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40">
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={handleExport} disabled={filtered.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40">
              <Download size={14} /> Export
            </button>
            {!isUnassignedView && (
              <button onClick={() => switchView('unassigned')} disabled={!activeClientId} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40">
                <Link2 size={14} /> Add from Unassigned
              </button>
            )}
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus size={14} /> Add Account
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5 space-y-4">
        {/* Tab: COA klien aktif vs akun yang belum terhubung ke klien */}
        <div className="flex items-center gap-1 border-b border-border">
          {([
            ['client', activeClientName ? `${activeClientName} Accounts` : 'Client Accounts', clientCoa.accounts.length],
            ['unassigned', 'Unassigned Accounts', unassignedCoa.accounts.length],
          ] as const).map(([v, label, n]) => (
            <button
              key={v}
              onClick={() => switchView(v)}
              className={`px-4 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${view === v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {label} <span className="ml-1 text-xs font-mono opacity-70">{n}</span>
            </button>
          ))}
        </div>

        {isUnassignedView && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Accounts not linked to any client yet. Select accounts and add them to{' '}
              <span className="font-semibold text-foreground">{activeClientName ?? 'the active client (select one above)'}</span>.
            </p>
            <button
              onClick={() => handleAssign([...selected])}
              disabled={!activeClientId || selected.size === 0 || assigning}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Link2 size={14} />
              {assigning ? 'Adding…' : `Add ${selected.size || ''} selected to ${activeClientName ?? 'client'}`}
            </button>
          </div>
        )}

        {/* Ringkasan per klasifikasi -- sekaligus jadi filter cepat */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setClassification('all')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${classification === 'all' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
          >
            All <span className="ml-1 font-mono">{accounts.length}</span>
          </button>
          {ACCOUNT_CLASSIFICATIONS.filter(c => counts[c]).map(c => (
            <button
              key={c}
              onClick={() => setClassification(classification === c ? 'all' : c)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${classification === c ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
            >
              {c} <span className="ml-1 font-mono">{counts[c]}</span>
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row gap-2 p-3 border-b border-border">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isUnassignedView ? 'Search unassigned accounts by ACC No, name, head, sub, or standard code…' : 'Search ACC No, account name, head, sub, or standard code…'}
                className="w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  {isUnassignedView && (
                    <th className="pl-4 py-2.5 w-8">
                      <input type="checkbox" checked={semuaTerpilih} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Select all" />
                    </th>
                  )}
                  <th className="px-4 py-2.5 font-semibold">ACC No</th>
                  <th className="px-4 py-2.5 font-semibold">Account Name</th>
                  <th className="px-4 py-2.5 font-semibold">Classification</th>
                  <th className="px-4 py-2.5 font-semibold">Head / Sub</th>
                  <th className="px-4 py-2.5 font-semibold">Normal</th>
                  <th className="px-4 py-2.5 font-semibold">Standard Code</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!isUnassignedView && !activeClientId ? (
                  <tr><td colSpan={kolomAksi} className="text-center py-12 text-sm text-muted-foreground">Select a client to view its chart of accounts.</td></tr>
                ) : loading && accounts.length === 0 ? (
                  <tr><td colSpan={kolomAksi} className="text-center py-12 text-sm text-muted-foreground">Loading chart of accounts…</td></tr>
                ) : error ? (
                  <tr><td colSpan={kolomAksi} className="text-center py-12 text-sm text-red-600">{error}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={kolomAksi} className="text-center py-12 text-sm text-muted-foreground">
                    {accounts.length > 0 ? 'No accounts match the current filters.' : isUnassignedView ? (
                      <span className="inline-flex flex-col items-center gap-2">
                        <Inbox size={20} />
                        No unassigned accounts. Use “Add Account” and choose “Unassigned” to create one.
                      </span>
                    ) : 'This client has no chart of accounts yet.'}
                  </td></tr>
                ) : filtered.map(a => (
                  <tr key={a.id} className={`hover:bg-muted/30 ${a.is_active ? '' : 'opacity-60'} ${selected.has(a.id) && isUnassignedView ? 'bg-primary/5' : ''}`}>
                    {isUnassignedView && (
                      <td className="pl-4 py-2.5">
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} aria-label={`Select ${a.acc_no}`} />
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-mono text-foreground whitespace-nowrap">{a.acc_no}</td>
                    <td className="px-4 py-2.5 text-foreground" title={a.description ?? undefined}>{a.account_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${CLASSIFICATION_BADGE[a.account_classification] ?? 'bg-muted text-muted-foreground'}`}>{a.account_classification}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs text-foreground">{a.account_head ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{a.account_sub ?? ''}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.normal_balance ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground" title={a.international_standard_group ?? undefined}>{a.standard_account_code ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${a.is_active ? 'text-emerald-600' : 'text-muted-foreground'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isUnassignedView && (
                          <button
                            onClick={() => handleAssign([a.id])}
                            disabled={!activeClientId || assigning}
                            title={activeClientName ? `Add to ${activeClientName}` : 'Select a client first'}
                            className="p-1.5 rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                          >
                            <Link2 size={13} />
                          </button>
                        )}
                        <button onClick={() => setEditing(a)} title="Edit" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(a)} title="Delete" className="p-1.5 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {accounts.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {accounts.length} accounts
              {isUnassignedView && selected.size > 0 && ` · ${selected.size} selected`}
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <CoaFormModal
          activeClientName={activeClientId ? activeClientName : null}
          defaultTarget={isUnassignedView ? 'unassigned' : 'client'}
          onClose={() => setShowAdd(false)}
          onSubmit={handleCreate}
        />
      )}
      {editing && (
        <CoaFormModal
          initial={editing}
          activeClientName={activeClientName}
          onClose={() => setEditing(null)}
          onSubmit={data => handleUpdate(data)}
        />
      )}
    </div>
  );
}
