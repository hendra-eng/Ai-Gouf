'use client';

// Halaman Other Transactions (layout dataset/picture/Template UI/other/1.jpeg):
// tab Overview, Categories, Review Queue, Journal Preview, Exceptions, Posted +
// tombol Create Transaction, Transaction Templates, Import, Export.
// Backend: modules/assets_and_equity/other_transactions_v1.py.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleCheck, Clock, Download, Eye, FileText, LayoutGrid, Loader2, Plus, Tag, Upload, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useActiveClient } from '@/lib/activeClient';
import { fmtDate, fmtMonth, rupiah, rupiahShort, todayIso } from '@/lib/receivablesPayablesStore';
import { downloadTable, type ExportFormat } from '@/lib/tableExport';
import {
  fetchCategories, fetchMeta, fetchOverview, fetchTransactions, useOtherTxData,
  type CategoryStat, type Meta, type OtherTx, type Overview, type TxStatus, type TypeKey,
} from '@/lib/otherTransactionStore';
import { btnOutline, btnPrimary, btnSmall, EmptyRow, inputCls, Menu, MenuItem } from '@/components/arap/arapUi';
import { tdCls } from '@/components/shared/moduleUi';
import {
  cocok, createHref, editHref, EDITABLE, MonoTypeIcon, PreviewLines, runBulk, SearchBox, StatusPill, TransactionDrawer, TYPE_ORDER, TYPE_UI,
} from './otherUi';
import TemplatesModal from './TemplatesModal';
import OtherImportModal from './OtherImportModal';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

type Tab = 'overview' | 'categories' | 'review' | 'preview' | 'exceptions' | 'posted';
// Gaya tab -- disamakan dengan halaman Sales (tema monokrom: garis bawah hitam, ikon garis tipis).
const tabBarCls = 'flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
const tabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white';

// Tombol aksi di baris tab -- sama dengan tombol di Sales > Source Data (kecil, monokrom).
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'review', label: 'Review Queue', icon: Clock },
  { id: 'preview', label: 'Journal Preview', icon: FileText },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'posted', label: 'Posted', icon: CircleCheck },
];

interface Ctx { clientId: string; meta: Meta | null; txs: OtherTx[]; loading: boolean; error: string | null; open: (id: string) => void }

export default function OtherWorkspace() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const tab = (params.get('tab') as Tab) || 'overview';
  const goTab = useCallback((t: Tab) => router.replace(t === 'overview' ? pathname : `${pathname}?tab=${t}`, { scroll: false }), [pathname, router]);
  const meta = useOtherTxData<Meta | null>(kid ? `otmeta:${kid}` : null, s => fetchMeta(kid as string, s), null);
  const txs = useOtherTxData<OtherTx[]>(kid ? `otx:${kid}` : null, s => fetchTransactions(kid as string, s), []);
  const [buka, setBuka] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'templates' | 'import'>(null);
  const [exporting, setExporting] = useState(false);
  const review = txs.data.filter(t => t.status === 'pending_review').length;
  const exceptions = txs.data.filter(t => !['posted', 'reversed'].includes(t.status) && t.issues.length).length;

  const ekspor = async (format: ExportFormat) => {
    if (!txs.data.length) { toast.info('There are no transactions to export.'); return; }
    setExporting(true);
    try {
      await downloadTable(format, {
        title: 'Other Transactions', clientName: meta.data?.client_name || '', fileName: `other-transactions-${todayIso()}`, orientation: 'landscape',
        rows: txs.data,
        columns: [
          { header: 'Transaction ID', value: t => t.journal_no }, { header: 'Date', value: t => fmtDate(t.journal_date) },
          { header: 'Type', value: t => t.type_name }, { header: 'Subtype', value: t => t.subtype_label },
          { header: 'Counterparty', value: t => t.counterparty }, { header: 'Reference', value: t => t.reference_no },
          { header: 'Description', value: t => t.description }, { header: 'Amount (IDR)', value: t => t.amount_idr, type: 'money' },
          { header: 'Status', value: t => t.status_label },
          { header: 'Journal', value: t => t.lines.map(l => `${l.debit ? 'Dr' : 'Cr'} ${kodeAkun(l.account_code)} ${(l.debit || l.credit).toLocaleString('id-ID')}`).join('; ') },
        ],
      });
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const ctx: Ctx | null = kid ? { clientId: kid, meta: meta.data, txs: txs.data, loading: txs.loading && !txs.data.length, error: txs.error || meta.error, open: setBuka } : null;
  const templates = (meta.data?.templates ?? []).filter(t => t.is_active);
  // Tombol aksi hanya tampil di tab yang relevan.
  const showImport = tab === 'overview';
  const showExport = tab === 'overview' || tab === 'categories' || tab === 'posted';
  const showTemplates = tab === 'overview' || tab === 'categories';
  const showCreate = tab === 'overview' || tab === 'categories';

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10">
        <div className="-mb-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Other Transactions</h1>
            <p className="mt-1 text-sm font-medium text-neutral-500">Special business events outside Sales, Purchase, and Cash &amp; Bank.</p>
          </div>
        </div>
        <div className={tabBarCls}>
        <nav className={`${tabListCls} min-w-0`}>
          {TABS.map(t => {
            const n = t.id === 'review' ? review : t.id === 'exceptions' ? exceptions : 0;
            return (
              <button key={t.id} type="button" onClick={() => goTab(t.id)} className={tabCls(t.id === tab)}>
                <t.icon size={16} strokeWidth={t.id === tab ? 2 : 1.5} /> {t.label}
                {n > 0 && <span className={tabBadgeCls}>{n}</span>}
              </button>
            );
          })}
        </nav>
        {(showImport || showExport || showTemplates || showCreate) && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 whitespace-nowrap pb-2 lg:flex-nowrap lg:pb-0">
            {showImport && (
              <button type="button" disabled={!kid} onClick={() => setModal('import')} className={ACTION_BTN_SECONDARY}><Upload size={13} /> Import</button>
            )}
            {showExport && (
              <Menu width="w-44" button={() => (
                <button type="button" disabled={!kid || exporting} className={ACTION_BTN_SECONDARY}>{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export</button>
              )}>
                {close => <>
                  <MenuItem strong onClick={() => { close(); ekspor('xlsx'); }}>Excel (.xlsx)</MenuItem>
                  <MenuItem strong onClick={() => { close(); ekspor('csv'); }}>CSV</MenuItem>
                  <MenuItem strong onClick={() => { close(); ekspor('pdf'); }}>PDF</MenuItem>
                </>}
              </Menu>
            )}
            {showTemplates && (
              <button type="button" disabled={!kid} onClick={() => setModal('templates')} className={ACTION_BTN_SECONDARY}><FileText size={13} /> Templates</button>
            )}
            {showCreate && (
              <Menu width="w-72" button={() => (
                <button type="button" disabled={!kid} className={ACTION_BTN_PRIMARY}><Plus size={13} /> Create Transaction <ChevronDown size={12} /></button>
              )}>
                {close => <>
                  {(templates.length ? templates : []).map(t => (
                    <MenuItem strong key={t.id} href={createHref(t.type_key, t.id)} onClick={close}>
                      <MonoTypeIcon type={t.type_key} /> <span className="flex-1">{t.name}</span>{!t.is_system && <span className="text-[10px] text-neutral-600">Custom</span>}
                    </MenuItem>
                  ))}
                  {!templates.length && <p className="px-3 py-2 text-xs text-neutral-600">Loading templates...</p>}
                </>}
              </Menu>
            )}
        </div>}
        </div>
        {!kid && <div className="flex items-center gap-2 rounded-[10px] border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-800"><AlertTriangle size={15} className="shrink-0 text-neutral-600" /><span>Select a client first (Switch Company in the top bar).</span></div>}
        {ctx?.error && <div className="flex items-center gap-2 rounded-[10px] border border-neutral-800 bg-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-900"><XCircle size={15} className="shrink-0" /><span>{ctx.error}</span></div>}
        {ctx && tab === 'overview' && <OverviewTab {...ctx} onTemplates={() => setModal('templates')} />}
        {ctx && tab === 'categories' && <CategoriesTab {...ctx} />}
        {ctx && tab === 'review' && <ReviewTab {...ctx} />}
        {ctx && tab === 'preview' && <PreviewTab {...ctx} />}
        {ctx && tab === 'exceptions' && <ExceptionsTab {...ctx} />}
        {ctx && tab === 'posted' && <PostedTab {...ctx} />}
      </div>
      {kid && <TransactionDrawer clientId={kid} txId={buka} canPost={!!meta.data?.can_post} onClose={() => setBuka(null)} />}
      {kid && modal === 'templates' && meta.data && <TemplatesModal clientId={kid} meta={meta.data} onClose={() => setModal(null)} />}
      {kid && modal === 'import' && meta.data && <OtherImportModal clientId={kid} meta={meta.data} onClose={() => setModal(null)} />}
    </div>
  );
}

// ============================================================
// TABEL TRANSAKSI (dipakai beberapa tab)
// ============================================================

function TxTable({ rows, loading, open, empty, select, extra }: {
  rows: OtherTx[]; loading?: boolean; open: (id: string) => void; empty: string;
  select?: { ids: Set<string>; toggle: (id: string) => void; all: () => void };
  extra?: (t: OtherTx) => React.ReactNode;
}) {
  const cols = 8 + (select ? 1 : 0) + (extra ? 1 : 0);
  return (
    <div className="overflow-x-auto rounded-b-[10px]">
      <table className="w-full min-w-[900px] select-text border-separate border-spacing-0 text-sm">
        <thead><tr className="bg-neutral-300 text-left text-xs">
          {select && <th className="w-8 border-b border-t border-neutral-800 px-3 py-2"><input type="checkbox" checked={!!rows.length && rows.every(r => select.ids.has(r.id))} onChange={select.all} /></th>}
          <th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Transaction ID</th><th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Date</th>
          <th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Type</th><th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Counterparty</th>
          <th className="px-3 py-2 text-right font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Amount</th><th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Status</th>
          <th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Journal Result</th>
          {extra && <th className="px-3 py-2 font-bold text-black border-t border-b border-neutral-800 whitespace-nowrap">Notes</th>}
          <th className="border-b border-t border-neutral-800 px-3 py-2" />
        </tr></thead>
        <tbody>
          {!rows.length ? <EmptyRow cols={cols} text={empty} loading={loading} /> : rows.map(t => (
            <tr key={t.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
              {select && <td className="px-3 py-2.5"><input type="checkbox" checked={select.ids.has(t.id)} onChange={() => select.toggle(t.id)} /></td>}
              <td className={`${tdCls} whitespace-nowrap font-mono text-xs`}><button type="button" onClick={() => open(t.id)} className="whitespace-nowrap font-semibold text-neutral-900 underline-offset-2 hover:underline">{t.journal_no}</button></td>
              <td className={`${tdCls} whitespace-nowrap text-xs`}>{fmtDate(t.journal_date)}</td>
              <td className={`${tdCls} whitespace-nowrap`}><span className="flex items-center gap-2"><MonoTypeIcon type={t.type_key} /><span className="whitespace-nowrap text-xs"><b className="font-semibold text-neutral-900">{t.type_name}</b><span className="block whitespace-nowrap text-neutral-600">{t.subtype_label}</span></span></span></td>
              <td className={`${tdCls} whitespace-nowrap text-xs`}>{t.counterparty || '—'}</td>
              <td className={`${tdCls} whitespace-nowrap text-right text-xs font-medium`}>{rupiah(t.amount_idr)}</td>
              <td className={tdCls}><StatusPill s={t.status} /></td>
              <td className={`${tdCls} whitespace-nowrap text-xs`}>{['posted', 'reversed'].includes(t.status)
                ? <span className="inline-flex items-center gap-1 font-mono"><FileText size={13} className="text-neutral-600" />{t.journal_no}</span>
                : <span className="text-neutral-600">—</span>}</td>
              {extra && <td className={`${tdCls} text-xs`}>{extra(t)}</td>}
              <td className={`${tdCls} text-right`}>
                <span className="inline-flex gap-1">
                  {EDITABLE.includes(t.status) && t.source !== 'legacy' && <Link href={editHref(t.id)} className={btnSmall}>Edit</Link>}
                  <button type="button" onClick={() => open(t.id)} className={btnSmall}><Eye size={13} /></button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useSelect(rows: OtherTx[]) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const aktif = new Set([...ids].filter(i => rows.some(r => r.id === i)));
  return {
    ids: aktif,
    toggle: (id: string) => setIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    all: () => setIds(aktif.size === rows.length ? new Set() : new Set(rows.map(r => r.id))),
    clear: () => setIds(new Set()),
  };
}

// Dropdown kustom (menggantikan <select> bawaan browser): tampilan sama di semua browser, bergaya monokrom.
function FilterSelect<T extends string>({ value, onChange, options, className = '' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const aktif = options.find(o => o.value === value) ?? options[0];
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-neutral-900 transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500'}`}>
        <span className="truncate">{aktif?.label}</span>
        <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-72 w-max min-w-full overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          {options.map(o => {
            const dipilih = o.value === value;
            return (
              <button key={o.value} type="button" role="option" aria-selected={dipilih} onClick={() => { onChange(o.value); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-4 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-100 ${dipilih ? 'bg-neutral-50 font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}>
                {o.label}
                {dipilih && <Check size={14} className="shrink-0 text-neutral-900" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Filters({ q, setQ, type, setType, status, setStatus, statuses }: {
  q: string; setQ: (v: string) => void; type: '' | TypeKey; setType: (v: '' | TypeKey) => void;
  status?: '' | TxStatus; setStatus?: (v: '' | TxStatus) => void; statuses?: TxStatus[];
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-neutral-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <SearchBox value={q} onChange={setQ} placeholder="Search transactions, counterparty, or reference..." className="w-full sm:w-[420px]" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <FilterSelect<'' | TypeKey> value={type} onChange={setType} className="sm:w-56"
          options={[{ value: '', label: 'All types' }, ...TYPE_ORDER.map(k => ({ value: k as '' | TypeKey, label: TYPE_UI[k].title }))]} />
        {setStatus && statuses && (
          <FilterSelect<'' | TxStatus> value={status ?? ''} onChange={setStatus} className="sm:w-44"
            options={[{ value: '', label: 'All statuses' }, ...statuses.map(s => ({ value: s as '' | TxStatus, label: s === 'pending_review' ? 'Under Review' : s[0].toUpperCase() + s.slice(1) }))]} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// OVERVIEW
// ============================================================

// Komponen elegan monokrom (disamakan dengan panel/KPI di Sales) untuk tab Overview.
const SHADES = ['#2563EB', '#0D9488', '#F59E0B', '#7C3AED', '#0EA5E9', '#EA580C', '#CBD5E1'];

function EPanel({ title, subtitle, action, className = '', children }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col rounded-[10px] border border-neutral-200 bg-white ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-medium text-neutral-700">{subtitle}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function EKpiTile({ label, value, pct, note, icon: Icon, loading, onClick, active, title }: {
  label: string; value: string; pct: number; note: React.ReactNode; icon: React.ElementType; loading?: boolean;
  onClick?: () => void; active?: boolean; title?: string;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  const interactive = !!onClick;
  const cls = `relative block w-full overflow-hidden rounded-[10px] border bg-white p-4 pt-5 text-left shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700 ${active ? 'border-neutral-700 ring-1 ring-neutral-700' : 'border-neutral-300'} ${interactive ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700' : ''}`;
  const body = (
    <>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-700" title={label}>{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${active ? 'bg-blue-600' : 'bg-blue-50'}`}><Icon size={16} className={active ? 'text-white' : 'text-blue-600'} /></span>
      </div>
      {loading ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-neutral-100" /> : <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="mt-1 truncate text-[11px] font-semibold text-neutral-700">{note}</p>
    </>
  );
  return interactive
    ? <button type="button" onClick={onClick} aria-pressed={!!active} title={title} className={cls}>{body}</button>
    : <div className={cls}>{body}</div>;
}

const E_CONTROL = 'rounded-[6px] border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300';
const E_LINK = 'inline-flex items-center gap-1 text-xs font-semibold text-neutral-800 transition-colors hover:text-neutral-900 hover:underline';
const E_CHEVRON = 'flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900';

const PIPELINE = [
  ['Select Type', 'Choose transaction template'], ['Enter Details', 'Fill in transaction information'],
  ['Review Rules', 'System applies accounting rules'], ['Approval', 'Send for approval (if required)'], ['Post to GL', 'Generate and post journal entry'],
];

function OverviewTab({ clientId, meta, open, onTemplates }: Ctx & { onTemplates: () => void }) {
  const [months, setMonths] = useState(6);
  const ov = useOtherTxData<Overview | null>(`otov:${clientId}:${months}`, s => fetchOverview(clientId, months, s), null);
  const d = ov.data;
  const templates = (d?.templates ?? meta?.templates ?? []).filter(t => t.is_active);
  return (
    <div className="space-y-5">
      {/* Quick Create -- panel & kartu bergaya elegan monokrom (sama dengan panel di Sales). */}
      <section className="overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-neutral-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">Quick Create by Transaction Type</h2>
            <p className="mt-0.5 text-xs font-medium text-neutral-700">Choose a business event template to get started. Each template comes with predefined rules and account mappings.</p>
          </div>
          <button type="button" onClick={onTemplates} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-neutral-800 transition-colors hover:text-neutral-900 hover:underline">View all templates <ArrowRight size={13} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {(templates.length ? templates.filter(t => t.is_system) : []).map(t => {
            const Ikon = (TYPE_UI[t.type_key] ?? TYPE_UI.other_event).icon;
            return (
              <Link key={t.id} href={createHref(t.type_key, t.id)} className="group flex flex-col rounded-[10px] border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400 hover:bg-neutral-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 transition-colors group-hover:bg-white group-hover:text-neutral-900"><Ikon size={17} strokeWidth={1.5} /></span>
                <p className="mt-3 text-sm font-semibold tracking-tight text-neutral-900">{t.name}</p>
                <p className="mt-0.5 text-xs font-medium text-neutral-600">{t.description}</p>
              </Link>
            );
          })}
          {!templates.length && [0, 1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 animate-pulse rounded-[10px] bg-neutral-100" />)}
        </div>
      </section>

      <EPanel title="Transaction Pipeline" subtitle="From business event to automated journal entry.">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          {PIPELINE.map(([t, st], i) => (
            <React.Fragment key={t}>
              <div className="flex flex-1 items-start gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${i === 0 ? 'border-blue-600 bg-blue-600 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}>{i + 1}</span>
                <div><p className="text-sm font-semibold tracking-tight text-neutral-900">{t}</p><p className="text-xs font-medium text-neutral-600">{st}</p></div>
              </div>
              {i < PIPELINE.length - 1 && <ArrowRight size={16} className="hidden shrink-0 text-neutral-400 lg:block" />}
            </React.Fragment>
          ))}
        </div>
      </EPanel>

      {(() => {
        const total = d?.kpi.total ?? 0;
        const share = (n?: number) => (total > 0 ? ((n ?? 0) / total) * 100 : 0);
        const loadingKpi = ov.loading && !d;
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <EKpiTile loading={loadingKpi} label="Total Transactions" value={String(total)} pct={total > 0 ? 100 : 0} icon={LayoutGrid} note={`${d?.kpi.draft ?? 0} draft`} />
            <EKpiTile loading={loadingKpi} label="Under Review" value={String(d?.kpi.pending_review ?? 0)} pct={share(d?.kpi.pending_review)} icon={Clock} note="Waiting for approval" />
            <EKpiTile loading={loadingKpi} label="Ready to Post" value={String(d?.kpi.approved ?? 0)} pct={share(d?.kpi.approved)} icon={CheckCircle2} note="Approved, not posted yet" />
            <EKpiTile loading={loadingKpi} label="Posted" value={String(d?.kpi.posted ?? 0)} pct={share(d?.kpi.posted)} icon={CircleCheck} note={rupiah(d?.kpi.posted_amount)} />
            <EKpiTile loading={loadingKpi} label="Exceptions" value={String(d?.kpi.exceptions ?? 0)} pct={share(d?.kpi.exceptions)} icon={AlertTriangle} note="Need attention before posting" />
          </div>
        );
      })()}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <EPanel className="xl:col-span-3" title="Recent Other Transactions"
          action={<Link href="/transactions/other?tab=posted" className={E_LINK}>View all <ArrowRight size={13} /></Link>}>
          <TxTable rows={d?.recent ?? []} loading={ov.loading && !d} open={open} empty="No other transactions yet. Pick a template above to create one." />
        </EPanel>
        <div className="space-y-5 xl:col-span-2">
          <EPanel title="Other Transactions by Month" action={
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className={E_CONTROL}>
              <option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
            </select>
          }>
            <div className="h-60 px-3 py-4">
              {!d?.trend.some(t => t.count) ? <p className="flex h-full items-center justify-center text-sm font-medium text-neutral-600">No transactions in this period.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.trend} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={m => fmtMonth(String(m))} tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="n" allowDecimals={false} tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} width={28} />
                    <YAxis yAxisId="rp" orientation="right" tickFormatter={v => rupiahShort(Number(v))} tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip formatter={(v: number, n: string) => (n === 'Total Amount (Rp)' ? rupiah(v) : v)} labelFormatter={m => fmtMonth(String(m))} contentStyle={{ borderRadius: 8, border: '1px solid #D4D4D4', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#404040' }} />
                    <Bar yAxisId="n" dataKey="count" name="Number of Transactions" fill="#93C5FD" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="rp" type="monotone" dataKey="amount" name="Total Amount (Rp)" stroke="#2563EB" strokeWidth={2} dot={false} activeDot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </EPanel>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <EPanel title="Rule Mapping Summary" action={<button type="button" onClick={onTemplates} className={E_CHEVRON} aria-label="Open templates"><ChevronRight size={16} /></button>}>
              <dl className="space-y-2 p-4 text-xs">
                {[['Active Rules', d?.rules.active_rules], ['Transaction Templates', d?.rules.templates], ['Auto-Post Enabled', d?.rules.auto_post],
                  ['Requires Approval', d?.rules.requires_approval]].map(([l, v]) => (
                  <div key={String(l)} className="flex justify-between"><dt className="font-medium text-neutral-700">{l}</dt><dd className="font-semibold tabular-nums text-neutral-900">{v ?? 0}</dd></div>
                ))}
                {!!d?.rules.incomplete && (
                  <p className="flex items-start gap-2 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium text-neutral-800">
                    <AlertTriangle size={13} className="mt-px shrink-0 text-neutral-600" />{d.rules.incomplete} rule(s) have no default account yet.
                  </p>
                )}
              </dl>
            </EPanel>
            <EPanel title="Top Categories" action={<Link href="/transactions/other?tab=categories" className={E_CHEVRON} aria-label="Open categories"><ChevronRight size={16} /></Link>}>
              <ul className="space-y-2 p-4 text-xs">
                {!d?.top_categories.length && <li className="font-medium text-neutral-600">No data yet.</li>}
                {d?.top_categories.map((c, i) => (
                  <li key={c.type_key} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: SHADES[i % SHADES.length] }} />
                    <span className="flex-1 truncate font-medium text-neutral-800">{c.type_name}</span><b className="tabular-nums text-neutral-900">{c.count}</b><span className="w-10 text-right font-medium tabular-nums text-neutral-600">{c.share}%</span>
                  </li>
                ))}
              </ul>
            </EPanel>
          </div>
          <EPanel title="Pending Review" action={<Link href="/transactions/other?tab=review" className={E_CHEVRON} aria-label="Open review queue"><ChevronRight size={16} /></Link>}>
            <ul className="divide-y divide-neutral-200 px-4 py-1 text-xs">
              {!d?.pending.length && <li className="py-3 font-medium text-neutral-600">Nothing is waiting for review.</li>}
              {d?.pending.map(t => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <MonoTypeIcon type={t.type_key} />
                  <button type="button" onClick={() => open(t.id)} className="flex-1 truncate text-left text-neutral-700"><b className="font-mono font-semibold text-neutral-900">{t.journal_no}</b> · {t.counterparty || t.type_name}</button>
                  <span className="font-semibold tabular-nums text-neutral-900">{rupiah(t.amount_idr)}</span>
                </li>
              ))}
            </ul>
          </EPanel>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CATEGORIES
// ============================================================

function CategoriesTab({ clientId, txs, loading, open }: Ctx) {
  const cat = useOtherTxData<CategoryStat[]>(`otcat:${clientId}`, s => fetchCategories(clientId, s), []);
  const [type, setType] = useState<'' | TypeKey>('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const rows = txs.filter(t => (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(cat.data.length ? cat.data : []).map(c => {
          const aktif = type === c.type_key;
          const stat = (label: string, n: number) => (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 py-2">
              <p className="text-sm font-semibold tabular-nums tracking-tight text-neutral-900">{n}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{label}</p>
            </div>
          );
          return (
            <div key={c.type_key} className={`flex flex-col overflow-hidden rounded-[10px] border bg-white transition-[border-color,box-shadow] duration-200 ${aktif ? 'border-neutral-800 ring-1 ring-neutral-800' : 'border-neutral-200 hover:border-neutral-400'}`}>
              <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3">
                <MonoTypeIcon type={c.type_key} size="md" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold tracking-tight text-neutral-900">{c.name}</h3>
                  <p className="mt-0.5 text-xs font-medium text-neutral-600">{c.description}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {stat('Total', c.count)}{stat('Posted', c.posted)}{stat('In Progress', c.in_progress)}
                </div>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {c.subtypes.map(s => (
                    <li key={s.subtype} className="flex justify-between gap-2">
                      <span className="truncate font-medium text-neutral-700">{s.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{s.count} · {rupiahShort(s.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-neutral-200 pt-3 text-[11px] font-medium text-neutral-600">
                  Posted value <b className="font-semibold text-neutral-900">{rupiah(c.posted_amount)}</b>{c.last_date ? ` · last ${fmtDate(c.last_date)}` : ''}
                </p>
                <div className="mt-auto flex gap-2 pt-3">
                  <Link href={createHref(c.type_key, c.templates.find(t => t.is_system)?.id)} className={`${ACTION_BTN_BASE} border border-neutral-300 bg-neutral-100 text-neutral-800 hover:border-neutral-500 hover:bg-neutral-200`}><Plus size={13} /> Create</Link>
                  <button type="button" onClick={() => setType(aktif ? '' : c.type_key)} className={ACTION_BTN_SECONDARY}>{aktif ? 'Show all' : 'View transactions'}</button>
                </div>
              </div>
            </div>
          );
        })}
        {!cat.data.length && [0, 1, 2, 3].map(i => <div key={i} className="h-64 animate-pulse rounded-[10px] bg-neutral-100" />)}
      </div>
      <EPanel title={type ? `${TYPE_UI[type].title} Transactions` : 'All Other Transactions'} subtitle={`${rows.length} transaction(s)`}>
        <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus}
          statuses={['draft', 'pending_review', 'approved', 'rejected', 'posted', 'reversed']} />
        <TxTable rows={rows} loading={loading} open={open} empty="No transactions match the filter." />
      </EPanel>
    </div>
  );
}

// ============================================================
// REVIEW QUEUE
// ============================================================

function ReviewTab({ clientId, meta, txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [alasan, setAlasan] = useState<string | null>(null);
  const filt = (t: OtherTx) => (!type || t.type_key === type) && cocok(t, q);
  const antre = txs.filter(t => t.status === 'pending_review' && filt(t));
  const siap = txs.filter(t => t.status === 'approved' && filt(t));
  const sel = useSelect(antre);
  const selPost = useSelect(siap);
  const jalan = async (label: string, fn: () => Promise<boolean>, clear: () => void) => {
    setBusy(label);
    if (await fn()) clear();
    setBusy(null);
  };
  const hari = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
  return (
    <div className="space-y-5">
      <EPanel title="Waiting for Review" subtitle="Transactions submitted for approval. Approve to make them ready for posting, or reject with a reason."
        action={<>
          <button type="button" disabled={!sel.ids.size || !!busy} onClick={() => setAlasan('')} className={`${btnOutline} text-neutral-900`}>Reject</button>
          <button type="button" disabled={!sel.ids.size || !!busy} onClick={() => jalan('approve', () => runBulk(clientId, 'approve', [...sel.ids]), sel.clear)} className={btnPrimary}>
            {busy === 'approve' && <Loader2 size={14} className="animate-spin" />} Approve {sel.ids.size ? `(${sel.ids.size})` : ''}
          </button>
        </>}>
        <Filters q={q} setQ={setQ} type={type} setType={setType} />
        <TxTable rows={antre} loading={loading} open={open} empty="Nothing is waiting for review." select={sel}
          extra={t => {
            const n = hari(t.submitted_at);
            return <span className={t.has_error ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>
              {t.has_error ? t.issues.find(i => i.level === 'error')?.message : `By ${t.submitted_by_name ?? '—'}${n !== null ? ` · ${n} day(s) ago` : ''}`}
            </span>;
          }} />
      </EPanel>
      <EPanel title="Approved — Ready to Post" subtitle={meta?.can_post ? 'Post approved transactions to the General Ledger.' : 'Posting requires Manager level or above.'}
        action={meta?.can_post && (
          <button type="button" disabled={!selPost.ids.size || !!busy} onClick={() => jalan('post', () => runBulk(clientId, 'post', [...selPost.ids]), selPost.clear)} className={btnPrimary}>
            {busy === 'post' && <Loader2 size={14} className="animate-spin" />} Post to GL {selPost.ids.size ? `(${selPost.ids.size})` : ''}
          </button>
        )}>
        <TxTable rows={siap} loading={loading} open={open} empty="No approved transactions waiting to be posted." select={meta?.can_post ? selPost : undefined}
          extra={t => <span className="text-neutral-600">Approved by {t.approved_by_name ?? '—'}</span>} />
      </EPanel>
      {alasan !== null && (
        <RejectModal count={sel.ids.size} onClose={() => setAlasan(null)}
          onConfirm={async r => { await jalan('reject', () => runBulk(clientId, 'reject', [...sel.ids], r), sel.clear); setAlasan(null); }} />
      )}
    </div>
  );
}

function RejectModal({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [r, setR] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[10px] border border-neutral-200 bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold tracking-tight text-neutral-900">Reject {count} transaction(s)</h3>
        <p className="mt-1 text-xs text-neutral-600">The submitter can edit and resubmit after rejection.</p>
        <textarea value={r} onChange={e => setR(e.target.value)} rows={3} maxLength={2000} placeholder="Reason" className={`${inputCls} mt-4`} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" disabled={busy || r.trim().length < 3} onClick={async () => { setBusy(true); await onConfirm(r.trim()); setBusy(false); }}
            className={ACTION_BTN_PRIMARY}>
            {busy && <Loader2 size={14} className="animate-spin" />} Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// JOURNAL PREVIEW
// ============================================================

function PreviewTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const belum = txs.filter(t => !['posted', 'reversed'].includes(t.status));
  const rows = belum.filter(t => (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  const isBalanced = (t: OtherTx) => t.lines.length > 0 && t.total_debit === t.total_credit;
  const seimbang = rows.filter(isBalanced).length;
  const nBelum = belum.length;
  const nSeimbangSemua = belum.filter(isBalanced).length;
  const nTidak = nBelum - nSeimbangSemua;
  const totalDebit = belum.reduce((n, t) => n + t.total_debit, 0);
  const pctOf = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EKpiTile loading={loading} label="Unposted Journals" value={String(nBelum)} pct={nBelum > 0 ? 100 : 0} icon={FileText} note="Generated from template rules" />
        <EKpiTile loading={loading} label="Balanced" value={String(nSeimbangSemua)} pct={pctOf(nSeimbangSemua, nBelum)} icon={CheckCircle2} note="Debit equals credit" />
        <EKpiTile loading={loading} label="Not Balanced" value={String(nTidak)} pct={pctOf(nTidak, nBelum)} icon={AlertTriangle} note="Fix before submitting" />
        <EKpiTile loading={loading} label="Total Debit" value={rupiah(totalDebit)} pct={nBelum > 0 ? 100 : 0} icon={LayoutGrid} note="All unposted journals" />
      </div>
      <EPanel title="Journal Preview" subtitle={`Journals generated from the template rules for transactions not posted yet — ${seimbang} of ${rows.length} balanced.`}>
        <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus} statuses={['draft', 'pending_review', 'approved', 'rejected']} />
        <div className="grid grid-cols-1 gap-4 bg-neutral-50/60 p-4 lg:grid-cols-2">
          {loading && [0, 1].map(i => <div key={i} className="h-48 animate-pulse rounded-[10px] border border-neutral-200 bg-neutral-100" />)}
          {!loading && !rows.length && <p className="col-span-full py-10 text-center text-sm font-medium text-neutral-500">No unposted transactions.</p>}
          {rows.map(t => {
            const ok = isBalanced(t);
            const err = t.issues.find(i => i.level === 'error');
            return (
              <article key={t.id} className="relative flex flex-col overflow-hidden rounded-[10px] border border-neutral-300 bg-white shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
                <span className={`absolute inset-x-0 top-0 h-0.5 ${ok ? 'bg-teal-600' : 'bg-amber-500'}`} />
                <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-5">
                  <button type="button" onClick={() => open(t.id)} className="flex min-w-0 items-center gap-3 text-left">
                    <MonoTypeIcon type={t.type_key} size="md" />
                    <span className="min-w-0 text-xs">
                      <b className="block font-mono text-sm font-semibold tracking-tight text-neutral-900">{t.journal_no}</b>
                      <span className="mt-0.5 block font-medium text-neutral-600">{t.subtype_label} · {fmtDate(t.journal_date)} · {t.counterparty || '—'}</span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusPill s={t.status} />
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                      {ok ? <Check size={11} strokeWidth={2.5} /> : <AlertTriangle size={11} />}{ok ? 'Balanced' : 'Not balanced'}
                    </span>
                  </span>
                </header>
                <div className="flex-1 overflow-x-auto">
                  {t.lines.length
                    ? <PreviewLines lines={t.lines} />
                    : <p className="border-t border-neutral-200 px-4 py-4 text-xs font-medium text-neutral-500">No journal lines yet — complete the accounts.</p>}
                </div>
                {err && (
                  <p className="flex items-start gap-1.5 border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-[11px] font-semibold text-neutral-800">
                    <AlertTriangle size={12} className="mt-px shrink-0 text-neutral-600" />{err.message}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </EPanel>
    </div>
  );
}

function ExceptionsTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [level, setLevel] = useState<'' | 'error' | 'warning'>('');
  const rows = useMemo(() => txs.filter(t => !['posted', 'reversed'].includes(t.status) && t.issues.length
    && (!level || t.issues.some(i => i.level === level)) && (!type || t.type_key === type) && cocok(t, q)), [txs, level, type, q]);
  const nErr = txs.filter(t => !['posted', 'reversed'].includes(t.status) && t.has_error).length;
  const nWarn = txs.filter(t => !['posted', 'reversed'].includes(t.status) && !t.has_error && t.issues.length).length;
  return (
    <div className="space-y-5">
      {(() => {
        const nUnposted = txs.filter(t => !['posted', 'reversed'].includes(t.status)).length;
        const pctOf = (n: number) => (nUnposted > 0 ? (n / nUnposted) * 100 : 0);
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EKpiTile loading={loading} label="Blocking Errors" value={String(nErr)} pct={pctOf(nErr)} icon={XCircle}
              active={level === 'error'} onClick={() => setLevel(level === 'error' ? '' : 'error')} title="Click to filter blocking errors"
              note="Cannot be submitted, approved or posted until fixed" />
            <EKpiTile loading={loading} label="Warnings Only" value={String(nWarn)} pct={pctOf(nWarn)} icon={AlertTriangle}
              active={level === 'warning'} onClick={() => setLevel(level === 'warning' ? '' : 'warning')} title="Click to filter warnings"
              note="Can be posted, but should be reviewed" />
          </div>
        );
      })()}
      <EPanel title="Exceptions" subtitle="Unposted transactions with findings: missing accounts, closed periods, inactive or unmapped accounts, overdue reviews.">
        <Filters q={q} setQ={setQ} type={type} setType={setType} />
        <TxTable rows={rows} loading={loading} open={open} empty="No exceptions. All unposted transactions passed the checks."
          extra={t => (
            <ul className="space-y-0.5">
              {t.issues.slice(0, 3).map(i => (
                <li key={i.message} className={`flex items-start gap-1.5 ${i.level === 'error' ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-600'}`}>
                  {i.level === 'error' ? <XCircle size={12} className="mt-px shrink-0" /> : <AlertTriangle size={12} className="mt-px shrink-0 text-neutral-500" />}{i.message}
                </li>
              ))}
              {t.issues.length > 3 && <li className="text-neutral-600">+{t.issues.length - 3} more</li>}
            </ul>
          )} />
      </EPanel>
    </div>
  );
}

// ============================================================
// POSTED
// ============================================================

function PostedTab({ txs, loading, open }: Ctx) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | TypeKey>('');
  const [status, setStatus] = useState<'' | TxStatus>('');
  const semua = txs.filter(t => ['posted', 'reversed'].includes(t.status));
  const rows = semua.filter(t => (!type || t.type_key === type) && (!status || t.status === status) && cocok(t, q));
  const posted = semua.filter(t => t.status === 'posted');
  const total = posted.reduce((n, t) => n + t.amount_idr, 0);
  const bulanIni = todayIso().slice(0, 7);
  return (
    <div className="space-y-5">
      {(() => {
        const pctOf = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);
        const bulanIniN = posted.filter(t => t.journal_date.startsWith(bulanIni)).length;
        const reversed = semua.length - posted.length;
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <EKpiTile loading={loading} label="Posted Transactions" value={String(posted.length)} pct={pctOf(posted.length, semua.length)} icon={CircleCheck} note="In the General Ledger" />
            <EKpiTile loading={loading} label="Posted Value" value={rupiah(total)} pct={total > 0 ? 100 : 0} icon={FileText} note="All posted transactions" />
            <EKpiTile loading={loading} label="Posted This Month" value={String(bulanIniN)} pct={pctOf(bulanIniN, posted.length)} icon={Clock} note={fmtMonth(bulanIni)} />
            <EKpiTile loading={loading} label="Reversed" value={String(reversed)} pct={pctOf(reversed, semua.length)} icon={AlertTriangle} note="Reversing journal RV- posted" />
          </div>
        );
      })()}
      <EPanel title="Posted Transactions" subtitle="Other transactions posted to the General Ledger (source: Other).">
        <Filters q={q} setQ={setQ} type={type} setType={setType} status={status} setStatus={setStatus} statuses={['posted', 'reversed']} />
        <TxTable rows={rows} loading={loading} open={open} empty="No posted transactions yet."
          extra={t => <span className="text-neutral-600">{t.status === 'reversed' ? `Reversed ${fmtDate(t.reversal_date)}` : `By ${t.posted_by_name ?? '—'}`}</span>} />
      </EPanel>
    </div>
  );
}