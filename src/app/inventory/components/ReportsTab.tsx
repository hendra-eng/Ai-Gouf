'use client';

// Tab Reports (Template UI/Inventory/6-8.jpeg): menu laporan di kiri, filter
// periode / kategori / lokasi (+ item untuk Stock Card), Generate, ekspor PDF
// & Excel. Category Summary dan Inventory Valuation memakai layout PDF template.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Loader2, Play } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import {
  fetchInvCategories, fetchInvReport, fetchItems, fetchWarehouses, INV_REPORTS, useInvData, type InvCategory, type InvReport, type InvReportType, type Warehouse,
} from '@/lib/inventoryStore';
import { buildTableCsv, buildTablePdf, buildTableXlsx } from '@/lib/tableExport';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { btnOutline, btnPrimary, inputCls } from '@/components/arap/arapUi';
import { buildCategorySummaryPdf, buildValuationPdf, invColumns, invSpec } from './invReports';

const PER_TANGGAL: InvReportType[] = ['valuation', 'category_summary', 'stock_aging', 'low_stock'];

export default function ReportsTab({ clientId, clientName, asOf }: { clientId: string; clientName: string; asOf: string }) {
  const [jenis, setJenis] = useState<InvReportType>('stock_summary');
  const [dari, setDari] = useState(`${asOf.slice(0, 4)}-01-01`);
  const [sampai, setSampai] = useState(asOf);
  const [kategori, setKategori] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [item, setItem] = useState('');
  const [data, setData] = useState<InvReport | null>(null);
  const [busy, setBusy] = useState(false);
  const kat = useInvData<InvCategory[]>(`icat:${clientId}`, s => fetchInvCategories(clientId, s), []);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const items = useInvData(`items:${clientId}:${asOf}`, s => fetchItems(clientId, asOf, s), null as Awaited<ReturnType<typeof fetchItems>> | null);
  const meta = INV_REPORTS.find(r => r.type === jenis)!;
  const perTanggal = PER_TANGGAL.includes(jenis);

  const teksFilter = useMemo(() => [
    kategori && `Category ${kat.data.find(c => c.id === kategori)?.name ?? ''}`, lokasi && `Warehouse ${gudang.data.find(w => w.id === lokasi)?.name ?? ''}`,
  ].filter(Boolean).join(' · '), [kategori, lokasi, kat.data, gudang.data]);

  const generate = async () => {
    if (jenis === 'stock_card' && !item) { toast.error('Choose an item for the stock card.'); return; }
    if (!perTanggal && dari > sampai) { toast.error('The start date must be before the end date.'); return; }
    setBusy(true);
    try {
      const r = await fetchInvReport(clientId, jenis, { date_from: perTanggal ? `${sampai.slice(0, 4)}-01-01` : dari, date_to: sampai,
        category_id: kategori || undefined, warehouse_id: lokasi || undefined, item_id: item || undefined });
      setData({ ...r, client_name: r.client_name || clientName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ekspor = async (format: 'pdf' | 'xlsx' | 'csv') => {
    if (!data) return;
    try {
      const b = invColumns(data);
      const spec = invSpec(data, b, teksFilter);
      if (format === 'pdf') {
        const doc = data.report_type === 'category_summary' ? buildCategorySummaryPdf(data)
          : data.report_type === 'valuation' ? buildValuationPdf(data, { warehouse: gudang.data.find(w => w.id === lokasi)?.name ?? 'All', category: kat.data.find(c => c.id === kategori)?.name ?? 'All' })
            : buildTablePdf(spec);
        doc.save(`${spec.fileName}.pdf`);
      } else if (format === 'xlsx') {
        downloadBlob(await buildTableXlsx(spec), `${spec.fileName}.xlsx`);
      } else {
        downloadBlob(buildTableCsv(spec), `${spec.fileName}.csv`);
      }
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  const b = data && data.report_type === jenis ? invColumns(data) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
      <nav className="h-fit space-y-1 rounded-2xl border border-border bg-card p-2 shadow-sm">
        {INV_REPORTS.map(r => (
          <button key={r.type} type="button" onClick={() => { setJenis(r.type); setData(null); }}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${jenis === r.type ? 'bg-emerald-50 font-semibold text-[#0F7D4E]' : 'text-foreground hover:bg-slate-50'}`}>
            <FileText size={15} /> {r.label}
          </button>
        ))}
      </nav>

      <section className="min-w-0 rounded-2xl border border-border bg-card shadow-sm">
        <div className="px-5 pt-5">
          <h2 className="text-lg font-bold">{meta.label} Report</h2>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-12 lg:items-end">
          {perTanggal ? (
            <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Per Date</span>
              <input type="date" value={sampai} onChange={e => setSampai(e.target.value)} className={inputCls} /></label>
          ) : (
            <label className="lg:col-span-4"><span className="mb-1 block text-xs font-medium">Period</span>
              <div className="flex items-center gap-1">
                <input type="date" value={dari} onChange={e => setDari(e.target.value)} className={inputCls} /><span className="text-muted-foreground">–</span>
                <input type="date" value={sampai} onChange={e => setSampai(e.target.value)} className={inputCls} />
              </div></label>
          )}
          {jenis === 'stock_card' ? (
            <label className="lg:col-span-3"><span className="mb-1 block text-xs font-medium">Item</span>
              <select value={item} onChange={e => setItem(e.target.value)} className={inputCls}>
                <option value="">Select item</option>{(items.data?.items ?? []).map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
              </select></label>
          ) : (
            <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Category</span>
              <select value={kategori} onChange={e => setKategori(e.target.value)} className={inputCls}>
                <option value="">All</option>{kat.data.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
          )}
          <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium">Location</span>
            <select value={lokasi} onChange={e => setLokasi(e.target.value)} className={inputCls}>
              <option value="">All</option>{gudang.data.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <div className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end">
            <button type="button" onClick={generate} disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Generate</button>
            <button type="button" onClick={() => ekspor('pdf')} disabled={!b} className={btnOutline}><FileText size={15} /> Export PDF</button>
            <button type="button" onClick={() => ekspor('xlsx')} disabled={!b} className={btnOutline}><FileSpreadsheet size={15} /> Export Excel</button>
          </div>
        </div>

        <div className="overflow-x-auto px-5 pb-5">
          {!b ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">Choose the filters and click Generate.</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50">
                {b.columns.map(c => <th key={c.header} className={`whitespace-nowrap px-3 py-2.5 font-medium text-muted-foreground ${c.type ? 'text-right' : 'text-left'}`}>{c.header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {!data!.rows.length && <tr><td colSpan={b.columns.length} className="px-3 py-8 text-center text-muted-foreground">No data for the selected filters.</td></tr>}
                {data!.rows.map((r, i) => (
                  <tr key={i}>{b.columns.map(c => {
                    const v = c.value(r);
                    return <td key={c.header} className={`whitespace-nowrap px-3 py-2 ${c.type ? 'text-right' : ''}`}>
                      {typeof v === 'number' ? (c.type === 'money' ? rupiah(v).replace('Rp ', '') : v.toLocaleString('id-ID', { maximumFractionDigits: 4 })) : (v ?? '')}
                    </td>;
                  })}</tr>
                ))}
              </tbody>
              {b.totals && data!.rows.length > 0 && (
                <tfoot><tr className="border-t-2 border-border bg-slate-50 font-semibold">
                  {b.columns.map(c => {
                    const v = b.totals![c.header];
                    return <td key={c.header} className={`whitespace-nowrap px-3 py-2.5 ${c.type ? 'text-right' : ''}`}>
                      {typeof v === 'number' ? (c.type === 'money' ? rupiah(v).replace('Rp ', '') : v.toLocaleString('id-ID', { maximumFractionDigits: 4 })) : (v ?? '')}</td>;
                  })}
                </tr></tfoot>
              )}
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
