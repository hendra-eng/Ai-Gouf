'use client';

// [BARU] Sambungkan halaman Equity ke data ASLI client aktif -- pola &
// keterbatasan SAMA seperti useAssetsData.ts/useLiabilitiesData.ts.
//
// [Keterbatasan khusus Equity]: waterfall "Equity Movement" versi mock
// (Net Profit/Capital Injection/Dividends/Revaluation/OCI per komponen)
// butuh data per-JENIS mutasi ekuitas (jurnal dividen, setoran modal, dst)
// yang TIDAK ada di trial_balance_bulanan (itu cuma saldo per akun per
// bulan, bukan per jenis transaksi). Di sini waterfall didekati dengan 2
// komponen yang BISA dihitung akurat dari data yang ada:
//   - "Net Profit (YTD)"      = laba_bersih_ytd bulan terakhir
//   - "Other Equity Movements" = sisa perubahan ekuitas (setoran modal,
//     dividen, revaluasi, OCI, dst digabung) = total delta - net profit
// Kalau butuh breakdown per jenis mutasi yang akurat, itu perlu backend
// menandai jurnal ekuitas per jenis (belum ada modulnya).

import { useMemo } from 'react';
import { useNeracaAccounts, bulatkanJuta, NAMA_BULAN, type AkunNeraca } from '@/lib/neracaBridge';
import { formatMoney } from '@/lib/currency';

export interface EquityKpiCard {
  label: string;
  value: string;
  subValue: string;
  change: number;
  changeLabel: string;
  sparkData: { v: number }[];
  status: 'neutral' | 'negative' | 'warning' | 'positive';
  highlight?: boolean;
}

export interface EquityTrendRow { month: string; total: number; retained: number; capital: number }
export interface EquityWaterfallStep { name: string; value: number; type: 'base' | 'positive' | 'negative' | 'neutral' }

export interface EquityData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  periodLabel: string;
  totalEquity: number;
  kpiCards: EquityKpiCard[];
  trendData: EquityTrendRow[];
  waterfall: EquityWaterfallStep[];
}

function sumAt(list: AkunNeraca[], idx: number): number {
  return list.reduce((s, a) => s + (idx >= 0 ? a.perBulan[idx] || 0 : 0), 0);
}

function matchAny(a: AkunNeraca, re: RegExp): boolean {
  return re.test(`${a.subKategori || ''} ${a.namaAkun || ''}`.toLowerCase());
}

export function useEquityData(): EquityData {
  const { loading, isSampleData, companyName, data } = useNeracaAccounts();

  return useMemo<EquityData>(() => {
    if (!data) {
      return {
        loading, isSampleData: true, companyName, periodLabel: '',
        totalEquity: 0, kpiCards: [], trendData: [], waterfall: [],
      };
    }
    const { ekuitas, labaBersihYtd, lastIdx, tahun } = data;
    const prevIdx = lastIdx - 1;

    const equityAccountsNow = sumAt(ekuitas, lastIdx);
    const equityAccountsPrev = prevIdx >= 0 ? sumAt(ekuitas, prevIdx) : 0;
    const netProfitNow = labaBersihYtd[lastIdx] || 0;
    const netProfitPrev = prevIdx >= 0 ? (labaBersihYtd[prevIdx] || 0) : 0;

    // Laba tahun berjalan (YTD) ditambahkan manual ke Ekuitas (belum tentu
    // sudah diposting ke akun Laba Ditahan) -- sama seperti Balance Sheet.
    const totalNow = equityAccountsNow + netProfitNow;
    const totalPrev = equityAccountsPrev + netProfitPrev;

    const paidInAccounts = ekuitas.filter((a) => matchAny(a, /(modal disetor|paid.?in capital|modal saham)/));
    const retainedAccounts = ekuitas.filter((a) => matchAny(a, /(laba ditahan|saldo laba|retained earnings)/));
    const otherAccounts = ekuitas.filter((a) => !matchAny(a, /(modal disetor|paid.?in capital|modal saham|laba ditahan|saldo laba|retained earnings)/));

    const paidInNow = sumAt(paidInAccounts, lastIdx);
    const paidInPrev = prevIdx >= 0 ? sumAt(paidInAccounts, prevIdx) : 0;
    const retainedNow = sumAt(retainedAccounts, lastIdx);
    const retainedPrev = prevIdx >= 0 ? sumAt(retainedAccounts, prevIdx) : 0;
    const otherNow = sumAt(otherAccounts, lastIdx);
    const otherPrev = prevIdx >= 0 ? sumAt(otherAccounts, prevIdx) : 0;

    const pctChange = (now: number, prev: number): number => {
      if (Math.abs(prev) < 0.01) return 0;
      return Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10;
    };

    const sparkline = (fn: (idx: number) => number): { v: number }[] => {
      const pts: { v: number }[] = [];
      for (let i = 0; i <= lastIdx; i++) pts.push({ v: bulatkanJuta(fn(i)) });
      while (pts.length < 8) pts.unshift(pts[0] || { v: 0 });
      return pts.slice(-8);
    };

    const equityGrowthPct = pctChange(totalNow, totalPrev);
    const rp = (v: number) => formatMoney(v, 'IDR');
    const pctStr = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

    const kpiCards: EquityKpiCard[] = [
      {
        label: 'TOTAL EQUITY', value: rp(totalNow), subValue: `Jan\u2013${NAMA_BULAN[lastIdx]} ${tahun} YTD`,
        change: equityGrowthPct, changeLabel: 'vs prev period',
        sparkData: sparkline((i) => sumAt(ekuitas, i) + (labaBersihYtd[i] || 0)), status: 'neutral',
      },
      {
        label: 'PAID-IN CAPITAL', value: rp(paidInNow), subValue: 'Authorized share capital',
        change: pctChange(paidInNow, paidInPrev), changeLabel: 'vs prev period', sparkData: sparkline((i) => sumAt(paidInAccounts, i)), status: 'neutral',
      },
      {
        label: 'RETAINED EARNINGS', value: rp(retainedNow), subValue: 'Accumulated prior years',
        change: pctChange(retainedNow, retainedPrev), changeLabel: 'vs prev period', sparkData: sparkline((i) => sumAt(retainedAccounts, i)), status: 'neutral',
      },
      {
        label: 'CURRENT YEAR PROFIT', value: rp(netProfitNow), subValue: `Net profit YTD ${tahun}`,
        change: pctChange(netProfitNow, netProfitPrev), changeLabel: 'vs prev period', sparkData: sparkline((i) => labaBersihYtd[i] || 0), status: 'neutral',
      },
      {
        label: 'OTHER EQUITY', value: rp(otherNow), subValue: 'OCI + Revaluation Reserve',
        change: pctChange(otherNow, otherPrev), changeLabel: 'vs prev period', sparkData: sparkline((i) => sumAt(otherAccounts, i)), status: 'neutral',
      },
      {
        label: 'EQUITY GROWTH', value: pctStr(equityGrowthPct), subValue: 'vs prior period',
        change: equityGrowthPct, changeLabel: `YTD ${tahun}`,
        sparkData: sparkline((i) => {
          const prevBase = i > 0 ? sumAt(ekuitas, i - 1) + (labaBersihYtd[i - 1] || 0) : 0;
          const base = sumAt(ekuitas, i) + (labaBersihYtd[i] || 0);
          return pctChange(base, prevBase);
        }), status: 'neutral',
      },
    ];

    const trendData: EquityTrendRow[] = [];
    for (let i = 0; i <= lastIdx; i++) {
      trendData.push({
        month: NAMA_BULAN[i],
        total: bulatkanJuta(sumAt(ekuitas, i) + (labaBersihYtd[i] || 0)),
        retained: bulatkanJuta(sumAt(retainedAccounts, i) + (labaBersihYtd[i] || 0)),
        capital: bulatkanJuta(sumAt(paidInAccounts, i)),
      });
    }

    const otherMovement = (totalNow - totalPrev) - (netProfitNow - netProfitPrev);
    const waterfall: EquityWaterfallStep[] = [
      { name: `Beginning Equity (${prevIdx >= 0 ? NAMA_BULAN[prevIdx] : NAMA_BULAN[0]})`, value: bulatkanJuta(totalPrev), type: 'base' },
      { name: 'Net Profit (YTD movement)', value: bulatkanJuta(netProfitNow - netProfitPrev), type: (netProfitNow - netProfitPrev) >= 0 ? 'positive' : 'negative' },
      { name: 'Other Equity Movements', value: bulatkanJuta(otherMovement), type: otherMovement >= 0 ? 'positive' : 'negative' },
      { name: `Ending Equity (${NAMA_BULAN[lastIdx]})`, value: bulatkanJuta(totalNow), type: 'base' },
    ];

    const periodLabel = `Jan\u2013${NAMA_BULAN[lastIdx]} ${tahun}`;

    return { loading, isSampleData: false, companyName, periodLabel, totalEquity: totalNow, kpiCards, trendData, waterfall };
  }, [loading, isSampleData, companyName, data]);
}
