'use client';

import React from 'react';
import JournalEntryTabs from './JournalEntryTabs';
import JournalEntryOverview from './overview/JournalEntryOverview';

export default function JournalEntryPage() {
  return (
    <div className="fade-in">
      <JournalEntryTabs activeTab="overview" />
      <div className="pt-5">
        <JournalEntryOverview />
      </div>
    </div>
  );
}
