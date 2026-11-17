import React from 'react';

// Container halaman Journal Entry -- sama persis dengan SalesClient.tsx (padding tambahan +
// lebar maksimum), supaya jarak sidebar ke judul, tab, dan konten sejajar dengan halaman Sales.
// Nama file HARUS huruf kecil (layout.tsx) supaya Next.js memasangnya otomatis ke semua tab.
export default function JournalEntryLayout({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">{children}</div>;
}