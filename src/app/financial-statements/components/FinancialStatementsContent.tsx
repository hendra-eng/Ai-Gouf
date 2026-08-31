'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import PLStatement from './PLStatement';
import BalanceSheetStatement from './BalanceSheetStatement';
import CashFlowStatement from './CashFlowStatement';
import { Download, Printer, FileText } from 'lucide-react';

const tabs = [
  { id: 'tab-pl', label: 'Profit & Loss', short: 'P&L' },
  { id: 'tab-bs', label: 'Balance Sheet', short: 'B/S' },
  { id: 'tab-cf', label: 'Cash Flow', short: 'C/F' },
];

const tabNames: Record<string, string> = {
  'tab-pl': 'Profit & Loss Statement',
  'tab-bs': 'Balance Sheet',
  'tab-cf': 'Cash Flow Statement',
};

export default function FinancialStatementsContent() {
  const [activeTab, setActiveTab] = useState('tab-pl');

  function handlePrint() {
    toast.info('Menyiapkan cetak', { description: tabNames[activeTab] });
    window.print();
  }

  function handleExportPdf() {
    toast.success('PDF sedang dibuat', { description: `${tabNames[activeTab]} · PT Nusantara Teknologi Indonesia` });
  }

  function handleExportExcel() {
    toast.success('Export Excel dimulai', { description: `${tabNames[activeTab]} akan tersedia untuk diunduh sebentar lagi.` });
  }

  return (
    <div className="space-y-6 fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Financial Statements</h1>
          <p className="text-sm text-muted-foreground mt-1">
            PT Nusantara Teknologi Indonesia · Jan 2026 – Aug 2026
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="badge-info">PSAK Compliant</span>
            <span className="badge-positive">Balanced ✓</span>
            <span className="text-xs text-muted-foreground">Last reconciled: 25 Aug 2026</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="btn-secondary text-xs py-1.5 gap-1.5">
            <Printer size={13} />
            Print
          </button>
          <button onClick={handleExportPdf} className="btn-secondary text-xs py-1.5 gap-1.5">
            <FileText size={13} />
            PDF
          </button>
          <button onClick={handleExportExcel} className="btn-primary text-xs py-1.5 gap-1.5">
            <Download size={13} />
            Export Excel
          </button>
        </div>
      </div>
      {/* Tab navigation */}
      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit">
        {tabs?.map((tab) => (
          <button
            key={tab?.id}
            onClick={() => setActiveTab(tab?.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
              activeTab === tab?.id
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="hidden sm:inline">{tab?.label}</span>
            <span className="sm:hidden">{tab?.short}</span>
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="fade-in">
        {activeTab === 'tab-pl' && <PLStatement />}
        {activeTab === 'tab-bs' && <BalanceSheetStatement />}
        {activeTab === 'tab-cf' && <CashFlowStatement />}
      </div>
    </div>
  );
}