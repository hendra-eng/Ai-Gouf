'use client';

import React, { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import { Upload, Download, Settings, CheckCircle, MoreHorizontal, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useClientsList } from '@/lib/clientsStore';
import KpiCard from '@/components/shared/KpiCard';
import { downloadBlob } from '../../components/exportTemplates/exportExcelShared';
import {
  useSalesSourceFiles, uploadSalesSourceFile, updateSalesSourceFile,
  useSalesSourceRows, promoteSourceFileToInvoices, formatTanggalWaktu, formatTanggalSingkat,
  type BackendSalesSourceFile,
} from '@/lib/salesStore';

const PREVIEW_PAGE_SIZE = 20;

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// [BARU] Field sistem yang perlu dipetakan dari kolom file sumber — dipakai
// oleh modal "Mapping Rules" di bawah. `defaultSource` cuma nilai awal yang
// masuk akal (hasil "deteksi otomatis" versi mock), user tetap bisa ganti.
const MAPPING_FIELDS: { key: string; label: string; defaultSource: string }[] = [
  { key: 'tanggal', label: 'Tanggal Transaksi', defaultSource: 'Tanggal' },
  { key: 'invoice', label: 'No. Invoice', defaultSource: 'No. Invoice / Reference' },
  { key: 'customer', label: 'Nama Customer', defaultSource: 'Nama Customer / Buyer' },
  { key: 'dpp', label: 'DPP (Sebelum Pajak)', defaultSource: 'Subtotal / Amount' },
  { key: 'ppn', label: 'PPN (11%)', defaultSource: 'Tax / VAT' },
  { key: 'total', label: 'Total Nilai', defaultSource: 'Grand Total' },
];

const SOURCE_COLUMN_OPTIONS = [
  'Tanggal', 'Tanggal Transaksi', 'No. Invoice / Reference', 'Kode Faktur',
  'Nama Customer / Buyer', 'Nama Pembeli', 'Subtotal / Amount', 'Nilai Sebelum Pajak',
  'Tax / VAT', 'PPN 11%', 'Grand Total', 'Nilai Akhir', 'Tidak Dipetakan',
];

// [CATATAN] Belum ada pipeline AI ekstraksi sungguhan di backend untuk file
// Sales (kolom mapping_rules/ai_model_version/rows_valid/dpp_total dst di
// financial_transaction_sales_source_files sudah disiapkan, tapi belum ada
// proses otomatis yang mengisinya). Panel di bawah (File Preview/AI
// Extraction Summary/Data Quality Check) MURNI baca dari data file yang
// sudah tersimpan (GET /source-files) & baris source row (GET /source-rows)
// -- tidak ada lagi angka contoh statis. Kalau field-nya belum pernah diisi
// (mis. lewat proses ekstraksi manual di masa depan), panelnya akan
// menampilkan status "belum ada data" apa adanya.

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Berhasil: 'bg-emerald-100 text-emerald-700',
    Diproses: 'bg-blue-100 text-blue-700',
    'Butuh Review': 'bg-amber-100 text-amber-700',
    Gagal: 'bg-red-100 text-red-700',
  };
  return map[s] || 'bg-muted text-muted-foreground';
};

export default function SalesSourceData() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;

  // [BARU] Dropdown "Pilih Klien" -- WAJIB diisi sebelum upload, dipakai
  // backend sebagai key pencocokan/pembuatan template pola kolom (lihat
  // root/SALES_IMPORT_TEMPLATES.md). Daftar klien pakai sumber yang SAMA
  // dengan halaman /clients (management_clients), BUKAN activeClientId
  // dari dropdown "Switch Company" di Topbar -- keduanya sengaja dibiarkan
  // independen (lihat catatan di salesStore.tsx soal client_id vs
  // management_client_id).
  const { clients: managementClients, loading: loadingClients } = useClientsList();
  const [managementClientId, setManagementClientId] = useState<string>('');
  useEffect(() => {
    if (!managementClientId && managementClients.length > 0) {
      setManagementClientId(managementClients[0].id);
    }
  }, [managementClients, managementClientId]);

  const { files: sourceFiles, loading, error, refresh } = useSalesSourceFiles(clientId);
  // [FIX] Menyimpan ID saja (bukan salinan objek BackendSalesSourceFile) --
  // supaya selectedFile SELALU dibaca ulang dari `sourceFiles` (data
  // terbaru hasil refetch), bukan snapshot lama. Sebelumnya field seperti
  // mapping_rules yang baru disimpan lewat modal Mapping Rules tidak
  // langsung kelihatan di panel "Detected Fields" karena objeknya sudah
  // "beku" sejak awal dipilih.
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile: BackendSalesSourceFile | null = sourceFiles.find(f => f.id === selectedFileId) ?? sourceFiles[0] ?? null;

  useEffect(() => {
    if (!selectedFileId && sourceFiles.length > 0) setSelectedFileId(sourceFiles[0].id);
    if (selectedFileId && !sourceFiles.some(f => f.id === selectedFileId)) setSelectedFileId(sourceFiles[0]?.id ?? null);
  }, [sourceFiles, selectedFileId]);

  const { rows: previewRows, loading: loadingRows } = useSalesSourceRows(selectedFile?.id);

  // [BARU] File Preview dipaging 20 baris/halaman -- file laporan bisa
  // berisi ribuan baris (mis. contoh SAU: 10.769), menampilkan semuanya
  // sekaligus bikin tabelnya berat & sulit dibaca.
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);

  const [isPromoting, setIsPromoting] = useState(false);
  const handlePromoteToInvoices = async () => {
    if (!selectedFile) return;
    setIsPromoting(true);
    try {
      const hasil = await promoteSourceFileToInvoices(selectedFile.id);
      if (hasil.invoice_dibuat > 0) {
        toast.success(t('Invoice berhasil dibuat'), {
          description: `${hasil.invoice_dibuat} ${t('invoice baru -- cek tab Sales Transaction.')}`,
        });
      } else {
        toast.info(t('Tidak ada invoice baru'), {
          description: `${hasil.dilewati_sudah_pernah_dipromosikan} ${t('sudah pernah dipromosikan')}, ${hasil.dilewati_tidak_valid} ${t('tidak valid')}, ${hasil.dilewati_invoice_no_bentrok} ${t('bentrok no. invoice.')}`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal membuat invoice'));
    } finally {
      setIsPromoting(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mappingRules, setMappingRules] = useState<Record<string, string>>(
    () => Object.fromEntries(MAPPING_FIELDS.map((f) => [f.key, f.defaultSource]))
  );
  const [savingMapping, setSavingMapping] = useState(false);

  const openMappingModal = () => {
    // [FIX] File yang mapping_rules-nya berasal dari Sales Import Template
    // "grouped_invoice_report" (lihat SALES_IMPORT_TEMPLATES.md) punya
    // struktur JSON yang JAUH lebih kaya dari form flat 6-field di modal
    // ini (posisi kolom per jenis baris blok, bukan {field: nama_kolom}
    // sederhana) -- form ini TIDAK bisa dipakai mengeditnya (kalau
    // dipaksa, hasilnya cuma menimpa dengan mapping flat yang salah utk
    // format itu). Modal edit resep lengkap belum dibangun, jadi untuk
    // file seperti ini cukup kasih tahu, jangan buka form yang salah.
    if (selectedFile?.mapping_rules && 'format_type' in selectedFile.mapping_rules) {
      toast.info(t('Template file ini sudah otomatis terdeteksi (format kompleks)'), {
        description: t('Mapping-nya bukan bentuk kolom sederhana -- lihat panel "Detected Fields" di bawah, belum ada editor untuk pola ini.'),
      });
      return;
    }
    setMappingRules(
      selectedFile?.mapping_rules
        ? { ...Object.fromEntries(MAPPING_FIELDS.map((f) => [f.key, f.defaultSource])), ...selectedFile.mapping_rules }
        : Object.fromEntries(MAPPING_FIELDS.map((f) => [f.key, f.defaultSource]))
    );
    setShowMappingModal(true);
  };

  const handleUploadClick = () => {
    if (!managementClientId) {
      toast.error(t('Pilih klien dulu sebelum upload file.'));
      return;
    }
    fileInputRef.current?.click();
  };

  // ── Upload File: file dikirim SUNGGUHAN (multipart) ke backend lewat
  // uploadSalesSourceFile() -- backend yang mendeteksi pola kolom,
  // mencocokkan ke template pola yang sudah dipelajari untuk klien+format
  // ini, lalu langsung mengekstrak barisnya ke source_rows kalau cocok.
  // Lihat root/SALES_IMPORT_TEMPLATES.md untuk alur lengkapnya. ──
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (!clientId) {
      toast.error(t('Sesi login tidak ditemukan, silakan login ulang.'));
      return;
    }
    if (!managementClientId) {
      toast.error(t('Pilih klien dulu sebelum upload file.'));
      return;
    }
    setIsUploading(true);
    let berhasil = 0;
    let butuhReview = 0;
    try {
      for (const file of files) {
        try {
          const hasil = await uploadSalesSourceFile(file, managementClientId);
          if (hasil.template_matched) {
            berhasil += 1;
            toast.success(t('File berhasil diekstrak'), {
              description: `${file.name}: ${hasil.rows_extracted} ${t('baris ditemukan.')}`,
            });
          } else {
            butuhReview += 1;
            toast.info(t('Belum ada template yang cocok'), {
              description: `${file.name} ${t('ditandai "Butuh Review" -- perlu template baru untuk klien/format ini.')}`,
            });
          }
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : t('Gagal mengunggah file')}`);
        }
      }
      if (files.length > 1) {
        toast.message(t('Upload selesai'), {
          description: `${berhasil} ${t('berhasil diekstrak')}, ${butuhReview} ${t('butuh review')}.`,
        });
      }
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template Penjualan');
    sheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 14 },
      { header: 'No. Invoice', key: 'invoice', width: 18 },
      { header: 'Nama Customer', key: 'customer', width: 26 },
      { header: 'DPP (IDR)', key: 'dpp', width: 16 },
      { header: 'PPN (IDR)', key: 'ppn', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ tanggal: '01/12/2024', invoice: 'INV-2024-001', customer: 'PT Contoh Sejahtera', dpp: 10000000, ppn: 1100000, total: 11100000 });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, 'Template_Data_Penjualan.xlsx');
    toast.success(t('Template Excel diunduh'));
  };

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploadDate', width: 20 },
      { header: 'Source File', key: 'file', width: 28 },
      { header: 'Source Type', key: 'type', width: 12 },
      { header: 'Customer / Entity', key: 'customer', width: 24 },
      { header: 'Period', key: 'period', width: 14 },
      { header: 'Rows Detected', key: 'rows', width: 14 },
      { header: 'Status Ekstraksi', key: 'statusEkstraksi', width: 16 },
      { header: 'Status Mapping', key: 'statusMapping', width: 16 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Processed By', key: 'processedBy', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sourceFiles.forEach((f) => sheet.addRow({
      uploadDate: formatTanggalWaktu(f.uploaded_at),
      file: f.file_name,
      type: f.file_type || '-',
      customer: f.customer_hint || '-',
      period: f.period_label || '-',
      rows: f.rows_detected,
      statusEkstraksi: f.status_ekstraksi,
      statusMapping: f.status_mapping,
      confidence: f.confidence_score ?? 0,
      processedBy: f.processed_by || '-',
    }));
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `Sales_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(t('Export berhasil'), { description: `${sourceFiles.length} ${t('baris diunduh sebagai Excel.')}` });
  };

  // [FIX] Sebelumnya cuma toast lokal, tidak pernah tersimpan -- sekarang
  // benar-benar PUT ke financial_transaction_sales_source_files.mapping_rules
  // milik file yang sedang dipilih, supaya "Detected Fields" di panel Data
  // Quality Check bisa menampilkan hasil mapping yang sungguhan tersimpan.
  const handleSaveMapping = async () => {
    if (!selectedFile) {
      toast.error(t('Pilih salah satu file di tabel dulu sebelum menyimpan mapping.'));
      return;
    }
    setSavingMapping(true);
    try {
      await updateSalesSourceFile(selectedFile.id, {
        mapping_rules: mappingRules,
        status_mapping: 'Berhasil',
      });
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
  const menungguProses = sourceFiles.filter(f => f.status_ekstraksi === 'Diproses').length;
  const berhasilDiproses = sourceFiles.filter(f => f.status_ekstraksi === 'Berhasil').length;
  const butuhReview = sourceFiles.filter(f => f.status_ekstraksi === 'Butuh Review').length;

  return (
    <div className="space-y-5">
      <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt" className="hidden" onChange={handleFilesSelected} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {/* [BARU] Dropdown "Pilih Klien" -- WAJIB sebelum upload, lihat
            root/SALES_IMPORT_TEMPLATES.md. Ditaruh paling kiri supaya
            jelas ini "konteks" upload, bukan aksi. */}
        <select
          value={managementClientId}
          onChange={ev => setManagementClientId(ev.target.value)}
          disabled={loadingClients || isUploading}
          className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground mr-auto"
        >
          {managementClients.length === 0 && <option value="">{t('Belum ada klien')}</option>}
          {managementClients.map(c => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </select>
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
            <h3 className="text-sm font-semibold text-foreground">{t('Daftar File Sumber Penjualan')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Kelola file yang diunggah dan pantau status pemrosesan data.')}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Upload Date', 'Source File', 'Source Type', 'Customer / Entity', 'Period', 'Rows Detected', 'Status Ekstraksi', 'Status Mapping', 'Confidence', 'Processed By', 'Actions'].map(h => (
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
                  <td className="py-2.5 px-3 text-xs text-foreground">{f.customer_hint || '—'}</td>
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
                    <button className="p-1 hover:bg-muted rounded transition-colors"><MoreHorizontal size={14} className="text-muted-foreground" /></button>
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

      {/* Bottom Section -- SEMUA dari data asli (source file terpilih & baris
          source row-nya), tidak ada lagi angka contoh. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* File Preview */}
        <div className="xl:col-span-1 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('File Preview')}</h3>
            {selectedFile && previewRows.length > 0 && (
              <button
                onClick={handlePromoteToInvoices}
                disabled={isPromoting}
                className="btn-primary text-[11px] py-1 px-2 gap-1 disabled:opacity-50"
                title={t('Naikkan baris valid jadi invoice resmi di tab Sales Transaction')}
              >
                {isPromoting ? t('Memproses...') : t('Buat Invoice')}
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
            <p className="text-xs text-muted-foreground text-center py-6">{t('Belum ada baris data untuk file ini (ekstraksi otomatis belum tersambung).')}</p>
          )}
          {selectedFile && previewRows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['No', 'Tanggal', 'No. Invoice', 'Nama Customer', 'DPP (IDR)', 'PPN (IDR)', 'Total (IDR)'].map(h => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreviewRows.map(r => (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="py-1.5 px-1.5 text-muted-foreground">{r.row_no}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.tanggal ? formatTanggalSingkat(r.tanggal) : '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.no_invoice || '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.nama_customer || '-'}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.dpp / 1000).toFixed(0)}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.ppn / 1000).toFixed(0)}</td>
                        <td className="py-1.5 px-1.5 text-right">{(r.total / 1000).toFixed(0)}</td>
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
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPageSafe <= 1}
                    className="p-0.5 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="px-1">{previewPageSafe} / {previewTotalPages}</span>
                  <button
                    onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))}
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

        {/* AI Extraction Summary -- langsung dari kolom rows_valid/rows_invalid/
            duplicate_count/dpp_total/ppn_total/grand_total milik file
            terpilih (GET /source-files), bukan lagi angka ilustrasi. */}
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

        {/* Data Quality Check -- dihitung dari baris source row asli milik
            file terpilih (kalau ada), "Detected Fields" dari mapping_rules
            yang sudah disimpan lewat modal Mapping Rules. */}
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
                const withDate = previewRows.filter(r => !!r.tanggal).length;
                const withInvoice = previewRows.filter(r => !!r.no_invoice).length;
                const withCustomer = previewRows.filter(r => !!r.nama_customer).length;
                const validTotal = previewRows.filter(r => r.total > 0).length;
                const duplicates = previewRows.filter(r => r.is_duplicate_candidate).length;
                const invalid = previewRows.filter(r => !r.is_valid).length;
                return [
                  { label: 'Format tanggal valid', val: `${withDate} / ${total}`, ok: withDate === total },
                  { label: 'No. invoice ditemukan', val: `${withInvoice} / ${total}`, ok: withInvoice === total },
                  { label: 'Nama customer valid', val: `${withCustomer} / ${total}`, ok: withCustomer === total },
                  { label: 'Nilai transaksi valid', val: `${validTotal} / ${total}`, ok: validTotal === total },
                  { label: 'Duplikat data', val: String(duplicates), ok: duplicates === 0 },
                  { label: 'Baris tidak valid', val: String(invalid), ok: invalid === 0 },
                ].map(item => (
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
              if (!rules) {
                return <p className="text-[11px] text-muted-foreground">{t('Belum ada mapping field yang disimpan untuk file ini -- pakai tombol "Mapping Rules" di atas.')}</p>;
              }
              // Template "grouped_invoice_report" (dari Sales Import Template,
              // lihat SALES_IMPORT_TEMPLATES.md) menyimpan field kanonis di
              // dalam field_mapping.{key}, BUKAN di top-level mapping_rules[key]
              // seperti mapping flat manual -- keduanya perlu dibaca beda.
              const isGrouped = 'format_type' in rules && !!rules.field_mapping;
              const terdeteksi = isGrouped
                ? MAPPING_FIELDS.filter(f => !!(rules.field_mapping as Record<string, string>)?.[f.key])
                : MAPPING_FIELDS.filter(f => !!rules[f.key]);
              if (terdeteksi.length === 0) {
                return <p className="text-[11px] text-muted-foreground">{t('Belum ada mapping field yang disimpan untuk file ini -- pakai tombol "Mapping Rules" di atas.')}</p>;
              }
              return (
                <div className="flex flex-wrap gap-1.5">
                  {terdeteksi.map(f => (
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
