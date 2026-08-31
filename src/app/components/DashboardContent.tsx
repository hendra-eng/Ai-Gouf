import React from 'react';
import DashboardHeader from './DashboardHeader';
import KPIBentoGrid from './KPIBentoGrid';
import RevenueExpenseChart from './RevenueExpenseChart';
import AIInsightsPanel from './AllInsightsPanel';
import ARAgingDonut from './ARAgingDonut';
import AnomalyDetection from './AnomalyDetection';
import RecentTransactionsMini from './RecentTransactionsMini';

export default function DashboardContent() {
  return (
    <div className="space-y-6 fade-in">
      <DashboardHeader />
      <KPIBentoGrid />

      {/* Main charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RevenueExpenseChart />
        </div>
        <div>
          <ARAgingDonut />
        </div>
      </div>

      {/* AI + Anomaly + Recent Transactions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <AIInsightsPanel />
        </div>
        <div className="space-y-6">
          <AnomalyDetection />
        </div>
      </div>

      <RecentTransactionsMini />
    </div>
  );
}
