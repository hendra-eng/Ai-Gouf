'use client';

import React, { useState } from 'react';
import Sidebar from './Sidebar';
import GlobalHeader from './GlobalHeader';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export default function AppShell({ children, title, subtitle }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <GlobalHeader sidebarCollapsed={collapsed} />
        <main className="flex-1 overflow-auto pt-[52px]">
          {(title || subtitle) && (
            <div className="px-6 pt-6">
              {title && <h1 className="text-xl font-bold text-slate-800">{title}</h1>}
              {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
