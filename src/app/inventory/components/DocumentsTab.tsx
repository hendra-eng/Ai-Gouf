'use client';

// Tab Adjustments & Transfer (Template UI/Inventory/4-5.jpeg): daftar dokumen
// per baris item dengan filter periode, status, gudang, dan pencarian.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, MoreHorizontal, Pencil } from 'lucide-react';
import { fmtDate } from '@/lib/receivablesPayablesStore';
import {
  deleteDocument, DOC_STATUS_LABEL, DOC_STATUS_STYLE, fetchDocuments, fetchWarehouses, postDocument, qty, REASON_LABEL, useInvData,
  type DocStatus, type StockDoc, type Warehouse,
} from '@/lib/inventoryStore';
import { Menu, MenuItem } from '@/components/arap/arapUi';
import { InvDatePeriod, InvSearch, InvSelect, showingText } from './invUi';
import type { InvActions } from './InventoryWorkspace';
import { faTableCls, faRow, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow, FaPager } from './InvTable';

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
    <FaCard
      title={trf ? 'Stock Transfer List' : 'Stock Adjustment List'}
      subtitle={showingText(page, pageSize, baris.length, docs.data.flatMap(d => d.lines ?? []).length, 'records')}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <InvDatePeriod from={dari} to={sampai} onFrom={v => { setDari(v); setPage(0); }} onTo={v => { setSampai(v); setPage(0); }}
            onClear={() => { setDari(awalBulan(asOf)); setSampai(asOf); setPage(0); }} />
          <InvSelect value={status} onChange={v => { setStatus(v as '' | DocStatus); setPage(0); }} allLabel="All Status"
            options={(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map(s => ({ value: s, label: DOC_STATUS_LABEL[s] }))} />
          <InvSelect value={asal} onChange={v => { setAsal(v); setPage(0); }} allLabel={trf ? 'All From Locations' : 'All Locations'}
            options={gudang.data.map(w => ({ value: w.id, label: w.name }))} />
          {trf && (
            <InvSelect value={tujuan} onChange={v => { setTujuan(v); setPage(0); }} allLabel="All To Locations"
              options={gudang.data.map(w => ({ value: w.id, label: w.name }))} />
          )}
          <InvSearch value={cari} onChange={v => { setCari(v); setPage(0); }} placeholder="Search reference no, item, remark..." className="ml-auto w-full sm:w-[400px]" />
        </div>
      }
    >
      {docs.error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{docs.error}</p>}
      <div className="overflow-x-auto scrollbar-thin">
        <table className={`${faTableCls} min-w-[980px]`}>
          <thead><tr className={tableHeadRow}>
            {['No.', trf ? 'Transfer Date' : 'Adjustment Date', 'Reference No.', 'Item Code', 'Item Name'].map(h => <th key={h} className={thCls}>{h}</th>)}
            <th className={`${thCls} text-right`}>{trf ? 'Qty' : 'Quantity'}</th>
            {(trf ? ['From Location', 'To Location'] : ['Reason']).map(h => <th key={h} className={thCls}>{h}</th>)}
            <th className={thCls}>Status</th><th className={thCls}>Created By</th>
            <th className={`${thCls} text-center`}>Action</th>
          </tr></thead>
          <tbody>
            {(docs.loading && !docs.data.length) || !baris.length ? (
              <FaEmptyRow cols={trf ? 11 : 10} loading={docs.loading && !docs.data.length} text={`No ${trf ? 'transfers' : 'adjustments'} in this period.`} />
            ) : baris.slice(page * pageSize, (page + 1) * pageSize).map(({ d, l }, n) => (
              <tr key={l.id} className={faRow}>
                <td className={tdCls}>{page * pageSize + n + 1}</td>
                <td className={tdCls}>{fmtDate(d.doc_date)}</td>
                <td className={`${tdCls} font-medium text-blue-700`}>{d.doc_no}</td>
                <td className={tdCls}>{l.item_code}</td>
                <td className={tdCls}>{l.item_name}</td>
                <td className={`${tdCls} text-right ${l.quantity < 0 ? 'text-rose-600' : ''}`}>{l.quantity > 0 && !trf ? '+' : ''}{qty(l.quantity)}</td>
                {trf ? <><td className={tdCls}>{d.warehouse}</td><td className={tdCls}>{d.to_warehouse}</td></> : <td className={tdCls}>{d.reason ? REASON_LABEL[d.reason] : '—'}</td>}
                <td className={tdCls}><FaPill label={DOC_STATUS_LABEL[d.status]} style={DOC_STATUS_STYLE[d.status]} /></td>
                <td className={tdCls}>{d.created_by_name ?? '—'}</td>
                <td className={tdCls}>
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => actions.openDocument(d.id)} className="rounded p-1.5 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="View"><Eye size={15} /></button>
                    <button type="button" disabled={d.status !== 'draft'} onClick={() => actions.editDocument(d)} className="rounded p-1.5 text-neutral-600 transition-colors hover:bg-neutral-300 disabled:opacity-30" aria-label="Edit"><Pencil size={15} /></button>
                    <Menu elegant width="w-40" button={() => <button type="button" className="rounded p-1.5 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="More"><MoreHorizontal size={15} /></button>}>
                      {close => <>
                        <MenuItem strong disabled={d.status !== 'draft'} onClick={() => { close(); aksi(() => postDocument(clientId, d.id)); }}>Post</MenuItem>
                        <MenuItem strong disabled={d.status !== 'posted'} onClick={() => { close(); actions.openDocument(d.id); }}>Void...</MenuItem>
                        <MenuItem strong danger disabled={d.status !== 'draft'} onClick={() => { close(); if (window.confirm(`Delete draft ${d.doc_no}?`)) aksi(() => deleteDocument(clientId, d.id)); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FaPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="rows" />
    </FaCard>
  );
}