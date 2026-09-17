'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight,
  X, Edit, CheckCircle, MoreHorizontal, Eye, Calendar,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import {
  useSalesExceptions, updateSalesException, useSalesInvoices,
  formatTanggalSingkat, type BackendSalesException,
} from '@/lib/salesStore';

type Priority = 'High' | 'Medium' | 'Low';
type ExceptionStatus = 'Open' | 'In Review' | 'Resolved';

const PAGE_SIZE = 10;

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

export default function SalesExceptions() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;

  const { exceptions: backendExceptions, loading, error, refresh } = useSalesExceptions(clientId);
  const { invoices } = useSalesInvoices(clientId);
  const invoiceById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);

  // Filters
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
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
  const [editType, setEditType] = useState('');
  const [editAssignToMe, setEditAssignToMe] = useState(false);
  const [editStatus, setEditStatus] = useState<ExceptionStatus>('Open');
  const [saving, setSaving] = useState(false);

  const decorate = (e: BackendSalesException) => {
    const inv = e.invoice_id ? invoiceById.get(e.invoice_id) : undefined;
    return {
      ...e,
      displayId: inv?.invoice_no || e.id.slice(0, 8),
      customer: inv?.customer_name || '-',
      date: formatTanggalSingkat(e.created_at),
    };
  };
  const exceptions = useMemo(() => backendExceptions.map(decorate), [backendExceptions, invoiceById]);

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
      if (customerFilter !== 'all' && e.customer !== customerFilter) return false;
      if (assignedFilter === 'unassigned' && e.assigned_to) return false;
      if (assignedFilter === 'me' && e.assigned_to !== clientId) return false;
      const d = new Date(e.created_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [exceptions, search, severity, typeFilter, customerFilter, assignedFilter, dateStart, dateEnd, clientId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(1);
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const selected = exceptions.find(e => e.id === selectedId) || null;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setSeverity('all'); setTypeFilter('all'); setCustomerFilter('all');
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
    setEditType(selected.exception_type);
    setEditAssignToMe(selected.assigned_to === clientId);
    setEditStatus(selected.status as ExceptionStatus);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateSalesException(selected.id, {
        exception_type: editType,
        assigned_to: editAssignToMe ? (clientId ?? undefined) : null,
        status: editStatus,
        resolved_at: editStatus === 'Resolved' ? new Date().toISOString() : undefined,
        resolved_by: editStatus === 'Resolved' ? (clientId ?? undefined) : undefined,
      });
      setIsEditing(false);
      toast.success(t('Perubahan disimpan'), { description: selected.displayId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyimpan perubahan'));
    } finally {
      setSaving(false);
    }
  };

  const acceptSuggestion = async (id: string) => {
    const target = exceptions.find(e => e.id === id);
    if (!target) return;
    try {
      await updateSalesException(id, { status: target.status === 'Open' ? 'In Review' : target.status });
      toast.success(t('Saran AI diterapkan'), { description: target.displayId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menerapkan saran'));
    }
    setOpenMenuId(null);
  };

  const resolveException = async (id: string) => {
    const target = exceptions.find(e => e.id === id);
    try {
      await updateSalesException(id, { status: 'Resolved', resolved_at: new Date().toISOString(), resolved_by: clientId ?? undefined });
      toast.success(t('Exception ditandai selesai'), { description: target?.displayId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menandai selesai'));
    }
    setOpenMenuId(null);
  };

  const viewOriginalFile = () => {
    toast.info(t('File asli belum tersedia'), {
      description: t('Exception ini belum tertaut ke source row/file asli.'),
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* KPI Cards -- pakai div biasa (bukan KpiCard) supaya konsisten dgn revisi sebelumnya */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          { label: 'Total Exceptions', value: String(exceptions.length) },
          { label: 'High Risk', value: String(exceptions.filter(e => e.priority === 'High').length) },
          { label: 'Missing Tax Info', value: String(exceptions.filter(e => e.exception_type === 'Tax status unclear').length) },
          { label: 'Low Confidence', value: String(exceptions.filter(e => (e.ai_confidence ?? 0) < 40).length) },
          { label: 'Duplicate Invoice', value: String(exceptions.filter(e => e.exception_type === 'Duplicate invoice').length) },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-muted-foreground">{t(k.label)}</p>
            <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
            <input
              type="text"
              value={search}
              onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
              placeholder={t('Cari ID, nama pelanggan, atau masalah...')}
              className="w-full text-xs border border-border rounded-lg pl-7 pr-3 py-1.5 bg-card text-foreground"
            />
          </div>

          <select
            value={severity}
            onChange={ev => { setSeverity(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Semua (Severity)')}</option>
            <option value="High">{t('High')}</option>
            <option value="Medium">{t('Medium')}</option>
            <option value="Low">{t('Low')}</option>
          </select>

          <select
            value={typeFilter}
            onChange={ev => { setTypeFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Semua (Exception Type)')}</option>
            {EXCEPTION_TYPES.map(type => (
              <option key={type} value={type}>{t(type)}</option>
            ))}
          </select>

          <select
            value={customerFilter}
            onChange={ev => { setCustomerFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Semua Customer')}</option>
            {CUSTOMERS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div className="relative">
            <button
              onClick={() => setShowDatePicker(v => !v)}
              className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-card hover:bg-muted transition-colors"
            >
              <Calendar size={12} className="text-muted-foreground" />
              <span className="text-foreground">
                {dateStart ? new Date(dateStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : t('Semua')}
                {dateEnd ? ` – ${new Date(dateEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute z-20 top-full mt-1 right-0 card p-3 w-64 space-y-2 shadow-card">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <button
                  onClick={() => { setCurrentPage(1); setShowDatePicker(false); }}
                  className="w-full text-xs py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
                >
                  {t('Terapkan')}
                </button>
              </div>
            )}
          </div>

          <select
            value={assignedFilter}
            onChange={ev => { setAssignedFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Semua (Assigned To)')}</option>
            <option value="unassigned">{t('Belum Ditugaskan')}</option>
            <option value="me">{t('Ditugaskan ke Saya')}</option>
          </select>

          <button onClick={resetFilters} className="text-xs text-primary hover:underline">{t('Reset')}</button>
        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4">
        {/* Table */}
        <div className="card overflow-hidden flex-1 min-w-0">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{t('Daftar Exception')} ({filtered.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2.5 px-3 w-8">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="rounded border-border" />
                  </th>
                  {['Priority', 'Tanggal', 'Transaction/File ID', 'Customer', 'Exception Type', 'AI Confidence', 'Assigned To', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left py-2.5 px-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada exception yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {paginated.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => openDetail(e)}
                    className={`border-b border-border/50 cursor-pointer transition-colors text-xs ${selected?.id === e.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                  >
                    <td className="py-2.5 px-3" onClick={ev => { ev.stopPropagation(); toggleRow(e.id); }}>
                      <input type="checkbox" checked={selectedRows.has(e.id)} onChange={() => toggleRow(e.id)} className="rounded border-border" />
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[e.priority as Priority] || 'bg-muted text-muted-foreground'}`}>{t(e.priority)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{e.date}</td>
                    <td className="py-2.5 px-2 text-primary font-medium whitespace-nowrap">{e.displayId}</td>
                    <td className="py-2.5 px-2 font-medium text-foreground whitespace-nowrap">{e.customer}</td>
                    <td className="py-2.5 px-2 text-muted-foreground">{t(e.exception_type)}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${(e.ai_confidence ?? 0) < 40 ? 'text-red-600' : (e.ai_confidence ?? 0) < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{e.ai_confidence ?? 0}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-foreground whitespace-nowrap">{e.assigned_to ? (e.assigned_to === clientId ? (user?.nama || user?.username) : t('User lain')) : '—'}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[e.status as ExceptionStatus] || 'bg-muted text-muted-foreground'}`}>{t(e.status)}</span>
                    </td>
                    <td className="py-2.5 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <button
                        onClick={() => setOpenMenuId(prev => (prev === e.id ? null : e.id))}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {openMenuId === e.id && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-40 card p-1 shadow-card">
                          <button onClick={() => openDetail(e)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Lihat Detail')}
                          </button>
                          <button onClick={() => { openDetail(e); startEdit(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Edit size={12} /> {t('Edit')}
                          </button>
                          <button onClick={() => resolveException(e.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-emerald-600 hover:bg-emerald-50 rounded-md">
                            <CheckCircle size={12} /> {t('Tandai Resolved')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length === 0
                ? t('Menampilkan 0 dari 0 exception')
                : `${t('Menampilkan')} ${(pageSafe - 1) * PAGE_SIZE + 1} - ${Math.min(pageSafe * PAGE_SIZE, filtered.length)} ${t('dari')} ${filtered.length} ${t('exception')}`}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`w-6 h-6 rounded text-xs ${p === pageSafe ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  {p}
                </button>
              ))}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Detail Drawer */}
        {selected && (
          <div className="w-80 flex-shrink-0 card p-4 space-y-3 self-start sticky top-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('Detail Exception')}</h3>
              <button onClick={() => { setSelectedId(null); setIsEditing(false); }} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[selected.priority as Priority] || 'bg-muted text-muted-foreground'}`}>{t(selected.priority)} {t('Priority')}</span>
              <span className="text-xs text-muted-foreground">ID: {selected.displayId}</span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground">{t(selected.exception_type)}</h4>
              {selected.ai_suggestion && <p className="text-xs text-muted-foreground mt-0.5">{selected.ai_suggestion}</p>}
            </div>

            {!isEditing && (
              <div className="space-y-1.5 text-xs">
                {[
                  ['Tanggal', selected.date],
                  ['Customer', selected.customer],
                  ['Transaction ID', selected.displayId],
                  ['AI Confidence', <span key="c" className={`font-bold ${(selected.ai_confidence ?? 0) < 40 ? 'text-red-600' : 'text-amber-600'}`}>{selected.ai_confidence ?? 0}%</span>],
                  ['Status', <span key="s" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[selected.status as ExceptionStatus] || 'bg-muted text-muted-foreground'}`}>{t(selected.status)}</span>],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between">
                    <span className="text-muted-foreground">{t(k as string)}</span>
                    <span className="font-medium text-foreground text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}

            {isEditing && (
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Exception Type')}</label>
                  <input value={editType} onChange={ev => setEditType(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={editAssignToMe} onChange={ev => setEditAssignToMe(ev.target.checked)} className="rounded border-border" />
                  {t('Tugaskan ke saya')}
                </label>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Status')}</label>
                  <select value={editStatus} onChange={ev => setEditStatus(ev.target.value as ExceptionStatus)} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                    <option value="Open">{t('Open')}</option>
                    <option value="In Review">{t('In Review')}</option>
                    <option value="Resolved">{t('Resolved')}</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setIsEditing(false)} className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">{t('Batal')}</button>
                  <button onClick={saveEdit} disabled={saving} className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50">{saving ? t('Menyimpan...') : t('Simpan')}</button>
                </div>
              </div>
            )}

            {!isEditing && (
              <>
                <div className="flex gap-1 border-b border-border pb-2">
                  {['source', 'ai', 'history'].map(tabKey => (
                    <button key={tabKey} onClick={() => setDrawerTab(tabKey)} className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${drawerTab === tabKey ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                      {tabKey === 'source' ? t('Source Data') : tabKey === 'ai' ? t('AI Suggestion') : t('History')}
                    </button>
                  ))}
                </div>

                {drawerTab === 'source' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-foreground">{t('Cuplikan Data Sumber')}</p>
                      <button onClick={viewOriginalFile} className="text-xs text-primary hover:underline">{t('Lihat File Asli ↗')}</button>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3 font-mono text-[11px] text-foreground space-y-0.5">
                      {selected.source_snippet ? (
                        Object.entries(selected.source_snippet).map(([k, v]) => (
                          <p key={k}>{k}: {String(v)}</p>
                        ))
                      ) : (
                        <p className="text-muted-foreground">{t('Belum ada cuplikan data sumber untuk exception ini.')}</p>
                      )}
                    </div>
                  </div>
                )}
                {drawerTab === 'ai' && (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p className="font-semibold text-foreground">{t('Saran AI')}</p>
                    <p>{selected.ai_suggestion || t('Belum ada saran AI untuk exception ini.')}</p>
                  </div>
                )}
                {drawerTab === 'history' && (
                  <div className="text-xs text-muted-foreground">
                    <p>{selected.resolved_at ? `${t('Diselesaikan pada')} ${formatTanggalSingkat(selected.resolved_at)}` : t('Belum ada riwayat perubahan.')}</p>
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
