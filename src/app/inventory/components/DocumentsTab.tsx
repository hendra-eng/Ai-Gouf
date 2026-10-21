'use client';

// Tab Adjustments & Transfer (Template UI/Inventory/4-5.jpeg): daftar dokumen
// per baris item dengan filter periode, status, gudang, dan pencarian.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react';
import { fmtDate } from '@/lib/receivablesPayablesStore';
import {
  deleteDocument, DOC_STATUS_LABEL, DOC_STATUS_STYLE, fetchDocuments, fetchWarehouses, postDocument, qty, REASON_LABEL, useInvData,
  type DocStatus, type StockDoc, type Warehouse,
} from '@/lib/inventoryStore';
import { btnPrimary, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Pill, tdCls } from '@/components/shared/moduleUi';
import type { InvActions } from './InventoryWorkspace';

export const awalBulan = (iso: string) => `${iso.slice(0, 7)}-01`;

export default function DocumentsTab({ clientId, docType, asOf, actions }: { clientId: string; docType: 'adjustment' | 'transfer'; asOf: string; actions: InvActions }) {
  const [dari, setDari] = useState(awalBulan(asOf));
  const [sampai, setSampai] = useState(asOf);
  const [status, setStatus] = useState<'' | DocStatus>('');
  const [asal, setAsal] = useState('');
  const [tujuan, setTujuan] = useState('');
  const [cari, setCari] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const docs = useInvData<StockDoc[]>(`docs:${clientId}:${docType}:${dari}:${sampai}:${status}`,
    s => fetchDocuments(clientId, { doc_type: docType, date_from: dari, date_to: sampai, status: status || undefined }, s), []);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const trf = docType === 'transfer';

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return docs.data.flatMap(d => (d.lines ?? []).map(l => ({ d, l })))
      .filter(({ d, l }) => (!asal || d.warehouse_id === asal) && (!tujuan || d.to_warehouse_id === tujuan)
        && (!q || [d.doc_no, l.item_code, l.item_name, d.notes, d.source_ref].some(x => (x || '').toLowerCase().includes(q))));
  }, [docs.data, asal, tujuan, cari]);

  const aksi = async (fn: () => Promise<{ message: string }>) => {
    try { toast.success((await fn()).message); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-12 lg:items-end">
        <label className="lg:col-span-3"><span className="mb-1 block text-xs font-medium">Period</span>
          <div className="flex items-center gap-1">
            <input type="date" value={dari} onChange={e => { setDari(e.target.value); setPage(0); }} className={inputCls} />
            <span className="text-muted-foreground">–</span>
            <input type="date" value={sampai} onChange={e => { setSampai(e.target.value); setPage(0); }} className={inputCls} />
          </div></label>
        <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value as DocStatus | ''); setPage(0); }} className={inputCls}>
            <option value="">All</option>{(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map(s => <option key={s} value={s}>{DOC_STATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">{trf ? 'From Location' : 'Location'}</span>
          <select value={asal} onChange={e => { setAsal(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        {trf && (
          <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">To Location</span>
            <select value={tujuan} onChange={e => { setTujuan(e.target.value); setPage(0); }} className={inputCls}>
              <option value="">All</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
        )}
        <div className={`relative ${trf ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search reference no, item, remark..." className={`${inputCls} pl-9`} />
        </div>
        <div className={`flex justify-end ${trf ? 'lg:col-span-1' : 'lg:col-span-2'}`}>
          <button type="button" onClick={() => actions.newDocument(docType)} className={btnPrimary}><Plus size={15} /> Create {trf ? 'Transfer' : 'Adjustment'}</button>
        </div>
      </div>
      {docs.error && <p className="mx-4 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{docs.error}</p>}
      <div className="overflow-x-auto px-2">
        <table className="w-full min-w-[980px] text-sm">
          <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
            {['No.', trf ? 'Transfer Date' : 'Adjustment Date', 'Reference No.', 'Item Code', 'Item Name'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
            <th className="px-3 py-2.5 text-right font-medium">{trf ? 'Qty' : 'Quantity'}</th>
            {(trf ? ['From Location', 'To Location'] : ['Reason']).map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
            <th className="px-3 py-2.5 text-left font-medium">Status</th><th className="px-3 py-2.5 text-left font-medium">Created By</th>
            <th className="px-3 py-2.5 text-center font-medium">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {(docs.loading && !docs.data.length) || !baris.length ? (
              <EmptyRow cols={trf ? 11 : 10} loading={docs.loading && !docs.data.length} text={`No ${trf ? 'transfers' : 'adjustments'} in this period.`} />
            ) : baris.slice(page * pageSize, (page + 1) * pageSize).map(({ d, l }, n) => (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <td className={tdCls}>{page * pageSize + n + 1}</td>
                <td className={tdCls}>{fmtDate(d.doc_date)}</td>
                <td className={`${tdCls} font-medium`}>{d.doc_no}</td>
                <td className={tdCls}>{l.item_code}</td>
                <td className={tdCls}>{l.item_name}</td>
                <td className={`${tdCls} text-right ${l.quantity < 0 ? 'text-rose-600' : ''}`}>{l.quantity > 0 && !trf ? '+' : ''}{qty(l.quantity)}</td>
                {trf ? <><td className={tdCls}>{d.warehouse}</td><td className={tdCls}>{d.to_warehouse}</td></> : <td className={tdCls}>{d.reason ? REASON_LABEL[d.reason] : '—'}</td>}
                <td className={tdCls}><Pill label={DOC_STATUS_LABEL[d.status]} style={DOC_STATUS_STYLE[d.status]} /></td>
                <td className={tdCls}>{d.created_by_name ?? '—'}</td>
                <td className={tdCls}>
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => actions.openDocument(d.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="View"><Eye size={15} /></button>
                    <button type="button" disabled={d.status !== 'draft'} onClick={() => actions.editDocument(d)} className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100 disabled:opacity-30" aria-label="Edit"><Pencil size={15} /></button>
                    <Menu width="w-40" button={() => <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="More"><MoreHorizontal size={15} /></button>}>
                      {close => <>
                        <MenuItem disabled={d.status !== 'draft'} onClick={() => { close(); aksi(() => postDocument(clientId, d.id)); }}>Post</MenuItem>
                        <MenuItem disabled={d.status !== 'posted'} onClick={() => { close(); actions.openDocument(d.id); }}>Void...</MenuItem>
                        <MenuItem danger disabled={d.status !== 'draft'} onClick={() => { close(); if (window.confirm(`Delete draft ${d.doc_no}?`)) aksi(() => deleteDocument(clientId, d.id)); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NumberPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="rows" />
    </section>
  );
}
