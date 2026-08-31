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
    <div className="px-4 lg:px-6 xl:px-8 2xl:px-10 py-6 max-w-screen-2xl mx-auto space-y-6 animate-fade-in">
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
  );
}
