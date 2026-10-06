'use client';

// [DIUBAH] Semula file ini adalah src/app/transactions/components/tabs/purchase/page.tsx
// — karena berada di dalam folder src/app, Next.js otomatis menjadikannya
// route /transactions/components/tabs/purchase, dan isinya membungkus diri
// sendiri dengan <AppLayout> (padahal AppLayout sudah dipasang sekali di
// src/app/layout.tsx untuk SELURUH app) + mengimpor TransactionPageHeader,
// ExportMenu, dan @/lib/exportUtils yang semuanya tidak ada di project ini.
// Sekarang jadi komponen konten tab biasa (bukan route), dipasang lewat
// TransactionsContent.tsx, pakai TabExportMenu + exportUtils lokal di
// ../shared/.
import React from 'react';
import PurchaseKpiRow from './components/PurchaseKpiRow';
import PurchaseChartSection from './components/PurchaseChartSection';
import PurchaseTransactionTable from './components/PurchaseTransactionTable';
import TabExportMenu from '../shared/TabExportMenu';
import { exportToCSV, exportToPDF, exportGLSnapshot } from '../shared/exportUtils';
import { toast } from 'sonner';

const purchaseRows: Record<string, string>[] = [];

const purchaseGLEntries: { accountCode: string; accountName: string; openingBalance: number; totalDebits: number; totalCredits: number; closingBalance: number; period: string }[] = [];

export default function PurchaseTabContent() {
  const handleExportCSV = () => {
    exportToCSV(purchaseRows, 'Purchase_Transactions_Sep2026');
    toast.success('CSV exported successfully');
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Purchase Transactions Report',
      'Transaction period: September 2026 — All purchase invoices and vendor entries',
      ['Purchase ID', 'Vendor Invoice', 'Date', 'Vendor', 'Category', 'Total', 'Payment', 'Approval', 'Posting', 'Period'],
      purchaseRows.map((r) => [r['Purchase ID'], r['Vendor Invoice'], r.Date, r.Vendor, r.Category, r.Total, r['Payment Status'], r['Approval Status'], r['Posting Status'], r.Period]),
      'Purchase_Transactions_Sep2026'
    );
    toast.success('PDF report opened for printing');
  };

  const handleExportGLSnapshot = () => {
    exportGLSnapshot(purchaseGLEntries, 'Sep 2026', 'Purchase');
    toast.success('GL Snapshot opened for printing');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <TabExportMenu
          onExportCSV={handleExportCSV}
          onExportPDF={handleExportPDF}
          onExportGLSnapshot={handleExportGLSnapshot}
        />
        <button className="px-3 py-1.5 text-sm font-600 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity duration-150 active:scale-95">
          + New Purchase
        </button>
      </div>
      <PurchaseKpiRow />
      <PurchaseChartSection />
      <PurchaseTransactionTable />
    </div>
  );
}