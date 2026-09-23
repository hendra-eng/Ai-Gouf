'use client';

// Hook data untuk halaman-halaman Financial Statements, bersumber dari
// API /api/v1/financial-statements (lihat src/lib/financialStatementsStore.tsx
// & backend/modules/financial_statements/) -- yaitu transaksi POSTED dari
// fitur Transactions (Journal Entry, Sales, Purchase) milik user yang login.
//
// Bentuk return SENGAJA sama persis dengan hook lama (useProfitLossData /
// useBalanceSheetData / useCashFlowData) supaya komponen halaman tidak
// perlu dirombak. Hook lama TIDAK diubah karena masih dipakai modul lain
// (Dashboard, Budget & Forecast, Tax Compliance) yang sumber datanya masih
// laporan-bulanan lama per activeClientId.
//
// Beda perilaku dengan hook lama: TIDAK ada fallback data contoh
// (financialData.tsx). Kalau belum ada transaksi posted, angka tampil 0 dan
// periodLabel memberi tahu -- supaya user tidak mengira data contoh adalah
// data asli (transaksi draft memang tidak boleh masuk laporan Actual).
//
// Semua nominal dikonversi ke JUTA (keJuta) karena komponen menampilkan
// formatMoney(v * 1_000_000).

import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { keJuta, useFinancialStatements, type FinancialStatements, type FsNeracaSeksi } from '@/lib/financialStatementsStore';
import { CF_CORE as MOCK_CF_CORE } from '@/lib/financialData';
import type { PLCoreValues, MarginValues, MonthlyPLRow, BreakdownItem } from './useProfitLossData';
import type { BSSection, BSMonthlyRow } from './useBalanceSheetData';
import type { CFItem, CFMonthlyRow, CFTransaction } from './useCashFlowData';

function formatTanggal(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!iso) return '-';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-GB', opts);
}

/** Header bersama: nama perusahaan, label periode, status loading. */
export function useStatementMeta() {
  const { data, loading, error, refresh } = useFinancialStatements();
  const { activeClientName } = useActiveClient();
  const { user } = useAuth();
  const periode = data?.periode;
  const adaData = !!periode?.ada_data;
  return {
    data,
    loading,
    error,
    refresh,
    adaData,
    companyName: activeClientName || user?.nama || user?.username || 'No client selected',
    periodLabel: periode ? (adaData ? periode.label : `No posted data — ${periode.tahun}`) : (loading ? 'Loading…' : `No posted data — ${new Date().getFullYear()}`),
    asOfLabel: periode ? `As of ${formatTanggal(periode.per_tanggal, { day: 'numeric', month: 'short', year: 'numeric' })}` : '',
    asOfLabelId: periode ? `Per ${formatTanggal(periode.per_tanggal, { day: 'numeric', month: 'long', year: 'numeric' })}` : '',
  };
}

// ============================================================
// Profit & Loss
// ============================================================

function mapPlCore(r: FinancialStatements['profit_loss']['ringkasan'] | undefined): PLCoreValues {
  return {
    revenue: keJuta(r?.revenue), cogs: keJuta(r?.cogs), grossProfit: keJuta(r?.gross_profit),
    operatingExpenses: keJuta(r?.operating_expenses), ebitda: keJuta(r?.ebitda), da: keJuta(r?.da),
    ebit: keJuta(r?.ebit), interestExpense: keJuta(r?.interest_expense), ebt: keJuta(r?.ebt),
    incomeTax: keJuta(r?.income_tax), netProfit: keJuta(r?.net_profit),
  };
}

function mapBreakdown(items: { name: string; value: number; pct: number }[] | undefined): BreakdownItem[] {
  return (items || []).map((i) => ({ name: i.name, value: keJuta(i.value), pct: i.pct }));
}

export function useProfitLossStatement() {
  const meta = useStatementMeta();
  const pl = meta.data?.profit_loss;
  const MONTHLY_PL: MonthlyPLRow[] = (meta.adaData ? pl?.bulanan || [] : []).map((m) => ({
    month: m.label,
    revenue: keJuta(m.revenue), cogs: keJuta(m.cogs), grossProfit: keJuta(m.gross_profit),
    opEx: keJuta(m.operating_expenses), ebitda: keJuta(m.ebitda), da: keJuta(m.da), ebit: keJuta(m.ebit),
    interest: keJuta(m.interest_expense), tax: keJuta(m.income_tax), netProfit: keJuta(m.net_profit),
  }));
  const MARGINS: MarginValues = {
    grossMargin: pl?.margin.gross_margin || 0,
    ebitdaMargin: pl?.margin.ebitda_margin || 0,
    ebitMargin: pl?.margin.ebit_margin || 0,
    netMargin: pl?.margin.net_margin || 0,
  };
  return {
    loading: meta.loading,
    isSampleData: false,
    companyName: meta.companyName,
    periodLabel: meta.periodLabel,
    PL_CORE: mapPlCore(pl?.ringkasan),
    MARGINS,
    MONTHLY_PL,
    REVENUE_BY_CATEGORY: mapBreakdown(pl?.rincian.revenue),
    EXPENSE_BREAKDOWN: mapBreakdown(pl?.rincian.operating_expenses),
    /** Rincian per akun tiap pos (juta) -- dipakai tabel P&L di tab ringkasan. */
    RINCIAN: {
      revenue: mapBreakdown(pl?.rincian.revenue),
      cogs: mapBreakdown(pl?.rincian.cogs),
      operatingExpenses: mapBreakdown(pl?.rincian.operating_expenses),
      da: mapBreakdown(pl?.rincian.da),
      interest: mapBreakdown(pl?.rincian.interest_expense),
      tax: mapBreakdown(pl?.rincian.income_tax),
    },
    effectiveTaxRate: pl?.margin.effective_tax_rate || 0,
  };
}

// ============================================================
// Balance Sheet
// ============================================================

function mapSeksi(s: FsNeracaSeksi | undefined, labelDefault: string): BSSection {
  if (!s) return { label: labelDefault, items: [], total: 0, prevTotal: 0 };
  return {
    label: s.label,
    items: s.items.map((i) => ({ name: i.name, current: keJuta(i.current), prev: keJuta(i.prev), href: i.href })),
    total: keJuta(s.total),
    prevTotal: keJuta(s.prev_total),
  };
}

export function useBalanceSheetStatement() {
  const meta = useStatementMeta();
  const bs = meta.data?.balance_sheet;
  const BS_MONTHLY_TREND: BSMonthlyRow[] = (meta.adaData ? bs?.tren_bulanan || [] : []).map((t) => ({
    month: t.label, assets: keJuta(t.aset), liabilities: keJuta(t.liabilitas), equity: keJuta(t.ekuitas),
  }));
  return {
    loading: meta.loading,
    isSampleData: false,
    companyName: meta.companyName,
    periodLabel: meta.adaData ? meta.asOfLabel : meta.periodLabel,
    periodLabelId: meta.adaData ? meta.asOfLabelId : meta.periodLabel,
    totalAssets: keJuta(bs?.total_aset), prevTotalAssets: keJuta(bs?.prev_total_aset),
    totalLiabilities: keJuta(bs?.total_liabilitas), prevTotalLiabilities: keJuta(bs?.prev_total_liabilitas),
    totalEquity: keJuta(bs?.total_ekuitas), prevTotalEquity: keJuta(bs?.prev_total_ekuitas),
    currentAssets: mapSeksi(bs?.aset_lancar, 'Current Assets'),
    nonCurrentAssets: mapSeksi(bs?.aset_tidak_lancar, 'Non-Current Assets'),
    currentLiabilities: mapSeksi(bs?.liabilitas_jangka_pendek, 'Current Liabilities'),
    nonCurrentLiabilities: mapSeksi(bs?.liabilitas_jangka_panjang, 'Non-Current Liabilities'),
    equity: mapSeksi(bs?.ekuitas, "Shareholders' Equity"),
    BS_MONTHLY_TREND,
    /** Tren modal kerja (juta) -- aset lancar vs liabilitas jangka pendek per bulan. */
    WORKING_CAPITAL_TREND: (meta.adaData ? bs?.tren_bulanan || [] : []).map((t) => ({
      month: t.label,
      currentAssets: keJuta(t.aset_lancar),
      currentLiabilities: keJuta(t.liabilitas_jangka_pendek),
      workingCapital: keJuta(t.aset_lancar - t.liabilitas_jangka_pendek),
    })),
    isBalanced: bs ? bs.seimbang : true,
    difference: keJuta(bs?.selisih),
  };
}

// ============================================================
// Cash Flow
// ============================================================

export function useCashFlowStatement() {
  const meta = useStatementMeta();
  const cf = meta.data?.cash_flow;
  const r = cf?.ringkasan;
  const CF_CORE: typeof MOCK_CF_CORE = {
    beginningCash: keJuta(r?.beginning_cash),
    customerCollections: keJuta(r?.customer_collections),
    supplierPayments: keJuta(r?.supplier_payments),
    payrollPayments: keJuta(r?.payroll_payments),
    taxPayments: keJuta(r?.tax_payments),
    operatingExpensesCF: keJuta(r?.operating_expenses_cf),
    otherOperatingCF: keJuta(r?.other_operating_cf),
    netOperatingCF: keJuta(r?.net_operating_cf),
    assetPurchases: keJuta(r?.asset_purchases),
    assetSales: keJuta(r?.asset_sales),
    equipmentPurchases: keJuta(r?.equipment_purchases),
    investments: keJuta(r?.investments),
    otherInvestingCF: keJuta(r?.other_investing_cf),
    netInvestingCF: keJuta(r?.net_investing_cf),
    debtProceeds: keJuta(r?.debt_proceeds),
    debtRepayment: keJuta(r?.debt_repayment),
    capitalInjection: keJuta(r?.capital_injection),
    dividendPayments: keJuta(r?.dividend_payments),
    leasePayments: keJuta(r?.lease_payments),
    otherFinancingCF: keJuta(r?.other_financing_cf),
    netFinancingCF: keJuta(r?.net_financing_cf),
    netChange: keJuta(r?.net_change),
    endingCash: keJuta(r?.ending_cash),
  };
  const CF_MONTHLY: CFMonthlyRow[] = (meta.adaData ? cf?.bulanan || [] : []).map((b) => ({
    month: b.label, beginCash: keJuta(b.begin_cash), operatingCF: keJuta(b.operating_cf),
    investingCF: keJuta(b.investing_cf), financingCF: keJuta(b.financing_cf),
    netChange: keJuta(b.net_change), endCash: keJuta(b.end_cash),
  }));
  const mapItems = (items: FinancialStatements['cash_flow']['operating_items'] | undefined): CFItem[] =>
    (items || []).map((i) => ({ name: i.name, inflow: keJuta(i.inflow), outflow: keJuta(i.outflow), href: i.href }));
  const RECENT_TRANSACTIONS: CFTransaction[] = (cf?.recent_transactions || []).map((t) => ({
    id: t.id, date: formatTanggal(t.tanggal), type: t.type, desc: t.description, account: t.account,
    inflow: keJuta(t.inflow), outflow: keJuta(t.outflow), party: t.party, status: t.status,
  }));
  const tl = cf?.metode_tidak_langsung;
  const mapSeksiTl = (s: { items: { label: string; value: number }[]; total: number } | undefined, label: string) => ({
    label, items: (s?.items || []).map((i) => ({ label: i.label, value: keJuta(i.value) })), total: keJuta(s?.total),
  });
  return {
    loading: meta.loading,
    isSampleData: false,
    companyName: meta.companyName,
    periodLabel: meta.periodLabel,
    CF_CORE,
    CF_MONTHLY,
    OPERATING_ITEMS: mapItems(cf?.operating_items),
    INVESTING_ITEMS: mapItems(cf?.investing_items),
    FINANCING_ITEMS: mapItems(cf?.financing_items),
    RECENT_TRANSACTIONS,
    /** Arus kas metode tidak langsung (juta) -- tab ringkasan Cash Flow. */
    INDIRECT: {
      operating: mapSeksiTl(tl?.operating, 'Operating Activities'),
      investing: mapSeksiTl(tl?.investing, 'Investing Activities'),
      financing: mapSeksiTl(tl?.financing, 'Financing Activities'),
      beginning: keJuta(tl?.beginning),
      netChange: keJuta(tl?.net_change),
      ending: keJuta(tl?.ending),
    },
  };
}

// ============================================================
// Changes in Equity & Notes
// ============================================================

export function useEquityStatement() {
  const meta = useStatementMeta();
  const eq = meta.data?.changes_in_equity;
  const rows = (eq?.komponen || []).map((k) => ({
    key: k.key, label: k.name,
    opening: keJuta(k.opening), capital: keJuta(k.capital), profit: keJuta(k.profit),
    dividends: keJuta(k.dividends), adj: keJuta(k.adjustments), closing: keJuta(k.closing),
    accounts: k.akun.map((a) => ({ code: a.account_code, name: a.account_name, opening: keJuta(a.opening), movement: keJuta(a.movement), closing: keJuta(a.closing) })),
  }));
  const s = eq?.ringkasan;
  const re = eq?.rekonsiliasi_laba_ditahan;
  return {
    loading: meta.loading,
    adaData: meta.adaData,
    companyName: meta.companyName,
    periodLabel: meta.periodLabel,
    asOfLabel: meta.asOfLabel,
    rows,
    totals: {
      opening: keJuta(eq?.total.opening), capital: keJuta(eq?.total.capital), profit: keJuta(eq?.total.profit),
      dividends: keJuta(eq?.total.dividends), adj: keJuta(eq?.total.adjustments), closing: keJuta(eq?.total.closing),
    },
    summary: {
      openingEquity: keJuta(s?.opening_equity),
      capitalContributions: keJuta(s?.capital_contributions),
      netProfit: keJuta(s?.net_profit),
      dividends: keJuta(s?.dividends),
      otherAdjustments: keJuta(s?.other_adjustments),
      closingEquity: keJuta(s?.closing_equity),
      growthPct: s?.equity_growth_pct ?? null,
    },
    retainedEarnings: {
      opening: keJuta(re?.opening), netProfit: keJuta(re?.net_profit), dividends: keJuta(re?.dividends),
      adjustments: keJuta(re?.adjustments), closing: keJuta(re?.closing),
    },
    monthly: (meta.adaData ? eq?.bulanan || [] : []).map((b) => ({ month: b.label, closingEquity: keJuta(b.closing_equity), netProfitYtd: keJuta(b.net_profit_ytd) })),
    /** Total ekuitas di neraca (juta) -- untuk cek rekonsiliasi. */
    balanceSheetEquity: keJuta(meta.data?.balance_sheet.total_ekuitas),
  };
}

export function useNotesStatement() {
  const meta = useStatementMeta();
  const notes = meta.data?.notes;
  return {
    loading: meta.loading,
    adaData: meta.adaData,
    companyName: meta.companyName,
    periodLabel: meta.periodLabel,
    asOfLabel: meta.asOfLabel,
    compareLabel: notes ? `As of ${formatTanggal(notes.pembanding_tanggal, { day: 'numeric', month: 'short', year: 'numeric' })}` : '',
    notes: (notes?.catatan || []).map((c) => ({
      ...c,
      total: c.total == null ? null : keJuta(c.total),
      prevTotal: c.prev_total == null ? null : keJuta(c.prev_total),
      rows: c.rows.map((r) => ({ code: r.account_code, name: r.account_name, current: keJuta(r.current), prev: keJuta(r.prev) })),
    })),
    counts: notes?.jumlah || { total: 0, policy: 0, disclosed: 0, schedule: 0 },
  };
}
