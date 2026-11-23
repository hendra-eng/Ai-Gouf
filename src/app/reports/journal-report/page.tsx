import React, { Suspense } from 'react';
import JournalReportClient from './components/JournalReportClient';

export const metadata = {
  title: 'Journal Report — Reports — zafeb',
  description: 'All journal entries in the selected period, with their debit and credit lines.',
};

export default function JournalReportPage() {
  // Suspense wajib karena JournalReportClient membaca useSearchParams (periode dari halaman Reports).
  return (
    <Suspense fallback={null}>
      <JournalReportClient />
    </Suspense>
  );
}
