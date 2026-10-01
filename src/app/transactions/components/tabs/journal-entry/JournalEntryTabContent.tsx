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

const journalRows: Record<string, string>[] = [];

const journalGLEntries: { accountCode: string; accountName: string; openingBalance: number; totalDebits: number; totalCredits: number; closingBalance: number; period: string }[] = [];

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
