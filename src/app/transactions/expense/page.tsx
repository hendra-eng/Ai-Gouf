'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../components/TransactionDrawer';
import TransactionsGroupPanel from '../components/TransactionsGroupPanel';
import { Transaction, PAYMENT_STATUS_VARIANT } from '../components/transactionData';
import { useTransactions } from '../context/TransactionsContext';
import { formatIDR, formatDate, txAmount, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS } from '../lib/groupAnalytics';
import { expenseOutstanding, expenseBillStatus } from '../lib/apBridge';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatusBadge from '@/components/ui/StatusBadge';
import { ArrowUpRight } from 'lucide-react';

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Sama seperti Sales — turunan langsung dari transaksi kelompok
// 'expense' (akun Beban, kategori Payroll/Software/Rent/Marketing/Travel/
// Utilities) di halaman Transaksi, lewat getByGroup('expense').
export default function ExpensePage() {
  const { getByGroup } = useTransactions();
  const expenseTx = useMemo(() => getByGroup('expense'), [getByGroup]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const totalExpense = expenseTx.reduce((s, t) => s + txAmount(t), 0);
  const txCount = expenseTx.length;
  const avgTxValue = txCount > 0 ? totalExpense / txCount : 0;
  const unpostedCount = expenseTx.filter(t => t.status === 'Unposted').length;
  const recurringLike = expenseTx.filter(t => ['Payroll', 'Rent', 'Software', 'Utilities'].includes(t.category)).length;

  // [BARU] Nilai yang belum dibayar ke vendor di antara transaksi Expense —
  // inilah angka yang "mengalir" ke halaman Account Payable (lihat apBridge.ts).
  const outstandingToAP = useMemo(() => expenseTx.reduce((s, t) => s + expenseOutstanding(t), 0), [expenseTx]);
  const overdueToAPCount = useMemo(
    () => expenseTx.filter((t) => expenseOutstanding(t) > 0 && expenseBillStatus(t) === 'Overdue').length,
    [expenseTx]
  );

  const trend = useMemo(() => monthlyTrendFor(expenseTx), [expenseTx]);
  const byCategory = useMemo(() => categoryBreakdown(expenseTx).slice(0, 6), [expenseTx]);
  const topVendors = useMemo(() => topParties(expenseTx, 5), [expenseTx]);

  const columns = [
    { key: 'date', label: 'Tanggal', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: 'TX ID', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: 'Vendor / Pihak', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    { key: 'description', label: 'Deskripsi', render: (r: Transaction) => <span className="text-xs text-muted-foreground max-w-xs truncate block">{r.description}</span> },
    { key: 'category', label: 'Kategori', render: (r: Transaction) => <span className="badge badge-warning">{r.category}</span> },
    { key: 'accountName', label: 'Akun', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.accountName}</span> },
    { key: 'debit', label: 'Debit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs font-semibold text-orange-700">{r.debit ? formatIDR(r.debit, true) : '—'}</span> },
    { key: 'credit', label: 'Kredit', sortable: true, render: (r: Transaction) => <span className="font-mono text-xs">{r.credit ? formatIDR(r.credit, true) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={r.status} dot /> },
    // [BARU] Kolom penghubung ke Account Payable — status ini yang menentukan
    // apakah baris ini muncul sebagai tagihan terbuka di halaman AP atau tidak.
    {
      key: 'paymentStatus',
      label: 'Status Pembayaran (AP)',
      render: (r: Transaction) => {
        const ps = r.paymentStatus || 'Belum Dibayar';
        return (
          <div className="flex flex-col gap-0.5">
            <StatusBadge variant={PAYMENT_STATUS_VARIANT[ps]} label={ps} dot />
            {r.dueDate && ps !== 'Lunas' && (
              <span className="text-2xs text-muted-foreground">Jatuh tempo {formatDate(r.dueDate)}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Expense</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transaksi beban operasional — diambil otomatis dari halaman Transaksi</p>
      </div>

      {/* [BARU] Banner penghubung ke Account Payable — setiap transaksi
          Expense yang Status Pembayarannya belum "Lunas" otomatis muncul
          sebagai tagihan (bill) di halaman Account Payable. */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ArrowUpRight size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {formatIDR(outstandingToAP, true)} belum dibayar ke vendor
              {overdueToAPCount > 0 && <span className="text-danger"> — {overdueToAPCount} sudah jatuh tempo</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Otomatis tersinkron ke halaman Account Payable berdasarkan kolom "Status Pembayaran (AP)" di tabel bawah.
            </p>
          </div>
        </div>
        <Link
          href="/accounts-payable"
          className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-card border border-primary/30 hover:bg-primary/10 rounded-md px-3 py-2 transition-colors flex-shrink-0"
        >
          Lihat di Account Payable
          <ArrowUpRight size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard title="Total Expense" value={totalExpense} icon="CreditCardIcon" iconColor="text-orange-600" iconBg="bg-orange-50" />
        <KpiCard title="Jumlah Transaksi" value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title="Rata-rata / Transaksi" value={avgTxValue} icon="CalculatorIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title="Belum Diposting" value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title="Beban Rutin" value={String(recurringLike)} icon="ArrowPathIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">Tren Expense Bulanan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan transaksi yang tercatat di halaman Transaksi</p>
          </div>
          {trend.every(t => t.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Expense untuk ditampilkan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradExpenseMain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => formatIDR(v, true)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={65} />
                <Tooltip formatter={(v: number) => formatIDR(v)} contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="total" name="Expense" stroke="#f97316" strokeWidth={2.5} fill="url(#gradExpenseMain)" dot={{ r: 3, fill: '#f97316' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Expense per Kategori</h2>
          <p className="text-xs text-muted-foreground mb-3">Breakdown beban</p>
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((cat, i) => {
                const total = byCategory.reduce((s, c) => s + c.value, 0);
                const pct = total > 0 ? (cat.value / total) * 100 : 0;
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground truncate flex-1">{cat.name}</span>
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

      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-foreground mb-1">Top Vendor / Pihak</h2>
        <p className="text-xs text-muted-foreground mb-4">Berdasarkan kontribusi nominal beban</p>
        {topVendors.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
        ) : (
          <div className="space-y-3">
            {topVendors.map((c, i) => {
              const max = topVendors[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-orange-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Expense — digabung jadi 1 kolom,
          aksi & filter di atas tabel. */}
      <TransactionsGroupPanel
        group="expense"
        groupLabel="Expense"
        defaultCategory="Software"
        columns={columns}
        onRowClick={setSelectedTx}
        // [BARU] Tombol Import di halaman Expense sekarang MENGGANTI (bukan
        // menambah) seluruh transaksi Expense dengan hasil upload PDF
        // "Data Penjualan Detail" (kasir/POS) — kelompok transaksi lain
        // (Sales, Cash Payment, dll) tidak ikut terhapus. Excel/rekening
        // koran belum didukung di mode ini, hanya PDF.
        importMode="replace-group"
      />

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}
