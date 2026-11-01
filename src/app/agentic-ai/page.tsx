import React from 'react';
import AgenticAIView from './AgenticAIView';

export const metadata = {
  title: 'Agentic AI — zafeb',
  description: 'Kantor 3D tempat agen AI bekerja. Tiga agen AI (Neo, Atlas, Zeno) yang diajak bicara lewat suara.',
};

// Menu "Agentic AI" ada di paling bawah Sidebar.tsx (href: '/agentic-ai').
export default function AgenticAIPage() {
  return <AgenticAIView />;
}
