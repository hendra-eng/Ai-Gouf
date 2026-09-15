'use client';

// [DIUBAH] Sama seperti Purchase — semula ini src/app/transactions/components/
// tabs/journal-entry/page.tsx yang otomatis jadi route Next.js dan
// membungkus diri sendiri dengan <AppLayout> + TransactionPageHeader/
// ExportMenu/@/lib/exportUtils yang tidak ada. Sekarang jadi komponen konten
// tab biasa yang dipasang dari TransactionsContent.tsx.
import React from 'react';
import JournalKpiRow from './components/JournalKpiRow';
import JournalBalanceValidator from './components/JournalBalanceValidator';
import JournalEntryTable from './components/JournalEntryTable';
import TabExportMenu from '../shared/TabExportMenu';
import { exportToCSV, exportToPDF, exportGLSnapshot } from '../shared/exportUtils';
import { toast } from 'sonner';

const journalRows = [
  { 'JE Number': 'JE-2026-0481', 'Journal Date': '09/13/2026', 'Posting Date': '09/13/2026', Description: 'Monthly depreciation — IT equipment and vehicles', Source: 'Auto-Generated', 'Source Ref': 'DEP-SEP-2026', 'Total Debit': '$14,800.00', 'Total Credit': '$14,800.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0480', 'Journal Date': '09/12/2026', 'Posting Date': '09/12/2026', Description: 'Accrued salaries — Sep 2026 payroll provision', Source: 'Manual Entry', 'Source Ref': 'PAY-SEP-2026', 'Total Debit': '$84,600.00', 'Total Credit': '$84,600.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0479', 'Journal Date': '09/11/2026', 'Posting Date': '09/11/2026', Description: 'Revenue recognition — INV-2026-0921 & 0920', Source: 'Sales Module', 'Source Ref': 'INV-2026-0921', 'Total Debit': '$65,907.00', 'Total Credit': '$65,907.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0478', 'Journal Date': '09/10/2026', 'Posting Date': '09/10/2026', Description: 'Accounts payable — vendor invoices batch Sep W2', Source: 'Purchase Module', 'Source Ref': 'PUR-BATCH-0441', 'Total Debit': '$63,008.00', 'Total Credit': '$63,008.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0477', 'Journal Date': '09/09/2026', 'Posting Date': '', Description: 'Prepaid insurance amortization — Q4 2026', Source: 'Manual Entry', 'Source Ref': 'PRE-SEP-2026', 'Total Debit': '$4,800.00', 'Total Credit': '$4,800.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Draft', 'Review Status': 'Pending', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0476', 'Journal Date': '09/08/2026', 'Posting Date': '09/08/2026', Description: 'Bank receipt — customer payments batch', Source: 'Cash & Bank', 'Source Ref': 'CB-BATCH-0148', 'Total Debit': '$61,631.00', 'Total Credit': '$61,631.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0475', 'Journal Date': '09/07/2026', 'Posting Date': '09/07/2026', Description: 'FX revaluation — USD receivables Sep 2026', Source: 'Auto-Generated', 'Source Ref': 'FX-SEP-2026', 'Total Debit': '$2,280.00', 'Total Credit': '$2,280.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Posted', 'Review Status': 'Approved', Period: 'Sep 2026' },
  { 'JE Number': 'JE-2026-0474', 'Journal Date': '09/06/2026', 'Posting Date': '', Description: 'Intercompany recharge — Q3 shared services', Source: 'Manual Entry', 'Source Ref': 'IC-SEP-2026', 'Total Debit': '$18,500.00', 'Total Credit': '$18,500.00', Difference: '$0.00', Balance: 'Balanced', 'Posting Status': 'Pending', 'Review Status': 'Review', Period: 'Sep 2026' },
];

const journalGLEntries = [
  { accountCode: '1100', accountName: 'Accounts Receivable', openingBalance: 148200, totalDebits: 65907, totalCredits: 61631, closingBalance: 152476, period: 'Sep 2026' },
  { accountCode: '1300', accountName: 'Prepaid Insurance', openingBalance: 57600, totalDebits: 0, totalCredits: 4800, closingBalance: 52800, period: 'Sep 2026' },
  { accountCode: '1800', accountName: 'Intercompany Receivable', openingBalance: 0, totalDebits: 18500, totalCredits: 0, closingBalance: 18500, period: 'Sep 2026' },
  { accountCode: '2000', accountName: 'Accounts Payable', openingBalance: 68400, totalDebits: 0, totalCredits: 63008, closingBalance: 131408, period: 'Sep 2026' },
  { accountCode: '2100', accountName: 'Accrued Salaries Payable', openingBalance: 0, totalDebits: 0, totalCredits: 84600, closingBalance: 84600, period: 'Sep 2026' },
  { accountCode: '4010', accountName: 'Software Revenue', openingBalance: 0, totalDebits: 0, totalCredits: 65907, closingBalance: 65907, period: 'Sep 2026' },
  { accountCode: '4800', accountName: 'FX Gain/Loss', openingBalance: 0, totalDebits: 0, totalCredits: 2280, closingBalance: 2280, period: 'Sep 2026' },
  { accountCode: '6100', accountName: 'Salaries Expense', openingBalance: 0, totalDebits: 84600, totalCredits: 0, closingBalance: 84600, period: 'Sep 2026' },
  { accountCode: '6900', accountName: 'Depreciation Expense', openingBalance: 0, totalDebits: 14800, totalCredits: 0, closingBalance: 14800, period: 'Sep 2026' },
  { accountCode: '1520', accountName: 'Accumulated Depreciation', openingBalance: 84000, totalDebits: 0, totalCredits: 14800, closingBalance: 98800, period: 'Sep 2026' },
];

export default function JournalEntryTabContent() {
  const handleExportCSV = () => {
    exportToCSV(journalRows, 'Journal_Entries_Sep2026');
    toast.success('CSV exported successfully');
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Journal Entry Report',
      'Transaction period: September 2026 — All accounting journal entries',
      ['JE Number', 'Journal Date', 'Description', 'Source', 'Total Debit', 'Total Credit', 'Balance', 'Posting', 'Review', 'Period'],
      journalRows.map((r) => [r['JE Number'], r['Journal Date'], r.Description, r.Source, r['Total Debit'], r['Total Credit'], r.Balance, r['Posting Status'], r['Review Status'], r.Period]),
      'Journal_Entries_Sep2026'
    );
    toast.success('PDF report opened for printing');
  };

  const handleExportGLSnapshot = () => {
    exportGLSnapshot(journalGLEntries, 'Sep 2026', 'Journal Entry');
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
          + New Journal Entry
        </button>
      </div>
      <JournalKpiRow />
      <JournalBalanceValidator />
      <JournalEntryTable />
    </div>
  );
}
