'use client';

// [BARU] Sambungkan halaman Liabilities ke data ASLI client aktif -- pola &
// keterbatasan SAMA PERSIS dengan useAssetsData.ts (lihat komentar di sana):
// klasifikasi kartu KPI spesifik (Accounts Payable/Tax Payable/dst) berbasis
// KATA KUNCI sub_kategori/nama akun, best-effort. Total/Current/Non-Current
// Liabilities selalu benar (langsung dari saldo akun backend) walau akun
// tidak cocok kata kunci kartu spesifik mana pun.
//
// "Due this week" di kartu Accounts Payable & "Due in N days" di Tax Payable
// BELUM disambungkan (butuh due date per tagihan, bukan saldo akun bulanan
// -- lihat apBridge.ts di halaman Transaksi/Accounts Payable untuk sumber
// due-date yang sudah ada, based on transaksi Expense).

import { useMemo } from 'react';
import { useNeracaAccounts, teksAkun, bulatkanJuta, NAMA_BULAN, type AkunNeraca, type NeracaAccounts } from '@/lib/neracaBridge';
import { formatMoney } from '@/lib/currency';

export interface LiabKpiCard {
  label: string;
  value: string;
  subValue: string;
  change: number;
  changeLabel: string;
  sparkData: { v: number }[];
  status: 'neutral' | 'negative' | 'warning' | 'positive';
  highlight?: boolean;
}

export interface LiabTrendRow { month: string; total: number; current: number; nonCurrent: number }
export interface LiabCompositionSlice { name: string; value: number; pct: number; color: string }

export interface LiabilitiesData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  periodLabel: string;
  totalLiabilities: number;
  totalLiabilitiesPrev: number;
  kpiCards: LiabKpiCard[];
  trendData: LiabTrendRow[];
  compositionData: LiabCompositionSlice[];
  // [BARU] Data mentah + turunan tambahan, dipakai src/app/liabilities/lib/liabilitiesBridge.ts
  // (Debt Analysis, Due Schedule, Transactions, AI Insights) supaya tidak
  // perlu hitung ulang klasifikasi ASET/LIABILITAS/EKUITAS dari nol.
  accounts: NeracaAccounts | null;
  liabilityAccounts: AkunNeraca[];
  shortTermDebt: number;
  longTermDebt: number;
  totalEquity: number;
  netIncomeYtd: number;
  taxPayable: number;
  tahun: number;
  lastIdx: number;
}

function isCurrent(a: AkunNeraca): boolean {
  const t = teksAkun(a);
  if (/(jangka panjang|tidak lancar|non.?lancar)/.test(t)) return false;
  return true; // default: liabilitas tanpa label -> current (konsisten dgn Balance Sheet)
}

function sumAt(list: AkunNeraca[], idx: number): number {
  return list.reduce((s, a) => s + (idx >= 0 ? a.perBulan[idx] || 0 : 0), 0);
}

function matchAny(a: AkunNeraca, re: RegExp): boolean {
  return re.test(teksAkun(a));
}

const COMPOSITION_COLORS = ['#2563eb', '#d97706', '#16a34a', '#0891b2', '#7c3aed', '#be185d', '#64748b'];

export function useLiabilitiesData(): LiabilitiesData {
  const { loading, isSampleData, companyName, data } = useNeracaAccounts();

  return useMemo<LiabilitiesData>(() => {
    if (!data) {
      return {
        loading, isSampleData: true, companyName, periodLabel: '',
        totalLiabilities: 0, totalLiabilitiesPrev: 0, kpiCards: [], trendData: [], compositionData: [],
        accounts: null, liabilityAccounts: [], shortTermDebt: 0, longTermDebt: 0,
        totalEquity: 0, netIncomeYtd: 0, taxPayable: 0, tahun: new Date().getFullYear(), lastIdx: -1,
      };
    }
    const { liabilitas, ekuitas, lastIdx, tahun, labaBersihYtd } = data;
    const prevIdx = lastIdx - 1;

    const totalNow = sumAt(liabilitas, lastIdx);
    const totalPrev = prevIdx >= 0 ? sumAt(liabilitas, prevIdx) : 0;

    const currentLiab = liabilitas.filter(isCurrent);
    const nonCurrentLiab = liabilitas.filter((a) => !isCurrent(a));
    const currentNow = sumAt(currentLiab, lastIdx);
    const currentPrev = prevIdx >= 0 ? sumAt(currentLiab, prevIdx) : 0;
    const nonCurrentNow = sumAt(nonCurrentLiab, lastIdx);
    const nonCurrentPrev = prevIdx >= 0 ? sumAt(nonCurrentLiab, prevIdx) : 0;

    const apAccounts = liabilitas.filter((a) => matchAny(a, /(hutang usaha|utang usaha|accounts? payable)/));
    const taxAccounts = liabilitas.filter((a) => matchAny(a, /(hutang pajak|utang pajak|pajak terutang|tax payable)/));
    const shortDebtAccounts = liabilitas.filter((a) => matchAny(a, /(hutang bank jangka pendek|utang bank jangka pendek|short.?term debt|pinjaman jangka pendek)/));
    const longDebtAccounts = liabilitas.filter((a) => matchAny(a, /(hutang bank jangka panjang|utang bank jangka panjang|long.?term debt|pinjaman jangka panjang)/));
    const totalDebtAccounts = [...shortDebtAccounts, ...longDebtAccounts];

    const apNow = sumAt(apAccounts, lastIdx);
    const apPrev = prevIdx >= 0 ? sumAt(apAccounts, prevIdx) : 0;
    const taxNow = sumAt(taxAccounts, lastIdx);
    const taxPrev = prevIdx >= 0 ? sumAt(taxAccounts, prevIdx) : 0;
    const shortDebtNow = sumAt(shortDebtAccounts, lastIdx);
    const shortDebtPrev = prevIdx >= 0 ? sumAt(shortDebtAccounts, prevIdx) : 0;
    const longDebtNow = sumAt(longDebtAccounts, lastIdx);
    const longDebtPrev = prevIdx >= 0 ? sumAt(longDebtAccounts, prevIdx) : 0;
    const totalDebtNow = sumAt(totalDebtAccounts, lastIdx);
    const totalDebtPrev = prevIdx >= 0 ? sumAt(totalDebtAccounts, prevIdx) : 0;

    const pctChange = (now: number, prev: number): number => {
      if (Math.abs(prev) < 0.01) return 0;
      return Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10;
    };

    const sparkline = (list: AkunNeraca[]): { v: number }[] => {
      const pts: { v: number }[] = [];
      for (let i = 0; i <= lastIdx; i++) pts.push({ v: bulatkanJuta(sumAt(list, i)) });
      while (pts.length < 8) pts.unshift(pts[0] || { v: 0 });
      return pts.slice(-8);
    };

    const rp = (v: number) => formatMoney(v, 'IDR');

    const kpiCards: LiabKpiCard[] = [
      {
        label: 'TOTAL LIABILITIES', value: rp(totalNow), subValue: `Jan\u2013${NAMA_BULAN[lastIdx]} ${tahun} YTD`,
        change: pctChange(totalNow, totalPrev), changeLabel: 'vs prev period', sparkData: sparkline(liabilitas), status: 'neutral',
      },
      {
        label: 'CURRENT LIABILITIES', value: rp(currentNow),
        subValue: totalNow > 0 ? `${Math.round((currentNow / totalNow) * 1000) / 10}% of total liabilities` : '',
        change: pctChange(currentNow, currentPrev), changeLabel: 'vs prev period', sparkData: sparkline(currentLiab), status: 'neutral',
      },
      {
        label: 'NON-CURRENT LIABILITIES', value: rp(nonCurrentNow),
        subValue: totalNow > 0 ? `${Math.round((nonCurrentNow / totalNow) * 1000) / 10}% of total liabilities` : '',
        change: pctChange(nonCurrentNow, nonCurrentPrev), changeLabel: 'vs prev period', sparkData: sparkline(nonCurrentLiab), status: 'neutral',
      },
      {
        label: 'ACCOUNTS PAYABLE', value: rp(apNow), subValue: '',
        change: pctChange(apNow, apPrev), changeLabel: 'vs prev period', sparkData: sparkline(apAccounts), status: 'neutral',
      },
      {
        label: 'TAX PAYABLE', value: rp(taxNow), subValue: '',
        change: pctChange(taxNow, taxPrev), changeLabel: 'vs prev period', sparkData: sparkline(taxAccounts),
        status: taxNow > 0 ? 'warning' : 'neutral', highlight: taxNow > 0,
      },
      {
        label: 'SHORT-TERM DEBT', value: rp(shortDebtNow), subValue: 'Due within 12 months',
        change: pctChange(shortDebtNow, shortDebtPrev), changeLabel: 'vs prev period', sparkData: sparkline(shortDebtAccounts), status: 'neutral',
      },
      {
        label: 'LONG-TERM DEBT', value: rp(longDebtNow), subValue: 'Maturity > 12 months',
        change: pctChange(longDebtNow, longDebtPrev), changeLabel: 'vs prev period', sparkData: sparkline(longDebtAccounts), status: 'neutral',
      },
      {
        label: 'TOTAL DEBT', value: rp(totalDebtNow), subValue: '',
        change: pctChange(totalDebtNow, totalDebtPrev), changeLabel: 'vs prev period', sparkData: sparkline(totalDebtAccounts), status: 'neutral',
      },
    ];

    const trendData: LiabTrendRow[] = [];
    for (let i = 0; i <= lastIdx; i++) {
      trendData.push({
        month: NAMA_BULAN[i],
        total: bulatkanJuta(sumAt(liabilitas, i)),
        current: bulatkanJuta(sumAt(currentLiab, i)),
        nonCurrent: bulatkanJuta(sumAt(nonCurrentLiab, i)),
      });
    }

    const byLabel: Record<string, number> = {};
    for (const a of liabilitas) {
      const label = (a.subKategori && a.subKategori.trim()) || a.namaAkun || 'Lainnya';
      byLabel[label] = (byLabel[label] || 0) + (a.perBulan[lastIdx] || 0);
    }
    const sorted = Object.entries(byLabel).filter(([, v]) => Math.abs(v) > 1).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const restTotal = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    const compositionRows = restTotal > 1 ? [...top, ['Other Liabilities', restTotal] as [string, number]] : top;
    const compTotal = compositionRows.reduce((s, [, v]) => s + v, 0) || 1;
    const compositionData: LiabCompositionSlice[] = compositionRows.map(([name, v], i) => ({
      name,
      value: bulatkanJuta(v),
      pct: Math.round((v / compTotal) * 1000) / 10,
      color: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
    }));

    const periodLabel = `As of ${NAMA_BULAN[lastIdx]} 30, ${tahun}`;
    const totalEquity = sumAt(ekuitas, lastIdx);
    const netIncomeYtd = labaBersihYtd?.[lastIdx] || 0;

    return {
      loading, isSampleData: false, companyName, periodLabel,
      totalLiabilities: totalNow, totalLiabilitiesPrev: totalPrev, kpiCards, trendData, compositionData,
      accounts: data, liabilityAccounts: liabilitas, shortTermDebt: shortDebtNow, longTermDebt: longDebtNow,
      totalEquity, netIncomeYtd, taxPayable: taxNow, tahun, lastIdx,
    };
  }, [loading, isSampleData, companyName, data]);
}
