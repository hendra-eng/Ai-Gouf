'use client';

import React from 'react';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <TopHeader />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}