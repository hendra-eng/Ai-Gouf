'use client';

// [BARU] Perakit konten tab "Sales" di halaman /transactions. Menggabungkan
// SalesKpiRow + SalesChartSection + SalesTransactionTable (yang sudah
// termasuk SalesDetailPanel di dalamnya) jadi satu komponen yang bisa
// langsung dipasang sebagai isi tab, tanpa AppLayout/sidebar/topbar sendiri
// — layout global itu sudah dipasang sekali di src/app/layout.tsx.
import React from 'react';
import SalesKpiRow from './SalesKpiRow';
import SalesChartSection from './SalesChartSection';
import SalesTransactionTable from './SalesTransactionTable';

export default function SalesTabContent() {
  return (
    <div className="space-y-5">
      <SalesKpiRow />
      <SalesChartSection />
      <SalesTransactionTable />
    </div>
  );
}
