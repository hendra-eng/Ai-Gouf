'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, uniqueJournalTotal, uniqueJournalCount, monthlyTrendFor, CHART_COLORS } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CashBankTabs from '../components/CashBankTabs';
import { useBankFeed } from '../context/BankFeedContext';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// [BARU] Halaman Overview — murni agregasi dari data yang SUDAH real
// (Cash Payment/Cash Receipt via TransactionsContext) + jumlah item Bank
// Feed yang belum dicocokkan (state mock, lihat BankFeedContext). Tidak ada
// data baru yang diminta dari backend di halaman ini.
export default function CashBankOverviewPage() {
  const { getByGroup } = useTransactions();
  const { mutations } = useBankFeed();

  const paymentTx = useMemo(() => getByGroup('cash_payment'), [getByGroup]);
  const receiptTx = useMemo(() => getByGroup('cash_receipt'), [getByGroup]);

  const totalOut = uniqueJournalTotal(paymentTx);
  const totalIn = uniqueJournalTotal(receiptTx);
  const netCashFlow = totalIn - totalOut;
  const txCount = uniqueJournalCount(paymentTx) + uniqueJournalCount(receiptTx);

  const unmatchedCount = useMemo(() => mutations.filter((m) => m.status === 'unmatched').length, [mutations]);

  // Gabung tren bulanan payment (keluar) & receipt (masuk) jadi satu chart.
  const trendOut = useMemo(() => monthlyTrendFor(paymentTx), [paymentTx]);
  const trendIn = useMemo(() => monthlyTrendFor(receiptTx), [receiptTx]);
  const combinedTrend = useMemo(
    () => trendOut.map((t, i) => ({ month: t.month, masuk: trendIn[i]?.total || 0, keluar: t.total })),
    [trendOut, trendIn]
  );

  // Saldo per akun bank/kas — dihitung sederhana dari saldoAkhir baris
  // terakhir tiap accountName (mengikuti field yang sudah ada di Transaction).
  const saldoPerAkun = useMemo(() => {
    const map = new Map<string, number>();
    [...paymentTx, ...receiptTx].forEach((tx) => {
      if (tx.accountName && tx.accountName !== '—') map.set(tx.accountName, tx.saldoAkhir || map.get(tx.accountName) || 0);
    });
    return Array.from(map.entries())
      .map(([name, saldo]) => ({ name, saldo }))
      .sort((a, b) => b.saldo - a.saldo)
      .slice(0, 6);
  }, [paymentTx, receiptTx]);

  return (
    <div className="p-6">
      <CashBankTabs />

      {unmatchedCount > 0 && (
        <Link
          href="/transactions/bank-cash/reconciliation"
          className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-6 hover:bg-amber-100 transition-colors"
        >
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">{unmatchedCount} mutasi Bank Feed</span> belum dicocokkan dengan Cash
            Payment/Cash Receipt — klik untuk buka Reconciliation.
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title="Total Cash In" value={totalIn} icon="ArrowDownCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Total Cash Out" value={totalOut} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" />
        <KpiCard
          title="Net Cash Flow"
          value={netCashFlow}
          icon="ScaleIcon"
          iconColor={netCashFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          iconBg={netCashFlow >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}
        />
        <KpiCard
          title="Belum Direkonsiliasi"
          value={String(unmatchedCount)}
          icon="ExclamationTriangleIcon"
          iconColor={unmatchedCount > 0 ? 'text-amber-600' : 'text-slate-400'}
          iconBg={unmatchedCount > 0 ? 'bg-amber-50' : 'bg-slate-50'}
          subLabel={`dari ${mutations.length} total mutasi Bank Feed`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Arus Kas Bulanan</h2>
          <p className="text-xs text-muted-foreground mb-3">Cash In vs Cash Out — Cash Payment & Cash Receipt</p>
          {combinedTrend.every((t) => t.masuk === 0 && t.keluar === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi untuk ditampilkan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={combinedTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatIDR(v, true)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={65} />
                <Tooltip formatter={(v: number) => formatIDR(v)} />
                <Area type="monotone" dataKey="masuk" name="Cash In" stroke="#059669" strokeWidth={2.5} fill="url(#gradIn)" />
                <Area type="monotone" dataKey="keluar" name="Cash Out" stroke="#e11d48" strokeWidth={2.5} fill="url(#gradOut)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Saldo per Akun</h2>
          <p className="text-xs text-muted-foreground mb-3">Bank & Kas</p>
          {saldoPerAkun.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Belum ada data.</p>
          ) : (
            <div className="space-y-2.5">
              {saldoPerAkun.map((a, i) => (
                <div key={a.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground truncate flex-1">{a.name}</span>
                    <span className="text-xs font-semibold font-mono ml-2">{formatIDR(a.saldo, true)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, (a.saldo / (saldoPerAkun[0].saldo || 1)) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{txCount} transaksi Cash Payment + Cash Receipt tercatat.</p>
    </div>
  );
}
