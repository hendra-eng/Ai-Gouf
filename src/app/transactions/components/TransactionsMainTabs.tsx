'use client';

import React from 'react';
import { Receipt, ShoppingCart, ShoppingBag, BookOpen, Landmark, MoreHorizontal } from 'lucide-react';
import TabNav from '@/components/ui/TabNav';

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
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const MAIN_TABS: MainTab[] = [
  { id: 'transaksi', label: 'Transaksi', icon: Receipt },
  { id: 'sales', label: 'Sales', icon: ShoppingCart },
  { id: 'purchase', label: 'Purchase', icon: ShoppingBag },
  { id: 'journal-entry', label: 'Journal Entry', icon: BookOpen },
  { id: 'cash-bank', label: 'Cash & Bank', icon: Landmark },
  { id: 'other', label: 'Other', icon: MoreHorizontal },
];

interface TransactionsMainTabsProps {
  activeTab: TransactionsMainTabId;
  onTabChange: (tab: TransactionsMainTabId) => void;
}

export default function TransactionsMainTabs({ activeTab, onTabChange }: TransactionsMainTabsProps) {
  return (
    <TabNav
      activeKey={activeTab}
      onSelect={(key) => onTabChange(key as TransactionsMainTabId)}
      items={MAIN_TABS.map(t => ({ key: t.id, label: t.label, icon: t.icon }))}
    />
  );
}
