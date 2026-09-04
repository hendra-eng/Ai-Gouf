'use client';

// [BARU] Sambungkan halaman Assets ke data ASLI client aktif -- pola SAMA
// dengan Balance Sheet, lewat src/lib/neracaBridge.ts (dipakai bersama oleh
// Assets/Liabilities/Equity supaya fetch+klasifikasi tidak dobel 3x).
//
// [Keterbatasan yang SENGAJA dibiarkan best-effort -- sama seperti Balance
// Sheet]: "Cash & Bank" / "Inventory" / "Fixed Assets (Net)" / "Accumulated
// Depreciation" dikenali lewat KATA KUNCI di sub_kategori/nama akun (COA
// client BEBAS teksnya), bukan sumber kebenaran akuntansi. Akun yang tidak
// cocok kata kunci apa pun tetap ikut ke Total/Current/Non-Current Assets
// (jadi total selalu benar), hanya tidak muncul di kartu KPI spesifiknya.
//
// Register per-aset (Fixed Asset Register, jadwal depresiasi per unit)
// BELUM disambungkan di sini -- itu perlu data per-unit aset tetap dari
// modul backend proses_file_aset_tetap, bukan cuma saldo per akun per bulan.

import { useMemo } from 'react';
import { useNeracaAccounts, teksAkun, bulatkanJuta, NAMA_BULAN, type AkunNeraca } from '@/lib/neracaBridge';
import { formatMoney } from '@/lib/currency';

export interface AssetsKpiCard {
  label: string;
  value: string; // sudah diformat "Rp X,XXM" -- siap dilempar ke fx()
  subValue: string;
  change: number;
  changeLabel: string;
  sparkData: { v: number }[];
  status: 'neutral' | 'negative' | 'warning' | 'positive';
  highlight?: boolean;
}

export interface AssetsTrendRow { month: string; total: number; current: number; nonCurrent: number }
export interface AssetsCompositionSlice { name: string; value: number; pct: number; color: string }

export interface AssetsData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  periodLabel: string;
  totalAssets: number;
  kpiCards: AssetsKpiCard[];
  trendData: AssetsTrendRow[];
  compositionData: AssetsCompositionSlice[];
}

function isCurrent(a: AkunNeraca): boolean {
  const t = teksAkun(a);
  if (/(tidak lancar|non.?lancar|aset tetap|tak berwujud|jangka panjang)/.test(t)) return false;
  if (/lancar/.test(t)) return true;
  return false; // default: tanpa label -> non-current (konsisten dgn Balance Sheet)
}

function sumAt(list: AkunNeraca[], idx: number): number {
  return list.reduce((s, a) => s + (idx >= 0 ? a.perBulan[idx] || 0 : 0), 0);
}

function matchAny(a: AkunNeraca, re: RegExp): boolean {
  return re.test(teksAkun(a));
}

const COMPOSITION_COLORS = ['#2563eb', '#7c3aed', '#16a34a', '#d97706', '#0891b2', '#be185d', '#64748b'];

export function useAssetsData(): AssetsData {
  const { loading, isSampleData, companyName, data } = useNeracaAccounts();

  return useMemo<AssetsData>(() => {
    if (!data) {
      return {
        loading, isSampleData: true, companyName, periodLabel: '',
        totalAssets: 0, kpiCards: [], trendData: [], compositionData: [],
      };
    }
    const { aset, lastIdx, tahun } = data;
    const prevIdx = lastIdx - 1;

    const totalNow = sumAt(aset, lastIdx);
    const totalPrev = prevIdx >= 0 ? sumAt(aset, prevIdx) : 0;

    const currentAssets = aset.filter(isCurrent);
    const nonCurrentAssets = aset.filter((a) => !isCurrent(a));
    const currentNow = sumAt(currentAssets, lastIdx);
    const currentPrev = prevIdx >= 0 ? sumAt(currentAssets, prevIdx) : 0;
    const nonCurrentNow = sumAt(nonCurrentAssets, lastIdx);
    const nonCurrentPrev = prevIdx >= 0 ? sumAt(nonCurrentAssets, prevIdx) : 0;

    const cashAccounts = aset.filter((a) => matchAny(a, /(kas|bank)/));
    const arAccounts = aset.filter((a) => matchAny(a, /(piutang usaha|piutang dagang|accounts? receivable)/));
    const inventoryAccounts = aset.filter((a) => matchAny(a, /(persediaan|inventory)/));
    const accumDeprAccounts = aset.filter((a) => matchAny(a, /(akumulasi penyusutan|akumulasi depresiasi|accumulated depreciation)/));
    const fixedAssetAccounts = aset.filter((a) => matchAny(a, /(aset tetap|fixed asset|tanah|bangunan|kendaraan|peralatan|mesin)/) && !matchAny(a, /(akumulasi)/));

    const cashNow = sumAt(cashAccounts, lastIdx);
    const cashPrev = prevIdx >= 0 ? sumAt(cashAccounts, prevIdx) : 0;
    const arNow = sumAt(arAccounts, lastIdx);
    const arPrev = prevIdx >= 0 ? sumAt(arAccounts, prevIdx) : 0;
    const invNow = sumAt(inventoryAccounts, lastIdx);
    const invPrev = prevIdx >= 0 ? sumAt(inventoryAccounts, prevIdx) : 0;
    const accumDeprNow = sumAt(accumDeprAccounts, lastIdx); // biasanya negatif (kontra-aset)
    const accumDeprPrev = prevIdx >= 0 ? sumAt(accumDeprAccounts, prevIdx) : 0;
    const fixedGrossNow = sumAt(fixedAssetAccounts, lastIdx);
    const fixedNetNow = fixedGrossNow + accumDeprNow;
    const fixedNetPrev = (prevIdx >= 0 ? sumAt(fixedAssetAccounts, prevIdx) : 0) + accumDeprPrev;

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

    const kpiCards: AssetsKpiCard[] = [
      {
        label: 'TOTAL ASSETS', value: rp(totalNow), subValue: `Jan\u2013${NAMA_BULAN[lastIdx]} ${tahun} YTD`,
        change: pctChange(totalNow, totalPrev), changeLabel: 'vs prev period', sparkData: sparkline(aset), status: 'neutral',
      },
      {
        label: 'CURRENT ASSETS', value: rp(currentNow),
        subValue: totalNow > 0 ? `${Math.round((currentNow / totalNow) * 1000) / 10}% of total assets` : '',
        change: pctChange(currentNow, currentPrev), changeLabel: 'vs prev period', sparkData: sparkline(currentAssets), status: 'neutral',
      },
      {
        label: 'NON-CURRENT ASSETS', value: rp(nonCurrentNow),
        subValue: totalNow > 0 ? `${Math.round((nonCurrentNow / totalNow) * 1000) / 10}% of total assets` : '',
        change: pctChange(nonCurrentNow, nonCurrentPrev), changeLabel: 'vs prev period', sparkData: sparkline(nonCurrentAssets), status: 'neutral',
      },
      {
        label: 'CASH & BANK', value: rp(cashNow), subValue: '',
        change: pctChange(cashNow, cashPrev), changeLabel: 'vs prev period', sparkData: sparkline(cashAccounts), status: 'neutral',
      },
      {
        label: 'ACCOUNTS RECEIVABLE', value: rp(arNow), subValue: '',
        change: pctChange(arNow, arPrev), changeLabel: 'vs prev period', sparkData: sparkline(arAccounts),
        status: pctChange(arNow, arPrev) < 0 ? 'negative' : 'neutral', highlight: pctChange(arNow, arPrev) < 0,
      },
      {
        label: 'INVENTORY', value: rp(invNow), subValue: '',
        change: pctChange(invNow, invPrev), changeLabel: 'vs prev period', sparkData: sparkline(inventoryAccounts), status: 'neutral',
      },
      {
        label: 'FIXED ASSETS (NET)', value: rp(fixedNetNow), subValue: 'After accumulated depreciation',
        change: pctChange(fixedNetNow, fixedNetPrev), changeLabel: 'vs prev period', sparkData: sparkline(fixedAssetAccounts), status: 'neutral',
      },
      {
        label: 'ACCUMULATED DEPRECIATION', value: rp(accumDeprNow),
        subValue: fixedGrossNow > 0 ? `${Math.round((Math.abs(accumDeprNow) / fixedGrossNow) * 1000) / 10}% of gross fixed assets` : '',
        change: pctChange(accumDeprNow, accumDeprPrev), changeLabel: 'vs prev period', sparkData: sparkline(accumDeprAccounts), status: 'warning',
      },
    ];

    const trendData: AssetsTrendRow[] = [];
    for (let i = 0; i <= lastIdx; i++) {
      trendData.push({
        month: NAMA_BULAN[i],
        total: bulatkanJuta(sumAt(aset, i)),
        current: bulatkanJuta(sumAt(currentAssets, i)),
        nonCurrent: bulatkanJuta(sumAt(nonCurrentAssets, i)),
      });
    }

    // Komposisi: kelompokkan per sub_kategori/nama akun (label sama seperti
    // grouping di Balance Sheet), ambil 6 terbesar + sisanya jadi "Other Assets".
    const byLabel: Record<string, number> = {};
    for (const a of aset) {
      const label = (a.subKategori && a.subKategori.trim()) || a.namaAkun || 'Lainnya';
      byLabel[label] = (byLabel[label] || 0) + (a.perBulan[lastIdx] || 0);
    }
    const sorted = Object.entries(byLabel).filter(([, v]) => Math.abs(v) > 1).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const restTotal = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    const compositionRows = restTotal > 1 ? [...top, ['Other Assets', restTotal] as [string, number]] : top;
    const compTotal = compositionRows.reduce((s, [, v]) => s + v, 0) || 1;
    const compositionData: AssetsCompositionSlice[] = compositionRows.map(([name, v], i) => ({
      name,
      value: bulatkanJuta(v),
      pct: Math.round((v / compTotal) * 1000) / 10,
      color: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
    }));

    const periodLabel = `As of ${NAMA_BULAN[lastIdx]} 30, ${tahun}`;

    return { loading, isSampleData: false, companyName, periodLabel, totalAssets: totalNow, kpiCards, trendData, compositionData };
  }, [loading, isSampleData, companyName, data]);
}
