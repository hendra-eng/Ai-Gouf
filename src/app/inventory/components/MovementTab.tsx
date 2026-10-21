'use client';

// Tab Stock Movement (Template UI/Inventory/3.jpeg): kartu stok semua item
// (filter periode, item, tipe, lokasi) + daftar dokumen Opening / Receipt / Issue.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Download, Eye, Plus } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  DOC_STATUS_LABEL, DOC_STATUS_STYLE, DOC_TYPE_LABEL, fetchDocuments, fetchItems, fetchMovements, fetchWarehouses, MOVEMENT_LABEL, MOVEMENT_STYLE, qty,
  useInvData, type DocType, type Movement, type MovementType, type StockDoc, type Warehouse,
} from '@/lib/inventoryStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Pill, tdCls } from '@/components/shared/moduleUi';
import { awalBulan } from './DocumentsTab';
import type { InvActions } from './InventoryWorkspace';

export default function MovementTab({ clientId, clientName, asOf, actions }: { clientId: string; clientName: string; asOf: string; actions: InvActions }) {
  const [view, setView] = useState<'movements' | 'documents'>('movements');
  const [dari, setDari] = useState(awalBulan(asOf));
  const [sampai, setSampai] = useState(asOf);
  const [item, setItem] = useState('');
  const [tipe, setTipe] = useState<'' | MovementType>('');
  const [lokasi, setLokasi] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const items = useInvData(`items:${clientId}:${asOf}`, s => fetchItems(clientId, asOf, s), null as Awaited<ReturnType<typeof fetchItems>> | null);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const mv = useInvData(view === 'movements' ? `mv:${clientId}:${dari}:${sampai}:${item}:${tipe}:${lokasi}` : null,
    s => fetchMovements(clientId, { date_from: dari, date_to: sampai, item_id: item || undefined, type: tipe || undefined, warehouse_id: lokasi || undefined }, s),
    null as Awaited<ReturnType<typeof fetchMovements>> | null);
  const docs = useInvData<StockDoc[]>(view === 'documents' ? `mdocs:${clientId}:${dari}:${sampai}` : null,
    s => fetchDocuments(clientId, { date_from: dari, date_to: sampai }, s), []);
  const rows = mv.data?.movements ?? [];
  const dokumen = useMemo(() => docs.data.filter(d => ['opening', 'receipt', 'issue'].includes(d.doc_type) && (!lokasi || d.warehouse_id === lokasi)), [docs.data, lokasi]);

  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable<Movement>(f, {
        title: 'Stock Movement', clientName, subtitle: `${fmtDate(dari)} – ${fmtDate(sampai)}`, rows, fileName: `Stock-Movement-${dari}-${sampai}`, orientation: 'landscape',
        columns: [
          { header: 'Date', value: m => m.date }, { header: 'Reference No.', value: m => m.reference_no }, { header: 'Item Code', value: m => m.item_code },
          { header: 'Item Name', value: m => m.item_name }, { header: 'Type', value: m => MOVEMENT_LABEL[m.type] + (m.is_reversal ? ' (void)' : '') },
          { header: 'In', value: m => m.qty_in || null, type: 'number' }, { header: 'Out', value: m => m.qty_out || null, type: 'number' },
          { header: 'Balance', value: m => m.balance, type: 'number' }, { header: 'Unit Cost', value: m => m.unit_cost, type: 'money' },
          { header: 'Value', value: m => m.value_in - m.value_out, type: 'money' }, { header: 'Location', value: m => m.warehouse }, { header: 'Source', value: m => m.source },
        ],
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          {([['movements', 'Movements'], ['documents', 'Receipts, Issues & Opening']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setView(k); setPage(0); }} className={`rounded-lg px-3 py-1.5 ${view === k ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <Menu width="w-52" button={open => <button type="button" className={btnPrimary}><Plus size={15} /> Record Stock <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => (['receipt', 'issue', 'opening'] as DocType[]).map(t => <MenuItem key={t} onClick={() => { close(); actions.newDocument(t); }}>{DOC_TYPE_LABEL[t]}</MenuItem>)}
          </Menu>
          {view === 'movements' && (
            <Menu width="w-40" button={open => <button type="button" className={btnOutline}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
              {close => <>
                <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
                <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
              </>}
            </Menu>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-12 lg:items-end">
        <label className="lg:col-span-4"><span className="mb-1 block text-xs font-medium">Period</span>
          <div className="flex items-center gap-1">
            <input type="date" value={dari} onChange={e => { setDari(e.target.value); setPage(0); }} className={inputCls} />
            <span className="text-muted-foreground">–</span>
            <input type="date" value={sampai} onChange={e => { setSampai(e.target.value); setPage(0); }} className={inputCls} />
          </div></label>
        {view === 'movements' && <>
          <label className="lg:col-span-3"><span className="mb-1 block text-xs font-medium">Item</span>
            <select value={item} onChange={e => { setItem(e.target.value); setPage(0); }} className={inputCls}>
              <option value="">All</option>{(items.data?.items ?? []).map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
            </select></label>
          <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Transaction Type</span>
            <select value={tipe} onChange={e => { setTipe(e.target.value as MovementType | ''); setPage(0); }} className={inputCls}>
              <option value="">All</option>{(Object.keys(MOVEMENT_LABEL) as MovementType[]).map(t => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
            </select></label>
        </>}
        <label className="lg:col-span-3"><span className="mb-1 block text-xs font-medium">Location</span>
          <select value={lokasi} onChange={e => { setLokasi(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
      </div>
      {(mv.error || docs.error) && <p className="mx-4 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{mv.error || docs.error}</p>}

      {view === 'movements' ? <>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              {['No.', 'Date', 'Reference No.', 'Item Code', 'Item Name', 'Type'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
              {['In', 'Out', 'Balance', 'Value'].map(h => <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>)}
              {['Location', 'Source'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
              <th className="px-3 py-2.5 text-center font-medium">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(mv.loading && !mv.data) || !rows.length ? <EmptyRow cols={13} loading={mv.loading && !mv.data} text="No stock movements in this period." /> :
                rows.slice(page * pageSize, (page + 1) * pageSize).map((m, n) => (
                  <tr key={m.id} className="hover:bg-slate-50/60">
                    <td className={tdCls}>{page * pageSize + n + 1}</td>
                    <td className={tdCls}>{fmtDate(m.date)}</td>
                    <td className={`${tdCls} font-medium`}>{m.reference_no}</td>
                    <td className={tdCls}>{m.item_code}</td>
                    <td className={tdCls}>{m.item_name}</td>
                    <td className={tdCls}><Pill label={MOVEMENT_LABEL[m.type] + (m.is_reversal ? ' (void)' : '')} style={MOVEMENT_STYLE[m.type]} /></td>
                    <td className={`${tdCls} text-right`}>{m.qty_in ? qty(m.qty_in) : '-'}</td>
                    <td className={`${tdCls} text-right`}>{m.qty_out ? qty(m.qty_out) : '-'}</td>
                    <td className={`${tdCls} text-right font-medium`}>{qty(m.balance)}</td>
                    <td className={`${tdCls} text-right ${m.value_out ? 'text-rose-600' : ''}`}>{rupiah(m.value_in - m.value_out)}</td>
                    <td className={tdCls}>{m.warehouse}</td>
                    <td className={tdCls}>{m.source ?? '-'}</td>
                    <td className={`${tdCls} text-center`}><button type="button" onClick={() => actions.openDocument(m.document_id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Open document"><Eye size={15} /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="movements" />
      </> : <>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              {['Date', 'Document No.', 'Type', 'Warehouse', 'Source', 'Items'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
              <th className="px-3 py-2.5 text-right font-medium">Quantity</th><th className="px-3 py-2.5 text-right font-medium">Value</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th><th className="px-3 py-2.5 text-left font-medium">Created By</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(docs.loading && !docs.data.length) || !dokumen.length ? <EmptyRow cols={10} loading={docs.loading && !docs.data.length} text="No receipts, issues or opening balances in this period." /> :
                dokumen.slice(page * pageSize, (page + 1) * pageSize).map(d => (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.openDocument(d.id)}>
                    <td className={tdCls}>{fmtDate(d.doc_date)}</td>
                    <td className={`${tdCls} font-medium`}>{d.doc_no}</td>
                    <td className={tdCls}>{DOC_TYPE_LABEL[d.doc_type]}</td>
                    <td className={tdCls}>{d.warehouse}</td>
                    <td className={tdCls}>{d.source_ref ?? '-'}</td>
                    <td className={tdCls}>{d.item_name ?? '-'}</td>
                    <td className={`${tdCls} text-right`}>{qty(d.total_qty)}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(d.total_value)}</td>
                    <td className={tdCls}><Pill label={DOC_STATUS_LABEL[d.status]} style={DOC_STATUS_STYLE[d.status]} /></td>
                    <td className={tdCls}>{d.created_by_name ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={dokumen.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="documents" />
      </>}
    </section>
  );
}
