'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import {
  ArrowUpTrayIcon, ArrowDownTrayIcon, PlusIcon, MagnifyingGlassIcon, FunnelIcon, ArrowsUpDownIcon,
  EllipsisHorizontalIcon, TrashIcon, CheckCircleIcon, ClockIcon, XCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import KpiCard from '@/components/shared/KpiCard';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useJeSourceFiles, useJeSourceRows, deleteJeSourceFile, promoteJeSourceFileToJournals,
  type BackendJeSourceFile, type JeSourceStatus,
} from '@/lib/journalEntryStore';
import ImportJournalModal from '@/app/transactions/journal-entry/components/ImportJournalModal';
import NewJournalEntryModal from '@/app/transactions/journal-entry/components/NewJournalEntryModal';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import JePagination, { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';

// =====================================================================
// Tab Source Data Journal Entry -- gaya disamakan dengan tab JE lain
// (je-card / je-input / je-select, header tabel sortable, JePagination).
// Data = DATA ASLI dari backend (journal_entry_import_v1.py), alurnya SAMA
// dengan Source Data Purchase:
//   1. Upload File -> ImportJournalModal -> POST /import/upload : backend
//      mencocokkan pola kolom ke Journal Entry Import Template company aktif,
//      lalu mencatat file (daftar file) + 1 baris staging per journal entry
//      (File Preview). BELUM ada draft JE di tahap ini.
//   2. Daftar file / File Preview / AI Extraction Summary / Data Quality Check
//      = GET /source-files & GET /source-rows (tetap ada setelah refresh),
//      difilter per company aktif (dropdown Switch Company).
//   3. "Create Journal" -> POST /source-files/{id}/promote-to-journals : entry
//      VALID naik jadi draft JE -> tab JE Transaction -> Journal Preview ->
//      Exceptions / Posted. Idempoten.
//   4. New Journal Entry = input manual (NewJournalEntryModal), langsung draft.
// =====================================================================

const PREVIEW_PAGE_SIZE = 20;
const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

// Label field di panel "Detected Fields" -- kunci = kunci `mapping_rules.columns` pada
// Journal Entry Import Template (format_type "flat_grouped_by_voucher").
const FIELD_LABELS: Record<string, string> = {
  voucher: 'JE Number / Voucher',
  tanggal: 'Journal Date',
  deskripsi: 'Description',
  kode_akun: 'Account Code',
  akun_deskripsi: 'Account Name',
  debit: 'Debit',
  credit: 'Credit',
  cost_center: 'Cost Center',
};

type ProcStatus = JeSourceStatus;

/** File dari backend + nama company aktif (kolom "Entity"; daftar sudah difilter per company). */
type SourceFile = BackendJeSourceFile & { entity_hint: string };

const fileTypeColors: Record<string, string> = {
  Excel: 'bg-emerald-100 text-emerald-700',
  CSV: 'bg-blue-100 text-blue-700',
  PDF: 'bg-red-100 text-red-700',
};

function ProcStatusBadge({ status }: { status: ProcStatus }) {
  const map: Record<ProcStatus, { cls: string; icon: React.ReactNode }> = {
    Completed: { cls: 'bg-green-50 text-green-700 border border-green-200', icon: <CheckCircleIcon className="w-3 h-3" /> },
    Processing: { cls: 'bg-blue-50 text-blue-700 border border-blue-200', icon: <ClockIcon className="w-3 h-3" /> },
    'Needs Review': { cls: 'bg-amber-50 text-amber-700 border border-amber-200', icon: <ExclamationTriangleIcon className="w-3 h-3" /> },
    Failed: { cls: 'bg-red-50 text-red-700 border border-red-200', icon: <XCircleIcon className="w-3 h-3" /> },
  };
  const { cls, icon } = map[status] ?? map['Needs Review'];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{status}
    </span>
  );
}

type SortField = 'uploaded_at' | 'file_name' | 'file_type' | 'entity_hint' | 'period_label' | 'rows_detected' | 'status_ekstraksi' | 'status_mapping' | 'confidence_score' | 'processed_by';

export default function JournalSourceData() {
  const router = useRouter();
  const { user } = useAuth();
  const clientId = user?.id ?? null; // id akun yang login -- pemilik draft JE (sama seperti tab JE lain)
  const createdByName = user?.nama || user?.username || 'System';
  // Company aktif (dropdown Switch Company) -- filter daftar file & key pencocokan template saat upload.
  const { activeClientId, activeClientName } = useActiveClient();

  const [showImportModal, setShowImportModal] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const handleUploadClick = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    setShowImportModal(true);
  };

  const { files: rawFiles, loading, error } = useJeSourceFiles(activeClientId);
  const sourceFiles: SourceFile[] = useMemo(
    () => rawFiles.map(f => ({ ...f, entity_hint: activeClientName || '—' })),
    [rawFiles, activeClientName],
  );

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [extractionFilter, setExtractionFilter] = useState('All');
  const [mappingFilter, setMappingFilter] = useState('All');
  const [sortField, setSortField] = useState<SortField>('uploaded_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let data = [...sourceFiles];
    if (q) data = data.filter(f => f.file_name.toLowerCase().includes(q) || f.entity_hint.toLowerCase().includes(q) || (f.period_label ?? '').toLowerCase().includes(q));
    if (typeFilter !== 'All') data = data.filter(f => f.file_type === typeFilter);
    if (extractionFilter !== 'All') data = data.filter(f => f.status_ekstraksi === extractionFilter);
    if (mappingFilter !== 'All') data = data.filter(f => f.status_mapping === mappingFilter);
    data.sort((a, b) => {
      const av = (a[sortField] ?? '') as string | number;
      const bv = (b[sortField] ?? '') as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [sourceFiles, search, typeFilter, extractionFilter, mappingFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / JE_PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * JE_PAGE_SIZE, pageSafe * JE_PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setCurrentPage(1);
  };

  // Simpan ID saja supaya selectedFile selalu dibaca ulang dari sourceFiles (data terbaru hasil refetch).
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile: SourceFile | null = sourceFiles.find(f => f.id === selectedFileId) ?? sourceFiles[0] ?? null;
  useEffect(() => {
    if (!selectedFileId && sourceFiles.length > 0) setSelectedFileId(sourceFiles[0].id);
    if (selectedFileId && !sourceFiles.some(f => f.id === selectedFileId)) setSelectedFileId(sourceFiles[0]?.id ?? null);
  }, [sourceFiles, selectedFileId]);

  // File yang baru saja muncul (hasil Upload File) otomatis terpilih, supaya preview-nya langsung tampil.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (loading) return;
    const baru = knownIds.current ? sourceFiles.find(f => !knownIds.current!.has(f.id)) : undefined;
    if (baru) setSelectedFileId(baru.id);
    knownIds.current = new Set(sourceFiles.map(f => f.id));
  }, [sourceFiles, loading]);

  const { rows: previewRows, loading: loadingRows } = useJeSourceRows(selectedFile?.id);
  // Entry yang akan ikut naik saat "Create Journal": valid, belum pernah dibuat, nomornya belum dipakai.
  const readyCount = previewRows.filter(r => r.is_valid && !r.draft_id && !r.is_duplicate_candidate).length;
  const createdCount = previewRows.filter(r => !!r.draft_id).length;

  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => { setPreviewPage(1); }, [selectedFile?.id]);
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPageSafe = Math.min(previewPage, previewTotalPages);
  const pagedPreviewRows = previewRows.slice((previewPageSafe - 1) * PREVIEW_PAGE_SIZE, previewPageSafe * PREVIEW_PAGE_SIZE);

  // Menu aksi "···" per baris file: hapus (soft-delete) source file.
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const handleDeleteFile = async (f: SourceFile) => {
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

  // "Create Journal": naikkan entry valid jadi draft JE -- idempoten.
  const [isPromoting, setIsPromoting] = useState(false);
  const handleCreateJournal = async () => {
    if (!selectedFile) return;
    setIsPromoting(true);
    try {
      const hasil = await promoteJeSourceFileToJournals(selectedFile.id);
      if (hasil.journals_created > 0) {
        const skipped = hasil.skipped_invalid + hasil.skipped_already_promoted + hasil.skipped_number_conflict;
        toast.success('Journal entries created', {
          description: `${hasil.journals_created} new journal ${hasil.journals_created === 1 ? 'entry' : 'entries'} from ${selectedFile.file_name}${skipped > 0 ? ` (${skipped} skipped)` : ''}.`,
          action: { label: 'Open JE Transaction', onClick: () => router.push('/transactions/journal-entry/transactions') },
        });
      } else {
        toast.info('No new journal entries', {
          description: `${hasil.skipped_already_promoted} already created, ${hasil.skipped_invalid} invalid, ${hasil.skipped_number_conflict} JE number conflicts.`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create journal entries');
    } finally {
      setIsPromoting(false);
    }
  };

  // Template yang kolomnya SAMA dengan yang dikenali importer lokal di ImportJournalModal
  // (JE Number, Date, Description, Source Type, Account Code, Account Name, Debit, Credit,
  // Cost Center). Tanggal ditulis teks YYYY-MM-DD supaya tidak diubah Excel & diterima backend.
  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Journal Template');
    sheet.columns = [
      { header: 'JE Number', key: 'je', width: 20 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Description', key: 'desc', width: 30 },
      { header: 'Source Type', key: 'src', width: 14 },
      { header: 'Account Code', key: 'code', width: 16 },
      { header: 'Account Name', key: 'name', width: 24 },
      { header: 'Debit', key: 'debit', width: 16 },
      { header: 'Credit', key: 'credit', width: 16 },
      { header: 'Cost Center', key: 'cc', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({ je: 'JE-2026-09-0100', date: '2026-09-18', desc: 'Office rent payment', src: 'Manual', code: '5-2000', name: 'Rent Expense', debit: 10000000, credit: 0, cc: '' });
    sheet.addRow({ je: 'JE-2026-09-0100', date: '2026-09-18', desc: 'Office rent payment', src: 'Manual', code: '1-1200', name: 'Bank BCA', debit: 0, credit: 10000000, cc: '' });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Journal_Data_Template.xlsx');
    toast.success('Excel template downloaded');
  };

  const handleExport = async () => {
    if (filtered.length === 0) {
      toast.info('Nothing to export', { description: 'No source files match the current filters.' });
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploadDate', width: 20 },
      { header: 'Source File', key: 'file', width: 32 },
      { header: 'Source Type', key: 'type', width: 12 },
      { header: 'Entity', key: 'entity', width: 24 },
      { header: 'Period', key: 'period', width: 14 },
      { header: 'Entries Detected', key: 'rows', width: 16 },
      { header: 'Total Debit', key: 'debit', width: 18 },
      { header: 'Total Credit', key: 'credit', width: 18 },
      { header: 'Extraction Status', key: 'statusEkstraksi', width: 16 },
      { header: 'Mapping Status', key: 'statusMapping', width: 16 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Processed By', key: 'processedBy', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    filtered.forEach(f => sheet.addRow({
      uploadDate: formatDateTime(f.uploaded_at), file: f.file_name, type: f.file_type ?? '-', entity: f.entity_hint || '-',
      period: f.period_label || '-', rows: f.rows_detected, debit: Number(f.debit_total), credit: Number(f.credit_total),
      statusEkstraksi: f.status_ekstraksi, statusMapping: f.status_mapping,
      confidence: f.confidence_score == null ? '-' : Number(f.confidence_score), processedBy: f.processed_by || '-',
    }));
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Journal_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Export complete', { description: `${filtered.length} row(s) downloaded as Excel.` });
  };

  const stats = {
    total: sourceFiles.length,
    processing: sourceFiles.filter(f => f.status_ekstraksi === 'Processing').length,
    completed: sourceFiles.filter(f => f.status_ekstraksi === 'Completed').length,
    review: sourceFiles.filter(f => f.status_ekstraksi === 'Needs Review').length,
  };

  const columns: { label: string; field: SortField }[] = [
    { label: 'Upload Date', field: 'uploaded_at' },
    { label: 'Source File', field: 'file_name' },
    { label: 'Type', field: 'file_type' },
    { label: 'Entity', field: 'entity_hint' },
    { label: 'Period', field: 'period_label' },
    { label: 'Entries', field: 'rows_detected' },
    { label: 'Extraction', field: 'status_ekstraksi' },
    { label: 'Mapping', field: 'status_mapping' },
    { label: 'Confidence', field: 'confidence_score' },
    { label: 'Processed By', field: 'processed_by' },
  ];

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button onClick={handleUploadClick} disabled={!clientId} className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50">
          <ArrowUpTrayIcon className="w-4 h-4" /> Upload File
        </button>
        <button onClick={handleDownloadTemplate} className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors">
          <ArrowDownTrayIcon className="w-4 h-4" /> Excel Template
        </button>
        <button onClick={handleExport} className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors">
          <ArrowDownTrayIcon className="w-4 h-4" /> Export
        </button>
        <button onClick={() => setShowNewModal(true)} disabled={!clientId} className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-2 hover:opacity-90 transition-colors disabled:opacity-50">
          <PlusIcon className="w-4 h-4" /> New Journal Entry
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Files Uploaded" value={String(stats.total)} icon="ArrowUpTrayIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Awaiting Processing" value={String(stats.processing)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
        <KpiCard title="Processed Successfully" value={String(stats.completed)} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Needs Review" value={String(stats.review)} icon="ExclamationTriangleIcon" iconColor="text-red-600" iconBg="bg-red-50" alert={stats.review > 0} />
      </div>

      {/* Filters */}
      <div className="je-card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input className="je-input pl-9" placeholder="Search by file name, entity, or period…" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <FunnelIcon className="w-4 h-4 text-muted-foreground" />
              <select className="je-select text-sm" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }}>
                {['All', 'Excel', 'CSV', 'PDF'].map(o => <option key={o} value={o}>{o === 'All' ? 'All Types' : o}</option>)}
              </select>
            </div>
            <select className="je-select text-sm" value={extractionFilter} onChange={e => { setExtractionFilter(e.target.value); setCurrentPage(1); }}>
              {['All', 'Completed', 'Processing', 'Needs Review', 'Failed'].map(o => <option key={o} value={o}>{o === 'All' ? 'All Extraction' : o}</option>)}
            </select>
            <select className="je-select text-sm" value={mappingFilter} onChange={e => { setMappingFilter(e.target.value); setCurrentPage(1); }}>
              {['All', 'Completed', 'Processing', 'Needs Review', 'Failed'].map(o => <option key={o} value={o}>{o === 'All' ? 'All Mapping' : o}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {sourceFiles.length} source files</p>
      </div>

      {/* File Table */}
      <div className="je-card overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map(col => (
                  <th key={col.field} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap" onClick={() => handleSort(col.field)}>
                    <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">Loading source files…</td></tr>
              ) : error ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-red-600 text-sm">{error}</td></tr>
              ) : !activeClientId ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">Select a company in the header to see its source files.</td></tr>
              ) : sourceFiles.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">No source files yet. Click Upload File to add one.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">No source files match your filters.</td></tr>
              ) : paginated.map(f => (
                <tr key={f.id} onClick={() => setSelectedFileId(f.id)} className={`table-row-hover cursor-pointer ${selectedFile?.id === f.id ? 'bg-primary/5' : ''}`}>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(f.uploaded_at)}</td>
                  <td className="px-4 py-3 text-xs font-medium text-primary whitespace-nowrap">{f.file_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${fileTypeColors[f.file_type ?? ''] || 'bg-gray-100 text-gray-700'}`}>{f.file_type ?? '-'}</span>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{f.entity_hint || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{f.period_label || '-'}</td>
                  <td className="px-4 py-3 text-xs font-semibold tabular-nums whitespace-nowrap">{Number(f.rows_detected).toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><ProcStatusBadge status={f.status_ekstraksi} /></td>
                  <td className="px-4 py-3 whitespace-nowrap"><ProcStatusBadge status={f.status_mapping} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {f.confidence_score == null ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${Number(f.confidence_score) >= 90 ? 'bg-emerald-500' : Number(f.confidence_score) >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Number(f.confidence_score))}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">{Number(f.confidence_score)}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{f.processed_by || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setMenuFileId(menuFileId === f.id ? null : f.id)} className="p-1 hover:bg-muted rounded transition-colors" aria-label="Actions">
                        <EllipsisHorizontalIcon className="w-4 h-4 text-muted-foreground" />
                      </button>
                      {menuFileId === f.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuFileId(null)} />
                          <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg py-1">
                            <button onClick={() => handleDeleteFile(f)} disabled={deletingFileId === f.id} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left disabled:opacity-50">
                              <TrashIcon className="w-3.5 h-3.5" /> {deletingFileId === f.id ? 'Deleting…' : 'Delete file'}
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
        <JePagination page={pageSafe} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setCurrentPage} itemLabel="source files" />
      </div>

      {/* Detail Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* File Preview */}
        <div className="xl:col-span-1 je-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">File Preview</h3>
            {selectedFile && previewRows.length > 0 && (
              <button
                onClick={handleCreateJournal}
                disabled={isPromoting || readyCount === 0}
                title={readyCount === 0 ? 'No valid entries left to create for this file' : 'Turn valid entries into journal entries in the JE Transaction tab'}
                className="flex items-center gap-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded-lg px-2.5 py-1 hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {isPromoting ? 'Creating…' : `Create Journal${readyCount > 0 ? ` (${readyCount})` : ''}`}
              </button>
            )}
          </div>
          {selectedFile ? (
            <div className="flex items-center gap-2 mb-3 p-2 bg-muted/30 rounded-lg">
              <div className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold ${fileTypeColors[selectedFile.file_type ?? ''] || 'bg-muted text-muted-foreground'}`}>{(selectedFile.file_type ?? '-').slice(0, 3).toUpperCase()}</div>
              <div>
                <p className="text-xs font-semibold text-foreground">{selectedFile.file_name}</p>
                <p className="text-[11px] text-muted-foreground">{selectedFile.rows_detected} journal entries · Uploaded {formatDateTime(selectedFile.uploaded_at)}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">No file selected.</p>
          )}
          {selectedFile && loadingRows && previewRows.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Loading preview…</p>
          )}
          {selectedFile && !loadingRows && previewRows.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {selectedFile.status_ekstraksi === 'Failed'
                ? 'Extraction failed for this file, so there is nothing to preview.'
                : 'No journal entries were extracted from this file. A matching column-pattern template may be missing for this company and format.'}
            </p>
          )}
          {selectedFile && previewRows.length > 0 && (
            <>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['No', 'Date', 'JE No.', 'Description', 'Lines', 'Debit', 'Credit', 'Status'].map(h => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreviewRows.map(r => (
                      <tr key={r.id} className="border-b border-border/50" title={r.validation_notes ?? undefined}>
                        <td className="py-1.5 px-1.5 text-muted-foreground">{r.row_no}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">{r.tanggal ? formatDate(r.tanggal) : '-'}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap font-mono">{r.je_number || '-'}</td>
                        <td className="py-1.5 px-1.5 max-w-[160px] truncate">{r.description || '-'}</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums">{r.line_count}</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums whitespace-nowrap">{fmt(Number(r.debit_total))}</td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums whitespace-nowrap">{fmt(Number(r.credit_total))}</td>
                        <td className="py-1.5 px-1.5 whitespace-nowrap">
                          {r.draft_id ? (
                            <span className="text-emerald-700">Created</span>
                          ) : !r.is_valid ? (
                            <span className="text-red-600">Invalid</span>
                          ) : r.is_duplicate_candidate ? (
                            <span className="text-amber-600">Duplicate</span>
                          ) : (
                            <span className="text-blue-700">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <JePagination page={previewPageSafe} pageSize={PREVIEW_PAGE_SIZE} total={previewRows.length} onPageChange={setPreviewPage} itemLabel="rows" />
            </>
          )}
        </div>

        {/* AI Extraction Summary */}
        <div className="je-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-[10px] font-bold text-purple-600">AI</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">AI Extraction Summary</h3>
          </div>
          {!selectedFile ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Select or upload a file to see its summary.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {selectedFile.template_id ? `Matched a saved column-pattern template${selectedFile.ai_model_version ? ` · Model: ${selectedFile.ai_model_version}` : ''}` : 'No matching template was found for this file.'}
              </p>
              <div className="space-y-2 text-xs">
                {[
                  ['Journal Entries Detected', String(selectedFile.rows_detected)],
                  ['Valid Entries', String(selectedFile.rows_valid)],
                  ['Invalid Entries', String(selectedFile.rows_invalid)],
                  ['Already Created', String(createdCount)],
                  ['Potential Duplicates', String(selectedFile.duplicate_count)],
                  ['Total Debit', fmt(Number(selectedFile.debit_total))],
                  ['Total Credit', fmt(Number(selectedFile.credit_total))],
                  ['Difference (Debit − Credit)', fmt(Number(selectedFile.debit_total) - Number(selectedFile.credit_total))],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-foreground tabular-nums">{v}</span>
                  </div>
                ))}
              </div>
              {selectedFile.extraction_duration_ms != null && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[11px] text-muted-foreground">ℹ Extraction finished in {(selectedFile.extraction_duration_ms / 1000).toFixed(1)} seconds</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Data Quality Check */}
        <div className="je-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Data Quality Check</h3>
          {!selectedFile || previewRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No entries to check yet.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {(() => {
                const total = previewRows.length;
                const withDate = previewRows.filter(r => !!r.tanggal).length;
                const withRef = previewRows.filter(r => !!r.je_number).length;
                const multiLine = previewRows.filter(r => r.line_count >= 2).length;
                const balanced = previewRows.filter(r => Math.abs(Number(r.debit_total) - Number(r.credit_total)) < 0.01 && Number(r.debit_total) > 0).length;
                const dup = previewRows.filter(r => r.is_duplicate_candidate).length;
                const invalid = previewRows.filter(r => !r.is_valid).length;
                return [
                  { label: 'Valid date format', val: `${withDate} / ${total}`, ok: withDate === total },
                  { label: 'JE number found', val: `${withRef} / ${total}`, ok: withRef === total },
                  { label: 'At least 2 lines per entry', val: `${multiLine} / ${total}`, ok: multiLine === total },
                  { label: 'Debit equals credit', val: `${balanced} / ${total}`, ok: balanced === total },
                  { label: 'Duplicate JE numbers', val: String(dup), ok: dup === 0 },
                  { label: 'Invalid entries', val: String(invalid), ok: invalid === 0 },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${item.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="text-muted-foreground">{item.label}</span>
                    </div>
                    <span className={`font-medium ${item.ok ? 'text-foreground' : 'text-red-600'}`}>{item.val}</span>
                  </div>
                ));
              })()}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-foreground mb-1.5">Detected Fields</p>
            {(() => {
              const columns = (selectedFile?.mapping_rules as { columns?: Record<string, string> } | null | undefined)?.columns;
              const detected = columns ? Object.keys(columns) : [];
              if (detected.length === 0) return <p className="text-[11px] text-muted-foreground">No field mapping detected for this file yet.</p>;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {detected.map(key => (
                    <span key={key} className="flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full" title={`File column: ${columns![key]}`}>
                      <CheckCircleIcon className="w-3 h-3" /> {FIELD_LABELS[key] ?? key}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {showImportModal && clientId && (
        <ImportJournalModal clientId={clientId} createdByName={createdByName} onClose={() => setShowImportModal(false)} />
      )}
      {showNewModal && clientId && (
        <NewJournalEntryModal clientId={clientId} createdByName={createdByName} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}