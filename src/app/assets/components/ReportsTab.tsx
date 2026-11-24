'use client';

// Tab Reports (Template UI/Fix Assets/2.jpeg): KPI, filter (periode, cabang,
// kategori, lokasi, format), 6 kartu laporan, nilai buku per kategori, dan
// riwayat laporan yang di-generate. Ekspor lewat src/lib/tableExport.ts.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, BarChart3, Building2, CalendarDays, Clock, Download, FileText, Filter, Layers, Loader2,
  MapPin, PieChart as PieIcon, Trash2,
} from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah } from '@/lib/receivablesPayablesStore';
import {
  fetchReport, fetchReportsSummary, logReport, REPORT_META, useFaData, type ReportData, type ReportFilters, type ReportsSummary, type ReportType,
} from '@/lib/fixedAssetsStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import { btnSmall, Card } from '@/components/arap/arapUi';
import { Delta, Modal } from '@/components/shared/moduleUi';
import { FaKpiGrid } from './FaKpi';
import FaReportArt, { type FaReportArtKind } from './FaReportArt';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { faTableCls, faRow, tableHeadRow, thCls, tdCls, FaCard, FaPill, FaEmptyRow, faBtn } from './FaTable';
import { buildReport, exportSpec } from './faReports';

// ---- Sumbu Y chart NBV: skala dinamis mengikuti data tertinggi, label Rb/Jt/M/T ----
// ---- Rincian NBV per kategori (panel di bawah chart) ----
// ---- Label sumbu X: nama kategori dari data, dibungkus maks 2 baris (bukan dipotong) ----
// Gaya kontrol filter -- disamakan dengan filter halaman Purchase (tema monokrom "elegant").
const lblCls = 'mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500';
const dateCls = 'w-full rounded-[6px] border border-neutral-300 bg-card px-3 py-2 text-xs text-neutral-900 transition-colors hover:border-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300';

function wrapLabel(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const cut = (t: string) => (t.length > maxChars + 2 ? `${t.slice(0, maxChars + 1)}…` : t);
  if (lines.length > 2) return [cut(lines[0]), cut(`${lines.slice(1).join(' ')}`.slice(0, maxChars + 2) + (lines.slice(1).join(' ').length > maxChars + 2 ? '…' : ''))];
  return lines.map(cut);
}

function CategoryTick({ x, y, payload, maxChars }: { x?: number; y?: number; payload?: { value: string }; maxChars: number }) {
  const full = String(payload?.value ?? '');
  const lines = wrapLabel(full, maxChars);
  return (
    <text x={x} y={(y ?? 0) + 10} textAnchor="middle" fontSize={10} fill="#64748B">
      <title>{full}</title>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 12}>{l}</tspan>)}
    </text>
  );
}

const NBV_COLORS = ['#0F7D4E', '#2E9E6B', '#5BB88A', '#86CCA9', '#B2DFC9', '#D6EEE2'];
const pct1 = (n: number) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

function NbvBreakdown({ rows }: { rows: { category: string; cost: number; accumulated: number; nbv: number; count: number }[] }) {
  const total = rows.reduce((t, r) => t + r.nbv, 0);
  const assets = rows.reduce((t, r) => t + r.count, 0);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const rp = (n: number) => rupiah(Math.round(n));
  return (
    // absolute di dalam wrapper: tinggi kartu mengikuti kolom kiri, daftar digulir bila kategori banyak
    <div className="relative min-h-[320px] flex-1 xl:min-h-[200px]">
      <div className="absolute inset-0 flex flex-col px-4 pb-3">
        <div className="shrink-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-base font-semibold tabular-nums text-neutral-900">{rp(total)}</p>
            <p className="text-[11px] text-neutral-500">{rows.length} categories · {assets.toLocaleString('id-ID')} assets</p>
          </div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            {rows.map((r, i) => (
              <div key={r.category} style={{ width: `${share(r.nbv)}%`, background: NBV_COLORS[Math.min(i, NBV_COLORS.length - 1)] }} />
            ))}
          </div>
        </div>
        <ul className="mt-1 min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto scrollbar-thin">
          {rows.map((r, i) => {
            const color = NBV_COLORS[Math.min(i, NBV_COLORS.length - 1)];
            const depr = r.cost > 0 ? Math.round((r.accumulated / r.cost) * 100) : 0;
            return (
              <li key={r.category} className="py-2" title={`Cost ${rp(r.cost)} · Accum. depreciation ${rp(r.accumulated)} (${depr}%)`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="truncate text-[13px] font-medium text-neutral-900">{r.category}</span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{r.count}</span>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-neutral-900">{rp(r.nbv)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(share(r.nbv), r.nbv > 0 ? 1 : 0)}%`, background: color }} />
                  </div>
                  <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">{pct1(share(r.nbv))}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function fmtAxisId(v: number, intSmall = false): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'M'], [1e6, 'Jt'], [1e3, 'Rb']];
  for (const [base, label] of units) {
    if (a >= base) {
      const n = intSmall && base <= 1e6 ? Math.round(a / base) : Math.round((a / base) * 100) / 100;
      return `${v < 0 ? '-' : ''}${String(n).replace('.', ',')} ${label}`;
    }
  }
  return `${v < 0 ? '-' : ''}${Math.round(a)}`;
}

function niceAxis(values: number[]): { max: number; ticks: number[] } {
  const peak = Math.max(0, ...values.filter(Number.isFinite));
  if (peak <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const target = peak * 1.05; // sedikit di atas bar tertinggi
  const mults = [1, 2, 2.5, 5];
  const mag0 = Math.floor(Math.log10(target)) - 2;
  for (let e = mag0; e <= mag0 + 6; e++) {
    for (const m of mults) {
      const step = m * Math.pow(10, e);
      const count = Math.ceil(target / step);
      if (count >= 4 && count <= 6) {
        return { max: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => step * i) };
      }
    }
  }
  return { max: target, ticks: [0, target] };
}

const KARTU: { type: ReportType; icon: React.ElementType; art: FaReportArtKind }[] = [
  { type: 'asset_register', icon: FileText, art: 'rows' },
  { type: 'depreciation_schedule', icon: Clock, art: 'line' },
  { type: 'asset_movement', icon: ArrowLeftRight, art: 'area' },
  { type: 'disposal', icon: Trash2, art: 'doc' },
  { type: 'nbv_summary', icon: BarChart3, art: 'bars' },
  { type: 'near_end_of_life', icon: AlertTriangle, art: 'table' },
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
      <FaKpiGrid loading={sum.loading && !sum.data} cards={[
        { label: 'Assets by Category', value: `${k?.categories ?? 0} Categories`, icon: Layers, tone: 'violet', delta: <span className="text-[11px] text-muted-foreground">With assets in service</span> },
        { label: 'Net Book Value', value: rupiah(k?.nbv), icon: BarChart3, tone: 'teal', delta: <Delta now={k?.nbv} prev={k?.nbv_prev} suffix="vs. previous year" /> },
        { label: 'Monthly Depreciation', value: rupiah(k?.monthly_depreciation), icon: PieIcon, tone: 'rose',
          delta: <Delta now={k?.monthly_depreciation} prev={k?.monthly_depreciation_prev} suffix="vs. previous month" /> },
        { label: 'Disposals in Period', value: `${k?.disposals ?? 0} Assets`, icon: ArrowLeftRight, tone: 'amber',
          delta: <Delta now={k?.disposals} prev={k?.disposals_prev} suffix="vs. last year" /> },
      ]} />

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3 xl:grid-cols-7 xl:items-end">
        <div className="xl:col-span-2"><span className={lblCls}><CalendarDays size={13} /> Period</span>
          <div className="flex items-center gap-1.5">
            <input type="date" value={draf.date_from} max={draf.date_to || undefined} onChange={e => pilih('date_from', e.target.value)} className={dateCls} />
            <span className="text-neutral-400">–</span>
            <input type="date" value={draf.date_to} min={draf.date_from || undefined} onChange={e => pilih('date_to', e.target.value)} className={dateCls} />
          </div>
        </div>
        <div><span className={lblCls}><Building2 size={13} /> Branch</span>
          <FilterSelect variant="elegant" block size="md" value={draf.branch ?? ''} onChange={v => pilih('branch', v)}
            options={[{ value: '', label: 'All Branches' }, ...(opsi?.branches ?? []).map(b => ({ value: b, label: b }))]} />
        </div>
        <div><span className={lblCls}><Layers size={13} /> Category</span>
          <FilterSelect variant="elegant" block size="md" value={draf.category_id ?? ''} onChange={v => pilih('category_id', v)}
            options={[{ value: '', label: 'All Categories' }, ...(opsi?.categories ?? []).map(c => ({ value: c.id, label: c.name }))]} />
        </div>
        <div><span className={lblCls}><MapPin size={13} /> Location</span>
          <FilterSelect variant="elegant" block size="md" value={draf.location ?? ''} onChange={v => pilih('location', v)}
            options={[{ value: '', label: 'All Locations' }, ...(opsi?.locations ?? []).map(l => ({ value: l, label: l }))]} />
        </div>
        <div><span className={lblCls}><FileText size={13} /> Format</span>
          <FilterSelect variant="elegant" block size="md" value={format} onChange={v => setFormat(v as ExportFormat)}
            options={[{ value: 'pdf', label: 'PDF' }, { value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }]} />
        </div>
        <button type="button" onClick={() => { if (draf.date_from > draf.date_to) { toast.error('The start date must be before the end date.'); return; } setFilter(draf); }}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"><Filter size={15} /> Apply Filters</button>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={<span className="text-neutral-900">Fixed Assets Reports</span>} subtitle="Generate and view various fixed assets reports for analysis and compliance.">
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2">
            {KARTU.map(c => {
              const Ikon = c.icon;
              const m = REPORT_META[c.type];
              return (
                <div key={c.type} className="group relative flex min-h-[148px] gap-3 overflow-hidden rounded-xl border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-neutral-900 via-neutral-400 to-transparent" />
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 ring-1 ring-neutral-200"><Ikon size={20} strokeWidth={1.8} className="text-neutral-800" /></span>
                  <div className="relative z-10 flex min-w-0 flex-1 flex-col">
                    <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-800" /> Fixed Assets
                    </p>
                    <p className="text-sm font-semibold leading-tight text-neutral-900">{m.title}</p>
                    <p className="mt-1 max-w-[13.5rem] text-xs font-medium leading-relaxed text-neutral-500">{m.description}</p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      <button type="button" disabled={busy === c.type} onClick={() => unduh(c.type, format)} className={faBtn}>
                        {busy === c.type ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {FORMAT_LABEL[format]}
                      </button>
                      <button type="button" onClick={() => { setLihat(c.type); setTerakhir(c.type); }} className={faBtn}>View Report <ArrowRight size={12} /></button>
                    </div>
                  </div>
                  <div className="pointer-events-none absolute bottom-3 right-3 hidden opacity-90 sm:block"><FaReportArt art={c.art} /></div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-5 xl:col-span-2">
          <Card title={<span className="text-neutral-900">Net Book Value by Category</span>}>
            {(() => {
              const nbvData: { category: string; nbv: number }[] = sum.data?.nbv_by_category ?? [];
              if (nbvData.length === 0) {
                return <div className="flex h-60 items-center justify-center text-sm text-neutral-400">No data</div>;
              }
              const axis = niceAxis(nbvData.map(d => d.nbv));
              return (
                <div className="overflow-x-auto px-3 pb-4 scrollbar-thin">
                  <div className="h-60" style={{ minWidth: nbvData.length * 60 + 60 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={nbvData} margin={{ top: 18, right: 8, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis dataKey="category" interval={0} axisLine={false} tickLine={false} height={38}
                          tick={(tp: { x?: number; y?: number; payload?: { value: string } }) => <CategoryTick {...tp} maxChars={nbvData.length <= 4 ? 18 : nbvData.length <= 6 ? 13 : nbvData.length <= 9 ? 10 : 8} />} />
                        <YAxis domain={[0, axis.max]} ticks={axis.ticks} tickFormatter={(v: number) => fmtAxisId(v)} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={52} />
                        <Bar dataKey="nbv" name="Net Book Value" fill="#0F7D4E" radius={[4, 4, 0, 0]} maxBarSize={64}>
                          <LabelList dataKey="nbv" position="top" formatter={(v: number) => fmtAxisId(v, true)} style={{ fontSize: 10, fill: '#0F172A' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })()}
          </Card>
          <Card className="flex min-h-0 flex-1 flex-col" title={<span className="text-neutral-900">NBV Breakdown</span>} subtitle="Share of total net book value by category.">
            {(sum.data?.nbv_by_category ?? []).length === 0
              ? <div className="flex h-24 items-center justify-center text-sm text-neutral-400">No data</div>
              : <NbvBreakdown rows={sum.data?.nbv_by_category ?? []} />}
          </Card>
        </div>
      </div>

      <FaCard title="Recent Generated Reports" subtitle={`Showing ${Math.min(sum.data?.recent.length ?? 0, 8)} of ${sum.data?.recent.length ?? 0} reports`}>
        <div className="overflow-x-auto scrollbar-thin">
          <table className={faTableCls}>
            <thead><tr className={tableHeadRow}>
              <th className={thCls}>Report Name</th><th className={thCls}>Period</th>
              <th className={thCls}>Scope</th><th className={thCls}>Rows</th>
              <th className={thCls}>Format</th><th className={thCls}>Generated On</th>
            </tr></thead>
            <tbody>
              {!sum.data?.recent.length && <FaEmptyRow cols={6} text="No reports generated yet." />}
              {sum.data?.recent.slice(0, 8).map(r => (
                <tr key={r.id} className={faRow}>
                  <td className={tdCls}>{REPORT_META[r.report_type]?.title ?? r.report_type}</td>
                  <td className={tdCls}>{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</td>
                  <td className={tdCls}>{[r.filters?.branch, r.filters?.category_id && (opsi?.categories.find(c => c.id === r.filters?.category_id)?.name ?? 'Category'), r.filters?.location].filter(Boolean).join(' · ') || 'All assets'}</td>
                  <td className={`${tdCls} tabular-nums`}>{r.row_count != null ? r.row_count.toLocaleString('id-ID') : '—'}</td>
                  <td className={tdCls}><FaPill label={FORMAT_LABEL[r.format]} style={r.format === 'pdf' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'} /></td>
                  <td className={tdCls}>{fmtDateTime(r.created_at)}<span className="block text-[10px] text-neutral-500">{r.created_by_name ?? ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FaCard>

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
          <table className={faTableCls}>
            <thead className="sticky top-0 z-10"><tr className={tableHeadRow}>
              {b.columns.map(c => <th key={c.header} className={`${thCls} ${c.type ? 'text-right' : 'text-left'}`}>{c.header}</th>)}
            </tr></thead>
            <tbody>
              {!b.rows.length && <FaEmptyRow cols={b.columns.length} text="No data for the selected filters." />}
              {b.rows.map((r, i) => (
                <tr key={i} className={faRow}>{b.columns.map(c => {
                  const v = c.value(r);
                  return <td key={c.header} className={`${tdCls} ${c.type ? 'text-right' : ''}`}>
                    {typeof v === 'number' ? (c.type === 'money' ? rupiah(v) : v.toLocaleString('id-ID')) : (v ?? '')}
                  </td>;
                })}</tr>
              ))}
            </tbody>
            {b.totals && b.rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-neutral-300 font-bold"><tr className="text-xs text-black">
                {b.columns.map(c => {
                  const v = b.totals![c.header];
                  return <td key={c.header} className={`${tdCls} border-t border-neutral-800 ${c.type ? 'text-right' : ''}`}>{typeof v === 'number' ? rupiah(v) : (v ?? '')}</td>;
                })}
              </tr></tfoot>
            )}
          </table>
        </div>
      )}
    </Modal>
  );
}