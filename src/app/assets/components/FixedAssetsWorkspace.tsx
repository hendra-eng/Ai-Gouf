'use client';

// Halaman Fixed Assets (layout dataset/picture/Template UI/Fix Assets/1-6.jpeg):
// judul + tombol aksi per tab, tab Overview, Asset Register, Depreciation,
// Disposal, Reports, Posted. Backend: modules/assets_and_equity/fixed_assets_v1.py.

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight, BookOpen, CalendarDays, ChevronDown, CircleCheck, Clock, FileSpreadsheet, FileText, Layers, LayoutDashboard,
  Play, Plus, RefreshCcw, ScrollText, Download,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { todayIso } from '@/lib/receivablesPayablesStore';
import { FIXED_ASSETS_EVENT, type Disposal, type FixedAsset } from '@/lib/fixedAssetsStore';
import { btnPrimary, Menu, MenuItem } from '@/components/arap/arapUi';
import { tabBarCls, tabCls, tabListCls } from '@/components/shared/moduleUi';
import type { ExportFormat } from '@/lib/tableExport';
import OverviewTab from './OverviewTab';
import RegisterTab from './RegisterTab';
import DepreciationTab from './DepreciationTab';
import DisposalTab from './DisposalTab';
import ReportsTab from './ReportsTab';
import PostedTab from './PostedTab';
import AssetFormDrawer from './AssetFormDrawer';
import CategoriesDrawer from './CategoriesDrawer';
import AssetDetailDrawer from './AssetDetailDrawer';
import RunDepreciationModal from './RunDepreciationModal';
import DisposalFormDrawer from './DisposalFormDrawer';

export type FaTab = 'overview' | 'register' | 'depreciation' | 'disposal' | 'reports' | 'posted';

export interface FaActions {
  addAsset: () => void;
  editAsset: (a: FixedAsset) => void;
  openAsset: (id: string) => void;
  newDisposal: (assetId?: string) => void;
  editDisposal: (d: Disposal) => void;
  runDepreciation: () => void;
  manageCategories: () => void;
  goTab: (t: FaTab) => void;
}

const TABS: { id: FaTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'register', label: 'Asset Register', icon: ScrollText },
  { id: 'depreciation', label: 'Depreciation', icon: Clock },
  { id: 'disposal', label: 'Disposal', icon: ArrowLeftRight },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'posted', label: 'Posted', icon: CircleCheck },
];

function FixedAssetsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as FaTab) || 'overview';
  const [asOf, setAsOf] = useState(params.get('as_of') || todayIso());

  const [assetForm, setAssetForm] = useState<{ asset: FixedAsset | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [disposalForm, setDisposalForm] = useState<{ disposal: Disposal | null; assetId?: string } | null>(null);
  const [reportExport, setReportExport] = useState<{ format: ExportFormat; n: number } | null>(null);

  const goTab = useCallback((t: FaTab) => {
    const q = new URLSearchParams();
    if (t !== 'overview') q.set('tab', t);
    if (asOf !== todayIso()) q.set('as_of', asOf);
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [asOf, pathname, router]);

  const actions: FaActions = {
    addAsset: () => setAssetForm({ asset: null }),
    editAsset: a => { setDetailId(null); setAssetForm({ asset: a }); },
    openAsset: id => setDetailId(id),
    newDisposal: assetId => { setDetailId(null); setDisposalForm({ disposal: null, assetId }); },
    editDisposal: d => setDisposalForm({ disposal: d }),
    runDepreciation: () => setRunOpen(true),
    manageCategories: () => setCategoriesOpen(true),
    goTab,
  };

  const refresh = () => window.dispatchEvent(new Event(FIXED_ASSETS_EVENT));
  const exportReport = (format: ExportFormat) => setReportExport(r => ({ format, n: (r?.n ?? 0) + 1 }));

  const tombol = (() => {
    const panah = (open: boolean) => <ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} />;
    const split = (utama: React.ReactNode, menu: (close: () => void) => React.ReactNode) => (
      <div className="flex items-stretch overflow-hidden rounded-xl shadow-sm">
        {utama}
        <Menu width="w-60" button={open => (
          <button type="button" disabled={!kid} className="flex h-full items-center border-l border-white/25 bg-[#0F7D4E] px-3 text-white hover:bg-[#0c6a42] disabled:opacity-50">{panah(open)}</button>
        )}>{menu}</Menu>
      </div>
    );
    const utamaCls = `${btnPrimary} rounded-none shadow-none`;
    if (tab === 'depreciation') {
      return split(<button type="button" disabled={!kid} onClick={actions.runDepreciation} className={utamaCls}><Play size={15} /> Run Depreciation</button>,
        close => <>
          <MenuItem onClick={() => { close(); actions.manageCategories(); }}><Layers size={14} /> Asset Categories</MenuItem>
          <MenuItem onClick={() => { close(); actions.addAsset(); }}><Plus size={14} /> Add Asset</MenuItem>
        </>);
    }
    if (tab === 'disposal') {
      return split(<button type="button" disabled={!kid} onClick={() => actions.newDisposal()} className={utamaCls}><Plus size={15} /> New Disposal</button>,
        close => <MenuItem onClick={() => { close(); actions.goTab('register'); }}><ScrollText size={14} /> Pick from Asset Register</MenuItem>);
    }
    if (tab === 'reports') {
      return split(<button type="button" disabled={!kid} onClick={() => exportReport('pdf')} className={utamaCls}><FileText size={15} /> Export PDF</button>,
        close => <>
          <MenuItem onClick={() => { close(); exportReport('xlsx'); }}><FileSpreadsheet size={14} /> Export Excel</MenuItem>
          <MenuItem onClick={() => { close(); exportReport('csv'); }}><Download size={14} /> Export CSV</MenuItem>
        </>);
    }
    if (tab === 'posted') {
      return split(<Link href="/reports/general-ledger" className={utamaCls}><BookOpen size={15} /> View Journal</Link>,
        close => <>
          <MenuItem href="/reports/general-ledger" onClick={close}><BookOpen size={14} /> General Ledger</MenuItem>
          <MenuItem onClick={() => { close(); actions.goTab('depreciation'); }}><Clock size={14} /> Depreciation Batches</MenuItem>
        </>);
    }
    return split(<button type="button" disabled={!kid} onClick={actions.addAsset} className={utamaCls}><Plus size={15} /> Add Asset</button>,
      close => <>
        <MenuItem onClick={() => { close(); actions.manageCategories(); }}><Layers size={14} /> Asset Categories</MenuItem>
        <MenuItem onClick={() => { close(); actions.runDepreciation(); }}><Play size={14} /> Run Depreciation</MenuItem>
        <MenuItem onClick={() => { close(); actions.newDisposal(); }}><ArrowLeftRight size={14} /> New Disposal</MenuItem>
      </>);
  })();

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Fixed Assets</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage and monitor your fixed assets, depreciation, and asset lifecycle.</p>
          </div>
          {tombol}
        </div>

        {!kid && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}

        <div className={tabBarCls}>
          <nav className={tabListCls}>
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
          <div className="flex items-center gap-2 pb-2 lg:pb-0">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <CalendarDays size={14} /> As of
              <input type="date" value={asOf} max="2999-12-31" onChange={e => e.target.value && setAsOf(e.target.value)}
                className="bg-transparent text-xs font-medium text-foreground focus:outline-none" />
            </label>
            {asOf !== todayIso() && <button type="button" onClick={() => setAsOf(todayIso())} className="text-xs font-medium text-[#0F7D4E] hover:underline">Today</button>}
            <button type="button" onClick={refresh} title="Refresh" className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 hover:text-foreground">
              <RefreshCcw size={15} />
            </button>
          </div>
        </div>

        {kid && tab === 'overview' && <OverviewTab clientId={kid} asOf={asOf} actions={actions} />}
        {kid && tab === 'register' && <RegisterTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} actions={actions} />}
        {kid && tab === 'depreciation' && <DepreciationTab clientId={kid} asOf={asOf} actions={actions} />}
        {kid && tab === 'disposal' && <DisposalTab clientId={kid} asOf={asOf} actions={actions} />}
        {kid && tab === 'reports' && <ReportsTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} exportSignal={reportExport} />}
        {kid && tab === 'posted' && <PostedTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} actions={actions} />}
      </div>

      {kid && assetForm && <AssetFormDrawer clientId={kid} asset={assetForm.asset} onClose={() => setAssetForm(null)} onManageCategories={() => setCategoriesOpen(true)} />}
      {kid && categoriesOpen && <CategoriesDrawer clientId={kid} onClose={() => setCategoriesOpen(false)} />}
      {kid && detailId && <AssetDetailDrawer clientId={kid} assetId={detailId} asOf={asOf} actions={actions} onClose={() => setDetailId(null)} />}
      {kid && runOpen && <RunDepreciationModal clientId={kid} asOf={asOf} onClose={() => setRunOpen(false)} />}
      {kid && disposalForm && (
        <DisposalFormDrawer clientId={kid} asOf={asOf} disposal={disposalForm.disposal} assetId={disposalForm.assetId} onClose={() => setDisposalForm(null)} />
      )}
    </div>
  );
}

export default function FixedAssetsPage() {
  return (
    <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <FixedAssetsWorkspace />
    </React.Suspense>
  );
}
