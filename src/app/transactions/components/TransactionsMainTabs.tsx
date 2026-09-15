'use client';

import React from 'react';

// [BARU] Tab bar utama di halaman /transactions (di atas tabel "Transaksi").
// Ini SET TAB TERPISAH dari sub-halaman /transactions/sales, /transactions/purchase,
// dst yang sudah ada isinya — bukan link ke sana. 5 tab selain "Transaksi" masih
// kosong/placeholder (lihat TransactionsTabPlaceholder.tsx), isinya menyusul nanti.
// State activeTab dikontrol dari parent (TransactionsContent.tsx), bukan lewat
// routing Next.js, supaya tidak bentrok dengan route /transactions/sales dkk yang
// sudah ada.
export type TransactionsMainTabId =
  | 'transaksi'
  | 'sales'
  | 'purchase'
  | 'journal-entry'
  | 'cash-bank'
  | 'other';

interface MainTab {
  id: TransactionsMainTabId;
  label: string;
}

const MAIN_TABS: MainTab[] = [
  { id: 'transaksi', label: 'Transaksi' },
  { id: 'sales', label: 'Sales' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'journal-entry', label: 'Journal Entry' },
  { id: 'cash-bank', label: 'Cash & Bank' },
  { id: 'other', label: 'Other' },
];

interface TransactionsMainTabsProps {
  activeTab: TransactionsMainTabId;
  onTabChange: (tab: TransactionsMainTabId) => void;
}

export default function TransactionsMainTabs({ activeTab, onTabChange }: TransactionsMainTabsProps) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto scrollbar-thin">
      {MAIN_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
              active ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
