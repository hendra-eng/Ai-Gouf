'use client';

// Tab Stock Movement (Template UI/Inventory/3.jpeg): kartu stok semua item
// (filter periode, item, tipe, lokasi) + daftar dokumen Opening / Receipt / Issue.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Download, Eye } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  DOC_STATUS_LABEL, DOC_STATUS_STYLE, DOC_TYPE_LABEL, fetchDocuments, fetchItems, fetchMovements, fetchWarehouses, MOVEMENT_LABEL, MOVEMENT_STYLE, qty,
  useInvData, type Movement, type MovementType, type StockDoc, type Warehouse,
} from '@/lib/inventoryStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { Menu, MenuItem } from '@/components/arap/arapUi';
import { btnOutlineSm, InvDatePeriod, InvSearch, InvSelect, showingText } from './invUi';
import { awalBulan } from './DocumentsTab';
import type { InvActions } from './InventoryWorkspace';
import { faTableCls, faRowClickable, faRow, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow, FaPager } from './InvTable';

export default function MovementTab({ clientId, clientName, asOf, actions }: { clientId: string; clientName: string; asOf: string; actions: InvActions }) {
  const [view, setView] = useState<'movements' | 'documents'>('movements');
  const [dari, setDari] = useState(awalBulan(asOf));
  const [sampai, setSampai] = useState(asOf);
  const [item, setItem] = useState('');
  const [tipe, setTipe] = useState<'' | MovementType>('');
  const [lokasi, setLokasi] = useState('');
  const [cari, setCari] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const items = useInvData(`items:${clientId}:${asOf}`, s => fetchItems(clientId, asOf, s), null as Awaited<ReturnType<typeof fetchItems>> | null);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const mv = useInvData(view === 'movements' ? `mv:${clientId}:${dari}:${sampai}:${item}:${tipe}:${lokasi}` : null,
    s => fetchMovements(clientId, { date_from: dari, date_to: sampai, item_id: item || undefined, type: tipe || undefined, warehouse_id: lokasi || undefined }, s),
    null as Awaited<ReturnType<typeof fetchMovements>> | null);
  const docs = useInvData<StockDoc[]>(view === 'documents' ? `mdocs:${clientId}:${dari}:${sampai}` : null,
    s => fetchDocuments(clientId, { date_from: dari, date_to: sampai }, s), []);
  const rowsAll = mv.data?.movements ?? [];
  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? rowsAll.filter(m => [m.reference_no, m.item_code, m.item_name, m.source].some(x => (x || '').toLowerCase().includes(q))) : rowsAll;
  }, [rowsAll, cari]);
  const dokumen = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return docs.data.filter(d => ['opening', 'receipt', 'issue'].includes(d.doc_type) && (!lokasi || d.warehouse_id === lokasi)
      && (!q || [d.doc_no, d.item_name, d.source_ref, d.warehouse].some(x => (x || '').toLowerCase().includes(q))));
  }, [docs.data, lokasi, cari]);

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
    <FaCard
      title={view === 'movements' ? 'Stock Movement List' : 'Receipts, Issues & Opening List'}
      subtitle={view === 'movements'
        ? showingText(page, pageSize, rows.length, rowsAll.length, 'movements')
        : showingText(page, pageSize, dokumen.length, docs.data.length, 'documents')}
      action={<>
        {view === 'movements' && (
          <Menu elegant width="w-40" button={open => <button type="button" className={btnOutlineSm}><Download size={12} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => <>
              <MenuItem strong onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem>
              <MenuItem strong onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
              <MenuItem strong onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
            </>}
          </Menu>
        )}
      </>}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {([['movements', 'Movements'], ['documents', 'Receipts, Issues & Opening']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setView(k); setPage(0); }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${view === k ? 'border-neutral-300 bg-white font-semibold text-neutral-900 shadow-sm' : 'border-transparent bg-neutral-200 font-medium text-neutral-600 hover:bg-neutral-300 hover:text-neutral-900'}`}>{l}</button>
            ))}
          </div>
          <InvDatePeriod label="Period" from={dari} to={sampai} onFrom={v => { setDari(v); setPage(0); }} onTo={v => { setSampai(v); setPage(0); }}
            onClear={() => { setDari(awalBulan(asOf)); setSampai(asOf); setPage(0); }} />
          {view === 'movements' && <>
            <InvSelect value={item} onChange={v => { setItem(v); setPage(0); }} allLabel="All Items" searchPlaceholder="Search item..."
              options={(items.data?.items ?? []).map(i => ({ value: i.id, label: `${i.code} · ${i.name}` }))} />
            <InvSelect value={tipe} onChange={v => { setTipe(v as MovementType | ''); setPage(0); }} allLabel="All Types"
              options={(Object.keys(MOVEMENT_LABEL) as MovementType[]).map(t => ({ value: t, label: MOVEMENT_LABEL[t] }))} />
          </>}
          <InvSelect value={lokasi} onChange={v => { setLokasi(v); setPage(0); }} allLabel="All Locations"
            options={gudang.data.map(w => ({ value: w.id, label: w.name }))} />
          <InvSearch value={cari} onChange={v => { setCari(v); setPage(0); }}
            placeholder={view === 'movements' ? 'Search reference no, item code, item name...' : 'Search document no, item, source...'} className="ml-auto w-full sm:w-[300px]" />
        </div>
      }
    >
      {(mv.error || docs.error) && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{mv.error || docs.error}</p>}

      {view === 'movements' ? <>
        <div className="overflow-x-auto scrollbar-thin">
          <table className={`${faTableCls} min-w-[1100px]`}>
            <thead><tr className={tableHeadRow}>
              {['No.', 'Date', 'Reference No.', 'Item Code', 'Item Name', 'Type'].map(h => <th key={h} className={thCls}>{h}</th>)}
              {['In', 'Out', 'Balance', 'Value'].map(h => <th key={h} className={`${thCls} text-right`}>{h}</th>)}
              {['Location', 'Source'].map(h => <th key={h} className={thCls}>{h}</th>)}
              <th className={`${thCls} text-center`}>Action</th>
            </tr></thead>
            <tbody>
              {(mv.loading && !mv.data) || !rows.length ? <FaEmptyRow cols={13} loading={mv.loading && !mv.data} text="No stock movements in this period." /> :
                rows.slice(page * pageSize, (page + 1) * pageSize).map((m, n) => (
                  <tr key={m.id} className={faRow}>
                    <td className={tdCls}>{page * pageSize + n + 1}</td>
                    <td className={tdCls}>{fmtDate(m.date)}</td>
                    <td className={`${tdCls} font-medium text-blue-700`}>{m.reference_no}</td>
                    <td className={tdCls}>{m.item_code}</td>
                    <td className={tdCls}>{m.item_name}</td>
                    <td className={tdCls}><FaPill label={MOVEMENT_LABEL[m.type] + (m.is_reversal ? ' (void)' : '')} style={MOVEMENT_STYLE[m.type]} /></td>
                    <td className={`${tdCls} text-right`}>{m.qty_in ? qty(m.qty_in) : '-'}</td>
                    <td className={`${tdCls} text-right`}>{m.qty_out ? qty(m.qty_out) : '-'}</td>
                    <td className={`${tdCls} text-right font-medium`}>{qty(m.balance)}</td>
                    <td className={`${tdCls} text-right ${m.value_out ? 'text-rose-600' : ''}`}>{rupiah(m.value_in - m.value_out)}</td>
                    <td className={tdCls}>{m.warehouse}</td>
                    <td className={tdCls}>{m.source ?? '-'}</td>
                    <td className={`${tdCls} text-center`}><button type="button" onClick={() => actions.openDocument(m.document_id)} className="rounded p-1.5 text-neutral-600 transition-colors hover:bg-neutral-300" aria-label="Open document"><Eye size={15} /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <FaPager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="movements" />
      </> : <>
        <div className="overflow-x-auto scrollbar-thin">
          <table className={`${faTableCls} min-w-[980px]`}>
            <thead><tr className={tableHeadRow}>
              {['Date', 'Document No.', 'Type', 'Warehouse', 'Source', 'Items'].map(h => <th key={h} className={thCls}>{h}</th>)}
              <th className={`${thCls} text-right`}>Quantity</th><th className={`${thCls} text-right`}>Value</th>
              <th className={thCls}>Status</th><th className={thCls}>Created By</th>
            </tr></thead>
            <tbody>
              {(docs.loading && !docs.data.length) || !dokumen.length ? <FaEmptyRow cols={10} loading={docs.loading && !docs.data.length} text="No receipts, issues or opening balances in this period." /> :
                dokumen.slice(page * pageSize, (page + 1) * pageSize).map(d => (
                  <tr key={d.id} className={faRowClickable} onClick={() => actions.openDocument(d.id)}>
                    <td className={tdCls}>{fmtDate(d.doc_date)}</td>
                    <td className={`${tdCls} font-medium text-blue-700`}>{d.doc_no}</td>
                    <td className={tdCls}>{DOC_TYPE_LABEL[d.doc_type]}</td>
                    <td className={tdCls}>{d.warehouse}</td>
                    <td className={tdCls}>{d.source_ref ?? '-'}</td>
                    <td className={tdCls}>{d.item_name ?? '-'}</td>
                    <td className={`${tdCls} text-right`}>{qty(d.total_qty)}</td>
                    <td className={`${tdCls} text-right`}>{rupiah(d.total_value)}</td>
                    <td className={tdCls}><FaPill label={DOC_STATUS_LABEL[d.status]} style={DOC_STATUS_STYLE[d.status]} /></td>
                    <td className={tdCls}>{d.created_by_name ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <FaPager page={page} pageSize={pageSize} total={dokumen.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="documents" />
      </>}
    </FaCard>
  );
}