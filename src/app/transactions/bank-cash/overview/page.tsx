'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatIDR, formatIDRChart } from '../lib/formatMoney';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CashBankTabs from '../components/CashBankTabs';
import { useActiveClient } from '@/lib/activeClient';
import { useBcOverview, CASH_TYPE_LABEL } from '@/lib/bankCashStore';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Landmark, Scale } from 'lucide-react';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Overview Cash & Bank (GET /api/v1/transactions/bank-cash/overview):
//   - Cash In / Out / Net = transaksi Cash & Bank POSTED di tahun terpilih
//     (transaksi yang dibalik dinetralkan di bulan pembaliknya).
//   - Saldo per akun = saldo buku besar akun kas/bank (semua transaksi posted
//     dari modul mana pun + saldo awal), dibanding saldo rekening koran terakhir.
//   - Pipeline = mutasi belum cocok + transaksi yang belum diposting.
// Kartu KPI -- desain sama dengan OverviewKpiTile di halaman Sales (tema elegant monokrom:
// garis aksen hitam di atas, border abu, ikon abu, bar proporsi hitam).
const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

function OverviewKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Kotak status di kartu Pipeline -- border abu, hover hitam, sama dengan kartu Sales.
const pipeTileCls = 'relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white px-4 py-3 pt-4 transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700';
const pipeLabelCls = 'text-xs font-semibold uppercase tracking-wide text-neutral-600';
const pipeNumCls = 'mt-1 text-lg font-semibold tabular-nums tracking-tight text-neutral-900';
const pipeSubCls = 'text-[11px] font-medium text-neutral-500 tabular-nums';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CashBankOverviewPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
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
    <div className="space-y-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{error}</span>
          <button onClick={refresh} className="font-semibold underline hover:no-underline shrink-0">Retry</button>
        </div>
      )}

      {unmatched > 0 && (
        <Link
          href="/transactions/bank-cash/reconciliation"
          className="flex items-start gap-3 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-4 py-3 text-xs text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          <AlertTriangle size={15} className="mt-px shrink-0 text-neutral-700" />
          <p className="leading-relaxed">
            <span className="font-semibold text-neutral-900">{unmatched} Source Data lines</span> are unmatched — click to open Reconciliation.
          </p>
        </Link>
      )}

      <div className="rounded-[10px] border border-neutral-300 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold tracking-tight text-neutral-900">Pipeline</h2>
        <p className="mb-3 text-xs font-medium text-neutral-500">Transactions hit the ledger (and settle invoices) only once posted.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/transactions/bank-cash/reconciliation" className={pipeTileCls}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <p className={pipeLabelCls}>Unmatched</p>
            <p className={pipeNumCls}>{unmatched}</p>
            <p className={pipeSubCls}>Source Data lines</p>
          </Link>
          <Link href="/transactions/bank-cash/journal-preview" className={pipeTileCls}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <p className={pipeLabelCls}>Draft (awaiting Approve)</p>
            <p className={pipeNumCls}>{pipeline?.draft.count ?? 0}</p>
            <p className={pipeSubCls}>{formatIDR(pipeline?.draft.amount ?? 0, true)}</p>
          </Link>
          <Link href="/transactions/bank-cash/journal-preview" className={pipeTileCls}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <p className={pipeLabelCls}>Approved (awaiting Post)</p>
            <p className={pipeNumCls}>{pipeline?.approved.count ?? 0}</p>
            <p className={pipeSubCls}>{formatIDR(pipeline?.approved.amount ?? 0, true)}</p>
          </Link>
          <Link href="/transactions/bank-cash/posted" className={pipeTileCls}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <p className={pipeLabelCls}>Posted</p>
            <p className={pipeNumCls}>{pipeline?.posted.count ?? 0}</p>
            <p className={pipeSubCls}>{formatIDR(pipeline?.posted.amount ?? 0, true)}</p>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <OverviewKpiTile
          label={`Total Cash In ${tahun}`} value={formatIDR(totalIn)} icon={ArrowDownCircle}
          pct={pctOf(totalIn, totalIn + totalOut)} pctLabel="of total cash flow"
        />
        <OverviewKpiTile
          label={`Total Cash Out ${tahun}`} value={formatIDR(totalOut)} icon={ArrowUpCircle}
          pct={pctOf(totalOut, totalIn + totalOut)} pctLabel="of total cash flow"
        />
        <OverviewKpiTile
          label="Net Cash Flow" value={formatIDR(netCashFlow)} icon={Scale}
          pct={pctOf(Math.abs(netCashFlow), Math.max(totalIn, totalOut))} pctLabel="of largest cash flow"
        />
        <OverviewKpiTile
          label="Unreconciled" value={String(unmatched)} icon={AlertTriangle}
          sub={`of ${totalMutasi} Source Data lines`}
          pct={pctOf(unmatched, totalMutasi)} pctLabel="of Source Data lines"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900 mb-1">Monthly Cash Flow</h2>
              <p className="text-xs text-neutral-500">Cash In vs Cash Out — posted Cash & Bank transactions</p>
            </div>
            <select
              value={tahun}
              onChange={(e) => setTahun(Number(e.target.value))}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-neutral-900"
            >
              {Array.from({ length: 6 }, (_, i) => tahunIni - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {bulanan.every((t) => t.masuk === 0 && t.keluar === 0) ? (
            <p className="text-xs text-neutral-500 py-10 text-center">{loading ? 'Loading data...' : `No posted Cash & Bank transactions in ${tahun} yet.`}</p>
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
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#737373' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatIDRChart(v)} tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={65} />
                <Tooltip formatter={(v: number) => formatIDR(v)} />
                <Area type="monotone" dataKey="masuk" name="Cash In" stroke="#059669" strokeWidth={2.5} fill="url(#gradIn)" />
                <Area type="monotone" dataKey="keluar" name="Cash Out" stroke="#e11d48" strokeWidth={2.5} fill="url(#gradOut)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <div className="mb-4 flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
              <Landmark size={17} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-neutral-900">Balance per Account</h2>
              <p className="mt-0.5 text-xs text-neutral-500">Ledger balance of cash & bank accounts; latest bank statement balance below</p>
            </div>
          </div>
          {akun.length === 0 ? (
            <p className="text-xs text-neutral-500 py-6 text-center">{loading ? 'Loading...' : 'No cash/bank account in this company\'s COA yet.'}</p>
          ) : (
            <div className="max-h-[260px] overflow-y-auto scrollbar-thin pr-1 border-t border-[#b4b4b4]">
              {akun.map((a) => (
                <div key={a.id} className="border-b border-[#b4b4b4] px-1 py-2.5 transition-colors hover:bg-neutral-100">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs font-medium text-neutral-900 truncate flex-1" title={`${kodeAkun(a.code)} ${a.name}`}>
                      {kodeAkun(a.code)} · {a.name}
                      <span className="text-[10px] font-medium text-neutral-500"> · {a.cash_type ? CASH_TYPE_LABEL[a.cash_type] : ''}</span>
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-neutral-900">{formatIDR(a.book_balance, true)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${a.book_balance < 0 ? 'bg-neutral-500' : 'bg-neutral-800'}`}
                      style={{ width: `${Math.min(100, (Math.abs(a.book_balance) / maksSaldo) * 100)}%` }}
                    />
                  </div>
                  {a.bank_balance !== null && (
                    <p className={`text-[11px] mt-0.5 ${Math.abs(a.bank_balance - a.book_balance) < 1 ? 'font-medium text-neutral-500' : 'font-semibold text-neutral-900'}`}>
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
