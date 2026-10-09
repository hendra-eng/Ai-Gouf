import React from 'react';
import NotesClient from '../components/fs/NotesClient';

export const metadata = {
  title: 'Notes to Financial Statements — FinovaAI',
  description: 'CALK framework with GL-linked tables, overrides and audit trail.',
};

export default function NotesPage() {
  return <NotesClient />;
}
