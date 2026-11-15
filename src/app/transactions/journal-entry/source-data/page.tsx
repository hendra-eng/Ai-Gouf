'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, FileText, MoreHorizontal, Eye, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import SourceKpiTile, { type KpiTone } from '@/components/shared/ProgressKpiTile';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { useJeSourceRecords, useJeDrafts, listJeImportTemplates, type BackendJeSourceRecord, type BackendJeDraft } from '@/lib/journalEntryStore';
import { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';
import ImportJournalModal, { HEADER_ALIASES, JE_REQUIRED_COLUMNS } from '@/app/transactions/journal-entry/components/ImportJournalModal';
import MappingRulesModal from '@/app/transactions/components/MappingRulesModal';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Label field sistem untuk bagian "Generic Column Mapping" di modal Mapping Rules.
const JE_FIELD_LABELS: Record<string, string> = {
  je_number: 'JE Number', entry_date: 'Date', description: 'Description', source_type: 'Source Type',
  account_code: 'Account Code', account_name: 'Account Name', debit: 'Debit', credit: 'Credit', cost_center: 'Cost Center',
};
const JE_MAPPING_COLUMNS = Object.entries(HEADER_ALIASES).map(([key, accepted]) => ({
  field: JE_FIELD_LABELS[key] || key, accepted, required: JE_REQUIRED_COLUMNS.includes(key),
}));

type SourceStatus = 'Mapped' | 'Pending Mapping' | 'Validation Error' | 'Imported';
type SyncStatus = 'Synced' | 'Pending Sync' | 'Sync Failed' | 'Manual';

interface SourceRecord {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceDate: string;
  description: string;
  amount: number;
  currency: string;
  relatedAccount: string;
  accountCode: string;
  sourceStatus: SourceStatus;
  jeReference: string | null;
  createdDate: string;
  syncStatus: SyncStatus;
  mappingStatus: SourceStatus;
  vendor?: string;
}

/** jeReference TIDAK disimpan sebagai kolom di source_records (hindari FK
 *  balik/data yang bisa tidak sinkron) -- di-derive dengan mencari draft
 *  yang source_record_id-nya menunjuk ke baris ini, pola sama dengan
 *  last_used_at di financial_transaction_sales_import_templates. */
function petakanDariBackend(r: BackendJeSourceRecord, draftByLastUpdated: Map<string, BackendJeDraft>): SourceRecord {
  const draft = draftByLastUpdated.get(r.id);
  return {
    id: r.id,
    sourceId: r.source_code,
    sourceType: r.source_type,
    sourceDate: r.source_date || '',
    description: r.description || '',
    amount: r.amount,
    currency: r.currency,
    relatedAccount: r.related_account_name || '-',
    accountCode: r.related_account_code || '-',
    sourceStatus: (r.mapping_status as SourceStatus) || 'Imported',
    jeReference: draft ? draft.je_number : null,
    createdDate: (r.created_at || '').slice(0, 10),
    syncStatus: (r.sync_status as SyncStatus) || 'Manual',
    mappingStatus: (r.mapping_status as SourceStatus) || 'Imported',
    vendor: r.party_name || undefined,
  };
}

const sourceTypeColors: Record<string, string> = {
  Sales: 'bg-emerald-100 text-emerald-700',
  Purchase: 'bg-blue-100 text-blue-700',
  Payroll: 'bg-purple-100 text-purple-700',
  Bank: 'bg-cyan-100 text-cyan-700',
  Cash: 'bg-teal-100 text-teal-700',
  Expense: 'bg-orange-100 text-orange-700',
  Inventory: 'bg-yellow-100 text-yellow-700',
  'Fixed Assets': 'bg-indigo-100 text-indigo-700',
  Tax: 'bg-red-100 text-red-700',
  Manual: 'bg-slate-100 text-slate-700',
};

// Badge status -- bentuk pil, ukuran & warna sama dengan tabel Source Data Purchase/Sales.
const BADGE_BASE = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';
const SOURCE_STATUS_CLS: Record<SourceStatus, string> = {
  Mapped: 'bg-emerald-100 text-emerald-700',
  'Pending Mapping': 'bg-amber-100 text-amber-700',
  'Validation Error': 'bg-red-100 text-red-700',
  Imported: 'bg-blue-100 text-blue-700',
};
const SYNC_STATUS_CLS: Record<SyncStatus, string> = {
  Synced: 'bg-emerald-100 text-emerald-700',
  'Pending Sync': 'bg-amber-100 text-amber-700',
  'Sync Failed': 'bg-red-100 text-red-700',
  Manual: 'bg-slate-100 text-slate-600',
};

function SourceStatusBadge({ status }: { status: SourceStatus }) {
  return <span className={`${BADGE_BASE} ${SOURCE_STATUS_CLS[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>;
}

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <span className={`${BADGE_BASE} ${SYNC_STATUS_CLS[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>;
}

// Panel putih dengan header terpisah garis -- sama dengan SourcePanel di Purchase/Sales.
function SourcePanel({ title, leading, action, children }: {
  title: string; leading?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
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
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((x, y) => x - y);
  const out: (number | '…')[] = [];
  sorted.forEach((n, idx) => {
    if (idx > 0 && n - sorted[idx - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export default function SourceDataPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { records: backendRecords, loading } = useJeSourceRecords(clientId);
  const { drafts } = useJeDrafts(clientId);

  const draftBySourceRecordId = useMemo(() => {
    const map = new Map<string, BackendJeDraft>();
    drafts.forEach(d => { if (d.source_record_id) map.set(d.source_record_id, d); });
    return map;
  }, [drafts]);

  const sourceData = useMemo(
    () => backendRecords.map(r => petakanDariBackend(r, draftBySourceRecordId)),
    [backendRecords, draftBySourceRecordId],
  );

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField] = useState<keyof SourceRecord>('sourceDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(JE_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<SourceRecord | null>(null);
  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  useEffect(() => { setCurrentPage(1); }, [search, typeFilter, statusFilter, sortField, sortDir, pageSize]);

  const sourceTypes = ['All', 'Sales', 'Purchase', 'Payroll', 'Bank', 'Cash', 'Expense', 'Inventory', 'Fixed Assets', 'Tax', 'Manual'];
  const statuses = ['All', 'Mapped', 'Pending Mapping', 'Validation Error', 'Imported'];

  const filtered = useMemo(() => {
    let data = [...sourceData];
    if (search) data = data.filter(r => r.description.toLowerCase().includes(search.toLowerCase()) || r.sourceId.toLowerCase().includes(search.toLowerCase()) || (r.vendor || '').toLowerCase().includes(search.toLowerCase()));
    if (typeFilter !== 'All') data = data.filter(r => r.sourceType === typeFilter);
    if (statusFilter !== 'All') data = data.filter(r => r.sourceStatus === statusFilter);
    data.sort((a, b) => {
      const av = a[sortField] as string | number;
      const bv = b[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [sourceData, search, typeFilter, statusFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));

  const handleSort = (field: keyof SourceRecord) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setCurrentPage(1);
  };

  const summaryStats = useMemo(() => ({
    total: sourceData.length,
    mapped: sourceData.filter(r => r.sourceStatus === 'Mapped').length,
    pending: sourceData.filter(r => r.sourceStatus === 'Pending Mapping' || r.sourceStatus === 'Imported').length,
    errors: sourceData.filter(r => r.sourceStatus === 'Validation Error').length,
    totalAmount: sourceData.reduce((s, r) => s + r.amount, 0),
  }), [sourceData]);

  const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

  // ── Action bar (pola sama dengan tab Source Data Sales) ──
  // Upload File = ImportJournalModal yang sama dengan tab Transactions
  // (template backend dulu, fallback parsing kolom generik di browser).
  const { activeClientId } = useActiveClient();
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

  // Export = semua baris hasil filter/sort saat ini, bukan cuma 1 halaman.
  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Source ID', key: 'sourceId', width: 18 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Description', key: 'description', width: 34 },
      { header: 'Vendor / Party', key: 'vendor', width: 22 },
      { header: 'Amount', key: 'amount', width: 16 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Account Code', key: 'code', width: 14 },
      { header: 'Account Name', key: 'account', width: 24 },
      { header: 'JE Reference', key: 'je', width: 18 },
      { header: 'Sync', key: 'sync', width: 14 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    filtered.forEach(r => sheet.addRow({
      sourceId: r.sourceId, type: r.sourceType, date: r.sourceDate, description: r.description, vendor: r.vendor || '-',
      amount: r.amount, currency: r.currency, code: kodeAkun(r.accountCode), account: r.relatedAccount,
      je: r.jeReference || '-', sync: r.syncStatus, status: r.sourceStatus,
    }));
    sheet.getColumn('amount').numFmt = '#,##0';
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), `Journal_Entry_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Export successful', { description: `${filtered.length} rows downloaded as Excel.` });
  };

  // Tombol aksi -- ditaruh di baris yang sama dengan tab (sama dengan Source Data Purchase/Sales).
  const actionBar = (
    <div className="flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap">
      <button onClick={() => setShowImport(true)} disabled={!clientId} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary disabled:opacity-50">
        <Upload size={13} /> Upload File
      </button>
      <button onClick={handleDownloadTemplate} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Download size={13} /> Excel Template
      </button>
      <button onClick={handleExport} disabled={filtered.length === 0} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary disabled:opacity-50">
        <Download size={13} /> Export
      </button>
      <button onClick={() => setShowMapping(true)} className="btn-primary text-xs py-1.5 gap-1.5">
        <Settings size={13} /> Mapping Rules
      </button>
    </div>
  );

  const pctOf = (n: number) => (summaryStats.total > 0 ? Math.round((n / summaryStats.total) * 100) : 0);
  const kpiTiles: { label: string; value: number; sub: string; tone: KpiTone; icon: React.ElementType }[] = [
    { label: 'Total Sources', value: summaryStats.total, sub: 'All source records', tone: 'slate', icon: Upload },
    { label: 'Mapped to JE', value: summaryStats.mapped, sub: `${pctOf(summaryStats.mapped)}% mapped`, tone: 'green', icon: CheckCircle },
    { label: 'Pending / Imported', value: summaryStats.pending, sub: 'Awaiting mapping', tone: 'amber', icon: Clock },
    { label: 'Validation Errors', value: summaryStats.errors, sub: 'Require attention', tone: 'sky', icon: AlertTriangle },
  ];

  const columns = [
    { label: 'Source ID', field: 'sourceId', align: 'left' },
    { label: 'Type', field: 'sourceType', align: 'left' },
    { label: 'Date', field: 'sourceDate', align: 'left' },
    { label: 'Description', field: 'description', align: 'left' },
    { label: 'Amount', field: 'amount', align: 'right' },
    { label: 'Account', field: 'relatedAccount', align: 'left' },
    { label: 'JE Reference', field: 'jeReference', align: 'left' },
    { label: 'Sync', field: 'syncStatus', align: 'left' },
    { label: 'Status', field: 'sourceStatus', align: 'left' },
  ];

  return (
    <div className="fade-in">
      <JournalEntryTabs activeTab="source" actions={actionBar} />
      {showImport && clientId && (
        <ImportJournalModal
          clientId={clientId}
          createdByName={user?.nama || user?.username || 'System'}
          onClose={() => setShowImport(false)}
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

      <div className="pt-5 space-y-5">
        {/* KPI Cards -- 4 kartu, ukuran & posisi sama dengan Source Data Purchase */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiTiles.map(k => (
            <SourceKpiTile
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.sub}
              pct={pctOf(k.value)}
              pctLabel="of all sources"
              tone={k.tone}
              icon={k.icon}
            />
          ))}
        </div>

        {/* Source Record Table */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border flex flex-col gap-3">
            <div>
              <h3 className="text-2xl font-bold text-foreground">Journal Source Record List</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filtered.length === 0
                  ? `Showing 0 of ${sourceData.length} records`
                  : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} records`}
              </p>
            </div>
            {/* Filter bar -- dropdown di kiri, kolom cari di kanan (sama dengan Purchase) */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={sourceTypes.map(t => ({ value: t, label: t === 'All' ? 'All Types' : t }))}
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={statuses.map(st => ({ value: st, label: st === 'All' ? 'All Statuses' : st }))}
              />
              <div className="relative ml-auto w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by source ID, description, or vendor…"
                  className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="bg-[#8FE3B5]">
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field as keyof SourceRecord)}
                      className={`py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32] cursor-pointer select-none hover:text-[#064E3B] ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-60" />
                      </span>
                    </th>
                  ))}
                  <th className="text-left py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">Loading source records…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">No source records match your filters.</td></tr>
                ) : paginated.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedRow(row)}
                    className={`border-b border-slate-400/80 cursor-pointer transition-colors text-xs ${selectedRow?.id === row.id ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
                  >
                    <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{row.sourceId}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`${BADGE_BASE} ${sourceTypeColors[row.sourceType] || 'bg-gray-100 text-gray-700'}`}>{row.sourceType}</span>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.sourceDate}</td>
                    <td className="py-2 px-2 text-foreground max-w-xs truncate" title={row.description}>{row.description}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(row.amount)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="text-muted-foreground">{kodeAkun(row.accountCode)}</span>
                      <span className="mx-1 text-border">·</span>
                      <span className="text-foreground">{row.relatedAccount}</span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {row.jeReference
                        ? <span className="font-medium text-primary">{row.jeReference}</span>
                        : <span className="text-muted-foreground">Not mapped</span>}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap"><SyncStatusBadge status={row.syncStatus} /></td>
                    <td className="py-2 px-2 whitespace-nowrap"><SourceStatusBadge status={row.sourceStatus} /></td>
                    <td className="py-2 px-2">
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuRowId(menuRowId === row.id ? null : row.id)}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={14} className="text-muted-foreground" />
                        </button>
                        {menuRowId === row.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuRowId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg py-1">
                              <button
                                onClick={() => { setSelectedRow(row); setMenuRowId(null); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left"
                              >
                                <Eye size={12} /> View detail
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
                <span>Rows per page</span>
                <select value={pageSize} onChange={ev => setPageSize(Number(ev.target.value))} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                </span>{' '}
                of <span className="font-semibold text-foreground">{filtered.length}</span> source records
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Detail Panel -- gaya SourcePanel Purchase */}
        {selectedRow && (
          <SourcePanel
            title={selectedRow.sourceId}
            leading={
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]"><FileText size={17} /></span>
            }
            action={
              <button onClick={() => setSelectedRow(null)} className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-slate-600 hover:bg-slate-100">
                <X size={13} /> Close
              </button>
            }
          >
            <p className="mb-4 text-sm text-muted-foreground">{selectedRow.description}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Source Type', value: selectedRow.sourceType },
                { label: 'Source Date', value: selectedRow.sourceDate },
                { label: 'Amount', value: fmt(selectedRow.amount) },
                { label: 'Currency', value: selectedRow.currency },
                { label: 'Account Code', value: kodeAkun(selectedRow.accountCode) },
                { label: 'Account Name', value: selectedRow.relatedAccount },
                { label: 'JE Reference', value: selectedRow.jeReference || 'Not mapped' },
                { label: 'Sync Status', value: selectedRow.syncStatus },
                { label: 'Mapping Status', value: selectedRow.mappingStatus },
                { label: 'Created Date', value: selectedRow.createdDate },
                ...(selectedRow.vendor ? [{ label: 'Vendor / Party', value: selectedRow.vendor }] : []),
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            {selectedRow.sourceStatus === 'Validation Error' && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5">
                <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700">This source record has a validation error. The associated Journal Entry may have a debit/credit mismatch. Please review the depreciation schedule and correct the amounts before reprocessing.</p>
              </div>
            )}
          </SourcePanel>
        )}
      </div>
    </div>
  );
}
