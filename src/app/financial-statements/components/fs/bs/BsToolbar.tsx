'use client';

import React from 'react';
import { Loader2, Printer } from 'lucide-react';
import DownloadMenu from '../DownloadMenu';
import type { PrintReport } from '@/lib/printExport';
import { useActiveClient } from '@/lib/activeClient';
import { clientLetterhead } from '../statementTemplate';

// Baris filter + Export/Print bersama 4 tampilan Balance Sheet.

export interface ViewProps {
  clientId: string;
  companyName?: string;
  printedBy?: string;
}

export function BsToolbar({ filters, loading, exportReady, buildExport }: {
  filters: React.ReactNode;
  loading?: boolean;
  exportReady: boolean;
  buildExport: () => PrintReport;
}) {
  const { clients, activeClientId } = useActiveClient();
  // Laporan format 'statement' (BS / P&L) memakai kop logo + alamat klien aktif.
  const build = () => {
    const r = buildExport();
    if (r.template !== 'statement' || r.letterhead) return r;
    return { ...r, letterhead: clientLetterhead(clients.find(c => c.id === activeClientId), r.companyName ?? '') };
  };
  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-3">{filters}</div>
      {loading && <Loader2 size={16} className="animate-spin text-blue-600" />}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-white text-sm font-medium text-foreground hover:bg-slate-50">
          <Printer size={16} /> Print
        </button>
        <DownloadMenu disabled={!exportReady} build={build} />
      </div>
    </div>
  );
}
