'use client';

// Halaman Tax Compliance (layout dataset/picture/Template UI/Tax Compliance/1-8.jpeg):
// tab Overview, Tax Ledger, PPh, VAT, Payments, Reconciliation, Exceptions, Reports.
// Saat dibuka (dan lewat tombol Sync) buku pajak disinkronkan dari transaksi
// posted. Backend: modules/planning/tax_compliance_v1.py.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, CalendarDays, FileText, LayoutDashboard, Loader2, Percent, ReceiptText, RefreshCcw, ScrollText, Settings2, Wallet, Repeat,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { todayIso } from '@/lib/receivablesPayablesStore';
import { syncTax, type Range } from '@/lib/taxComplianceStore';
import { btnOutline, btnPrimary } from '@/components/arap/arapUi';
import { tabCls, tabNavCls } from '@/components/shared/moduleUi';
import OverviewTab from './OverviewTab';
import LedgerTab from './LedgerTab';
import PphTab from './PphTab';
import VatTab from './VatTab';
import PaymentsTab from './PaymentsTab';
import ReconciliationTab from './ReconciliationTab';
import ExceptionsTab from './ExceptionsTab';
import ReportsTab from './ReportsTab';
import TaxSettingsDrawer from './TaxSettingsDrawer';

export type TaxTab = 'overview' | 'ledger' | 'pph' | 'vat' | 'payments' | 'reconciliation' | 'exceptions' | 'reports';

const TABS: { id: TaxTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'ledger', label: 'Tax Ledger', icon: ScrollText },
  { id: 'pph', label: 'PPh', icon: ReceiptText },
  { id: 'vat', label: 'VAT', icon: Percent },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'reconciliation', label: 'Reconciliation', icon: Repeat },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'reports', label: 'Reports', icon: FileText },
];

const akhirBulan = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export interface TaxTabProps { clientId: string; clientName: string; range: Range; goTab: (t: TaxTab) => void; openSettings: () => void }

function TaxWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as TaxTab) || 'overview';
  const hari = todayIso();
  const [dari, setDari] = useState(params.get('from') || `${hari.slice(0, 4)}-01`);
  const [sampai, setSampai] = useState(params.get('to') || hari.slice(0, 7));
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState(false);
  const sudahSync = useRef<string | null>(null);
  const range: Range = { date_from: `${dari}-01`, date_to: akhirBulan(sampai) };

  const goTab = useCallback((t: TaxTab) => {
    const q = new URLSearchParams();
    if (t !== 'overview') q.set('tab', t);
    q.set('from', dari);
    q.set('to', sampai);
    router.replace(`${pathname}?${q}`, { scroll: false });
  }, [dari, sampai, pathname, router]);

  const sync = useCallback(async (diam = false) => {
    if (!kid) return;
    setSyncing(true);
    try {
      const r = await syncTax(kid);
      if (!diam) toast.success(`${r.message} ${r.data.created} new, ${r.data.removed} removed; ${r.data.exceptions.new} new exception(s).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [kid]);

  // Sinkron otomatis sekali per klien saat halaman dibuka.
  useEffect(() => {
    if (kid && sudahSync.current !== kid) {
      sudahSync.current = kid;
      sync(true);
    }
  }, [kid, sync]);

  const props: TaxTabProps | null = kid ? { clientId: kid, clientName: activeClientName ?? '', range, goTab, openSettings: () => setSettings(true) } : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Tax Compliance</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === 'reports' ? 'Generate and download tax reports for monitoring, filing, and reconciliation.' : 'Monitor tax base, tax liabilities, payments, filings, and reconciliation from posted transactions.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              <CalendarDays size={14} /> Period
              <input type="month" value={dari} onChange={e => e.target.value && setDari(e.target.value)} className="bg-transparent text-xs font-medium text-foreground focus:outline-none" />
              –
              <input type="month" value={sampai} min={dari} onChange={e => e.target.value && setSampai(e.target.value)} className="bg-transparent text-xs font-medium text-foreground focus:outline-none" />
            </label>
            <button type="button" onClick={() => setSettings(true)} disabled={!kid} className={btnOutline}><Settings2 size={15} /> Tax Accounts</button>
            <button type="button" onClick={() => sync(false)} disabled={!kid || syncing} className={btnPrimary}>
              {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />} Sync Transactions
            </button>
          </div>
        </div>

        {!kid && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}

        <nav className={tabNavCls}>
          {TABS.map(t => {
            const aktif = tab === t.id;
            const Ikon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => goTab(t.id)}
                className={tabCls(aktif)}>
                <Ikon size={16} /> {t.label}
              </button>
            );
          })}
        </nav>

        {props && tab === 'overview' && <OverviewTab {...props} />}
        {props && tab === 'ledger' && <LedgerTab {...props} />}
        {props && tab === 'pph' && <PphTab {...props} />}
        {props && tab === 'vat' && <VatTab {...props} />}
        {props && tab === 'payments' && <PaymentsTab {...props} />}
        {props && tab === 'reconciliation' && <ReconciliationTab {...props} />}
        {props && tab === 'exceptions' && <ExceptionsTab {...props} />}
        {props && tab === 'reports' && <ReportsTab {...props} />}
      </div>
      {kid && settings && <TaxSettingsDrawer clientId={kid} onClose={() => setSettings(false)} />}
    </div>
  );
}

export default function TaxCompliancePage() {
  return (
    <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <TaxWorkspace />
    </React.Suspense>
  );
}
