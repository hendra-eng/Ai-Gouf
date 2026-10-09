import React from 'react';
import EquityClient from '../components/fs/EquityClient';

export const metadata = {
  title: 'Statement of Changes in Equity — FinovaAI',
  description: 'Movements of equity components reconciled to the balance sheet.',
};

export default function ChangesInEquityPage() {
  return <EquityClient />;
}
