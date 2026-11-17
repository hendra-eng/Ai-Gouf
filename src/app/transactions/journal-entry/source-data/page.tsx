'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { salesFont as sourceFont } from '@/app/transactions/sales/components/salesFont';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, FileText, ShieldCheck, MoreHorizontal, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useJeSourceFiles, useJeSourceRows, deleteJeSourceFile, promoteJeSourceFileToJournals, listJeImportTemplates,
  type BackendJeSourceFile,
} from '@/lib/journalEntryStore';
import { formatTanggalWaktu, formatTanggalSingkat } from '@/lib/salesStore';
import ImportJournalModal, { HEADER_ALIASES, JE_REQUIRED_COLUMNS } from '@/app/transactions/journal-entry/components/ImportJournalModal';
import MappingRulesModal from '@/app/transactions/components/MappingRulesModal';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { JeErrorBanner } from '@/app/transactions/journal-entry/components/JeNotice';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PREVIEW_PAGE_SIZE = 20;
const formatIDR = (n: number) => 'Rp ' + (n || 0).toLocaleString('id-ID');

// Label field sistem untuk bagian "Generic Column Mapping" di modal Mapping Rules.
const JE_FIELD_LABELS: Record<string, string> = {
  je_number: 'JE Number', entry_date: 'Date', description: 'Description', source_type: 'Source Type',
  account_code: 'Account Code', account_name: 'Account Name', debit: 'Debit', credit: 'Credit', cost_center: 'Cost Center',
};
const JE_MAPPING_COLUMNS = Object.entries(HEADER_ALIASES).map(([key, accepted]) => ({
  field: JE_FIELD_LABELS[key] || key, accepted, required: JE_REQUIRED_COLUMNS.includes(key),
}));

// ── Gaya: disalin 1:1 dari SalesSourceData.tsx (monokrom abu + hitam, font Inter) ──
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-neutral-800 bg-neutral-800 text-white hover:bg-neutral-700`;
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';

const SOURCE_STATUS_STYLE: Record<string, { pill: string; dot: string }> = {
  Completed: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  Processing: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  'Needs Review': { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Failed: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
};
const SOURCE_STATUS_FALLBACK = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };
const SOURCE_NUMERIC_COLS = ['JE Detected', 'Total Debit', 'Total Credit'];

const SourceStatusPill = ({ status }: { status: string }) => {
  const st = SOURCE_STATUS_STYLE[status] || SOURCE_STATUS_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{status}
    </span>
  );
};

function SourceKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string; count: number; detail: string; detailUnit: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

function SourcePanel({ title, leading, action, children }: {
  title: string; leading?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
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

export default function SourceDataPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { activeClientId } = useActiveClient();

  const { files: sourceFiles, loading, error, refresh } = useJeSourceFiles(activeClientId);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile: BackendJeSourceFile | null = sourceFiles.find(f => f.id === selectedFileId) ?? sourceFiles[0] ?? null;
  useEffect(() => {
    if (!selectedFileId && sourceFiles.length > 0) setSelectedFileId(sourceFiles[0].id);
    if (selectedFileId && !sourceFiles.some(f => f.id === selectedFileId)) setSelectedFileId(sourceFiles[0]?.id ?? null);
  }, [sourceFiles, selectedFileId]);

  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [activeClientId]);
  const totalPages = Math.max(1, Math.ceil(sourceFiles.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = sourceFiles.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const { rows: previewRows, loading: loadingRows } = useJeSourceRows(selectedFile?.id);
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);

  // Menu aksi "···" per baris file: hapus (soft-delete).
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const handleDeleteFile = async (f: BackendJeSourceFile) => {
    setMenuFileId(null);
    if (!window.confirm(`Delete file "${f.file_name}"?\n\nJournal entries already created from this file will not be deleted.`)) return;
    setDeletingFileId(f.id);
    try {
      await deleteJeSourceFile(f.id);
      toast.success('File deleted', { description: f.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    } finally {
      setDeletingFileId(null);
    }
  };

  const [isPromoting, setIsPromoting] = useState(false);
  const handleCreateJournal = async () => {
    if (!selectedFile) return;
    setIsPromoting(true);
    try {
      const hasil = await promoteJeSourceFileToJournals(selectedFile.id);
      if (hasil.journals_created > 0) {
        toast.success('Journals created', { description: `${hasil.journals_created} new journal entries -- check the JE Transaction tab.` });
      } else {
        toast.info('No new journals', {
          description: `${hasil.skipped_already_promoted} already created, ${hasil.skipped_invalid} invalid, ${hasil.skipped_number_conflict} JE number conflicts.`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create journals');
    } finally {
      setIsPromoting(false);
    }
  };

  const [showImport, setShowImport] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const loadTemplates = useCallback(() => listJeImportTemplates(activeClientId ?? ''), [activeClientId]);

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Journal Entry Template');
    sheet.columns = [
      { header: 'JE Number', key: 'je', width: 18 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Source Type', key: 'type', width: 14 },
      { header: 'Account Code', key: 'code', width: 14 },
      { header: 'Account Name', key: 'name', width: 24 },
      { header: 'Debit', key: 'debit', width: 14 },
      { header: 'Credit', key: 'credit', width: 14 },
      { header: 'Cost Center', key: 'cc', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ je: 'JE-2026-09-0100', date: '2026-09-18', description: 'Capital injection', type: 'Manual', code: '1100', name: 'Cash', debit: 1000000, credit: 0, cc: '' });
    sheet.addRow({ je: 'JE-2026-09-0100', date: '2026-09-18', description: 'Capital injection', type: 'Manual', code: '3100', name: 'Owner Equity', debit: 0, credit: 1000000, cc: '' });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), 'Journal_Entry_Template.xlsx');
    toast.success('Excel template downloaded');
  };

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploaded', width: 18 },
      { header: 'Source File', key: 'file', width: 34 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Period', key: 'period', width: 14 },
      { header: 'JE Detected', key: 'je', width: 12 },
      { header: 'Total Debit', key: 'debit', width: 18 },
      { header: 'Total Credit', key: 'credit', width: 18 },
      { header: 'Extraction Status', key: 'ext', width: 16 },
      { header: 'Mapping Status', key: 'map', width: 16 },
      { header: 'Confidence', key: 'conf', width: 12 },
      { header: 'Processed By', key: 'by', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sourceFiles.forEach(f => sheet.addRow({
      uploaded: formatTanggalWaktu(f.uploaded_at), file: f.file_name, type: f.file_type || '-', period: f.period_label || '-',
      je: f.rows_detected, debit: f.debit_total, credit: f.credit_total, ext: f.status_ekstraksi, map: f.status_mapping,
      conf: f.confidence_score ?? 0, by: f.processed_by || '-',
    }));
    sheet.getColumn('debit').numFmt = '#,##0';
    sheet.getColumn('credit').numFmt = '#,##0';
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), `Journal_Entry_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Export successful', { description: `${sourceFiles.length} files downloaded as Excel.` });
  };

  const actionBar = (
    <div className={`${sourceFont.className} flex flex-wrap items-center justify-end gap-2 pb-2 lg:pb-0`}>
      <button onClick={() => setShowImport(true)} disabled={!userId || !activeClientId} className={ACTION_BTN_SECONDARY}>
        <Upload size={13} /> Upload File
      </button>
      <button onClick={handleDownloadTemplate} className={ACTION_BTN_SECONDARY}>
        <Download size={13} /> Excel Template
      </button>
      <button onClick={handleExport} disabled={sourceFiles.length === 0} className={ACTION_BTN_SECONDARY}>
        <Download size={13} /> Export
      </button>
      <button onClick={() => setShowMapping(true)} className={ACTION_BTN_PRIMARY}>
        <Settings size={13} /> Mapping Rules
      </button>
    </div>
  );

  const tiles = useMemo(() => {
    const sumRows = (rows: BackendJeSourceFile[]) => rows.reduce((acc, r) => acc + (r.rows_detected || 0), 0);
    return [
      { label: 'Total Files Uploaded', rows: sourceFiles, icon: Upload },
      { label: 'Awaiting Processing', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Processing'), icon: Clock },
      { label: 'Processed Successfully', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Completed'), icon: CheckCircle },
      { label: 'Needs Review', rows: sourceFiles.filter(f => f.status_ekstraksi === 'Needs Review'), icon: AlertTriangle },
    ].map(k => ({ ...k, detail: sumRows(k.rows).toLocaleString('id-ID') }));
  }, [sourceFiles]);

  const headers = ['Upload Date', 'Source File', 'Type', 'Period', 'JE Detected', 'Total Debit', 'Total Credit', 'Extraction Status', 'Mapping Status', 'Confidence', 'Processed By', 'Actions'];

  return (
    <div className="fade-in">
      <JournalEntryTabs activeTab="source" tabActions={actionBar} />
      {showImport && userId && (
        <ImportJournalModal
          clientId={userId}
          createdByName={user?.nama || user?.username || 'System'}
          onClose={() => { setShowImport(false); refresh(); }}
        />
      )}
      {showMapping && (
        <MappingRulesModal
          onClose={() => setShowMapping(false)}
          loadTemplates={activeClientId ? loadTemplates : undefined}
          columns={JE_MAPPING_COLUMNS}
          columnsNote="Used when no import template matches the uploaded file: rows are grouped per JE Number into balanced draft journals."
        />
      )}

      <div className={`${sourceFont.className} space-y-5`}>
        {error && <JeErrorBanner message={error} onRetry={refresh} />}

        {/* KPI Cards */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(k => (
            <SourceKpiTile
              key={k.label}
              label={k.label}
              count={k.rows.length}
              detail={k.detail}
              detailUnit="JE detected"
              pct={sourceFiles.length > 0 ? Math.round((k.rows.length / sourceFiles.length) * 100) : 0}
              pctLabel="of total files"
              icon={k.icon}
            />
          ))}
        </div>

        {/* File Table */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Journal Source File List</h3>
            <p className="text-sm text-neutral-500 mt-0.5">
              {loading
                ? 'Loading...'
                : sourceFiles.length === 0
                ? 'Showing 0 of 0 files'
                : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, sourceFiles.length)} of ${sourceFiles.length} files`}
            </p>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[900px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  {headers.map(h => (
                    <th key={h} className={`py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 ${SOURCE_NUMERIC_COLS.includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
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
                        <div className="flex h-5 min-w-[28px] items-center justify-center rounded bg-neutral-900 px-1 text-[9px] font-bold uppercase tracking-wider text-white">{(f.file_type || '?').slice(0, 3)}</div>
                        <span className="font-medium text-blue-700">{f.file_name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-neutral-600 whitespace-nowrap">{f.file_type || '-'}</td>
                    <td className="py-2 px-2 text-neutral-600 whitespace-nowrap">{f.period_label || '-'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{f.rows_detected.toLocaleString('id-ID')}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{(f.debit_total || 0).toLocaleString('id-ID')}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{(f.credit_total || 0).toLocaleString('id-ID')}</td>
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
                      <div className="relative" onClick={e => e.stopPropagation()}>
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
                              <button onClick={() => handleDeleteFile(f)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left">
                                <Trash2 size={12} /> Delete file
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Baris pengisi: tinggi tabel selalu = rows per page, supaya layar tidak bergeser. */}
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
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-neutral-800 font-semibold text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="grid grid-cols-1 items-start xl:grid-cols-3 gap-4">
          {/* File Preview */}
          <SourcePanel
            title="File Preview"
            leading={<span className={PANEL_ICON_CHIP}><FileText size={17} /></span>}
            action={selectedFile && previewRows.length > 0 ? (
              <button
                onClick={handleCreateJournal}
                disabled={isPromoting}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Promote valid rows to official draft journals in the JE Transaction tab"
              >
                {isPromoting ? 'Processing...' : 'Create Journal'}
              </button>
            ) : undefined}
          >
            {selectedFile ? (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold uppercase tracking-wider text-white">{(selectedFile.file_type || '?').slice(0, 3).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{selectedFile.file_name}</p>
                  <p className="text-xs font-medium text-neutral-500">{selectedFile.rows_detected} journal entries · Uploaded {formatTanggalWaktu(selectedFile.uploaded_at)}</p>
                </div>
              </div>
            ) : (
              <p className="mb-3 text-xs text-neutral-500">No file selected.</p>
            )}
            {selectedFile && !loadingRows && previewRows.length === 0 && (
              <p className="py-6 text-center text-xs text-neutral-500">No data rows for this file yet.</p>
            )}
            {selectedFile && previewRows.length > 0 && (
              <>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full select-text border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="bg-neutral-300">
                        {['No', 'Date', 'JE Number', 'Description', 'Lines', 'Debit (IDR)', 'Credit (IDR)'].map(h => (
                          <th key={h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-xs font-bold text-black ${['Debit (IDR)', 'Credit (IDR)', 'Lines'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedPreviewRows.map(r => (
                        <tr key={r.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                          <td className="px-2 py-2 text-neutral-600">{r.row_no}</td>
                          <td className="whitespace-nowrap px-2 py-2">{r.tanggal ? formatTanggalSingkat(r.tanggal) : '-'}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-blue-700">{r.je_number || '-'}</td>
                          <td className="max-w-[160px] truncate px-2 py-2 font-medium text-neutral-900" title={r.description || ''}>{r.description || '-'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-neutral-600">{r.line_count}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{(r.debit_total / 1000).toFixed(0)}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{(r.credit_total / 1000).toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-neutral-200 pt-3 text-xs text-neutral-500">
                  <span>
                    <span className="font-semibold text-foreground">{(previewPageSafe - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(previewPageSafe * PREVIEW_PAGE_SIZE, previewRows.length)}</span> of <span className="font-semibold text-foreground">{previewRows.length}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPreviewPage(p => Math.max(1, p - 1))} disabled={previewPageSafe <= 1} className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="min-w-[3.5rem] text-center font-semibold text-foreground">{previewPageSafe} / {previewTotalPages}</span>
                    <button onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))} disabled={previewPageSafe >= previewTotalPages} className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </SourcePanel>

          {/* AI Extraction Summary */}
          <SourcePanel title="AI Extraction Summary" leading={<span className={`${PANEL_ICON_CHIP} text-xs font-bold`}>AI</span>}>
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
                  const stats = [
                    { label: 'Total JE Detected', value: selectedFile.rows_detected, cls: 'text-neutral-900' },
                    { label: 'Valid JE', value: selectedFile.rows_valid, cls: 'text-neutral-900' },
                    { label: 'Invalid JE', value: selectedFile.rows_invalid, cls: selectedFile.rows_invalid > 0 ? 'text-red-600' : 'text-neutral-900' },
                  ];
                  const rows: [string, string][] = [
                    ['Potential Duplicates', String(selectedFile.duplicate_count)],
                    ['Total Debit', formatIDR(selectedFile.debit_total)],
                    ['Total Credit', formatIDR(selectedFile.credit_total)],
                    ['Difference', formatIDR(Math.abs((selectedFile.debit_total || 0) - (selectedFile.credit_total || 0)))],
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
                          <div className="h-full rounded-full bg-neutral-800" style={{ width: `${selectedFile.rows_valid > 0 ? Math.max(validPct, 3) : 0}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] font-medium text-neutral-600">{validPct}% valid journal entries</p>
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
                    <p className="text-[11px] font-medium text-neutral-500">ℹ Extraction completed in {(selectedFile.extraction_duration_ms / 1000).toFixed(1)} seconds</p>
                  </div>
                )}
              </>
            )}
          </SourcePanel>

          {/* Data Quality Check */}
          <SourcePanel title="Data Quality Check" leading={<span className={PANEL_ICON_CHIP}><ShieldCheck size={17} /></span>}>
            {!selectedFile || previewRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-500">No data rows to check yet.</p>
            ) : (
              (() => {
                const total = previewRows.length;
                const withDate = previewRows.filter(r => !!r.tanggal).length;
                const withNumber = previewRows.filter(r => !!r.je_number).length;
                const balanced = previewRows.filter(r => Math.abs((r.debit_total || 0) - (r.credit_total || 0)) < 0.005).length;
                const duplicates = previewRows.filter(r => r.is_duplicate_candidate).length;
                const invalid = previewRows.filter(r => !r.is_valid).length;
                const checks = [
                  { label: 'Valid date format', val: `${withDate} / ${total}`, ok: withDate === total },
                  { label: 'JE number found', val: `${withNumber} / ${total}`, ok: withNumber === total },
                  { label: 'Debit = Credit (balanced)', val: `${balanced} / ${total}`, ok: balanced === total },
                  { label: 'Duplicate data', val: String(duplicates), ok: duplicates === 0 },
                  { label: 'Invalid entries', val: String(invalid), ok: invalid === 0 },
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
                        <div className={`h-full rounded-full ${okCount === checks.length ? 'bg-neutral-800' : 'bg-red-500'}`} style={{ width: `${okCount > 0 ? Math.max(okPct, 3) : 0}%` }} />
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
                const rules = selectedFile?.mapping_rules as Record<string, unknown> | null | undefined;
                const mapping = (rules && typeof rules.field_mapping === 'object' && rules.field_mapping ? rules.field_mapping : rules) as Record<string, unknown> | null | undefined;
                const detected = mapping ? Object.keys(JE_FIELD_LABELS).filter(k => !!mapping[k]) : [];
                if (detected.length === 0) {
                  return <p className="text-[11px] text-neutral-500">No field mapping saved for this file yet -- use the "Mapping Rules" button above.</p>;
                }
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {detected.map(k => (
                      <span key={k} className="flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                        <CheckCircle size={10} /> {JE_FIELD_LABELS[k]}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
          </SourcePanel>
        </div>
      </div>
    </div>
  );
}