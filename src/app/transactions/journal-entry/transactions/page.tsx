'use client';

import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Search, ArrowUpDown, Eye, X, Plus, Upload,
  Clock, CheckCircle, Send, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import NewJournalEntryModal from '@/app/transactions/journal-entry/components/NewJournalEntryModal';
import ImportJournalModal from '@/app/transactions/journal-entry/components/ImportJournalModal';
import JeKpiTile, { type KpiTone } from '@/app/transactions/journal-entry/components/JeKpiTile';
import JeFilterSelect from '@/app/transactions/journal-entry/components/JeFilterSelect';
import JeTablePagination from '@/app/transactions/journal-entry/components/JeTablePagination';
import { buildJeListReport, buildJeDetailReport, type JePrintRow } from '@/app/transactions/journal-entry/components/jePrintReports';
import PrintMenu from '@/components/shared/PrintMenu';
import { printReport, type PrintFormat } from '@/lib/printExport';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { useJeDrafts, useJeDraftLines, listJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiEntry, type JeUiStatus } from '@/lib/journalEntryStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

type JEStatus = JeUiStatus;

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// Warna badge status -- sama dengan STATUS_STYLE (Overview / Posted / Source Data).
const statusColors: Record<JEStatus, string> = {
  draft: 'bg-slate-200 text-slate-800 border-slate-400',
  pending: 'bg-amber-100 text-amber-900 border-amber-300',
  approved: 'bg-blue-100 text-blue-800 border-blue-300',
  posted: 'bg-teal-100 text-teal-800 border-teal-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  exception: 'bg-orange-100 text-orange-800 border-orange-300',
};

const statusLabels: Record<JEStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
};

const STATUS_ORDER: JEStatus[] = ['draft', 'pending', 'approved', 'posted', 'rejected', 'exception'];

const TABLE_COLUMNS: { label: string; field: string; align?: 'right' }[] = [
  { label: 'JE Number', field: 'jeNumber' },
  { label: 'Date', field: 'date' },
  { label: 'Description', field: 'description' },
  { label: 'Source', field: 'sourceType' },
  { label: 'Debit', field: 'totalDebit', align: 'right' },
  { label: 'Credit', field: 'totalCredit', align: 'right' },
  { label: 'Status', field: 'status' },
  { label: 'Period', field: 'period' },
  { label: 'Created By', field: 'createdBy' },
];

export default function JournalEntryTransactionPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Pagination (opsi & default sama dengan Sales Transaction)
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Drawer
  const [selectedRow, setSelectedRow] = useState<JeUiEntry | null>(null);
  const [drawerTab, setDrawerTab] = useState<'detail' | 'lines'>('detail');
  const { lines: selectedLines } = useJeDraftLines(selectedRow?.id);
  const mappedLines = useMemo(() => selectedLines.map(mapJeDraftLineToUi), [selectedLines]);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const { clients, activeClientId, activeClientName } = useActiveClient();
  const companyName = clients.find(c => c.id === activeClientId)?.companyName || activeClientName || undefined;
  const printedBy = user?.nama || user?.username || undefined;

  const sourceTypes = useMemo(() => Array.from(new Set(journalEntries.map(t => t.sourceType))), [journalEntries]);
  const periods = useMemo(() => Array.from(new Set(journalEntries.map(t => t.period))), [journalEntries]);

  const filtered = useMemo(() => {
    let data = [...journalEntries];
    if (search) data = data.filter(r =>
      r.jeNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.sourceReference.toLowerCase().includes(search.toLowerCase())
    );
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (sourceFilter !== 'All') data = data.filter(r => r.sourceType === sourceFilter);
    if (periodFilter !== 'All') data = data.filter(r => r.period === periodFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [journalEntries, search, statusFilter, sourceFilter, periodFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearch(''); setStatusFilter('All'); setSourceFilter('All'); setPeriodFilter('All');
    setCurrentPage(1);
  };

  const openDetail = (row: JeUiEntry) => {
    setSelectedRow(row);
    setDrawerTab('detail');
  };

  // Print daftar = semua JE yang lolos filter (bukan cuma halaman aktif), lengkap dengan baris jurnalnya.
  const printList = async (format: PrintFormat) => {
    if (filtered.length === 0) {
      toast.error('No journal entries to print.');
      return;
    }
    const rows: JePrintRow[] = await Promise.all(filtered.map(async (je) => ({
      ...je,
      lines: (await listJeDraftLines(je.id)).map(mapJeDraftLineToUi),
    })));
    await printReport(buildJeListReport(rows, companyName, printedBy), format);
    toast.success('File ready', { description: `${rows.length} journal entries printed.` });
  };

  const printDetail = async (format: PrintFormat) => {
    if (!selectedRow) return;
    await printReport(buildJeDetailReport(selectedRow, mappedLines, companyName, printedBy), format);
  };

  // KPI: 4 kartu (count + total debit + proporsi terhadap seluruh JE) -- pola sama dengan Sales.
  const kpiTiles = useMemo(() => {
    const total = journalEntries.length;
    const by = (s: JEStatus) => journalEntries.filter(t => t.status === s);
    const sumDebit = (rows: JeUiEntry[]) => rows.reduce((acc, r) => acc + r.totalDebit, 0);
    const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const defs: { label: string; rows: JeUiEntry[]; tone: KpiTone; icon: React.ElementType }[] = [
      { label: 'Pending', rows: by('pending'), tone: 'slate', icon: Clock },
      { label: 'Approved', rows: by('approved'), tone: 'amber', icon: ShieldCheck },
      { label: 'Posted', rows: by('posted'), tone: 'green', icon: CheckCircle },
      { label: 'Exceptions', rows: by('exception'), tone: 'sky', icon: AlertTriangle },
    ];
    return defs.map(d => ({ ...d, count: d.rows.length, amount: fmt(sumDebit(d.rows)), pct: pctOf(d.rows.length) }));
  }, [journalEntries]);

  return (
    <div className="fade-in">
      <JournalEntryTabs
        activeTab="transaction"
        actions={
          <>
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50"
            >
              <Upload size={14} />
              Import
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700"
            >
              <Plus size={14} /> New Journal Entry
            </button>
          </>
        }
      />

      <div className="pt-5 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiTiles.map(k => (
            <JeKpiTile
              key={k.label}
              label={k.label}
              count={k.count}
              amount={k.amount}
              pct={k.pct}
              pctLabel="of total entries"
              tone={k.tone}
              icon={k.icon}
            />
          ))}
        </div>

        {/* Filters */}
        <div className="card p-3 relative">
          <div className="flex items-center gap-2 flex-wrap">
            <JeFilterSelect
              value={statusFilter}
              onChange={v => { setStatusFilter(v); setCurrentPage(1); }}
              options={[{ value: 'All', label: 'All Status' }, ...STATUS_ORDER.map(s => ({ value: s, label: statusLabels[s] }))]}
            />
            <JeFilterSelect
              value={sourceFilter}
              onChange={v => { setSourceFilter(v); setCurrentPage(1); }}
              options={[{ value: 'All', label: 'All Sources' }, ...sourceTypes.map(s => ({ value: s, label: s }))]}
            />
            <JeFilterSelect
              value={periodFilter}
              onChange={v => { setPeriodFilter(v); setCurrentPage(1); }}
              options={[{ value: 'All', label: 'All Periods' }, ...periods.map(p => ({ value: p, label: p }))]}
            />

            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-700" />
              <input
                type="text"
                value={search}
                onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
                placeholder="Search JE number, description, or source…"
                className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-white text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700"
              />
            </div>

            {/* Baris kedua: aksi Reset, Print All (rata kanan) */}
            <div className="flex w-full items-center justify-end gap-2">
              <button onClick={resetFilters} className="text-xs font-medium text-neutral-700 hover:underline">Reset</button>
              <PrintMenu onPrint={printList} label="Print All" disabled={loading || filtered.length === 0} />
            </div>
          </div>
        </div>

        {/* Table + Drawer */}
        <div className="flex gap-4">
          <div className={`card overflow-hidden flex-1 min-w-0 transition-all ${selectedRow ? 'xl:w-auto' : 'w-full'}`}>
            <div className="px-0 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-foreground">Journal Entry Transactions</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {loading
                    ? 'Loading…'
                    : filtered.length === 0
                    ? 'Showing 0 of 0 journal entries'
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} journal entries`}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1100px]">
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((col, i) => (
                      <th
                        key={col.field}
                        className={`py-3 ${i === 0 ? 'pl-3 pr-2' : 'px-2'} ${col.align === 'right' ? 'text-right' : 'text-left'} text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.field)}
                          className={`inline-flex items-center gap-1 select-none hover:text-neutral-600 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {col.label}
                          <ArrowUpDown size={11} className={sortField === col.field ? 'opacity-100' : 'opacity-50'} />
                        </button>
                      </th>
                    ))}
                    <th className="text-left py-3 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">Loading journal entries…</td></tr>
                  )}
                  {!loading && paginated.length === 0 && (
                    <tr><td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">No journal entries match your filters.</td></tr>
                  )}
                  {!loading && paginated.map(row => (
                    <tr
                      key={row.id}
                      onClick={() => openDetail(row)}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedRow?.id === row.id ? '[&>td]:bg-neutral-100' : ''}`}
                    >
                      <td className="py-2 pl-3 pr-2 whitespace-nowrap text-blue-700 font-medium">{row.jeNumber}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.date}</td>
                      <td className="py-2 px-2 max-w-[200px] truncate text-muted-foreground" title={row.description}>{row.description}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.sourceType}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right">{fmt(row.totalDebit)}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right">{fmt(row.totalCredit)}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[row.status] || 'bg-neutral-100 text-neutral-600 border-neutral-300'}`}>{statusLabels[row.status] || row.status}</span>
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.period}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.createdBy}</td>
                      <td className="py-2 px-2" onClick={ev => ev.stopPropagation()}>
                        <button onClick={() => openDetail(row)} aria-label="View" className="p-1 hover:bg-muted rounded">
                          <Eye size={13} className="text-muted-foreground" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <JeTablePagination
              page={pageSafe}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={n => { setPageSize(n); setCurrentPage(1); }}
            />
          </div>

          {/* Detail Drawer */}
          {selectedRow && (
            <div className="w-80 flex-shrink-0 card p-4 space-y-3 self-start sticky top-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{selectedRow.jeNumber}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColors[selectedRow.status]}`}>{statusLabels[selectedRow.status]}</span>
                </div>
                <button onClick={() => setSelectedRow(null)} aria-label="Close" className="p-1 hover:bg-muted rounded"><X size={14} /></button>
              </div>
              <p className="text-xs text-muted-foreground">{selectedRow.description}</p>
              <p className="text-xs text-muted-foreground">{selectedRow.date}</p>

              <div className="flex gap-1 border-b border-border pb-2">
                {([
                  { key: 'detail', label: 'Detail' },
                  { key: 'lines', label: 'Journal Lines' },
                ] as const).map(dt => (
                  <button key={dt.key} onClick={() => setDrawerTab(dt.key)} className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${drawerTab === dt.key ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>{dt.label}</button>
                ))}
              </div>

              {drawerTab === 'detail' && (
                <div className="space-y-2 text-xs">
                  {[
                    ['Source', selectedRow.sourceType],
                    ['Source Ref', selectedRow.sourceReference || '—'],
                    ['Period', selectedRow.period],
                    ['Posting Date', selectedRow.postingDate || '—'],
                    ['Currency', selectedRow.currency],
                    ['Created By', selectedRow.createdBy],
                    ['Reviewed By', selectedRow.reviewedBy || '—'],
                    ['Approved By', selectedRow.approvedBy || '—'],
                    ['Created Date', selectedRow.createdDate || '—'],
                    ['Last Updated', selectedRow.lastUpdated || '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-foreground text-right break-words">{v}</span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Debit</span>
                      <span>{fmt(selectedRow.totalDebit)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-foreground">
                      <span className="text-muted-foreground">Total Credit</span>
                      <span>{fmt(selectedRow.totalCredit)}</span>
                    </div>
                  </div>
                  {selectedRow.notes && (
                    <div className="bg-neutral-100 border border-neutral-300 rounded-lg px-3 py-2">
                      <p className="text-xs text-neutral-700">{selectedRow.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {drawerTab === 'lines' && (
                <div className="text-xs">
                  {mappedLines.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No journal lines.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {mappedLines.map(line => (
                        <div key={line.id} className="py-2 space-y-0.5">
                          <p className="font-medium text-foreground">{kodeAkun(line.accountCode)} · {line.accountName}</p>
                          {line.description && <p className="text-[11px] text-muted-foreground">{line.description}</p>}
                          <div className="flex justify-between pt-0.5">
                            <span className="text-muted-foreground">{line.debit > 0 ? 'Debit' : 'Credit'}</span>
                            <span className="font-semibold tabular-nums">{fmt(line.debit > 0 ? line.debit : line.credit)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <PrintMenu onPrint={printDetail} label="Print" align="left" className="pt-2 border-t border-border" />
            </div>
          )}
        </div>
      </div>

      {showNewModal && clientId && (
        <NewJournalEntryModal
          clientId={clientId}
          createdByName={user?.nama || user?.username || 'System'}
          onClose={() => setShowNewModal(false)}
        />
      )}
      {showImportModal && clientId && (
        <ImportJournalModal
          clientId={clientId}
          createdByName={user?.nama || user?.username || 'System'}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
