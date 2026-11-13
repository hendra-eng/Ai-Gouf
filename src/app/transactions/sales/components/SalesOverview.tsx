'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Check, Search, Store, Trophy, ShoppingCart, FileText, Calculator, Clock, CheckCircle, Scale, Percent, Landmark, CreditCard, Banknote, AlertTriangle } from 'lucide-react';
import { formatIDR } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import { useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesInvoices, formatTanggalSingkat, type BackendSalesInvoice } from '@/lib/salesStore';
import {
  buildTrendIndex, buildSeries, buildTicks, makeBounds, pickGranularity, zoomRange, panRange, utc,
  type TimeRange, type TickInfo, type Granularity,
} from './salesTrendTime';
import SalesChartCrosshair from './SalesChartCrosshair';

// ── Sumbu Y: lebarnya dihitung otomatis dari label harga terlebar (lihat salesAxisWidth di
// dalam komponen), dan margin kiri chart = 0, supaya label harga terlebar mulai tepat di
// tepi kiri kartu -- sejajar dengan judul di atasnya. Overlay drag-zoom sumbu Y mengikuti
// lebar yang sama (sama pola dengan chart Financial Overview / Balance Sheet). ──
const SALES_PLOT_LEFT = 0;        // margin.left AreaChart
const SALES_AXIS_GAP = 5;         // jarak label harga ke garis sumbu Y (offset tick Recharts + geser teks)
const SALES_SPRING_MS = 380;
// Sumbu waktu (X) ala TradingView: tarik di area label bulan = zoom, tarik di grafik = geser.
const SALES_XAXIS_HEIGHT = 34;
const SALES_PLOT_RIGHT = 10;      // margin.right AreaChart
const SALES_CHART_HEIGHT = 220;
const SALES_PLOT_TOP = 5;         // margin.top AreaChart
const SALES_TIME_ZOOM_PX = 220;   // jarak tarik (px) untuk melebarkan/menyempitkan jendela ~2,7x
const SALES_AXIS_BORDER = '#0E2F26'; // hijau sidebar (--nav) untuk garis tepi sumbu harga & bulan
const SALES_LINE_COLOR = '#EAB308';  // kuning garis chart
const salesEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// Kartu KPI Overview -- desain sama dengan kartu KPI di tab Source Data, Sales
// Transaction & Posted (garis aksen atas, gradasi hijau lembut, kilau di sudut,
// ikon, bar proporsi). Nada hijau brand; 'warn'/'danger' hanya dipakai saat ada
// peringatan (belum diposting, piutang, jatuh tempo).
type KpiTone = 'slate' | 'amber' | 'green' | 'sky' | 'warn' | 'danger';
const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string; glow: string; border: string }> = {
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]', glow: 'bg-[#6EE7B7]', border: 'border-primary/60' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]', glow: 'bg-[#22C55E]', border: 'border-primary/60' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]', glow: 'bg-[#0F7D4E]', border: 'border-primary/60' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]', glow: 'bg-[#0B5E5C]', border: 'border-primary/60' },
  warn: { strip: 'bg-[#F59E0B]', iconBg: 'bg-[#FEF3C7]', iconText: 'text-[#B45309]', bar: 'bg-[#F59E0B]', glow: 'bg-[#F59E0B]', border: 'border-amber-300' },
  danger: { strip: 'bg-[#EF4444]', iconBg: 'bg-[#FEE2E2]', iconText: 'text-[#DC2626]', bar: 'bg-[#EF4444]', glow: 'bg-[#EF4444]', border: 'border-red-300' },
};

function OverviewKpiTile({ label, value, sub, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className={`relative overflow-hidden rounded-[10px] border ${c.border} bg-gradient-to-br from-white via-white to-[#F0FDF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <span className={`pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full opacity-[0.12] blur-xl ${c.glow}`} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-extrabold uppercase tracking-wide text-slate-700" title={label}>{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-white ${c.iconBg}`}>
          <Icon size={16} className={c.iconText} />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-extrabold tabular-nums text-[#064E3B]" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-semibold text-slate-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-slate-600">{p}% {pctLabel}</p>
    </div>
  );
}

const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

// Dropdown filter kustom -- sama dengan FilterSelect di tab Sales Transaction
// & Posted: selalu terbuka ke bawah, bisa di-scroll, hover/terpilih hijau brand.
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[#6EE7B7] hover:text-[#064E3B] ${selected ? 'bg-[#D1FAE5] font-semibold text-[#065F46]' : 'text-foreground'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

const STATUS_PILL: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  negative: 'bg-red-100 text-red-700',
  neutral: 'bg-muted text-muted-foreground',
};
const STATUS_DOT: Record<string, string> = {
  positive: 'bg-emerald-500', info: 'bg-blue-500', warning: 'bg-amber-500', negative: 'bg-red-500', neutral: 'bg-slate-400',
};
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

interface SalesDragPreview {
  index: number;
  value: number;
}

// Teks label sumbu Y: nominal angka penuh tanpa awalan "Rp". Dipakai juga untuk mengukur
// lebar sumbu, jadi harus satu sumber dengan yang digambar SalesYTick.
const salesYLabel = (value: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(value));

// Label sumbu Y: rata kanan (menempel ke garis sumbu), dalam satu baris.
function SalesYTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  if (x == null || y == null || !payload) return null;
  return (
    <g>
      <text x={x + 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#94a3b8">{salesYLabel(payload.value)}</text>
    </g>
  );
}

// Label sumbu X: tahun/bulan tebal, tanggal tipis; tahun muncul di baris bawah Januari.
function SalesXTick({ x, y, payload, info }: { x?: number; y?: number; payload?: { value: number }; info: Map<number, TickInfo> }) {
  const tick = payload ? info.get(payload.value) : undefined;
  if (!tick || x == null || y == null) return null;
  const strong = tick.kind !== 'day';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={strong ? 600 : 400} fill={strong ? '#64748b' : '#94a3b8'}>
        {tick.label}
      </text>
      {tick.sub && (
        <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#475569">
          {tick.sub}
        </text>
      )}
    </g>
  );
}

// ── Kartu Sales per Branch (donut) & Top Customer (leaderboard) ──
// Desain mengikuti kartu KPI di atas: palet hijau brand, strip aksen, glow
// mint lembut, ikon dalam chip, angka tabular.
const BRANCH_COLORS = ['#0F7D4E', '#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4'];
const BRANCH_OTHERS_COLOR = '#CBD5E1';

const fmtPct = (p: number) => `${p > 0 && p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function SalesCardHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm ring-1 ring-white">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function BranchDonutCard({ branches, total }: { branches: { name: string; value: number }[]; total: number }) {
  const { t } = useLanguage();
  const [hover, setHover] = useState<number | null>(null);

  const segs = useMemo(() => {
    const list = branches.map((b, i) => ({
      name: b.name === 'Unassigned' ? t('Unassigned') : b.name,
      value: b.value,
      color: BRANCH_COLORS[i % BRANCH_COLORS.length],
    }));
    const rest = total - branches.reduce((s2, b) => s2 + b.value, 0);
    if (total > 0 && rest > total * 0.005) list.push({ name: t('Others'), value: rest, color: BRANCH_OTHERS_COLOR });
    return list;
  }, [branches, total, t]);

  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = segs.length > 1 ? 2.5 : 0;
  let acc = 0;
  const arcs = segs.map((sg) => {
    const frac = total > 0 ? sg.value / total : 0;
    const arc = { ...sg, frac, len: Math.max(0, frac * C - GAP), off: acc };
    acc += frac * C;
    return arc;
  });
  const active = hover != null ? arcs[hover] : null;

  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <SalesCardHeader icon={Store} title={t('Sales per Branch')} subtitle={t('Gross sales by branch')} />
      {segs.length === 0 || total <= 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <>
          <div className="relative mx-auto h-[176px] w-[176px] shrink-0">
            <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" onMouseLeave={() => setHover(null)}>
              <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="16" />
              {arcs.map((a, i) => (
                <circle
                  key={`donut-${a.name}-${i}`}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={hover === i ? 20 : 16}
                  strokeDasharray={`${a.len} ${C - a.len}`}
                  strokeDashoffset={-a.off}
                  opacity={hover == null || hover === i ? 1 : 0.35}
                  style={{ transition: 'stroke-width 150ms, opacity 150ms', cursor: 'pointer' }}
                  onMouseEnter={() => setHover(i)}
                />
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-9 text-center">
              <span className="max-w-full truncate text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                {active ? active.name : t('Total Sales')}
              </span>
              <span className="mt-0.5 text-base font-extrabold tabular-nums text-[#064E3B]">
                {formatIDR(active ? active.value : total, true)}
              </span>
              {active && <span className="text-[11px] font-semibold text-slate-500">{fmtPct(active.frac * 100)}</span>}
            </div>
          </div>

          <ul className="mt-4 space-y-1">
            {arcs.map((a, i) => (
              <li
                key={`legend-${a.name}-${i}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${hover === i ? 'bg-[#ECFDF5]' : 'hover:bg-slate-50'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={a.name}>{a.name}</span>
                <span className="font-semibold tabular-nums text-foreground">{formatIDR(a.value, true)}</span>
                <span className="w-10 shrink-0 rounded-full bg-slate-100 py-0.5 text-center text-[10px] font-bold tabular-nums text-slate-600">
                  {fmtPct(a.frac * 100)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TopCustomerCard({ customers, total }: { customers: { name: string; amount: number; count: number }[]; total: number }) {
  const { t } = useLanguage();
  const max = customers[0]?.amount || 1;
  const topShare = total > 0 ? (customers.reduce((s2, c) => s2 + c.amount, 0) / total) * 100 : 0;

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <SalesCardHeader
        icon={Trophy}
        title={t('Top Customer')}
        subtitle={t('Berdasarkan kontribusi nominal')}
        right={customers.length > 0 ? (
          <span className="shrink-0 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-bold text-[#047857] ring-1 ring-[#A7F3D0]">
            Top {customers.length} · {fmtPct(topShare)} {t('of total sales')}
          </span>
        ) : undefined}
      />
      {customers.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {customers.map((c, i) => {
            const first = i === 0;
            const share = total > 0 ? (c.amount / total) * 100 : 0;
            const badge = i === 0 ? 'bg-white/20 text-white' : i === 1 ? 'bg-[#D1FAE5] text-[#065F46]' : i === 2 ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-slate-100 text-slate-600';
            return (
              <div
                key={`top-customer-${c.name}`}
                className={`relative overflow-hidden rounded-[10px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                  first
                    ? 'border-transparent bg-gradient-to-br from-[#0F7D4E] to-[#0B5E5C] text-white shadow-md'
                    : 'border-primary/30 bg-gradient-to-br from-white via-white to-[#F0FDF7]'
                }`}
              >
                <span className={`pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full blur-xl ${first ? 'bg-white opacity-10' : 'bg-[#6EE7B7] opacity-[0.15]'}`} />
                <div className="relative flex items-center justify-between">
                  <span className={`inline-flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-extrabold ${badge}`}>
                    {first ? <Trophy size={12} /> : null}#{i + 1}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${first ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {fmtPct(share)}
                  </span>
                </div>
                <div className="relative mt-3 flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ring-1 ${first ? 'bg-white/20 text-white ring-white/30' : 'bg-[#ECFDF5] text-[#047857] ring-white'}`}>
                    {initialsOf(c.name)}
                  </span>
                  <p className={`min-w-0 truncate text-sm font-bold ${first ? 'text-white' : 'text-foreground'}`} title={c.name}>{c.name}</p>
                </div>
                <p className={`relative mt-3 truncate text-lg font-extrabold tabular-nums ${first ? 'text-white' : 'text-[#064E3B]'}`} title={formatIDR(c.amount)}>
                  {formatIDR(c.amount)}
                </p>
                <p className={`relative text-[11px] font-semibold ${first ? 'text-white/75' : 'text-slate-500'}`}>
                  {c.count} {t('invoices')}
                </p>
                <div className={`relative mt-2 h-1.5 w-full overflow-hidden rounded-full ${first ? 'bg-white/20' : 'bg-slate-100'}`}>
                  <div
                    className={`h-full rounded-full ${first ? 'bg-white' : 'bg-[#0F7D4E]'}`}
                    style={{ width: `${Math.max(3, (c.amount / max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Status invoice (taksonomi financial_transaction_sales_invoices.posting_status):
// Draft/Review/Approved = belum diposting; Posted/Partial/Paid = sudah diposting.
const POSTED_STATUSES = ['Posted', 'Partial', 'Paid'];
const isPosted = (inv: BackendSalesInvoice) => POSTED_STATUSES.includes(inv.posting_status);

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Draft: 'warning', Review: 'warning', Approved: 'info', Posted: 'info', Partial: 'warning', Paid: 'positive',
};

const num = (v: unknown) => Number(v) || 0;
const sumBy = (rows: BackendSalesInvoice[], pick: (r: BackendSalesInvoice) => unknown) => rows.reduce((s, r) => s + num(pick(r)), 0);
const yearOf = (iso: string | null | undefined) => {
  const y = Number((iso || '').slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

const NUMERIC_COLS = ['DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding'];

// Tab "Overview" halaman Transactions > Sales. Seluruh angkanya dihitung dari
// invoice di financial_transaction_sales_invoices (useSalesInvoices, sumber
// yang SAMA dengan tab Sales Transaction / Journal Preview / Posted) --
// bukan lagi dari TransactionsContext (pipeline jurnal-posting lama Agent AI).
// Jadi invoice hasil "Create Invoice" dari Source Data maupun input manual di
// Sales Transaction langsung tampil di sini.
//
// clientId = company aktif (Switch Company), sama seperti tab Sales lainnya & Purchase --
// invoices.client_id mengacu ke management_clients (company), bukan ke akun user yang login.
//
// Definisi angka:
//  - Total Sales / Invoices / DPP / VAT / PPh : SEMUA invoice (Draft s/d Paid),
//    supaya invoice yang baru diimport langsung terlihat.
//  - Posted / Reconciliation                  : hanya invoice berstatus Posted/Partial/Paid.
//  - Paid / Accounts Receivable / Overdue     : hanya invoice yang sudah diposting
//    (piutang baru sah setelah diposting; sama dengan kolom AR di tab Posted).
export default function SalesOverview() {
  const { t, lang } = useLanguage();
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ?? null;
  const { invoices: allInvoices, loading, error } = useSalesInvoices(clientId);
  const invoices = useMemo(() => allInvoices.filter((i) => i.aktif !== false), [allInvoices]);

  const postedInvoices = useMemo(() => invoices.filter(isPosted), [invoices]);
  const pendingInvoices = useMemo(() => invoices.filter((i) => !isPosted(i)), [invoices]);

  // ── KPI baris 1 ──
  const grossSales = sumBy(invoices, (i) => i.gross_amount);
  const txCount = invoices.length;
  const avgTxValue = txCount > 0 ? grossSales / txCount : 0;
  const pendingCount = pendingInvoices.length;
  const pendingTotal = sumBy(pendingInvoices, (i) => i.gross_amount);
  const postedTotal = sumBy(postedInvoices, (i) => i.gross_amount);
  const reconciledCount = postedInvoices.filter((i) => i.reconcile_status === 'Reconciled').length;
  const reconciledPct = postedInvoices.length > 0 ? (reconciledCount / postedInvoices.length) * 100 : 0;

  // ── KPI baris 2 ──
  const totalDPP = sumBy(invoices, (i) => i.dpp);
  const totalPPN = sumBy(invoices, (i) => i.ppn);
  const totalPPh = sumBy(invoices, (i) => i.pph);
  const totalPaid = sumBy(postedInvoices, (i) => i.paid_amount);
  const totalOutstanding = sumBy(postedInvoices, (i) => i.outstanding_amount);
  const overdue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = postedInvoices.filter((i) => !!i.due_date && (i.due_date as string).slice(0, 10) < today && num(i.outstanding_amount) > 0);
    return { count: rows.length, total: sumBy(rows, (i) => i.outstanding_amount) };
  }, [postedInvoices]);

  // ── Tren bulanan (per tahun, berdasarkan invoice_date) ──
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    invoices.forEach((i) => { const y = yearOf(i.invoice_date); if (y) ys.add(y); });
    return Array.from(ys).sort((a, b) => b - a);
  }, [invoices]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const trendYear = pickedYear && availableYears.includes(pickedYear) ? pickedYear : (availableYears[0] ?? new Date().getFullYear());

  // ── Sumbu waktu ala TradingView ──
  // Jendela waktu (view) bisa digeser dan di-zoom. Makin sempit jendelanya, makin halus datanya:
  // tahun -> bulan -> hari. Default = satu tahun penuh (Jan..Des) seperti sebelumnya.
  const trendIndex = useMemo(
    () => buildTrendIndex(invoices, (i) => i.invoice_date, (i) => num(i.gross_amount)),
    [invoices]
  );
  const hasAnySales = useMemo(() => Array.from(trendIndex.month.values()).some((b) => b.total !== 0), [trendIndex]);
  const allTimeMaxMonth = useMemo(() => Math.max(0, ...Array.from(trendIndex.month.values()).map((b) => b.total)), [trendIndex]);

  const defaultView = useMemo<TimeRange>(() => ({ from: utc(trendYear, 0, 1), to: utc(trendYear, 11, 1) }), [trendYear]);
  const [range, setRange] = useState<TimeRange | null>(null);
  const view = range ?? defaultView;
  const timeBounds = useMemo(() => makeBounds(trendIndex, trendYear), [trendIndex, trendYear]);
  const gran: Granularity = pickGranularity(view.to - view.from);

  const intlLocale = lang === 'id' ? 'id-ID' : lang === 'zh' ? 'zh-CN' : 'en-US';
  const fmtMonth = useMemo(() => new Intl.DateTimeFormat(intlLocale, { month: 'short', timeZone: 'UTC' }), [intlLocale]);
  const fmtMonthYear = useMemo(() => new Intl.DateTimeFormat(intlLocale, { month: 'short', year: 'numeric', timeZone: 'UTC' }), [intlLocale]);
  const fmtFullDay = useMemo(() => new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [intlLocale]);
  const pointLabel = useCallback(
    (tm: number, g: Granularity) => (g === 'day' ? fmtFullDay.format(tm) : g === 'month' ? fmtMonthYear.format(tm) : String(new Date(tm).getUTCFullYear())),
    [fmtFullDay, fmtMonthYear]
  );
  const tickFormatters = useMemo(() => ({ monthShort: (tm: number) => fmtMonth.format(tm) }), [fmtMonth]);

  // Titik chart untuk jendela saat ini (+1 bucket di tiap sisi supaya garis menyentuh tepi).
  const trend = useMemo(
    () => buildSeries(trendIndex, view.from, view.to, gran, pointLabel),
    [trendIndex, view.from, view.to, gran, pointLabel]
  );
  const xTicks = useMemo(() => buildTicks(view.from, view.to, gran, tickFormatters), [view.from, view.to, gran, tickFormatters]);
  const xTickValues = useMemo(() => xTicks.map((k) => k.t), [xTicks]);
  const xTickInfo = useMemo(() => new Map(xTicks.map((k) => [k.t, k])), [xTicks]);

  // Dot kalibrasi dideklarasikan di sini supaya direset tepat saat data titik berganti (sebelum chart dirender).
  const salesDotsRef = useRef<{ value: number; cy: number }[]>([]);
  useMemo(() => { salesDotsRef.current = []; }, [trend]);

  // ── Sales per cabang & top customer ──
  const byBranch = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((i) => {
      const key = (i.cabang || '').trim() || 'Unassigned';
      map.set(key, (map.get(key) || 0) + num(i.gross_amount));
    });
    return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [invoices]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    invoices.forEach((i) => {
      const key = (i.customer_name || '').trim() || '-';
      const cur = map.get(key) ?? { amount: 0, count: 0 };
      cur.amount += num(i.gross_amount);
      cur.count += 1;
      map.set(key, cur);
    });
    return Array.from(map, ([name, v]) => ({ name, amount: v.amount, count: v.count })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [invoices]);

  // ── Tabel invoice (cari + filter cabang + paging) ──
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const branches = useMemo(
    () => Array.from(new Set(invoices.map((i) => (i.cabang || '').trim()).filter(Boolean))).sort(),
    [invoices]
  );
  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => {
        if (branchFilter !== 'all' && (i.cabang || '') !== branchFilter) return false;
        if (!q) return true;
        return [i.invoice_no, i.customer_name, i.cabang, i.description].some((v) => (v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));
  }, [invoices, search, branchFilter]);
  const tableTotalPages = Math.max(1, Math.ceil(tableRows.length / tablePageSize));
  const tablePageSafe = Math.min(tablePage, tableTotalPages);
  const pagedRows = tableRows.slice((tablePageSafe - 1) * tablePageSize, tablePageSafe * tablePageSize);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // Financial Overview / Balance Sheet. ──
  const salesBaseMax = useMemo(() => {
    const visible = Math.max(0, ...trend.filter((d) => d.t >= view.from && d.t <= view.to).map((d) => d.total));
    // Jendela kosong (mis. digeser ke tahun tanpa data): pakai skala bulanan tertinggi supaya sumbu Y tetap masuk akal.
    return Math.max(1, visible > 0 ? visible : allTimeMaxMonth) * 1.08;
  }, [trend, view.from, view.to, allTimeMaxMonth]);
  const [salesPriceZoom, setSalesPriceZoom] = useState(1);
  const salesZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: salesYTicks } = useMemo(
    () => getNiceTicksFromZero(salesBaseMax / salesPriceZoom, 5),
    [salesBaseMax, salesPriceZoom]
  );

  // Lebar sumbu Y = label harga terlebar + jarak ke garis sumbu. Diukur dengan canvas memakai font
  // halaman (diukur ulang setelah font selesai dimuat); tebakan awal dipakai untuk render pertama.
  const [salesAxisWidth, setSalesAxisWidth] = useState(() =>
    Math.ceil(Math.max(...salesYTicks.map((v) => salesYLabel(v).length)) * 6.8) + SALES_AXIS_GAP
  );
  useEffect(() => {
    const labels = salesYTicks.map(salesYLabel);
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
      const widest = Math.max(0, ...labels.map((l) => ctx.measureText(l).width));
      const next = Math.ceil(widest) + SALES_AXIS_GAP;
      setSalesAxisWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; };
  }, [salesYTicks]);
  const salesAxisOverlayWidth = salesAxisWidth + SALES_PLOT_LEFT;
  const salesYDomain = useMemo<[number, number]>(() => [0, salesBaseMax / salesPriceZoom], [salesBaseMax, salesPriceZoom]);
  const salesYDomainRef = useRef(salesYDomain);
  salesYDomainRef.current = salesYDomain;

  const handleSalesAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    salesZoomDragRef.current = { startY: e.clientY, startZoom: salesPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!salesZoomDragRef.current) return;
      const deltaY = salesZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, salesZoomDragRef.current.startZoom * factor));
      setSalesPriceZoom(next);
    };
    const onUp = () => {
      salesZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetSalesZoom = () => setSalesPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const [salesDragPreview, setSalesDragPreview] = useState<SalesDragPreview | null>(null);
  const salesDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const salesAnimRef = useRef<number | null>(null);

  const stopSalesSpring = () => {
    if (salesAnimRef.current) cancelAnimationFrame(salesAnimRef.current);
    salesAnimRef.current = null;
  };

  useEffect(() => {
    stopSalesSpring();
    salesDragStateRef.current = null;
    setSalesDragPreview(null);
  }, [trend]);

  useEffect(() => stopSalesSpring, []);

  const springBackSales = useCallback(() => {
    const drag = salesDragStateRef.current;
    if (!drag) return;
    stopSalesSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SALES_SPRING_MS);
      const eased = salesEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (salesDragStateRef.current) salesDragStateRef.current.currentValue = next;
      setSalesDragPreview({ index, value: next });
      if (elapsed < 1) {
        salesAnimRef.current = requestAnimationFrame(step);
      } else {
        salesDragStateRef.current = null;
        salesAnimRef.current = null;
        setSalesDragPreview(null);
      }
    };
    salesAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleSalesDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSalesSpring();

    const samples = salesDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = 0; // 0 = belum terkalibrasi -> pakai fallback di bawah
    if (samples.length >= 2) {
      let a = samples[0];
      let b = samples[0];
      for (const pt of samples) {
        if (pt.value < a.value) a = pt;
        if (pt.value > b.value) b = pt;
      }
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = salesYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    salesDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setSalesDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = salesDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = salesYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setSalesDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (salesDragStateRef.current) springBackSales();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackSales]);

  const salesDisplayTrend = useMemo(() => {
    if (!salesDragPreview) return trend;
    return trend.map((d, i) => (i === salesDragPreview.index ? { ...d, total: salesDragPreview.value } : d));
  }, [trend, salesDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderSalesCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    salesDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`sales-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderSalesActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = salesDragPreview?.index === index;
    return (
      <g key={`sales-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill={SALES_LINE_COLOR} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleSalesDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  // ── Zoom & geser sumbu waktu (ala TradingView) ──
  //  - Tarik di area label bulan: kanan = jendela melebar (bulan -> tahun), kiri = menyempit (bulan -> tanggal).
  //    Titik yang diklik tetap di tempatnya saat zoom.
  //  - Tarik di grafik: geser periode kiri/kanan. Klik dua kali di label = kembali ke satu tahun penuh.
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boundsRef = useRef(timeBounds);
  boundsRef.current = timeBounds;

  const beginTimeDrag = (e: React.PointerEvent, mode: 'zoom' | 'pan') => {
    const el = chartWrapRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const plotLeft = rect.left + salesAxisOverlayWidth;
    const plotWidth = Math.max(60, rect.width - salesAxisOverlayWidth - SALES_PLOT_RIGHT);
    const start = viewRef.current;
    const span = start.to - start.from;
    const startX = e.clientX;
    if (mode === 'pan') setPanning(true);
    const anchor = Math.min(1, Math.max(0, (startX - plotLeft) / plotWidth));
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (mode === 'zoom') setRange(zoomRange(start, Math.exp(dx / SALES_TIME_ZOOM_PX), anchor, boundsRef.current));
      else setRange(panRange(start, (-dx / plotWidth) * span, boundsRef.current));
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleChartPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < salesAxisOverlayWidth || y > rect.height - SALES_XAXIS_HEIGHT) return; // sumbu Y & sumbu X punya handler sendiri
    beginTimeDrag(e, 'pan');
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">{t('Error:')}</span>
          <span>{error}</span>
        </div>
      )}

      {/* Invoice yang belum diposting tetap dihitung di Total Sales, tapi
          diberi peringatan supaya jelas mana yang belum resmi masuk jurnal. */}
      {pendingCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{t('Perhatian:')}</span>
          <span>
            {pendingCount} {t('invoices worth')} {formatIDR(pendingTotal, true)} {t('are not posted yet (Draft / Review / Approved) — they are included in Total Sales, but not in Paid, Accounts Receivable, or Overdue.')}
          </span>
        </div>
      )}

      {/* KPI Cards -- desain sama dengan KPI di tab lain */}
      {(() => {
        const maxGross = invoices.reduce((m, i) => Math.max(m, num(i.gross_amount)), 0);
        const label = (txt: string) => (
          <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
            <span className="h-3.5 w-1 rounded-full bg-[#0F7D4E]" />{txt}
          </p>
        );
        return (
          <>
            <div>
              {label(t('Performa Penjualan'))}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                <OverviewKpiTile
                  label={t('Total Sales')} value={formatIDR(grossSales)} tone="green" icon={ShoppingCart}
                  sub={txCount > 0 ? `${formatIDR(postedTotal, true)} ${t('posted')}` : undefined}
                  pct={pctOf(postedTotal, grossSales)} pctLabel={t('of sales posted')}
                />
                <OverviewKpiTile
                  label={t('Number of Transactions')} value={String(txCount)} tone="slate" icon={FileText}
                  sub={`${postedInvoices.length} ${t('posted')}`}
                  pct={pctOf(postedInvoices.length, txCount)} pctLabel={t('of transactions posted')}
                />
                <OverviewKpiTile
                  label={t('Average per Transaction')} value={formatIDR(avgTxValue)} tone="sky" icon={Calculator}
                  sub={maxGross > 0 ? `${t('Largest')} ${formatIDR(maxGross, true)}` : undefined}
                  pct={pctOf(avgTxValue, maxGross)} pctLabel={t('of largest invoice')}
                />
                <OverviewKpiTile
                  label={t('Not Posted')} value={String(pendingCount)} tone={pendingCount > 0 ? 'warn' : 'amber'} icon={Clock}
                  sub={pendingCount > 0 ? `${t('Worth')} ${formatIDR(pendingTotal, true)}` : undefined}
                  pct={pctOf(pendingCount, txCount)} pctLabel={t('of all transactions')}
                />
                <OverviewKpiTile
                  label={t('Reconciliation')} value={`${reconciledPct.toFixed(0)}%`} tone="green" icon={CheckCircle}
                  sub={`${reconciledCount} / ${postedInvoices.length} ${t('posted')}`}
                  pct={reconciledPct} pctLabel={t('of posted reconciled')}
                />
              </div>
            </div>

            <div>
              {label(t('Pajak & Piutang'))}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <OverviewKpiTile
                  label={t('Total Tax Base (DPP)')} value={formatIDR(totalDPP)} tone="slate" icon={Scale}
                  pct={pctOf(totalDPP, grossSales)} pctLabel={t('of total sales')}
                />
                <OverviewKpiTile
                  label={t('VAT Output')} value={formatIDR(totalPPN)} tone="amber" icon={Percent}
                  pct={pctOf(totalPPN, totalDPP)} pctLabel={t('of tax base')}
                />
                <OverviewKpiTile
                  label={t('Total Withholding Tax (PPh)')} value={formatIDR(totalPPh)} tone="sky" icon={Landmark}
                  pct={pctOf(totalPPh, totalDPP)} pctLabel={t('of tax base')}
                />
                <OverviewKpiTile
                  label={t('Paid')} value={formatIDR(totalPaid)} tone="green" icon={CreditCard}
                  pct={pctOf(totalPaid, postedTotal)} pctLabel={t('of posted sales')}
                />
                <OverviewKpiTile
                  label={t('Accounts Receivable')} value={formatIDR(totalOutstanding)} tone={totalOutstanding > 0 ? 'warn' : 'amber'} icon={Banknote}
                  pct={pctOf(totalOutstanding, postedTotal)} pctLabel={t('of posted sales')}
                />
                <OverviewKpiTile
                  label={t('Overdue Invoices')} value={String(overdue.count)} tone={overdue.count > 0 ? 'danger' : 'sky'} icon={AlertTriangle}
                  sub={overdue.count > 0 ? `${t('Worth')} ${formatIDR(overdue.total, true)}` : undefined}
                  pct={pctOf(overdue.count, postedInvoices.length)} pctLabel={t('of posted invoices')}
                />
              </div>
            </div>
          </>
        );
      })()}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('Tren Sales Bulanan')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t('Based on invoice date, gross amount')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                {gran === 'day' ? t('Daily') : gran === 'month' ? t('Monthly') : t('Yearly')}
              </span>
              {range && (
                <button
                  type="button"
                  onClick={() => setRange(null)}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground hover:bg-muted"
                >
                  {t('Reset')}
                </button>
              )}
              {availableYears.length > 1 && (
                <select
                  value={trendYear}
                  onChange={(e) => { setPickedYear(Number(e.target.value)); setRange(null); }}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground"
                >
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
            </div>
          </div>
          {!hasAnySales ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{loading ? t('Loading...') : t('No sales invoices to display yet.')}</p>
          ) : (
            <div
              ref={chartWrapRef}
              onPointerDown={handleChartPointerDown}
              className={`relative select-none ${panning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
              style={{ touchAction: 'pan-y' }}
            >
              <ResponsiveContainer width="100%" height={SALES_CHART_HEIGHT}>
                <AreaChart data={salesDisplayTrend} margin={{ top: SALES_PLOT_TOP, right: SALES_PLOT_RIGHT, left: SALES_PLOT_LEFT, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradSalesMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SALES_LINE_COLOR} stopOpacity={0.65} />
                      <stop offset="95%" stopColor={SALES_LINE_COLOR} stopOpacity={0.12} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="linear"
                    domain={[view.from, view.to]}
                    allowDataOverflow
                    ticks={xTickValues}
                    interval={0}
                    tick={(p: any) => <SalesXTick {...p} info={xTickInfo} />}
                    axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
                    tickLine={false}
                    height={SALES_XAXIS_HEIGHT}
                  />
                  <YAxis
                    tick={(p: any) => <SalesYTick {...p} />}
                    axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
                    tickLine={false}
                    width={salesAxisWidth}
                    ticks={salesYTicks}
                    domain={salesYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={() => null} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Sales"
                    stroke={SALES_LINE_COLOR}
                    strokeWidth={2.5}
                    fill="url(#gradSalesMain)"
                    dot={renderSalesCalibrationDot as any}
                    activeDot={renderSalesActiveDot as any}
                    isAnimationActive={!salesDragPreview && range === null}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleSalesAxisMouseDown}
                onDoubleClick={resetSalesZoom}
                title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: salesAxisOverlayWidth }}
              />
              {/* Overlay drag di area label waktu: tarik kanan = zoom out (tahun), tarik kiri = zoom in (tanggal) */}
              <div
                onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); beginTimeDrag(e, 'zoom'); }}
                onDoubleClick={() => setRange(null)}
                title={t('Tarik kanan/kiri untuk zoom periode · klik dua kali untuk reset')}
                className="absolute bottom-0 cursor-ew-resize"
                style={{ left: salesAxisOverlayWidth, right: SALES_PLOT_RIGHT, height: SALES_XAXIS_HEIGHT, touchAction: 'none' }}
              />
              {/* Crosshair: garis horizontal + vertikal di kursor dengan label harga & tanggal */}
              <SalesChartCrosshair
                wrapRef={chartWrapRef}
                geometry={{
                  plotLeft: salesAxisOverlayWidth,
                  plotRightMargin: SALES_PLOT_RIGHT,
                  plotTop: SALES_PLOT_TOP,
                  plotBottom: SALES_CHART_HEIGHT - SALES_XAXIS_HEIGHT,
                }}
                view={view}
                gran={gran}
                yMax={salesYDomain[1]}
                trend={trend}
                pointLabel={pointLabel}
                dragPreview={salesDragPreview}
                estimatedLabel={t('Estimated')}
                salesLabel={t('Sales')}
              />
            </div>
          )}
        </div>

        <BranchDonutCard branches={byBranch} total={grossSales} />
      </div>

      {/* Top Customer -- leaderboard lebar penuh */}
      <TopCustomerCard customers={topCustomers} total={grossSales} />

      {/* Tabel invoice Sales (read-only ringkasan -- edit/approve/posting ada di tab Sales Transaction) */}
      {invoices.length === 0 ? (
        <div className="card p-8 text-center text-xs text-muted-foreground">
          {loading ? t('Loading...') : t('No sales invoices yet. Upload a file in Source Data and create invoices, or add one in Sales Transaction.')}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border">
            <h3 className="text-2xl font-bold text-foreground">{t('Daftar Invoice Penjualan')}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tableRows.length === 0
                ? t('Menampilkan 0 dari 0 transaksi')
                : `${t('Menampilkan')} ${(tablePageSafe - 1) * tablePageSize + 1} - ${Math.min(tablePageSafe * tablePageSize, tableRows.length)} ${t('dari')} ${tableRows.length} ${t('transaksi')}`}
            </p>
          </div>

          {/* Filter -- desain sama dengan filter di Sales Transaction */}
          <div className="py-3 flex flex-wrap items-center gap-2 border-b border-border">
            <FilterSelect
              value={branchFilter}
              onChange={(v) => { setBranchFilter(v); setTablePage(1); }}
              options={[{ value: 'all', label: t('All Branches') }, ...branches.map((b) => ({ value: b, label: b }))]}
            />
            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setTablePage(1); }}
                placeholder={t('Cari Invoice, deskripsi, customer, no. jurnal...')}
                className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1300px] select-text">
              <thead>
                <tr className="bg-[#8FE3B5]">
                  {['Date', 'Invoice', 'Customer', 'Cabang', 'DPP', 'PPN', 'PPh', 'Gross', 'Paid', 'Outstanding', 'Due Date', 'Journal', 'Status'].map((h) => (
                    <th key={h} className={`py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32] ${NUMERIC_COLS.includes(h) ? 'text-right' : 'text-left'}`}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {pagedRows.map((r) => {
                  const variant = statusVariant[r.posting_status] || 'neutral';
                  const money = (v: unknown, extra = '') => (
                    <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap ${num(v) < 0 ? 'text-red-600' : ''} ${extra}`}>{formatIDR(num(v))}</td>
                  );
                  return (
                    <tr key={r.id} className="border-b border-slate-400/80 hover:bg-slate-200/70 transition-colors text-xs">
                      <td className="py-2 px-2 text-foreground whitespace-nowrap">{formatTanggalSingkat(r.invoice_date)}</td>
                      <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{r.invoice_no}</td>
                      <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap">{r.customer_name}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.cabang || '—'}</td>
                      {money(r.dpp)}
                      {money(r.ppn)}
                      {money(r.pph)}
                      {money(r.gross_amount, 'font-semibold')}
                      {money(r.paid_amount)}
                      {money(r.outstanding_amount, isPosted(r) && num(r.outstanding_amount) > 0 ? '!text-amber-600 font-semibold' : '')}
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.due_date ? formatTanggalSingkat(r.due_date) : '—'}</td>
                      <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{r.journal_entry_id ? `JE-${r.journal_entry_id}` : '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[variant]}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[variant]}`} />{t(r.posting_status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={tablePageSize} onChange={(e) => { setTablePageSize(Number(e.target.value)); setTablePage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {tableRows.length === 0 ? 0 : (tablePageSafe - 1) * tablePageSize + 1}–{Math.min(tablePageSafe * tablePageSize, tableRows.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-foreground">{tableRows.length}</span> {t('transaksi')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setTablePage(tablePageSafe - 1)} disabled={tablePageSafe <= 1} aria-label={t('Halaman sebelumnya')} className={NAV_BTN}><ChevronLeft size={16} /></button>
              {buildPageItems(tablePageSafe, tableTotalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => setTablePage(p)} aria-current={p === tablePageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === tablePageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => setTablePage(tablePageSafe + 1)} disabled={tablePageSafe >= tableTotalPages} aria-label={t('Halaman berikutnya')} className={NAV_BTN}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}