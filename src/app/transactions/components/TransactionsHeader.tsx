'use client';
import React, { useState } from 'react';
import { Download, Upload, Plus, Trash2, Archive, Calendar, ChevronDown, Check, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface TransactionsHeaderProps {
  totalCount: number;
  selectedCount: number;
  onImportClick: () => void;
  onExportJournalPdf: () => void;
  onExportExcel: () => void;
  // [BARU] true selagi file Excel sedang disiapkan di background (lihat
  // effect di TransactionsContent.tsx) — dipakai untuk tampilkan indikator
  // kecil di sebelah tombol Export, supaya user tahu file belum tentu
  // 100% "siap instan" kalau baru saja import/ganti filter.
  isPreparingExcelExport?: boolean;
  onNewJournalClick: () => void;
  selectedYear: number | 'all';
  onYearChange: (year: number | 'all') => void;
  yearOptions: (number | 'all')[];
  // [FIX - audit #2] Handler nyata dari TransactionsContent (memanggil context), bukan lagi toast lokal.
  onBulkDelete: () => void;
  onBulkArchive: () => void;
}

export default function TransactionsHeader({
  totalCount,
  selectedCount,
  onImportClick,
  onExportJournalPdf,
  onExportExcel,
  isPreparingExcelExport = false,
  onNewJournalClick,
  selectedYear,
  onYearChange,
  yearOptions,
  onBulkDelete,
  onBulkArchive,
}: TransactionsHeaderProps) {
  const [yearMenuOpen, setYearMenuOpen] = useState(false);

  const handleExport = () => {
    onExportExcel();
    toast.success('Export berhasil', { description: `${totalCount} transaksi diunduh sebagai Excel` });
  };

  const handleExportPdf = () => {
    onExportJournalPdf();
    toast.success('Jurnal Umum (PDF) berhasil diunduh');
  };

  const handleBulkDelete = () => {
    if (window.confirm(`Hapus ${selectedCount} transaksi terpilih? Untuk baris yang sudah tersinkron ke server, jurnal akan ditandai ditolak (tidak masuk laporan keuangan).`)) {
      onBulkDelete();
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      {/* [DIUBAH] Judul "Transaksi" + deskripsi perusahaan dipindah ke luar —
          sekarang dirender sekali di TransactionsContent.tsx, DI ATAS tab
          bar (TransactionsMainTabs), supaya urutannya konsisten dengan
          halaman Sales/Purchase/dst: Judul → Tab → Konten. Di sini cuma
          sisa badge jumlah transaksi + filter tahun. */}
      <div>
        <div className="flex items-center gap-2">
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
              onClick={onBulkArchive}
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
        <button
          onClick={handleExport}
          className="btn-secondary text-xs py-1.5 gap-1.5 relative"
          title={isPreparingExcelExport ? 'File Excel sedang disiapkan di background...' : 'Export transaksi yang sedang tampil sebagai Excel'}
        >
          {isPreparingExcelExport ? (
            <Loader2 size={13} className="animate-spin text-muted-foreground" />
          ) : (
            <Download size={13} />
          )}
          Export
          {isPreparingExcelExport && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              (menyiapkan...)
            </span>
          )}
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
          onClick={onNewJournalClick}
          className="btn-primary text-xs py-1.5 gap-1.5"
        >
          <Plus size={13} />
          Jurnal Baru
        </button>
      </div>
    </div>
  );
}