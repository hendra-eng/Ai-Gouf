import React from 'react';
import TaxHeader from './TaxHeader';
import ComplianceStatusHero from './ComplianceStatusHero';
import TaxKPICards from './TaxKPICards';
import TaxDeadlineTimeline from './TaxDeadlineTimeline';
import TaxCalendar from './TaxCalendar';
import TaxObligationTable from './TaxObligationTable';
import PPNAnalysis from './PPNAnalysis';
import PPHAnalysis from './PPHAnalysis';
import TaxReconciliation from './TaxReconciliation';
import TaxExposure from './TaxExposure';
import ComplianceTasks from './ComplianceTasks';
import TaxAIInsights from './TaxAIInsights';
import ComplianceHealthScore from './ComplianceHealthScore';

export default function TaxCompliancePage() {
  return (
    <div className="px-4 lg:px-6 xl:px-8 2xl:px-10 py-6 max-w-screen-2xl mx-auto space-y-6 animate-fade-in">
      <TaxHeader />
      <ComplianceStatusHero />
      <TaxKPICards />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <TaxDeadlineTimeline />
        </div>
        <div className="xl:col-span-1">
          <ComplianceHealthScore />
        </div>
      </div>
      <TaxCalendar />
      <TaxObligationTable />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <PPNAnalysis />
        <PPHAnalysis />
      </div>
      <TaxReconciliation />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <TaxExposure />
        <ComplianceTasks />
      </div>
      <TaxAIInsights />
    </div>
  );
}
