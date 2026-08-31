import React from 'react';
import ReportsPageClient from './components/ReportsPageClient';

export const metadata = {
  title: 'Reports — FinovaAI',
  description: 'Financial report studio — create, analyze, export, and manage financial reports.',
};

export default function ReportsPage() {
  return (
    <>
      <ReportsPageClient />
    </>
  );
}