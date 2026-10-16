'use client';

// Tab Reports (Template UI/Fix Assets/2.jpeg): KPI, filter (periode, cabang,
// kategori, lokasi, format), 6 kartu laporan, nilai buku per kategori, dan
// riwayat laporan yang di-generate. Ekspor lewat src/lib/tableExport.ts.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, BarChart3, Building2, CalendarDays, Clock, Download, FileText, Filter, Layers, Loader2,
  MapPin, PieChart as PieIcon, Trash2,
} from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah, rupiahShort } from '@/lib/receivablesPayablesStore';
import {
  fetchReport, fetchReportsSummary, logReport, REPORT_META, useFaData, type ReportData, type ReportFilters, type ReportsSummary, type ReportType,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnPrimary, btnSmall, Card, inputCls } from '@/components/arap/arapUi';
import { Delta, KpiGrid, Modal, Pill } from '@/components/shared/moduleUi';
import { buildReport, exportSpec } from './faReports';

const KARTU: { type: ReportType; icon: React.ElementType; tone: string }[] = [
  { type: 'asset_register', icon: FileText, tone: 'bg-emerald-50 text-emerald-600' },
  { type: 'depreciation_schedule', icon: Clock, tone: 'bg-sky-50 text-sky-600' },
  { type: 'asset_movement', icon: ArrowLeftRight, tone: 'bg-violet-50 text-violet-600' },
  { type: 'disposal', icon: Trash2, tone: 'bg-rose-50 text-rose-600' },
  { type: 'nbv_summary', icon: BarChart3, tone: 'bg-emerald-50 text-emerald-600' },
  { type: 'near_end_of_life', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600' },
];
const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };

export default function ReportsTab({ clientId, clientName, asOf, exportSignal }: {
  clientId: string; clientName: string; asOf: string; exportSignal: { format: ExportFormat; n: number } | null;
}) {
  const awal: ReportFilters = { date_from: `${asOf.slice(0, 4)}-01-01`, date_to: asOf };
  const [draf, setDraf] = useState<ReportFilters>(awal);
  const [filter, setFilter] = useState<ReportFilters>(awal);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [lihat, setLihat] = useState<ReportType | null>(null);
  const [terakhir, setTerakhir] = useState<ReportType>('asset_register');
  const [busy, setBusy] = useState<ReportType | null>(null);
  useEffect(() => { const f = { date_from: `${asOf.slice(0, 4)}-01-01`, date_to: asOf }; setDraf(f); setFilter(f); }, [asOf]);

  const key = `rep:${clientId}:${JSON.stringify(filter)}`;
  const sum = useFaData<ReportsSummary | null>(key, s => fetchReportsSummary(clientId, filter, s), null);
  const k = sum.data?.kpi;
  const opsi = sum.data?.options;

  const teksFilter = useMemo(() => [
    filter.branch && `Branch ${filter.branch}`, filter.category_id && `Category ${opsi?.categories.find(c => c.id === filter.category_id)?.name ?? ''}`,
    filter.location && `Location ${filter.location}`,
  ].filter(Boolean).join(' · '), [filter, opsi]);

  const unduh = async (type: ReportType, fmt: ExportFormat) => {
    setBusy(type);
    try {
      const d = await fetchReport(clientId, type, filter);
      const b = buildReport(d);
      await downloadTable(fmt, exportSpec({ ...d, client_name: d.client_name || clientName }, b, teksFilter));
      await logReport(clientId, { report_type: type, period_from: filter.date_from, period_to: filter.date_to, format: fmt, row_count: b.rows.length,
        filters: { branch: filter.branch || null, category_id: filter.category_id || null, location: filter.location || null } });
      setTerakhir(type);
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  // Tombol "Export PDF / Excel / CSV" di header halaman -> laporan yang terakhir dibuka.
  const sinyal = useRef(exportSignal?.n ?? 0);
  useEffect(() => {
    if (!exportSignal || exportSignal.n === sinyal.current) return;
    sinyal.current = exportSignal.n;
    unduh(lihat ?? terakhir, exportSignal.format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportSignal]);

  const pilih = (k2: keyof ReportFilters, v: string) => setDraf(x => ({ ...x, [k2]: v || undefined }));

  return (
    <div className="space-y-5">
      {sum.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{sum.error}</div>}
      <KpiGrid loading={sum.loading && !sum.data} cards={[
        { label: 'Assets by Category', value: `${k?.categories ?? 0} Categories`, icon: Layers, tone: 'green', delta: <span className="text-[11px] text-muted-foreground">With assets in service</span> },
        { label: 'Net Book Value', value: rupiah(k?.nbv), icon: BarChart3, tone: 'green', delta: <Delta now={k?.nbv} prev={k?.nbv_prev} suffix="vs. previous year" /> },
        { label: 'Monthly Depreciation', value: rupiah(k?.monthly_depreciation), icon: PieIcon, tone: 'red',
          delta: <Delta now={k?.monthly_depreciation} prev={k?.monthly_depreciation_prev} suffix="vs. previous month" /> },
        { label: 'Disposals in Period', value: `${k?.disposals ?? 0} Assets`, icon: ArrowLeftRight, tone: 'amber',
          delta: <Delta now={k?.disposals} prev={k?.disposals_prev} suffix="vs. last year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3 xl:grid-cols-7 xl:items-end">
        <label className="xl:col-span-2"><span className="mb-1 flex items-center gap-1 text-xs font-medium"><CalendarDays size={13} /> Period</span>
          <div className="flex items-center gap-1">
            <input type="date" value={draf.date_from} onChange={e => pilih('date_from', e.target.value)} className={inputCls} />
            <span className="text-muted-foreground">–</span>
            <input type="date" value={draf.date_to} onChange={e => pilih('date_to', e.target.value)} className={inputCls} />
          </div>
        </label>
        <label><span className="mb-1 flex items-center gap-1 text-xs font-medium"><Building2 size={13} /> Branch</span>
          <select value={draf.branch ?? ''} onChange={e => pilih('branch', e.target.value)} className={inputCls}>
            <option value="">All Branches</option>{opsi?.branches.map(b => <option key={b}>{b}</option>)}
          </select></label>
        <label><span className="mb-1 flex items-center gap-1 text-xs font-medium"><Layers size={13} /> Category</span>
          <select value={draf.category_id ?? ''} onChange={e => pilih('category_id', e.target.value)} className={inputCls}>
            <option value="">All Categories</option>{opsi?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label><span className="mb-1 flex items-center gap-1 text-xs font-medium"><MapPin size={13} /> Location</span>
          <select value={draf.location ?? ''} onChange={e => pilih('location', e.target.value)} className={inputCls}>
            <option value="">All Locations</option>{opsi?.locations.map(l => <option key={l}>{l}</option>)}
          </select></label>
        <label><span className="mb-1 flex items-center gap-1 text-xs font-medium"><FileText size={13} /> Format</span>
          <select value={format} onChange={e => setFormat(e.target.value as ExportFormat)} className={inputCls}>
            <option value="pdf">PDF</option><option value="xlsx">Excel</option><option value="csv">CSV</option>
          </select></label>
        <button type="button" onClick={() => { if (draf.date_from > draf.date_to) { toast.error('The start date must be before the end date.'); return; } setFilter(draf); }}
          className={btnPrimary}><Filter size={15} /> Apply Filters</button>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Fixed Assets Reports" subtitle="Generate and view various fixed assets reports for analysis and compliance.">
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2">
            {KARTU.map(c => {
              const Ikon = c.icon;
              const m = REPORT_META[c.type];
              return (
                <div key={c.type} className="flex gap-3 rounded-xl border border-border p-4">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.tone}`}><Ikon size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{m.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button type="button" disabled={busy === c.type} onClick={() => unduh(c.type, format)} className={btnSmall}>
                        {busy === c.type ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {FORMAT_LABEL[format]}
                      </button>
                      <button type="button" onClick={() => { setLihat(c.type); setTerakhir(c.type); }} className={btnSmall}>View Report <ArrowRight size={12} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-5 xl:col-span-2">
          <Card title="Net Book Value by Category">
            <div className="h-60 px-3 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sum.data?.nbv_by_category ?? []} margin={{ top: 18, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="category" tick={{ fontSize: 10, fill: '#64748B' }} interval={0} axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
                  <YAxis tickFormatter={v => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip formatter={(v: number) => rupiah(v)} />
                  <Bar dataKey="nbv" name="Net Book Value" fill="#0F7D4E" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="nbv" position="top" formatter={(v: number) => rupiahShort(v).replace('Rp ', '')} style={{ fontSize: 10, fill: '#0F172A' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Recent Generated Reports">
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Report Name</th><th className="px-3 py-2 text-left font-medium">Period</th>
                  <th className="px-3 py-2 text-left font-medium">Format</th><th className="px-3 py-2 text-left font-medium">Generated On</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {!sum.data?.recent.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No reports generated yet.</td></tr>}
                  {sum.data?.recent.slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{REPORT_META[r.report_type]?.title ?? r.report_type}</td>
                      <td className="px-3 py-2">{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</td>
                      <td className="px-3 py-2"><Pill label={FORMAT_LABEL[r.format]} style={r.format === 'pdf' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'} /></td>
                      <td className="px-3 py-2">{fmtDateTime(r.created_at)}<span className="block text-[10px] text-muted-foreground">{r.created_by_name ?? ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {lihat && <ReportViewer clientId={clientId} type={lihat} filter={filter} onClose={() => setLihat(null)} onExport={f => unduh(lihat, f)} busy={busy === lihat} />}
    </div>
  );
}

function ReportViewer({ clientId, type, filter, onClose, onExport, busy }: {
  clientId: string; type: ReportType; filter: ReportFilters; onClose: () => void; onExport: (f: ExportFormat) => void; busy: boolean;
}) {
  const data = useFaData<ReportData | null>(`rv:${clientId}:${type}:${JSON.stringify(filter)}`, s => fetchReport(clientId, type, filter, s), null);
  const b = data.data ? buildReport(data.data) : null;
  return (
    <Modal open onClose={onClose} width="max-w-6xl" title={REPORT_META[type].title}
      subtitle={`Period ${fmtDate(filter.date_from)} – ${fmtDate(filter.date_to)}`}
      footer={<>
        {(['pdf', 'xlsx', 'csv'] as ExportFormat[]).map(f => (
          <button key={f} type="button" disabled={busy || !b} onClick={() => onExport(f)} className={btnSmall}><Download size={12} /> {FORMAT_LABEL[f]}</button>
        ))}
        <button type="button" onClick={onClose} className={btnSmall}>Close</button>
      </>}>
      {data.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}
      {!b ? <div className="h-48 animate-pulse rounded-xl bg-slate-50" /> : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr>
              {b.columns.map(c => <th key={c.header} className={`whitespace-nowrap px-3 py-2 font-medium text-muted-foreground ${c.type ? 'text-right' : 'text-left'}`}>{c.header}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {!b.rows.length && <tr><td colSpan={b.columns.length} className="px-3 py-8 text-center text-muted-foreground">No data for the selected filters.</td></tr>}
              {b.rows.map((r, i) => (
                <tr key={i}>{b.columns.map(c => {
                  const v = c.value(r);
                  return <td key={c.header} className={`whitespace-nowrap px-3 py-1.5 ${c.type ? 'text-right' : ''}`}>
                    {typeof v === 'number' ? (c.type === 'money' ? rupiah(v) : v.toLocaleString('id-ID')) : (v ?? '')}
                  </td>;
                })}</tr>
              ))}
            </tbody>
            {b.totals && b.rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-slate-50 font-semibold"><tr>
                {b.columns.map(c => {
                  const v = b.totals![c.header];
                  return <td key={c.header} className={`whitespace-nowrap px-3 py-2 ${c.type ? 'text-right' : ''}`}>{typeof v === 'number' ? rupiah(v) : (v ?? '')}</td>;
                })}
              </tr></tfoot>
            )}
          </table>
        </div>
      )}
    </Modal>
  );
}
