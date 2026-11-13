'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import ImportPurchaseModal from '@/app/transactions/purchase/components/ImportPurchaseModal';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import MappingRulesModal from '@/app/transactions/components/MappingRulesModal';
import SourceKpiTile, { type KpiTone } from '@/components/shared/ProgressKpiTile';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseSourceRecords, mapSourceRecordToUi, listPurchaseImportTemplates } from '@/lib/purchaseStore';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import { Upload, Download, Settings, CheckCircle, Clock, AlertTriangle, FileText, MoreHorizontal, Eye, ChevronLeft, ChevronRight, ChevronDown, Check, Search, X } from 'lucide-react';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type SourceStatus = 'Mapped' | 'Pending Mapping' | 'Validation Error' | 'Imported';
type ValidationStatus = 'Valid' | 'Pending Validation' | 'Invalid';

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

const sourceTypeColors: Record<string, string> = {
  'Purchase Order': 'bg-blue-100 text-blue-700',
  'Vendor Invoice': 'bg-indigo-100 text-indigo-700',
  'Goods Receipt': 'bg-emerald-100 text-emerald-700',
  'Service Receipt': 'bg-teal-100 text-teal-700',
  'Supplier Bill': 'bg-cyan-100 text-cyan-700',
  'Expense Claim': 'bg-orange-100 text-orange-700',
  'Recurring Purchase': 'bg-purple-100 text-purple-700',
  Manual: 'bg-slate-100 text-slate-700',
};

// Badge status -- bentuk pil, ukuran & warna sama dengan tabel Source Data Sales.
const BADGE_BASE = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';
const SOURCE_STATUS_CLS: Record<SourceStatus, string> = {
  Mapped: 'bg-emerald-100 text-emerald-700',
  'Pending Mapping': 'bg-amber-100 text-amber-700',
  'Validation Error': 'bg-red-100 text-red-700',
  Imported: 'bg-blue-100 text-blue-700',
};
const VALIDATION_CLS: Record<ValidationStatus, string> = {
  Valid: 'bg-emerald-100 text-emerald-700',
  'Pending Validation': 'bg-amber-100 text-amber-700',
  Invalid: 'bg-red-100 text-red-700',
};

function SourceStatusBadge({ status }: { status: SourceStatus }) {
  return <span className={`${BADGE_BASE} ${SOURCE_STATUS_CLS[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>;
}

function ValidationBadge({ status }: { status: ValidationStatus }) {
  return <span className={`${BADGE_BASE} ${VALIDATION_CLS[status] || 'bg-muted text-muted-foreground'}`}>{status}</span>;
}

// Panel putih dengan header terpisah garis -- sama dengan SourcePanel di Sales.
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
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, idx) => {
    if (idx > 0 && n - sorted[idx - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

// Dropdown filter -- sama dengan FilterSelect di tab Sales Transaction: tombol berborder hijau,
// selalu terbuka ke bawah, kolom cari bila opsi banyak, hover/terpilih hijau brand.
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
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
                placeholder="Search..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Not found</li>}
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

export default function PurchaseSourceDataPage() {
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const clientId = activeClientId ?? null;
  const { records: backendRecords } = usePurchaseSourceRecords(clientId);
  const purchaseSourceRecords = useMemo(() => backendRecords.map(mapSourceRecordToUi), [backendRecords]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [sortField, setSortField] = useState('sourceDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRow, setSelectedRow] = useState<typeof purchaseSourceRecords[0] | null>(null);

  const sourceTypes = ['All', 'Purchase Order', 'Vendor Invoice', 'Goods Receipt', 'Service Receipt'];
  const statuses = ['All', 'Mapped', 'Pending Mapping', 'Validation Error', 'Imported'];
  const uniqueVendors = ['All', ...Array.from(new Set(purchaseSourceRecords.map(r => r.vendor)))];

  const filtered = useMemo(() => {
    let data = [...purchaseSourceRecords];
    if (search) data = data.filter(r =>
      r.sourceId.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase()) ||
      r.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.poNumber.toLowerCase().includes(search.toLowerCase())
    );
    if (typeFilter !== 'All') data = data.filter(r => r.sourceType === typeFilter);
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (vendorFilter !== 'All') data = data.filter(r => r.vendor === vendorFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [purchaseSourceRecords, search, typeFilter, statusFilter, vendorFilter, sortField, sortDir]);
  // Paging gaya tab Source Data Sales (pilih baris per halaman 10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [menuRowId, setMenuRowId] = useState<string | number | null>(null);
  useEffect(() => { setCurrentPage(1); }, [search, typeFilter, statusFilter, vendorFilter, sortField, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));


  // ── Action bar (pola sama dengan tab Source Data Sales) ──
  // Upload File = ImportPurchaseModal yang sama dengan tab Transaction (file
  // dicocokkan ke Purchase Import Template company aktif di backend).
  const [showImport, setShowImport] = useState(false);
  const handleUploadClick = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    setShowImport(true);
  };

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Purchase Template');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Source Type', key: 'type', width: 18 },
      { header: 'Vendor Code', key: 'vendorCode', width: 14 },
      { header: 'Vendor Name', key: 'vendor', width: 26 },
      { header: 'Invoice No.', key: 'invoice', width: 18 },
      { header: 'PO Number', key: 'po', width: 18 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount (IDR)', key: 'amount', width: 16 },
      { header: 'Tax (IDR)', key: 'tax', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      date: '01/12/2024', type: 'Vendor Invoice', vendorCode: 'SUP-001', vendor: 'PT Example Supplier',
      invoice: 'INV-SUP-001', po: 'PO-2024-001', description: 'Inventory purchase', amount: 10000000, tax: 1100000, total: 11100000,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), 'Purchase_Data_Template.xlsx');
    toast.success('Excel template downloaded');
  };

  // Export = semua baris hasil filter/sort saat ini, bukan cuma 1 halaman.
  const handleExport = async () => {
    if (filtered.length === 0) {
      toast.info('No source records to export.');
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Source ID', key: 'sourceId', width: 18 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Vendor', key: 'vendor', width: 26 },
      { header: 'Vendor ID', key: 'vendorId', width: 14 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Period', key: 'period', width: 12 },
      { header: 'Invoice No.', key: 'invoice', width: 18 },
      { header: 'PO Number', key: 'po', width: 18 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount', key: 'amount', width: 16 },
      { header: 'Tax', key: 'tax', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Purchase Ref', key: 'ref', width: 18 },
      { header: 'Validation', key: 'validation', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    filtered.forEach(r => sheet.addRow({
      sourceId: r.sourceId, type: r.sourceType, vendor: r.vendor, vendorId: r.vendorId || '-',
      date: r.sourceDate, period: r.period, invoice: r.invoiceNumber || '-', po: r.poNumber || '-',
      description: r.description, amount: r.amount, tax: r.taxAmount, total: r.totalAmount,
      ref: r.relatedPurchaseId || '-', validation: r.validationStatus, status: r.status,
    }));
    ['amount', 'tax', 'total'].forEach(k => { sheet.getColumn(k).numFmt = '#,##0'; });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), `Purchase_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Export successful', { description: `${filtered.length} rows downloaded as Excel.` });
  };

  // Mapping Rules: import Purchase SELALU lewat template berformat kompleks
  // (blok laporan cetak, bukan {field: nama_kolom} flat) -- modal menampilkan
  // template aktif company + field mapping-nya (read-only).
  const [showMapping, setShowMapping] = useState(false);
  const loadTemplates = useCallback(() => listPurchaseImportTemplates(activeClientId ?? ''), [activeClientId]);
  const openMappingModal = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header first.');
      return;
    }
    setShowMapping(true);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const kpi = useMemo(() => {
    const total = purchaseSourceRecords.length;
    const group = (st?: string) => {
      const rows = st ? purchaseSourceRecords.filter(r => r.status === st) : purchaseSourceRecords;
      return { count: rows.length, value: rows.reduce((s, r) => s + r.totalAmount, 0) };
    };
    const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return { total: group(), pending: group('Pending Mapping'), mapped: group('Mapped'), errors: group('Validation Error'), pctOf };
  }, [purchaseSourceRecords]);

  // Tombol aksi -- ditaruh di baris yang sama dengan tab (sama dengan Source Data Sales).
  const actionBar = (
    <div className="flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap">
      <button onClick={handleUploadClick} disabled={!activeClientId} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary disabled:opacity-50">
        <Upload size={13} /> Upload File
      </button>
      <button onClick={handleDownloadTemplate} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Download size={13} /> Template Excel
      </button>
      <button onClick={handleExport} className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary">
        <Download size={13} /> Export
      </button>
      <button onClick={openMappingModal} className="btn-primary text-xs py-1.5 gap-1.5">
        <Settings size={13} /> Mapping Rules
      </button>
    </div>
  );

  const kpiTiles: { label: string; g: { count: number; value: number }; tone: KpiTone; icon: React.ElementType; pctLabel: string }[] = [
    { label: 'Total Sources', g: kpi.total, tone: 'slate', icon: Upload, pctLabel: 'of all sources' },
    { label: 'Pending Mapping', g: kpi.pending, tone: 'amber', icon: Clock, pctLabel: 'of all sources' },
    { label: 'Mapped', g: kpi.mapped, tone: 'green', icon: CheckCircle, pctLabel: 'of all sources' },
    { label: 'Validation Errors', g: kpi.errors, tone: 'sky', icon: AlertTriangle, pctLabel: 'of all sources' },
  ];

  const columns = [
    { label: 'Source ID', field: 'sourceId', align: 'left' },
    { label: 'Type', field: 'sourceType', align: 'left' },
    { label: 'Vendor', field: 'vendor', align: 'left' },
    { label: 'Date', field: 'sourceDate', align: 'left' },
    { label: 'Invoice No.', field: 'invoiceNumber', align: 'left' },
    { label: 'PO Number', field: 'poNumber', align: 'left' },
    { label: 'Amount', field: 'amount', align: 'right' },
    { label: 'Tax', field: 'taxAmount', align: 'right' },
    { label: 'Total', field: 'totalAmount', align: 'right' },
    { label: 'Purchase Ref', field: 'relatedPurchaseId', align: 'left' },
    { label: 'Validation', field: 'validationStatus', align: 'left' },
    { label: 'Status', field: 'status', align: 'left' },
  ];

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0 fade-in">
      <PurchaseTabs actions={actionBar} />
      {showImport && <ImportPurchaseModal onClose={() => setShowImport(false)} />}

      <div className="pt-5 space-y-5">
        {/* KPI Cards -- 4 kartu, ukuran & posisi sama dengan Source Data Sales */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiTiles.map(k => (
            <SourceKpiTile
              key={k.label}
              label={k.label}
              value={k.g.count}
              detail={fmt(k.g.value)}
              detailUnit="gross incl. tax"
              pct={kpi.pctOf(k.g.count)}
              pctLabel={k.pctLabel}
              tone={k.tone}
              icon={k.icon}
            />
          ))}
        </div>

        {/* Source Record Table */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border flex flex-col gap-3">
            <div>
              <h3 className="text-2xl font-bold text-foreground">Purchase Source Record List</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filtered.length === 0
                  ? `Showing 0 of ${purchaseSourceRecords.length} records`
                  : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} records`}
              </p>
            </div>
            {/* Filter bar -- gaya sama dengan tab Sales Transaction: dropdown di kiri, kolom cari di kanan */}
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
              <FilterSelect
                value={vendorFilter}
                onChange={setVendorFilter}
                options={uniqueVendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
              />
              <div className="relative ml-auto w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search source, invoice, PO, vendor..."
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
                      onClick={() => handleSort(col.field)}
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
                {filtered.length === 0 ? (
                  <tr><td colSpan={13} className="py-8 text-center text-xs text-muted-foreground">No source records match your filters.</td></tr>
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
                    <td className="py-2 px-2 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{row.vendor}</td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.sourceDate}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.invoiceNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.poNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.amount)}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(row.totalAmount)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {row.relatedPurchaseId
                        ? <span className="font-medium text-primary">{row.relatedPurchaseId}</span>
                        : <span className="text-muted-foreground">Not mapped</span>}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap"><ValidationBadge status={row.validationStatus} /></td>
                    <td className="py-2 px-2 whitespace-nowrap"><SourceStatusBadge status={row.status} /></td>
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
                of <span className="font-semibold text-foreground">{filtered.length}</span> records
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

        {/* Detail Panel -- gaya SourcePanel Sales */}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`${BADGE_BASE} ${sourceTypeColors[selectedRow.sourceType] || 'bg-gray-100 text-gray-700'}`}>{selectedRow.sourceType}</span>
              <SourceStatusBadge status={selectedRow.status} />
              <ValidationBadge status={selectedRow.validationStatus} />
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{selectedRow.description}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Vendor', value: selectedRow.vendor },
                { label: 'Vendor ID', value: selectedRow.vendorId },
                { label: 'Source Date', value: selectedRow.sourceDate },
                { label: 'Period', value: selectedRow.period },
                { label: 'Invoice Number', value: selectedRow.invoiceNumber || '— Not provided —' },
                { label: 'PO Number', value: selectedRow.poNumber },
                { label: 'Created By', value: selectedRow.createdBy },
                { label: 'Created Date', value: selectedRow.createdDate },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Net Amount</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRow.amount)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Tax Amount</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRow.taxAmount)}</p>
              </div>
              <div className="rounded-xl border border-[#6EE7B7]/60 bg-[#ECFDF5] p-3">
                <p className="text-xs font-medium text-[#047857]">Total Amount</p>
                <p className="text-base font-bold text-[#064E3B] tabular-nums">{fmt(selectedRow.totalAmount)}</p>
              </div>
            </div>
            {selectedRow.relatedPurchaseId ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#6EE7B7]/60 bg-[#ECFDF5] px-4 py-2.5">
                <CheckCircle size={16} className="text-[#047857] shrink-0" />
                <p className="text-xs text-[#065F46]">Mapped to purchase transaction: <span className="font-bold">{selectedRow.relatedPurchaseId}</span></p>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                <Clock size={16} className="text-amber-600 shrink-0" />
                <p className="text-xs text-amber-700">This source document has not yet been mapped to a purchase transaction.</p>
              </div>
            )}
          </SourcePanel>
        )}
      </div>

      {showMapping && <MappingRulesModal onClose={() => setShowMapping(false)} loadTemplates={loadTemplates} />}
    </div>
  );
}