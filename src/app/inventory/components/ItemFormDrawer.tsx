'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { fetchInvCategories, fetchWarehouses, saveItem, useInvData, type InvCategory, type Item, type ItemInput, type Warehouse } from '@/lib/inventoryStore';
import { btnOutline, btnPrimary, Drawer, inputCls } from '@/components/arap/arapUi';
import { FormField } from '@/components/shared/moduleUi';

const SATUAN = ['Pcs', 'Unit', 'Kg', 'Gram', 'Liter', 'Box', 'Pack', 'Carton', 'Sack', 'Ream', 'Roll', 'Meter', 'Set', 'Bottle', 'Can'];

export default function ItemFormDrawer({ clientId, item, onClose, onSetup }: { clientId: string; item: Item | null; onClose: () => void; onSetup: () => void }) {
  const kat = useInvData<InvCategory[]>(`icat:${clientId}`, s => fetchInvCategories(clientId, s), []);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const [f, setF] = useState({
    code: item?.code ?? '', name: item?.name ?? '', barcode: item?.barcode ?? '', category_id: item?.category_id ?? '', unit: item?.unit ?? 'Pcs',
    min_stock: item ? String(item.min_stock || '') : '', reorder_qty: item?.reorder_qty != null ? String(item.reorder_qty) : '',
    default_warehouse_id: item?.default_warehouse_id ?? '', purchase_price: item?.purchase_price != null ? String(item.purchase_price) : '',
    sale_price: item?.sale_price != null ? String(item.sale_price) : '', description: item?.description ?? '', status: item?.status ?? 'active',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const angka = (s: string) => (s.trim() === '' ? null : Number(s));

  const simpan = async () => {
    if (!f.name.trim() || !f.unit.trim()) { toast.error('Item name and unit are required.'); return; }
    setBusy(true);
    try {
      const body: ItemInput = {
        code: f.code.trim() || null, name: f.name.trim(), barcode: f.barcode.trim() || null, category_id: f.category_id || null, unit: f.unit.trim(),
        min_stock: Number(f.min_stock || 0), reorder_qty: angka(f.reorder_qty), default_warehouse_id: f.default_warehouse_id || null,
        purchase_price: angka(f.purchase_price), sale_price: angka(f.sale_price), description: f.description.trim() || null, status: f.status as 'active' | 'inactive',
      };
      toast.success((await saveItem(clientId, body, item?.id)).message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={item ? `Edit ${item.code}` : 'Add Item'} subtitle={item?.name ?? 'Register a new inventory item'}
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save Item</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Item Code" hint="Leave empty to auto-number"><input value={f.code} onChange={e => set('code', e.target.value)} className={inputCls} maxLength={50} placeholder="Auto" /></FormField>
        <FormField label="Status">
          <select value={f.status} onChange={e => set('status', e.target.value as 'active' | 'inactive')} className={inputCls}><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </FormField>
        <FormField label="Item Name" required className="col-span-2"><input value={f.name} onChange={e => set('name', e.target.value)} className={inputCls} maxLength={255} /></FormField>
        <FormField label="Category" hint={<button type="button" onClick={onSetup} className="font-medium text-[#0F7D4E] hover:underline">Manage categories</button>}>
          <select value={f.category_id} onChange={e => set('category_id', e.target.value)} className={inputCls}>
            <option value="">No category</option>{kat.data.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Unit" required>
          <input list="inv-units" value={f.unit} onChange={e => set('unit', e.target.value)} className={inputCls} maxLength={30} />
          <datalist id="inv-units">{SATUAN.map(s => <option key={s} value={s} />)}</datalist>
        </FormField>
        <FormField label="Barcode"><input value={f.barcode} onChange={e => set('barcode', e.target.value)} className={inputCls} maxLength={100} /></FormField>
        <FormField label="Default Warehouse">
          <select value={f.default_warehouse_id} onChange={e => set('default_warehouse_id', e.target.value)} className={inputCls}>
            <option value="">—</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </FormField>
        <FormField label="Minimum Stock" hint="Low-stock alert threshold"><input type="number" min={0} value={f.min_stock} onChange={e => set('min_stock', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Reorder Quantity"><input type="number" min={0} value={f.reorder_qty} onChange={e => set('reorder_qty', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Purchase Price (IDR)"><input type="number" min={0} value={f.purchase_price} onChange={e => set('purchase_price', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Sale Price (IDR)"><input type="number" min={0} value={f.sale_price} onChange={e => set('sale_price', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Description" className="col-span-2"><textarea rows={2} value={f.description} onChange={e => set('description', e.target.value)} className={inputCls} /></FormField>
      </div>
      <p className="text-[11px] text-muted-foreground">Stock quantity and cost come from stock documents (opening balance, receipts, issues, adjustments and transfers) — they cannot be typed here.</p>
    </Drawer>
  );
}
