'use client';

import React, { useState, useMemo } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import DataTable from '@/components/shared/DataTable';
import Pagination from '@/components/shared/Pagination';
import TransactionDrawer from '../components/TransactionDrawer';
import { Transaction } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS } from '../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';

const PAGE_SIZE = 8;

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Kelompok 'cash_payment' = pembayaran kewajiban tunai/bank (Hutang
// Usaha, Pajak/PPN/PPh) — lihat getTransactionGroup() di transactionData.ts.
export default function CashPaymentPage() {
  const { getByGroup } = useTransactions();
  const paymentTx = useMemo(() => getByGroup('cash_payment'), [getByGroup]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const statuses = ['All', 'Posted', 'Unposted', 'Reconciled', 'Draft', 'Voided'];

  const filtered = useMemo(() => {
    let data = [...paymentTx];
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
  }, [paymentTx, search, statusFilter, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const totalPayment = paymentTx.reduce((s, t) => s + txAmount(t), 0);
  const txCount = paymentTx.length;
  const avgTxValue = txCount > 0 ? totalPayment / txCount : 0;
  const unpostedCount = paymentTx.filter(t => t.status === 'Unposted').length;
  const taxCount = paymentTx.filter(t => t.category === 'Tax').length;
  const apCount = paymentTx.filter(t => t.category === 'AP Payment').length;

  const trend = useMemo(() => monthlyTrendFor(paymentTx), [paymentTx]);
  const byCategory = useMemo(() => categoryBreakdown(paymentTx).slice(0, 6), [paymentTx]);
  const topPayees = useMemo(() => topParties(paymentTx, 5), [paymentTx]);

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Penerima', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-text-secondary max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-neutral">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-text-secondary">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-rose-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-700 text-foreground">Cash Payment</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pembayaran hutang usaha & pajak — diambil otomatis dari halaman Transaksi</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Cash Payment" value={totalPayment} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" compact />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" compact />
        <KpiCard title="Pembayaran Pajak" value={String(taxCount)} icon="ReceiptPercentIcon" iconColor="text-amber-600" iconBg="bg-amber-50" />
        <KpiCard title="Pembayaran Hutang Usaha" value={String(apCount)} icon="BuildingLibraryIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>
      {unpostedCount > 0 && (
        <p className="text-xs text-amber-700 -mt-4 mb-2">⚠ {unpostedCount} transaksi Cash Payment belum diposting.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-card border-2 border-border rounded-lg shadow-card-md card-hover p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-text-primary">Tren Cash Payment Bulanan</h2>
            <p className="text-xs text-text-secondary mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.length === 0 ? (
            <p className="text-xs text-text-secondary py-10 text-center">Belum ada transaksi Cash Payment untuk ditampilkan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradPaymentMain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => formatIDR(v, true)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={65} />
                <Tooltip formatter={(v: number) => formatIDR(v)} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="total" name="Cash Payment" stroke="#e11d48" strokeWidth={2.5} fill="url(#gradPaymentMain)" dot={{ r: 3, fill: '#e11d48' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border-2 border-border rounded-lg shadow-card-md card-hover p-5">
          <h2 className="text-sm font-bold text-text-primary mb-1">Payment per Kategori</h2>
          <p className="text-xs text-text-secondary mb-3">Breakdown pembayaran</p>
          {byCategory.length === 0 ? (
            <p className="text-xs text-text-secondary py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((cat, i) => {
                const total = byCategory.reduce((s, c) => s + c.value, 0);
                const pct = total > 0 ? (cat.value / total) * 100 : 0;
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-secondary truncate flex-1">{cat.name}</span>
                      <span className="text-xs font-semibold font-mono ml-2">{formatIDR(cat.value, true)}</span>
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

      <div className="bg-card border-2 border-border rounded-lg shadow-card-md card-hover p-5 mb-6">
        <h2 className="text-sm font-bold text-text-primary mb-1">Top Penerima Pembayaran</h2>
        <p className="text-xs text-text-secondary mb-4">Berdasarkan kontribusi nominal</p>
        {topPayees.length === 0 ? (
          <p className="text-xs text-text-secondary py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topPayees.map((c, i) => {
              const max = topPayees[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-text-primary truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-rose-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-card border-2 border-border rounded-lg shadow-card-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Transaksi Cash Payment</h2>
            <p className="text-xs text-text-secondary mt-0.5">{filtered.length} transaksi · Klik baris untuk detail</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Icon name="MagnifyingGlassIcon" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Cari penerima, TX ID..."
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
          emptyMessage="Belum ada transaksi Cash Payment. Tambahkan / import di halaman Transaksi."
        />
        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}
