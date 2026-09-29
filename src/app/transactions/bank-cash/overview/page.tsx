'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { formatIDR, CHART_COLORS } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CashBankTabs from '../components/CashBankTabs';
import { useBankFeed } from '../context/BankFeedContext';
import { usePembayaranRekon } from '../lib/useBankCashRekon';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// [DIUBAH] Overview membaca dari sumber yang SAMA dengan tab Reconciliation, yaitu pembayaran hasil
// rekonsiliasi di backend (/api/v1/finance/bank-reconciliation/payments): Cash In = penerimaan
// invoice Sales, Cash Out = pembayaran invoice Purchase, yang sudah dicocokkan dengan mutasi bank.
// Sebelumnya dari TransactionsContext (sumber lama). "Saldo per Akun" dan jumlah mutasi belum
// cocok tetap dari Bank Feed (hanya ada di sesi browser).
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export default function CashBankOverviewPage() {
  const { mutations } = useBankFeed();
  const { payments, loading, error, refresh } = usePembayaranRekon();

  const totalOut = useMemo(() => payments.filter((p) => p.direction === 'cash_payment').reduce((n, p) => n + p.amount, 0), [payments]);
  const totalIn = useMemo(() => payments.filter((p) => p.direction === 'cash_receipt').reduce((n, p) => n + p.amount, 0), [payments]);
  const netCashFlow = totalIn - totalOut;
  const txCount = payments.length;

  const unmatchedCount = useMemo(() => mutations.filter((m) => m.status === 'unmatched').length, [mutations]);

  // Tren bulanan menurut tanggal pembayaran; tahun = tahun pembayaran terbaru.
  const combinedTrend = useMemo(() => {
    const tahun = payments.reduce((maks, p) => {
      const y = new Date(p.payment_date).getFullYear();
      return Number.isFinite(y) && y > maks ? y : maks;
    }, 0) || new Date().getFullYear();
    const bulan = MONTH_LABELS.map((month) => ({ month, masuk: 0, keluar: 0 }));
    payments.forEach((p) => {
      const d = new Date(p.payment_date);
      if (isNaN(d.getTime()) || d.getFullYear() !== tahun) return;
      if (p.direction === 'cash_receipt') bulan[d.getMonth()].masuk += p.amount;
      else bulan[d.getMonth()].keluar += p.amount;
    });
    return bulan;
  }, [payments]);

  // Saldo terbaru per rekening dari Bank Feed (mutasi sudah terurut terbaru dulu). Saldo dihitung
  // dari 0 + kredit - debit karena saldo awal rekening koran tidak dibaca.
  const saldoPerAkun = useMemo(() => {
    const map = new Map<string, number>();
    mutations.forEach((m) => {
      if (m.bankAccount && !map.has(m.bankAccount)) map.set(m.bankAccount, m.balanceAfter);
    });
    return Array.from(map.entries())
      .map(([name, saldo]) => ({ name, saldo }))
      .sort((a, b) => b.saldo - a.saldo)
      .slice(0, 6);
  }, [mutations]);

  return (
    <div className="p-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refresh} className="font-semibold underline hover:no-underline shrink-0">Coba lagi</button>
        </div>
      )}

      {unmatchedCount > 0 && (
        <Link
          href="/transactions/bank-cash/reconciliation"
          className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-6 hover:bg-amber-100 transition-colors"
        >
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">{unmatchedCount} mutasi Bank Feed</span> belum dicocokkan dengan invoice
            Purchase/Sales — klik untuk buka Reconciliation.
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
          <p className="text-xs text-muted-foreground mb-3">Cash In vs Cash Out — pembayaran & penerimaan yang sudah direkonsiliasi</p>
          {combinedTrend.every((t) => t.masuk === 0 && t.keluar === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{loading ? 'Memuat data...' : 'Belum ada pembayaran yang direkonsiliasi.'}</p>
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
          <p className="text-xs text-muted-foreground mb-3">Dari Bank Feed sesi ini</p>
          {saldoPerAkun.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Upload rekening koran di tab Bank Feed untuk melihat saldo.</p>
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
                      style={{ width: `${Math.max(0, Math.min(100, (a.saldo / (saldoPerAkun[0].saldo || 1)) * 100))}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{txCount} pembayaran hasil rekonsiliasi tercatat (Cash Payment + Cash Receipt).</p>
    </div>
  );
}