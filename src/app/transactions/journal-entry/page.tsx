'use client';

import React from 'react';
import JournalEntryTabs from './JournalEntryTabs';
import OverviewKPIGrid from './OverviewKPIGrid';
import OverviewCharts from './OverviewCharts';
import OverviewActivityFeed from './OverviewActivityFeed';
import OverviewSourceTable from './OverviewSourceTable';

export default function JournalEntryPage() {
  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="overview" />
        <OverviewKPIGrid />
        <OverviewCharts />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <OverviewActivityFeed />
          <OverviewSourceTable />
        </div>
      </div>
  );
}