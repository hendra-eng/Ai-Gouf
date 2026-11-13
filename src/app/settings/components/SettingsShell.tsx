'use client';

// Kerangka halaman Management > Settings: header + pemilih company + sub-navigasi
// (sidebar kedua) di samping konten. Tiap tab = route sendiri di /settings/<tab>.

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ChevronRight, Package, Settings, ShoppingBag, Users, Waypoints } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';

const MENU = [
  { href: '/settings/company', label: 'Company', hint: 'Profile, tax & contact details', icon: Building2 },
  { href: '/settings/users', label: 'User Management', hint: 'Users of this company', icon: Users },
  { href: '/settings/purchase', label: 'Purchase', hint: 'Purchase preferences', icon: ShoppingBag },
  { href: '/settings/product', label: 'Product', hint: 'Categories, units & subfeatures', icon: Package },
  { href: '/settings/account-mapping', label: 'Account Mapping', hint: 'Default posting accounts', icon: Waypoints },
] as const;

export default function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { clients, activeClientId, activeClientName, setActiveClient } = useActiveClient();
  const aktif = MENU.find(m => pathname?.startsWith(m.href));

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="pb-2">
        <div className="mx-auto max-w-screen-2xl">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
            <Settings size={13} />
            <span>Settings</span>
            {aktif && <><ChevronRight size={12} /><span className="font-medium text-foreground">{aktif.label}</span></>}
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-blue-600 text-white shadow-md shadow-slate-700/25">
                <Settings size={20} />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Configuration for {activeClientName ? <span className="font-medium text-foreground">{activeClientName}</span> : 'the selected company'}.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-3 pr-1.5 shadow-sm">
              <Building2 size={14} className="text-muted-foreground" />
              <select
                value={activeClientId ?? ''}
                onChange={e => {
                  const c = clients.find(x => x.id === e.target.value);
                  setActiveClient(c?.id ?? null, c?.companyName ?? null);
                }}
                className="min-w-[220px] bg-transparent py-0.5 text-sm font-medium text-foreground focus:outline-none"
              >
                <option value="" disabled>Select company</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}{c.clientCode ? ` (${c.clientCode})` : ''}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-6 pt-4 pb-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Sidebar kedua */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-2 shadow-sm lg:flex-col lg:overflow-visible">
            {MENU.map(m => {
              const Icon = m.icon;
              const on = pathname?.startsWith(m.href);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-primary text-white shadow-sm shadow-blue-600/30' : 'bg-slate-100 text-slate-500 group-hover:text-foreground'}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${on ? 'text-primary' : 'text-foreground'}`}>
                      {m.label}
                    </span>
                    <span className="hidden text-[11px] text-muted-foreground lg:block">{m.hint}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          {activeClientId ? children : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Building2 size={20} /></span>
              <p className="text-sm font-semibold text-foreground">No company selected</p>
              <p className="mt-1 text-xs text-muted-foreground">Pick a company above to manage its settings.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
