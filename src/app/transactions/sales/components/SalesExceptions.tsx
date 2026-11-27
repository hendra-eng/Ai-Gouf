'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, Search,
  X, Edit, CheckCircle, MoreHorizontal, Eye, Calendar,
  FileText, AlertTriangle, Receipt, Gauge, Copy,
} from 'lucide-react';
import { salesFont } from './salesFont';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useSalesExceptions, updateSalesException, useSalesInvoices,
  formatTanggalSingkat, type BackendSalesException,
} from '@/lib/salesStore';

type Priority = 'High' | 'Medium' | 'Low';
type ExceptionStatus = 'Open' | 'In Review' | 'Resolved';

type PillStyle = { pill: string; dot: string };

// Pill bergaris + titik berwarna -- gaya sama dengan STATUS_STYLE di tab Sales Transaction & Source Data.
const PRIORITY_STYLE: Record<Priority, PillStyle> = {
  High: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  Medium: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Low: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
};

const STATUS_STYLE: Record<ExceptionStatus, PillStyle> = {
  Open: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  'In Review': { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Resolved: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
};
const PILL_FALLBACK: PillStyle = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

function Pill({ style, label }: { style?: PillStyle; label: string }) {
  const st = style || PILL_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

// Gaya tombol netral (putih bergaris abu = sekunder, hitam = utama) -- sama dengan tab Sales Transaction.
const BTN_SECONDARY = 'border border-neutral-300 bg-white rounded-lg text-xs font-semibold text-neutral-800 shadow-sm hover:border-neutral-700 hover:bg-neutral-50 transition-colors';
const BTN_PRIMARY = 'bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const INPUT_CLS = 'w-full text-xs border border-neutral-300 rounded-lg px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300';

// ---------------------------------------------------------------------------
// Komponen tampilan -- disamakan dengan tab Sales Transaction & Source Data:
// kartu KPI, dropdown filter kustom, nomor halaman ringkas.
// ---------------------------------------------------------------------------
function ExceptionKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string;
  count: number;
  detail: string;
  detailUnit: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Dropdown filter kustom: selalu terbuka ke BAWAH, daftar bisa di-scroll, ada
// kolom cari bila opsinya banyak, hover/terpilih memakai hijau brand.
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
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-neutral-900 transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-neutral-300 bg-white shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-neutral-500">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`}
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

export default function SalesExceptions() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // userId = akun yang login (management_users) -- untuk kolom "siapa" (posted_by, mapped_by, assigned_to, resolved_by).
  // clientId = company aktif dari Switch Company (management_clients) -- untuk client_id & filter data, sama seperti Purchase.
  const userId = user?.id ?? null;
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ?? null;

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
      if (assignedFilter === 'me' && e.assigned_to !== userId) return false;
      const d = new Date(e.created_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [exceptions, search, severity, typeFilter, customerFilter, assignedFilter, dateStart, dateEnd, userId]);

  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
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
    setEditAssignToMe(selected.assigned_to === userId);
    setEditStatus(selected.status as ExceptionStatus);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateSalesException(selected.id, {
        exception_type: editType,
        assigned_to: editAssignToMe ? (userId ?? undefined) : null,
        status: editStatus,
        resolved_at: editStatus === 'Resolved' ? new Date().toISOString() : undefined,
        resolved_by: editStatus === 'Resolved' ? (userId ?? undefined) : undefined,
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
      await updateSalesException(id, { status: 'Resolved', resolved_at: new Date().toISOString(), resolved_by: userId ?? undefined });
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
    <div className={`${salesFont.className} space-y-4`}>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* KPI Cards -- desain sama dengan tab Sales Transaction */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {(() => {
          const total = exceptions.length;
          const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
          const unresolved = (rows: typeof exceptions) => rows.filter(e => e.status !== 'Resolved').length;
          const high = exceptions.filter(e => e.priority === 'High');
          const tax = exceptions.filter(e => e.exception_type === 'Tax status unclear');
          const lowConf = exceptions.filter(e => (e.ai_confidence ?? 0) < 40);
          const dup = exceptions.filter(e => e.exception_type === 'Duplicate invoice');
          const pctLabel = t('dari total exception');
          const tiles: { label: string; rows: typeof exceptions; icon: React.ElementType }[] = [
            { label: 'Total Exceptions', rows: exceptions, icon: FileText },
            { label: 'High Risk', rows: high, icon: AlertTriangle },
            { label: 'Missing Tax Info', rows: tax, icon: Receipt },
            { label: 'Low Confidence', rows: lowConf, icon: Gauge },
            { label: 'Duplicate Invoice', rows: dup, icon: Copy },
          ];
          return tiles.map(k => (
            <ExceptionKpiTile
              key={k.label}
              label={t(k.label)}
              count={k.rows.length}
              detail={unresolved(k.rows).toLocaleString('id-ID')}
              detailUnit={t('belum selesai')}
              pct={pctOf(k.rows.length)}
              pctLabel={pctLabel}
              icon={k.icon}
            />
          ));
        })()}
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4">
        {/* Table */}
        <div className="card flex-1 min-w-0">
          {/* Header + filter bar -- sama dengan Purchase Transaction List: judul kiri, Reset kanan; dropdown filter kiri, kolom cari (400px) kanan */}
          <div className="flex flex-col gap-3 px-0 py-3 border-b border-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Daftar Exception')}</h3>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {loading
                    ? t('Memuat...')
                    : filtered.length === 0
                    ? t('Menampilkan 0 dari 0 exception')
                    : `${t('Menampilkan')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('dari')} ${filtered.length} ${t('exception')}`}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={resetFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">{t('Reset')}</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}>
                  <Calendar size={12} className="text-neutral-500" />
                  <span className="text-neutral-500">{t('Periode Tanggal')}</span>
                  <span className="font-medium text-neutral-900">
                    {dateStart ? formatTanggalSingkat(dateStart) : t('Semua')}
                    {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
                  </span>
                </button>
                {showDatePicker && (
                  <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500">{t('Dari')}</label>
                      <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-neutral-500">{t('Sampai')}</label>
                      <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                    </div>
                    <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full rounded-[6px] bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700">
                      {t('Terapkan')}
                    </button>
                  </div>
                )}
              </div>

              <FilterSelect
                value={severity}
                onChange={v => { setSeverity(v); setCurrentPage(1); }}
                options={[
                  { value: 'all', label: t('Semua (Severity)') },
                  { value: 'High', label: t('High') },
                  { value: 'Medium', label: t('Medium') },
                  { value: 'Low', label: t('Low') },
                ]}
              />

              <FilterSelect
                value={typeFilter}
                onChange={v => { setTypeFilter(v); setCurrentPage(1); }}
                options={[{ value: 'all', label: t('Semua (Exception Type)') }, ...EXCEPTION_TYPES.map(type => ({ value: type, label: t(type) }))]}
              />

              <FilterSelect
                value={customerFilter}
                onChange={v => { setCustomerFilter(v); setCurrentPage(1); }}
                options={[{ value: 'all', label: t('Semua Customer') }, ...CUSTOMERS.map(c => ({ value: c, label: c }))]}
              />

              <FilterSelect
                value={assignedFilter}
                onChange={v => { setAssignedFilter(v); setCurrentPage(1); }}
                options={[
                  { value: 'all', label: t('Semua (Assigned To)') },
                  { value: 'unassigned', label: t('Belum Ditugaskan') },
                  { value: 'me', label: t('Ditugaskan ke Saya') },
                ]}
              />
              <div className="relative ml-auto w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={search}
                  onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
                  placeholder={t('Cari ID, nama pelanggan, atau masalah...')}
                  className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[800px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  <th className="py-2 px-3 w-8 border-t border-b border-neutral-800">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="rounded border-neutral-400 accent-neutral-800" />
                  </th>
                  {['Priority', 'Tanggal', 'Transaction/File ID', 'Customer', 'Exception Type', 'AI Confidence', 'Assigned To', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-2 px-2 text-center text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">{t('Tidak ada exception yang cocok dengan filter.')}</span></td>
                  </tr>
                )}
                {paginated.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => openDetail(e)}
                    className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selected?.id === e.id ? '[&>td]:bg-neutral-100' : ''}`}
                  >
                    <td className="py-2 px-3" onClick={ev => { ev.stopPropagation(); toggleRow(e.id); }}>
                      <input type="checkbox" checked={selectedRows.has(e.id)} onChange={() => toggleRow(e.id)} className="rounded border-neutral-400 accent-neutral-800" />
                    </td>
                    <td className="py-2 px-2">
                      <Pill style={PRIORITY_STYLE[e.priority as Priority]} label={t(e.priority)} />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{e.date}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{e.displayId}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-neutral-900">{e.customer}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{t(e.exception_type)}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${(e.ai_confidence ?? 0) < 40 ? 'text-red-600' : (e.ai_confidence ?? 0) < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{e.ai_confidence ?? 0}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{e.assigned_to ? (e.assigned_to === userId ? (user?.nama || user?.username) : t('User lain')) : '—'}</td>
                    <td className="py-2 px-2">
                      <Pill style={STATUS_STYLE[e.status as ExceptionStatus]} label={t(e.status)} />
                    </td>
                    <td className="py-2 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <button
                        onClick={() => setOpenMenuId(prev => (prev === e.id ? null : e.id))}
                        className="p-1 hover:bg-neutral-300 rounded transition-colors"
                      >
                        <MoreHorizontal size={13} className="text-neutral-600" />
                      </button>
                      {openMenuId === e.id && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg">
                          <button onClick={() => openDetail(e)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md">
                            <Eye size={12} /> {t('Lihat Detail')}
                          </button>
                          <button onClick={() => { openDetail(e); startEdit(); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md">
                            <Edit size={12} /> {t('Edit')}
                          </button>
                          <button onClick={() => resolveException(e.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100 rounded-md">
                            <CheckCircle size={12} /> {t('Tandai Resolved')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {/* Baris kosong pengisi: tinggi tabel selalu = "Baris per halaman", supaya layar tidak bergeser. */}
                {Array.from({ length: Math.max(0, pageSize - (paginated.length > 0 ? paginated.length : (!loading ? 1 : 0))) }).map((_, i) => (
                  <tr key={`pad-${i}`} aria-hidden="true" className="invisible text-xs">
                    <td colSpan={10} className="py-2 px-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium">&nbsp;</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-900 bg-card focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-neutral-900">
                  {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-neutral-900">{filtered.length}</span> {t('exception')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Halaman sebelumnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Halaman berikutnya')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Detail Drawer */}
        {selected && (
          <div className="relative w-80 flex-shrink-0 self-start sticky top-4 space-y-3 overflow-hidden rounded-xl border border-neutral-300 bg-white p-4 pt-5 shadow-sm">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">{t('Detail Exception')}</h3>
              <button onClick={() => { setSelectedId(null); setIsEditing(false); }} className="p-1 hover:bg-neutral-100 rounded"><X size={14} /></button>
            </div>
            <div className="flex items-center justify-between">
              <Pill style={PRIORITY_STYLE[selected.priority as Priority]} label={`${t(selected.priority)} ${t('Priority')}`} />
              <span className="text-xs text-neutral-500">ID: {selected.displayId}</span>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900">{t(selected.exception_type)}</h4>
              {selected.ai_suggestion && <p className="text-xs text-neutral-500 mt-0.5">{selected.ai_suggestion}</p>}
            </div>

            {!isEditing && (
              <div className="space-y-1.5 text-xs">
                {[
                  ['Tanggal', selected.date],
                  ['Customer', selected.customer],
                  ['Transaction ID', selected.displayId],
                  ['AI Confidence', <span key="c" className={`font-semibold ${(selected.ai_confidence ?? 0) < 40 ? 'text-red-600' : (selected.ai_confidence ?? 0) < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{selected.ai_confidence ?? 0}%</span>],
                  ['Status', <Pill key="s" style={STATUS_STYLE[selected.status as ExceptionStatus]} label={t(selected.status)} />],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex items-center justify-between">
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
                  <input value={editType} onChange={ev => setEditType(ev.target.value)} className={INPUT_CLS} />
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-900">
                  <input type="checkbox" checked={editAssignToMe} onChange={ev => setEditAssignToMe(ev.target.checked)} className="rounded border-neutral-400 accent-neutral-800" />
                  {t('Tugaskan ke saya')}
                </label>
                <div>
                  <label className="text-[11px] text-neutral-500">{t('Status')}</label>
                  <select value={editStatus} onChange={ev => setEditStatus(ev.target.value as ExceptionStatus)} className={INPUT_CLS}>
                    <option value="Open">{t('Open')}</option>
                    <option value="In Review">{t('In Review')}</option>
                    <option value="Resolved">{t('Resolved')}</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setIsEditing(false)} className={`flex-1 py-1.5 ${BTN_SECONDARY}`}>{t('Batal')}</button>
                  <button onClick={saveEdit} disabled={saving} className={`flex-1 py-1.5 ${BTN_PRIMARY}`}>{saving ? t('Menyimpan...') : t('Simpan')}</button>
                </div>
              </div>
            )}

            {!isEditing && (
              <>
                <div className="flex gap-1 border-b border-border pb-2">
                  {['source', 'ai', 'history'].map(tabKey => (
                    <button key={tabKey} onClick={() => setDrawerTab(tabKey)} className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${drawerTab === tabKey ? 'bg-blue-600 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
                      {tabKey === 'source' ? t('Source Data') : tabKey === 'ai' ? t('AI Suggestion') : t('History')}
                    </button>
                  ))}
                </div>

                {drawerTab === 'source' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-neutral-900">{t('Cuplikan Data Sumber')}</p>
                      <button onClick={viewOriginalFile} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">{t('Lihat File Asli ↗')}</button>
                    </div>
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] text-neutral-900 space-y-0.5">
                      {selected.source_snippet ? (
                        Object.entries(selected.source_snippet).map(([k, v]) => (
                          <p key={k}>{k}: {String(v)}</p>
                        ))
                      ) : (
                        <p className="text-neutral-500">{t('Belum ada cuplikan data sumber untuk exception ini.')}</p>
                      )}
                    </div>
                  </div>
                )}
                {drawerTab === 'ai' && (
                  <div className="text-xs text-neutral-500 space-y-2">
                    <p className="font-semibold text-neutral-900">{t('Saran AI')}</p>
                    <p>{selected.ai_suggestion || t('Belum ada saran AI untuk exception ini.')}</p>
                  </div>
                )}
                {drawerTab === 'history' && (
                  <div className="text-xs text-neutral-500">
                    <p>{selected.resolved_at ? `${t('Diselesaikan pada')} ${formatTanggalSingkat(selected.resolved_at)}` : t('Belum ada riwayat perubahan.')}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t border-neutral-200">
                  <button onClick={startEdit} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 ${BTN_SECONDARY}`}>
                    <Edit size={12} /> {t('Edit')}
                  </button>
                  <button onClick={() => acceptSuggestion(selected.id)} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 ${BTN_SECONDARY}`}>
                    <CheckCircle size={12} /> {t('Accept Suggestion')}
                  </button>
                </div>
                <button onClick={() => resolveException(selected.id)} className={`w-full py-1.5 flex items-center justify-center gap-1.5 ${BTN_PRIMARY}`}>
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