'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Filter, MoreHorizontal, RotateCcw, Search, FileText } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
  BUCKET_COLOR, BUCKET_LABEL, BUCKET_STYLE, fmtDate, fmtMonth, rupiah,
  type ArApDoc, type ArApOverview, type DocStatus, type Settlement, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import { REPORT_GROUPS } from './arapExport';
import {
  AgingBadge, btnSmall, Card, DocDrawer, DocStatusLabel, EmptyRow, Menu, MenuItem, Pager, sortRows, SortTh, useSort,
} from './arapSalesUi';
import type { TabId } from './ArApWorkspace';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';

// Geometri chart Collection Trend. PLOT_H dipakai untuk menghitung geseran sumbu harga
// (piksel -> nilai), jadi harus sama dengan tinggi area plot sebenarnya:
// CHART_H - PLOT_TOP - X_AXIS_H.
const CHART_H = 340;
const PLOT_TOP = 12;
const X_AXIS_H = 30;
const PLOT_H = CHART_H - PLOT_TOP - X_AXIS_H;
const AXIS_LINE = { stroke: '#111827', strokeWidth: 1.5 };

// Label sumbu harga ditulis penuh seperti chart Cash Flow: Rp500.000.000 (tanpa singkatan M/jt).
const fmtAxisRp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
const Y_AXIS_W = 96;
const Y_HIT_W = Y_AXIS_W + 8; // lebar sumbu + margin kiri chart

// Tick sumbu harga berupa kelipatan angka bulat (1 / 2 / 2,5 / 5 x 10^n) agar tetap rapi saat digeser.
function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  if (!(raw > 0)) return [lo];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map(m => m * mag).find(c => c >= raw) ?? raw);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v) + 0);
  return out;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v)) / 2;
  return Math.ceil((v * 1.05) / step) * step;
}

type Kunci = 'party' | 'no' | 'date' | 'due_date' | 'outstanding' | 'days_overdue' | 'status';

export default function OverviewTab({ cfg, asOf, ov, docs, loading, settlements, trendMonths, onTrendMonths, goTab }: {
  cfg: SideConfig; clientId: string; asOf: string; ov: ArApOverview | null; docs: ArApDoc[]; loading: boolean;
  settlements: Settlement[]; trendMonths: number; onTrendMonths: (n: number) => void; goTab: (t: TabId, extra?: Record<string, string>) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | DocStatus>('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(5);
  const [lihat, setLihat] = useState<ArApDoc | null>(null);
  const { sort, onSort } = useSort<Kunci>('days_overdue');

  const terbuka = useMemo(() => docs.filter(d => d.outstanding > 0), [docs]);
  const tersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    const r = terbuka.filter(d => (status === 'all' || d.status === status)
      && (!kata || d.party.toLowerCase().includes(kata) || d.no.toLowerCase().includes(kata) || (d.ref_no ?? '').toLowerCase().includes(kata)));
    return sortRows(r, d => d[sort.key] as string | number, sort.dir);
  }, [terbuka, q, status, sort]);
  useEffect(() => setPage(0), [q, status, size]);
  const halaman = tersaring.slice(page * size, (page + 1) * size);
  const settlePath = `${cfg.basePath}/${cfg.side === 'ar' ? 'receipts' : 'payments'}/new`;

  const totalAging = ov?.aging.reduce((n, a) => n + a.amount, 0) ?? 0;
  const ringkas = REPORT_GROUPS.map(g => ({
    g, amount: (ov?.aging ?? []).filter(a => g.buckets.includes(a.bucket)).reduce((n, a) => n + a.amount, 0),
  }));
  const tren = (ov?.trend ?? []).map(t => ({ ...t, label: fmtMonth(t.month) }));

  // Zoom sumbu harga (Y): seret area label harga ke atas/bawah. Rp 0 selalu tetap di dasar chart;
  // yang berubah hanya batas atas sumbu. `scale` = pengali batas atas (1 = posisi awal, tanpa batas atas).
  // Tarik ke bawah -> batas atas naik, chart tampak menyusut. Tarik ke atas -> kembali (minimal 1).
  const [scale, setScale] = useState(1);
  const dragRef = useRef<{ y: number; scale: number } | null>(null);
  useEffect(() => setScale(1), [trendMonths, asOf]);
  const baseMax = useMemo(
    () => niceMax(Math.max(0, ...tren.map(t => Math.max(t.invoiced ?? 0, t.collected ?? 0, t.balance ?? 0)))),
    [tren],
  );
  const yLo = 0;
  const yHi = baseMax * scale;
  const yTicks = niceTicks(yLo, yHi);

  // Crosshair seperti chart Cash Flow: garis putus-putus selebar/setinggi area plot mengikuti kursor,
  // plus label gelap berisi harga (di sumbu kiri) dan tanggal (di sumbu bawah). Semua diubah lewat ref
  // (tanpa setState) supaya tab tidak di-render ulang tiap mouse bergerak.
  const crossRef = useRef<HTMLDivElement>(null);
  const crossV = useRef<SVGLineElement>(null);
  const crossH = useRef<SVGLineElement>(null);
  const crossPrice = useRef<HTMLSpanElement>(null);
  const crossDate = useRef<HTMLSpanElement>(null);
  // Bulan yang sedang disorot: rinciannya tampil di header card (seperti chart Cash Flow), bukan kotak melayang.
  // null = kursor di luar chart -> header menampilkan bulan terakhir.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const sorot = tren.length ? tren[Math.min(hoverIdx ?? tren.length - 1, tren.length - 1)] : null;
  const moveCross = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const wrap = crossRef.current, v = crossV.current, h = crossH.current, pp = crossPrice.current, dp = crossDate.current;
    if (!wrap || !v || !h || !pp || !dp) return;
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const plotL = Y_HIT_W, plotR = box.width - 12;
    const inside = x >= plotL && x <= plotR && y >= PLOT_TOP && y <= PLOT_TOP + PLOT_H;
    wrap.style.display = inside ? 'block' : 'none';
    if (!inside) return;
    // garis
    v.setAttribute('x1', String(x)); v.setAttribute('x2', String(x));
    h.setAttribute('y1', String(y)); h.setAttribute('y2', String(y)); h.setAttribute('x2', String(plotR));
    // label harga (nilai pada posisi kursor; Rp 0 ada di dasar plot)
    const harga = yLo + (yHi - yLo) * (1 - (y - PLOT_TOP) / PLOT_H);
    pp.textContent = fmtAxisRp(Math.max(0, harga));
    pp.style.top = `${y}px`;
    // label tanggal: bulan = band tempat kursor berada, hari = posisi di dalam band
    if (tren.length) {
      const bw = (plotR - plotL) / tren.length;
      const idx = Math.min(tren.length - 1, Math.max(0, Math.floor((x - plotL) / bw)));
      const [yy, mm] = tren[idx].month.split('-').map(Number);
      const hari = Math.min(new Date(yy, mm, 0).getDate(), 1 + Math.floor(((x - plotL) / bw - idx) * new Date(yy, mm, 0).getDate()));
      dp.textContent = fmtDate(`${tren[idx].month}-${String(hari).padStart(2, '0')}`);
      setHoverIdx(p => (p === idx ? p : idx));
    }
    dp.style.left = `${x}px`;
  };
  const hideCross = () => { if (crossRef.current) crossRef.current.style.display = 'none'; setHoverIdx(null); };

  return (
    <div className="space-y-5">
      <Card
        title={`${cfg.side === 'ar' ? 'Receivable' : 'Payable'} ${cfg.docs}`}
        subtitle={`${cfg.sourceModule} ${cfg.docs.toLowerCase()} with an outstanding balance, their status and aging as of ${fmtDate(asOf)}.`}
        action={<>
          <label className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 sm:w-72">
            <Search size={14} className="text-neutral-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}, ${cfg.doc.toLowerCase()} number...`}
              className="w-full bg-transparent text-sm placeholder:text-neutral-400 focus:outline-none" />
          </label>
          <FilterSelect
            variant="elegant"
            icon={<Filter size={14} />}
            ariaLabel="Filter by status"
            value={status}
            onChange={v => setStatus(v as 'all' | DocStatus)}
            options={[
              { value: 'all', label: 'All open' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'partial', label: 'Partially paid' },
              { value: 'open', label: 'Not yet due' },
            ]}
          />
        </>}
      >
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:border-y [&>th]:border-neutral-800 [&>th]:py-2 [&>th]:font-bold">
                <SortTh label={cfg.party} k="party" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} No.`} k="no" sort={sort} onSort={onSort} />
                <SortTh label={`${cfg.doc} Date`} k="date" sort={sort} onSort={onSort} />
                <SortTh label="Due Date" k="due_date" sort={sort} onSort={onSort} />
                <SortTh label="Outstanding Balance" k="outstanding" sort={sort} onSort={onSort} />
                <SortTh label="Aging" k="days_overdue" sort={sort} onSort={onSort} />
                <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-300">
              {loading || halaman.length === 0 ? (
                <EmptyRow cols={8} loading={loading} text={terbuka.length ? 'No matching items.' : `No outstanding ${cfg.docs.toLowerCase()} as of ${fmtDate(asOf)}. Only posted ${cfg.sourceModule} transactions appear here.`} />
              ) : halaman.map(d => (
                <tr key={d.id} className="hover:bg-neutral-200">
                  <td className="max-w-[220px] truncate px-3 py-2.5 font-medium text-neutral-900" title={d.party}>{d.party}</td>
                  <td className="px-3 py-2.5 text-neutral-900">{d.no}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{fmtDate(d.date)}</td>
                  <td className={`px-3 py-2.5 ${d.days_overdue > 0 ? 'text-rose-600' : 'text-neutral-500'}`}>{fmtDate(d.due_date)}</td>
                  <td className="px-3 py-2.5 font-semibold text-neutral-900">{rupiah(d.outstanding)}</td>
                  <td className="px-3 py-2.5"><AgingBadge bucket={d.bucket} /></td>
                  <td className="px-3 py-2.5"><DocStatusLabel status={d.status} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setLihat(d)} className={`${btnSmall} w-16`}>View</button>
                      <Menu width="w-52" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                        {close => (
                          <>
                            <MenuItem disabled={d.available <= 0} href={`${settlePath}?party=${encodeURIComponent(d.party)}&invoice=${d.id}`} onClick={close}>Record {cfg.settle}</MenuItem>
                            <MenuItem onClick={() => { close(); goTab('statements', { party: d.party }); }}>{cfg.party} Statement</MenuItem>
                            <MenuItem onClick={() => { close(); goTab('invoices', { party: d.party }); }}>All {cfg.docs.toLowerCase()} of this {cfg.party.toLowerCase()}</MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={size} total={tersaring.length} onPage={setPage} onPageSize={setSize} />
      </Card>

      <Card title={`${cfg.side === 'ar' ? 'Collection' : 'Payment'} Trend`} subtitle={`${cfg.trend.invoiced}, ${cfg.trend.settled.toLowerCase()} and ${cfg.trend.balance.toLowerCase()} per month.`}
        action={<>
          {sorot && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-bold uppercase tracking-wide text-neutral-500">{sorot.label}</span>
              {[
                { color: '#A7F3D0', label: cfg.trend.invoiced, value: sorot.invoiced },
                { color: '#262626', label: cfg.trend.settled, value: sorot.collected },
              ].map(r => (
                <span key={r.label} className="flex items-center gap-1.5">
                  <span className="h-3.5 w-1 rounded-sm" style={{ background: r.color }} />
                  <span className="text-neutral-500">{r.label}</span>
                  <span className="font-semibold text-neutral-900">{fmtAxisRp(r.value ?? 0)}</span>
                </span>
              ))}
              <span className="h-4 w-px bg-neutral-300" />
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-1 rounded-sm" style={{ background: '#F59E0B' }} />
                <span className="font-bold text-neutral-900">{cfg.trend.balance}</span>
                <span className="font-semibold text-neutral-900">{fmtAxisRp(sorot.balance ?? 0)}</span>
              </span>
            </div>
          )}
          {scale !== 1 && (
            <button type="button" onClick={() => setScale(1)} className={`${btnSmall} gap-1`} title="Reset price range">
              <RotateCcw size={12} /> Reset
            </button>
          )}
          <FilterSelect
            variant="elegant"
            ariaLabel="Trend period"
            value={String(trendMonths)}
            onChange={v => onTrendMonths(Number(v))}
            options={[{ value: '6', label: 'Last 6 months' }, { value: '12', label: 'Last 12 months' }]}
          />
        </>}>
        <div className="px-5 pb-5">
          {tren.every(t => !t.invoiced && !t.collected && !t.balance) ? (
            <p className="px-2 py-14 text-center text-xs text-neutral-500">No activity in this period.</p>
          ) : (
            <div className="relative" onMouseMove={moveCross} onMouseLeave={hideCross}>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <ComposedChart data={tren} margin={{ top: PLOT_TOP, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" height={X_AXIS_H} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis type="number" domain={[yLo, yHi]} ticks={yTicks} allowDataOverflow tickFormatter={fmtAxisRp}
                    tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={AXIS_LINE} tickLine={false} width={Y_AXIS_W} />
                  <Bar dataKey="invoiced" name={cfg.trend.invoiced} fill="#A7F3D0" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="collected" name={cfg.trend.settled} fill="#262626" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line type="monotone" dataKey="balance" name={cfg.trend.balance} stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {/* Garis sumbu X digambar di ATAS bar, sehingga bar tampak tertimpa garis hitam
                  (posisi dihitung dari geometri chart, jadi urutan layer tidak bergantung versi recharts). */}
              <div aria-hidden className="pointer-events-none absolute bg-[#111827]"
                style={{ left: Y_HIT_W, right: 12, top: PLOT_TOP + PLOT_H - 0.75, height: 1.5 }} />
              {/* Crosshair ala chart Cash Flow: garis putus-putus penuh + label harga & tanggal. */}
              <div ref={crossRef} aria-hidden className="pointer-events-none absolute inset-0" style={{ display: 'none' }}>
                <svg className="absolute inset-0 h-full w-full">
                  <line ref={crossV} x1={0} x2={0} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_H} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
                  <line ref={crossH} x1={Y_HIT_W} x2={Y_HIT_W} y1={0} y2={0} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
                </svg>
                <span ref={crossPrice} className="absolute whitespace-nowrap rounded-full bg-[#1f2937] px-2 py-0.5 text-[11px] font-bold text-white"
                  style={{ left: Y_HIT_W - 6, top: 0, transform: 'translate(-100%, -50%)' }} />
                <span ref={crossDate} className="absolute whitespace-nowrap rounded-full bg-[#1f2937] px-2 py-0.5 text-[11px] font-bold text-white"
                  style={{ left: 0, top: PLOT_TOP + PLOT_H + 6, transform: 'translateX(-50%)' }} />
              </div>
              {/* Area geser harga: seret ke atas/bawah di atas label sumbu Y; klik dua kali untuk reset. */}
              <div
                role="slider" aria-label="Zoom price range" aria-valuenow={Math.round(scale * 100)} tabIndex={0}
                title="Drag down to zoom out the price range, up to zoom back (double-click to reset)"
                className="absolute left-0 cursor-ns-resize touch-none select-none rounded-md transition-colors hover:bg-neutral-900/5"
                style={{ top: PLOT_TOP, height: PLOT_H, width: Y_HIT_W }}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); dragRef.current = { y: e.clientY, scale }; }}
                onPointerMove={e => {
                  const d = dragRef.current;
                  if (!d) return;
                  setScale(Math.max(1, d.scale * 2 ** ((e.clientY - d.y) / 150))); // tiap 150 px = 2x; minimal 1, tanpa batas atas
                }}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }}
                onDoubleClick={() => setScale(1)}
                onKeyDown={e => {
                  if (e.key === 'ArrowUp') setScale(v => Math.max(1, v / 1.15));
                  if (e.key === 'ArrowDown') setScale(v => v * 1.15);
                }}
              />
            </div>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-6 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#A7F3D0]" /> {cfg.trend.invoiced}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-neutral-800" /> {cfg.trend.settled}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" /> {cfg.trend.balance}</span>
          </div>
          <p className="mt-1 text-center text-[11px] text-neutral-400">Drag the price axis down to zoom out (Rp 0 stays in view), up to zoom back.</p>
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Card title="Aging Summary" subtitle="Outstanding balance by age (based on due date)."
          action={<Link href={`${cfg.basePath}/export?as_of=${asOf}`} className={`${btnSmall} text-neutral-900`}><FileText size={13} /> View Aging Report</Link>}>
          <div className="space-y-3 px-5 pb-5">
            {ringkas.map(({ g, amount }) => {
              const p = totalAging ? (amount / totalAging) * 100 : 0;
              return (
                <div key={g.key} className="grid grid-cols-[90px_1fr_80px_42px] items-center gap-3 text-sm">
                  <span className="text-neutral-500">{g.label}</span>
                  <span className="text-right font-semibold text-neutral-900">{rupiah(amount)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-neutral-100">
                    <span className="block h-full rounded-full" style={{ width: `${p}%`, background: g.color }} />
                  </span>
                  <span className="text-right text-xs text-neutral-500">{p.toFixed(0)}%</span>
                </div>
              );
            })}
            <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-3">
              <span className="text-sm font-semibold text-neutral-900">Total {cfg.side === 'ar' ? 'Receivables' : 'Payables'}</span>
              <span className="text-lg font-semibold text-neutral-900">{rupiah(totalAging)}</span>
            </div>
          </div>
        </Card>

        <Card title={`Top Overdue ${cfg.parties}`} subtitle={`${cfg.parties} with the largest overdue balance.`}
          action={<button type="button" onClick={() => goTab('aging')} className="text-xs font-medium text-blue-700 hover:underline">See all</button>}>
          <div className="px-5 pb-5">
            {(ov?.top_overdue ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-xs text-neutral-500">Nothing overdue as of {fmtDate(asOf)}.</p>
            ) : (
              <ol className="divide-y divide-neutral-300">
                {ov!.top_overdue.map((t, i) => (
                  <li key={t.party} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-500">{i + 1}</span>
                    <button type="button" onClick={() => goTab('statements', { party: t.party })} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-neutral-900 hover:underline" title={t.party}>{t.party}</button>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-neutral-900">{rupiah(t.amount)}</p>
                      <p className="text-[11px] text-neutral-500">{t.count} {t.count === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()}</p>
                    </div>
                    <span className={`inline-flex w-[88px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BUCKET_STYLE[t.bucket]}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: BUCKET_COLOR[t.bucket] }} />
                      {BUCKET_LABEL[t.bucket]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <DocDrawer cfg={cfg} doc={lihat} settlements={settlements} onClose={() => setLihat(null)} />
    </div>
  );
}