'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import FsShell, { LoadingBlock, NoClient } from './FsShell';
import PlDefaultView from './pl/PlDefaultView';
import PlTrendView from './pl/PlTrendView';
import PlComparisonView from './pl/PlComparisonView';
import PlGrossNetView from './pl/PlGrossNetView';
import { SegmentFilter } from './pl/PlUi';
import type { Segment } from './pl/plData';

// Task Plan 17 -- Profit & Loss dari posted GL + mapping COA, dengan 4
// tampilan (dropdown "View"): default bulanan, trend 12 bulan, comparison
// kuartalan, dan gross profit vs net profit. Semua angka dari /profit-loss/series.
// Filter segment berlaku untuk semua tampilan.

type View = 'default' | 'trend' | 'comparison' | 'gross_net';

const VIEWS: { id: View; label: string; title: string; subtitle: string }[] = [
  { id: 'default', label: 'Profit & Loss (Default)', title: 'Profit & Loss', subtitle: 'Monthly result vs last month & same month last year' },
  { id: 'trend', label: 'Profit & Loss Trend', title: 'Profit & Loss Trend', subtitle: 'Monthly performance across the year' },
  { id: 'comparison', label: 'Profit & Loss Comparison', title: 'Profit & Loss Comparison', subtitle: 'Quarterly view per fiscal year' },
  { id: 'gross_net', label: 'Gross Profit vs Net Profit', title: 'Profit & Loss', subtitle: 'Income statement — from revenue to gross profit to net profit' },
];

const STORAGE_KEY = 'fs.profitLoss.view';

export default function ProfitLossClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [view, setView] = useState<View>('default');
  const [segment, setSegment] = useState<Segment | null>(null);

  // Tampilan terakhir diingat per browser (kenyamanan saja).
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as View | null;
      if (v && VIEWS.some(x => x.id === v)) setView(v);
    } catch { /* storage diblokir */ }
  }, []);
  useEffect(() => { setSegment(null); }, [activeClientId]);
  const choose = (v: View) => {
    setView(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage diblokir */ }
  };

  const cur = VIEWS.find(v => v.id === view)!;
  const clientId = activeClientId ?? '';
  const props = {
    clientId,
    segment,
    printedBy: user?.nama || user?.username,
    filters: <SegmentFilter key={clientId} clientId={clientId} value={segment} onChange={setSegment} />,
  };

  return (
    <FsShell
      title={cur.title}
      subtitle={<>{cur.subtitle} · built from posted General Ledger and the client COA mapping</>}
      actions={
        <label className="relative inline-flex items-center">
          <LayoutGrid size={16} className="absolute left-3 text-blue-700 pointer-events-none" />
          <select
            value={view}
            onChange={e => choose(e.target.value as View)}
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
        <>
          {view === 'default' && <PlDefaultView key={activeClientId} {...props} />}
          {view === 'trend' && <PlTrendView key={activeClientId} {...props} />}
          {view === 'comparison' && <PlComparisonView key={activeClientId} {...props} />}
          {view === 'gross_net' && <PlGrossNetView key={activeClientId} {...props} />}
        </>
      )}
    </FsShell>
  );
}
