'use client';
import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityData } from '../lib/useEquityData';
// [BARU] Transaksi ekuitas (Classification, Transactions, Retained Earnings
// Analysis, AI Insights) sekarang diturunkan dari SATU sumber transaksi
// tunggal (TransactionsContext, yang sudah tersambung ke jurnal_posting
// backend) lewat lib/equityBridge.ts -- pola identik dengan
// liabilitiesBridge.ts di halaman Liabilities.
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import {
  buildEquityAccountMap,
  equityTransactionRows,
  buildEquityClassificationTree,
  retainedEarningsWaterfall,
  generateEquityInsights,
} from '../lib/equityBridge';

const EquityKPIGrid = dynamic(() => import('./EquityKPIGrid'), { ssr: false });
const EquityMovementChart = dynamic(() => import('./EquityMovementChart'), { ssr: false });
const EquityTrendChart = dynamic(() => import('./EquityTrendChart'), { ssr: false });
const EquityClassification = dynamic(() => import('./EquityClassification'), { ssr: false });
const EquityTransactions = dynamic(() => import('./EquityTransactions'), { ssr: false });
const RetainedEarningsAnalysis = dynamic(() => import('./RetainedEarningsAnalysis'), { ssr: false });
const EquityAllInsights = dynamic(() => import('./EquityAllInsights'), { ssr: false });

export default function EquityContent() {
  const { fx } = useCurrency();
  // [BARU] Sambungkan ke client aktif -- lihat lib/useEquityData.ts.
  const equityData = useEquityData();
  const { transactions } = useTransactions();

  const eqMap = useMemo(
    () => buildEquityAccountMap(equityData.equityAccounts),
    [equityData.equityAccounts],
  );

  const txRows = useMemo(
    () => equityTransactionRows(transactions, eqMap),
    [transactions, eqMap],
  );

  const dividendsPaid = useMemo(
    () => txRows.filter((r) => r.type === 'Dividend' && r.debit > 0).reduce((s, r) => s + r.debit, 0),
    [txRows],
  );

  const classificationTree = useMemo(
    () => buildEquityClassificationTree({
      equityAccounts: equityData.equityAccounts,
      lastIdx: equityData.lastIdx,
      netIncomeYtd: equityData.netIncomeYtd,
      totalEquity: equityData.totalEquity,
    }),
    [equityData.equityAccounts, equityData.lastIdx, equityData.netIncomeYtd, equityData.totalEquity],
  );

  const equityGrowthPct = useMemo(() => {
    if (Math.abs(equityData.totalEquityPrev) < 0.01) return 0;
    return Math.round(((equityData.totalEquity - equityData.totalEquityPrev) / Math.abs(equityData.totalEquityPrev)) * 1000) / 10;
  }, [equityData.totalEquity, equityData.totalEquityPrev]);

  const retainedSteps = useMemo(
    () => retainedEarningsWaterfall({
      retainedBeginning: equityData.retainedEarningsPrev + equityData.netIncomeYtdPrev,
      retainedEnding: equityData.retainedEarnings + equityData.netIncomeYtd,
      netIncomeYtd: equityData.netIncomeYtd - equityData.netIncomeYtdPrev,
      dividendsPaid,
      beginLabel: 'Prior period opening balance',
      endLabel: `${equityData.periodLabel || 'Current period'} balance`,
    }),
    [equityData.retainedEarnings, equityData.retainedEarningsPrev, equityData.netIncomeYtd, equityData.netIncomeYtdPrev, equityData.periodLabel, dividendsPaid],
  );

  const rp = (v: number) => fx(formatMoney(v, 'IDR'));

  const insights = useMemo(
    () => generateEquityInsights({
      totalNow: equityData.totalEquity,
      totalPrev: equityData.totalEquityPrev,
      paidInNow: equityData.paidInCapital,
      paidInPrev: equityData.paidInCapitalPrev,
      retainedNow: equityData.retainedEarnings,
      retainedPrev: equityData.retainedEarningsPrev,
      otherNow: equityData.otherEquity,
      otherPrev: equityData.otherEquityPrev,
      netIncomeYtd: equityData.netIncomeYtd,
      dividendsPaid,
      rp,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equityData.totalEquity, equityData.totalEquityPrev, equityData.paidInCapital, equityData.paidInCapitalPrev,
      equityData.retainedEarnings, equityData.retainedEarningsPrev, equityData.otherEquity, equityData.otherEquityPrev,
      equityData.netIncomeYtd, dividendsPaid],
  );

  return (
    <div>
      <PageHeader
        title="Equity"
        subtitle="Monitor shareholder equity, capital structure, and retained earnings movement"
        period={equityData.periodLabel || 'Jan 2026 – Aug 2026'}
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
        ]}
      />

      {equityData.isSampleData && !equityData.loading && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
          <Icon name="ExclamationTriangleIcon" size={16} className="flex-shrink-0" />
          Showing sample data — select a client with posted journals to see real figures.
        </div>
      )}

      <div className="mb-5">
        <BalanceValidationCard
          assets={fx('Rp 6,84M')}
          liabilities={fx('Rp 2,14M')}
          equity={fx(equityData.isSampleData ? 'Rp 4,70M' : formatMoney(equityData.totalEquity, 'IDR'))}
          difference={fx('Rp 0')}
          balanced={true}
        />
      </div>

      <EquityKPIGrid cards={equityData.kpiCards} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <EquityMovementChart steps={equityData.waterfall} periodLabel={equityData.periodLabel} />
        <EquityTrendChart trendData={equityData.trendData} companyName={equityData.companyName} />
      </div>

      <div className="mb-6">
        <EquityClassification
          isSampleData={equityData.isSampleData}
          tree={classificationTree}
          totalEquity={equityData.totalEquity}
          growthPct={equityGrowthPct}
        />
      </div>
      <EquityTransactions isSampleData={equityData.isSampleData} rows={txRows} />
      <div className="mb-6">
        <RetainedEarningsAnalysis
          isSampleData={equityData.isSampleData}
          steps={retainedSteps}
          periodLabel={equityData.periodLabel}
        />
      </div>
      <EquityAllInsights isSampleData={equityData.isSampleData} insights={insights} />
    </div>
  );
}
