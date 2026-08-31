'use client';
import React, { useState } from 'react';
import { Download, Upload, Plus, Trash2, Archive, Calendar, ChevronDown, Check, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface TransactionsHeaderProps {
  totalCount: number;
  selectedCount: number;
  onImportClick: () => void;
  onExportJournalPdf: () => void;
  selectedYear: number | 'all';
  onYearChange: (year: number | 'all') => void;
  yearOptions: (number | 'all')[];
}

export default function TransactionsHeader({
  totalCount,
  selectedCount,
  onImportClick,
  onExportJournalPdf,
  selectedYear,
  onYearChange,
  yearOptions,
}: TransactionsHeaderProps) {
  const [yearMenuOpen, setYearMenuOpen] = useState(false);

  const handleExport = () => {
    toast.success('Export dimulai', { description: `${totalCount} transaksi akan diunduh sebagai Excel` });
  };

  const handleExportPdf = () => {
    onExportJournalPdf();
    toast.success('Jurnal Umum (PDF) berhasil diunduh');
  };

  const handleBulkDelete = () => {
    toast.error('Konfirmasi diperlukan', { description: `${selectedCount} transaksi akan dihapus secara permanen` });
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Transaksi</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Jurnal entri dan transaksi keuangan — PT Nusantara Teknologi Indonesia
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="badge-info">{totalCount.toLocaleString('id-ID')} transaksi</span>

          {/* Periode tahun — bisa ditekan untuk memilih tahun lain */}
          <div className="relative">
            <button
              onClick={() => setYearMenuOpen((p) => !p)}
              className={`badge-neutral gap-1 cursor-pointer hover:bg-border transition-colors ${
                yearMenuOpen ? 'ring-2 ring-ring' : ''
              }`}
            >
              <Calendar size={11} />
              {selectedYear === 'all' ? 'All' : `Jan–Des ${selectedYear}`}
              <ChevronDown size={11} className={`transition-transform ${yearMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {yearMenuOpen && (
              <div className="absolute left-0 top-full mt-1 w-36 max-h-64 overflow-y-auto scrollbar-thin bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    onClick={() => { onYearChange(y); setYearMenuOpen(false); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted transition-colors text-left"
                  >
                    <span className="text-sm text-foreground">{y === 'all' ? 'All' : y}</span>
                    {selectedYear === y && <Check size={13} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCount > 0 && (
            <span className="badge-warning">{selectedCount} dipilih</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {selectedCount > 0 && (
          <>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-negative-subtle border border-negative/20 text-negative text-xs font-semibold hover:bg-negative/10 transition-colors"
            >
              <Trash2 size={13} />
              Hapus ({selectedCount})
            </button>
            <button
              onClick={() => toast.success(`${selectedCount} transaksi diarsipkan`)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-semibold hover:bg-border transition-colors"
            >
              <Archive size={13} />
              Arsip
            </button>
          </>
        )}
        <button
          onClick={onImportClick}
          className="btn-secondary text-xs py-1.5 gap-1.5"
        >
          <Upload size={13} />
          Import
        </button>
        <button onClick={handleExport} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Download size={13} />
          Export
        </button>
        <button
          onClick={handleExportPdf}
          className="btn-secondary text-xs py-1.5 gap-1.5"
          title="Unduh seluruh data transaksi sebagai Jurnal Umum (PDF)"
        >
          <FileText size={13} />
          Download Jurnal (PDF)
        </button>
        <button
          onClick={() => toast.info('Form jurnal baru', { description: 'Buka form untuk membuat jurnal entri baru' })}
          className="btn-primary text-xs py-1.5 gap-1.5"
        >
          <Plus size={13} />
          Jurnal Baru
        </button>
      </div>
    </div>
  );
}
