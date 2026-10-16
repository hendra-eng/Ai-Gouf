'use client';

import React from 'react';
import { BookOpen, Landmark, Layers, List, ShoppingCart, TrendingUp } from 'lucide-react';
import { tabCls, tabNavCls } from '@/components/shared/moduleUi';

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
  icon: React.ElementType;
}

const MAIN_TABS: MainTab[] = [
  { id: 'transaksi', label: 'Transaksi', icon: List },
  { id: 'sales', label: 'Sales', icon: TrendingUp },
  { id: 'purchase', label: 'Purchase', icon: ShoppingCart },
  { id: 'journal-entry', label: 'Journal Entry', icon: BookOpen },
  { id: 'cash-bank', label: 'Cash & Bank', icon: Landmark },
  { id: 'other', label: 'Other', icon: Layers },
];

interface TransactionsMainTabsProps {
  activeTab: TransactionsMainTabId;
  onTabChange: (tab: TransactionsMainTabId) => void;
}

export default function TransactionsMainTabs({ activeTab, onTabChange }: TransactionsMainTabsProps) {
  return (
    <nav className={tabNavCls}>
      {MAIN_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={tabCls(active)}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
