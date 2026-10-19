'use client';

import React from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import JournalSourceData from '@/app/transactions/journal-entry/components/JournalSourceData';

export default function SourceDataPage() {
  return (
    <div className="space-y-6">
      <JournalEntryTabs activeTab="source" />
      <JournalSourceData />
    </div>
  );
}