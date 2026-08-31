'use client';
import React, { useState } from 'react';
import { Search, SlidersHorizontal, X, ChevronDown, CheckCheck } from 'lucide-react';

interface Filters {
  type: string;
  status: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
}

interface TransactionsFilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  // [BARU] Jumlah transaksi berstatus Unposted saat ini (di seluruh tabel,
  // tidak terikat filter aktif) & handler untuk men-posting semuanya sekaligus.
  unpostedCount: number;
  onPostAllUnposted: () => void;
}

// [DIUBAH] Tambah 'Unposted' — status default hasil import rekening koran.
const typeOptions = ['all', 'debit', 'credit', 'journal'];
const statusOptions = ['all', 'Unposted', 'Posted', 'Draft', 'Reconciled', 'Voided'];
const categoryOptions = ['all', 'Revenue', 'Payroll', 'Software', 'Rent', 'Tax', 'Marketing', 'Travel', 'CapEx', 'AP Payment', 'Utilities', 'Financing'];

const typeLabels: Record<string, string> = { all: 'Semua Tipe', debit: 'Debit', credit: 'Credit', journal: 'Jurnal' };
const statusLabels: Record<string, string> = { all: 'Semua Status', Unposted: 'Unposted', Posted: 'Posted', Draft: 'Draft', Reconciled: 'Reconciled', Voided: 'Voided' };

export default function TransactionsFilterBar({ search, onSearchChange, filters, onFiltersChange, unpostedCount, onPostAllUnposted }: TransactionsFilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handlePostAllClick = () => {
    if (unpostedCount === 0) return;
    const konfirmasi = window.confirm(
      `Posting ${unpostedCount} transaksi berstatus Unposted menjadi Posted? Aksi ini akan diterapkan ke seluruh transaksi Unposted di tabel, tidak hanya yang sedang tampil.`
    );
    if (konfirmasi) onPostAllUnposted();
  };

  const activeFilterCount = [
    filters.type !== 'all',
    filters.status !== 'all',
    filters.category !== 'all',
    filters.dateFrom,
    filters.dateTo,
    filters.amountMin,
    filters.amountMax,
  ].filter(Boolean).length;

  const resetFilters = () => {
    onFiltersChange({ type: 'all', status: 'all', category: 'all', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' });
  };

  return (
    <div className="card-elevated rounded-xl p-4 space-y-3">
      {/* Main filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder="Cari TX ID, deskripsi, pihak, referensi..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
          />
          {search && (
            <button onClick={() => onSearchChange('')} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Type quick filter */}
        <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
          {typeOptions.map((t) => (
            <button
              key={`type-${t}`}
              onClick={() => onFiltersChange({ ...filters, type: t })}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 ${
                filters.type === t ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {typeLabels[t]}
            </button>
          ))}
        </div>

        {/* Status */}
        <div className="relative">
          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
            className="input-base w-auto text-xs py-1.5 pr-8 cursor-pointer appearance-none"
          >
            {statusOptions.map((s) => (
              <option key={`status-${s}`} value={s}>{statusLabels[s] || s}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>

        {/* Category */}
        <div className="relative">
          <select
            value={filters.category}
            onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })}
            className="input-base w-auto text-xs py-1.5 pr-8 cursor-pointer appearance-none"
          >
            {categoryOptions.map((c) => (
              <option key={`cat-${c}`} value={c}>{c === 'all' ? 'Semua Kategori' : c}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced((p) => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-150 ${
            showAdvanced || activeFilterCount > 0
              ? 'bg-primary/10 border-primary/30 text-primary' :'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <SlidersHorizontal size={13} />
          Filter Lanjutan
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-negative transition-colors"
          >
            <X size={12} />
            Reset
          </button>
        )}

        {/* [BARU] Posting Semua — men-posting seluruh transaksi berstatus
            Unposted (biasanya hasil import rekening koran) sekaligus. */}
        <button
          onClick={handlePostAllClick}
          disabled={unpostedCount === 0}
          title={unpostedCount === 0 ? 'Tidak ada transaksi Unposted' : `Posting ${unpostedCount} transaksi Unposted`}
          className={`ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-150 ${
            unpostedCount > 0
              ? 'bg-positive/10 border-positive/30 text-positive hover:bg-positive/15'
              : 'border-border text-muted-foreground opacity-50 cursor-not-allowed'
          }`}
        >
          <CheckCheck size={13} />
          Posting Semua
          {unpostedCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-positive text-white text-[9px] font-bold flex items-center justify-center">
              {unpostedCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border fade-in">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Tanggal Dari</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value })}
              className="input-base text-xs py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Tanggal Sampai</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value })}
              className="input-base text-xs py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nominal Min (Rp)</label>
            <input
              type="number"
              placeholder="0"
              value={filters.amountMin}
              onChange={(e) => onFiltersChange({ ...filters, amountMin: e.target.value })}
              className="input-base text-xs py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Nominal Max (Rp)</label>
            <input
              type="number"
              placeholder="999.999.999"
              value={filters.amountMax}
              onChange={(e) => onFiltersChange({ ...filters, amountMax: e.target.value })}
              className="input-base text-xs py-1.5 font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}
