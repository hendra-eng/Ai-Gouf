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

const purchaseRows = [
  { 'Purchase ID': 'PUR-2026-0841', 'Vendor Invoice': 'VIN-88421', Date: '09/13/2026', Vendor: 'Synergy Systems Inc.', Category: 'Technology', Subtotal: '$32,000.00', Discount: '$1,600.00', Tax: '$2,554.00', Total: '$32,954.00', 'Payment Status': 'Unpaid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0840', 'Vendor Invoice': 'VIN-77318', Date: '09/12/2026', Vendor: 'CoreSupply Partners', Category: 'Raw Materials', Subtotal: '$18,400.00', Discount: '$0.00', Tax: '$1,546.00', Total: '$19,946.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0839', 'Vendor Invoice': 'VIN-66204', Date: '09/11/2026', Vendor: 'Nexus Office Solutions', Category: 'Office Supplies', Subtotal: '$12,600.00', Discount: '$630.00', Tax: '$1,007.00', Total: '$12,977.00', 'Payment Status': 'Partial', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0838', 'Vendor Invoice': 'VIN-55198', Date: '09/10/2026', Vendor: 'Atlas Freight Services', Category: 'Logistics', Subtotal: '$9,800.00', Discount: '$490.00', Tax: '$778.00', Total: '$10,088.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0837', 'Vendor Invoice': 'VIN-44087', Date: '09/09/2026', Vendor: 'Pinnacle Cloud Ltd.', Category: 'Cloud Services', Subtotal: '$8,200.00', Discount: '$0.00', Tax: '$689.00', Total: '$8,889.00', 'Payment Status': 'Unpaid', 'Approval Status': 'Pending', 'Posting Status': 'Pending', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0836', 'Vendor Invoice': 'VIN-33976', Date: '09/08/2026', Vendor: 'Delta Engineering Co.', Category: 'Engineering', Subtotal: '$14,000.00', Discount: '$700.00', Tax: '$1,109.00', Total: '$14,409.00', 'Payment Status': 'Unpaid', 'Approval Status': 'Pending', 'Posting Status': 'Draft', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0835', 'Vendor Invoice': 'VIN-22864', Date: '09/06/2026', Vendor: 'Synergy Systems Inc.', Category: 'Technology', Subtotal: '$16,200.00', Discount: '$810.00', Tax: '$1,293.00', Total: '$16,683.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0834', 'Vendor Invoice': 'VIN-11753', Date: '09/05/2026', Vendor: 'CoreSupply Partners', Category: 'Raw Materials', Subtotal: '$7,600.00', Discount: '$380.00', Tax: '$605.00', Total: '$7,825.00', 'Payment Status': 'Overdue', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0833', 'Vendor Invoice': 'VIN-00642', Date: '09/04/2026', Vendor: 'Nexus Office Solutions', Category: 'Office Supplies', Subtotal: '$2,800.00', Discount: '$0.00', Tax: '$235.00', Total: '$3,035.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0832', 'Vendor Invoice': 'VIN-99531', Date: '09/03/2026', Vendor: 'Atlas Freight Services', Category: 'Logistics', Subtotal: '$4,400.00', Discount: '$0.00', Tax: '$370.00', Total: '$4,770.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0831', 'Vendor Invoice': 'VIN-88420', Date: '09/02/2026', Vendor: 'Delta Engineering Co.', Category: 'Engineering', Subtotal: '$11,000.00', Discount: '$550.00', Tax: '$878.00', Total: '$11,328.00', 'Payment Status': 'Unpaid', 'Approval Status': 'Rejected', 'Posting Status': 'Draft', Period: 'Sep 2026' },
  { 'Purchase ID': 'PUR-2026-0830', 'Vendor Invoice': 'VIN-77319', Date: '09/01/2026', Vendor: 'Pinnacle Cloud Ltd.', Category: 'Cloud Services', Subtotal: '$6,400.00', Discount: '$320.00', Tax: '$510.00', Total: '$6,590.00', 'Payment Status': 'Paid', 'Approval Status': 'Approved', 'Posting Status': 'Posted', Period: 'Sep 2026' },
];

const purchaseGLEntries = [
  { accountCode: '1300', accountName: 'Raw Materials Inventory', openingBalance: 84200, totalDebits: 27771, totalCredits: 0, closingBalance: 111971, period: 'Sep 2026' },
  { accountCode: '1500', accountName: 'IT Equipment', openingBalance: 142000, totalDebits: 32954, totalCredits: 0, closingBalance: 174954, period: 'Sep 2026' },
  { accountCode: '2000', accountName: 'Accounts Payable', openingBalance: 68400, totalDebits: 52418, totalCredits: 149494, closingBalance: 165476, period: 'Sep 2026' },
  { accountCode: '2210', accountName: 'Input Tax Payable', openingBalance: 9100, totalDebits: 0, totalCredits: 11574, closingBalance: 20674, period: 'Sep 2026' },
  { accountCode: '6100', accountName: 'Software Expense', openingBalance: 0, totalDebits: 16683, totalCredits: 0, closingBalance: 16683, period: 'Sep 2026' },
  { accountCode: '6200', accountName: 'Office Expense', openingBalance: 0, totalDebits: 16012, totalCredits: 0, closingBalance: 16012, period: 'Sep 2026' },
  { accountCode: '6400', accountName: 'Freight Expense', openingBalance: 0, totalDebits: 14858, totalCredits: 0, closingBalance: 14858, period: 'Sep 2026' },
  { accountCode: '6600', accountName: 'Cloud Services Expense', openingBalance: 0, totalDebits: 15479, totalCredits: 0, closingBalance: 15479, period: 'Sep 2026' },
  { accountCode: '6800', accountName: 'Professional Fees', openingBalance: 0, totalDebits: 25737, totalCredits: 0, closingBalance: 25737, period: 'Sep 2026' },
];

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
