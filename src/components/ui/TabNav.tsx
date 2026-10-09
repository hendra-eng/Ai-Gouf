'use client';

import React from 'react';
import Link from 'next/link';

// Navigasi tab bergaya underline -- disamakan dengan tab di halaman Financial
// Statements (FsShell.tsx): ikon + label, garis bawah pada tab aktif, border
// tipis di bawah seluruh bar. Dipakai di semua halaman yang punya tab.
//
// - Item dengan `href`  -> <Link> (tab berbasis route, mis. Journal Entry, Purchase)
// - Item tanpa `href`   -> <button> (tab berbasis state, mis. Sales, Reports);
//                          isi `onSelect` untuk menangani klik.

export interface TabNavItem {
  key: string;
  label: React.ReactNode;
  href?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Penanda angka/teks kecil di sebelah label (mis. jumlah exception). */
  badge?: React.ReactNode;
  /** Ganti gaya badge bawaan (merah) bila perlu. */
  badgeClassName?: string;
}

const BADGE_DEFAULT = 'inline-flex items-center justify-center min-w-[1rem] h-4 px-1 text-[10px] font-bold bg-red-100 text-red-600 rounded-full';

export default function TabNav({ items, activeKey, onSelect, className = '' }: {
  items: TabNavItem[];
  activeKey: string;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  return (
    <nav className={`flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1 border-b border-border ${className}`}>
      {items.map(it => {
        const active = it.key === activeKey;
        const Icon = it.icon;
        const cls = `flex items-center gap-2 px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
          active ? 'border-blue-600 text-blue-800 font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'
        }`;
        const inner = (
          <>
            {Icon && <Icon size={16} />}
            {it.label}
            {it.badge !== undefined && it.badge !== null && <span className={it.badgeClassName ?? BADGE_DEFAULT}>{it.badge}</span>}
          </>
        );
        return it.href ? (
          <Link key={it.key} href={it.href} className={cls} aria-current={active ? 'page' : undefined}>{inner}</Link>
        ) : (
          <button key={it.key} type="button" onClick={() => onSelect?.(it.key)} className={cls} aria-current={active ? 'page' : undefined}>{inner}</button>
        );
      })}
    </nav>
  );
}
