'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, FileText, ShieldCheck, MoreHorizontal, ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { downloadBlob } from '../../components/exportTemplates/exportExcelShared';
import {
  useSalesSourceFiles, uploadSalesSourceFile, updateSalesSourceFile, deleteSalesSourceFile,
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

// Kartu KPI Source Data -- ukuran & penempatan sama dengan SalesKpiTile di tab
// Sales Transaction (garis aksen atas, angka besar, bar proporsi), ditambah
// latar gradasi hijau lembut & kilau warna di sudut supaya lebih hidup.
// Semua nada memakai keluarga hijau brand aplikasi, dari terang ke tua.
type KpiTone = 'slate' | 'amber' | 'green' | 'sky';
const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string; glow: string }> = {
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]', glow: 'bg-[#6EE7B7]' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]', glow: 'bg-[#22C55E]' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]', glow: 'bg-[#0F7D4E]' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]', glow: 'bg-[#0B5E5C]' },
};

function SourceKpiTile({ label, count, detail, detailUnit, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  count: number;
  detail: string;
  detailUnit: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-primary/60 bg-gradient-to-br from-white via-white to-[#F0FDF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <span className={`pointer-events-none absolute -bottom-8 -right-8 h-28 w-28 rounded-full opacity-[0.12] blur-xl ${c.glow}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide text-slate-700">{label}</p>
          <p className="mt-2 text-4xl font-extrabold leading-none tabular-nums text-[#064E3B]">{count.toLocaleString('id-ID')}</p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-white ${c.iconBg}`}>
          <Icon size={24} className={c.iconText} />
        </span>
      </div>
      <p className="relative mt-3 truncate text-lg font-bold text-slate-900">
        {detail} <span className="text-xs font-semibold text-slate-500">{detailUnit}</span>
      </p>
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${count > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1.5 text-xs font-semibold text-slate-600">{pct}% {pctLabel}</p>
    </div>
  );
}

// Panel bawah Source Data (File Preview / AI Extraction Summary / Data Quality
// Check) -- kartu putih bersih dengan header terpisah garis. Sengaja BEDA dari
// kartu KPI (tanpa garis aksen & gradasi) supaya tidak terlihat sama persis.
function SourcePanel({ title, leading, action, children }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <h3 className="truncate text-lg font-bold text-foreground">{title}</h3>
        </div>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

// actionSlot: elemen di baris tab (SalesClient) tempat tombol aksi dirender
// lewat portal, supaya sejajar dengan nama tab. undefined = render di tempat
// (perilaku lama), null = slot belum siap (tunggu), element = portal ke slot.
export default function SalesSourceData({ actionSlot }: { actionSlot?: HTMLElement | null } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // [FIX] Klien untuk upload diambil dari dropdown "Switch Company" di header
  // (useActiveClient) -- TIDAK ada lagi dropdown klien terpisah di halaman ini.
  // Sumber daftarnya tetap management_clients (sama dengan halaman /clients),
  // dipakai backend sebagai key pencocokan/pembuatan template pola kolom
  // (lihat root/SALES_IMPORT_TEMPLATES.md).
  const { activeClientId: managementClientId } = useActiveClient();
  const clientId = managementClientId ?? null; // filter list = company aktif (client_id di DB = management_clients)

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

  // Pagination tabel Daftar File Sumber (sama seperti tabel Sales Transaction).
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [clientId]);
  const totalPages = Math.max(1, Math.ceil(sourceFiles.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = sourceFiles.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const { rows: previewRows, loading: loadingRows } = useSalesSourceRows(selectedFile?.id);

  // [BARU] File Preview dipaging 20 baris/halaman -- file laporan bisa
  // berisi ribuan baris (mis. contoh SAU: 10.769), menampilkan semuanya
  // sekaligus bikin tabelnya berat & sulit dibaca.
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);

  // [BARU] Menu aksi "···" per baris file: hapus (soft-delete) source file.
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const handleDeleteFile = async (f: BackendSalesSourceFile) => {
    setMenuFileId(null);
    const ok = window.confirm(
      `${t('Hapus file')} "${f.file_name}"?\n\n${t('Invoice yang sudah dibuat dari file ini tidak ikut terhapus.')}`
    );
    if (!ok) return;
    setDeletingFileId(f.id);
    try {
      await deleteSalesSourceFile(f.id);
      toast.success(t('File dihapus'), { description: f.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menghapus file'));
    } finally {
      setDeletingFileId(null);
    }
  };

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
      toast.error(t('Select a company in the header before uploading a file.'));
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
    if (!userId) {
      toast.error(t('Sesi login tidak ditemukan, silakan login ulang.'));
      return;
    }
    if (!managementClientId) {
      toast.error(t('Select a company in the header before uploading a file.'));
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
    const sheet = workbook.addWorksheet('Sales Template');
    sheet.columns = [
      { header: 'Date', key: 'tanggal', width: 14 },
      { header: 'Invoice No.', key: 'invoice', width: 18 },
      { header: 'Customer Name', key: 'customer', width: 26 },
      { header: 'Tax Base (IDR)', key: 'dpp', width: 16 },
      { header: 'VAT (IDR)', key: 'ppn', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ tanggal: '01/12/2024', invoice: 'INV-2024-001', customer: 'PT Example Corp', dpp: 10000000, ppn: 1100000, total: 11100000 });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, 'Sales_Data_Template.xlsx');
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


  const actionBar = (
    <div className="flex flex-wrap items-center justify-end gap-2 pb-2 lg:pb-0">
      <button onClick={handleUploadClick} disabled={isUploading || !managementClientId} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Upload size={13} /> {isUploading ? t('Mengunggah...') : t('Upload File')}
      </button>
      <button onClick={handleDownloadTemplate} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Download size={13} /> {t('Template Excel')}
      </button>
      <button onClick={handleExport} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Download size={13} /> {t('Export')}
      </button>
      <button onClick={openMappingModal} className="btn-primary text-xs py-1.5 gap-1.5">
        <Settings size={13} /> {t('Mapping Rules')}
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt" className="hidden" onChange={handleFilesSelected} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* Action Bar -- dipindah ke baris yang sama dengan nama tab (via portal ke
          slot di SalesClient). Fungsi tombol tidak berubah. */}
      {actionSlot === undefined ? actionBar : actionSlot ? createPortal(actionBar, actionSlot) : null}

      {/* KPI Cards -- ukuran & posisi sama dengan tab Sales Transaction */}
      <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(() => {
          const total = sourceFiles.length;
          const sumRows = (rows: typeof sourceFiles) => rows.reduce((acc, r) => acc + (r.rows_detected || 0), 0);
          const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
          const menunggu = sourceFiles.filter(f => f.status_ekstraksi === 'Diproses');
          const berhasil = sourceFiles.filter(f => f.status_ekstraksi === 'Berhasil');
          const review = sourceFiles.filter(f => f.status_ekstraksi === 'Butuh Review');
          const pctLabel = t('dari total file');
          const tiles: { label: string; rows: typeof sourceFiles; tone: KpiTone; icon: React.ElementType }[] = [
            { label: 'Total File Upload', rows: sourceFiles, tone: 'slate', icon: Upload },
            { label: 'Menunggu Diproses', rows: menunggu, tone: 'amber', icon: Clock },
            { label: 'Berhasil Diproses', rows: berhasil, tone: 'green', icon: CheckCircle },
            { label: 'Butuh Review', rows: review, tone: 'sky', icon: AlertTriangle },
          ];
          return tiles.map(k => (
            <SourceKpiTile
              key={k.label}
              label={t(k.label)}
              count={k.rows.length}
              detail={sumRows(k.rows).toLocaleString('id-ID')}
              detailUnit={t('baris terdeteksi')}
              pct={pctOf(k.rows.length)}
              pctLabel={pctLabel}
              tone={k.tone}
              icon={k.icon}
            />
          ));
        })()}
      </div>

      {/* File Table */}
      <div className="card overflow-hidden">
        <div className="px-0 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-foreground">{t('Daftar File Sumber Penjualan')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading
                ? t('Memuat...')
                : sourceFiles.length === 0
                ? t('Menampilkan 0 dari 0 file')
                : `${t('Menampilkan')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, sourceFiles.length)} ${t('dari')} ${sourceFiles.length} ${t('file')}`}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-[#8FE3B5]">
                {['Upload Date', 'Source File', 'Source Type', 'Customer / Entity', 'Period', 'Rows Detected', 'Status Ekstraksi', 'Status Mapping', 'Confidence', 'Processed By', 'Actions'].map(h => (
                  <th key={h} className="text-left py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]">{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && sourceFiles.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-xs text-muted-foreground">{t('Belum ada file yang diunggah.')}</td></tr>
              )}
              {paginated.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelectedFileId(f.id)}
                  className={`border-b border-slate-300/70 cursor-pointer transition-colors text-xs ${selectedFile?.id === f.id ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
                >
                  <td className="py-2 px-2 text-xs text-foreground whitespace-nowrap">{formatTanggalWaktu(f.uploaded_at)}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${f.file_type === 'Excel' ? 'bg-emerald-100 text-emerald-700' : f.file_type === 'CSV' ? 'bg-blue-100 text-blue-700' : f.file_type === 'PDF' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'}`}>{(f.file_type || '?').slice(0, 3)}</div>
                      <span className="text-xs text-foreground font-medium">{f.file_name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">{f.file_type || '-'}</td>
                  <td className="py-2 px-2 text-xs text-foreground">{f.customer_hint || '—'}</td>
                  <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">{f.period_label || '-'}</td>
                  <td className="py-2 px-2 text-xs text-foreground">{f.rows_detected.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.status_ekstraksi)}`}>{t(f.status_ekstraksi)}</span></td>
                  <td className="py-2 px-2"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.status_mapping)}`}>{t(f.status_mapping)}</span></td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${(f.confidence_score ?? 0) >= 90 ? 'bg-emerald-500' : (f.confidence_score ?? 0) >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${f.confidence_score ?? 0}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{f.confidence_score ?? 0}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-xs text-foreground whitespace-nowrap">{f.processed_by || '-'}</td>
                  <td className="py-2 px-2">
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
        <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span>{t('Baris per halaman')}</span>
              <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
            <span className="hidden sm:inline text-slate-300">|</span>
            <span>
              <span className="font-semibold text-foreground">
                {sourceFiles.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, sourceFiles.length)}
              </span>{' '}
              {t('dari')} <span className="font-semibold text-foreground">{sourceFiles.length}</span> {t('file')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Halaman sebelumnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
            {buildPageItems(pageSafe, totalPages).map((p, idx) =>
              p === '…' ? (
                <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
              ) : (
                <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
              )
            )}
            <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Halaman berikutnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* Bottom Section -- SEMUA dari data asli (source file terpilih & baris
          source row-nya), tidak ada lagi angka contoh. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* File Preview */}
        <SourcePanel
          title={t('File Preview')}
          leading={
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]"><FileText size={17} /></span>
          }
          action={selectedFile && previewRows.length > 0 ? (
            <button
              onClick={handlePromoteToInvoices}
              disabled={isPromoting}
              className="btn-primary shrink-0 rounded-xl px-3 py-1.5 text-xs gap-1 disabled:opacity-50"
              title={t('Naikkan baris valid jadi invoice resmi di tab Sales Transaction')}
            >
              {isPromoting ? t('Memproses...') : t('Buat Invoice')}
            </button>
          ) : undefined}
        >
          {selectedFile ? (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D1FAE5] text-[11px] font-extrabold text-[#065F46] shadow-sm ring-1 ring-white">{(selectedFile.file_type || '?').slice(0, 3).toUpperCase()}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{selectedFile.file_name}</p>
                <p className="text-xs font-medium text-slate-600">{selectedFile.rows_detected} {t('baris')} · {t('Diunggah')} {formatTanggalWaktu(selectedFile.uploaded_at)}</p>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-xs text-muted-foreground">{t('Belum ada file yang dipilih.')}</p>
          )}
          {selectedFile && !loadingRows && previewRows.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada baris data untuk file ini (ekstraksi otomatis belum tersambung).')}</p>
          )}
          {selectedFile && previewRows.length > 0 && (
            <>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#8FE3B5]">
                      {['No', 'Tanggal', 'No. Invoice', 'Nama Customer', 'Cabang', 'DPP (IDR)', 'PPN (IDR)', 'Total (IDR)'].map(h => (
                        <th key={h} className="whitespace-nowrap border-b border-t-2 border-[#0A4A32] px-2 py-2.5 text-left text-[11px] font-bold text-[#065F46]">{t(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreviewRows.map(r => (
                      <tr key={r.id} className="border-b border-slate-300/70 transition-colors hover:bg-slate-200/70">
                        <td className="px-2 py-2 text-muted-foreground">{r.row_no}</td>
                        <td className="whitespace-nowrap px-2 py-2">{r.tanggal ? formatTanggalSingkat(r.tanggal) : '-'}</td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-primary">{r.no_invoice || '-'}</td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-foreground">{r.nama_customer || '-'}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{r.cabang || '-'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{(r.dpp / 1000).toFixed(0)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{(r.ppn / 1000).toFixed(0)}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{(r.total / 1000).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{(previewPageSafe - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPageSafe * PREVIEW_PAGE_SIZE, previewRows.length)}</span> {t('dari')} <span className="font-semibold text-foreground">{previewRows.length}</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPageSafe <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="min-w-[3.5rem] text-center font-semibold text-foreground">{previewPageSafe} / {previewTotalPages}</span>
                  <button
                    onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))}
                    disabled={previewPageSafe >= previewTotalPages}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </SourcePanel>

        {/* AI Extraction Summary -- langsung dari kolom rows_valid/rows_invalid/
            duplicate_count/dpp_total/ppn_total/grand_total milik file
            terpilih (GET /source-files), bukan lagi angka ilustrasi. */}
        <SourcePanel
          title={t('AI Extraction Summary')}
          leading={
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-xs font-extrabold text-[#065F46]">AI</span>
          }
        >
          {!selectedFile ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('Pilih atau unggah file untuk melihat ringkasan.')}</p>
          ) : (
            <>
              {selectedFile.ai_model_version ? (
                <p className="mb-3 text-xs text-slate-600">
                  {t('Model')}: <span className="ml-1 rounded-full border border-[#6EE7B7]/60 bg-[#ECFDF5] px-2 py-0.5 font-semibold text-[#047857]">{selectedFile.ai_model_version}</span>
                </p>
              ) : (
                <p className="mb-3 text-xs text-muted-foreground">{t('Belum ada hasil ekstraksi otomatis untuk file ini.')}</p>
              )}
              {(() => {
                const totalRows = selectedFile.rows_detected || 0;
                const validPct = totalRows > 0 ? Math.round((selectedFile.rows_valid / totalRows) * 100) : 0;
                const stats: { label: string; value: number; cls: string }[] = [
                  { label: 'Total Baris Terdeteksi', value: selectedFile.rows_detected, cls: 'text-[#064E3B]' },
                  { label: 'Baris Valid', value: selectedFile.rows_valid, cls: 'text-[#0F7D4E]' },
                  { label: 'Baris Tidak Valid', value: selectedFile.rows_invalid, cls: selectedFile.rows_invalid > 0 ? 'text-red-600' : 'text-[#064E3B]' },
                ];
                const rows: [string, string][] = [
                  ['Duplikat Potensial', String(selectedFile.duplicate_count)],
                  ['Nilai Transaksi (DPP)', formatIDR(selectedFile.dpp_total)],
                  ['Nilai PPN', formatIDR(selectedFile.ppn_total)],
                  ['Nilai Total', formatIDR(selectedFile.grand_total)],
                ];
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {stats.map(st => (
                        <div key={st.label} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                          <p className="truncate text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500" title={t(st.label)}>{t(st.label)}</p>
                          <p className={`mt-1.5 text-2xl font-extrabold leading-none tabular-nums ${st.cls}`}>{st.value.toLocaleString('id-ID')}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[#0F7D4E]" style={{ width: `${selectedFile.rows_valid > 0 ? Math.max(validPct, 3) : 0}%` }} />
                      </div>
                      <p className="mt-1.5 text-xs font-semibold text-slate-600">{validPct}% {t('baris valid')}</p>
                    </div>
                    <div className="mt-3 divide-y divide-slate-200 text-xs">
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between py-2">
                          <span className="text-muted-foreground">{t(k)}</span>
                          <span className="text-sm font-bold tabular-nums text-slate-900">{v}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              {selectedFile.extraction_duration_ms != null && (
                <div className="mt-auto border-t border-border pt-3">
                  <p className="text-[11px] font-medium text-muted-foreground">ℹ {t('Ekstraksi selesai dalam')} {(selectedFile.extraction_duration_ms / 1000).toFixed(1)} {t('detik')}</p>
                </div>
              )}
            </>
          )}
        </SourcePanel>

        {/* Data Quality Check -- dihitung dari baris source row asli milik
            file terpilih (kalau ada), "Detected Fields" dari mapping_rules
            yang sudah disimpan lewat modal Mapping Rules. */}
        <SourcePanel
          title={t('Data Quality Check')}
          leading={
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]"><ShieldCheck size={17} /></span>
          }
        >
          {!selectedFile || previewRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada baris data untuk dicek.')}</p>
          ) : (
            (() => {
              const total = previewRows.length;
              const withDate = previewRows.filter(r => !!r.tanggal).length;
              const withInvoice = previewRows.filter(r => !!r.no_invoice).length;
              const withCustomer = previewRows.filter(r => !!r.nama_customer).length;
              const validTotal = previewRows.filter(r => r.total > 0).length;
              const duplicates = previewRows.filter(r => r.is_duplicate_candidate).length;
              const invalid = previewRows.filter(r => !r.is_valid).length;
              const checks = [
                { label: 'Format tanggal valid', val: `${withDate} / ${total}`, ok: withDate === total },
                { label: 'No. invoice ditemukan', val: `${withInvoice} / ${total}`, ok: withInvoice === total },
                { label: 'Nama customer valid', val: `${withCustomer} / ${total}`, ok: withCustomer === total },
                { label: 'Nilai transaksi valid', val: `${validTotal} / ${total}`, ok: validTotal === total },
                { label: 'Duplikat data', val: String(duplicates), ok: duplicates === 0 },
                { label: 'Baris tidak valid', val: String(invalid), ok: invalid === 0 },
              ];
              const okCount = checks.filter(c => c.ok).length;
              const okPct = Math.round((okCount / checks.length) * 100);
              return (
                <>
                  <div className="mb-3">
                    <div className="flex items-end justify-between">
                      <p className="text-xs font-semibold text-slate-600">{t('Pemeriksaan lolos')}</p>
                      <p className="text-2xl font-extrabold leading-none tabular-nums text-[#064E3B]">{okCount}<span className="text-sm font-bold text-slate-500"> / {checks.length}</span></p>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${okCount === checks.length ? 'bg-[#0F7D4E]' : 'bg-red-500'}`} style={{ width: `${okCount > 0 ? Math.max(okPct, 3) : 0}%` }} />
                    </div>
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    {checks.map(item => (
                      <div key={item.label} className={`flex items-center justify-between py-2 ${item.ok ? '' : 'rounded-lg bg-red-50 px-2'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${item.ok ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-red-100 text-red-600'}`}>
                            {item.ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                          </span>
                          <span className="text-muted-foreground">{t(item.label)}</span>
                        </div>
                        <span className={`text-sm font-bold tabular-nums ${item.ok ? 'text-slate-900' : 'text-red-600'}`}>{item.val}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()
          )}
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-sm font-bold text-foreground">{t('Detected Fields')}</p>
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
                    <span key={f.key} className="flex items-center gap-1 rounded-full border border-[#6EE7B7]/60 bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-semibold text-[#047857]">
                      <CheckCircle size={10} /> {t(f.label)}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </SourcePanel>
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