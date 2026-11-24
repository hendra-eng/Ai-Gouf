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
import { btnOutline, btnPrimary, InvDatePeriod, InvSelect } from './invUi';
import { buildCategorySummaryPdf, buildValuationPdf, invColumns, invSpec } from './invReports';
import { faTableCls, faRow, tableHeadRow, thCls, tdCls, FaCard } from './InvTable';

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
      <nav className="h-fit space-y-1 rounded-lg border border-neutral-300 bg-card p-2 shadow-sm">
        {INV_REPORTS.map(r => (
          <button key={r.type} type="button" onClick={() => { setJenis(r.type); setData(null); }}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors ${jenis === r.type ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700 hover:bg-neutral-300 hover:text-neutral-900'}`}>
            <FileText size={15} /> {r.label}
          </button>
        ))}
      </nav>

      <FaCard
        className="min-w-0"
        title={`${meta.label} Report`}
        subtitle={meta.description}
        action={<>
          <button type="button" onClick={generate} disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Generate</button>
          <button type="button" onClick={() => ekspor('pdf')} disabled={!b} className={btnOutline}><FileText size={14} /> Export PDF</button>
          <button type="button" onClick={() => ekspor('xlsx')} disabled={!b} className={btnOutline}><FileSpreadsheet size={14} /> Export Excel</button>
        </>}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {perTanggal ? (
              <InvDatePeriod single label="Per Date" to={sampai} onTo={setSampai} />
            ) : (
              <InvDatePeriod from={dari} to={sampai} onFrom={setDari} onTo={setSampai} />
            )}
            {jenis === 'stock_card' ? (
              <InvSelect value={item} onChange={setItem} allLabel="Select Item" searchPlaceholder="Search item..."
                options={(items.data?.items ?? []).map(i => ({ value: i.id, label: `${i.code} · ${i.name}` }))} />
            ) : (
              <InvSelect value={kategori} onChange={setKategori} allLabel="All Categories"
                options={kat.data.map(c => ({ value: c.id, label: c.name }))} />
            )}
            <InvSelect value={lokasi} onChange={setLokasi} allLabel="All Locations"
              options={gudang.data.map(w => ({ value: w.id, label: w.name }))} />
          </div>
        }
      >
        <div className="overflow-x-auto scrollbar-thin pb-5">
          {!b ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">Choose the filters and click Generate.</p>
          ) : (
            <table className={faTableCls}>
              <thead><tr className={tableHeadRow}>
                {b.columns.map(c => <th key={c.header} className={`${thCls} ${c.type ? 'text-right' : 'text-left'}`}>{c.header}</th>)}
              </tr></thead>
              <tbody>
                {!data!.rows.length && <tr><td colSpan={b.columns.length} className="px-2 py-8 text-center text-xs text-neutral-500">No data for the selected filters.</td></tr>}
                {data!.rows.map((r, i) => (
                  <tr key={i} className={faRow}>{b.columns.map(c => {
                    const v = c.value(r);
                    return <td key={c.header} className={`${tdCls} ${c.type ? 'text-right' : ''}`}>
                      {typeof v === 'number' ? (c.type === 'money' ? rupiah(v).replace('Rp ', '') : v.toLocaleString('id-ID', { maximumFractionDigits: 4 })) : (v ?? '')}
                    </td>;
                  })}</tr>
                ))}
              </tbody>
              {b.totals && data!.rows.length > 0 && (
                <tfoot><tr className="bg-neutral-100 text-xs font-bold text-neutral-900 [&>td]:border-t [&>td]:border-neutral-800">
                  {b.columns.map(c => {
                    const v = b.totals![c.header];
                    return <td key={c.header} className={`${tdCls} ${c.type ? 'text-right' : ''}`}>
                      {typeof v === 'number' ? (c.type === 'money' ? rupiah(v).replace('Rp ', '') : v.toLocaleString('id-ID', { maximumFractionDigits: 4 })) : (v ?? '')}</td>;
                  })}
                </tr></tfoot>
              )}
            </table>
          )}
        </div>
      </FaCard>
    </div>
  );
}
