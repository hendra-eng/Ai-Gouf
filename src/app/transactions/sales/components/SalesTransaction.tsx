'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import PrintMenu from '@/components/shared/PrintMenu';
import { printReport, type PrintColumn, type PrintFormat, type PrintReport } from '@/lib/printExport';
import {
  Settings, ChevronLeft, ChevronRight, MoreHorizontal, X, Eye, Edit,
  Calendar, CheckCircle, Send, Trash2, ChevronDown, Check, Search, FileText, Clock, Banknote,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useSalesInvoices, updateSalesInvoice, deleteSalesInvoice,
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

// Laporan Print (CSV / Excel / PDF): daftar = 1 baris per invoice sesuai
// kolom tabel; detail = 1 invoice dengan rincian DPP/PPN/PPh/Gross.
const SALES_PRINT_COLUMNS: PrintColumn[] = [
  { key: 'date', header: 'Date', width: 12 },
  { key: 'id', header: 'Invoice', width: 20 },
  { key: 'customer', header: 'Customer', width: 26 },
  { key: 'cabang', header: 'Branch', width: 14 },
  { key: 'desc', header: 'Description', width: 30 },
  { key: 'dpp', header: 'Tax Base (DPP)', type: 'money' },
  { key: 'ppn', header: 'VAT (PPN)', type: 'money' },
  { key: 'pph', header: 'WHT (PPh)', type: 'money' },
  { key: 'gross', header: 'Gross', type: 'money' },
  { key: 'paid', header: 'Paid', type: 'money' },
  { key: 'outstanding', header: 'Outstanding', type: 'money' },
  { key: 'dueDate', header: 'Due Date', width: 12 },
  { key: 'type', header: 'Type', width: 16 },
  { key: 'journal', header: 'Journal', width: 10 },
  { key: 'status', header: 'Status', width: 10 },
];

function buildSalesListReport(rows: TrxItem[], companyName?: string, printedBy?: string): PrintReport {
  const sum = (k: 'dpp' | 'ppn' | 'pph' | 'gross' | 'paid' | 'outstanding') => rows.reduce((s, r) => s + r[k], 0);
  return {
    title: 'Sales Transactions',
    fileBase: 'Sales-Transactions',
    companyName,
    printedBy,
    subtitle: `${rows.length} transactions`,
    orientation: 'landscape',
    table: {
      columns: SALES_PRINT_COLUMNS,
      rows: rows.map(r => ({ ...r, journal: r.journal || '' })),
      totals: { desc: 'TOTAL', dpp: sum('dpp'), ppn: sum('ppn'), pph: sum('pph'), gross: sum('gross'), paid: sum('paid'), outstanding: sum('outstanding') },
    },
  };
}

function buildSalesDetailReport(r: TrxItem, companyName?: string, printedBy?: string): PrintReport {
  return {
    title: 'Sales Invoice',
    fileBase: `Sales-${r.id}`,
    companyName,
    printedBy,
    subtitle: r.id,
    orientation: 'portrait',
    fields: [
      ['Invoice', r.id],
      ['Status', r.status],
      ['Invoice Date', r.date],
      ['Due Date', r.dueDate],
      ['Customer', r.customer],
      ['Branch', r.cabang],
      ['Transaction Type', r.type],
      ['Project', r.project],
      ['Tax Invoice Status', r.taxStatus],
      ['Journal', r.journal || '—'],
    ],
    table: {
      columns: [
        { key: 'desc', header: 'Description', width: 40 },
        { key: 'dpp', header: 'Tax Base (DPP)', type: 'money' },
        { key: 'ppn', header: 'VAT (PPN 11%)', type: 'money' },
        { key: 'pph', header: 'WHT (PPh 1%)', type: 'money' },
        { key: 'gross', header: 'Gross', type: 'money' },
      ],
      rows: [{ desc: r.desc || '—', dpp: r.dpp, ppn: r.ppn, pph: r.pph, gross: r.gross }],
    },
    summary: [
      ['Total (Gross)', r.gross, 'money'],
      ['Paid', r.paid, 'money'],
      ['Outstanding', r.outstanding, 'money'],
    ],
  };
}

const POSTING_STATUSES: TrxStatus[] = ['Draft', 'Review', 'Approved', 'Posted', 'Partial', 'Paid'];

// Dropdown filter kustom: selalu terbuka ke BAWAH (select bawaan browser bisa
// membuka ke atas), daftar bisa di-scroll, ada kolom cari bila opsinya banyak,
// dan warna hover/terpilih memakai hijau brand (select bawaan memakai biru OS).
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[#6EE7B7] hover:text-[#064E3B] ${selected ? 'bg-[#D1FAE5] font-semibold text-[#065F46]' : 'text-foreground'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Kartu KPI untuk ringkasan status transaksi: garis tepi hijau tipis, aksen warna
// di sisi atas sesuai jenis, angka besar, nominal, dan bar proporsi terhadap total.
type KpiTone = 'slate' | 'amber' | 'green' | 'sky';
const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string }> = {
  // Semua nada memakai keluarga hijau brand aplikasi, dari terang ke tua.
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]' },
};

function SalesKpiTile({ label, count, amount, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  count: number;
  amount: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-primary/60 bg-white p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide text-slate-700">{label}</p>
          <p className="mt-2 text-4xl font-extrabold leading-none tabular-nums text-[#064E3B]">{count.toLocaleString('id-ID')}</p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${c.iconBg}`}>
          <Icon size={24} className={c.iconText} />
        </span>
      </div>
      <p className="mt-3 truncate text-lg font-bold text-slate-900">{amount}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${count > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
      <p className="mt-1.5 text-xs font-semibold text-slate-600">{pct}% {pctLabel}</p>
    </div>
  );
}

// Nomor halaman ringkas: 1 … 4 5 6 … 28 (tidak menampilkan seluruh halaman).
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

export default function SalesTransaction() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { clients, activeClientId, activeClientName } = useActiveClient();
  const companyName = clients.find(c => c.id === activeClientId)?.companyName || activeClientName || undefined;
  const printedBy = user?.nama || user?.username || undefined;
  // Daftar invoice per company aktif (bukan per user login).
  const { invoices: backendInvoices, loading, error, refresh } = useSalesInvoices(activeClientId ?? null);
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
        // Invoice Posted langsung terbaca GL/Financial Statements (ambil_baris_jurnal_posted_transaksi).
        journal_sync_status: 'Synced',
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

  // Print daftar = semua transaksi yang lolos filter (bukan cuma halaman aktif).
  const printList = async (format: PrintFormat) => {
    await printReport(buildSalesListReport(filtered.map(r => ({ ...r, type: t(r.type) })), companyName, printedBy), format);
    toast.success(t('Export berhasil'), { description: `${filtered.length} ${t('transaksi')}` });
  };
  const printDetail = async (format: PrintFormat) => {
    if (!selectedTrx) return;
    await printReport(buildSalesDetailReport({ ...selectedTrx, type: t(selectedTrx.type), taxStatus: t(selectedTrx.taxStatus) }, companyName, printedBy), format);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* Saran nama cabang (dari cabang yang sudah ada) untuk input Cabang di form Edit */}
      <datalist id="sales-branch-options">
        {BRANCHES.map(b => <option key={b} value={b} />)}
      </datalist>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(() => {
          const total = transactions.length;
          const sumGross = (rows: typeof transactions) => rows.reduce((acc, r) => acc + r.gross, 0);
          const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
          const draft = transactions.filter(r => r.status === 'Draft');
          const review = transactions.filter(r => r.status === 'Review');
          const posted = transactions.filter(r => r.status === 'Posted' || r.status === 'Paid' || r.status === 'Partial');
          const owing = transactions.filter(r => r.outstanding > 0);
          const owingTotal = transactions.reduce((acc, r) => acc + r.outstanding, 0);
          const pctLabel = t('dari total transaksi');
          const tiles: { label: string; rows: typeof transactions; amount: number; tone: KpiTone; icon: React.ElementType }[] = [
            { label: 'Draft', rows: draft, amount: sumGross(draft), tone: 'slate', icon: FileText },
            { label: 'Ready for Approval', rows: review, amount: sumGross(review), tone: 'amber', icon: Clock },
            { label: 'Posted', rows: posted, amount: sumGross(posted), tone: 'green', icon: CheckCircle },
            { label: 'Outstanding AR', rows: owing, amount: owingTotal, tone: 'sky', icon: Banknote },
          ];
          return tiles.map(k => (
            <SalesKpiTile
              key={k.label}
              label={t(k.label)}
              count={k.rows.length}
              amount={formatIDR(k.amount)}
              pct={pctOf(k.rows.length)}
              pctLabel={pctLabel}
              tone={k.tone}
              icon={k.icon}
            />
          ));
        })()}
      </div>

      {/* Filters */}
      <div className="card p-3 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}>
              <Calendar size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground">{t('Periode Tanggal')}</span>
              <span className="font-medium text-foreground">
                {dateStart ? formatTanggalSingkat(dateStart) : t('Semua')}
                {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-slate-300 bg-white p-3 shadow-xl">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-slate-300 rounded-[6px] px-2 py-1.5 bg-white text-foreground mt-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-slate-300 rounded-[6px] px-2 py-1.5 bg-white text-foreground mt-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full text-xs py-2 bg-primary text-primary-foreground rounded-[6px] font-semibold hover:opacity-90">
                  {t('Terapkan')}
                </button>
              </div>
            )}
          </div>

          <FilterSelect
            value={customerFilter}
            onChange={v => { setCustomerFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('Semua Customer') }, ...CUSTOMERS.map(c => ({ value: c, label: c }))]}
          />

          <FilterSelect
            value={branchFilter}
            onChange={v => { setBranchFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('All Branches') }, ...BRANCHES.map(b => ({ value: b, label: b }))]}
          />

          <FilterSelect
            value={taxStatusFilter}
            onChange={v => { setTaxStatusFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('Semua Status (Pajak)') }, ...TAX_STATUSES.map(s => ({ value: s, label: t(s) }))]}
          />

          <FilterSelect
            value={postingStatusFilter}
            onChange={v => { setPostingStatusFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('Semua Status (Posting)') }, ...POSTING_STATUSES.map(s => ({ value: s, label: t(s) }))]}
          />

          <FilterSelect
            value={projectFilter}
            onChange={v => { setProjectFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('Semua Project') }, ...PROJECTS.map(p => ({ value: p, label: p }))]}
          />

          <div className="relative ml-auto w-full sm:w-[400px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
            <input
              type="text"
              value={search}
              onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
              placeholder="Search Invoice..."
              className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Baris kedua: aksi Reset, Print All, Settings (rata kanan) */}
          <div className="flex w-full items-center justify-end gap-2">
          <button onClick={resetFilters} className="text-xs text-primary hover:underline">{t('Reset')}</button>

          <PrintMenu onPrint={printList} label={t('Print All')} disabled={loading || filtered.length === 0} />
          <div className="relative">
            <button onClick={() => setShowSettings(v => !v)} className="p-1.5 border border-border rounded-[6px] hover:bg-muted transition-colors">
              <Settings size={14} className="text-muted-foreground" />
            </button>
            {showSettings && (
              <div className="absolute z-30 top-full mt-1 right-0 w-48 space-y-1.5 rounded-[6px] border border-slate-300 bg-white p-3 shadow-xl">
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
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4">
        <div className={`card overflow-hidden flex-1 min-w-0 transition-all ${selectedTrx ? 'xl:w-auto' : 'w-full'}`}>
          <div className="px-0 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-foreground">{t('Daftar Transaksi Penjualan')}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
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
                <tr className="bg-[#8FE3B5]">
                  <th className="py-2.5 px-3 w-8 border-t-2 border-b border-[#0A4A32]">
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
                    <th key={h} className={`text-left py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]`}>{t(h)}</th>
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
                    className={`border-b border-slate-300/70 cursor-pointer transition-colors text-xs ${selectedTrx?.uuid === row.uuid ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
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
          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-foreground">{filtered.length}</span> {t('transaksi')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Halaman sebelumnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Halaman berikutnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
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
                <PrintMenu onPrint={printDetail} label={t('Print')} align="left" className="pt-2 border-t border-border" />
                <div className="flex gap-2">
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
    </div>
  );
}