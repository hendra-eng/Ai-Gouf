'use client';

// Settings > User Management: user dengan management_users.client_id = company
// aktif. Role pakai katalog RBAC (client_lv_1..9 = Org Owner..Viewer, tahap_N =
// staf internal) -- label dari backend (settings_v1.py).

import React, { useMemo, useState } from 'react';
import { CheckCircle2, CircleSlash, RefreshCcw, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fetchCompanyUsers, useLoader, type CompanyUser, type RoleGroup } from '@/lib/settingsStore';

const GRUP: Record<RoleGroup, { label: string; cls: string }> = {
  client: { label: 'Client role', cls: 'text-neutral-500' },
  internal: { label: 'Internal staff', cls: 'font-medium text-neutral-800' },
  super_admin: { label: 'Super admin', cls: 'font-semibold text-neutral-900' },
  unknown: { label: 'Unknown role', cls: 'text-amber-600' },
};

// Warna avatar deterministik dari username.
const WARNA = ['bg-neutral-800 text-white', 'bg-neutral-200 text-neutral-800', 'bg-neutral-600 text-white', 'bg-neutral-300 text-neutral-900', 'bg-neutral-700 text-white', 'bg-neutral-100 text-neutral-800 ring-1 ring-neutral-300'];
const warnaDari = (s: string) => WARNA[[...s].reduce((n, ch) => n + ch.charCodeAt(0), 0) % WARNA.length];
const inisial = (nama: string) => nama.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

type Filter = 'all' | 'yes' | 'no';

function Segmented({ value, onChange, options }: { value: Filter; onChange: (v: Filter) => void; options: [Filter, string][] }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-neutral-300 bg-white p-0.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${value === v ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>{l}</button>
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
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {([
          [Users, 'Total users', users.length],
          [CheckCircle2, 'Active', aktif],
          [CircleSlash, 'Inactive', users.length - aktif],
          [ShieldCheck, 'Members', members],
        ] as const).map(([Icon, label, n]) => (
          <div key={label} className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</p>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><Icon size={16} /></span>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{loading && users.length === 0 ? '—' : n}</p>
          </div>
        ))}
      </div>

      <div className="relative rounded-lg border border-neutral-300 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-lg before:bg-neutral-800 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-neutral-300 p-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -tranneutral-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or username…"
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50 py-2.5 pl-10 pr-9 text-sm text-neutral-900 placeholder:text-neutral-400 transition-shadow focus:border-neutral-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -tranneutral-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-900" aria-label="Clear search"><X size={14} /></button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={role} onChange={e => setRole(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300">
              <option value="all">All roles</option>
              {daftarRole.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
            <Segmented value={status} onChange={setStatus} options={[['all', 'Any status'], ['yes', 'Active'], ['no', 'Inactive']]} />
            <Segmented value={member} onChange={setMember} options={[['all', 'Any type'], ['yes', 'Member'], ['no', 'Non-member']]} />
            <button onClick={refresh} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-40">
              <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:border-y [&>th]:border-neutral-800 [&>th]:font-bold">
                <th className="px-5 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-300">
              {loading && users.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-5 py-4"><div className="h-4 animate-pulse rounded bg-neutral-100" style={{ width: `${55 + i * 9}%` }} /></td></tr>
                ))
              ) : error ? (
                <tr><td colSpan={4} className="py-14 text-center text-sm text-red-600">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16">
                    <div className="flex flex-col items-center text-center">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400"><UserRound size={20} /></span>
                      <p className="text-sm font-semibold text-neutral-900">{users.length ? 'No matching users' : 'No users yet'}</p>
                      <p className="mt-1 max-w-sm text-xs text-neutral-500">
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
                  <tr key={u.id} className={`transition-colors hover:bg-neutral-200 ${u.is_active ? '' : 'opacity-70'}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${warnaDari(u.username)}`}>{inisial(u.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-neutral-900">{u.name}</p>
                          <p className="truncate font-mono text-[11px] text-neutral-500">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-neutral-900">{u.role_label}</p>
                      <p className={`text-[11px] ${g.cls}`}>{g.label} · <span className="font-mono">{u.role}</span></p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${u.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-neutral-100 text-neutral-600 ring-neutral-500/20'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.is_member ? 'bg-neutral-100 text-neutral-800 ring-1 ring-inset ring-neutral-300' : 'bg-neutral-100 text-neutral-600'}`}>
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
          <div className="flex items-center justify-between border-t border-neutral-300 bg-neutral-50 px-5 py-2.5 text-xs text-neutral-500">
            <span>Showing <span className="font-semibold text-neutral-900">{filtered.length}</span> of {users.length} users</span>
            {filterAktif && (
              <button onClick={() => { setSearch(''); setRole('all'); setStatus('all'); setMember('all'); }} className="font-medium text-neutral-800 hover:underline">Clear filters</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
