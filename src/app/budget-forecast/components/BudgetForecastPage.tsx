import React from 'react';
import BudgetHeader from './BudgetHeader';
import PlanningStatusHero from './PlanningStatusHero';
import BudgetKPICards from './BudgetKPICards';
import BudgetVsActualChart from './BudgetVsActualChart';
import MonthlyBudgetTable from './MonthlyBudgetTable';
import VarianceAnalysis from './VarianceAnalysis';
import VarianceWaterfall from './VarianceWaterfall';
import ScenarioPlanning from './ScenarioPlanning';
import ForecastAssumptions from './ForecastAssumptions';
import BudgetAllocation from './BudgetAllocation';
import ForecastRisks from './ForecastRisks';
import BudgetAllInsights from './BudgetAllInsights';

export default function BudgetForecastPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10 animate-fade-in">
      <BudgetHeader />
      <PlanningStatusHero />
      <BudgetKPICards />
      <BudgetVsActualChart />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <VarianceAnalysis />
        <VarianceWaterfall />
      </div>
      <MonthlyBudgetTable />
      <ScenarioPlanning />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ForecastAssumptions />
        <BudgetAllocation />
      </div>
      <ForecastRisks />
      <BudgetAllInsights />
      </div>
    </div>
  );
}
