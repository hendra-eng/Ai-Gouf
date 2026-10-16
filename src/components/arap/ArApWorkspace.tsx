'use client';

// Halaman utama Accounts Receivable / Accounts Payable (layout mengikuti
// dataset/picture/Template UI/Account Receivable/1.jpeg): header + tombol
// Create Invoice / Record Receipt / Export, 5 KPI, lalu tab Overview,
// Invoices, Aging, Collections, Customer Statements, Posted. AP memakai
// komponen yang sama (side="ap": Bills, Payments, Vendor Statements).
// Backend: modules/finance/receivables_payables_v1.py.

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDown, ArrowUp, CalendarDays, CheckCheck, ChevronDown, Clock, CreditCard, Download, FileSpreadsheet, FileText, Handshake,
  History, LayoutDashboard, ListChecks, Plus, ReceiptText, RefreshCcw, Timer, TrendingUp, UserRound, Users, Wallet,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  fetchArApAging, fetchArApDocs, fetchArApOverview, fetchCollections, fetchSettlements, pctChange, rupiah, SIDE_CONFIG, todayIso, useArApData,
  type ArApDoc, type ArApOverview, type ArApSide, type CollectionsReport, type Settlement,
} from '@/lib/receivablesPayablesStore';
import { downloadAgingXlsx, downloadDocsCsv, downloadDocsXlsx } from './arapExport';
import { btnOutline, btnPrimary, Menu, MenuItem } from './arapUi';
import { tabBadgeCls, tabBarCls, tabCls, tabListCls } from '@/components/shared/moduleUi';
import OverviewTab from './OverviewTab';
import InvoicesTab from './InvoicesTab';
import AgingTab from './AgingTab';
import SettlementsTab from './SettlementsTab';
import StatementsTab from './StatementsTab';
import CollectionsTab from './CollectionsTab';

export type TabId = 'overview' | 'invoices' | 'aging' | 'settlements' | 'statements' | 'posted';

export default function ArApWorkspace({ side }: { side: ArApSide }) {
  const cfg = SIDE_CONFIG[side];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;

  const tab = (params.get('tab') as TabId) || 'overview';
  const [asOf, setAsOf] = useState(params.get('as_of') || todayIso());
  const [trendMonths, setTrendMonths] = useState(6);

  const setTab = useCallback((t: TabId, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    if (t !== 'overview') q.set('tab', t);
    if (asOf !== todayIso()) q.set('as_of', asOf);
    Object.entries(extra).forEach(([k, v]) => q.set(k, v));
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [asOf, pathname, router]);

  const overview = useArApData<ArApOverview | null>(
    kid ? `ov:${side}:${kid}:${asOf}:${trendMonths}` : null, s => fetchArApOverview(side, kid!, asOf, trendMonths, s), null,
  );
  const docs = useArApData<ArApDoc[]>(kid ? `docs:${side}:${kid}:${asOf}` : null, s => fetchArApDocs(side, kid!, { as_of: asOf }, s), []);
  const settlements = useArApData<Settlement[]>(kid ? `st:${side}:${kid}` : null, s => fetchSettlements(side, kid!, undefined, s), []);
  // Tab Collections (AR): performa penagihan per bulan + antrean follow-up.
  const [colMonth, setColMonth] = useState(asOf.slice(0, 7));
  React.useEffect(() => setColMonth(asOf.slice(0, 7)), [asOf]);
  const tabCollections = side === 'ar' && tab === 'settlements';
  const collections = useArApData<CollectionsReport | null>(
    kid && tabCollections ? `col:${kid}:${asOf}:${colMonth}` : null, s => fetchCollections(kid!, { as_of: asOf, month: colMonth }, s), null,
  );

  const refreshAll = () => { overview.refresh(); docs.refresh(); settlements.refresh(); collections.refresh(); };
  const error = overview.error || docs.error;
  const settlePath = `${cfg.basePath}/${side === 'ar' ? 'receipts' : 'payments'}/new`;
  const pending = (overview.data?.pending.draft?.count ?? 0) + (overview.data?.pending.approved?.count ?? 0);

  const tabs: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'invoices', label: cfg.docs, icon: FileText },
    { id: 'aging', label: 'Aging', icon: Clock },
    { id: 'settlements', label: cfg.settlementsTab, icon: TrendingUp, badge: pending || undefined },
    { id: 'statements', label: `${cfg.party} Statements`, icon: ReceiptText },
    { id: 'posted', label: 'Posted', icon: CheckCheck },
  ];

  const ekspor = async (jenis: 'docs-xlsx' | 'docs-csv' | 'aging-xlsx') => {
    if (!kid) return;
    try {
      if (jenis === 'docs-csv') downloadDocsCsv(cfg, asOf, docs.data);
      else if (jenis === 'docs-xlsx') await downloadDocsXlsx(cfg, activeClientName ?? '', asOf, docs.data);
      else await downloadAgingXlsx(cfg, activeClientName ?? '', await fetchArApAging(side, kid, { as_of: asOf, include_details: true }), true);
    } catch (e) {
      toast.error((e as Error).message || 'Export failed.');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{cfg.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{cfg.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={cfg.createDocHref} className={btnPrimary}><Plus size={16} /> {cfg.createDocLabel}</Link>
            <Link href={settlePath} className={btnOutline}><CreditCard size={16} /> Record {cfg.settle}</Link>
            <Menu width="w-64" button={open => (
              <button type="button" className={btnOutline} disabled={!kid}>
                <Download size={16} /> Export <ChevronDown size={14} className={open ? 'rotate-180 transition' : 'transition'} />
              </button>
            )}>
              {close => (
                <>
                  <MenuItem href={`${cfg.basePath}/export?as_of=${asOf}`} onClick={close}><FileText size={14} /> Aging Report (PDF / Print)</MenuItem>
                  <MenuItem onClick={() => { close(); ekspor('aging-xlsx'); }}><FileSpreadsheet size={14} /> Aging Report (Excel)</MenuItem>
                  <MenuItem onClick={() => { close(); ekspor('docs-xlsx'); }}><FileSpreadsheet size={14} /> {cfg.docs} (Excel)</MenuItem>
                  <MenuItem onClick={() => { close(); ekspor('docs-csv'); }}><Download size={14} /> {cfg.docs} (CSV)</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>

        {!kid && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>}
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={refreshAll} className="font-semibold underline hover:no-underline">Retry</button>
          </div>
        )}

        {tabCollections
          ? <CollectionKpiRow ov={overview.data} col={collections.data} loading={collections.loading && !collections.data} />
          : <KpiRow side={side} ov={overview.data} loading={overview.loading && !overview.data} variant={tab === 'invoices' ? 'invoices' : 'default'} />}

        <div className={tabBarCls}>
          <nav className={tabListCls}>
            {tabs.map(t => {
              const aktif = tab === t.id;
              const Ikon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={tabCls(aktif)}>
                  <Ikon size={16} /> {t.label}
                  {t.badge ? <span className={tabBadgeCls}>{t.badge}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 pb-2 lg:pb-0">
            <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <CalendarDays size={14} /> As of
              <input type="date" value={asOf} max="2999-12-31" onChange={e => e.target.value && setAsOf(e.target.value)}
                className="bg-transparent text-xs font-medium text-foreground focus:outline-none" />
            </label>
            {asOf !== todayIso() && (
              <button type="button" onClick={() => setAsOf(todayIso())} className="text-xs font-medium text-[#0F7D4E] hover:underline">Today</button>
            )}
            <button type="button" onClick={refreshAll} title="Refresh" className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 hover:text-foreground">
              <RefreshCcw size={15} className={overview.loading || docs.loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {kid && tab === 'overview' && (
          <OverviewTab cfg={cfg} clientId={kid} asOf={asOf} ov={overview.data} docs={docs.data} loading={docs.loading && !docs.data.length}
            settlements={settlements.data} trendMonths={trendMonths} onTrendMonths={setTrendMonths} goTab={setTab} />
        )}
        {kid && tab === 'invoices' && (
          <InvoicesTab cfg={cfg} clientId={kid} clientName={activeClientName ?? ''} asOf={asOf} docs={docs.data} loading={docs.loading && !docs.data.length}
            settlements={settlements.data} initialParty={params.get('party') ?? ''} goTab={setTab} />
        )}
        {kid && tab === 'aging' && <AgingTab cfg={cfg} clientId={kid} asOf={asOf} ov={overview.data} goTab={setTab} />}
        {kid && tabCollections && (
          <CollectionsTab cfg={cfg} clientId={kid} asOf={asOf} month={colMonth} onMonth={setColMonth} report={collections.data}
            loading={collections.loading} error={collections.error} docs={docs.data} settlements={settlements.data}
            settlementsLoading={settlements.loading && !settlements.data.length} initialParty={params.get('party') ?? ''} goTab={setTab} />
        )}
        {kid && tab === 'settlements' && side === 'ap' && (
          <SettlementsTab cfg={cfg} clientId={kid} mode="all" data={settlements.data} loading={settlements.loading && !settlements.data.length} />
        )}
        {kid && tab === 'posted' && (
          <SettlementsTab cfg={cfg} clientId={kid} mode="posted" data={settlements.data} loading={settlements.loading && !settlements.data.length} />
        )}
        {kid && tab === 'statements' && (
          <StatementsTab cfg={cfg} clientId={kid} asOf={asOf} initialParty={params.get('party') ?? ''} />
        )}
      </div>
    </div>
  );
}

function Delta({ now, prev, goodWhenDown, unit = 'pct', suffix }: {
  now: number | null; prev: number | null; goodWhenDown: boolean; unit?: 'pct' | 'abs'; suffix: string;
}) {
  if (now === null || prev === null) return <span className="text-[11px] text-muted-foreground">{suffix}</span>;
  const selisih = unit === 'pct' ? pctChange(now, prev) : now - prev;
  if (selisih === null || Math.abs(selisih) < 0.05) {
    return <span className="text-[11px] text-muted-foreground">{suffix.startsWith('vs') ? `No change ${suffix}` : suffix}</span>;
  }
  const naik = selisih > 0;
  const baik = goodWhenDown ? !naik : naik;
  const Ikon = naik ? ArrowUp : ArrowDown;
  const teks = unit === 'pct' ? `${Math.abs(selisih).toFixed(0)}%` : `${Math.abs(selisih).toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${baik ? 'text-emerald-600' : 'text-rose-600'}`}><Ikon size={12} /> {teks}</span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

type Kartu = { label: string; value: string; icon: React.ElementType; tone: string; delta: React.ReactNode; danger?: boolean };

function KartuGrid({ kartu, loading }: { kartu: Kartu[]; loading: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${kartu.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-5'}`}>
      {kartu.map(c => {
        const Ikon = c.icon;
        return (
          <div key={c.label} className={`rounded-2xl border p-4 shadow-sm ${c.danger ? 'border-rose-100 bg-rose-50/40' : 'border-border bg-card'}`}>
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.tone}`}><Ikon size={20} /></span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
                {loading ? <div className="mt-1 h-6 w-28 animate-pulse rounded bg-slate-100" /> : (
                  <p className={`mt-0.5 truncate text-lg font-bold ${c.danger ? 'text-rose-600' : 'text-foreground'}`}>{c.value}</p>
                )}
                <div className="mt-1">{c.delta}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CollectionKpiRow({ ov, col, loading }: { ov: ArApOverview | null; col: CollectionsReport | null; loading: boolean }) {
  const k = ov?.kpi;
  const p = col?.performance;
  const kartu: Kartu[] = [
    {
      label: 'Total Receivables', value: rupiah(k?.total_outstanding), icon: Wallet, tone: 'bg-sky-50 text-sky-600',
      delta: <Delta now={k?.total_outstanding ?? null} prev={k?.total_outstanding_prev ?? null} goodWhenDown suffix="vs last month-end" />,
    },
    {
      label: 'Collected This Month', value: rupiah(p?.collected), icon: History, tone: 'bg-emerald-50 text-emerald-600',
      delta: <Delta now={p?.collected ?? null} prev={p?.collected_prev ?? null} goodWhenDown={false} suffix="vs last month" />,
    },
    {
      label: 'Promise to Pay', value: rupiah(p?.promise_to_pay), icon: Handshake, tone: 'bg-indigo-50 text-indigo-600',
      delta: <span className="text-[11px] text-muted-foreground"><b className="text-sky-700">{p?.promise_count ?? 0} accounts</b> in commitment</span>,
    },
    {
      label: 'High Priority Accounts', value: `${p?.high_priority_count ?? 0} customers`, icon: UserRound, tone: 'bg-rose-50 text-rose-600',
      danger: (p?.high_priority_count ?? 0) > 0,
      delta: <span className="text-[11px] text-muted-foreground">{rupiah(p?.high_priority_amount)} · {(p?.high_priority_pct ?? 0).toFixed(0)}% of receivables</span>,
    },
  ];
  return <KartuGrid kartu={kartu} loading={loading} />;
}

function KpiRow({ side, ov, loading, variant }: { side: ArApSide; ov: ArApOverview | null; loading: boolean; variant: 'default' | 'invoices' }) {
  const cfg = SIDE_CONFIG[side];
  const k = ov?.kpi;
  const kartu: Kartu[] = [
    {
      label: cfg.kpi.total, value: rupiah(k?.total_outstanding), icon: Wallet, tone: 'bg-sky-50 text-sky-600',
      delta: <Delta now={k?.total_outstanding ?? null} prev={k?.total_outstanding_prev ?? null} goodWhenDown suffix="vs last month-end" />,
    },
    {
      label: cfg.kpi.overdue, value: rupiah(k?.overdue), icon: Timer, tone: 'bg-rose-50 text-rose-600', danger: (k?.overdue ?? 0) > 0,
      delta: <Delta now={k?.overdue ?? null} prev={k?.overdue_prev ?? null} goodWhenDown suffix={`${k?.overdue_count ?? 0} ${(k?.overdue_count ?? 0) === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()} overdue`} />,
    },
    variant === 'invoices' ? {
      label: `Open ${cfg.docs} (Not Yet Due)`, value: rupiah((k?.total_outstanding ?? 0) - (k?.overdue ?? 0)), icon: FileText, tone: 'bg-emerald-50 text-emerald-600',
      delta: <span className="text-[11px] text-muted-foreground">{(k?.open_count ?? 0) - (k?.overdue_count ?? 0)} {cfg.docs.toLowerCase()} not yet due</span>,
    } : {
      label: cfg.kpi.month, value: rupiah(k?.collected_month), icon: History, tone: 'bg-emerald-50 text-emerald-600',
      delta: <Delta now={k?.collected_month ?? null} prev={k?.collected_prev_month ?? null} goodWhenDown={false} suffix="vs last month" />,
    },
    {
      label: cfg.kpi.avgDays, value: k?.avg_days_to_settle != null ? `${Math.round(k.avg_days_to_settle)} days` : '—', icon: ListChecks, tone: 'bg-amber-50 text-amber-600',
      delta: <Delta now={k?.avg_days_to_settle ?? null} prev={k?.avg_days_to_settle_prev ?? null} goodWhenDown={side === 'ar'} unit="abs" suffix="vs last month" />,
    },
    {
      label: cfg.kpi.parties, value: String(k?.parties_with_balance ?? 0), icon: Users, tone: 'bg-indigo-50 text-indigo-600',
      delta: <Delta now={k?.parties_with_balance ?? null} prev={k?.parties_with_balance_prev ?? null} goodWhenDown unit="abs" suffix="vs last month-end" />,
    },
  ];
  return <KartuGrid kartu={kartu} loading={loading} />;
}

/** Pembungkus <Suspense> untuk halaman (useSearchParams). */
export function ArApWorkspacePage({ side }: { side: ArApSide }) {
  return (
    <React.Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <ArApWorkspace side={side} />
    </React.Suspense>
  );
}

