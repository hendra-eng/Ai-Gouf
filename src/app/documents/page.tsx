import React from 'react';
import DocumentsPageClient from './components/DocumentsPageClient';

export const metadata = {
  title: 'Documents — zafeb',
  description: 'Financial document workspace — manage, analyze, and link financial documents.',
};

export default function DocumentsPage() {
  return (
    <>
      <DocumentsPageClient />
    </>
  );
}