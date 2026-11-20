'use client';

// Dropdown pilih client di halaman Opening Balance, supaya user bisa pindah
// upload ke client lain tanpa keluar ke halaman COA. Dipakai di tab Import Data
// dan di panel "opening balance belum dibuat".

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, Plus } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { btnPrimary, Menu } from '@/components/arap/arapSalesUi';

const SINGKATAN = new Set(['PT', 'CV', 'UD', 'TBK', 'PD', 'YAYASAN']);

/** "NAWASANGA BERTATAP MUKA" -> "Nawasanga Bertatap Muka"; PT/CV tetap kapital. */
function judulNama(nama: string): string {
  return nama.trim().toLowerCase().split(/\s+/).map(w => {
    const up = w.toUpperCase();
    return SINGKATAN.has(up) ? up : w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/** "Nawasanga Bertatap Muka(NBM)" */
function labelClient(c: { companyName: string; clientCode?: string | null }): string {
  return `${judulNama(c.companyName)}${c.clientCode ? `(${c.clientCode})` : ''}`;
}

export function ObClientSwitcher({ value, onChange, disabled }: {
  value: string | null; onChange: (clientId: string) => void; disabled?: boolean;
}) {
  const { clients } = useActiveClient();
  const terpilih = clients.find(c => c.id === value) ?? null;

  // Dropdown custom ala AR/Sales (Menu) -- bukan <select> bawaan browser.
  return (
    <Menu
      align="left"
      width="w-full"
      button={open => (
        <button
          type="button"
          disabled={disabled}
          title="Switch client"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-white pl-3.5 pr-3 text-left text-sm font-semibold shadow-sm transition-colors hover:border-neutral-700 disabled:cursor-wait disabled:opacity-60 ${
            open ? 'border-neutral-800 ring-1 ring-neutral-800' : 'border-neutral-400'
          }`}
        >
          <span className={`truncate ${terpilih ? 'text-neutral-900' : 'text-neutral-400'}`}>
            {terpilih ? labelClient(terpilih) : 'Select client'}
          </span>
          <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {close => (
        <div role="listbox" className="max-h-80 overflow-y-auto">
          {clients.map(c => {
            const aktif = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={aktif}
                onClick={() => { close(); if (!aktif) onChange(c.id); }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-100 ${
                  aktif ? 'bg-neutral-100 font-semibold text-neutral-900' : 'font-medium text-neutral-700 hover:text-neutral-900'
                }`}
              >
                <span className="min-w-0 truncate">{labelClient(c)}</span>
                {aktif && <Check size={15} className="shrink-0 text-neutral-800" />}
              </button>
            );
          })}
        </div>
      )}
    </Menu>
  );
}

/** Pemberitahuan: client terpilih belum punya opening balance. */
export function ObMissingNotice({ clientName }: { clientName: string }) {
  return (
    <div className="relative flex flex-col items-center overflow-hidden rounded-lg border border-neutral-300 bg-white px-6 py-16 text-center shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-neutral-800">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200"><AlertTriangle size={20} /></span>
      <p className="text-sm font-semibold text-neutral-900">Opening balance has not been created for this client</p>
      <p className="mt-1 max-w-md text-xs font-medium text-neutral-500">
        <span className="font-semibold text-neutral-800">{clientName}</span> doesn’t have an opening balance yet. Create one first, then you can import data here.
      </p>
      <Link href="/coa/opening-balances/new" className={`${btnPrimary} mt-4`}><Plus size={14} /> Create opening balance</Link>
    </div>
  );
}