'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Download, Plus, Settings, ChevronLeft, ChevronRight, MoreHorizontal, X, Eye, Edit,
  Calendar, CheckCircle, Send, Trash2,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import KpiCard from '@/components/shared/KpiCard';
import {
  useSalesInvoices, createSalesInvoice, updateSalesInvoice, deleteSalesInvoice,
  createSalesActivityLog, formatTanggalSingkat, type BackendSalesInvoice,
} from '@/lib/salesStore';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type TrxStatus = 'Draft' | 'Review' | 'Approved' | 'Posted' | 'Partial' | 'Paid';

// Bentuk baris tabel di UI ini -- dipetakan dari BackendSalesInvoice
// (backend/modules/transactions/sales_v1.py). `id` di sini tetap
// invoice_no (yang tampil di tabel/URL), `uuid` menyimpan id asli
// (primary key UUID) yang dipakai untuk panggilan PUT/DELETE ke backend.
interface TrxItem {
  uuid: string;
  id: string; // invoice_no
  date: string; // tampilan "02 Jan 2024"
  dateISO: string;
  customer: string;
  cabang: string;
  desc: string;
  dpp: number;
  ppn: number;
  pph: number;
  gross: number;
  paid: number;
  outstanding: number;
  dueDate: string;
  dueDateISO: string;
  type: string;
  journal: string;
  status: TrxStatus;
  project: string;
  taxStatus: string;
}

function petakanDariBackend(inv: BackendSalesInvoice): TrxItem {
  return {
    uuid: inv.id,
    id: inv.invoice_no,
    date: formatTanggal(inv.invoice_date),
    dateISO: inv.invoice_date,
    customer: inv.customer_name,
    cabang: inv.cabang || '-',
    desc: inv.description || '',
    dpp: inv.dpp,
    ppn: inv.ppn,
    pph: inv.pph,
    gross: inv.gross_amount,
    paid: inv.paid_amount,
    outstanding: inv.outstanding_amount,
    dueDate: inv.due_date ? formatTanggal(inv.due_date) : '-',
    dueDateISO: inv.due_date || '',
    type: inv.transaction_type || '-',
    journal: inv.journal_entry_id != null ? String(inv.journal_entry_id) : '',
    status: (inv.posting_status as TrxStatus) || 'Draft',
    project: inv.project_name || '-',
    taxStatus: inv.tax_invoice_status,
  };
}

function formatTanggal(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '-';
  }
}

const STATUS_STYLE: Record<string, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Partial: 'bg-amber-100 text-amber-700',
  Draft: 'bg-gray-100 text-gray-600',
  Posted: 'bg-blue-100 text-blue-700',
  Review: 'bg-orange-100 text-orange-700',
  Approved: 'bg-purple-100 text-purple-700',
};

const TRANSACTION_TYPES = ['Penjualan Barang', 'Penjualan Jasa'];
const POSTING_STATUSES: TrxStatus[] = ['Draft', 'Review', 'Approved', 'Posted', 'Partial', 'Paid'];

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  customer: '',
  cabang: '',
  desc: '',
  dpp: '',
  type: TRANSACTION_TYPES[0],
  project: '',
  dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
};

export default function SalesTransaction() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { invoices: backendInvoices, loading, error, refresh } = useSalesInvoices(clientId);
  const transactions = useMemo(() => backendInvoices.map(petakanDariBackend), [backendInvoices]);

  // Filters
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [taxStatusFilter, setTaxStatusFilter] = useState('all');
  const [postingStatusFilter, setPostingStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const CUSTOMERS = useMemo(() => Array.from(new Set(transactions.map(r => r.customer))), [transactions]);
  const BRANCHES = useMemo(() => Array.from(new Set(transactions.map(r => r.cabang).filter(b => b !== '-'))).sort(), [transactions]);
  const PROJECTS = useMemo(() => Array.from(new Set(transactions.map(r => r.project).filter(p => p !== '-'))), [transactions]);
  const TAX_STATUSES = useMemo(() => Array.from(new Set(transactions.map(r => r.taxStatus))), [transactions]);

  // Table selection / drawer
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Edit drawer
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ customer: '', cabang: '', desc: '', dpp: 0, project: '', dueDate: '' });
  const [saving, setSaving] = useState(false);

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
      if (branchFilter !== 'all' && r.cabang !== branchFilter) return false;
      if (taxStatusFilter !== 'all' && r.taxStatus !== taxStatusFilter) return false;
      if (postingStatusFilter !== 'all' && r.status !== postingStatusFilter) return false;
      if (projectFilter !== 'all' && r.project !== projectFilter) return false;
      const d = r.dateISO ? new Date(r.dateISO) : null;
      if (start && d && d < start) return false;
      if (end && d && d > end) return false;
      return true;
    });
  }, [transactions, search, customerFilter, branchFilter, taxStatusFilter, postingStatusFilter, projectFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const selectedTrx = transactions.find(r => r.uuid === selectedUuid) || null;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setCustomerFilter('all'); setBranchFilter('all'); setTaxStatusFilter('all'); setPostingStatusFilter('all');
    setProjectFilter('all'); setDateStart(''); setDateEnd('');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.uuid));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(r => next.delete(r.uuid));
      else paginated.forEach(r => next.add(r.uuid));
      return next;
    });
  };

  const openDetail = (row: TrxItem) => {
    setSelectedUuid(row.uuid);
    setDrawerTab('detail');
    setIsEditing(false);
    setOpenMenuId(null);
  };

  const startEdit = (row?: TrxItem) => {
    const target = row || selectedTrx;
    if (!target) return;
    setEditForm({ customer: target.customer, cabang: target.cabang === '-' ? '' : target.cabang, desc: target.desc, dpp: target.dpp, project: target.project === '-' ? '' : target.project, dueDate: target.dueDateISO });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedTrx) return;
    const dpp = Number(editForm.dpp) || 0;
    const ppn = Math.round(dpp * 0.11);
    const pph = Math.round(dpp * 0.01);
    const gross = dpp + ppn - pph;
    setSaving(true);
    try {
      await updateSalesInvoice(selectedTrx.uuid, {
        customer_name: editForm.customer,
        cabang: editForm.cabang.trim() || null,
        description: editForm.desc,
        dpp, ppn, pph,
        gross_amount: gross,
        project_name: editForm.project || undefined,
        due_date: editForm.dueDate || undefined,
      });
      setIsEditing(false);
      toast.success(t('Perubahan disimpan'), { description: selectedTrx.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyimpan perubahan'));
    } finally {
      setSaving(false);
    }
  };

  const approveTrx = async (uuid: string, invoiceNo: string) => {
    try {
      await updateSalesInvoice(uuid, { posting_status: 'Approved' });
      toast.success(t('Transaksi disetujui'), { description: invoiceNo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyetujui transaksi'));
    }
    setOpenMenuId(null);
  };

  const postTrx = async (uuid: string, invoiceNo: string) => {
    try {
      await updateSalesInvoice(uuid, {
        posting_status: 'Posted',
        posted_at: new Date().toISOString(),
        posted_by: clientId ?? undefined,
      });
      await createSalesActivityLog({
        client_id: clientId ?? undefined,
        invoice_id: uuid,
        event_type: 'POSTING',
        description: 'Berhasil memposting faktur penjualan',
        reference_no: invoiceNo,
        performed_by: user?.nama || user?.username || 'System',
      }).catch(() => {});
      toast.success(t('Transaksi diposting ke jurnal'), { description: invoiceNo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal memposting transaksi'));
    }
    setOpenMenuId(null);
  };

  const deleteTrx = async (uuid: string, invoiceNo: string) => {
    try {
      await deleteSalesInvoice(uuid);
      if (selectedUuid === uuid) setSelectedUuid(null);
      toast.success(t('Transaksi dihapus'), { description: invoiceNo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menghapus transaksi'));
    }
    setOpenMenuId(null);
  };

  const handleExport = () => {
    const headers = ['Date', 'Invoice', 'Customer', 'Branch', 'Description', 'Tax Base (DPP)', 'VAT', 'Withholding Tax (PPh)', 'Gross', 'Paid', 'Outstanding', 'Due Date', 'Type', 'Journal', 'Status'];
    const rows = filtered.map(r => [r.date, r.id, r.customer, r.cabang, r.desc, r.dpp, r.ppn, r.pph, r.gross, r.paid, r.outstanding, r.dueDate, t(r.type), r.journal, r.status]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('Export berhasil'), { description: `${filtered.length} ${t('baris diunduh sebagai CSV.')}` });
  };

  const submitAddTransaction = async () => {
    if (!addForm.customer.trim() || !addForm.desc.trim() || !addForm.dpp) {
      toast.error(t('Lengkapi Customer, Deskripsi, dan DPP terlebih dahulu.'));
      return;
    }
    if (!clientId) {
      toast.error(t('Sesi login tidak ditemukan, silakan login ulang.'));
      return;
    }
    const dpp = Number(addForm.dpp) || 0;
    const ppn = Math.round(dpp * 0.11);
    const pph = Math.round(dpp * 0.01);
    const gross = dpp + ppn - pph;
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    try {
      await createSalesInvoice({
        client_id: clientId,
        invoice_no: invoiceNo,
        invoice_date: addForm.date,
        due_date: addForm.dueDate,
        customer_name: addForm.customer.trim(),
        cabang: addForm.cabang.trim() || undefined,
        description: addForm.desc.trim(),
        transaction_type: addForm.type,
        project_name: addForm.project || undefined,
        dpp, ppn, pph,
        gross_amount: gross,
        paid_amount: 0,
        tax_invoice_status: 'Belum Terbit Faktur',
        posting_status: 'Draft',
      });
      setShowAddModal(false);
      setAddForm(emptyForm);
      setCurrentPage(1);
      toast.success(t('Transaksi ditambahkan'), { description: invoiceNo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menambah transaksi'));
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* Saran nama cabang (dari cabang yang sudah ada) untuk input Cabang di form Tambah/Edit */}
      <datalist id="sales-branch-options">
        {BRANCHES.map(b => <option key={b} value={b} />)}
      </datalist>

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
                {dateStart ? formatTanggalSingkat(dateStart) : t('Semua')}
                {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
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

          <select value={branchFilter} onChange={ev => { setBranchFilter(ev.target.value); setCurrentPage(1); }} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="all">{t('All Branches')}</option>
            {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
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
                {loading
                  ? t('Memuat...')
                  : filtered.length === 0
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
                    'Tanggal', 'Invoice', 'Customer', 'Cabang', 'Deskripsi', 'DPP', 'PPN',
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
                {!loading && paginated.length === 0 && (
                  <tr><td colSpan={16} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td></tr>
                )}
                {paginated.map(row => (
                  <tr
                    key={row.uuid}
                    onClick={() => openDetail(row)}
                    className={`border-b border-border/50 cursor-pointer transition-colors text-xs ${selectedTrx?.uuid === row.uuid ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                  >
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selectedRows.has(row.uuid)} onClick={ev => ev.stopPropagation()} onChange={() => toggleRow(row.uuid)} className="rounded border-border" />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.date}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-primary font-medium">{row.id}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-foreground">{row.customer}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{row.cabang}</td>
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
                      <button onClick={() => setOpenMenuId(prev => (prev === row.uuid ? null : row.uuid))} className="p-1 hover:bg-muted rounded">
                        <MoreHorizontal size={13} className="text-muted-foreground" />
                      </button>
                      {openMenuId === row.uuid && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-40 card p-1 shadow-card">
                          <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Lihat')}
                          </button>
                          <button onClick={() => { openDetail(row); startEdit(row); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Edit size={12} /> {t('Edit')}
                          </button>
                          {row.status === 'Review' && (
                            <button onClick={() => approveTrx(row.uuid, row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-purple-600 hover:bg-purple-50 rounded-md">
                              <CheckCircle size={12} /> {t('Approve')}
                            </button>
                          )}
                          {row.status !== 'Posted' && (
                            <button onClick={() => postTrx(row.uuid, row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-md">
                              <Send size={12} /> {t('Post')}
                            </button>
                          )}
                          <button onClick={() => deleteTrx(row.uuid, row.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md">
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
              <button onClick={() => { setSelectedUuid(null); setIsEditing(false); }} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
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
                  ['Cabang', selectedTrx.cabang],
                  ['Tipe Transaksi', t(selectedTrx.type)],
                  ['Project', selectedTrx.project],
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
                  <label className="text-[11px] text-muted-foreground">{t('Cabang')}</label>
                  <input value={editForm.cabang} list="sales-branch-options" onChange={ev => setEditForm(f => ({ ...f, cabang: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
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
                  <input value={editForm.project} onChange={ev => setEditForm(f => ({ ...f, project: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setIsEditing(false)} className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">{t('Batal')}</button>
                  <button onClick={saveEdit} disabled={saving} className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50">{saving ? t('Menyimpan...') : t('Simpan')}</button>
                </div>
              </div>
            )}

            {!isEditing && (
              <>
                <div className="flex gap-2 pt-2 border-t border-border">
                  <button onClick={() => { setDrawerTab('detail'); }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                    <Eye size={12} /> {t('Lihat')}
                  </button>
                  <button onClick={() => startEdit()} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                    <Edit size={12} /> {t('Edit')}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveTrx(selectedTrx.uuid, selectedTrx.id)}
                    disabled={selectedTrx.status !== 'Review'}
                    className="flex-1 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('Approve')}
                  </button>
                  <button
                    onClick={() => postTrx(selectedTrx.uuid, selectedTrx.id)}
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
                <label className="text-[11px] text-muted-foreground">{t('Cabang')}</label>
                <input value={addForm.cabang} list="sales-branch-options" onChange={ev => setAddForm(f => ({ ...f, cabang: ev.target.value }))} placeholder={t('Nama cabang (opsional)')} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
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
                    {TRANSACTION_TYPES.map(ty => <option key={ty} value={ty}>{t(ty)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Due Date')}</label>
                  <input type="date" value={addForm.dueDate} onChange={ev => setAddForm(f => ({ ...f, dueDate: ev.target.value }))} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('Project')}</label>
                <input value={addForm.project} onChange={ev => setAddForm(f => ({ ...f, project: ev.target.value }))} placeholder={t('Nama project (opsional)')} className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground mt-0.5" />
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
