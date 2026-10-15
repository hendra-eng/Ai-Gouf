'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { formatIDR } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CashBankTabs from '../components/CashBankTabs';
import { useActiveClient } from '@/lib/activeClient';
import { useBcOverview, CASH_TYPE_LABEL } from '@/lib/bankCashStore';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// Overview Cash & Bank (GET /api/v1/transactions/bank-cash/overview):
//   - Cash In / Out / Net = transaksi Cash & Bank POSTED di tahun terpilih
//     (transaksi yang dibalik dinetralkan di bulan pembaliknya).
//   - Saldo per akun = saldo buku besar akun kas/bank (semua transaksi posted
//     dari modul mana pun + saldo awal), dibanding saldo rekening koran terakhir.
//   - Pipeline = mutasi belum cocok + transaksi yang belum diposting.
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CashBankOverviewPage() {
  const { activeClientId } = useActiveClient();
  const tahunIni = new Date().getFullYear();
  const [tahun, setTahun] = useState(tahunIni);
  const { overview, loading, error, refresh } = useBcOverview(activeClientId ? String(activeClientId) : null, tahun);

  const bulanan = useMemo(
    () => (overview?.monthly ?? []).map((b) => ({ month: MONTH_LABELS[b.month - 1], masuk: b.cash_in, keluar: b.cash_out })),
    [overview],
  );
  const totalIn = bulanan.reduce((n, b) => n + b.masuk, 0);
  const totalOut = bulanan.reduce((n, b) => n + b.keluar, 0);
  const netCashFlow = totalIn - totalOut;
  const unmatched = overview?.mutations.unmatched ?? 0;
  const totalMutasi = overview ? overview.mutations.unmatched + overview.mutations.matched + overview.mutations.ignored : 0;
  const pipeline = overview?.pipeline;
  const akun = overview?.accounts ?? [];
  const maksSaldo = Math.max(1, ...akun.map((a) => Math.abs(a.book_balance)));

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refresh} className="font-semibold underline hover:no-underline shrink-0">Retry</button>
        </div>
      )}

      {unmatched > 0 && (
        <Link
          href="/transactions/bank-cash/reconciliation"
          className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-6 hover:bg-amber-100 transition-colors"
        >
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">{unmatched} Bank Feed lines</span> are unmatched — click to open Reconciliation.
          </span>
        </Link>
      )}

      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-foreground mb-1">Pipeline</h2>
        <p className="text-xs text-muted-foreground mb-3">Transactions hit the ledger (and settle invoices) only once posted.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/transactions/bank-cash/reconciliation" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors">
            <p className="text-xs text-amber-800">Unmatched</p>
            <p className="text-lg font-bold text-amber-900 font-mono">{unmatched}</p>
            <p className="text-[11px] text-amber-700">Bank Feed lines</p>
          </Link>
          <Link href="/transactions/bank-cash/journal-preview" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition-colors">
            <p className="text-xs text-slate-700">Draft (awaiting Approve)</p>
            <p className="text-lg font-bold text-slate-900 font-mono">{pipeline?.draft.count ?? 0}</p>
            <p className="text-[11px] text-slate-600 font-mono">{formatIDR(pipeline?.draft.amount ?? 0, true)}</p>
          </Link>
          <Link href="/transactions/bank-cash/journal-preview" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 hover:bg-blue-100 transition-colors">
            <p className="text-xs text-blue-800">Approved (awaiting Post)</p>
            <p className="text-lg font-bold text-blue-900 font-mono">{pipeline?.approved.count ?? 0}</p>
            <p className="text-[11px] text-blue-700 font-mono">{formatIDR(pipeline?.approved.amount ?? 0, true)}</p>
          </Link>
          <Link href="/transactions/bank-cash/posted" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 hover:bg-emerald-100 transition-colors">
            <p className="text-xs text-emerald-800">Posted</p>
            <p className="text-lg font-bold text-emerald-900 font-mono">{pipeline?.posted.count ?? 0}</p>
            <p className="text-[11px] text-emerald-700 font-mono">{formatIDR(pipeline?.posted.amount ?? 0, true)}</p>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title={`Total Cash In ${tahun}`} value={totalIn} icon="ArrowDownCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title={`Total Cash Out ${tahun}`} value={totalOut} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" />
        <KpiCard
          title="Net Cash Flow"
          value={netCashFlow}
          icon="ScaleIcon"
          iconColor={netCashFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          iconBg={netCashFlow >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}
        />
        <KpiCard
          title="Unreconciled"
          value={String(unmatched)}
          icon="ExclamationTriangleIcon"
          iconColor={unmatched > 0 ? 'text-amber-600' : 'text-slate-400'}
          iconBg={unmatched > 0 ? 'bg-amber-50' : 'bg-slate-50'}
          subLabel={`of ${totalMutasi} Bank Feed lines`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-foreground mb-1">Monthly Cash Flow</h2>
              <p className="text-xs text-muted-foreground">Cash In vs Cash Out — posted Cash & Bank transactions</p>
            </div>
            <select
              value={tahun}
              onChange={(e) => setTahun(Number(e.target.value))}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
            >
              {Array.from({ length: 6 }, (_, i) => tahunIni - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {bulanan.every((t) => t.masuk === 0 && t.keluar === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{loading ? 'Loading data...' : `No posted Cash & Bank transactions in ${tahun} yet.`}</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={bulanan} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
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
          <h2 className="text-sm font-bold text-foreground mb-1">Balance per Account</h2>
          <p className="text-xs text-muted-foreground mb-3">Ledger balance of cash & bank accounts; latest bank statement balance below</p>
          {akun.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{loading ? 'Loading...' : 'No cash/bank account in this company\'s COA yet.'}</p>
          ) : (
            <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
              {akun.map((a) => (
                <div key={a.id}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs text-foreground truncate flex-1" title={`${a.code} ${a.name}`}>
                      {a.code} · {a.name}
                      <span className="text-[10px] text-muted-foreground"> · {a.cash_type ? CASH_TYPE_LABEL[a.cash_type] : ''}</span>
                    </span>
                    <span className={`text-xs font-semibold font-mono ${a.book_balance < 0 ? 'text-rose-600' : ''}`}>{formatIDR(a.book_balance, true)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full">
                    <div
                      className={`h-full rounded-full ${a.book_balance < 0 ? 'bg-rose-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (Math.abs(a.book_balance) / maksSaldo) * 100)}%` }}
                    />
                  </div>
                  {a.bank_balance !== null && (
                    <p className={`text-[11px] mt-0.5 ${Math.abs(a.bank_balance - a.book_balance) < 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
                      Bank {formatIDR(a.bank_balance, true)}{a.bank_balance_date ? ` as of ${a.bank_balance_date}` : ''}
                      {a.unmatched_count > 0 ? ` · ${a.unmatched_count} unmatched` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
