'use client';

// Salinan desain tab Exceptions di Sales (sales/components/SalesExceptions.tsx)
// untuk Cash & Bank. Data dari lib/cashBankExceptionsStore.ts (deteksi dari Bank Feed + invoice Purchase/Sales + pembayaran rekonsiliasi, penanganan disimpan di backend).
//
// [BARU] Tiap exception sekarang punya `source`: 'Reconciliation' (soal
// pencocokan mutasi bank vs invoice -- berlaku untuk transaksi matched
// maupun unmatched) atau 'Classification' (soal akun lawan/pajak yang belum
// diketahui -- HANYA berlaku untuk transaksi yang tidak match invoice
// manapun, lihat CashBankJournalPreview.tsx). Badge & filter baru di bawah
// supaya kedua jenis masalah ini tidak tercampur.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight,
  X, Edit, CheckCircle, Eye, Calendar,
  AlertTriangle, ShieldAlert, ListChecks, Tag, Gauge, Pencil, Search,
} from 'lucide-react';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import type { CashBankExceptionSource } from '../lib/cashBankMock';
import { useCashBankExceptions, type CashBankExceptionView } from '../lib/cashBankExceptionsStore';
import {
  CHECKBOX_CLS, ICON_BTN, TD_CLS, TH_CLS, TR_CLS,
  SourceKpiTile, StatusPill, TablePagination,
  type PillTone,
} from './sourceUi';

type Priority = 'High' | 'Medium' | 'Low';
type ExceptionStatus = 'Open' | 'In Review' | 'Resolved';

const PRIORITY_TONE: Record<Priority, PillTone> = { High: 'red', Medium: 'amber', Low: 'emerald' };
const STATUS_TONE: Record<ExceptionStatus, PillTone> = { Open: 'blue', 'In Review': 'amber', Resolved: 'emerald' };
const SOURCE_TONE: Record<CashBankExceptionSource, PillTone> = { Reconciliation: 'blue', Classification: 'amber' };
const TABLE_HEADS = ['Priority', 'Source', 'Date', 'Transaction/File ID', 'Counterparty', 'Exception Type', 'AI Confidence', 'Assigned To', 'Status', ''];

const PRIORITY_STYLE: Record<Priority, string> = {
  High: 'bg-red-100 text-red-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-emerald-100 text-emerald-700',
};

const STATUS_STYLE: Record<ExceptionStatus, string> = {
  Open: 'bg-blue-100 text-blue-700',
  'In Review': 'bg-amber-100 text-amber-700',
  Resolved: 'bg-emerald-100 text-emerald-700',
};

const SOURCE_STYLE: Record<CashBankExceptionSource, string> = {
  Reconciliation: 'bg-indigo-100 text-neutral-700',
  Classification: 'bg-orange-100 text-orange-700',
};
const SOURCE_LABEL: Record<CashBankExceptionSource, string> = {
  Reconciliation: 'Reconciliation',
  Classification: 'Classification',
};

function formatTanggalSingkat(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}`;
}

export default function CashBankExceptions() {
  const { t } = useLanguage();
  const { user } = useAuth();

  // Deteksi dihitung dari Bank Feed + Reconciliation, status penanganan disimpan di
  // tabel financial_transaction_bank_cash_exceptions (lihat lib/cashBankExceptionsStore.ts).
  // assigned_to 'me' = user yang login.
  const { exceptions: backendExceptions, loading, error, refresh, simpan } = useCashBankExceptions();
  const ME = 'me';

  // Filters
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Selection / detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState('source');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Edit form (drawer)
  const [isEditing, setIsEditing] = useState(false);
    const [editAssignToMe, setEditAssignToMe] = useState(false);
  const [editStatus, setEditStatus] = useState<ExceptionStatus>('Open');
  const [saving, setSaving] = useState(false);

  const exceptions = useMemo(
    () => backendExceptions.map(e => ({ ...e, displayId: e.tx_no, customer: e.counterparty, date: formatTanggalSingkat(e.created_at) })),
    [backendExceptions],
  );

  const EXCEPTION_TYPES = useMemo(() => Array.from(new Set(exceptions.map(e => e.exception_type))), [exceptions]);
  const CUSTOMERS = useMemo(() => Array.from(new Set(exceptions.map(e => e.customer).filter(c => c !== '-'))), [exceptions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return exceptions.filter(e => {
      if (q && !(e.displayId.toLowerCase().includes(q) || e.customer.toLowerCase().includes(q) || e.exception_type.toLowerCase().includes(q))) return false;
      if (severity !== 'all' && e.priority !== severity) return false;
      if (typeFilter !== 'all' && e.exception_type !== typeFilter) return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (customerFilter !== 'all' && e.customer !== customerFilter) return false;
      if (assignedFilter === 'unassigned' && e.assigned_to) return false;
      if (assignedFilter === 'me' && e.assigned_to !== ME) return false;
      const d = new Date(e.created_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [exceptions, search, severity, typeFilter, sourceFilter, customerFilter, assignedFilter, dateStart, dateEnd]);

  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const [currentPage, setCurrentPage] = useState(1);
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const selected = exceptions.find(e => e.id === selectedId) || null;

  const resetFilters = () => {
    setSearch(''); setSeverity('all'); setTypeFilter('all'); setSourceFilter('all'); setCustomerFilter('all');
    setAssignedFilter('all'); setDateStart(''); setDateEnd('');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allOnPageSelected = paginated.length > 0 && paginated.every(e => selectedRows.has(e.id));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(e => next.delete(e.id));
      else paginated.forEach(e => next.add(e.id));
      return next;
    });
  };

  const openDetail = (e: { id: string }) => {
    setSelectedId(e.id);
    setDrawerTab('source');
    setIsEditing(false);
    setOpenMenuId(null);
  };

  const startEdit = () => {
    if (!selected) return;
    setEditAssignToMe(selected.assigned_to === ME);
    setEditStatus(selected.status as ExceptionStatus);
    setIsEditing(true);
  };

  const simpanPenanganan = async (
    ex: CashBankExceptionView,
    patch: { status?: ExceptionStatus; assigned_to?: 'me' | null },
    pesanSukses: string,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      await simpan(ex, patch);
      toast.success(t(pesanSukses), { description: ex.tx_no });
      return true;
    } catch (err) {
      toast.error(t('Failed to save'), { description: err instanceof Error ? err.message : undefined });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!selected) return;
    const ok = await simpanPenanganan(
      selected,
      { assigned_to: editAssignToMe ? 'me' : null, status: editStatus },
      'Changes saved',
    );
    if (ok) setIsEditing(false);
  };

  const acceptSuggestion = async (id: string) => {
    const target = exceptions.find(e => e.id === id);
    if (!target) return;
    setOpenMenuId(null);
    if (target.status === 'Open') await simpanPenanganan(target, { status: 'In Review' }, 'AI suggestion applied');
    else toast.info(t('AI suggestion applied'), { description: target.displayId });
  };

  const resolveException = async (id: string) => {
    const target = exceptions.find(e => e.id === id);
    if (!target) return;
    setOpenMenuId(null);
    await simpanPenanganan(target, { status: 'Resolved' }, 'Exception marked as resolved');
  };

  const viewOriginalFile = () => {
    toast.info(t('Original file not available'), {
      description: t('This exception is not linked to a bank line/original file yet.'),
    });
  };

  // KPI: desain sama dengan KPI Source Data (SourceKpiTile). Detail = jumlah yang belum Resolved,
  // persentase = porsi terhadap seluruh exception.
  const kpiTiles = useMemo(() => {
    const total = exceptions.length;
    const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const defs = [
      { label: 'Total Exceptions', rows: exceptions, icon: AlertTriangle },
      { label: 'High Risk', rows: exceptions.filter(e => e.priority === 'High'), icon: ShieldAlert },
      { label: 'Matching Issues', rows: exceptions.filter(e => e.source === 'Reconciliation'), icon: ListChecks },
      { label: 'Needs Classification', rows: exceptions.filter(e => e.source === 'Classification'), icon: Tag },
      { label: 'Low Confidence', rows: exceptions.filter(e => e.ai_confidence != null && e.ai_confidence < 40), icon: Gauge },
    ];
    return defs.map(k => ({
      label: k.label,
      icon: k.icon,
      count: k.rows.length,
      unresolved: k.rows.filter(e => e.status !== 'Resolved').length,
      pct: pctOf(k.rows.length),
    }));
  }, [exceptions]);

  return (
    <div className="space-y-4 !mt-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Retry')}</button>
        </div>
      )}

      {/* KPI Cards -- ukuran & posisi sama dengan Source Data (SourceKpiTile) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {kpiTiles.map(k => (
          <SourceKpiTile
            key={k.label}
            label={t(k.label)}
            count={k.count}
            detail={k.unresolved.toLocaleString('id-ID')}
            detailUnit={t('unresolved')}
            pct={k.pct}
            pctLabel={t('of all exceptions')}
            icon={k.icon}
          />
        ))}
      </div>

      {/* Filters -- baris terpisah di atas tabel, sama dengan Purchase Transaction (FilterSelect elegant) */}
      <div className="card relative px-0 pb-0 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            variant="elegant"
            value={severity}
            onChange={v => { setSeverity(v); setCurrentPage(1); }}
            options={[
              { value: 'all', label: t('All Severity') },
              { value: 'High', label: t('High') },
              { value: 'Medium', label: t('Medium') },
              { value: 'Low', label: t('Low') },
            ]}
          />
          <FilterSelect
            variant="elegant"
            value={typeFilter}
            onChange={v => { setTypeFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('All Exception Types') }, ...EXCEPTION_TYPES.map(type => ({ value: type, label: t(type) }))]}
          />
          <FilterSelect
            variant="elegant"
            value={sourceFilter}
            onChange={v => { setSourceFilter(v); setCurrentPage(1); }}
            options={[
              { value: 'all', label: t('All Sources') },
              { value: 'Reconciliation', label: t('Reconciliation') },
              { value: 'Classification', label: t('Classification') },
            ]}
          />
          <FilterSelect
            variant="elegant"
            value={customerFilter}
            onChange={v => { setCustomerFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('All Counterparties') }, ...CUSTOMERS.map(c => ({ value: c, label: c }))]}
          />
          <FilterSelect
            variant="elegant"
            value={assignedFilter}
            onChange={v => { setAssignedFilter(v); setCurrentPage(1); }}
            options={[
              { value: 'all', label: t('All Assigned') },
              { value: 'unassigned', label: t('Unassigned') },
              { value: 'me', label: t('Assigned to Me') },
            ]}
          />

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDatePicker(v => !v)}
              aria-haspopup="dialog"
              aria-expanded={showDatePicker}
              className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-neutral-900 transition-colors ${showDatePicker ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
            >
              <Calendar size={14} className="shrink-0 text-neutral-500" />
              <span className="truncate max-w-[170px]">
                {dateStart ? formatTanggalSingkat(dateStart) : t('All dates')}
                {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute left-0 top-full z-30 mt-1 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
                <div>
                  <label className="text-[11px] font-semibold text-neutral-600">{t('From')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="mt-0.5 w-full rounded-md border border-neutral-300 bg-card px-2 py-1.5 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-neutral-600">{t('To')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="mt-0.5 w-full rounded-md border border-neutral-300 bg-card px-2 py-1.5 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
                </div>
                <button
                  onClick={() => { setCurrentPage(1); setShowDatePicker(false); }}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-800 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700"
                >
                  {t('Apply')}
                </button>
              </div>
            )}
          </div>

          <button onClick={resetFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">{t('Reset')}</button>
        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4 !mt-1">
        {/* Table -- desain sama dengan tabel Source Data Lines (TH_CLS/TR_CLS/TD_CLS), header card sama dengan Purchase Transaction List */}
        <div className="card flex-1 min-w-0 w-full">
          {/* Header tabel -- sama dengan Purchase Transaction List: judul + "Showing x - y of z", pencarian di kanan */}
          <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Exception List')}</h3>
              <p className="text-sm text-neutral-500 mt-0.5">
                {filtered.length === 0
                  ? `${t('Showing')} 0 ${t('of')} ${exceptions.length} ${t('exceptions')}`
                  : `${t('Showing')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('of')} ${filtered.length} ${t('exceptions')}`}
              </p>
            </div>
            <div className="ml-auto flex w-full flex-col items-end gap-1.5 sm:w-auto">
              <div className="relative w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={search}
                  onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
                  placeholder={t('Search ID, counterparty, or issue...')}
                  className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                />
              </div>
            </div>
          </div>

            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[900px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className={`${TH_CLS} w-8 text-left`}>
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className={CHECKBOX_CLS} />
                    </th>
                    {TABLE_HEADS.map((h, i) => (
                      <th key={`${h}-${i}`} className={`${TH_CLS} text-left`}>{h ? t(h) : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && paginated.length === 0 && (
                    <tr><td colSpan={11} className="px-2 py-10 text-center text-xs text-neutral-500">{t('Loading...')}</td></tr>
                  )}
                  {!loading && paginated.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-2 py-10 text-center text-xs text-neutral-500">{t('No exceptions match the filter.')}</td>
                    </tr>
                  )}
                  {paginated.map(e => (
                    <tr
                      key={e.id}
                      onClick={() => openDetail(e)}
                      className={`${TR_CLS} cursor-pointer transition-colors ${selected?.id === e.id ? '[&>td]:bg-neutral-200' : ''}`}
                    >
                      <td className={TD_CLS} onClick={ev => { ev.stopPropagation(); toggleRow(e.id); }}>
                        <input type="checkbox" checked={selectedRows.has(e.id)} onChange={() => toggleRow(e.id)} className={CHECKBOX_CLS} />
                      </td>
                      <td className={TD_CLS}>
                        <StatusPill tone={PRIORITY_TONE[e.priority as Priority] || 'neutral'} label={t(e.priority)} />
                      </td>
                      <td className={TD_CLS}>
                        <StatusPill tone={SOURCE_TONE[e.source] || 'neutral'} label={t(SOURCE_LABEL[e.source] || e.source)} />
                      </td>
                      <td className={`${TD_CLS} text-neutral-600`}>{e.date}</td>
                      <td className={`${TD_CLS} font-medium text-neutral-900`}>{e.displayId}</td>
                      <td className="max-w-[300px] px-2 py-2" title={e.customer}>
                        <span className="block truncate font-medium text-neutral-900">{e.customer || '—'}</span>
                      </td>
                      <td className={`${TD_CLS} text-neutral-600`}>{t(e.exception_type)}</td>
                      <td className={`${TD_CLS} tabular-nums`}>
                        {e.ai_confidence == null
                          ? <span className="text-neutral-500">—</span>
                          : <span className={`font-semibold ${e.ai_confidence < 40 ? 'text-red-700' : e.ai_confidence < 60 ? 'text-amber-700' : 'text-emerald-700'}`}>{e.ai_confidence}%</span>}
                      </td>
                      <td className={`${TD_CLS} text-neutral-900`}>{e.assigned_to ? (e.assigned_to === ME ? (user?.nama || user?.username) : t('Another user')) : '—'}</td>
                      <td className={TD_CLS}>
                        <StatusPill tone={STATUS_TONE[e.status as ExceptionStatus] || 'neutral'} label={t(e.status)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right" onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => openDetail(e)} className={ICON_BTN} title={t('View Detail')} aria-label={t('View Detail')}>
                            <Eye size={14} />
                          </button>
                          <button onClick={() => { openDetail(e); startEdit(); }} className={ICON_BTN} title={t('Edit')} aria-label={t('Edit')}>
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => resolveException(e.id)}
                            disabled={e.status === 'Resolved'}
                            className={ICON_BTN}
                            title={t('Mark Resolved')}
                            aria-label={t('Mark Resolved')}
                          >
                            <CheckCircle size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={filtered.length}
              page={pageSafe}
              pageSize={pageSize}
              onPage={p => setCurrentPage(Math.min(Math.max(1, p), totalPages))}
              onPageSize={n => { setPageSize(n); setCurrentPage(1); }}
              unit="exceptions"
            />
        </div>

        {/* Detail Drawer */}
        {selected && (
          <div className="w-80 flex-shrink-0 card p-4 space-y-3 self-start sticky top-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">{t('Detail Exception')}</h3>
              <button onClick={() => { setSelectedId(null); setIsEditing(false); }} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[selected.priority as Priority] || 'bg-muted text-neutral-500'}`}>{t(selected.priority)} {t('Priority')}</span>
              <span className="text-xs text-neutral-500">ID: {selected.displayId}</span>
            </div>
            <span className={`inline-block w-fit text-[11px] px-2 py-0.5 rounded-full font-medium ${SOURCE_STYLE[selected.source] || 'bg-muted text-neutral-500'}`}>
              {t(SOURCE_LABEL[selected.source] || selected.source)}
            </span>
            <div>
              <h4 className="text-sm font-bold text-neutral-900">{t(selected.exception_type)}</h4>
              {selected.ai_suggestion && <p className="text-xs text-neutral-500 mt-0.5">{selected.ai_suggestion}</p>}
            </div>

            {!isEditing && (
              <div className="space-y-1.5 text-xs">
                {[
                  ['Date', selected.date],
                  ['Counterparty', selected.customer],
                  ['Transaction ID', selected.displayId],
                  ['AI Confidence', selected.ai_confidence == null ? '—' : <span key="c" className={`font-bold ${selected.ai_confidence < 40 ? 'text-red-600' : 'text-amber-600'}`}>{selected.ai_confidence}%</span>],
                  ['Status', <span key="s" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[selected.status as ExceptionStatus] || 'bg-muted text-neutral-500'}`}>{t(selected.status)}</span>],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between">
                    <span className="text-neutral-500">{t(k as string)}</span>
                    <span className="font-medium text-neutral-900 text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}

            {isEditing && (
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[11px] text-neutral-500">{t('Exception Type')}</label>
                  <input value={selected.exception_type} readOnly disabled className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-muted text-neutral-500 mt-0.5" />
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-900">
                  <input type="checkbox" checked={editAssignToMe} onChange={ev => setEditAssignToMe(ev.target.checked)} className="rounded border-border" />
                  {t('Assign to me')}
                </label>
                <div>
                  <label className="text-[11px] text-neutral-500">{t('Status')}</label>
                  <select value={editStatus} onChange={ev => setEditStatus(ev.target.value as ExceptionStatus)} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-neutral-900 mt-0.5">
                    <option value="Open">{t('Open')}</option>
                    <option value="In Review">{t('In Review')}</option>
                    <option value="Resolved">{t('Resolved')}</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setIsEditing(false)} className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">{t('Cancel')}</button>
                  <button onClick={saveEdit} disabled={saving} className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50">{saving ? t('Saving...') : t('Save')}</button>
                </div>
              </div>
            )}

            {!isEditing && (
              <>
                <div className="flex gap-1 border-b border-border pb-2">
                  {['source', 'ai', 'history'].map(tabKey => (
                    <button key={tabKey} onClick={() => setDrawerTab(tabKey)} className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${drawerTab === tabKey ? 'bg-primary/10 text-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}`}>
                      {tabKey === 'source' ? t('Source Data') : tabKey === 'ai' ? t('AI Suggestion') : t('History')}
                    </button>
                  ))}
                </div>

                {drawerTab === 'source' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-neutral-900">{t('Source Data Snippet')}</p>
                      <button onClick={viewOriginalFile} className="text-xs text-neutral-900 hover:underline">{t('View Original File ↗')}</button>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 tabular-nums text-[11px] text-neutral-900 space-y-0.5">
                      {selected.source_snippet ? (
                        Object.entries(selected.source_snippet).map(([k, v]) => (
                          <p key={k}>{k}: {String(v)}</p>
                        ))
                      ) : (
                        <p className="text-neutral-500">{t('No source data snippet for this exception yet.')}</p>
                      )}
                    </div>
                  </div>
                )}
                {drawerTab === 'ai' && (
                  <div className="text-xs text-neutral-500 space-y-2">
                    <p className="font-semibold text-neutral-900">{t('AI Suggestion')}</p>
                    <p>{selected.ai_suggestion || t('No AI suggestion for this exception yet.')}</p>
                  </div>
                )}
                {drawerTab === 'history' && (
                  <div className="text-xs text-neutral-500">
                    <p>{selected.resolved_at ? `${t('Resolved on')} ${formatTanggalSingkat(selected.resolved_at)}` : t('No change history yet.')}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t border-border">
                  <button onClick={startEdit} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                    <Edit size={12} /> {t('Edit')}
                  </button>
                  <button onClick={() => acceptSuggestion(selected.id)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-emerald-500 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors">
                    <CheckCircle size={12} /> {t('Accept Suggestion')}
                  </button>
                </div>
                <button onClick={() => resolveException(selected.id)} className="w-full py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5">
                  <CheckCircle size={12} /> {t('Resolve')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}