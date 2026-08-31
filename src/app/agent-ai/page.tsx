import React from 'react';
import AgentAIView from './AgentAIView';

// [MIGRASI] Halaman baru "/agent-ai" -- dibuka lewat menu "Agent AI" di
// Sidebar.tsx (href: '/agent-ai', sudah ada di sana sebelumnya).
// currentPath="/agent-ai" dipakai AppLayout -> Sidebar untuk menandai
// menu ini sebagai aktif (highlight).
export default function AgentAIPage() {
  return (
    <AgentAIView />
  );
}
