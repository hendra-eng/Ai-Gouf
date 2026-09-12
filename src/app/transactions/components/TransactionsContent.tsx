'use client';
// Komponen UI utama halaman /transactions. Merakit Header + FilterBar +
// Table + Drawer detail + Modal edit/jurnal-baru + Modal import rekening
// koran, semuanya membaca/menulis lewat useTransactions() (lihat
// ../context/TransactionsContext.tsx untuk sumber data & aksi CRUD-nya).
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import TransactionsHeader from './TransactionsHeader';
import TransactionsFilterBar from './TransactionsFilterBar';
import TransactionsTable from './TransactionsTable';
import TransactionDrawer from './TransactionDrawer';
import TransactionEditModal from './TransactionEditModal';
import ImportRekeningKoranModal from './ImportRekeningKoranModal';
import { Transaction } from './transactionData';
import { exportJournalToPdf } from './exportJournalPdf';
import { exportTransactionsToExcel, buildTransactionsExcelBlob, downloadBlob } from './exportTransactionsExcel';
import { useTransactions } from '../context/TransactionsContext';
import { useActiveClient } from '@/lib/activeClient';
import { COMPANY } from '@/lib/financialData';

interface Filters {
  type: string;
  status: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
}

const EMPTY_FILTERS: Filters = {
  type: 'all', status: 'all', category: 'all', dateFrom: '', dateTo: '', amountMin: '', amountMax: '',
};

const DEFAULT_PAGE_SIZE = 20;

function blankTransaction(): Transaction {
  const today = new Date().toISOString().slice(0, 10);
  const tag = Date.now().toString(36).toUpperCase();
  return {
    id: `tx-manual-${tag}`,
    date: today,
    txId: `TXN-MANUAL-${tag}`,
    accountCode: '',
    accountName: '',
    description: '',
    debit: 0,
    credit: 0,
    reference: '',
    party: '',
    category: 'Lainnya',
    type: 'debit',
    status: 'Unposted',
    jeId: `JE-MANUAL-${tag}`,
    voucherNo: `JV-${today.slice(5, 7)}${today.slice(8, 10)}-M`,
    saldoAkhir: 0,
    cek: false,
  };
}

export default function TransactionsContent() {
  const {
    transactions,
    unpostedCount,
    loading,
    error,
    isSampleData,
    saveEdit,
    postAllUnposted,
    importTransactions,
    addTransaction,
    deleteTransactions,
    archiveTransactions,
    toggleCek,
  } = useTransactions();
  const { activeClientId, activeClientName } = useActiveClient();
  const companyName = activeClientName || COMPANY.name;

  // ─── Baris yang terlihat (baris arsip disembunyikan dari tabel utama) ───
  const visibleTransactions = useMemo(() => transactions.filter((tx) => !tx.archived), [transactions]);

  // ─── Filter tahun ───
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    visibleTransactions.forEach((tx) => {
      const y = new Date(tx.date).getFullYear();
      if (!Number.isNaN(y)) years.add(y);
    });
    return ['all', ...Array.from(years).sort((a, b) => b - a)] as (number | 'all')[];
  }, [visibleTransactions]);

  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');

  const yearFiltered = useMemo(() => {
    if (selectedYear === 'all') return visibleTransactions;
    return visibleTransactions.filter((tx) => new Date(tx.date).getFullYear() === selectedYear);
  }, [visibleTransactions, selectedYear]);

  const hasDataInSelectedYear = yearFiltered.length > 0;

  // ─── Search & filter lanjutan ───
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const filtered = useMemo(() => {
    return yearFiltered.filter((tx) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !tx.txId.toLowerCase().includes(q) &&
          !tx.voucherNo.toLowerCase().includes(q) &&
          !tx.description.toLowerCase().includes(q) &&
          !tx.party.toLowerCase().includes(q) &&
          !tx.reference.toLowerCase().includes(q) &&
          !String(tx.accountCode ?? '').toLowerCase().includes(q)
        ) return false;
      }
      if (filters.type !== 'all' && tx.type !== filters.type) return false;
      if (filters.status !== 'all' && tx.status !== filters.status) return false;
      if (filters.category !== 'all' && tx.category !== filters.category) return false;
      if (filters.dateFrom && tx.date < filters.dateFrom) return false;
      if (filters.dateTo && tx.date > filters.dateTo) return false;
      const amount = tx.debit || tx.credit || 0;
      if (filters.amountMin && amount < Number(filters.amountMin)) return false;
      if (filters.amountMax && amount > Number(filters.amountMax)) return false;
      return true;
    });
  }, [yearFiltered, search, filters]);

  // ─── Sort ───
  const [sortField, setSortField] = useState<keyof Transaction>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField] as unknown as string | number | boolean ?? '';
      const bv = b[sortField] as unknown as string | number | boolean ?? '';
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return sortDir === 'asc' ? result : -result;
    });
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: keyof Transaction) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  // ─── Pagination ───
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sorted, currentPage, pageSize]
  );

  // Reset ke halaman 1 setiap kali filter/pencarian/tahun/urutan berubah.
  useEffect(() => { setPage(1); }, [search, filters, selectedYear, sortField, sortDir, pageSize]);

  // ─── Seleksi baris (untuk bulk action) ───
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paginated.forEach((tx) => (checked ? next.add(tx.id) : next.delete(tx.id)));
      return next;
    });
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  // ─── Drawer detail (klik baris) ───
  const [drawerTx, setDrawerTx] = useState<Transaction | null>(null);

  // ─── Modal edit (tombol pensil di baris) ───
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const editingSibling = useMemo(
    () => (editingTx ? transactions.find((t) => t.jeId === editingTx.jeId && t.id !== editingTx.id) ?? null : null),
    [transactions, editingTx]
  );

  const handleSaveEdit = (result: Transaction | Transaction[]) => {
    if (Array.isArray(result)) {
      const [edited, syncedSibling] = result;
      saveEdit(edited, syncedSibling);
    } else {
      saveEdit(result);
    }
    setEditingTx(null);
  };

  // ─── Modal "+ Jurnal Baru" ───
  const [showNewModal, setShowNewModal] = useState(false);
  const handleSaveNew = async (result: Transaction | Transaction[]) => {
    await addTransaction(Array.isArray(result) ? result : [result]);
    setShowNewModal(false);
  };

  // ─── Modal import rekening koran ───
  const [showImportModal, setShowImportModal] = useState(false);
  const handleImported = (rows: Transaction[]) => {
    importTransactions(rows);
    setShowImportModal(false);
  };

  // ─── Bulk & per-baris actions ───
  const handleBulkDelete = async (ids: string[]) => {
    await deleteTransactions(ids);
    setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
  };

  const handleBulkArchive = (ids: string[]) => {
    archiveTransactions(ids);
    setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
  };

  const handleBulkExport = async (ids: string[]) => {
    const subset = transactions.filter((tx) => ids.includes(tx.id));
    await exportTransactionsToExcel(subset, activeClientId, activeClientName);
  };

  const handleDeleteRow = (id: string) => { void handleBulkDelete([id]); };

  // ─── Export tabel yang sedang tampil ───
  const [preparedExport, setPreparedExport] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [isPreparingExcelExport, setIsPreparingExcelExport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsPreparingExcelExport(true);
    buildTransactionsExcelBlob(sorted, activeClientId, activeClientName)
      .then((result) => { if (!cancelled) { setPreparedExport(result); setIsPreparingExcelExport(false); } })
      .catch(() => { if (!cancelled) { setPreparedExport(null); setIsPreparingExcelExport(false); } });
    return () => { cancelled = true; };
  }, [sorted, activeClientId, activeClientName]);

  const handleExportExcel = () => {
    if (preparedExport) downloadBlob(preparedExport.blob, preparedExport.fileName);
    else exportTransactionsToExcel(sorted, activeClientId, activeClientName);
  };

  const handleExportJournalPdf = () => {
    exportJournalToPdf(sorted, companyName);
  };

  const handleResetFilters = () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
  };

  return (
    <div className="space-y-5">
      {isSampleData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-subtle border border-warning/30 text-xs text-warning">
          Menampilkan data contoh — pilih client aktif untuk melihat transaksi sungguhan.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-negative-subtle border border-negative/20 text-xs text-negative">
          {error}
        </div>
      )}
      {loading && !isSampleData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          Memuat transaksi...
        </div>
      )}

      <TransactionsHeader
        totalCount={totalFiltered}
        selectedCount={selectedIds.size}
        onImportClick={() => setShowImportModal(true)}
        onExportJournalPdf={handleExportJournalPdf}
        onExportExcel={handleExportExcel}
        isPreparingExcelExport={isPreparingExcelExport}
        onNewJournalClick={() => setShowNewModal(true)}
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
        yearOptions={yearOptions}
        onBulkDelete={() => handleBulkDelete(Array.from(selectedIds))}
        onBulkArchive={() => handleBulkArchive(Array.from(selectedIds))}
      />

      <TransactionsFilterBar
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        unpostedCount={unpostedCount}
        onPostAllUnposted={postAllUnposted}
      />

      <TransactionsTable
        transactions={paginated}
        totalFiltered={totalFiltered}
        selectedYear={selectedYear}
        hasDataInSelectedYear={hasDataInSelectedYear}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        selectedIds={selectedIds}
        onSelectAll={handleSelectAll}
        onSelectRow={handleSelectRow}
        page={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onRowClick={setDrawerTx}
        onEditClick={setEditingTx}
        onBulkDelete={handleBulkDelete}
        onBulkArchive={handleBulkArchive}
        onBulkExport={handleBulkExport}
        onDeleteRow={handleDeleteRow}
        onToggleCek={toggleCek}
        onResetFilters={handleResetFilters}
      />

      {drawerTx && (
        <TransactionDrawer transaction={drawerTx} onClose={() => setDrawerTx(null)} />
      )}

      {editingTx && (
        <TransactionEditModal
          transaction={editingTx}
          siblingTransaction={editingSibling}
          onClose={() => setEditingTx(null)}
          onSave={handleSaveEdit}
        />
      )}

      {showNewModal && (
        <TransactionEditModal
          isNew
          transaction={blankTransaction()}
          onClose={() => setShowNewModal(false)}
          onSave={handleSaveNew}
        />
      )}

      {showImportModal && (
        <ImportRekeningKoranModal
          mode="replace"
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}