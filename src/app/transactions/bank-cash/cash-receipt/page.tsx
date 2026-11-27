'use client';

import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Search, Info, ArrowDownLeft, Landmark, FileText, Calculator, AlertTriangle, Trophy, Layers } from 'lucide-react';
import { formatIDR } from '../lib/formatMoney';
import { useLanguage } from '@/lib/language';
import { formatTanggalSingkat } from '@/lib/salesStore';
import CashBankTabs from '../components/CashBankTabs';
import CashBankTransactionModal, { type BcPreset } from '../components/CashBankTransactionModal';
import { MutasiBankCell, JurnalCell, DalamProsesBadge, PaidNote } from '../components/RekonInfoCells';
import CashReceiptTrendChart from '../components/CashReceiptTrendChart';
import {
  OverviewKpiTile, FilterSelect, BreakdownDonutCard, TopPartyCard,
  pctOf, buildPageItems, NAV_BTN,
} from '../components/salesStyleKit';
import {
  useCashReceiptsFromSales,
  kejadianDiterima,
  rincianPerKategori,
  customerTerbesar,
  type CashReceiptRow,
} from '../lib/useSalesCashReceipts';

// Warna status: sama dengan pill status di tabel Sales Overview (tint -100, teks -800, garis -300).
const STATUS_STYLE: Record<string, { pill: string; dot: string; label: string }> = {
  paid: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600', label: 'Paid' },
  partial: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600', label: 'Partially Paid' },
  unpaid: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500', label: 'Unpaid' },
  overdue: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600', label: 'Overdue' },
};

const NUMERIC_COLS = ['Total', 'Received', 'Outstanding'];
const HEADERS = ['Date', 'Invoice No.', 'Customer', 'Description', 'Type', 'Due Date', 'Total', 'Received', 'Outstanding', 'Bank Line', 'Journal', 'Status', 'Action'];

// Cash Receipt = penerimaan pembayaran dari customer. Sumber data: invoice Sales
// (lihat lib/useSalesCashReceipts.ts) -- TIDAK membaca tabel Cash & Bank lagi.
// Tampilan (KPI, kartu, chart tren, tabel, tombol) disamakan dengan tab Sales > Overview.
export default function CashReceiptPage() {
  const { t } = useLanguage();
  const { rows, loading, error, refresh } = useCashReceiptsFromSales();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [preset, setPreset] = useState<BcPreset | null>(null);

  const totalInvoiced = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);
  const totalReceived = useMemo(() => rows.reduce((s, r) => s + r.received, 0), [rows]);
  const totalOutstanding = useMemo(() => rows.reduce((s, r) => s + r.outstanding, 0), [rows]);
  const txCount = rows.length;
  const avgTxValue = txCount > 0 ? totalInvoiced / txCount : 0;
  const maxInvoice = useMemo(() => rows.reduce((m, r) => Math.max(m, r.total), 0), [rows]);
  const paidCount = useMemo(() => rows.filter(r => r.receiptStatus === 'paid').length, [rows]);
  const overdueRows = useMemo(() => rows.filter(r => r.isOverdue), [rows]);
  const overdueCount = overdueRows.length;
  const overdueTotal = useMemo(() => overdueRows.reduce((s, r) => s + r.outstanding, 0), [overdueRows]);
  const totalDalamProses = useMemo(() => rows.reduce((s, r) => s + r.dalamProses, 0), [rows]);

  const trendEvents = useMemo(() => kejadianDiterima(rows).map(k => ({ date: k.tanggal, amount: k.nominal })), [rows]);
  const byCategory = useMemo(() => rincianPerKategori(rows).slice(0, 6), [rows]);
  const topCustomers = useMemo(() => customerTerbesar(rows, 5), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.receiptStatus !== statusFilter) return false;
      if (!q) return true;
      return [r.invoiceNo, r.customer, r.description].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const kpiLabel = (txt: string) => (
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
      <span className="h-3.5 w-1 rounded-full bg-blue-600" />{txt}
    </p>
  );

  return (
    <div className="space-y-6">
      <CashBankTabs />
      <CashBankTransactionModal open={!!preset} onClose={() => setPreset(null)} preset={preset} onSaved={() => { setPreset(null); refresh(); }} />

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">{t('Failed to load Sales data:')}</span>
          <span>{error}</span>
          <button onClick={refresh} className="ml-auto font-medium underline">{t('Retry')}</button>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-4 py-3 text-xs text-neutral-700">
          <Info size={15} className="mt-px shrink-0 text-neutral-700" />
          <p className="leading-relaxed">
            <span className="font-semibold text-neutral-900">{t('Attention:')}</span>{' '}
            {overdueCount} {t('customer invoices are past due and still unpaid (total receivables across all unpaid invoices:')} {formatIDR(totalOutstanding, true)}).
          </p>
        </div>
      )}

      {/* KPI Cards -- desain sama dengan KPI di Sales Overview */}
      <div>
        {kpiLabel(t('Receipt Performance'))}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <OverviewKpiTile
            label={t('Total Received')} value={formatIDR(totalReceived)} tone="green" icon={ArrowDownLeft}
            sub={totalDalamProses > 0 ? `${formatIDR(totalDalamProses, true)} ${t('in process')}` : undefined}
            pct={pctOf(totalReceived, totalInvoiced)} pctLabel={t('of invoices received')}
          />
          <OverviewKpiTile
            label={t('Unreceived (Receivables)')} value={formatIDR(totalOutstanding)} tone={totalOutstanding > 0 ? 'warn' : 'amber'} icon={Landmark}
            pct={pctOf(totalOutstanding, totalInvoiced)} pctLabel={t('of invoiced amount')}
          />
          <OverviewKpiTile
            label={t('Number of Invoices')} value={String(txCount)} tone="slate" icon={FileText}
            sub={`${paidCount} ${t('paid')}`}
            pct={pctOf(paidCount, txCount)} pctLabel={t('of invoices paid')}
          />
          <OverviewKpiTile
            label={t('Average / Invoice')} value={formatIDR(avgTxValue)} tone="sky" icon={Calculator}
            sub={maxInvoice > 0 ? `${t('Largest')} ${formatIDR(maxInvoice, true)}` : undefined}
            pct={pctOf(avgTxValue, maxInvoice)} pctLabel={t('of largest invoice')}
          />
          <OverviewKpiTile
            label={t('Overdue')} value={String(overdueCount)} tone={overdueCount > 0 ? 'danger' : 'sky'} icon={AlertTriangle}
            sub={overdueCount > 0 ? `${t('Worth')} ${formatIDR(overdueTotal, true)}` : undefined}
            pct={pctOf(overdueCount, txCount)} pctLabel={t('of all invoices')}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CashReceiptTrendChart
          events={trendEvents}
          loading={loading}
          title={t('Monthly Cash Receipt Trend')}
          subtitle={t('Amount received: posted Cash & Bank transaction date, or the invoice date for receipts recorded outside Cash & Bank')}
          emptyText={t('No Cash Receipt transactions to show yet.')}
          seriesLabel={t('Cash Receipt')}
        />
        <BreakdownDonutCard
          items={byCategory}
          total={totalInvoiced}
          icon={Layers}
          title={t('Receipt by Type')}
          subtitle={t('Total invoices per Sales transaction type')}
          centerSubLabel={t('Total Invoices')}
          emptyLabel={t('No data yet.')}
          othersLabel={t('Others')}
        />
      </div>

      {/* Top Customer -- leaderboard lebar penuh */}
      <TopPartyCard
        parties={topCustomers}
        total={totalInvoiced}
        icon={Trophy}
        title={t('Top Customer')}
        subtitle={t('By total invoice amount')}
        shareLabel={t('of total invoices')}
        countLabel={t('invoices')}
        emptyLabel={t('No data yet.')}
      />

      {/* Tabel invoice -- desain sama dengan tabel di Sales Overview */}
      <div className="card overflow-hidden">
        <div className="border-b border-border px-0 py-3">
          <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Customer Invoices (from Sales)')}</h3>
          <p className="mt-0.5 text-sm text-neutral-500">
            {filtered.length === 0
              ? t('Showing 0 of 0 invoices')
              : `${t('Showing')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('of')} ${filtered.length} ${t('invoices')}`}
            {' · '}
            {t('Posted Sales invoices only. Received and outstanding change once the Cash & Bank transaction is posted; until then the invoice is marked “In process”.')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border py-3">
          <FilterSelect
            neutral
            searchable={false}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[
              { value: 'all', label: t('All statuses') },
              { value: 'unpaid', label: t('Unpaid') },
              { value: 'partial', label: t('Partially Paid') },
              { value: 'paid', label: t('Paid') },
            ]}
          />
          <div className="relative ml-auto w-full sm:w-[400px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('Search invoice no., customer, description...')}
              className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1500px] select-text border-separate border-spacing-0">
            <thead>
              <tr className="bg-neutral-300">
                {HEADERS.map((h) => (
                  <th key={h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-xs font-bold text-black ${NUMERIC_COLS.includes(h) ? 'text-right' : 'text-left'}`}>{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && paged.length === 0 && (
                <tr><td colSpan={HEADERS.length} className="px-2 py-2 text-center text-xs text-muted-foreground">{t('Loading...')}</td></tr>
              )}
              {!loading && paged.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-2 py-2 text-center text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">{t('No posted Sales invoices yet.')}</span>
                  </td>
                </tr>
              )}
              {paged.map((r: CashReceiptRow) => {
                const st = STATUS_STYLE[r.isOverdue ? 'overdue' : r.receiptStatus] || STATUS_STYLE.unpaid;
                return (
                  <tr key={r.id} className="text-xs [&:hover>td]:bg-neutral-200 [&>td]:align-top [&>td]:shadow-[inset_0_-1px_0_#b4b4b4]">
                    <td className="whitespace-nowrap px-2 py-2 text-foreground">{formatTanggalSingkat(r.date)}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-blue-700">{r.invoiceNo}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-neutral-900">{r.customer}</td>
                    <td className="max-w-xs truncate px-2 py-2 text-neutral-600" title={r.description}>{r.description || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-neutral-600">{r.category}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-neutral-600">{r.dueDate ? formatTanggalSingkat(r.dueDate) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatIDR(r.total)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-semibold">{r.received ? formatIDR(r.received) : '—'}<PaidNote outside={r.paidOutside} mismatch={r.paidMismatch} /></td>
                    <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${r.outstanding > 0 ? 'font-semibold' : ''}`}>{r.outstanding ? formatIDR(r.outstanding) : '—'}</td>
                    <td className="px-2 py-2"><MutasiBankCell items={r.rekon} /></td>
                    <td className="px-2 py-2"><JurnalCell items={r.rekon} /></td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{t(st.label)}
                      </span>
                      <DalamProsesBadge nominal={r.dalamProses} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {(() => {
                        const sisa = Math.max(r.outstanding - r.dalamProses, 0);
                        return sisa > 0.005 ? (
                          <button
                            onClick={() => setPreset({ direction: 'receipt', invoiceId: r.id, amount: sisa, party: r.customer })}
                            className="rounded-lg border border-neutral-800 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white"
                          >
                            {t('Record Receipt')}
                          </button>
                        ) : null;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-0 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span>{t('Rows per page')}</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
            <span className="hidden text-slate-300 sm:inline">|</span>
            <span>
              <span className="font-semibold text-foreground">
                {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
              </span>{' '}
              {t('of')} <span className="font-semibold text-foreground">{filtered.length}</span> {t('invoices')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Previous page')} className={NAV_BTN}><ChevronLeft size={16} /></button>
            {buildPageItems(pageSafe, totalPages).map((p, idx) =>
              p === '…' ? (
                <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
              ) : (
                <button key={p} onClick={() => setPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
              )
            )}
            <button onClick={() => setPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Next page')} className={NAV_BTN}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
