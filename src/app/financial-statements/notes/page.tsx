import React from 'react';
import NotesHeader from './components/NotesHeader';
import NotesOverviewGrid from './components/NotesOverviewGrid';
import NotesMainContent from './components/NotesMainContent';

export default function NotesToFinancialStatementsPage() {
  return (
    <div className="space-y-5 fade-in">
      <NotesHeader />
      <NotesOverviewGrid />
      <NotesMainContent />
    </div>
  );
}
