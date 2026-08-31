'use client';
import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import TransactionsHeader from './TransactionsHeader';
import TransactionsFilterBar from './TransactionsFilterBar';
import TransactionsTable from './TransactionsTable';
import TransactionDrawer from './TransactionDrawer';
import TransactionEditModal from './TransactionEditModal';
import ImportRekeningKoranModal from './ImportRekeningKoranModal';
import { ALL_TRANSACTIONS, Transaction } from './transactionData';
import { exportJournalToPdf } from './exportJournalPdf';

// [BARU] Rentang tahun yang bisa dipilih pada periode Transaksi: opsi "all"
// paling atas (menampilkan seluruh periode yang pernah diimpor pengguna),
// lalu tahun berjalan mundur sampai 2015, mengikuti pola dropdown periode di Topbar.
const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2015;
const YEAR_OPTIONS: (number | 'all')[] = [
  'all',
  ...Array.from({ length: CURRENT_YEAR - MIN_YEAR + 1 }, (_, i) => CURRENT_YEAR - i),
];

export default function TransactionsContent() {
  // [BARU] Diangkat dari konstanta statis ALL_TRANSACTIONS ke state, supaya
  // hasil import rekening koran bisa ditambahkan ke tabel tanpa reload.
  const [transactions, setTransactions] = useState<Transaction[]>(ALL_TRANSACTIONS);
  const [showImportModal, setShowImportModal] = useState(false);
  const [search, setSearch] = useState('');
  // [BARU] Tahun periode Transaksi (Jan–Des). Default ke tahun dengan data
  // terbaru yang tersedia, supaya tabel tidak kosong saat halaman dibuka.
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(() => {
    const latest = ALL_TRANSACTIONS.reduce((max, tx) => {
      const y = new Date(tx.date).getFullYear();
      return y > max ? y : max;
    }, MIN_YEAR);
    return latest || CURRENT_YEAR;
  });
  const [filters, setFilters] = useState({
    type: 'all',
    status: 'all',
    category: 'all',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
  });
  const [sortField, setSortField] = useState<keyof Transaction>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerTx, setDrawerTx] = useState<Transaction | null>(null);
  // [BARU] Transaksi yang sedang dibuka di modal edit (null = modal tertutup).
  const [editTx, setEditTx] = useState<Transaction | null>(null);

  // [BARU] Transaksi yang ada pada tahun terpilih saja (belum kena filter
  // pencarian/status/kategori lain) — dipakai untuk menentukan pesan kosong
  // yang tepat: "belum ada data di tahun ini" vs "tidak cocok dengan filter".
  // Saat "all" dipilih, seluruh transaksi dari semua periode yang pernah
  // diimpor pengguna ikut ditampilkan.
  const transactionsInSelectedYear = useMemo(() => {
    if (selectedYear === 'all') return transactions;
    return transactions.filter((tx) => new Date(tx.date).getFullYear() === selectedYear);
  }, [transactions, selectedYear]);

  // [BARU] Jumlah transaksi berstatus Unposted di SELURUH tabel (bukan cuma
  // yang sedang tampil setelah filter/pencarian) — dipakai badge & tombol
  // "Posting Semua" di TransactionsFilterBar.
  const unpostedCount = useMemo(
    () => transactions.filter((tx) => tx.status === 'Unposted').length,
    [transactions]
  );

  const filtered = useMemo(() => {
    return transactionsInSelectedYear.filter((tx) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !tx.txId.toLowerCase().includes(q) &&
          !tx.voucherNo.toLowerCase().includes(q) &&
          !tx.description.toLowerCase().includes(q) &&
          !tx.party.toLowerCase().includes(q) &&
          !tx.reference.toLowerCase().includes(q) &&
          !tx.accountCode.toLowerCase().includes(q)
        ) return false;
      }
      if (filters.type !== 'all' && tx.type !== filters.type) return false;
      if (filters.status !== 'all' && tx.status !== filters.status) return false;
      if (filters.category !== 'all' && tx.category !== filters.category) return false;
      return true;
    }).sort((a, b) => {
      const av = a[sortField] as string | number;
      const bv = b[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [transactionsInSelectedYear, search, filters, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: keyof Transaction) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
    setPage(1);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(paginated.map((t) => t.id)));
    else setSelectedIds(new Set());
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleYearChange = (year: number | 'all') => {
    setSelectedYear(year);
    setPage(1);
    setSelectedIds(new Set());
  };

  // [BARU] Unduh seluruh data transaksi (tidak terikat filter tahun/pencarian
  // yang sedang aktif) sebagai PDF Jurnal Umum.
  const handleExportJournalPdf = () => {
    exportJournalToPdf(transactions);
  };

  // [BARU] Ubah status seluruh transaksi Unposted (di seluruh tabel) menjadi
  // Posted sekaligus. Dipicu dari tombol "Posting Semua" di TransactionsFilterBar.
  const handlePostAllUnposted = () => {
    if (unpostedCount === 0) return;
    setTransactions((prev) =>
      prev.map((tx) => (tx.status === 'Unposted' ? { ...tx, status: 'Posted' } : tx))
    );
    toast.success('Transaksi berhasil diposting', {
      description: `${unpostedCount} transaksi Unposted kini berstatus Posted`,
    });
  };

  // [BARU] Timpa satu transaksi (dicocokkan lewat id) dengan hasil edit dari
  // TransactionEditModal. Status transaksi TIDAK otomatis berubah jadi
  // Posted di sini — itu murni lewat tombol "Posting Semua" terpisah, supaya
  // alur "edit dulu sampai benar, baru posting semua" tetap dua langkah.
  const handleSaveEdit = (updated: Transaction) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === updated.id ? updated : tx)));
    toast.success('Perubahan disimpan', {
      description: `${updated.txId} berhasil diperbarui`,
    });
    setEditTx(null);
  };

  const handleImported = (newTx: Transaction[]) => {
    // [DIUBAH] Reset total: tabel transaksi tidak lagi digabung dengan data lama,
    // melainkan diganti sepenuhnya oleh hasil import rekening koran yang baru.
    setTransactions(newTx);
    setSelectedIds(new Set());
    setPage(1);
  };

  return (
    <div className="space-y-5 fade-in">
      <TransactionsHeader
        totalCount={filtered.length}
        selectedCount={selectedIds.size}
        onImportClick={() => setShowImportModal(true)}
        onExportJournalPdf={handleExportJournalPdf}
        selectedYear={selectedYear}
        onYearChange={handleYearChange}
        yearOptions={YEAR_OPTIONS}
      />

      <TransactionsFilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        filters={filters}
        onFiltersChange={(f) => { setFilters(f); setPage(1); }}
        unpostedCount={unpostedCount}
        onPostAllUnposted={handlePostAllUnposted}
      />

      <TransactionsTable
        transactions={paginated}
        totalFiltered={filtered.length}
        selectedYear={selectedYear}
        hasDataInSelectedYear={transactionsInSelectedYear.length > 0}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        selectedIds={selectedIds}
        onSelectAll={handleSelectAll}
        onSelectRow={handleSelectRow}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        onRowClick={setDrawerTx}
        onEditClick={setEditTx}
      />

      {drawerTx && (
        <TransactionDrawer transaction={drawerTx} onClose={() => setDrawerTx(null)} />
      )}

      {editTx && (
        <TransactionEditModal
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSave={handleSaveEdit}
        />
      )}

      {showImportModal && (
        <ImportRekeningKoranModal
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
