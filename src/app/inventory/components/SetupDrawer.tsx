'use client';

// Setup Inventory: gudang (lokasi stok) dan kategori item beserta akun COA
// persediaan, HPP, dan selisih penyesuaian.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  deleteInvCategory, deleteWarehouse, fetchInvAccounts, fetchInvCategories, fetchWarehouses, saveInvCategory, saveWarehouse, seedInvCategories, useInvData,
  type CoaAccount, type InvCategory, type Warehouse,
} from '@/lib/inventoryStore';
import { btnOutline, btnPrimary, btnSmall, Drawer, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, isPnlAccount } from '@/components/shared/moduleUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const isInventory = (a: CoaAccount) => a.standard_code === 'std_asset_current_inventory' || /persediaan|inventory/i.test(a.name);

export default function SetupDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const kat = useInvData<InvCategory[]>(`icat:${clientId}`, s => fetchInvCategories(clientId, s), []);
  const akun = useInvData<CoaAccount[]>(`iacc:${clientId}`, s => fetchInvAccounts(clientId, s), []);
  const [tab, setTab] = useState<'wh' | 'cat'>('wh');
  const [wf, setWf] = useState<{ id?: string; code: string; name: string; address: string; is_active: boolean } | null>(null);
  const [cf, setCf] = useState<{ id?: string; name: string; description: string; inventory_coa_id: string | null; cogs_coa_id: string | null; adjustment_coa_id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const jalan = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try { toast.success((await fn()).message); return true; } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  };

  const footer = tab === 'wh'
    ? (wf ? <>
      <button type="button" onClick={() => setWf(null)} className={btnOutline}>Cancel</button>
      <button type="button" disabled={busy || !wf.name.trim()} className={btnPrimary}
        onClick={async () => { if (await jalan(() => saveWarehouse(clientId, { code: wf.code || null, name: wf.name, address: wf.address || null, is_active: wf.is_active }, wf.id))) setWf(null); }}>
        {busy && <Loader2 size={14} className="animate-spin" />} Save Warehouse</button>
    </> : <button type="button" onClick={() => setWf({ code: '', name: '', address: '', is_active: true })} className={btnPrimary}><Plus size={15} /> New Warehouse</button>)
    : (cf ? <>
      <button type="button" onClick={() => setCf(null)} className={btnOutline}>Cancel</button>
      <button type="button" disabled={busy || !cf.name.trim()} className={btnPrimary}
        onClick={async () => { if (await jalan(() => saveInvCategory(clientId, { name: cf.name, description: cf.description || null, inventory_coa_id: cf.inventory_coa_id, cogs_coa_id: cf.cogs_coa_id, adjustment_coa_id: cf.adjustment_coa_id }, cf.id))) setCf(null); }}>
        {busy && <Loader2 size={14} className="animate-spin" />} Save Category</button>
    </> : <>
      <button type="button" onClick={() => jalan(() => seedInvCategories(clientId))} disabled={busy} className={btnOutline}><Wand2 size={15} /> Create from COA</button>
      <button type="button" onClick={() => setCf({ name: '', description: '', inventory_coa_id: null, cogs_coa_id: null, adjustment_coa_id: null })} className={btnPrimary}><Plus size={15} /> New Category</button>
    </>);

  return (
    <Drawer open onClose={onClose} title="Inventory Setup" subtitle="Warehouses and item categories" footer={footer}>
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {([['wh', 'Warehouses'], ['cat', 'Categories']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === k ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
        ))}
      </div>

      {tab === 'wh' && (wf ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Code" hint="Auto if empty"><input value={wf.code} onChange={e => setWf({ ...wf, code: e.target.value })} className={inputCls} maxLength={30} /></FormField>
            <FormField label="Name" required className="col-span-2"><input value={wf.name} onChange={e => setWf({ ...wf, name: e.target.value })} className={inputCls} maxLength={150} placeholder="e.g. Main Warehouse" /></FormField>
          </div>
          <FormField label="Address"><textarea rows={2} value={wf.address} onChange={e => setWf({ ...wf, address: e.target.value })} className={inputCls} /></FormField>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wf.is_active} onChange={e => setWf({ ...wf, is_active: e.target.checked })} /> Active</label>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {!gudang.data.length && <p className="px-4 py-8 text-center text-xs text-muted-foreground">No warehouses yet.</p>}
          {gudang.data.map(w => (
            <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div><p className="font-semibold">{w.code} · {w.name} {!w.is_active && <span className="text-xs font-normal text-rose-600">(inactive)</span>}</p>
                {w.address && <p className="text-xs text-muted-foreground">{w.address}</p>}</div>
              <div className="flex gap-1">
                <button type="button" className={btnSmall} onClick={() => setWf({ id: w.id, code: w.code, name: w.name, address: w.address ?? '', is_active: w.is_active })}><Pencil size={13} /></button>
                <button type="button" className={`${btnSmall} text-rose-600`} disabled={busy} onClick={() => window.confirm(`Delete warehouse ${w.name}?`) && jalan(() => deleteWarehouse(clientId, w.id))}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'cat' && (cf ? (
        <div className="space-y-3">
          <FormField label="Name" required><input value={cf.name} onChange={e => setCf({ ...cf, name: e.target.value })} className={inputCls} maxLength={150} placeholder="e.g. Raw Materials" /></FormField>
          <FormField label="Inventory Account" hint="Debited on receipts, credited on issues">
            <AccountSelect accounts={akun.data} value={cf.inventory_coa_id} onChange={v => setCf({ ...cf, inventory_coa_id: v })} filter={isInventory} />
          </FormField>
          <FormField label="COGS Account" hint="Debited by goods issue journals (cost of goods sold)">
            <AccountSelect accounts={akun.data} value={cf.cogs_coa_id} onChange={v => setCf({ ...cf, cogs_coa_id: v })} filter={isPnlAccount} />
          </FormField>
          <FormField label="Adjustment Account" hint="Gain / loss on stock adjustments">
            <AccountSelect accounts={akun.data} value={cf.adjustment_coa_id} onChange={v => setCf({ ...cf, adjustment_coa_id: v })} filter={isPnlAccount} />
          </FormField>
          <FormField label="Description"><textarea rows={2} value={cf.description} onChange={e => setCf({ ...cf, description: e.target.value })} className={inputCls} /></FormField>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {!kat.data.length && <p className="px-4 py-8 text-center text-xs text-muted-foreground">No categories yet. Create them from the inventory accounts in your chart of accounts, or add one manually.</p>}
          {kat.data.map(c => (
            <div key={c.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{c.name} <span className="text-xs font-normal text-muted-foreground">· {c.item_count} item(s)</span></p>
                <p className="text-[11px] text-muted-foreground">Inventory {(c.inventory_account?.code && kodeAkun(c.inventory_account?.code)) ?? <b className="text-amber-700">missing</b>} · COGS {(c.cogs_account?.code && kodeAkun(c.cogs_account?.code)) ?? '—'} · Adjustment {(c.adjustment_account?.code && kodeAkun(c.adjustment_account?.code)) ?? '—'}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" className={btnSmall} onClick={() => setCf({ id: c.id, name: c.name, description: c.description ?? '', inventory_coa_id: c.inventory_account?.id ?? null, cogs_coa_id: c.cogs_account?.id ?? null, adjustment_coa_id: c.adjustment_account?.id ?? null })}><Pencil size={13} /></button>
                <button type="button" className={`${btnSmall} text-rose-600`} disabled={busy || c.item_count > 0} onClick={() => window.confirm(`Delete category ${c.name}?`) && jalan(() => deleteInvCategory(clientId, c.id))}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </Drawer>
  );
}
