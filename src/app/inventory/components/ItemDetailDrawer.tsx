'use client';

import React from 'react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import { fetchItem, MOVEMENT_LABEL, MOVEMENT_STYLE, qty, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE, useInvData, type ItemDetail } from '@/lib/inventoryStore';
import { Drawer, Field } from '@/components/arap/arapUi';
import { btnPrimary, btnSmall } from './invUi';
import type { InvActions } from './InventoryWorkspace';
import { faTableCls, faRowClickable, tableHeadRow, thCls, tdCls, FaPill } from './InvTable';

export default function ItemDetailDrawer({ clientId, itemId, asOf, actions, onClose }: {
  clientId: string; itemId: string; asOf: string; actions: InvActions; onClose: () => void;
}) {
  const d = useInvData<ItemDetail | null>(`item:${clientId}:${itemId}:${asOf}`, s => fetchItem(clientId, itemId, asOf, s), null);
  const i = d.data;
  return (
    <Drawer open onClose={onClose} title={i ? `${i.code} · ${i.name}` : 'Loading...'} subtitle={i ? `${i.category ?? 'No category'} · ${i.unit}` : undefined}
      footer={i && <>
        <button type="button" className={btnSmall} onClick={() => actions.newDocument('receipt', { itemId: i.id })}>Goods Receipt</button>
        <button type="button" className={btnSmall} onClick={() => actions.newDocument('issue', { itemId: i.id })}>Goods Issue</button>
        <button type="button" className={btnSmall} onClick={() => actions.newDocument('adjustment', { itemId: i.id })}>Adjust</button>
        <button type="button" className={btnPrimary} onClick={() => actions.editItem(i)}>Edit</button>
      </>}>
      {d.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{d.error}</p>}
      {!i ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <FaPill label={STOCK_STATUS_LABEL[i.stock_status]} style={STOCK_STATUS_STYLE[i.stock_status]} />
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center">
          <div><p className="text-[11px] text-muted-foreground">On Hand</p><p className="text-sm font-bold">{qty(i.qty)} {i.unit}</p></div>
          <div><p className="text-[11px] text-muted-foreground">Average Cost</p><p className="text-sm font-bold">{rupiah(i.avg_cost)}</p></div>
          <div><p className="text-[11px] text-muted-foreground">Stock Value</p><p className="text-sm font-bold text-[#0F7D4E]">{rupiah(i.value)}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Minimum Stock">{qty(i.min_stock)}</Field>
          <Field label="Reorder Quantity">{qty(i.reorder_qty)}</Field>
          <Field label="Purchase / Sale Price">{i.purchase_price != null ? rupiah(i.purchase_price) : '—'} / {i.sale_price != null ? rupiah(i.sale_price) : '—'}</Field>
          <Field label="Barcode">{i.barcode ?? '—'}</Field>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Stock by Warehouse</h4>
          {i.stock_by_warehouse.length === 0 ? <p className="text-xs text-muted-foreground">No stock in any warehouse.</p> : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {i.stock_by_warehouse.map(w => <div key={w.warehouse_id} className="flex justify-between px-3 py-2 text-sm"><span>{w.warehouse}</span><b>{qty(w.qty)} {i.unit}</b></div>)}
            </div>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Recent Movements</h4>
          <div className="overflow-x-auto"><table className={faTableCls}>
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Date</th><th className={thCls}>Reference</th><th className={thCls}>Type</th><th className={`${thCls} text-right`}>In</th><th className={`${thCls} text-right`}>Out</th><th className={thCls}>Warehouse</th>
            </tr></thead>
            <tbody>
              {!i.movements.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-xs text-neutral-500">No movements yet.</td></tr>}
              {i.movements.map(m => (
                <tr key={m.id} className={faRowClickable} onClick={() => actions.openDocument(m.document_id)}>
                  <td className={tdCls}>{fmtDate(m.date)}</td><td className={`${tdCls} font-medium text-blue-700`}>{m.reference_no}</td>
                  <td className={tdCls}><FaPill label={MOVEMENT_LABEL[m.type] + (m.is_reversal ? ' (void)' : '')} style={MOVEMENT_STYLE[m.type]} /></td>
                  <td className={`${tdCls} text-right`}>{m.qty_in ? qty(m.qty_in) : '-'}</td><td className={`${tdCls} text-right`}>{m.qty_out ? qty(m.qty_out) : '-'}</td>
                  <td className={tdCls}>{m.warehouse}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        {i.description && <Field label="Description">{i.description}</Field>}
      </>}
    </Drawer>
  );
}
