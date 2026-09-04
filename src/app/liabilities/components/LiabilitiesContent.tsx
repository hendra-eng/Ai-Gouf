'use client';
import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLiabilitiesData } from '../lib/useLiabilitiesData';
// [BARU] Transaksi liabilitas (Debt Analysis, Due Schedule, Transactions,
// AI Insights) sekarang diturunkan dari SATU sumber transaksi tunggal
// (TransactionsContext, yang sudah tersambung ke jurnal_posting backend)
// lewat lib/liabilitiesBridge.ts -- pola identik dengan apBridge.ts di
// halaman Account Payable.
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import {
  buildLiabilityAccountMap,
  liabilityTransactionRows,
  liabilityObligations,
  obligationMaturityBuckets,
  computeDebtMetrics,
  interestExpenseFromTransactions,
  generateLiabilityInsights,
} from '../lib/liabilitiesBridge';

const LiabilitiesKPIGrid = dynamic(() => import('./LiabilitiesKPIGrid'), { ssr: false });
const LiabilitiesChartsSection = dynamic(() => import('./LiabilitiesChartsSection'), { ssr: false });
const DebtAnalysisSection = dynamic(() => import('./DebtAnalysisSection'), { ssr: false });
const LiabilityDueSchedule = dynamic(() => import('./LiabilityDueSchedule'), { ssr: false });
const LiabilityTransactions = dynamic(() => import('./LiabilityTransactions'), { ssr: false });
const LiabilitiesAllInsights = dynamic(() => import('./LiabilitiesAllInsights'), { ssr: false });

export default function LiabilitiesContent() {
  const { fx } = useCurrency();
  // [BARU] Sambungkan ke client aktif -- lihat lib/useLiabilitiesData.ts.
  const liabData = useLiabilitiesData();
  const { transactions } = useTransactions();

  const liabMap = useMemo(
    () => buildLiabilityAccountMap(liabData.liabilityAccounts),
    [liabData.liabilityAccounts],
  );

  const obligations = useMemo(
    () => liabilityObligations(transactions, liabMap),
    [transactions, liabMap],
  );

  const txRows = useMemo(
    () => liabilityTransactionRows(transactions, liabMap),
    [transactions, liabMap],
  );

  const maturityBuckets = useMemo(
    () => obligationMaturityBuckets(obligations),
    [obligations],
  );

  const interestExpenseYtd = useMemo(
    () => interestExpenseFromTransactions(transactions, liabData.tahun),
    [transactions, liabData.tahun],
  );

  const debtMetrics = useMemo(
    () => computeDebtMetrics({
      shortTermDebt: liabData.shortTermDebt,
      longTermDebt: liabData.longTermDebt,
      totalEquity: liabData.totalEquity,
      netIncomeYtd: liabData.netIncomeYtd,
      interestExpenseYtd,
    }),
    [liabData.shortTermDebt, liabData.longTermDebt, liabData.totalEquity, liabData.netIncomeYtd, interestExpenseYtd],
  );

  const rp = (v: number) => fx(formatMoney(v, 'IDR'));

  const insights = useMemo(
    () => generateLiabilityInsights({
      obligations,
      metrics: debtMetrics,
      totalNow: liabData.totalLiabilities,
      totalPrev: liabData.totalLiabilitiesPrev,
      taxPayable: liabData.taxPayable,
      rp,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obligations, debtMetrics, liabData.totalLiabilities, liabData.totalLiabilitiesPrev, liabData.taxPayable],
  );

  return (
    <div>
      <PageHeader
        title="Liabilities"
        subtitle="Monitor company obligations, debt, payables, and upcoming financial commitments"
        period={liabData.periodLabel || 'Jan 2026 – Aug 2026'}
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
          { key: 'type', label: 'Liability Type', options: ['All Types','Current Liabilities','Non-Current Liabilities','Debt','Trade Payables','Tax Obligations'] },
          { key: 'status', label: 'Status', options: ['All Status','Scheduled','Due Soon','Overdue','Paid'] },
          { key: 'due', label: 'Due Date', options: ['All Dates','Due within 30 days','Due 31–90 days','Due 3–6 months','Due 6–12 months'] },
        ]}
      />

      {liabData.isSampleData && !liabData.loading && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
          <Icon name="ExclamationTriangleIcon" size={16} className="flex-shrink-0" />
          Showing sample data — select a client with posted journals to see real figures.
        </div>
      )}

      <div className="mb-5">
        <BalanceValidationCard
          assets={fx('Rp 6,84M')}
          liabilities={fx(liabData.isSampleData ? 'Rp 2,14M' : formatMoney(liabData.totalLiabilities, 'IDR'))}
          equity={fx('Rp 4,70M')}
          difference={fx('Rp 0')}
          balanced={true}
        />
      </div>

      <LiabilitiesKPIGrid cards={liabData.kpiCards} />
      <LiabilitiesChartsSection
        trendData={liabData.trendData}
        compositionData={liabData.compositionData}
        companyName={liabData.companyName}
        periodLabel={liabData.periodLabel}
      />
      <DebtAnalysisSection
        isSampleData={liabData.isSampleData}
        companyName={liabData.companyName}
        metrics={debtMetrics}
        maturityBuckets={maturityBuckets}
        nearestObligation={obligations.find((o) => o.status !== 'scheduled') || obligations[0] || null}
      />
      <LiabilityDueSchedule isSampleData={liabData.isSampleData} obligations={obligations} />
      <LiabilityTransactions isSampleData={liabData.isSampleData} rows={txRows} />
      <LiabilitiesAllInsights isSampleData={liabData.isSampleData} insights={insights} />
    </div>
  );
}
