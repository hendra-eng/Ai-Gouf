'use client';

// Halaman Inventory (layout dataset/picture/Template UI/Inventory/1-6.jpeg):
// tab Overview, Item List, Stock Movement, Adjustments, Transfer, Reports.
// Backend: modules/assets_and_equity/inventory_v1.py.

import React, { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight, ChevronDown, FileBarChart, LayoutDashboard, ListChecks, PackagePlus, Plus, Settings2, SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { todayIso } from '@/lib/receivablesPayablesStore';
import { DOC_TYPE_LABEL, type DocType, type Item, type StockDoc } from '@/lib/inventoryStore';
import { Menu, MenuItem } from '@/components/arap/arapUi';
import { btnOutline, btnPrimary, InvDatePeriod } from './invUi';
import { elegantTabBarCls, elegantTabCls, elegantTabNavCls } from '@/components/shared/moduleUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import PageHeading from '@/components/shared/PageHeading';
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
  // ?setup=1 (mis. dari dialog setup Opening Balance > Import Opening Stock) -> langsung buka drawer setup.
  const [setupOpen, setSetupOpen] = useState(params.get('setup') === '1');
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

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10">
        <PageHeading
          title="Inventory"
          description="Manage items, warehouses, stock movements, adjustments, transfers, and inventory reports."
          actions={<>
            <InvDatePeriod single label="As of" to={asOf} onTo={v => v && setAsOf(v)} />
            <button type="button" onClick={actions.setup} disabled={!kid} className={btnOutline}><Settings2 size={14} /> Warehouses &amp; Categories</button>
            {tab === 'adjustments' || tab === 'transfer' ? (
              // Tab Adjustments / Transfer: tombol Create menggantikan New Document di posisi yang sama.
              <button type="button" disabled={!kid} onClick={() => actions.newDocument(tab === 'transfer' ? 'transfer' : 'adjustment')} className={btnPrimary}>
                <Plus size={14} /> Create {tab === 'transfer' ? 'Transfer' : 'Adjustment'}
              </button>
            ) : tab === 'movement' ? (
              // Tab Stock Movement: Record Stock menggantikan New Document di posisi yang sama.
              <Menu elegant width="w-56" button={open => (
                <button type="button" disabled={!kid} className={btnPrimary}><Plus size={14} /> Record Stock <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
              )}>
                {close => (['receipt', 'issue', 'opening'] as DocType[]).map(t => (
                  <MenuItem strong key={t} onClick={() => { close(); actions.newDocument(t); }}>{DOC_TYPE_LABEL[t]}</MenuItem>
                ))}
              </Menu>
            ) : (
              <Menu elegant width="w-56" button={open => (
                <button type="button" disabled={!kid} className={btnPrimary}><PackagePlus size={14} /> New Document <ChevronDown size={14} className={open ? 'rotate-180' : ''} /></button>
              )}>
                {close => (Object.keys(DOC_TYPE_LABEL) as DocType[]).map(t => (
                  <MenuItem strong key={t} onClick={() => { close(); actions.newDocument(t); }}>{DOC_TYPE_LABEL[t]}</MenuItem>
                ))}
              </Menu>
            )}
          </>}
        />

        {!kid && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}

        <div className={elegantTabBarCls}>
          <nav className={`${salesFont.className} ${elegantTabNavCls}`}>
            {TABS.map(t => {
              const aktif = tab === t.id;
              const Ikon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => goTab(t.id)}
                  className={elegantTabCls(aktif)}>
                  <Ikon size={16} strokeWidth={aktif ? 2 : 1.5} /> {t.label}
                </button>
              );
            })}
          </nav>
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