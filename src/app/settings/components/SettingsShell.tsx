'use client';

// Kerangka halaman Management > Settings: header + pemilih company + sub-navigasi
// (sidebar kedua) di samping konten. Tiap tab = route sendiri di /settings/<tab>.
// [DIUBAH] Tampilan diseragamkan dengan tema "elegant" (neutral, Inter, PageHeading,
// kartu dengan garis atas gelap) seperti halaman AR / AP / Sales / Documents.

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ChevronRight, Package, Settings, ShoppingBag, Users, Waypoints } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import PageHeading from '@/components/shared/PageHeading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

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
    <div className={`${salesFont.className} mx-auto min-h-screen max-w-screen-2xl space-y-5 bg-background px-6 pb-16 pt-5 lg:px-8 xl:px-10`}>
      <div>
        <nav className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500">
          <Settings size={13} />
          <span>Settings</span>
          {aktif && <><ChevronRight size={12} /><span className="font-semibold text-neutral-900">{aktif.label}</span></>}
        </nav>
        <PageHeading
          title="Settings"
          description={<>Configuration for {activeClientName ? <span className="font-semibold text-neutral-900">{activeClientName}</span> : 'the selected company'}.</>}
          actions={(
            <label className="flex items-center gap-2 rounded-lg border border-neutral-400 bg-white py-1.5 pl-3 pr-2 shadow-sm transition-colors focus-within:border-neutral-700 hover:border-neutral-500">
              <Building2 size={14} className="text-neutral-500" />
              <select
                value={activeClientId ?? ''}
                onChange={e => {
                  const c = clients.find(x => x.id === e.target.value);
                  setActiveClient(c?.id ?? null, c?.companyName ?? null);
                }}
                className="min-w-[220px] bg-transparent py-0.5 text-xs font-semibold text-neutral-900 focus:outline-none"
              >
                <option value="" disabled>Select company</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.companyName}{c.clientCode ? ` (${c.clientCode})` : ''}</option>)}
              </select>
            </label>
          )}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Sidebar kedua */}
        <aside className="lg:sticky lg:top-6">
          <nav className="relative flex gap-1 overflow-x-auto rounded-lg border border-neutral-400 bg-white p-2 pt-2.5 shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-lg before:bg-neutral-800 lg:flex-col lg:overflow-visible">
            {MENU.map(m => {
              const Icon = m.icon;
              const on = pathname?.startsWith(m.href);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`group flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${on ? 'bg-neutral-800' : 'hover:bg-neutral-100'}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-300 group-hover:text-neutral-900'}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs font-semibold ${on ? 'text-white' : 'text-neutral-900'}`}>{m.label}</span>
                    <span className={`hidden text-[11px] lg:block ${on ? 'text-neutral-300' : 'text-neutral-500'}`}>{m.hint}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          {activeClientId ? children : (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-neutral-400 bg-neutral-50 px-6 py-16 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-neutral-500 ring-1 ring-neutral-300"><Building2 size={20} /></span>
              <p className="text-sm font-semibold text-neutral-900">No company selected</p>
              <p className="mt-1 text-xs text-neutral-500">Pick a company above to manage its settings.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
