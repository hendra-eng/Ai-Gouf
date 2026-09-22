'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Download, Plus, Settings, ChevronLeft, ChevronRight, MoreHorizontal, X, Eye, Edit,
  Calendar, CheckCircle, Send, Trash2,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import KpiCard from '@/components/shared/KpiCard';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type TrxStatus = 'Draft' | 'Review' | 'Approved' | 'Posted' | 'Partial' | 'Paid';

interface TrxItem {
  id: string;
  date: string; // "02 Jan 2024"
  customer: string;
  desc: string;
  dpp: number;
  ppn: number;
  pph: number;
  gross: number;
  paid: number;
  outstanding: number;
  dueDate: string;
  type: string;
  journal: string;
  status: TrxStatus;
  project: string;
  taxStatus: string;
}

const TRANSACTIONS: TrxItem[] = [];

const STATUS_STYLE: Record<string, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Partial: 'bg-amber-100 text-amber-700',
  Draft: 'bg-gray-100 text-gray-600',
  Posted: 'bg-blue-100 text-blue-700',
  Review: 'bg-orange-100 text-orange-700',
  Approved: 'bg-purple-100 text-purple-700',
};

const CUSTOMERS = Array.from(new Set(TRANSACTIONS.map(r => r.customer)));
const PROJECTS = Array.from(new Set(TRANSACTIONS.map(r => r.project)));
const TAX_STATUSES = Array.from(new Set(TRANSACTIONS.map(r => r.taxStatus)));
const POSTING_STATUSES = Array.from(new Set(TRANSACTIONS.map(r => r.status)));
const TYPES = Array.from(new Set(TRANSACTIONS.map(r => r.type)));

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};
function parseDisplayDate(str: string): Date {
  const [day, mon, year] = str.split(' ');
  return new Date(Number(year), MONTH_MAP[mon.toLowerCase().slice(0, 3)] ?? 0, Number(day));
}
function toDisplayDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}`;
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  customer: '',
  desc: '',
  dpp: '',
  type: TYPES[0],
  project: PROJECTS[0],
  dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
};

export default function SalesTransaction() {
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState<TrxItem[]>(TRANSACTIONS);

  // Filters
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [taxStatusFilter, setTaxStatusFilter] = useState('all');
  const [postingStatusFilter, setPostingStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateStart, setDateStart] = useState('2024-01-01');
  const [dateEnd, setDateEnd] = useState('2024-12-31');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Table selection / drawer
  const [selectedId, setSelectedId] = useState<string | null>(TRANSACTIONS[0]?.id ?? null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Edit drawer
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ customer: '', desc: '', dpp: 0, project: '', dueDate: '' });

  // Add transaction modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);

  // Column visibility
  const [showSettings, setShowSettings] = useState(false);
  const [visibleCols, setVisibleCols] = useState({ pph: true, dueDate: true, journal: true });

  // Pagination
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return transactions.filter(r => {
      if (q && !(r.id.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q))) return false;
      if (customerFilter !== 'all' && r.customer !== customerFilter) return false;
      if (taxStatusFilter !== 'all' && r.taxStatus !== taxStatusFilter) return false;
      if (postingStatusFilter !== 'all' && r.status !== postingStatusFilter) return false;
      if (projectFilter !== 'all' && r.project !== projectFilter) return false;
      const d = parseDisplayDate(r.date);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [transactions, search, customerFilter, taxStatusFilter, postingStatusFilter, projectFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const selectedTrx = transactions.find(r => r.id === selectedId) || null;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setCustomerFilter('all'); setTaxStatusFilter('all'); setPostingStatusFilter('all');
    setProjectFilter('all'); setDateStart('2024-01-01'); setDateEnd('2024-12-31');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.id));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(r => next.delete(r.id));
      else paginated.forEach(r => next.add(r.id));
      return next;
    });
  };

  const openDetail = (row: TrxItem) => {
    setSelectedId(row.id);
    setDrawerTab('detail');
    setIsEditing(false);
    setOpenMenuId(null);
  };

  const updateTrx = (id: string, patch: Partial<TrxItem>) => {
    setTransactions(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const startEdit = (row?: TrxItem) => {
    const target = row || selectedTrx;
    if (!target) return;
    setEditForm({ customer: target.customer, desc: target.desc, dpp: target.dpp, project: target.project, dueDate: target.dueDate });
    setIsEditing(true);
  };
  const saveEdit = () => {
    if (!selectedTrx) return;
    const dpp = Number(editForm.dpp) || 0;
    const ppn = Math.round(dpp * 0.11);
    const pph = Math.round(dpp * 0.01);
    const gross = dpp + ppn - pph;
    updateTrx(selectedTrx.id, { customer: editForm.customer, desc: editForm.desc, dpp, ppn, pph, gross, project: editForm.project, dueDate: editForm.dueDate });
    setIsEditing(false);
    toast.success(t('Perubahan disimpan'), { description: selectedTrx.id });
  };

  const approveTrx = (id: string) => {
    updateTrx(id, { status: 'Approved' });
    toast.success(t('Transaksi disetujui'), { description: id });
    setOpenMenuId(null);
  };
  const postTrx = (id: string) => {
    const row = transactions.find(r => r.id === id);
    updateTrx(id, { status: 'Posted', journal: row?.journal || `JR-${Date.now().toString().slice(-6)}` });
    toast.success(t('Transaksi diposting ke jurnal'), { description: id });
    setOpenMenuId(null);
  };
  const deleteTrx = (id: string) => {
    setTransactions(prev => prev.filter(r => r.id !== id));
    if (selectedId === id) setSelectedId(null);
    setOpenMenuId(null);
    toast.success(t('Transaksi dihapus'), { description: id });
  };

  const handleExport = () => {
    const headers = ['Tanggal', 'Invoice', 'Customer', 'Deskripsi', 'DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding', 'Due Date', 'Tipe', 'Jurnal', 'Status'];
    const rows = filtered.map(r => [r.date, r.id, r.customer, r.desc, r.dpp, r.ppn, r.pph, r.gross, r.paid, r.outstanding, r.dueDate, r.type, r.journal, r.status]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaksi-penjualan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('Export berhasil'), { description: `${filtered.length} ${t('baris diunduh sebagai CSV.')}` });
  };

  const submitAddTransaction = () => {
    if (!addForm.customer.trim() || !addForm.desc.trim() || !addForm.dpp) {
      toast.error(t('Lengkapi Customer, Deskripsi, dan DPP terlebih dahulu.'));
      return;
    }
    const dpp = Number(addForm.dpp) || 0;
    const ppn = Math.round(dpp * 0.11);
    const pph = Math.round(dpp * 0.01);
    const gross = dpp + ppn - pph;
    const nextNum = transactions.length + 1;
    const newTrx: TrxItem = {
      id: `INV-2024-${String(nextNum).padStart(4, '0')}`,
      date: toDisplayDate(addForm.date),
      customer: addForm.customer.trim(),
      desc: addForm.desc.trim(),
      dpp, ppn, pph, gross,
      paid: 0,
      outstanding: gross,
      dueDate: toDisplayDate(addForm.dueDate),
      type: addForm.type,
      journal: '',
      status: 'Draft',
      project: addForm.project,
      taxStatus: 'Belum Terbit Faktur',
    };
    setTransactions(prev => [newTrx, ...prev]);
    setShowAddModal(false);
    setAddForm(emptyForm);
    setCurrentPage(1);
    toast.success(t('Transaksi ditambahkan'), { description: newTrx.id });
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Draft', value: String(transactions.filter(r => r.status === 'Draft').length), sub: formatIDR(transactions.filter(r => r.status === 'Draft').reduce((s, r) => s + r.gross, 0)), icon: 'DocumentIcon', iconColor: 'text-gray-600', iconBg: 'bg-gray-100' },
          { label: 'Ready for Approval', value: String(transactions.filter(r => r.status === 'Review').length), sub: formatIDR(transactions.filter(r => r.status === 'Review').reduce((s, r) => s + r.gross, 0)), icon: 'ClockIcon', iconColor: 'text-amber-600', iconBg: 'bg-amber-50' },
          { label: 'Posted', value: String(transactions.filter(r => r.status === 'Posted' || r.status === 'Paid' || r.status === 'Partial').length), sub: formatIDR(transactions.filter(r => r.status === 'Posted' || r.status === 'Paid' || r.status === 'Partial').reduce((s, r) => s + r.gross, 0)), icon: 'CheckCircleIcon', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
          { label: 'Outstanding AR', value: String(transactions.filter(r => r.outstanding > 0).length), sub: formatIDR(transactions.reduce((s, r) => s + r.outstanding, 0)), icon: 'BanknotesIcon', iconColor: 'text-blue-600', iconBg: 'bg-blue-50' },
        ].map(k => (
          <KpiCard
            key={k.label}
            title={t(k.label)}
            value={k.value}
            subLabel={k.sub}
            icon={k.icon}
            iconColor={k.iconColor}
            iconBg={k.iconBg}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button onClick={() => setShowDatePicker(v => !v)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-card hover:bg-muted transition-colors">
              <Calendar size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground">{t('Periode Tanggal')}</span>
              <span className="font-medium text-foreground">
                {new Date(dateStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' – '}
                {new Date(dateEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute z-20 top-full mt-1 left-0 card p-3 w-64 space-y-2 shadow-card">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full text-xs py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90">
                  {t('Terapkan')}
                </button>
              </div>
            )}
          </div>

          <select value={customerFilter} onChange={ev => { setCustomerFilter(ev.target.value); setCurrentPage(1); }} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="all">{t('Semua Customer')}</option>
            {CUSTOMERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={taxStatusFilter} onChange={ev => { setTaxStatusFilter(ev.target.value); setCurrentPage(1); }} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="all">{t('Semua Status (Pajak)')}</option>
            {TAX_STATUSES.map(s => <option key={s} value={s}>{t(s)}</option>)}
          </select>

          <select value={postingStatusFilter} onChange={ev => { setPostingStatusFilter(ev.target.value); setCurrentPage(1); }} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="all">{t('Semua Status (Posting)')}</option>
            {POSTING_STATUSES.map(s => <option key={s} value={s}>{t(s)}</option>)}
          </select>

          <select value={projectFilter} onChange={ev => { setProjectFilter(ev.target.value); setCurrentPage(1); }} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="all">{t('Semua Project')}</option>
            {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <input
            type="text"
            value={search}
            onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
            placeholder={t('Cari no. invoice, customer, deskripsi...')}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground flex-1 min-w-[200px]"
          />

          <button onClick={resetFilters} className="text-xs text-primary hover:underline">{t('Reset')}</button>

          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors ml-auto">
            <Download size={12} /> {t('Export')}
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors">
            <Plus size={12} /> {t('Tambah Transaksi')}
          </button>
          <div className="relative">
            <button onClick={() => setShowSettings(v => !v)} className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors">
              <Settings size={14} className="text-muted-foreground" />
            </button>
            {showSettings && (
              <div className="absolute z-20 top-full mt-1 right-0 card p-3 w-48 space-y-1.5 shadow-card">
                <p className="text-[11px] font-semibold text-foreground mb-1">{t('Tampilkan Kolom')}</p>
                {([['pph', 'PPh'], ['dueDate', 'Due Date'], ['journal', 'Jurnal']] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={visibleCols[key]} onChange={() => setVisibleCols(v => ({ ...v, [key]: !v[key] }))} className="rounded border-border" />
                    {t(label)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4">
        <div className={`card overflow-hidden flex-1 min-w-0 transition-all ${selectedTrx ? 'xl:w-auto' : 'w-full'}`}>
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('Daftar Transaksi Penjualan')}</h3>
              <p className="text-xs text-muted-foreground">
                {filtered.length === 0
                  ? t('Menampilkan 0 dari 0 transaksi')
                  : `${t('Menampilkan')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('dari')} ${filtered.length} ${t('transaksi')}`}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2.5 px-3 w-8">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="rounded border-border" />
                  </th>
                  {[
                    'Tanggal', 'Invoice', 'Customer', 'Deskripsi', 'DPP', 'PPN',
                    ...(visibleCols.pph ? ['PPh'] : []),
                    'Gross', 'Paid', 'Outstanding',
                    ...(visibleCols.dueDate ? ['Due Date'] : []),
                    'Tipe Transaksi',
                    ...(visibleCols.journal ? ['Jurnal'] : []),
                    'Status', 'Aksi',
                  ].map(h => (
                    <th key={h} className="text-left py-2.5 px-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr><td colSpan={15} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td></tr>
                )}
                {paginated.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => openDetail(row)}
                    className={`border-b border-border/50 cursor-pointer transition-colors text-xs ${selectedTrx?.id === row.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                  >
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selectedRows.has(row.id)} onClick={ev => ev.stopPropagation()} onChange={() => toggleRow(row.id)} className="rounded border-border" />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.date}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-primary font-medium">{row.id}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-foreground">{row.customer}</td>
                    <td className="py-2 px-2 max-w-[120px] truncate text-muted-foreground">{row.desc}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-right">{formatIDR(row.dpp)}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-right">{formatIDR(row.ppn)}</td>
                    {visibleCols.pph && <td className="py-2 px-2 whitespace-nowrap text-right">{formatIDR(row.pph)}</td>}
                    <td className="py-2 px-2 whitespace-nowrap text-right font-semibold">{formatIDR(row.gross)}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-right text-emerald-600">{formatIDR(row.paid)}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-right text-amber-600">{row.outstanding > 0 ? formatIDR(row.outstanding) : 'Rp 0'}</td>
                    {visibleCols.dueDate && <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.dueDate}</td>}
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{t(row.type)}</td>
                    {visibleCols.journal && <td className="py-2 px-2 whitespace-nowrap text-primary text-xs">{row.journal || '—'}</td>}
                    <td className="py-2 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[row.status] || 'bg-muted text-muted-foreground'}`}>{t(row.status)}</span>
                    </td>
                    <td className="py-2 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <button onClick={() => setOpenMenuId(prev => (prev === row.id ? null : row.id))} className="p-1 hover:bg-muted rounded">
                        <MoreHorizontal size={13} className="text-muted-foreground" />
                      </button>
                      {openMenuId === row.id && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-40 card p-1 shadow-card">
                          <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Lihat')}
                          </button>
                          <button onClick={() => { openDetail(row); startEdit(row); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Edit size={12} /> {t('Edit')}
                          </button>
                          {row.status === 'Review' && (
                            <button onClick={() => approveTrx(row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-purple-600 hover:bg-purple-50 rounded-md">
                              <CheckCircle size={12} /> {t('Approve')}
                            </button>
                          )}
                          {row.status !== 'Posted' && (
                            <button onClick={() => postTrx(row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-md">
                              <Send size={12} /> {t('Post')}
                            </button>
                          )}
                          <button onClick={() => deleteTrx(row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md">
                            <Trash2 size={12} /> {t('Hapus')}
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
            <div className="flex items-center gap-2">
              <span>{t('Tampilkan')}</span>
              <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded px-2 py-1 text-xs bg-card">
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>{t('dari')} {filtered.length} {t('transaksi')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft size={14} /></button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => goToPage(p)} className={`w-6 h-6 rounded text-xs ${p === pageSafe ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{p}</button>
              ))}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>

        {/* Detail Drawer */}
        {selectedTrx && (
          <div className="w-80 flex-shrink-0 card p-4 space-y-3 self-start sticky top-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">{selectedTrx.id}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[selectedTrx.status]}`}>{t(selectedTrx.status)}</span>
              </div>
              <button onClick={() => { setSelectedId(null); setIsEditing(false); }} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <p className="text-xs text-muted-foreground">{selectedTrx.desc}</p>
            <p className="text-xs text-muted-foreground">{selectedTrx.date}</p>

            {!isEditing && (
              <div className="flex gap-1 border-b border-border pb-2">
                {[
                  { key: 'detail', label: 'Detail' },
                  { key: 'pembayaran', label: 'Pembayaran' },
                  { key: 'jurnal', label: 'Jurnal' },
                  { key: 'riwayat', label: 'Riwayat' },
                ].map(dt => (
                  <button key={dt.key} onClick={() => setDrawerTab(dt.key)} className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${drawerTab === dt.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{t(dt.label)}</button>
                ))}
              </div>
            )}

            {!isEditing && drawerTab === 'detail' && (
              <div className="space-y-2 text-xs">
                {[
                  ['Customer', selectedTrx.customer],
                  ['NPWP', '—'],
                  ['Tipe Transaksi', t(selectedTrx.type)],
                  ['Project', selectedTrx.project],
                  ['Sales Person', '—'],
                  ['Term of Payment', '—'],
                  ['Due Date', selectedTrx.dueDate],
                  ['Status Pajak', t(selectedTrx.taxStatus)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{t(k)}</span>
                    <span className="font-medium text-foreground text-right">{v}</span>
                  </div>
                ))}
                <div className="border-t border-border pt-2 space-y-1.5">
                  {[
                    ['DPP', formatIDR(selectedTrx.dpp)],
                    ['PPN (11%)', formatIDR(selectedTrx.ppn)],
                    ['PPh (1%)', formatIDR(selectedTrx.pph)],
                    ['Total (Gross)', formatIDR(selectedTrx.gross)],
                    ['Paid', formatIDR(selectedTrx.paid)],
                    ['Outstanding', formatIDR(selectedTrx.outstanding)],
                  ].map(([k, v]) => (
                    <div key={k} className={`flex justify-between ${k === 'Total (Gross)' ? 'font-semibold text-foreground' : ''}`}>
                      <span className="text-muted-foreground">{t(k)}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isEditing && drawerTab !== 'detail' && (
              <div className="text-xs text-muted-foreground text-center py-4">
                {drawerTab === 'pembayaran' && t('Riwayat pembayaran akan ditampilkan di sini.')}
                {drawerTab === 'jurnal' && `${t('Jurnal')}: ${selectedTrx.journal || t('Belum ada jurnal')}`}
                {drawerTab === 'riwayat' && t('Riwayat perubahan transaksi.')}
              </div>
            )}

            {isEditing && (
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Customer')}</label>
                  <input value={editForm.customer} onChange={ev => setEditForm(f => ({ ...f, customer: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Deskripsi')}</label>
                  <input value={editForm.desc} onChange={ev => setEditForm(f => ({ ...f, desc: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('DPP')}</label>
                  <input type="number" value={editForm.dpp} onChange={ev => setEditForm(f => ({ ...f, dpp: Number(ev.target.value) }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Project')}</label>
                  <select value={editForm.project} onChange={ev => setEditForm(f => ({ ...f, project: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                    {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
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
                <div className="flex gap-2 pt-2 border-t border-border">
                  <button onClick={() => { setDrawerTab('detail'); toast.info(t('Menampilkan detail transaksi')); }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                    <Eye size={12} /> {t('Lihat')}
                  </button>
                  <button onClick={() => startEdit()} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                    <Edit size={12} /> {t('Edit')}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveTrx(selectedTrx.id)}
                    disabled={selectedTrx.status !== 'Review'}
                    className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('Approve')}
                  </button>
                  <button
                    onClick={() => postTrx(selectedTrx.id)}
                    disabled={selectedTrx.status === 'Posted'}
                    className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('Post')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('Tambah Transaksi')}</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[11px] text-muted-foreground">{t('Tanggal')}</label>
                <input type="date" value={addForm.date} onChange={ev => setAddForm(f => ({ ...f, date: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('Customer')}</label>
                <input value={addForm.customer} onChange={ev => setAddForm(f => ({ ...f, customer: ev.target.value }))} placeholder={t('Nama customer')} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('Deskripsi')}</label>
                <input value={addForm.desc} onChange={ev => setAddForm(f => ({ ...f, desc: ev.target.value }))} placeholder={t('Deskripsi transaksi')} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('DPP')}</label>
                <input type="number" value={addForm.dpp} onChange={ev => setAddForm(f => ({ ...f, dpp: ev.target.value }))} placeholder="0" className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Tipe Transaksi')}</label>
                  <select value={addForm.type} onChange={ev => setAddForm(f => ({ ...f, type: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                    {TYPES.map(ty => <option key={ty} value={ty}>{t(ty)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Due Date')}</label>
                  <input type="date" value={addForm.dueDate} onChange={ev => setAddForm(f => ({ ...f, dueDate: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('Project')}</label>
                <select value={addForm.project} onChange={ev => setAddForm(f => ({ ...f, project: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5">
                  {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">{t('Batal')}</button>
              <button onClick={submitAddTransaction} className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors">{t('Simpan')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}