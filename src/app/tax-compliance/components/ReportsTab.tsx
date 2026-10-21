'use client';

// Tab Reports (Template UI/Tax Compliance/6.jpeg): pilih laporan, Generate Report,
// preview PDF di halaman, Export PDF / Excel / CSV.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, CreditCard, FileSpreadsheet, FileText, Loader2, Maximize2, Percent, Play, RefreshCcw, ScrollText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetchTaxReport, TAX_REPORTS, type TaxReport, type TaxReportType } from '@/lib/taxComplianceStore';
import { buildTableCsv, buildTableXlsx } from '@/lib/tableExport';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { btnOutline, btnPrimary, inputCls } from '@/components/arap/arapUi';
import { buildTaxPdf, taxColumns, taxSpec } from './taxReports';
import type { TaxTabProps } from './TaxWorkspace';

const IKON: Record<TaxReportType, { icon: React.ElementType; tone: string }> = {
  withholding_summary: { icon: FileText, tone: 'bg-emerald-50 text-emerald-600' }, vat_summary: { icon: Percent, tone: 'bg-rose-50 text-rose-500' },
  payment_register: { icon: CreditCard, tone: 'bg-emerald-50 text-emerald-600' }, reconciliation: { icon: RefreshCcw, tone: 'bg-sky-50 text-sky-600' },
  exposure: { icon: BarChart3, tone: 'bg-sky-50 text-sky-600' }, filing_status: { icon: ScrollText, tone: 'bg-sky-50 text-sky-600' },
};

export default function ReportsTab({ clientId, clientName, range }: TaxTabProps) {
  const { user } = useAuth();
  const [jenis, setJenis] = useState<TaxReportType>('withholding_summary');
  const [format, setFormat] = useState<'pdf' | 'xlsx' | 'csv'>('pdf');
  const [data, setData] = useState<TaxReport | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pembuat = user?.nama || user?.username || '';
  const meta = TAX_REPORTS.find(r => r.type === jenis)!;

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const generate = async (unduh = false) => {
    setBusy(true);
    try {
      const d = await fetchTaxReport(clientId, jenis, range);
      const dd = { ...d, client: { ...d.client, name: d.client.name || clientName } };
      setData(dd);
      const c = taxColumns(dd);
      const doc = buildTaxPdf(dd, c, pembuat);
      setUrl(old => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(doc.output('blob')); });
      if (unduh) await ekspor(format, dd);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ekspor = async (f: 'pdf' | 'xlsx' | 'csv', d: TaxReport | null = data) => {
    if (!d) return;
    const c = taxColumns(d);
    const spec = taxSpec(d, c);
    if (f === 'pdf') buildTaxPdf(d, c, pembuat).save(`${spec.fileName}.pdf`);
    else if (f === 'xlsx') downloadBlob(await buildTableXlsx(spec), `${spec.fileName}.xlsx`);
    else downloadBlob(buildTableCsv(spec), `${spec.fileName}.csv`);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-12 md:items-end">
        <div className="md:col-span-5"><span className="mb-1 block text-xs font-medium">Client</span><p className={`${inputCls} truncate`}>{clientName || '—'}</p></div>
        <label className="md:col-span-4"><span className="mb-1 block text-xs font-medium">Output Format</span>
          <select value={format} onChange={e => setFormat(e.target.value as 'pdf' | 'xlsx' | 'csv')} className={inputCls}>
            <option value="pdf">PDF (Recommended)</option><option value="xlsx">Excel</option><option value="csv">CSV</option></select></label>
        <div className="md:col-span-3 md:flex md:justify-end">
          <button type="button" onClick={() => generate(true)} disabled={busy} className={`${btnPrimary} w-full md:w-auto`}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Generate Report</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {TAX_REPORTS.map(r => {
          const I = IKON[r.type];
          const aktif = r.type === jenis;
          return (
            <button key={r.type} type="button" onClick={() => { setJenis(r.type); setData(null); setUrl(null); }}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left shadow-sm transition ${aktif ? 'border-[#22C55E] bg-emerald-50/40 ring-2 ring-[#22C55E]/20' : 'border-border bg-card hover:bg-slate-50'}`}>
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${I.tone}`}><I.icon size={22} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{r.title}</span><span className="block text-xs text-muted-foreground">{r.description}</span></span>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div><h2 className="text-base font-bold">Report Preview</h2><p className="text-xs text-muted-foreground">{meta.title}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => (data ? ekspor('pdf') : generate())} disabled={busy} className={btnOutline}><FileText size={15} className="text-rose-600" /> Export PDF</button>
            <button type="button" onClick={() => ekspor('xlsx')} disabled={!data} className={btnOutline}><FileSpreadsheet size={15} className="text-emerald-600" /> Export Excel</button>
            {url && <a href={url} target="_blank" rel="noreferrer" className={btnOutline} title="Open in a new tab"><Maximize2 size={15} /></a>}
          </div>
        </div>
        <div className="p-5">
          {url ? (
            <iframe src={url} title="Report preview" className="h-[720px] w-full rounded-xl border border-border bg-slate-800" />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Choose a report and click Generate Report to preview it here.
              <button type="button" onClick={() => generate()} disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Preview {meta.title}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
