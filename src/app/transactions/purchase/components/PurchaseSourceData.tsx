'use client';

import React, { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import { Upload, Download, Settings, CheckCircle, MoreHorizontal, ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';
import {
  usePurchaseSourceFiles, usePurchaseSourceRows, uploadPurchaseSourceFile, updatePurchaseSourceFile,
  deletePurchaseSourceFile, promoteSourceFileToTransactions,
  type BackendPurchaseSourceFile,
} from '@/lib/purchaseStore';
import KpiCard from '@/components/shared/KpiCard';
import { downloadBlob } from '../../components/exportTemplates/exportExcelShared';
import { formatTanggalWaktu, formatTanggalSingkat } from '@/lib/salesStore';

// ─────────────────────────────────────────────────────────────────────────────
// Tab Source Data Purchase -- alurnya SAMA dengan SalesSourceData.tsx:
//   1. Upload File  -> POST /import/upload : backend mencocokkan pola kolom ke Purchase Import
//      Template company aktif, lalu mencatat file (daftar file) + 1 baris staging per transaksi
//      (File Preview). BELUM ada Purchase Transaction di tahap ini.
//   2. Daftar file / File Preview / AI Extraction Summary / Data Quality Check = data asli dari
//      GET /source-files & GET /source-rows (tetap ada setelah refresh).
//   3. "Buat Transaksi" -> POST /source-files/{id}/promote-to-transactions : baris VALID naik jadi
//      Purchase Transaction (draft) -> muncul di tab Purchase Transaction -> Preview (approve)
//      -> Posted / Exceptions / Overview.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_PAGE_SIZE = 20;

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// Field sistem yang dipetakan dari kolom file sumber (modal "Mapping Rules").
const MAPPING_FIELDS: { key: string; label: string; defaultSource: string }[] = [
  { key: 'tanggal', label: 'Tanggal Transaksi', defaultSource: 'Tanggal' },
  { key: 'invoice', label: 'No. Invoice Vendor', defaultSource: 'No. Invoice / Reference' },
  { key: 'vendor', label: 'Nama Vendor', defaultSource: 'Nama Vendor / Supplier' },
  { key: 'po', label: 'No. PO', defaultSource: 'No. PO / Purchase Order' },
  { key: 'dpp', label: 'DPP (Sebelum Pajak)', defaultSource: 'Subtotal / Amount' },
  { key: 'ppn', label: 'PPN (11%)', defaultSource: 'Tax / VAT' },
  { key: 'total', label: 'Total Nilai', defaultSource: 'Grand Total' },
];

const SOURCE_COLUMN_OPTIONS = [
  'Tanggal', 'Tanggal Transaksi', 'No. Invoice / Reference', 'Kode Faktur',
  'Nama Vendor / Supplier', 'Nama Pemasok', 'No. PO / Purchase Order', 'Nomor PO',
  'Subtotal / Amount', 'Nilai Sebelum Pajak', 'Tax / VAT', 'PPN 11%',
  'Grand Total', 'Nilai Akhir', 'Tidak Dipetakan',
];

const DEFAULT_RULES: Record<string, string> = Object.fromEntries(MAPPING_FIELDS.map((f) => [f.key, f.defaultSource]));

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Berhasil: 'bg-emerald-100 text-emerald-700',
    Diproses: 'bg-blue-100 text-blue-700',
    'Butuh Review': 'bg-amber-100 text-amber-700',
    Gagal: 'bg-red-100 text-red-700',
  };
  return map[s] || 'bg-muted text-muted-foreground';
};

export default function PurchaseSourceData() {
  const { t } = useLanguage();

  // Company aktif dari dropdown "Switch Company" di header -- dipakai sebagai management_client_id
  // saat upload DAN sebagai filter daftar file (sama seperti SalesSourceData).
  const { activeClientId: managementClientId } = useActiveClient();
  const clientId = managementClientId ?? null;

  const { files: sourceFiles, loading, error, refresh } = usePurchaseSourceFiles(clientId);

  // Simpan ID saja supaya selectedFile selalu dibaca ulang dari sourceFiles (data terbaru hasil refetch).
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile: BackendPurchaseSourceFile | null = sourceFiles.find((f) => f.id === selectedFileId) ?? sourceFiles[0] ?? null;

  useEffect(() => {
    if (!selectedFileId && sourceFiles.length > 0) setSelectedFileId(sourceFiles[0].id);
    if (selectedFileId && !sourceFiles.some((f) => f.id === selectedFileId)) setSelectedFileId(sourceFiles[0]?.id ?? null);
  }, [sourceFiles, selectedFileId]);

  const { rows: previewRows, loading: loadingRows } = usePurchaseSourceRows(selectedFile?.id);
  // Baris yang akan ikut naik saat "Buat Transaksi": valid & belum pernah dipromosikan.
  const siapDibuat = previewRows.filter((r) => r.is_valid && !r.transaction_id).length;

  // File Preview dipaging 20 baris/halaman.
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);

  // Menu aksi "···" per baris file: hapus (soft-delete) source file.
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const handleDeleteFile = async (f: BackendPurchaseSourceFile) => {
    setMenuFileId(null);
    const ok = window.confirm(
      `${t('Hapus file')} "${f.file_name}"?\n\n${t('Transaksi pembelian yang sudah dibuat dari file ini tidak ikut terhapus.')}`
    );
    if (!ok) return;
    setDeletingFileId(f.id);
    try {
      await deletePurchaseSourceFile(f.id);
      toast.success(t('File dihapus'), { description: f.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menghapus file'));
    } finally {
      setDeletingFileId(null);
    }
  };

  // "Buat Transaksi": naikkan baris valid jadi Purchase Transaction (draft) -- idempoten.
  const [isPromoting, setIsPromoting] = useState(false);
  const handlePromoteToTransactions = async () => {
    if (!selectedFile) return;
    setIsPromoting(true);
    try {
      const hasil = await promoteSourceFileToTransactions(selectedFile.id);
      if (hasil.transaksi_dibuat > 0) {
        toast.success(t('Transaksi pembelian berhasil dibuat'), {
          description: `${hasil.transaksi_dibuat} ${t('transaksi baru -- cek tab Purchase Transaction.')}`,
        });
      } else {
        toast.info(t('Tidak ada transaksi baru'), {
          description: `${hasil.dilewati_sudah_pernah_dipromosikan} ${t('sudah pernah dipromosikan')}, ${hasil.dilewati_tidak_valid} ${t('tidak valid')}, ${hasil.dilewati_nomor_bentrok} ${t('bentrok no. transaksi.')}`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal membuat transaksi'));
    } finally {
      setIsPromoting(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mappingRules, setMappingRules] = useState<Record<string, string>>(DEFAULT_RULES);
  const [savingMapping, setSavingMapping] = useState(false);

  const openMappingModal = () => {
    // File yang mapping_rules-nya berasal dari Purchase Import Template (punya 'format_type', mis.
    // "grouped_purchase_report") berstruktur jauh lebih kaya dari form flat ini -- form ini tidak bisa
    // mengeditnya (kalau dipaksa, hasilnya menimpa resep dengan mapping flat yang salah). Sama seperti Sales.
    if (selectedFile?.mapping_rules && 'format_type' in selectedFile.mapping_rules) {
      toast.info(t('Template file ini sudah otomatis terdeteksi (format kompleks)'), {
        description: t('Mapping-nya bukan bentuk kolom sederhana -- lihat panel "Detected Fields" di bawah, belum ada editor untuk pola ini.'),
      });
      return;
    }
    setMappingRules(selectedFile?.mapping_rules ? { ...DEFAULT_RULES, ...selectedFile.mapping_rules } : DEFAULT_RULES);
    setShowMappingModal(true);
  };

  const handleUploadClick = () => {
    if (!managementClientId) {
      toast.error(t('Select a company in the header before uploading a file.'));
      return;
    }
    fileInputRef.current?.click();
  };

  // Upload SUNGGUHAN (multipart) ke backend. Backend mencocokkan pola kolom file ke Purchase Import
  // Template company aktif lalu mencatat file + baris staging-nya. Transaksi BARU dibuat lewat tombol
  // "Buat Transaksi" (sama seperti Sales -> "Buat Invoice"). 1 file = 1 cabang, diproses berurutan.
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (!managementClientId) {
      toast.error(t('Select a company in the header before uploading a file.'));
      e.target.value = '';
      return;
    }
    setIsUploading(true);
    let berhasil = 0;
    let butuhReviewCount = 0;
    try {
      for (const file of files) {
        try {
          const hasil = await uploadPurchaseSourceFile(file, managementClientId);
          if (hasil.template_matched) {
            berhasil += 1;
            setSelectedFileId(hasil.id);
            toast.success(t('File berhasil diekstrak'), {
              description: `${file.name}: ${hasil.rows_extracted} ${t('transaksi pembelian ditemukan -- klik "Buat Transaksi" untuk membuat draft.')}`,
            });
          } else {
            butuhReviewCount += 1;
            toast.info(t('Belum ada template yang cocok'), {
              description: `${file.name} ${t('ditandai "Butuh Review" -- perlu template baru untuk company/format ini.')}`,
            });
          }
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : t('Gagal mengunggah file')}`);
        }
      }
      if (files.length > 1) {
        toast.message(t('Upload selesai'), {
          description: `${berhasil} ${t('berhasil diekstrak')}, ${butuhReviewCount} ${t('butuh review')}.`,
        });
      }
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Purchase Template');
    sheet.columns = [
      { header: 'Date', key: 'tanggal', width: 14 },
      { header: 'Invoice No.', key: 'invoice', width: 18 },
      { header: 'Vendor Name', key: 'vendor', width: 26 },
      { header: 'PO Number', key: 'po', width: 18 },
      { header: 'Tax Base (IDR)', key: 'dpp', width: 16 },
      { header: 'VAT (IDR)', key: 'ppn', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ tanggal: '01/12/2026', invoice: 'INV-V-2026-001', vendor: 'PT Example Supplier', po: 'PO-2026-0001', dpp: 10000000, ppn: 1100000, total: 11100000 });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, 'Purchase_Data_Template.xlsx');
    toast.success(t('Template Excel diunduh'));
  };

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploadDate', width: 20 },
      { header: 'Source File', key: 'file', width: 32 },
      { header: 'Source Type', key: 'type', width: 12 },
      { header: 'Vendor / Entity', key: 'vendor', width: 24 },
      { header: 'Period', key: 'period', width: 14 },
      { header: 'Rows Detected', key: 'rows', width: 14 },
      { header: 'Extraction Status', key: 'statusEkstraksi', width: 16 },
      { header: 'Mapping Status', key: 'statusMapping', width: 16 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Processed By', key: 'processedBy', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sourceFiles.forEach((f) => sheet.addRow({
      uploadDate: formatTanggalWaktu(f.uploaded_at),
      file: f.file_name,
      type: f.file_type || '-',
      vendor: f.vendor_hint || '-',
      period: f.period_label || '-',
      rows: f.rows_detected,
      statusEkstraksi: f.status_ekstraksi,
      statusMapping: f.status_mapping,
      confidence: f.confidence_score ?? 0,
      processedBy: f.processed_by || '-',
    }));
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `Purchase_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(t('Export berhasil'), { description: `${sourceFiles.length} ${t('baris diunduh sebagai Excel.')}` });
  };

  // Benar-benar PUT ke financial_transaction_purchase_source_files.mapping_rules milik file terpilih.
  const handleSaveMapping = async () => {
    if (!selectedFile) {
      toast.error(t('Pilih salah satu file di tabel dulu sebelum menyimpan mapping.'));
      return;
    }
    setSavingMapping(true);
    try {
      await updatePurchaseSourceFile(selectedFile.id, { mapping_rules: mappingRules, status_mapping: 'Berhasil' });
      setShowMappingModal(false);
      toast.success(t('Mapping rules disimpan'), {
        description: `${MAPPING_FIELDS.length} ${t('field berhasil dipetakan ke kolom sumber.')}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyimpan mapping'));
    } finally {
      setSavingMapping(false);
    }
  };

  const totalUpload = sourceFiles.length;
  const menungguProses = sourceFiles.filter((f) => f.status_ekstraksi === 'Diproses').length;
  const berhasilDiproses = sourceFiles.filter((f) => f.status_ekstraksi === 'Berhasil').length;
  const butuhReview = sourceFiles.filter((f) => f.status_ekstraksi === 'Butuh Review').length;

  return (
    <div className="space-y-5">
      <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFilesSelected} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button onClick={handleUploadClick} disabled={isUploading || !managementClientId} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Upload size={13} /> {isUploading ? t('Mengunggah...') : t('Upload File')}
        </button>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Download size={13} /> {t('Template Excel')}
        </button>
        <button onClick={handleExport} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Download size={13} /> {t('Export')}
        </button>
        <button onClick={openMappingModal} className="btn-primary text-xs py-1.5 gap-1.5">
          <Settings size={13} /> {t('Mapping Rules')}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title={t('Total File Upload')} value={String(totalUpload)} icon="ArrowUpTrayIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title={t('Menunggu Diproses')} value={String(menungguProses)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
        <KpiCard title={t('Berhasil Diproses')} value={String(berhasilDiproses)} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title={t('Butuh Review')} value={String(butuhReview)} icon="ExclamationTriangleIcon" iconColor="text-red-600" iconBg="bg-red-50" alert={butuhReview > 0} />
      </div>

      {/* File Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('Daftar File Sumber Pembelian')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Kelola file yang diunggah dan pantau status pemrosesan data.')}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Upload Date', 'Source File', 'Source Type', 'Vendor / Entity', 'Period', 'Rows Detected', 'Status Ekstraksi', 'Status Mapping', 'Confidence', 'Processed By', 'Actions'].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && sourceFiles.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-xs text-muted-foreground">{t('Belum ada file yang diunggah.')}</td></tr>
              )}
              {sourceFiles.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelectedFileId(f.id)}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${selectedFile?.id === f.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                >
                  <td className="py-2.5 px-3 text-xs text-foreground whitespace-nowrap">{formatTanggalWaktu(f.uploaded_at)}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${f.file_type === 'Excel' ? 'bg-emerald-100 text-emerald-700' : f.file_type === 'CSV' ? 'bg-blue-100 text-blue-700' : f.file_type === 'PDF' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'}`}>{(f.file_type || '?').slice(0, 3)}</div>
                      <span className="text-xs text-foreground font-medium">{f.file_name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{f.file_type || '-'}</td>
                  <td className="py-2.5 px-3 text-xs text-foreground">{f.vendor_hint || '—'}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">{f.period_label || '-'}</td>
                  <td className="py-2.5 px-3 text-xs text-foreground">{f.rows_detected.toLocaleString('id-ID')}</td>
                  <td className="py-2.5 px-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.status_ekstraksi)}`}>{t(f.status_ekstraksi)}</span></td>
                  <td className="py-2.5 px-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.status_mapping)}`}>{t(f.status_mapping)}</span></td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${(f.confidence_score ?? 0) >= 90 ? 'bg-emerald-500' : (f.confidence_score ?? 0) >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${f.confidence_score ?? 0}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{f.confidence_score ?? 0}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-foreground whitespace-nowrap">{f.processed_by || '-'}</td>
                  <td className="py-2.5 px-3">
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setMenuFileId(menuFileId === f.id ? null : f.id)}
                        disabled={deletingFileId === f.id}
                        className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
                        aria-label={t('Aksi')}
                      >
                        <MoreHorizontal size={14} className="text-muted-foreground" />
                      </button>
                      {menuFileId === f.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuFileId(null)} />
                          <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg py-1">
                            <button
                              onClick={() => handleDeleteFile(f)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left"
                            >
                              <Trash2 size={12} /> {t('Hapus file')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Menampilkan')} {sourceFiles.length === 0 ? 0 : 1} - {sourceFiles.length} {t('dari')} {sourceFiles.length} {t('file')}</span>
          <div className="flex items-center gap-1">
            <button className="p-1 hover:bg-muted rounded" disabled><ChevronLeft size={14} /></button>
            <button className="w-6 h-6 rounded text-xs bg-primary text-primary-foreground">1</button>
            <button className="p-1 hover:bg-muted rounded" disabled><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* File Preview */}
        <div className="xl:col-span-1 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('File Preview')}</h3>
            {selectedFile && previewRows.length > 0 && (
              <button
                onClick={handlePromoteToTransactions}
                disabled={isPromoting || siapDibuat === 0}
                className="btn-primary text-[11px] py-1 px-2 gap-1 disabled:opacity-50"
                title={t('Naikkan baris valid jadi transaksi resmi di tab Purchase Transaction')}
              >
                {isPromoting ? t('Memproses...') : siapDibuat > 0 ? `${t('Buat Transaksi')} (${siapDibuat})` : t('Buat Transaksi')}
              </button>
            )}
          </div>
          {selectedFile ? (
            <div className="flex items-center gap-2 mb-3 p-2 bg-emerald-50 rounded-lg">
              <div className="w-8 h-8 bg-emerald-100 rounded flex items-center justify-center text-[10px] font-bold text-emerald-700">{(selectedFile.file_type || '?').slice(0, 3).toUpperCase()}</div>
              <div>
                <p className="text-xs font-semibold text-foreground">{selectedFile.file_name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedFile.rows_detected} {t('baris')} · {t('Diunggah')} {formatTanggalWaktu(selectedFile.uploaded_at)}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">{t('Belum ada file yang dipilih.')}</p>
          )}
          {selectedFile && !loadingRows && previewRows.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">{t('Belum ada baris data untuk file ini (belum ada template yang cocok untuk company/format ini).')}</p>
          )}
          {selectedFile && previewRows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['No', 'Tanggal', 'No. Transaksi', 'Nama Vendor', 'Cabang', 'DPP (IDR)', 'PPN (IDR)', 'Total (IDR)', 'Status'].map((h) => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreviewRows.map((r) => (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="py-1.5 px-1.5 text-muted-foreground">{r.row_no}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.tanggal ? formatTanggalSingkat(r.tanggal) : '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.no_invoice || '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.nama_vendor || '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.cabang || '-'}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.dpp / 1000).toFixed(0)}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.ppn / 1000).toFixed(0)}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.total / 1000).toFixed(0)}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap" title={r.validation_notes || undefined}>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.transaction_id ? 'bg-emerald-100 text-emerald-700' : r.is_valid ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                            {r.transaction_id ? t('Dibuat') : r.is_valid ? t('Siap') : t('Tidak valid')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-[11px] text-muted-foreground">
                <span>
                  {(previewPageSafe - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPageSafe * PREVIEW_PAGE_SIZE, previewRows.length)} {t('dari')} {previewRows.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    disabled={previewPageSafe <= 1}
                    className="p-0.5 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="px-1">{previewPageSafe} / {previewTotalPages}</span>
                  <button
                    onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                    disabled={previewPageSafe >= previewTotalPages}
                    className="p-0.5 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* AI Extraction Summary */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-[10px] font-bold text-purple-600">AI</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t('AI Extraction Summary')}</h3>
          </div>
          {!selectedFile ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{t('Pilih atau unggah file untuk melihat ringkasan.')}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {selectedFile.ai_model_version
                  ? `${t('Model')}: ${selectedFile.ai_model_version}`
                  : t('Belum ada hasil ekstraksi otomatis untuk file ini.')}
              </p>
              <div className="space-y-2 text-xs">
                {[
                  ['Total Baris Terdeteksi', String(selectedFile.rows_detected)],
                  ['Baris Valid', String(selectedFile.rows_valid)],
                  ['Baris Tidak Valid', String(selectedFile.rows_invalid)],
                  ['Duplikat Potensial', String(selectedFile.duplicate_count)],
                  ['Nilai Transaksi (DPP)', formatIDR(selectedFile.dpp_total)],
                  ['Nilai PPN', formatIDR(selectedFile.ppn_total)],
                  ['Nilai Total', formatIDR(selectedFile.grand_total)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{t(k)}</span>
                    <span className="font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
              {selectedFile.extraction_duration_ms != null && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[11px] text-muted-foreground">ℹ {t('Ekstraksi selesai dalam')} {(selectedFile.extraction_duration_ms / 1000).toFixed(1)} {t('detik')}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Data Quality Check */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Data Quality Check')}</h3>
          </div>
          {!selectedFile || previewRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{t('Belum ada baris data untuk dicek.')}</p>
          ) : (
            <div className="space-y-2 text-xs">
              {(() => {
                const total = previewRows.length;
                const withDate = previewRows.filter((r) => !!r.tanggal).length;
                const withInvoice = previewRows.filter((r) => !!r.no_invoice).length;
                const withVendor = previewRows.filter((r) => !!r.nama_vendor).length;
                const withCabang = previewRows.filter((r) => !!r.cabang).length;
                const validTotal = previewRows.filter((r) => r.total > 0).length;
                const duplicates = previewRows.filter((r) => r.is_duplicate_candidate).length;
                const invalid = previewRows.filter((r) => !r.is_valid).length;
                return [
                  { label: 'Format tanggal valid', val: `${withDate} / ${total}`, ok: withDate === total },
                  { label: 'No. transaksi ditemukan', val: `${withInvoice} / ${total}`, ok: withInvoice === total },
                  { label: 'Nama vendor valid', val: `${withVendor} / ${total}`, ok: withVendor === total },
                  { label: 'Cabang (Dept.) ditemukan', val: `${withCabang} / ${total}`, ok: withCabang === total },
                  { label: 'Nilai transaksi valid', val: `${validTotal} / ${total}`, ok: validTotal === total },
                  { label: 'Duplikat data', val: String(duplicates), ok: duplicates === 0 },
                  { label: 'Baris tidak valid', val: String(invalid), ok: invalid === 0 },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${item.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="text-muted-foreground">{t(item.label)}</span>
                    </div>
                    <span className={`font-medium ${item.ok ? 'text-foreground' : 'text-red-600'}`}>{item.val}</span>
                  </div>
                ));
              })()}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-foreground mb-1.5">{t('Detected Fields')}</p>
            {(() => {
              const rules = selectedFile?.mapping_rules;
              if (rules && 'format_type' in rules) {
                return (
                  <p className="text-[11px] text-muted-foreground">
                    {t('Pola kolom dikenali otomatis lewat template')} ({String(rules.format_type)}).
                  </p>
                );
              }
              const terdeteksi = rules ? MAPPING_FIELDS.filter((f) => !!rules[f.key]) : [];
              if (terdeteksi.length === 0) {
                return <p className="text-[11px] text-muted-foreground">{t('Belum ada mapping field yang disimpan untuk file ini -- pakai tombol "Mapping Rules" di atas.')}</p>;
              }
              return (
                <div className="flex flex-wrap gap-1.5">
                  {terdeteksi.map((f) => (
                    <span key={f.key} className="flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                      <CheckCircle size={9} /> {t(f.label)}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Modal Mapping Rules */}
      {showMappingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-foreground">{t('Mapping Rules')}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{t('Petakan kolom file sumber ke field sistem.')}</p>
              </div>
              <button onClick={() => setShowMappingModal(false)} className="p-1 hover:bg-muted rounded transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="text-xs text-foreground w-36 flex-shrink-0">{t(field.label)}</span>
                  <select
                    value={mappingRules[field.key]}
                    onChange={(e) => setMappingRules((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="flex-1 text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
                  >
                    {SOURCE_COLUMN_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{t(opt)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowMappingModal(false)} className="btn-secondary text-xs py-1.5 gap-1.5">
                {t('Batal')}
              </button>
              <button onClick={handleSaveMapping} disabled={savingMapping} className="btn-primary text-xs py-1.5 gap-1.5 disabled:opacity-50">
                {savingMapping ? t('Menyimpan...') : t('Simpan Mapping')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}