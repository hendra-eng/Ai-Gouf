'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import FsShell, { LoadingBlock, NoClient } from './FsShell';
import CashFlowView from './cf/CashFlowView';
import type { Method } from './cf/cfData';

// Task Plan 19 -- Cash Flow Statement dari GL + mapping COA, dengan 2
// tampilan (dropdown "View"): metode langsung & tidak langsung. Kategori
// tiap akun neraca (Operating / Non-cash / Investing / Financing / Cash) dari
// mapping per klien. Semua angka dari /cash-flow/series.

const VIEWS: { id: Method; label: string; subtitle: string }[] = [
  { id: 'direct', label: 'Cash Flow Statement (Direct Method)', subtitle: 'Cash receipts and payments for the selected period using the direct method' },
  { id: 'indirect', label: 'Cash Flow Statement (Indirect Method)', subtitle: 'Shows the movement of cash and cash equivalents for the selected period using the indirect method' },
];

const STORAGE_KEY = 'fs.cashFlow.view';

export default function CashFlowClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [view, setView] = useState<Method>('direct');

  // Tampilan terakhir diingat per browser (kenyamanan saja).
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Method | null;
      if (v && VIEWS.some(x => x.id === v)) setView(v);
    } catch { /* storage diblokir */ }
  }, []);
  const choose = (v: Method) => {
    setView(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage diblokir */ }
  };

  const cur = VIEWS.find(v => v.id === view)!;

  return (
    <FsShell
      title="Cash Flow Statement"
      subtitle={<>{cur.subtitle} · built from posted General Ledger and the client COA mapping</>}
      actions={
        <label className="relative inline-flex items-center">
          <LayoutGrid size={16} className="absolute left-3 text-blue-700 pointer-events-none" />
          <select
            value={view}
            onChange={e => choose(e.target.value as Method)}
            aria-label="View"
            className="appearance-none pl-9 pr-9 py-2.5 rounded-lg border border-border bg-white text-sm font-medium text-foreground hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
          >
            {VIEWS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <ChevronDown size={15} className="absolute right-3 text-muted-foreground pointer-events-none" />
        </label>
      }
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <CashFlowView key={activeClientId} clientId={activeClientId} method={view} onMethod={choose} printedBy={user?.nama || user?.username} />
      )}
    </FsShell>
  );
}
