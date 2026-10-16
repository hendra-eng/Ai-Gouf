'use client';

// Halaman Inventory (layout dataset/picture/Template UI/Inventory/1-6.jpeg):
// tab Overview, Item List, Stock Movement, Adjustments, Transfer, Reports.
// Backend: modules/assets_and_equity/inventory_v1.py.

import React, { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight, CalendarDays, ChevronDown, FileBarChart, LayoutDashboard, ListChecks, PackagePlus, RefreshCcw, Settings2, SlidersHorizontal,
  TrendingUp, Warehouse as WarehouseIcon,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { fmtDate, todayIso } from '@/lib/receivablesPayablesStore';
import { DOC_TYPE_LABEL, INVENTORY_EVENT, type DocType, type Item, type StockDoc } from '@/lib/inventoryStore';
import { btnOutline, btnPrimary, Menu, MenuItem } from '@/components/arap/arapUi';
import { tabBarCls, tabCls, tabListCls } from '@/components/shared/moduleUi';
import OverviewTab from './OverviewTab';
import ItemListTab from './ItemListTab';
import MovementTab from './MovementTab';
import DocumentsTab from './DocumentsTab';
import ReportsTab from './ReportsTab';
import ItemFormDrawer from './ItemFormDrawer';
import ItemDetailDrawer from './ItemDetailDrawer';
import SetupDrawer from './SetupDrawer';
import DocumentFormDrawer from './DocumentFormDrawer';
import DocumentDrawer from './DocumentDrawer';

export type InvTab = 'overview' | 'items' | 'movement' | 'adjustments' | 'transfer' | 'reports';

export interface InvActions {
  addItem: () => void;
  editItem: (i: Item) => void;
  openItem: (id: string) => void;
  newDocument: (t: DocType, preset?: { itemId?: string }) => void;
  editDocument: (d: StockDoc) => void;
  openDocument: (id: string) => void;
  setup: () => void;
  goTab: (t: InvTab) => void;
}

const TABS: { id: InvTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'items', label: 'Item List', icon: ListChecks },
  { id: 'movement', label: 'Stock Movement', icon: TrendingUp },
  { id: 'adjustments', label: 'Adjustments', icon: SlidersHorizontal },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  { id: 'reports', label: 'Reports', icon: FileBarChart },
];

function InventoryWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as InvTab) || 'overview';
  const [asOf, setAsOf] = useState(params.get('as_of') || todayIso());
  const [itemForm, setItemForm] = useState<{ item: Item | null } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [docForm, setDocForm] = useState<{ type: DocType; doc: StockDoc | null; itemId?: string } | null>(null);
  const [docId, setDocId] = useState<string | null>(null);

  const goTab = useCallback((t: InvTab) => {
    const q = new URLSearchParams();
    if (t !== 'overview') q.set('tab', t);
    if (asOf !== todayIso()) q.set('as_of', asOf);
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [asOf, pathname, router]);

  const actions: InvActions = {
    addItem: () => setItemForm({ item: null }),
    editItem: i => { setItemId(null); setItemForm({ item: i }); },
    openItem: id => setItemId(id),
    newDocument: (t, preset) => { setItemId(null); setDocForm({ type: t, doc: null, itemId: preset?.itemId }); },
    editDocument: d => { setDocId(null); setDocForm({ type: d.doc_type, doc: d }); },
    openDocument: id => setDocId(id),
    setup: () => setSetupOpen(true),
    goTab,
  };
  const label = TABS.find(t => t.id === tab)?.label ?? 'Overview';

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-[#0F7D4E]"><WarehouseIcon size={24} /></span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Inventory</h1>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={actions.setup} disabled={!kid} className={btnOutline}><Settings2 size={15} /> Warehouses &amp; Categories</button>
            <Menu width="w-56" button={open => (
              <button type="button" disabled={!kid} className={btnPrimary}><PackagePlus size={15} /> New Document <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
            )}>
              {close => (Object.keys(DOC_TYPE_LABEL) as DocType[]).map(t => (
                <MenuItem key={t} onClick={() => { close(); actions.newDocument(t); }}>{DOC_TYPE_LABEL[t]}</MenuItem>
              ))}
            </Menu>
          </div>
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
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground" title={`Per ${fmtDate(asOf)}`}>
              <CalendarDays size={14} /> Per
              <input type="date" value={asOf} max="2999-12-31" onChange={e => e.target.value && setAsOf(e.target.value)}
                className="bg-transparent text-xs font-medium text-foreground focus:outline-none" />
            </label>
            <button type="button" onClick={() => window.dispatchEvent(new Event(INVENTORY_EVENT))} title="Refresh" className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 hover:text-foreground">
              <RefreshCcw size={15} />
            </button>
          </div>
        </div>

        {kid && tab === 'overview' && <OverviewTab clientId={kid} asOf={asOf} actions={actions} />}
        {kid && tab === 'items' && <ItemListTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} actions={actions} />}
        {kid && tab === 'movement' && <MovementTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} actions={actions} />}
        {kid && tab === 'adjustments' && <DocumentsTab key="adj" clientId={kid} docType="adjustment" asOf={asOf} actions={actions} />}
        {kid && tab === 'transfer' && <DocumentsTab key="trf" clientId={kid} docType="transfer" asOf={asOf} actions={actions} />}
        {kid && tab === 'reports' && <ReportsTab clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} />}
      </div>

      {kid && itemForm && <ItemFormDrawer clientId={kid} item={itemForm.item} onClose={() => setItemForm(null)} onSetup={actions.setup} />}
      {kid && itemId && <ItemDetailDrawer clientId={kid} itemId={itemId} asOf={asOf} actions={actions} onClose={() => setItemId(null)} />}
      {kid && setupOpen && <SetupDrawer clientId={kid} onClose={() => setSetupOpen(false)} />}
      {kid && docForm && (
        <DocumentFormDrawer clientId={kid} docType={docForm.type} doc={docForm.doc} presetItemId={docForm.itemId} asOf={asOf}
          onClose={() => setDocForm(null)} onSetup={actions.setup} />
      )}
      {kid && docId && <DocumentDrawer clientId={kid} docId={docId} actions={actions} onClose={() => setDocId(null)} />}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <InventoryWorkspace />
    </React.Suspense>
  );
}
