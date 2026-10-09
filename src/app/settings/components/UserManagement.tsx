'use client';

// Settings > User Management: user dengan management_users.client_id = company
// aktif. Role pakai katalog RBAC (client_lv_1..9 = Org Owner..Viewer, tahap_N =
// staf internal) -- label dari backend (settings_v1.py).

import React, { useMemo, useState } from 'react';
import { CheckCircle2, CircleSlash, RefreshCcw, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fetchCompanyUsers, useLoader, type CompanyUser, type RoleGroup } from '@/lib/settingsStore';

const GRUP: Record<RoleGroup, { label: string; cls: string }> = {
  client: { label: 'Client role', cls: 'text-slate-500' },
  internal: { label: 'Internal staff', cls: 'text-blue-600' },
  super_admin: { label: 'Super admin', cls: 'text-violet-600' },
  unknown: { label: 'Unknown role', cls: 'text-amber-600' },
};

// Warna avatar deterministik dari username.
const WARNA = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700'];
const warnaDari = (s: string) => WARNA[[...s].reduce((n, ch) => n + ch.charCodeAt(0), 0) % WARNA.length];
const inisial = (nama: string) => nama.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

type Filter = 'all' | 'yes' | 'no';

function Segmented({ value, onChange, options }: { value: Filter; onChange: (v: Filter) => void; options: [Filter, string][] }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${value === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
      ))}
    </div>
  );
}

export default function UserManagement() {
  const { activeClientId, activeClientName } = useActiveClient();
  const { data: users, loading, error, refresh } = useLoader<CompanyUser[]>(activeClientId, fetchCompanyUsers, []);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<Filter>('all');
  const [member, setMember] = useState<Filter>('all');

  const daftarRole = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach(u => m.set(u.role, u.role_label));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (role !== 'all' && u.role !== role) return false;
      if (status !== 'all' && u.is_active !== (status === 'yes')) return false;
      if (member !== 'all' && u.is_member !== (member === 'yes')) return false;
      return !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    });
  }, [users, search, role, status, member]);

  const aktif = users.filter(u => u.is_active).length;
  const members = users.filter(u => u.is_member).length;
  const filterAktif = !!search || role !== 'all' || status !== 'all' || member !== 'all';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {([
          [Users, 'Total users', users.length, 'bg-blue-50 text-blue-600'],
          [CheckCircle2, 'Active', aktif, 'bg-emerald-50 text-emerald-600'],
          [CircleSlash, 'Inactive', users.length - aktif, 'bg-slate-100 text-slate-500'],
          [ShieldCheck, 'Members', members, 'bg-violet-50 text-violet-600'],
        ] as const).map(([Icon, label, n, tone]) => (
          <div key={label} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={18} /></span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="number-display text-xl font-bold text-foreground leading-none">{n}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or username…"
              className="w-full rounded-xl border border-border bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-foreground placeholder:text-slate-400 transition-shadow focus:border-blue-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-foreground" aria-label="Clear search"><X size={14} /></button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={role} onChange={e => setRole(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-4 focus:ring-blue-100">
              <option value="all">All roles</option>
              {daftarRole.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
            <Segmented value={status} onChange={setStatus} options={[['all', 'Any status'], ['yes', 'Active'], ['no', 'Inactive']]} />
            <Segmented value={member} onChange={setMember} options={[['all', 'Any type'], ['yes', 'Member'], ['no', 'Non-member']]} />
            <button onClick={refresh} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-slate-50 hover:text-foreground disabled:opacity-40">
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && users.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-5 py-4"><div className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${55 + i * 9}%` }} /></td></tr>
                ))
              ) : error ? (
                <tr><td colSpan={4} className="py-14 text-center text-sm text-red-600">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16">
                    <div className="flex flex-col items-center text-center">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><UserRound size={20} /></span>
                      <p className="text-sm font-semibold text-foreground">{users.length ? 'No matching users' : 'No users yet'}</p>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        {users.length
                          ? 'Try another keyword or clear the filters.'
                          : `No user account is linked to ${activeClientName ?? 'this company'} yet.`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(u => {
                const g = GRUP[u.role_group] ?? GRUP.unknown;
                return (
                  <tr key={u.id} className={`transition-colors hover:bg-slate-50 ${u.is_active ? '' : 'opacity-70'}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${warnaDari(u.username)}`}>{inisial(u.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{u.name}</p>
                          <p className="truncate font-mono text-[11px] text-slate-500">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{u.role_label}</p>
                      <p className={`text-[11px] ${g.cls}`}>{g.label} · <span className="font-mono">{u.role}</span></p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${u.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.is_member ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                        {u.is_member ? 'Member' : 'Non-member'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {users.length > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-slate-50 px-5 py-2.5 text-xs text-slate-500">
            <span>Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {users.length} users</span>
            {filterAktif && (
              <button onClick={() => { setSearch(''); setRole('all'); setStatus('all'); setMember('all'); }} className="font-medium text-primary hover:underline">Clear filters</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
