'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import MappingRulesModal from '@/app/transactions/components/MappingRulesModal';
import { salesFont as sourceFont } from '@/app/transactions/sales/components/salesFont';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseSourceFiles, listPurchaseImportTemplates } from '@/lib/purchaseStore';
import { formatTanggalWaktu } from '@/lib/salesStore';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

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
      { label: 'Pending Processing', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Processing'), icon: Clock },
      { label: 'Successfully Processed', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Completed'), icon: CheckCircle },
      { label: 'Needs Review', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Needs Review' || f.status_ekstraksi === 'Failed'), icon: AlertTriangle },
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

  const headers = ['Upload Date', 'Source File', 'Source Type', 'Vendor / Entity', 'Period', 'Rows Detected', 'Extraction Status', 'Mapping Status', 'Confidence', 'Processed By'];
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
                    className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedFileId === f.id ? '[&>td]:bg-neutral-100' : ''}`}
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
      </div>

      {showMapping && <MappingRulesModal onClose={() => setShowMapping(false)} loadTemplates={loadTemplates} />}
    </div>
  );
}