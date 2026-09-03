'use client';
import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, Edit2, Trash2, AlertTriangle, Check } from 'lucide-react';
import { Transaction } from './transactionData';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';

interface TransactionsTableProps {
  transactions: Transaction[];
  totalFiltered: number;
  // [BARU] Tahun periode terpilih & penanda apakah tahun itu punya data sama
  // sekali, supaya pesan kosong yang tampil sesuai konteks.
  selectedYear: number | 'all';
  hasDataInSelectedYear: boolean;
  sortField: keyof Transaction;
  sortDir: 'asc' | 'desc';
  onSort: (field: keyof Transaction) => void;
  selectedIds: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  onRowClick: (tx: Transaction) => void;
  // [BARU] Dipanggil saat tombol Edit (ikon pensil) di baris ditekan —
  // membuka TransactionEditModal lewat parent (TransactionsContent).
  onEditClick: (tx: Transaction) => void;
}

function formatAmount(v: number) {
  if (v === 0) return '—';
  if (v >= 1000000000) return `Rp ${(v / 1000000000).toFixed(2)}M`;
  if (v >= 1000000) return `Rp ${(v / 1000000).toFixed(1)}Jt`;
  return `Rp ${v.toLocaleString('id-ID')}`;
}

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  // [BARU] Unposted — status awal hasil import rekening koran, belum
  // di-posting sama sekali. Dibuat abu-abu (neutral) supaya kontras dengan
  // Draft (warning/oranye) yang artinya "sudah diproses tapi perlu review".
  Unposted: 'neutral',
  Posted: 'info',
  Draft: 'warning',
  Reconciled: 'positive',
  Voided: 'negative',
};

const categoryColors: Record<string, string> = {
  Revenue: 'badge-positive',
  Payroll: 'badge-neutral',
  Software: 'badge-info',
  Rent: 'badge-neutral',
  Tax: 'badge-warning',
  Marketing: 'badge-warning',
  Travel: 'badge-neutral',
  CapEx: 'badge-info',
  'AP Payment': 'badge-neutral',
  Utilities: 'badge-neutral',
  Financing: 'badge-info',
  // [BARU] 5 label kategori hasil import rekening koran (lihat
  // classifyByAccountName/GROUP_LABELS di transactionData.ts) — dipetakan ke
  // warna yang selaras dengan kategori sejenis di atas.
  Sales: 'badge-positive',
  Expense: 'badge-neutral',
  'Cash Payment': 'badge-warning',
  'Cash Reserve': 'badge-info',
  Other: 'badge-neutral',
};

function SortIcon({ field, sortField, sortDir }: { field: keyof Transaction; sortField: keyof Transaction; sortDir: 'asc' | 'desc' }) {
  if (sortField !== field) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
  return sortDir === 'asc'
    ? <ArrowUp size={12} className="text-primary" />
    : <ArrowDown size={12} className="text-primary" />;
}

const pageSizeOptions = [10, 20, 50];

export default function TransactionsTable({
  transactions, totalFiltered, selectedYear, hasDataInSelectedYear, sortField, sortDir, onSort,
  selectedIds, onSelectAll, onSelectRow,
  page, pageSize, totalPages, onPageChange, onPageSizeChange,
  onRowClick,
  onEditClick,
}: TransactionsTableProps) {
  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const someSelected = transactions.some((t) => selectedIds.has(t.id)) && !allSelected;

  const cols: { key: keyof Transaction; label: string; sortable?: boolean; align?: string }[] = [
    { key: 'date', label: 'Tanggal', sortable: true },
    { key: 'txId', label: 'TX ID', sortable: true },
    { key: 'voucherNo', label: 'No Voucher', sortable: true },
    { key: 'accountCode', label: 'Akun', sortable: true },
    { key: 'description', label: 'Deskripsi', sortable: false },
    { key: 'debit', label: 'Debit', sortable: true, align: 'right' },
    { key: 'credit', label: 'Kredit', sortable: true, align: 'right' },
    { key: 'saldoAkhir', label: 'Saldo Akhir', sortable: true, align: 'right' },
    { key: 'reference', label: 'Referensi', sortable: false },
    { key: 'party', label: 'Pihak', sortable: true },
    { key: 'category', label: 'Kategori', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'cek', label: 'Cek', sortable: true, align: 'center' },
  ];

  return (
    <div className="card-elevated-md rounded-xl overflow-hidden">
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 bg-primary/5 border-b border-primary/20 fade-in">
          <span className="text-sm font-semibold text-primary">{selectedIds.size} dipilih</span>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={() => toast.success(`${selectedIds.size} transaksi diarsip`)}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Arsip
          </button>
          <button
            onClick={() => toast.error(`${selectedIds.size} transaksi dihapus`)}
            className="text-xs font-semibold text-negative hover:text-negative/80 transition-colors"
          >
            Hapus
          </button>
          <button
            onClick={() => toast.info(`Export ${selectedIds.size} transaksi`)}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Export Pilihan
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-primary cursor-pointer accent-primary"
                />
              </th>
              {cols.map((col) => (
                <th
                  key={`th-${col.key}`}
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.sortable ? 'cursor-pointer hover:text-foreground select-none' : ''}`}
                  onClick={col.sortable ? () => onSort(col.key) : undefined}
                >
                  <div className={`flex items-center gap-1.5 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}>
                    {col.label}
                    {col.sortable && <SortIcon field={col.key} sortField={sortField} sortDir={sortDir} />}
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 2}>
                  {!hasDataInSelectedYear ? (
                    // [BARU] Tahun/periode yang dipilih memang tidak punya transaksi
                    // sama sekali — bukan soal filter pencarian/status/kategori.
                    <EmptyState
                      icon={ArrowLeftRight}
                      title="Belum ada data transaksi di tahun ini"
                      description={
                        selectedYear === 'all'
                          ? 'Belum ada transaksi yang diimpor untuk periode apa pun. Coba import data transaksi terlebih dahulu.'
                          : `Tidak ditemukan transaksi untuk periode Januari–Desember ${selectedYear}. Coba pilih tahun lain pada periode di atas.`
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={ArrowLeftRight}
                      title="Tidak ada transaksi ditemukan"
                      description="Tidak ada transaksi yang cocok dengan filter yang dipilih. Coba ubah filter atau kata kunci pencarian."
                      action={{ label: 'Reset Filter', onClick: () => {} }}
                    />
                  )}
                </td>
              </tr>
            ) : (
              transactions.map((tx, i) => {
                const isSelected = selectedIds.has(tx.id);
                const hasAnomaly = tx.notes?.includes('Anomali') || tx.notes?.includes('anomali');
                return (
                  <tr
                    key={tx.id}
                    onClick={() => onRowClick(tx)}
                    className={`border-b border-border table-row-hover group ${
                      isSelected ? 'bg-primary/5' : i % 2 === 1 ? 'bg-muted/10' : ''
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => onSelectRow(tx.id, e.target.checked)}
                        className="w-4 h-4 rounded border-border text-primary cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs text-muted-foreground font-mono">{formatDate(tx.date)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {hasAnomaly && (
                          <AlertTriangle size={12} className="text-warning flex-shrink-0" />
                        )}
                        <span className="text-xs font-mono text-primary font-semibold">{tx.txId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-mono font-semibold text-foreground">{tx.voucherNo}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <span className="text-xs font-mono font-semibold text-foreground">{tx.accountCode}</span>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{tx.accountName}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground truncate max-w-[220px]">{tx.description}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{tx.jeId}</p>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className={`text-sm font-semibold font-mono ${tx.debit > 0 ? 'text-foreground' : 'text-muted-foreground/30'}`}>
                        {formatAmount(tx.debit)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className={`text-sm font-semibold font-mono ${tx.credit > 0 ? 'text-positive' : 'text-muted-foreground/30'}`}>
                        {formatAmount(tx.credit)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-xs font-mono text-muted-foreground">{formatAmount(tx.saldoAkhir)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-mono text-muted-foreground">{tx.reference}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs text-foreground truncate max-w-[140px] block">{tx.party}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={categoryColors[tx.category] || 'badge-neutral'}>{tx.category}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge variant={statusVariant[tx.status] || 'neutral'} label={tx.status} dot />
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {tx.cek ? (
                        <Check size={14} className="text-positive inline-block" />
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="relative group/btn">
                          <button
                            onClick={() => onRowClick(tx)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                            aria-label="Lihat detail transaksi"
                          >
                            <Eye size={14} />
                          </button>
                          <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-foreground text-background text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity z-10">
                            Lihat Detail
                          </div>
                        </div>
                        <div className="relative group/btn">
                          <button
                            onClick={() => onEditClick(tx)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Edit transaksi"
                          >
                            <Edit2 size={14} />
                          </button>
                          <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-foreground text-background text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity z-10">
                            Edit
                          </div>
                        </div>
                        <div className="relative group/btn">
                          <button
                            onClick={() => toast.error(`Hapus ${tx.txId}?`, { description: 'Tindakan ini tidak dapat dibatalkan' })}
                            className="p-1.5 rounded-lg hover:bg-negative-subtle text-muted-foreground hover:text-negative transition-colors"
                            aria-label="Hapus transaksi — tidak dapat dibatalkan"
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-foreground text-background text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity z-10">
                            Hapus
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 border-t border-border bg-muted/20">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Menampilkan{' '}
            <span className="font-semibold text-foreground">
              {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, totalFiltered)}
            </span>
            {' '}dari{' '}
            <span className="font-semibold text-foreground">{totalFiltered}</span>
            {' '}transaksi
          </span>
          <div className="flex items-center gap-1.5">
            <span>Baris:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="input-base w-auto text-xs py-1 pr-6 cursor-pointer"
            >
              {pageSizeOptions.map((s) => (
                <option key={`ps-${s}`} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            className="px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            «
          </button>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ‹
          </button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const p = start + i;
            if (p > totalPages) return null;
            return (
              <button
                key={`page-${p}`}
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-150 ${
                  page === p
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p}
              </button>
            );
          })}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            className="px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ›
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            className="px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
