'use client';

import React, { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import FsShell, { LoadingBlock, NoClient } from './FsShell';
import BsDefaultView from './bs/BsDefaultView';
import BsTrendView from './bs/BsTrendView';
import BsComparisonView from './bs/BsComparisonView';
import BsAssetsLiabView from './bs/BsAssetsLiabView';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { BsDropdown } from './bs/BsMono';

// Statement of Financial Position dari GL + mapping COA, dengan 4 tampilan
// (dropdown "View"): default, trend bulanan, comparison kuartalan, dan
// assets vs liabilities. Semua angka dari /balance-sheet/series.

type View = 'default' | 'trend' | 'comparison' | 'assets_liabilities';

const VIEWS: { id: View; label: string; title: string; subtitle: string }[] = [
  { id: 'default', label: 'Balance Sheet (Default)', title: 'Balance Sheet', subtitle: 'Position vs last month & last year' },
  { id: 'trend', label: 'Balance Sheet Trend', title: 'Balance Sheet Trend', subtitle: 'Monthly position across the year' },
  { id: 'comparison', label: 'Balance Sheet Comparison', title: 'Balance Sheet Comparison', subtitle: 'Quarterly view per fiscal year' },
  { id: 'assets_liabilities', label: 'Assets vs Liabilities', title: 'Balance Sheet', subtitle: 'Statement of financial position — assets vs liabilities & equity' },
];

const STORAGE_KEY = 'fs.balanceSheet.view';

export default function BalanceSheetClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [view, setView] = useState<View>('default');

  // Tampilan terakhir diingat per browser (kenyamanan saja).
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as View | null;
      if (v && VIEWS.some(x => x.id === v)) setView(v);
    } catch { /* storage diblokir */ }
  }, []);
  const choose = (v: View) => {
    setView(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage diblokir */ }
  };

  const cur = VIEWS.find(v => v.id === view)!;
  const props = { clientId: activeClientId ?? '', printedBy: user?.nama || user?.username };

  return (
    <FsShell
      title={cur.title}
      subtitle={<>{cur.subtitle} · built from posted General Ledger and the client COA mapping</>}
      actions={
        <BsDropdown icon={LayoutGrid} align="right" value={view} onChange={v => choose(v as View)} options={VIEWS.map(v => ({ value: v.id, label: v.label }))} />
      }
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <div className={salesFont.className}>
          {view === 'default' && <BsDefaultView key={activeClientId} {...props} />}
          {view === 'trend' && <BsTrendView key={activeClientId} {...props} />}
          {view === 'comparison' && <BsComparisonView key={activeClientId} {...props} />}
          {view === 'assets_liabilities' && <BsAssetsLiabView key={activeClientId} {...props} />}
        </div>
      )}
    </FsShell>
  );
}
