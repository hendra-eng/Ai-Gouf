import React from 'react';
import KantorAIView from './KantorAIView';

export const metadata = {
  title: 'Kantor AI — zafeb',
  description: 'Kantor 3D tempat agen AI bekerja. Saat ini mode desain dengan satu agen: Neo.',
};

// Menu "Kantor AI" ada di paling bawah Sidebar.tsx (href: '/kantor-ai').
export default function KantorAIPage() {
  return <KantorAIView />;
}
