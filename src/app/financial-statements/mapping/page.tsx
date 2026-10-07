import React from 'react';
import MappingClient from '../components/fs/MappingClient';

export const metadata = {
  title: 'Financial Statement Mapping — FinovaAI',
  description: 'Per-client mapping of COA accounts to financial statement lines.',
};

export default function FsMappingPage() {
  return <MappingClient />;
}
