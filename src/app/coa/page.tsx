import React from 'react';
import CoaPageClient from './components/CoaPageClient';

export const metadata = {
  title: 'Chart of Accounts — FinovaAI',
  description: 'Master chart of accounts per client, mapped to the IFRS-aligned standard account layer.',
};

export default function CoaPage() {
  return <CoaPageClient />;
}
