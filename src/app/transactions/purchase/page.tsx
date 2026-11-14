'use client';

import React, { useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseExceptions, mapTransactionToUi, mapExceptionToUi } from '@/lib/purchaseStore';
import ProgressKpiTile, { type KpiTone } from '@/components/shared/ProgressKpiTile';
import { ShoppingBag, CircleDollarSign, Banknote, Clock, CheckCircle, AlertTriangle, Receipt, CalendarClock } from 'lucide-react';
import { PurchaseCategoryCard, PurchasePaymentStatusCard } from '@/app/transactions/purchase/components/PurchaseBreakdownCards';
import { PurchaseTopVendorsCard, PurchaseRecentActivityCard } from '@/app/transactions/purchase/components/PurchaseVendorActivityCards';
import PurchaseExceptionSummary from '@/app/transactions/purchase/components/PurchaseExceptionSummary';
import { PurchaseTrendCard, PurchaseStatusDonutCard } from '@/app/transactions/purchase/components/PurchaseOverviewCharts';


const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

// ── Data historis untuk Purchase Volume Trend (multi-periode + pan/scroll
// ala TradingView). Dibuat deterministik (bukan random murni) dari fungsi
// hash sederhana, supaya angkanya konsisten setiap render tapi tetap
// terlihat "natural" (ada tren naik & variasi musiman). Ini data contoh —
// kalau sudah tersambung ke backend, tinggal ganti fungsi build-nya. ──
function seededRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Data contoh harian (730 hari ke belakang) -- rumus & angkanya sama seperti sebelumnya,
// sekarang dikeluarkan sebagai record bertanggal (date + amount) supaya bisa diagregasi
// per hari/bulan/tahun oleh kartu tren (sama seperti invoice di Sales Overview).
type TrendRecord = { date: string; amount: number };

const DAILY_COUNT = 730;
function buildDailyPurchaseRecords(anchor: Date): TrendRecord[] {
  const records: TrendRecord[] = [];
  const anchorUtc = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  for (let i = 0; i < DAILY_COUNT; i++) {
    const daysAgo = DAILY_COUNT - 1 - i;
    const d = new Date(anchorUtc - daysAgo * 86_400_000);
    const dayOfWeek = d.getUTCDay();
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.35 : 1;
    const trend = i * 15;
    const seasonal = 4000 * Math.sin((i / 365) * Math.PI * 2);
    const noise = (seededRandom(i * 7.13) - 0.5) * 6000;
    const amount = Math.max(500, Math.round((9000 + trend + seasonal + noise) * weekendFactor));
    records.push({ date: d.toISOString().slice(0, 10), amount });
  }
  return records;
}

const categoryData = [
  { name: 'IT Equipment', value: 241840 },
  { name: 'Raw Materials', value: 158962 },
  { name: 'Professional Services', value: 71120 },
  { name: 'Logistics', value: 31976 },
  { name: 'Marketing', value: 39200 },
  { name: 'Office Supplies', value: 55549 },
  { name: 'Maintenance', value: 13888 },
];

const statusDist = [
  { name: 'Posted', value: 6, color: '#15803D' },
  { name: 'Approved', value: 2, color: '#0369A1' },
  { name: 'Pending Review', value: 2, color: '#D97706' },
  { name: 'Exception', value: 1, color: '#C2410C' },
  { name: 'Cancelled', value: 1, color: '#64748B' },
];

const paymentStatusDist = [
  { name: 'Unpaid', value: 4, color: '#DC2626' },
  { name: 'Paid', value: 5, color: '#15803D' },
  { name: 'Partially Paid', value: 1, color: '#D97706' },
  { name: 'Overdue', value: 1, color: '#C2410C' },
  { name: 'On Hold', value: 1, color: '#64748B' },
];

export default function PurchaseOverviewPage() {
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const clientId = activeClientId ?? null;
  const { transactions: backendTransactions } = usePurchaseTransactions(clientId);
  const purchaseTransactions = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);
  const { exceptions: backendExceptions } = usePurchaseExceptions(clientId);
  const purchaseExceptions = useMemo(() => backendExceptions.map(mapExceptionToUi), [backendExceptions]);

  // purchaseOverviewKPIs dulu diekspor statis dari purchaseData.ts, sekarang
  // dihitung dari data backend (pola sama dengan kpis di Sales/JE Overview).
  const kpis = useMemo(() => ({
    totalPurchases: purchaseTransactions.length,
    totalAmount: purchaseTransactions.reduce((s, p) => s + p.total, 0),
    pendingReview: purchaseTransactions.filter(p => p.status === 'pending_review').length,
    approved: purchaseTransactions.filter(p => p.status === 'approved').length,
    posted: purchaseTransactions.filter(p => p.status === 'posted').length,
    exceptions: purchaseTransactions.filter(p => p.status === 'exception').length,
    totalTax: purchaseTransactions.reduce((s, p) => s + p.taxAmount, 0),
    totalAP: purchaseTransactions.filter(p => p.paymentStatus !== 'paid').reduce((s, p) => s + p.accountsPayable, 0),
    overdueAmount: purchaseTransactions.filter(p => p.paymentStatus === 'overdue').reduce((s, p) => s + p.total, 0),
    unpaidCount: purchaseTransactions.filter(p => p.paymentStatus !== 'paid').length,
    overdueCount: purchaseTransactions.filter(p => p.paymentStatus === 'overdue').length,
    pendingReviewAmount: purchaseTransactions.filter(p => p.status === 'pending_review').reduce((s, p) => s + p.total, 0),
    postedAmount: purchaseTransactions.filter(p => p.status === 'posted').reduce((s, p) => s + p.total, 0),
  }), [purchaseTransactions]);

  const topVendors = useMemo(() => {
    const per = new Map<string, { id: string; name: string; totalSpend: number; txCount: number }>();
    purchaseTransactions.forEach(p => {
      const nama = (p.vendor || '').trim() || '-';
      const cur = per.get(nama) ?? { id: nama, name: nama, totalSpend: 0, txCount: 0 };
      cur.totalSpend += p.total;
      cur.txCount += 1;
      per.set(nama, cur);
    });
    return [...per.values()].filter(v => v.totalSpend > 0).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 6);
  }, [purchaseTransactions]);

  const recentActivity = useMemo(() => [...purchaseTransactions]
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    .slice(0, 6), [purchaseTransactions]);

  // Data tren (contoh, sumber sama seperti sebelumnya) untuk kartu Purchase Volume Trend.
  const trendRecords = useMemo(() => buildDailyPurchaseRecords(new Date()), []);

  // Kartu KPI memakai desain yang sama dengan Purchase Source Data (ProgressKpiTile):
  // angka utama, chip keterangan, bar proporsi + badge persen. Persen dihitung dari data asli.
  const nTx = kpis.totalPurchases;
  const pctOfCount = (n: number) => (nTx > 0 ? Math.round((n / nTx) * 100) : 0);
  const pctOfAmount = (v: number) => (kpis.totalAmount > 0 ? Math.min(100, Math.round((v / kpis.totalAmount) * 100)) : 0);
  const kpiTiles: {
    label: string; value: string | number; detail: string; detailUnit: string;
    pct: number; pctLabel: string; tone: KpiTone; icon: React.ElementType; compact?: boolean; barActive: boolean;
  }[] = [
    { label: 'Total Purchases', value: nTx, detail: 'All', detailUnit: 'transactions', pct: nTx > 0 ? 100 : 0, pctLabel: 'of all transactions', tone: 'slate', icon: ShoppingBag, barActive: nTx > 0 },
    { label: 'Purchase Amount', value: fmt(kpis.totalAmount), detail: `${nTx}`, detailUnit: 'transactions, gross value', pct: nTx > 0 ? 100 : 0, pctLabel: 'of gross purchase value', tone: 'amber', icon: CircleDollarSign, compact: true, barActive: nTx > 0 },
    { label: 'Outstanding AP', value: fmt(kpis.totalAP), detail: `${kpis.unpaidCount}`, detailUnit: 'unpaid invoices', pct: pctOfAmount(kpis.totalAP), pctLabel: 'of purchase amount', tone: 'green', icon: Banknote, compact: true, barActive: kpis.totalAP > 0 },
    { label: 'Pending Review', value: kpis.pendingReview, detail: fmt(kpis.pendingReviewAmount), detailUnit: 'awaiting approval', pct: pctOfCount(kpis.pendingReview), pctLabel: 'of all transactions', tone: 'sky', icon: Clock, barActive: kpis.pendingReview > 0 },
    { label: 'Posted', value: kpis.posted, detail: fmt(kpis.postedAmount), detailUnit: 'finalized to GL', pct: pctOfCount(kpis.posted), pctLabel: 'of all transactions', tone: 'slate', icon: CheckCircle, barActive: kpis.posted > 0 },
    { label: 'Exceptions', value: kpis.exceptions, detail: `${purchaseExceptions.filter(e => e.status === 'Open').length}`, detailUnit: 'open exceptions', pct: pctOfCount(kpis.exceptions), pctLabel: 'of all transactions', tone: 'amber', icon: AlertTriangle, barActive: kpis.exceptions > 0 },
    { label: 'Input Tax (VAT)', value: fmt(kpis.totalTax), detail: 'Recoverable', detailUnit: 'input tax', pct: pctOfAmount(kpis.totalTax), pctLabel: 'of purchase amount', tone: 'green', icon: Receipt, compact: true, barActive: kpis.totalTax > 0 },
    { label: 'Overdue Amount', value: fmt(kpis.overdueAmount), detail: `${kpis.overdueCount}`, detailUnit: 'past due date', pct: pctOfAmount(kpis.overdueAmount), pctLabel: 'of purchase amount', tone: 'sky', icon: CalendarClock, compact: true, barActive: kpis.overdueAmount > 0 },
  ];

  return (
      <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-6 fade-in">
        <PurchaseTabs />

        {/* KPI Grid — desain disamakan dengan kartu KPI Purchase Source Data (ProgressKpiTile). */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpiTiles.map((k) => (
            <ProgressKpiTile
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.detail}
              detailUnit={k.detailUnit}
              pct={k.pct}
              pctLabel={k.pctLabel}
              tone={k.tone}
              icon={k.icon}
              compactValue={k.compact}
              barActive={k.barActive}
            />
          ))}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Purchase Volume Trend & Purchase Status -- desain/fungsi sama dengan Sales Overview */}
          <PurchaseTrendCard records={trendRecords} />
          <PurchaseStatusDonutCard data={statusDist} />
        </div>

        {/* Charts Row 2 -- desain disamakan dengan kartu Overview lain */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PurchaseCategoryCard data={categoryData} />
          <PurchasePaymentStatusCard data={paymentStatusDist} overdueAmount={kpis.overdueAmount} outstandingAP={kpis.totalAP} />
        </div>

        {/* Top Vendors + Recent Activity -- desain disamakan dengan kartu Overview lain */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PurchaseTopVendorsCard vendors={topVendors} />
          <PurchaseRecentActivityCard transactions={recentActivity} />
        </div>

        {/* Exception Summary -- desain disamakan dengan kartu KPI Overview */}
        <PurchaseExceptionSummary exceptions={purchaseExceptions} />
      </div>
  );
}