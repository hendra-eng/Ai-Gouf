'use client';

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight,
  X, Edit, CheckCircle, MoreHorizontal, Eye, Calendar,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import KpiCard from '@/components/shared/KpiCard';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type Priority = 'High' | 'Medium' | 'Low';
type ExceptionStatus = 'Open' | 'In Review' | 'Resolved';

interface ExceptionItem {
  id: string;
  date: string; // "14 Nov 2024"
  customer: string;
  type: string;
  aiConf: number;
  assignedTo: string | null;
  status: ExceptionStatus;
  priority: Priority;
}

const EXCEPTIONS: ExceptionItem[] = [];

const EXCEPTION_TYPES = Array.from(new Set(EXCEPTIONS.map(e => e.type)));
const CUSTOMERS = Array.from(new Set(EXCEPTIONS.map(e => e.customer)));
const TEAM_MEMBERS = Array.from(new Set(EXCEPTIONS.map(e => e.assignedTo).filter((v): v is string => !!v)));
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

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

function parseDisplayDate(str: string): Date {
  const [day, mon, year] = str.split(' ');
  const monthIdx = MONTH_MAP[mon.toLowerCase().slice(0, 3)] ?? 0;
  return new Date(Number(year), monthIdx, Number(day));
}

export default function SalesExceptions() {
  const { t } = useLanguage();
  const [exceptions, setExceptions] = useState<ExceptionItem[]>(EXCEPTIONS);

  // Filters
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [dateStart, setDateStart] = useState('2024-01-01');
  const [dateEnd, setDateEnd] = useState('2024-12-31');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Selection / detail
  const [selectedId, setSelectedId] = useState<string | null>(EXCEPTIONS[0]?.id ?? null);
  const [drawerTab, setDrawerTab] = useState('source');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set(EXCEPTIONS[0] ? [EXCEPTIONS[0].id] : []));
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Edit form (drawer)
  const [isEditing, setIsEditing] = useState(false);
  const [editType, setEditType] = useState('');
  const [editAssigned, setEditAssigned] = useState('');
  const [editStatus, setEditStatus] = useState<ExceptionStatus>('Open');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  const menuRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return exceptions.filter(e => {
      if (q && !(e.id.toLowerCase().includes(q) || e.customer.toLowerCase().includes(q) || e.type.toLowerCase().includes(q))) return false;
      if (severity !== 'all' && e.priority !== severity) return false;
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (customerFilter !== 'all' && e.customer !== customerFilter) return false;
      if (assignedFilter !== 'all') {
        if (assignedFilter === 'unassigned' ? !!e.assignedTo : e.assignedTo !== assignedFilter) return false;
      }
      const d = parseDisplayDate(e.date);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [exceptions, search, severity, typeFilter, customerFilter, assignedFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const selected = exceptions.find(e => e.id === selectedId) || null;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setSeverity('all'); setTypeFilter('all'); setCustomerFilter('all');
    setAssignedFilter('all'); setDateStart('2024-01-01'); setDateEnd('2024-12-31');
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
      if (allOnPageSelected) {
        paginated.forEach(e => next.delete(e.id));
      } else {
        paginated.forEach(e => next.add(e.id));
      }
      return next;
    });
  };

  const openDetail = (e: ExceptionItem) => {
    setSelectedId(e.id);
    setDrawerTab('source');
    setIsEditing(false);
    setOpenMenuId(null);
  };

  const updateException = (id: string, patch: Partial<ExceptionItem>) => {
    setExceptions(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  };

  const startEdit = () => {
    if (!selected) return;
    setEditType(selected.type);
    setEditAssigned(selected.assignedTo || '');
    setEditStatus(selected.status);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    updateException(selected.id, {
      type: editType,
      assignedTo: editAssigned || null,
      status: editStatus,
    });
    setIsEditing(false);
    toast.success(t('Perubahan disimpan'), { description: selected.id });
  };

  const acceptSuggestion = (id: string) => {
    const target = exceptions.find(e => e.id === id);
    if (!target) return;
    updateException(id, { status: target.status === 'Open' ? 'In Review' : target.status });
    toast.success(t('Saran AI diterapkan'), { description: id });
    setOpenMenuId(null);
  };

  const resolveException = (id: string) => {
    updateException(id, { status: 'Resolved' });
    toast.success(t('Exception ditandai selesai'), { description: id });
    setOpenMenuId(null);
  };

  const viewOriginalFile = () => {
    toast.info(t('File asli belum tersedia'), {
      description: t('Data ini masih data contoh dan belum terhubung ke file sumber asli.'),
    });
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          { label: 'Total Exceptions', value: String(exceptions.length), change: 0, icon: 'ExclamationTriangleIcon', iconColor: 'text-amber-600', iconBg: 'bg-amber-50' },
          { label: 'High Risk', value: String(exceptions.filter(e => e.priority === 'High').length), change: 0, icon: 'ExclamationCircleIcon', iconColor: 'text-red-600', iconBg: 'bg-red-50' },
          { label: 'Missing Tax Info', value: String(exceptions.filter(e => e.type === 'Tax status unclear').length), change: 0, icon: 'DocumentTextIcon', iconColor: 'text-orange-600', iconBg: 'bg-orange-50' },
          { label: 'Low Confidence', value: String(exceptions.filter(e => e.aiConf < 40).length), change: 0, icon: 'CpuChipIcon', iconColor: 'text-purple-600', iconBg: 'bg-purple-50' },
          { label: 'Duplicate Invoice', value: String(exceptions.filter(e => e.type === 'Duplicate invoice').length), change: 0, icon: 'DocumentDuplicateIcon', iconColor: 'text-blue-600', iconBg: 'bg-blue-50' },
        ].map(k => (
          <KpiCard
            key={k.label}
            title={t(k.label)}
            value={k.value}
            change={k.change}
            changeLabel={t('vs periode sebelumnya')}
            icon={k.icon}
            iconColor={k.iconColor}
            iconBg={k.iconBg}
          />
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
                {new Date(dateStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' – '}
                {new Date(dateEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
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
            {TEAM_MEMBERS.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
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
                {paginated.length === 0 && (
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
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[e.priority]}`}>{t(e.priority)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{e.date}</td>
                    <td className="py-2.5 px-2 text-primary font-medium whitespace-nowrap">{e.id}</td>
                    <td className="py-2.5 px-2 font-medium text-foreground whitespace-nowrap">{e.customer}</td>
                    <td className="py-2.5 px-2 text-muted-foreground">{t(e.type)}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${e.aiConf < 40 ? 'text-red-600' : e.aiConf < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{e.aiConf}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-foreground whitespace-nowrap">{e.assignedTo || '—'}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[e.status]}`}>{t(e.status)}</span>
                    </td>
                    <td className="py-2.5 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <button
                        onClick={() => setOpenMenuId(prev => (prev === e.id ? null : e.id))}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {openMenuId === e.id && (
                        <div ref={menuRef} className="absolute z-20 right-2 top-full mt-1 w-40 card p-1 shadow-card">
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
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLE[selected.priority]}`}>🔴 {t(selected.priority)} {t('Priority')}</span>
              <span className="text-xs text-muted-foreground">ID: {selected.id}</span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground">{t(selected.type)}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{t('Status pajak pelanggan tidak dapat dipastikan dari data sumber.')}</p>
            </div>

            {!isEditing && (
              <div className="space-y-1.5 text-xs">
                {[
                  ['Tanggal', selected.date],
                  ['Customer', selected.customer],
                  ['Transaction ID', selected.id],
                  ['No. Invoice (Source)', '—'],
                  ['Amount', formatIDR(0)],
                  ['AI Confidence', <span key="c" className={`font-bold ${selected.aiConf < 40 ? 'text-red-600' : 'text-amber-600'}`}>{selected.aiConf}%</span>],
                  ['Status', <span key="s" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[selected.status]}`}>{t(selected.status)}</span>],
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
                  <select value={editType} onChange={ev => setEditType(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                    {EXCEPTION_TYPES.map(type => <option key={type} value={type}>{t(type)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Assigned To')}</label>
                  <select value={editAssigned} onChange={ev => setEditAssigned(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                    <option value="">{t('Belum Ditugaskan')}</option>
                    {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
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
                  <button onClick={saveEdit} className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors">{t('Simpan')}</button>
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
                      <p>{t('Invoice No')} : —</p>
                      <p>{t('Date')}       : —</p>
                      <p>{t('Customer')}   : —</p>
                      <p>{t('Amount')}     : —</p>
                      <p>{t('Notes')}      : —</p>
                    </div>
                  </div>
                )}
                {drawerTab === 'ai' && (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p className="font-semibold text-foreground">{t('Saran AI')}</p>
                    <p>{t('Berdasarkan analisis, transaksi ini kemungkinan besar adalah Penjualan Jasa dengan PPN 11%. Disarankan untuk memverifikasi NPWP pelanggan.')}</p>
                  </div>
                )}
                {drawerTab === 'history' && (
                  <div className="text-xs text-muted-foreground">
                    <p>{t('Belum ada riwayat perubahan.')}</p>
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