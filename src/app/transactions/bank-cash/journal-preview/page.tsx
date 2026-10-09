'use client';

import React from 'react';
import CashBankTabs from '../components/CashBankTabs';
import CashBankJournalPreview from '../components/CashBankJournalPreview';

export default function CashBankJournalPreviewPage() {
  return (
    <div className="space-y-5">
      <CashBankTabs />
      <CashBankJournalPreview />
    </div>
  );
}