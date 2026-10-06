'use client';

import React from 'react';
import CashBankTabs from '../components/CashBankTabs';
import CashBankJournalPreview from '../components/CashBankJournalPreview';

export default function CashBankJournalPreviewPage() {
  return (
    <div className="p-6">
      <CashBankTabs />
      <CashBankJournalPreview />
    </div>
  );
}