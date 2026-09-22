'use client';
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { CurrencyProvider } from '@/lib/currency';
import { LanguageProvider } from '@/lib/language';
import { ActiveClientProvider } from '@/lib/activeClient';
// [BARU] Provider transaksi dinaikkan ke sini (dari sebelumnya hanya di
// src/app/transactions/layout.tsx) supaya halaman DI LUAR /transactions —
// terutama Account Payable — bisa ikut baca data transaksi yang sama lewat
// useTransactions(). Ini prasyarat wajib untuk menghubungkan halaman Purchase
// ke halaman Account Payable, karena keduanya harus berbagi satu instance
// state yang sama, bukan dua context terpisah.
import { TransactionsProvider } from '@/app/transactions/context/TransactionsContext';
import { AuthProvider } from '@/lib/auth';

interface AppLayoutProps {
  children: React.ReactNode;
  company?: string;
  period?: string;
}

export default function AppLayout({ children, company, period }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const currentPath = usePathname();
  // /login punya layout sendiri (full-screen, tanpa Sidebar/Topbar) --
  // halaman ini justru ditampilkan SEBELUM ada sesi login, jadi tidak
  // masuk akal dibungkus chrome dashboard yang butuh login.
  const isLoginPage = currentPath === '/login';

  // [BARU] Satu instance QueryClient dibuat sekali per mount lewat
  // useState (bukan variabel module-level), supaya tiap sesi user di
  // client punya cache-nya sendiri dan tidak bocor antar request saat
  // SSR. Ini fondasi caching data per-client (lihat usePurchaseData di
  // purchasebridge.ts) -- begitu data satu client sudah pernah di-fetch,
  // pindah tab/halaman baca dari cache ini, bukan fetch ulang ke backend.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // data dianggap masih segar 1 menit, tidak refetch otomatis dalam rentang ini
            gcTime: 10 * 60 * 1000, // cache disimpan 10 menit setelah tidak dipakai (misal pindah client lalu balik lagi)
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
    <LanguageProvider>
    <CurrencyProvider>
    <AuthProvider>
    {isLoginPage ? (
      children
    ) : (
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
    )}
    </AuthProvider>
    </CurrencyProvider>
    </LanguageProvider>
    </QueryClientProvider>
  );
}