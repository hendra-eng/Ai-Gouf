'use client';
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { CurrencyProvider } from '@/lib/currency';
import { LanguageProvider } from '@/lib/language';

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
    </CurrencyProvider>
    </LanguageProvider>
  );
}