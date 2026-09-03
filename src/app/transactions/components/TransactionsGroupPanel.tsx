'use client';
// [DIUBAH] Gabungan dari TransactionsGroupActionsPanel (Aksi & Upload Data +
// filter bar) dan tabel "Transaksi {Group}" yang sebelumnya dua kartu
// terpisah (aksi di bagian PALING BAWAH halaman, tabel di atasnya). Sekarang
// keduanya disatukan jadi SATU kolom/kartu: Aksi & Upload Data + filter di
// bagian ATAS, tabel transaksi di bagian BAWAH — dan filter/pencarian di sini
// benar-benar mengontrol tabel yang tampil (sebelumnya dua state terpisah
// yang tidak saling terhubung).
import React, { useMemo, useState } from 'react';
import { Download, Upload, Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';
import TransactionsFilterBar from './TransactionsFilterBar';
import ImportRekeningKoranModal from './ImportRekeningKoranModal';
import TransactionEditModal from './TransactionEditModal';
import DataTable from '@/components/shared/DataTable';
import Pagination from '@/components/shared/Pagination';
import { Transaction, TransactionGroup, tambahHariISO } from './transactionData';
import { exportJournalToPdf } from './exportJournalPdf';
import { useTransactions } from '../context/TransactionsContext';

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

const PAGE_SIZE = 8;

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  render: (row: Transaction) => React.ReactNode;
}

interface Props {
  group: TransactionGroup;
  groupLabel: string;
  // Kategori default yang otomatis dipilihkan di form "+ Jurnal Baru", supaya
  // jurnal yang baru dibuat lewat sub halaman ini otomatis masuk kelompok
  // yang sama (lihat CATEGORY_TO_GROUP di transactionData.ts).
  defaultCategory: string;
  // Definisi kolom tabel (beda tiap sub halaman: Sales, Expense, dst).
  columns: Column[];
  onRowClick?: (tx: Transaction) => void;
  // [BARU] 'append' (default, perilaku lama semua sub halaman) menambahkan
  // hasil import ke transaksi kelompok ini tanpa menghapus apa pun.
  // 'replace-group' MENGGANTI seluruh transaksi kelompok ini (mis. hanya
  // Expense) dengan hasil import — kelompok lain tetap aman. Diteruskan
  // sebagai `mode` ke ImportRekeningKoranModal, yang di 'replace-group'
  // juga otomatis mengunci ke upload PDF Jurnal Penjualan Kasir saja.
  importMode?: 'append' | 'replace-group';
}

function blankTransaction(defaultCategory: string, group: TransactionGroup): Transaction {
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
    category: defaultCategory,
    type: 'debit',
    status: 'Unposted',
    jeId: `JE-MANUAL-${tag}`,
    voucherNo: `JV-${today.slice(5, 7)}${today.slice(8, 10)}-M`,
    saldoAkhir: 0,
    cek: false,
    // [BARU] Default field pembayaran ke vendor — hanya relevan untuk
    // kelompok Expense (yang otomatis terhubung ke Account Payable), jatuh
    // tempo default Net 30 dari tanggal transaksi.
    ...(group === 'expense'
      ? { paymentStatus: 'Belum Dibayar' as const, dueDate: tambahHariISO(today, 30), paidAmount: 0 }
      : {}),
  };
}

function toCsvValue(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportGroupToCsv(transactions: Transaction[], groupLabel: string) {
  const header = ['Tanggal', 'TX ID', 'No. Jurnal', 'No. Voucher', 'Kode Akun', 'Nama Akun', 'Deskripsi', 'Pihak', 'Kategori', 'Debit', 'Kredit', 'Status'];
  const rows = transactions.map((t) => [
    t.date, t.txId, t.jeId, t.voucherNo, t.accountCode, t.accountName, t.description, t.party, t.category, t.debit, t.credit, t.status,
  ]);
  const csv = [header, ...rows].map((r) => r.map(toCsvValue).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Transaksi-${groupLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TransactionsGroupPanel({
  group, groupLabel, defaultCategory, columns, onRowClick, importMode = 'append',
}: Props) {
  const { getByGroup, addTransactions, replaceGroup, addTransaction, postAllUnpostedInGroup } = useTransactions();
  const groupTx = useMemo(() => getByGroup(group), [getByGroup, group]);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => {
    const data = groupTx.filter((tx) => {
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
      if (filters.dateFrom && tx.date < filters.dateFrom) return false;
      if (filters.dateTo && tx.date > filters.dateTo) return false;
      const amount = tx.debit || tx.credit || 0;
      if (filters.amountMin && amount < Number(filters.amountMin)) return false;
      if (filters.amountMax && amount > Number(filters.amountMax)) return false;
      return true;
    });
    return [...data].sort((a, b) => {
      const av = (a[sortKey as keyof Transaction] as string | number) ?? '';
      const bv = (b[sortKey as keyof Transaction] as string | number) ?? '';
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [groupTx, search, filters, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const unpostedInGroup = useMemo(() => groupTx.filter((t) => t.status === 'Unposted').length, [groupTx]);
  const filtersActive = Boolean(
    search || Object.entries(filters).some(([key, value]) => value !== EMPTY_FILTERS[key as keyof Filters])
  );

  const handleExportPdf = () => {
    if (filtered.length === 0) {
      toast.error('Tidak ada transaksi untuk diekspor', { description: 'Ubah filter atau tambahkan transaksi terlebih dahulu.' });
      return;
    }
    exportJournalToPdf(filtered);
    toast.success('Jurnal (PDF) berhasil diunduh', { description: `${filtered.length} transaksi ${groupLabel}${filtersActive ? ' (sesuai filter aktif)' : ''}` });
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Tidak ada transaksi untuk diekspor', { description: 'Ubah filter atau tambahkan transaksi terlebih dahulu.' });
      return;
    }
    exportGroupToCsv(filtered, groupLabel);
    toast.success('Export dimulai', { description: `${filtered.length} transaksi ${groupLabel} diunduh sebagai CSV` });
  };

  const handlePostAll = () => {
    if (unpostedInGroup === 0) return;
    const konfirmasi = window.confirm(
      `Posting ${unpostedInGroup} transaksi ${groupLabel} berstatus Unposted menjadi Posted?`
    );
    if (konfirmasi) postAllUnpostedInGroup(group);
  };

  const handleImported = (txs: Transaction[]) => {
    // [BARU] 'replace-group' mengganti transaksi kelompok ini saja lewat
    // replaceGroup(); mode 'append' (default) tetap menambahkan seperti
    // sebelumnya lewat addTransactions().
    if (importMode === 'replace-group') replaceGroup(group, txs);
    else addTransactions(txs);
    setShowImportModal(false);
  };

  const handleSaveNew = (tx: Transaction) => {
    addTransaction(tx);
    setShowCreateModal(false);
  };

  return (
    <div className="bg-card border-2 border-border rounded-lg shadow-card-md">
      {/* Aksi & Upload Data — header + tombol */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-sm font-bold text-text-primary">Aksi & Upload Data — {groupLabel}</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Upload data {groupLabel.toLowerCase()}, buat jurnal baru, atau kelola transaksi {groupLabel.toLowerCase()} langsung dari sini — tidak perlu pindah ke halaman Transaksi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowImportModal(true)} className="btn-secondary text-xs py-1.5 gap-1.5">
            <Upload size={13} />
            Import
          </button>
          <button onClick={handleExportCsv} className="btn-secondary text-xs py-1.5 gap-1.5">
            <Download size={13} />
            Export
          </button>
          <button
            onClick={handleExportPdf}
            className="btn-secondary text-xs py-1.5 gap-1.5"
            title={`Unduh transaksi ${groupLabel} sebagai Jurnal Umum (PDF)`}
          >
            <FileText size={13} />
            Download Jurnal (PDF)
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs py-1.5 gap-1.5">
            <Plus size={13} />
            Jurnal Baru
          </button>
        </div>
      </div>

      {/* Filter bar — sekarang benar-benar mengontrol tabel di bawah */}
      <div className="px-5 pt-4 pb-3 border-b border-border space-y-3">
        <TransactionsFilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          filters={filters}
          onFiltersChange={(f) => { setFilters(f); setPage(1); }}
          unpostedCount={unpostedInGroup}
          onPostAllUnposted={handlePostAll}
        />
        <p className="text-xs text-text-secondary">
          {filtered.length.toLocaleString('id-ID')} dari {groupTx.length.toLocaleString('id-ID')} transaksi {groupLabel} cocok dengan filter di atas.
        </p>
      </div>

      {/* Tabel Transaksi */}
      <DataTable
        columns={columns}
        data={paginated}
        onRowClick={onRowClick}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        emptyMessage={`Belum ada transaksi ${groupLabel}. Tambahkan / import langsung dari panel di atas.`}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />

      {showImportModal && (
        <ImportRekeningKoranModal
          mode={importMode}
          groupLabel={groupLabel}
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
        />
      )}

      {showCreateModal && (
        <TransactionEditModal
          isNew
          transaction={blankTransaction(defaultCategory, group)}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSaveNew}
        />
      )}
    </div>
  );
}
