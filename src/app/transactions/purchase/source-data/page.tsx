'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import MappingRulesModal from '@/app/transactions/components/MappingRulesModal';
import { salesFont as sourceFont } from '@/app/transactions/sales/components/salesFont';
import { useActiveClient } from '@/lib/activeClient';
import {
  usePurchaseSourceFiles, usePurchaseSourceRows, listPurchaseImportTemplates, deletePurchaseSourceFile, promotePurchaseSourceFile,
  type BackendPurchaseSourceFile, type BackendPurchaseSourceRow,
} from '@/lib/purchaseStore';
import { formatTanggalWaktu, formatTanggalSingkat } from '@/lib/salesStore';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, MoreHorizontal, Trash2, FileText, ShieldCheck } from 'lucide-react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Pill status file -- desain sama dengan SourceStatusPill Sales/JE. "Completed" ditampilkan "Success".
const SOURCE_STATUS_STYLE: Record<string, { pill: string; dot: string; label?: string }> = {
  Completed: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600', label: 'Success' },
  Processing: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  'Needs Review': { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Failed: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
};
const SOURCE_STATUS_FALLBACK = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

function SourceStatusPill({ status }: { status: string }) {
  const st = SOURCE_STATUS_STYLE[status] || SOURCE_STATUS_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{(st as { label?: string }).label ?? status}
    </span>
  );
}

// Kartu KPI Source Data -- desain sama persis dengan SourceKpiTile di Source Data Sales
// (garis aksen tipis di atas, ikon kecil, angka semibold, bar proporsi netral, hover garis hitam).
function SourceKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string;
  count: number;
  detail: string;
  detailUnit: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Tombol baris tab -- gaya netral: putih bergaris abu (sekunder) & hitam (utama), sama dengan Source Data Sales.
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;

const PREVIEW_PAGE_SIZE = 20;
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';

// Panel bawah Source Data -- gaya sama dengan SourcePanel di Source Data Sales.
function SourcePanel({ title, leading, action, children }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="flex items-center justify-between gap-3 border-b border-neutral-300 bg-neutral-50 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <h3 className="truncate text-sm font-semibold text-neutral-900">{title}</h3>
        </div>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

// Status 1 baris staging: Created (transaction_id terisi) / Ready (bisa dibuat) / Duplicate / Invalid.
type RowState = 'created' | 'ready' | 'duplicate' | 'invalid';
function rowState(r: BackendPurchaseSourceRow): RowState {
  if (r.transaction_id) return 'created';
  if (!r.is_valid) return 'invalid';
  if (r.is_duplicate_candidate) return 'duplicate';
  return 'ready';
}
const ROW_STATE_STYLE: Record<RowState, { pill: string; dot: string; label: string }> = {
  created: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600', label: 'Created' },
  ready: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600', label: 'Ready' },
  duplicate: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600', label: 'Duplicate' },
  invalid: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600', label: 'Invalid' },
};
const formatIDR = (n: number) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
const formatRp = (n: number) => 'Rp ' + formatIDR(n);

// Klasifikasi file untuk KPI -- 1 file masuk tepat 1 kelompok. Upload hanya mengisi staging (status_mapping 'Processing'
// sampai baris dibuat jadi transaksi lewat Create Transaction).
function fileGroup(f: BackendPurchaseSourceFile): 'pending' | 'success' | 'review' {
  if (f.status_ekstraksi === 'Needs Review' || f.status_ekstraksi === 'Failed' || f.status_mapping === 'Needs Review' || f.status_mapping === 'Failed') return 'review';
  if (f.status_ekstraksi === 'Completed' && f.status_mapping === 'Completed') return 'success';
  return 'pending';
}

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, idx) => {
    if (idx > 0 && n - sorted[idx - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export default function PurchaseSourceDataPage() {
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const clientId = activeClientId ?? null;
  const { files: sourceFiles, loading, error } = usePurchaseSourceFiles(clientId);

  // Paging gaya tab Source Data Sales (pilih baris per halaman 10/25/50).
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [activeClientId]);
  const totalPages = Math.max(1, Math.ceil(sourceFiles.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = sourceFiles.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile: BackendPurchaseSourceFile | null = sourceFiles.find(f => f.id === selectedFileId) ?? sourceFiles[0] ?? null;
  useEffect(() => {
    if (!selectedFileId && sourceFiles.length > 0) setSelectedFileId(sourceFiles[0].id);
    if (selectedFileId && !sourceFiles.some(f => f.id === selectedFileId)) setSelectedFileId(sourceFiles[0]?.id ?? null);
  }, [sourceFiles, selectedFileId]);

  // File Preview: baris staging file terpilih, dipaging 20 baris/halaman (file bisa berisi ribuan transaksi).
  const { rows: previewRows, loading: loadingRows } = usePurchaseSourceRows(selectedFile?.id);
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);
  const jumlahSiap = previewRows.filter(r => rowState(r) === 'ready').length;
  const jumlahDibuat = previewRows.filter(r => rowState(r) === 'created').length;
  const jumlahTidakDibuat = previewRows.length - jumlahDibuat;
  // Semua baris yang bisa dibuat sudah jadi transaksi -> tabel preview diganti panel centang hijau (tombol Create Transaction juga hilang).
  const semuaSudahDibuat = previewRows.length > 0 && jumlahDibuat > 0 && jumlahSiap === 0;

  // Create Transaction: naikkan baris valid file terpilih jadi Purchase Transaction draft (aman diulang).
  const [isPromoting, setIsPromoting] = useState(false);
  const handleCreateTransactions = async () => {
    if (!selectedFile) return;
    setIsPromoting(true);
    try {
      const hasil = await promotePurchaseSourceFile(selectedFile.id);
      if (hasil.transaksi_dibuat > 0) {
        toast.success('Transactions created', {
          description: `${hasil.transaksi_dibuat} new draft purchase transactions -- check the Purchase Transaction tab.`
            + (hasil.dilewati_gagal_insert > 0 ? ` ${hasil.dilewati_gagal_insert} failed to save.` : ''),
        });
        if (hasil.dilewati_gagal_insert > 0) {
          toast.error('Some rows failed to save', { description: hasil.error_insert ?? undefined, duration: 20000 });
        }
      } else if (hasil.dilewati_gagal_insert > 0) {
        toast.error('Failed to save transactions', {
          description: `${hasil.dilewati_gagal_insert} rows failed to save (database error). ${hasil.error_insert ?? ''}`,
          duration: 20000,
        });
      } else {
        toast.info('No new transactions', {
          description: `${hasil.dilewati_sudah_pernah_dipromosikan} already created, ${hasil.dilewati_tidak_valid} invalid, ${hasil.dilewati_duplikat} duplicate, ${hasil.dilewati_no_bentrok} purchase number conflicts.`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create transactions');
    } finally {
      setIsPromoting(false);
    }
  };

  // Menu aksi "···" per baris file: hapus PERMANEN file beserta semua transaksi turunannya (pola sama dengan Source Data Sales).
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const handleDeleteFile = async (f: BackendPurchaseSourceFile) => {
    setMenuFileId(null);
    const ok = window.confirm(
      `Delete file "${f.file_name}"?\n\nPERMANENT: all purchase transactions from this file in every Purchase tab (including those already Posted) and their data in the database will be deleted and cannot be restored.`
    );
    if (!ok) return;
    setDeletingFileId(f.id);
    try {
      await deletePurchaseSourceFile(f.id);
      if (selectedFileId === f.id) setSelectedFileId(null);
      toast.success('File deleted', { description: f.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    } finally {
      setDeletingFileId(null);
    }
  };

  // ── Action bar (pola sama dengan tab Source Data Sales). Upload File ada di header (PurchaseTabs). ──
  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Purchase Template');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Source Type', key: 'type', width: 18 },
      { header: 'Vendor Code', key: 'vendorCode', width: 14 },
      { header: 'Vendor Name', key: 'vendor', width: 26 },
      { header: 'Invoice No.', key: 'invoice', width: 18 },
      { header: 'PO Number', key: 'po', width: 18 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount (IDR)', key: 'amount', width: 16 },
      { header: 'Tax (IDR)', key: 'tax', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      date: '01/12/2024', type: 'Vendor Invoice', vendorCode: 'SUP-001', vendor: 'PT Example Supplier',
      invoice: 'INV-SUP-001', po: 'PO-2024-001', description: 'Inventory purchase', amount: 10000000, tax: 1100000, total: 11100000,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), 'Purchase_Data_Template.xlsx');
    toast.success('Excel template downloaded');
  };

  // Export = daftar file upload saat ini.
  const handleExport = async () => {
    if (sourceFiles.length === 0) {
      toast.info('No source files to export.');
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploaded', width: 18 },
      { header: 'Source File', key: 'file', width: 34 },
      { header: 'Source Type', key: 'type', width: 12 },
      { header: 'Vendor / Entity', key: 'vendor', width: 28 },
      { header: 'Period', key: 'period', width: 16 },
      { header: 'Rows Detected', key: 'rows', width: 14 },
      { header: 'Total (IDR)', key: 'total', width: 18 },
      { header: 'Extraction Status', key: 'ext', width: 18 },
      { header: 'Mapping Status', key: 'map', width: 16 },
      { header: 'Confidence', key: 'conf', width: 12 },
      { header: 'Processed By', key: 'by', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sourceFiles.forEach(f => sheet.addRow({
      uploaded: formatTanggalWaktu(f.uploaded_at), file: f.file_name, type: f.file_type || '-', vendor: f.vendor_hint || '-',
      period: f.period_label || '-', rows: f.rows_detected, total: f.grand_total, ext: f.status_ekstraksi, map: f.status_mapping,
      conf: f.confidence_score ?? 0, by: f.processed_by || '-',
    }));
    sheet.getColumn('total').numFmt = '#,##0';
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), `Purchase_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Export successful', { description: `${sourceFiles.length} files downloaded as Excel.` });
  };

  // Mapping Rules: modal menampilkan template aktif company + field mapping-nya (read-only).
  const [showMapping, setShowMapping] = useState(false);
  const loadTemplates = useCallback(() => listPurchaseImportTemplates(activeClientId ?? ''), [activeClientId]);
  const openMappingModal = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header first.');
      return;
    }
    setShowMapping(true);
  };

  const tiles = useMemo(() => {
    const sumRows = (rows: typeof sourceFiles) => rows.reduce((acc, r) => acc + (r.rows_detected || 0), 0);
    return [
      { label: 'Total File Upload', rows: sourceFiles, icon: Upload },
      { label: 'Pending Processing', rows: sourceFiles.filter(f => fileGroup(f) === 'pending'), icon: Clock },
      { label: 'Successfully Processed', rows: sourceFiles.filter(f => fileGroup(f) === 'success'), icon: CheckCircle },
      { label: 'Needs Review', rows: sourceFiles.filter(f => fileGroup(f) === 'review'), icon: AlertTriangle },
    ].map(k => ({ ...k, detail: sumRows(k.rows).toLocaleString('id-ID') }));
  }, [sourceFiles]);

  // Tombol aksi -- ditaruh di baris yang sama dengan tab (sama dengan Source Data Sales).
  const actionBar = (
    <div className={`${sourceFont.className} flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap`}>
      <button onClick={handleDownloadTemplate} className={ACTION_BTN_SECONDARY}>
        <Download size={13} /> Template Excel
      </button>
      <button onClick={handleExport} disabled={sourceFiles.length === 0} className={ACTION_BTN_SECONDARY}>
        <Download size={13} /> Export
      </button>
      <button onClick={openMappingModal} className={ACTION_BTN_PRIMARY}>
        <Settings size={13} /> Mapping Rules
      </button>
    </div>
  );

  const headers = ['Upload Date', 'Source File', 'Source Type', 'Vendor / Entity', 'Period', 'Rows Detected', 'Extraction Status', 'Mapping Status', 'Confidence', 'Processed By', 'Actions'];
  const NUMERIC_HEADERS = ['Rows Detected'];

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      <PurchaseTabs actions={actionBar} variant="elegant" />

      <div className={`${sourceFont.className} pt-5 space-y-5`}>
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">{error}</div>
        )}

        {/* KPI Cards -- 4 kartu, ukuran & posisi sama dengan Source Data Sales */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(k => (
            <SourceKpiTile
              key={k.label}
              label={k.label}
              count={k.rows.length}
              detail={k.detail}
              detailUnit="rows detected"
              pct={sourceFiles.length > 0 ? Math.round((k.rows.length / sourceFiles.length) * 100) : 0}
              pctLabel="of total files"
              icon={k.icon}
            />
          ))}
        </div>

        {/* File Table */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Purchase Source File List</h3>
            <p className="text-sm text-neutral-500 mt-0.5">
              {loading
                ? 'Loading...'
                : sourceFiles.length === 0
                ? 'Showing 0 of 0 files'
                : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, sourceFiles.length)} of ${sourceFiles.length} files`}
            </p>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1000px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  {headers.map(h => (
                    <th key={h} className={`py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 ${NUMERIC_HEADERS.includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && sourceFiles.length === 0 && (
                  <tr><td colSpan={headers.length} className="py-2 px-2 text-center text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No files uploaded yet.</span></td></tr>
                )}
                {paginated.map(f => (
                  <tr
                    key={f.id}
                    onClick={() => setSelectedFileId(f.id)}
                    className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedFile?.id === f.id ? '[&>td]:bg-neutral-100' : ''}`}
                  >
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{formatTanggalWaktu(f.uploaded_at)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="flex h-5 min-w-[28px] items-center justify-center rounded bg-blue-600 px-1 text-[9px] font-bold uppercase tracking-wider text-white">{(f.file_type || '?').slice(0, 3)}</div>
                        <span className="font-medium text-blue-700">{f.file_name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-neutral-600 whitespace-nowrap">{f.file_type || '-'}</td>
                    <td className="py-2 px-2 font-medium text-neutral-900 whitespace-nowrap max-w-[220px] truncate">{f.vendor_hint || '-'}</td>
                    <td className="py-2 px-2 text-neutral-600 whitespace-nowrap">{f.period_label || '-'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{f.rows_detected.toLocaleString('id-ID')}</td>
                    <td className="py-2 px-2 whitespace-nowrap"><SourceStatusPill status={f.status_ekstraksi} /></td>
                    <td className="py-2 px-2 whitespace-nowrap"><SourceStatusPill status={f.status_mapping} /></td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${(f.confidence_score ?? 0) >= 90 ? 'bg-emerald-500' : (f.confidence_score ?? 0) >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${f.confidence_score ?? 0}%` }} />
                        </div>
                        <span className="text-neutral-600">{f.confidence_score ?? 0}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{f.processed_by || '-'}</td>
                    <td className="py-2 px-2">
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuFileId(menuFileId === f.id ? null : f.id)}
                          disabled={deletingFileId === f.id}
                          className="p-1 hover:bg-neutral-300 rounded transition-colors disabled:opacity-50"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={14} className="text-neutral-600" />
                        </button>
                        {menuFileId === f.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuFileId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg py-1">
                              <button
                                onClick={() => handleDeleteFile(f)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left"
                              >
                                <Trash2 size={12} /> Delete file
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Baris kosong pengisi: tinggi tabel selalu = "Rows per page", supaya layar tidak bergeser (sama dengan Sales). */}
                {Array.from({ length: Math.max(0, pageSize - (paginated.length > 0 ? paginated.length : (!loading ? 1 : 0))) }).map((_, i) => (
                  <tr key={`pad-${i}`} aria-hidden="true" className="invisible text-xs">
                    <td colSpan={headers.length} className="py-2 px-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium">&nbsp;</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>Rows per page</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">{sourceFiles.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, sourceFiles.length)}</span>{' '}
                of <span className="font-semibold text-foreground">{sourceFiles.length}</span> files
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                <ChevronLeft size={15} />
              </button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Panel bawah: File Preview / AI Extraction Summary / Data Quality Check -- pola sama dengan Source Data Sales. */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {/* File Preview -- baris staging file terpilih + tombol Create Transaction */}
        <SourcePanel
          title="File Preview"
          leading={<span className={PANEL_ICON_CHIP}><FileText size={17} /></span>}
          action={selectedFile && jumlahSiap > 0 ? (
            <button
              onClick={handleCreateTransactions}
              disabled={isPromoting}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Turn the valid rows into draft purchase transactions in the Purchase Transaction tab"
            >
              {isPromoting ? 'Processing...' : `Create Transaction (${jumlahSiap.toLocaleString('id-ID')})`}
            </button>
          ) : undefined}
        >
          {selectedFile ? (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold uppercase tracking-wider text-white">{(selectedFile.file_type || '?').slice(0, 3)}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">{selectedFile.file_name}</p>
                <p className="text-xs font-medium text-neutral-500">
                  {selectedFile.rows_detected.toLocaleString('id-ID')} rows · Uploaded {formatTanggalWaktu(selectedFile.uploaded_at)}
                  {previewRows.length > 0 ? ` · ${jumlahDibuat.toLocaleString('id-ID')} created, ${jumlahSiap.toLocaleString('id-ID')} ready` : ''}
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-xs text-neutral-500">No file selected.</p>
          )}
          {selectedFile && !loadingRows && previewRows.length === 0 && (
            <p className="py-6 text-center text-xs text-neutral-500">No rows for this file.</p>
          )}
          {selectedFile && semuaSudahDibuat && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle size={32} />
              </span>
              <p className="text-sm font-semibold text-emerald-700">Transactions have been created</p>
              <p className="max-w-xs text-xs text-neutral-500">
                {jumlahDibuat.toLocaleString('id-ID')} transactions from this file are now in the Purchase Transaction tab.
                {jumlahTidakDibuat > 0 ? ` ${jumlahTidakDibuat.toLocaleString('id-ID')} invalid or duplicate rows were not created.` : ''}
              </p>
            </div>
          )}
          {selectedFile && previewRows.length > 0 && !semuaSudahDibuat && (
            <>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[720px] select-text border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr className="bg-neutral-300">
                      {['No', 'Date', 'Invoice No.', 'Vendor', 'Branch', 'DPP (IDR)', 'PPN (IDR)', 'Total (IDR)', 'Status'].map(h => (
                        <th key={h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-xs font-bold text-black ${['DPP (IDR)', 'PPN (IDR)', 'Total (IDR)'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreviewRows.map(r => {
                      const st = ROW_STATE_STYLE[rowState(r)];
                      return (
                        <tr key={r.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                          <td className="px-2 py-2 text-neutral-600">{r.row_no}</td>
                          <td className="whitespace-nowrap px-2 py-2">{r.tanggal ? formatTanggalSingkat(r.tanggal) : '-'}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-blue-700">{r.no_invoice || '-'}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-neutral-900 max-w-[220px] truncate">{r.nama_vendor || '-'}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-neutral-600">{r.cabang || '-'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatIDR(r.dpp)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatIDR(r.ppn)}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatIDR(r.total)}</td>
                          <td className="whitespace-nowrap px-2 py-2">
                            <span title={r.validation_notes || undefined} className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-xs text-neutral-500">
                <span>
                  <span className="font-semibold text-foreground">{(previewPageSafe - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPageSafe * PREVIEW_PAGE_SIZE, previewRows.length)}</span> of <span className="font-semibold text-foreground">{previewRows.length}</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPageSafe <= 1}
                    aria-label="Previous page"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="min-w-[3.5rem] text-center font-semibold text-foreground">{previewPageSafe} / {previewTotalPages}</span>
                  <button
                    onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))}
                    disabled={previewPageSafe >= previewTotalPages}
                    aria-label="Next page"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </SourcePanel>

        {/* AI Extraction Summary -- dari kolom rows_valid/rows_invalid/duplicate_count/dpp_total/ppn_total/grand_total file terpilih. */}
        <SourcePanel
          title="AI Extraction Summary"
          leading={<span className={`${PANEL_ICON_CHIP} text-xs font-bold`}>AI</span>}
        >
          {!selectedFile ? (
            <p className="py-6 text-center text-xs text-neutral-500">Select or upload a file to see the summary.</p>
          ) : (
            <>
              {selectedFile.ai_model_version ? (
                <p className="mb-3 text-xs text-neutral-600">
                  Model: <span className="ml-1 rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-700">{selectedFile.ai_model_version}</span>
                </p>
              ) : (
                <p className="mb-3 text-xs text-neutral-500">No automatic extraction result for this file yet.</p>
              )}
              {(() => {
                const totalRows = selectedFile.rows_detected || 0;
                const validPct = totalRows > 0 ? Math.round((selectedFile.rows_valid / totalRows) * 100) : 0;
                const stats: { label: string; value: number; cls: string }[] = [
                  { label: 'Total Rows Detected', value: selectedFile.rows_detected, cls: 'text-neutral-900' },
                  { label: 'Valid Rows', value: selectedFile.rows_valid, cls: 'text-neutral-900' },
                  { label: 'Invalid Rows', value: selectedFile.rows_invalid, cls: selectedFile.rows_invalid > 0 ? 'text-red-600' : 'text-neutral-900' },
                ];
                const rows: [string, string][] = [
                  ['Potential Duplicates', String(selectedFile.duplicate_count)],
                  ['Transaction Value (Tax Base)', formatRp(selectedFile.dpp_total)],
                  ['VAT Value', formatRp(selectedFile.ppn_total)],
                  ['Total Value', formatRp(selectedFile.grand_total)],
                ];
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {stats.map(st => (
                        <div key={st.label} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                          <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500" title={st.label}>{st.label}</p>
                          <p className={`mt-1.5 text-lg font-semibold leading-none tabular-nums tracking-tight ${st.cls}`}>{st.value.toLocaleString('id-ID')}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${selectedFile.rows_valid > 0 ? Math.max(validPct, 3) : 0}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-neutral-600">{validPct}% valid rows</p>
                    </div>
                    <div className="mt-3 divide-y divide-neutral-200 text-xs">
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between py-2">
                          <span className="text-neutral-500">{k}</span>
                          <span className="text-sm font-semibold tabular-nums text-neutral-900">{v}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              {selectedFile.extraction_duration_ms != null && (
                <div className="mt-auto border-t border-neutral-200 pt-3">
                  <p className="text-[11px] font-medium text-neutral-500">ℹ Extraction finished in {(selectedFile.extraction_duration_ms / 1000).toFixed(1)} seconds</p>
                </div>
              )}
            </>
          )}
        </SourcePanel>

        {/* Data Quality Check -- dihitung dari baris staging asli file terpilih; "Detected Fields" = field yang terisi di baris hasil ekstraksi. */}
        <SourcePanel
          title="Data Quality Check"
          leading={<span className={PANEL_ICON_CHIP}><ShieldCheck size={17} /></span>}
        >
          {!selectedFile || previewRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">No data rows to check yet.</p>
          ) : (
            (() => {
              const total = previewRows.length;
              const withDate = previewRows.filter(r => !!r.tanggal).length;
              const withInvoice = previewRows.filter(r => !!r.no_invoice).length;
              const withVendor = previewRows.filter(r => !!r.nama_vendor && r.nama_vendor !== '-').length;
              const validTotal = previewRows.filter(r => r.total > 0).length;
              const duplicates = previewRows.filter(r => r.is_duplicate_candidate).length;
              const invalid = previewRows.filter(r => !r.is_valid).length;
              const checks = [
                { label: 'Valid date format', val: `${withDate} / ${total}`, ok: withDate === total },
                { label: 'Invoice number found', val: `${withInvoice} / ${total}`, ok: withInvoice === total },
                { label: 'Valid vendor name', val: `${withVendor} / ${total}`, ok: withVendor === total },
                { label: 'Valid transaction value', val: `${validTotal} / ${total}`, ok: validTotal === total },
                { label: 'Duplicate data', val: String(duplicates), ok: duplicates === 0 },
                { label: 'Invalid rows', val: String(invalid), ok: invalid === 0 },
              ];
              const okCount = checks.filter(c => c.ok).length;
              const okPct = Math.round((okCount / checks.length) * 100);
              return (
                <>
                  <div className="mb-3">
                    <div className="flex items-end justify-between">
                      <p className="text-xs font-semibold text-neutral-600">Checks passed</p>
                      <p className="text-lg font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{okCount}<span className="text-sm font-medium text-neutral-500"> / {checks.length}</span></p>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                      <div className={`h-full rounded-full ${okCount === checks.length ? 'bg-teal-600' : 'bg-red-500'}`} style={{ width: `${okCount > 0 ? Math.max(okPct, 3) : 0}%` }} />
                    </div>
                  </div>
                  <div className="divide-y divide-neutral-200 text-xs">
                    {checks.map(item => (
                      <div key={item.label} className={`flex items-center justify-between py-2 ${item.ok ? '' : 'rounded-lg bg-red-50 px-2'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${item.ok ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-100 text-red-600'}`}>
                            {item.ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                          </span>
                          <span className="text-neutral-600">{item.label}</span>
                        </div>
                        <span className={`text-sm font-semibold tabular-nums ${item.ok ? 'text-neutral-900' : 'text-red-600'}`}>{item.val}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()
          )}
          <div className="mt-3 border-t border-neutral-200 pt-3">
            <p className="mb-2 text-sm font-semibold text-neutral-900">Detected Fields</p>
            {(() => {
              const fields = [
                { label: 'Transaction Date', ada: previewRows.some(r => !!r.tanggal) },
                { label: 'Invoice No.', ada: previewRows.some(r => !!r.no_invoice) },
                { label: 'Vendor Name', ada: previewRows.some(r => !!r.nama_vendor && r.nama_vendor !== '-') },
                { label: 'Vendor Code', ada: previewRows.some(r => !!r.vendor_code) },
                { label: 'Branch', ada: previewRows.some(r => !!r.cabang) },
                { label: 'Tax Base (Before Tax)', ada: previewRows.some(r => r.dpp !== 0) },
                { label: 'VAT', ada: previewRows.some(r => r.ppn !== 0) },
                { label: 'Total Value', ada: previewRows.some(r => r.total !== 0) },
              ].filter(f => f.ada);
              if (fields.length === 0) {
                return <p className="text-[11px] text-neutral-500">No fields detected for this file yet.</p>;
              }
              return (
                <div className="flex flex-wrap gap-1.5">
                  {fields.map(f => (
                    <span key={f.label} className="flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                      <CheckCircle size={10} /> {f.label}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </SourcePanel>
        </div>
      </div>

      {showMapping && <MappingRulesModal onClose={() => setShowMapping(false)} loadTemplates={loadTemplates} />}
    </div>
  );
}