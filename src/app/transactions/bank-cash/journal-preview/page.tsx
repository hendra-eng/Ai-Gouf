'use client';

import React from 'react';
import CashBankJournalPreview from '../components/CashBankJournalPreview';

// Tab bar (CashBankTabs) dirender di dalam CashBankJournalPreview supaya tombol
// Approve All / Post All bisa tampil di baris tab, sama seperti Journal Preview Purchase.
export default function CashBankJournalPreviewPage() {
  return <CashBankJournalPreview />;
}