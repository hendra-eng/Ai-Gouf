'use client';

import React, { useState, useMemo } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import DataTable from '@/components/shared/DataTable';
import Pagination from '@/components/shared/Pagination';
import TransactionDrawer from '../components/TransactionDrawer';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, monthlyTrendFor, categoryBreakdown, CHART_COLORS } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';

const PAGE_SIZE = 8;

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'cash_reserve' = pergerakan kas/bank & pendanaan (akun Kas
// & Bank, Deposito, kategori 'Financing') — lihat getTransactionGroup().
export default function CashReservePage() {
  const { getByGroup } = useTransactions();
  const reserveTx = useMemo(() => getByGroup('cash_reserve'), [getByGroup]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const statuses = ['All', 'Posted', 'Unposted', 'Reconciled', 'Draft', 'Voided'];

  const filtered = useMemo(() => {
    let data = [...reserveTx];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(t =>
        t.party.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.txId.toLowerCase().includes(q) ||
        t.reference.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'All') data = data.filter(t => t.status === statusFilter);
    data.sort((a, b) => {
      const av = a[sortKey as keyof Transaction] as string | number ?? '';
      const bv = b[sortKey as keyof Transaction] as string | number ?? '';
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return data;
  }, [reserveTx, search, statusFilter, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const inflow = reserveTx.reduce((s, t) => s + t.debit, 0); // masuk ke Kas & Bank
  const outflow = reserveTx.reduce((s, t) => s + t.credit, 0); // keluar dari Kas & Bank
  const netMovement = inflow - outflow;
  const txCount = reserveTx.length;
  const latestBalance = useMemo(() => {
    const sorted = [...reserveTx].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted[0]?.saldoAkhir ?? 0;
  }, [reserveTx]);

  const trend = useMemo(() => monthlyTrendFor(reserveTx), [reserveTx]);
  const byCategory = useMemo(() => categoryBreakdown(reserveTx).slice(0, 6), [reserveTx]);
  const byAccount = useMemo(() => {
    const byAcc = new Map<string, number>();
    reserveTx.forEach(tx => byAcc.set(tx.accountName, (byAcc.get(tx.accountName) || 0) + txAmount(tx)));
    return Array.from(byAcc.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [reserveTx]);

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'accountName', label: 'Akun Kas/Bank', render: (r: Transaction) => <span className="font-medium text-xs">{r.accountName}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-text-secondary max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-info">{r.category}</span> },
    { key: 'debit', label: 'Masuk', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-emerald-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Keluar', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-rose-700">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'saldoAkhir', label: 'Saldo Akhir', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatIDR(r.saldoAkhir, true)}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-700 text-foreground">Cash Reserve</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pergerakan kas, bank & pendanaan — diambil otomatis dari halaman Transaksi</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Saldo Terakhir" value={latestBalance} icon="BanknotesIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" compact />
        <KpiCard title="Kas Masuk" value={inflow} icon="ArrowDownCircleIcon" iconColor="text-teal-600" iconBg="bg-teal-50" compact />
        <KpiCard title="Kas Keluar" value={outflow} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" compact />
        <KpiCard title="Pergerakan Bersih" value={netMovement} icon="ScaleIcon" iconColor={netMovement >= 0 ? 'text-emerald-600' : 'text-rose-600'} iconBg={netMovement >= 0 ? 'bg-emerald-50' : 'bg-rose-50'} compact />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-card border-2 border-border rounded-lg shadow-card-md card-hover p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-primary">Tren Cash Reserve Bulanan</h2>
            <p className="text-xs text-text-secondary mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.length === 0 ? (
            <p className="text-xs text-text-secondary py-10 text-center">Belum ada transaksi Cash Reserve untuk ditampilkan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradReserveMain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => formatIDR(v, true)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={65} />
                <Tooltip formatter={(v: number) => formatIDR(v)} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="total" name="Cash Reserve" stroke="#3b82f6" strokeWidth={2.5} fill="url(#gradReserveMain)" dot={{ r: 3, fill: '#3b82f6' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border-2 border-border rounded-lg shadow-card-md card-hover p-5">
          <h2 className="text-sm font-bold text-text-primary mb-1">Berdasarkan Akun</h2>
          <p className="text-xs text-text-secondary mb-3">Kontribusi per akun Kas/Bank</p>
          {byAccount.length === 0 ? (
            <p className="text-xs text-text-secondary py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {byAccount.map((acc, i) => {
                const total = byAccount.reduce((s, c) => s + c.amount, 0);
                const pct = total > 0 ? (acc.amount / total) * 100 : 0;
                return (
                  <div key={acc.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-secondary truncate flex-1">{acc.name}</span>
                      <span className="text-xs font-semibold font-mono ml-2">{formatIDR(acc.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border-2 border-border rounded-lg shadow-card-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Transaksi Cash Reserve</h2>
            <p className="text-xs text-text-secondary mt-0.5">{filtered.length} transaksi · Klik baris untuk detail</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Icon name="MagnifyingGlassIcon" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Cari akun, TX ID..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 w-52"
              />
            </div>
            {statuses.map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`filter-btn text-xs ${statusFilter === s ? 'active' : ''}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          data={paginated}
          onRowClick={setSelectedTx}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage="Belum ada transaksi Cash Reserve. Tambahkan / import di halaman Transaksi."
        />
        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}
