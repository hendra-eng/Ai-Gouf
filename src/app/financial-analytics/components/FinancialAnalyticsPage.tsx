import React from 'react';
import AnalyticsHeader from './AnalyticsHeader';
import FinancialHealthHero from './FinancialHealthHero';
import AnalyticsKPICards from './AnalyticsKPICards';
import ProfitabilityAnalytics from './ProfitabilityAnalytics';
import LiquidityAnalytics from './LiquidityAnalytics';
import SolvencyEfficiencyAnalytics from './SolvencyEfficiencyAnalytics';
import GrowthAnalytics from './GrowthAnalytics';
import RevenueDrivers from './RevenueDrivers';
import ExpenseDrivers from './ExpenseDrivers';
import CustomerAnalytics from './CustomerAnalytics';
import PerformanceMatrix from './PerformanceMatrix';
import TrendExplorer from './TrendExplorer';
import AnomalyDetection from './AnomalyDetection';
import FinancialAIInsights from './FinancialAIInsights';

export default function FinancialAnalyticsPage() {
  return (
    <div className="px-4 lg:px-6 xl:px-8 2xl:px-10 py-6 max-w-screen-2xl mx-auto space-y-6 animate-fade-in">
      <AnalyticsHeader />
      <FinancialHealthHero />
      <AnalyticsKPICards />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ProfitabilityAnalytics />
        <LiquidityAnalytics />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SolvencyEfficiencyAnalytics />
        <GrowthAnalytics />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RevenueDrivers />
        <ExpenseDrivers />
      </div>
      <CustomerAnalytics />
      <PerformanceMatrix />
      <TrendExplorer />
      <AnomalyDetection />
      <FinancialAIInsights />
    </div>
  );
}
