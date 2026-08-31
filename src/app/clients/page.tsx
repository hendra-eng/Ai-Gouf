import React from 'react';
import ClientsPageClient from './components/ClientsPageClient';

export const metadata = {
  title: 'Clients — FinovaAI',
  description: 'Monitor client financial health, accounting status, and service activity.',
};

export default function ClientsPage() {
  return (
    <>
      <ClientsPageClient />
    </>
  );
}