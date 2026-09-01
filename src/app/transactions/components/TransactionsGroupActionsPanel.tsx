'use client';
// [BARU] Panel aksi jurnal yang ditaruh di bagian PALING BAWAH tiap sub
// halaman Transaksi (Sales, Expense, Cash Payment, Cash Reserve, Other).
// Isinya sama seperti toolbar & filter bar di halaman Transaksi utama
// (Import, Export, Download Jurnal (PDF), + Jurnal Baru, lalu Semua Tipe /
// Debit / Credit / Jurnal, Semua Status, Semua Kategori, Filter Lanjutan,
// Posting Semua) — supaya data pembelian/penjualan bisa langsung diupload
// dari sub halaman terkait, tidak harus lewat halaman Transaksi.
//
// Import & "+ Jurnal Baru" di sini bersifat MENAMBAHKAN (lihat
// addTransactions/addTransaction di TransactionsContext), BUKAN mengganti
// seluruh tabel seperti Import di halaman Transaksi utama — supaya aman
// dipakai per sub halaman tanpa menghapus data kelompok lain.
import React, { useMemo, useState } from 'react';
import { Download, Upload, Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';
import TransactionsFilterBar from './TransactionsFilterBar';
import ImportRekeningKoranModal from './ImportRekeningKoranModal';
import TransactionEditModal from './TransactionEditModal';
import { Transaction, TransactionGroup } from './transactionData';
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

interface Props {
  group: TransactionGroup;
  groupLabel: string;
  // Kategori default yang otomatis dipilihkan di form "+ Jurnal Baru", supaya
  // jurnal yang baru dibuat lewat sub halaman ini otomatis masuk kelompok
  // yang sama (lihat CATEGORY_TO_GROUP di transactionData.ts).
  defaultCategory: string;
}

function blankTransaction(defaultCategory: string): Transaction {
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

export default function TransactionsGroupActionsPanel({ group, groupLabel, defaultCategory }: Props) {
  const { getByGroup, addTransactions, addTransaction, postAllUnpostedInGroup } = useTransactions();
  const groupTx = useMemo(() => getByGroup(group), [getByGroup, group]);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filtered = useMemo(() => {
    return groupTx.filter((tx) => {
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
  }, [groupTx, search, filters]);

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
    addTransactions(txs);
    setShowImportModal(false);
  };

  const handleSaveNew = (tx: Transaction) => {
    addTransaction(tx);
    setShowCreateModal(false);
  };

  return (
    <div className="card-elevated rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Aksi & Upload Data — {groupLabel}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
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

      <TransactionsFilterBar
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        unpostedCount={unpostedInGroup}
        onPostAllUnposted={handlePostAll}
      />

      <p className="text-xs text-muted-foreground">
        {filtered.length.toLocaleString('id-ID')} dari {groupTx.length.toLocaleString('id-ID')} transaksi {groupLabel} cocok dengan filter di atas
        {filtersActive ? ' — ' : '. '}
        {filtersActive && <span>lihat hasilnya di tabel {groupLabel} pada bagian atas halaman ini.</span>}
      </p>

      {showImportModal && (
        <ImportRekeningKoranModal
          mode="append"
          groupLabel={groupLabel}
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
        />
      )}

      {showCreateModal && (
        <TransactionEditModal
          isNew
          transaction={blankTransaction(defaultCategory)}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSaveNew}
        />
      )}
    </div>
  );
}
