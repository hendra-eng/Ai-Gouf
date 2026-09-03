'use client';
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { CurrencyProvider } from '@/lib/currency';
import { LanguageProvider } from '@/lib/language';
import { ActiveClientProvider } from '@/lib/activeClient';
// [BARU] Provider transaksi dinaikkan ke sini (dari sebelumnya hanya di
// src/app/transactions/layout.tsx) supaya halaman DI LUAR /transactions —
// terutama Account Payable — bisa ikut baca data transaksi yang sama lewat
// useTransactions(). Ini prasyarat wajib untuk menghubungkan halaman Expense
// ke halaman Account Payable, karena keduanya harus berbagi satu instance
// state yang sama, bukan dua context terpisah.
import { TransactionsProvider } from '@/app/transactions/context/TransactionsContext';

interface AppLayoutProps {
  children: React.ReactNode;
  company?: string;
  period?: string;
}

export default function AppLayout({ children, company, period }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const currentPath = usePathname();

  return (
    <LanguageProvider>
    <CurrencyProvider>
    <ActiveClientProvider>
    <TransactionsProvider>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile overlay */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-foreground/20 z-40 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((p) => !p)}
          currentPath={currentPath || ''}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        {/* Main area */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar
            onMobileMenuToggle={() => setMobileSidebarOpen(true)}
            company={company}
            period={period}
          />
          <main className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="max-w-screen-2xl mx-auto px-4 lg:px-6 xl:px-8 2xl:px-10 py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TransactionsProvider>
    </ActiveClientProvider>
    </CurrencyProvider>
    </LanguageProvider>
  );
}