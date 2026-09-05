import React from 'react';
import EquityHeader from './components/EquityHeader';
import EquitySummaryCards from './components/EquitySummaryCards';
import EquityBridgeChart from './components/EquityBridgeChart';
import EquityMainTable from './components/EquityMainTable';
import RetainedEarningsReconciliation from './components/RetainedEarningsReconciliation';
import EquityMovementInsights from './components/EquityMovementsInsights';
import EquityAccountBreakdown from './components/EquityAccountBreakdown';
import EquityReconciliationFooter from './components/EquityReconciliationFooter';

export default function StatementOfChangesInEquityPage() {
  return (
    <div className="space-y-5 fade-in">
      <EquityHeader />
      <EquitySummaryCards />
      <EquityBridgeChart />
      <EquityMainTable />
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-3">
          <RetainedEarningsReconciliation />
        </div>
        <div className="xl:col-span-2">
          <EquityMovementInsights />
        </div>
      </div>
      <EquityAccountBreakdown />
      <EquityReconciliationFooter />
    </div>
  );
}
