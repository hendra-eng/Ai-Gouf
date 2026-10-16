'use client';

// Tab Item List (Template UI/Inventory/2.jpeg): cari, filter kategori /
// status / lokasi, Import, Export, Add Item, tabel item + stok.

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { ChevronDown, Download, Eye, Loader2, MoreHorizontal, Pencil, Plus, Search, Upload } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteItem, fetchItems, fetchWarehouses, importItems, qty, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE, useInvData, type Item, type StockStatus, type Warehouse,
} from '@/lib/inventoryStore';
import { downloadTable, type ExportColumn, type ExportFormat } from '@/lib/tableExport';
import { btnOutline, btnPrimary, btnSmall, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from '@/components/arap/arapUi';
import { Modal, Pill, tdCls } from '@/components/shared/moduleUi';
import type { InvActions } from './InventoryWorkspace';

const KOLOM: ExportColumn<Item>[] = [
  { header: 'Item Code', value: i => i.code }, { header: 'Item Name', value: i => i.name }, { header: 'Category', value: i => i.category },
  { header: 'Unit', value: i => i.unit }, { header: 'Current Stock', value: i => i.qty, type: 'number' },
  { header: 'Avg. Cost', value: i => i.avg_cost, type: 'money' }, { header: 'Stock Value', value: i => i.value, type: 'money' },
  { header: 'Min. Stock', value: i => i.min_stock, type: 'number' }, { header: 'Barcode', value: i => i.barcode },
  { header: 'Status', value: i => STOCK_STATUS_LABEL[i.stock_status] },
];

export default function ItemListTab({ clientId, clientName, asOf, actions }: { clientId: string; clientName: string; asOf: string; actions: InvActions }) {
  const data = useInvData(`items:${clientId}:${asOf}`, s => fetchItems(clientId, asOf, s), null as Awaited<ReturnType<typeof fetchItems>> | null);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const [cari, setCari] = useState('');
  const [kategori, setKategori] = useState('');
  const [status, setStatus] = useState<'' | StockStatus>('');
  const [lokasi, setLokasi] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [importOpen, setImportOpen] = useState(false);
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const opsiKategori = useMemo(() => Array.from(new Set(items.map(i => i.category).filter(Boolean))) as string[], [items]);

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return items.filter(i => (!q || [i.code, i.name, i.barcode].some(x => (x || '').toLowerCase().includes(q)))
      && (!kategori || i.category === kategori) && (!status || i.stock_status === status)
      && (!lokasi || i.stock_by_warehouse.some(w => w.warehouse_id === lokasi)));
  }, [items, cari, kategori, status, lokasi]);

  const reset = () => { setCari(''); setKategori(''); setStatus(''); setLokasi(''); setPage(0); };
  const ekspor = async (f: ExportFormat) => {
    try {
      await downloadTable(f, { title: 'Inventory Item List', clientName, subtitle: `Per ${fmtDate(asOf)}`, columns: KOLOM, rows: baris,
        totals: { 'Item Code': 'Total', 'Stock Value': baris.reduce((n, i) => n + i.value, 0) }, fileName: `Inventory-Items-${asOf}` });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };
  const hapus = async (i: Item) => {
    if (!window.confirm(`Delete item ${i.code} - ${i.name}? Only items without stock documents can be deleted.`)) return;
    try { toast.success((await deleteItem(clientId, i.id)).message); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-12 lg:items-end">
        <div className="relative lg:col-span-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search item code, name, barcode..." className={`${inputCls} pl-9`} />
        </div>
        <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Category</span>
          <select value={kategori} onChange={e => { setKategori(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All</option>{opsiKategori.map(k => <option key={k}>{k}</option>)}
          </select></label>
        <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Status</span>
          <select value={status} onChange={e => { setStatus(e.target.value as StockStatus | ''); setPage(0); }} className={inputCls}>
            <option value="">All</option>{(Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map(s => <option key={s} value={s}>{STOCK_STATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Location</span>
          <select value={lokasi} onChange={e => { setLokasi(e.target.value); setPage(0); }} className={inputCls}>
            <option value="">All</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <div className="flex flex-wrap gap-2 lg:col-span-3 lg:justify-end">
          <button type="button" onClick={reset} className={btnOutline}>Reset</button>
          <button type="button" onClick={() => setImportOpen(true)} className={btnOutline}><Upload size={15} /> Import</button>
          <Menu width="w-40" button={open => <button type="button" className={btnOutline}><Download size={15} /> Export <ChevronDown size={13} className={open ? 'rotate-180' : ''} /></button>}>
            {close => <>
              <MenuItem onClick={() => { close(); ekspor('xlsx'); }}>Excel</MenuItem>
              <MenuItem onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
              <MenuItem onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
            </>}
          </Menu>
          <button type="button" onClick={actions.addItem} className={btnPrimary}><Plus size={15} /> Add Item</button>
        </div>
      </div>
      {data.error && <p className="mx-4 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}
      <div className="overflow-x-auto px-2">
        <table className="w-full min-w-[1000px] text-sm">
          <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
            {['No.', 'Item Code', 'Item Name', 'Category', 'Unit'].map(h => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
            {['Current Stock', 'Avg. Cost (Rp)', 'Stock Value (Rp)'].map(h => <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>)}
            <th className="px-3 py-2.5 text-left font-medium">Status</th><th className="px-3 py-2.5 text-center font-medium">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {(data.loading && !data.data) || !baris.length ? (
              <EmptyRow cols={10} loading={data.loading && !data.data} text={items.length ? 'No items match the filters.' : 'No items yet. Add items or import them from Excel/CSV.'} />
            ) : baris.slice(page * pageSize, (page + 1) * pageSize).map((i, n) => (
              <tr key={i.id} className="hover:bg-slate-50/60">
                <td className={tdCls}>{page * pageSize + n + 1}</td>
                <td className={`${tdCls} font-medium`}>{i.code}</td>
                <td className={tdCls}>{i.name}</td>
                <td className={tdCls}>{i.category ?? '—'}</td>
                <td className={tdCls}>{i.unit}</td>
                <td className={`${tdCls} text-right`}>{qty(i.qty)}</td>
                <td className={`${tdCls} text-right`}>{rupiah(i.avg_cost).replace('Rp ', '')}</td>
                <td className={`${tdCls} text-right`}>{rupiah(i.value).replace('Rp ', '')}</td>
                <td className={tdCls}><Pill label={STOCK_STATUS_LABEL[i.stock_status]} style={STOCK_STATUS_STYLE[i.stock_status]} /></td>
                <td className={tdCls}>
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => actions.openItem(i.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="View"><Eye size={15} /></button>
                    <button type="button" onClick={() => actions.editItem(i)} className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Edit"><Pencil size={15} /></button>
                    <Menu width="w-48" button={() => <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="More"><MoreHorizontal size={15} /></button>}>
                      {close => <>
                        <MenuItem onClick={() => { close(); actions.newDocument('receipt', { itemId: i.id }); }}>Goods Receipt</MenuItem>
                        <MenuItem onClick={() => { close(); actions.newDocument('issue', { itemId: i.id }); }}>Goods Issue</MenuItem>
                        <MenuItem onClick={() => { close(); actions.newDocument('adjustment', { itemId: i.id }); }}>Adjust Stock</MenuItem>
                        <MenuItem onClick={() => { close(); actions.newDocument('transfer', { itemId: i.id }); }}>Transfer</MenuItem>
                        <MenuItem danger onClick={() => { close(); hapus(i); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NumberPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="items" />
      {importOpen && <ImportModal clientId={clientId} onClose={() => setImportOpen(false)} />}
    </section>
  );
}

// Kolom file -> field item (header dicocokkan tanpa beda huruf besar/kecil).
const PETA_HEADER: Record<string, string> = {
  'item code': 'code', code: 'code', 'kode item': 'code', kode: 'code', sku: 'code',
  'item name': 'name', name: 'name', 'nama item': 'name', nama: 'name',
  category: 'category', kategori: 'category', unit: 'unit', satuan: 'unit', barcode: 'barcode',
  'min stock': 'min_stock', 'minimum stock': 'min_stock', 'stok minimum': 'min_stock',
  'purchase price': 'purchase_price', 'harga beli': 'purchase_price', 'sale price': 'sale_price', 'harga jual': 'sale_price',
};
const ANGKA = new Set(['min_stock', 'purchase_price', 'sale_price']);

function ImportModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [namaFile, setNamaFile] = useState('');
  const [update, setUpdate] = useState(true);
  const [busy, setBusy] = useState(false);

  const baca = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const hasil = json.map(r => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          const f2 = PETA_HEADER[k.trim().toLowerCase()];
          if (!f2 || v === '') continue;
          o[f2] = ANGKA.has(f2) ? Number(String(v).replace(/[^0-9.-]/g, '')) || 0 : String(v).trim();
        }
        return o;
      }).filter(r => r.name);
      setRows(hasil);
      setNamaFile(f.name);
      if (!hasil.length) toast.error('No rows with an item name were found. Use the template columns.');
    } catch {
      toast.error('Could not read the file. Use .xlsx or .csv.');
    }
  };
  const template = () => {
    const ws = XLSX.utils.aoa_to_sheet([['Item Code', 'Item Name', 'Category', 'Unit', 'Barcode', 'Min Stock', 'Purchase Price', 'Sale Price'],
      ['RM-001', 'Raw Material A', 'Raw Materials', 'Kg', '', 100, 25000, '']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.writeFile(wb, 'inventory-item-import-template.xlsx');
  };
  const kirim = async () => {
    setBusy(true);
    try {
      toast.success((await importItems(clientId, rows, update)).message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Import Items" subtitle="Excel or CSV with columns: Item Code, Item Name, Category, Unit, Barcode, Min Stock, Purchase Price, Sale Price. New categories are created automatically."
      footer={<>
        <button type="button" onClick={template} className={btnSmall}>Download Template</button>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={kirim} disabled={busy || !rows.length} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Import {rows.length || ''} Items</button>
      </>}>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && baca(e.target.files[0])} />
      <button type="button" onClick={() => ref.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:bg-slate-50">
        <Upload size={20} /> {namaFile || 'Choose a file'}
      </button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={update} onChange={e => setUpdate(e.target.checked)} /> Update items whose code already exists</label>
      {rows.length > 0 && (
        <div className="max-h-60 overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr>{['Code', 'Name', 'Category', 'Unit', 'Min'].map(h => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i}><td className="px-2 py-1">{String(r.code ?? '(auto)')}</td><td className="px-2 py-1">{String(r.name)}</td>
                  <td className="px-2 py-1">{String(r.category ?? '')}</td><td className="px-2 py-1">{String(r.unit ?? '')}</td><td className="px-2 py-1">{String(r.min_stock ?? '')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
