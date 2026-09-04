'use client';

// [BARU] Sambungkan halaman Financial Analytics ke data ASLI client aktif --
// pola koneksinya SAMA seperti useProfitLossData.ts / useBalanceSheetData.ts
// (financial-statements, sudah duluan tersambung): baca `activeClientId` dari
// context global (src/lib/activeClient.tsx) -> fetch dari backend -> kalau
// belum ada client aktif / client belum punya jurnal sama sekali tahun ini,
// fallback ke data contoh yang sebelumnya hardcoded di tiap komponen --
// supaya halaman tidak pernah kosong.
//
// Sumber data backend (sama dengan financial-statements, lihat
// backend/modules/laporan_keuangan.py):
//   - GET/POST /api/client/{id}/laporan-bulanan/{tahun} -> trial_balance_bulanan
//     (saldo tiap akun per bulan, kumulatif) + laba_rugi_bulanan.
//   - GET /api/client/{id}/coa -> field "sub_kategori" per akun.
//
// [PENTING -- keterbatasan yang SENGAJA dibiarkan best-effort, sama seperti
// hook financial-statements lainnya]
// 1) Backend cuma punya 1 tahun trial_balance_bulanan berjalan -- jadi semua
//    perbandingan "previous" di sini adalah BULAN SEBELUMNYA (MoM), BUKAN
//    tahun sebelumnya (YoY) seperti versi mock lama. `comparisonLabel` di
//    bawah dipakai komponen utk menyesuaikan teks label secara otomatis.
// 2) Tidak ada dimensi "per customer" / "per product" di jurnal/GL backend
//    (sama seperti catatan REVENUE_BY_CUSTOMER di useProfitLossData.ts) --
//    jadi Revenue Drivers tab Customer & Product TETAP pakai data contoh;
//    hanya tab Category yang tersambung (diturunkan dari sub_kategori COA,
//    sama seperti REVENUE_BY_CATEGORY di Profit & Loss).
// 3) "Total Debt" / Debt-to-Equity / Debt Ratio di sini memakai TOTAL
//    LIABILITAS (bukan cuma akun pinjaman/loan) sebagai pembilang -- backend
//    tidak punya kategori baku "Debt" vs "Non-Debt Liabilities" (mis. Tax
//    Payable, Accrued Expenses ikut masuk Liabilitas biasa), jadi dipakai
//    definisi D/E yang lebih luas (Total Liabilities / Equity) supaya tidak
//    ada liabilitas yang "hilang" dari perhitungan.
// 4) Financial Health Score (5 dimensi) dihitung dari rasio ASLI di atas
//    lewat rumus skor sederhana (target-based) -- ini INDIKATOR KASAR, bukan
//    skor baku industri, sama sifatnya dengan skor 88/92/79/74/83 di versi
//    mock sebelumnya.
// 5) Customer Analytics, Performance Matrix, Trend Explorer, Anomaly
//    Detection, dan Financial AI Insights TIDAK disambungkan di sini --
//    kontennya butuh dimensi per-customer atau analisis/judgment (AI-
//    generated insight) yang belum ada sumber data terstrukturnya lewat API
//    saat ini. Tetap pakai data contoh, sama seperti PL_AI_INSIGHTS di P&L.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';
import { COMPANY } from '@/lib/financialData';

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface AnalyticsMetric { current: number; previous: number; }
export interface DriverItem { id: string; name: string; current: number; previous: number; growth: number; contribution: number; }
export interface MonthlyAnalyticsRow {
  month: string; grossMargin: number; ebitdaMargin: number; netMargin: number;
  currentRatio: number; quickRatio: number; debtToEquity: number; debtRatio: number; dso: number; dpo: number;
}
export interface HealthDimension { label: string; score: number; detail: string; icon: string; color: string; }
export interface MonthlyAbsoluteRow {
  month: string;
  revenue: number; cogs: number; grossProfit: number; ebitda: number; netProfit: number;
  cash: number; ar: number; ap: number; assets: number; liabilities: number; equity: number;
}

interface AnalyticsData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string;
  periodLabel: string;
  comparisonLabel: string;
  margins: {
    gross: AnalyticsMetric; ebitda: AnalyticsMetric; ebit: AnalyticsMetric; net: AnalyticsMetric;
    roa: AnalyticsMetric; roe: AnalyticsMetric;
  };
  liquidity: {
    currentRatio: AnalyticsMetric; quickRatio: AnalyticsMetric; cashRatio: AnalyticsMetric;
    workingCapital: AnalyticsMetric; cashRunwayMonths: AnalyticsMetric;
  };
  solvency: {
    debtToEquity: AnalyticsMetric; debtRatio: AnalyticsMetric; interestCoverage: AnalyticsMetric; totalDebt: AnalyticsMetric;
  };
  efficiency: {
    assetTurnover: AnalyticsMetric; dso: AnalyticsMetric; dpo: AnalyticsMetric; cashConversionCycle: AnalyticsMetric;
  };
  growth: {
    revenue: number; grossProfit: number; ebitda: number; netProfit: number; assets: number; equity: number;
  };
  // [BARU] Nilai absolut (Rp Juta, bulanan -- current = bulan berjalan
  // terakhir, previous = bulan sebelumnya) -- dipakai Performance Matrix
  // yang butuh angka Rupiah, bukan cuma rasio/margin %. Konsisten dengan
  // `workingCapital`/`totalDebt` di atas yang juga sudah pakai Rp Juta.
  absolutes: {
    revenue: AnalyticsMetric; grossProfit: AnalyticsMetric; ebitda: AnalyticsMetric; netProfit: AnalyticsMetric;
    cash: AnalyticsMetric; ar: AnalyticsMetric; ap: AnalyticsMetric;
  };
  monthlyTrend: MonthlyAnalyticsRow[];
  // [BARU] Tren bulanan nilai ABSOLUT (Rp Juta) -- dipakai Trend Explorer,
  // yang butuh Revenue/COGS/GP/EBITDA/NP/Cash/AR/AP/Assets/Liabilities/
  // Equity per bulan (bukan rasio/margin % seperti `monthlyTrend` di atas).
  monthlyAbsoluteTrend: MonthlyAbsoluteRow[];
  revenueByCategory: DriverItem[];
  expenseBreakdown: DriverItem[];
  healthDimensions: HealthDimension[];
  overallHealthScore: number;
}

type EmberBeban = 'cogs' | 'da' | 'interest' | 'tax' | 'opex';

function klasifikasiBeban(subKategori: string | null | undefined, namaAkun: string | null | undefined): EmberBeban {
  const teks = `${subKategori || ''} ${namaAkun || ''}`.toLowerCase();
  if (/(harga pokok|hpp|cogs|produksi|bahan baku)/.test(teks)) return 'cogs';
  if (/(penyusutan|depresiasi|amortisasi|depreciation|amortization)/.test(teks)) return 'da';
  if (/(beban bunga|biaya bunga|interest expense|bunga pinjaman|bunga bank)/.test(teks)) return 'interest';
  if (/(pajak penghasilan|pph badan|income tax|pph *29|pph *25)/.test(teks)) return 'tax';
  return 'opex';
}

function klasifikasiAset(subKategori: string | null | undefined, namaAkun: string | null | undefined): 'current' | 'nonCurrent' {
  const teks = `${subKategori || ''} ${namaAkun || ''}`.toLowerCase();
  if (/(tidak lancar|non.?lancar|aset tetap|tak berwujud|jangka panjang)/.test(teks)) return 'nonCurrent';
  if (/lancar/.test(teks)) return 'current';
  return 'nonCurrent';
}

function isKas(subKategori: string | null | undefined, namaAkun: string | null | undefined): boolean {
  return /(^|\s)(kas|bank|cash)(\s|$)/.test(`${subKategori || ''} ${namaAkun || ''}`.toLowerCase());
}
function isPiutang(subKategori: string | null | undefined, namaAkun: string | null | undefined): boolean {
  return /piutang/.test(`${subKategori || ''} ${namaAkun || ''}`.toLowerCase());
}
function isPersediaan(subKategori: string | null | undefined, namaAkun: string | null | undefined): boolean {
  return /(persediaan|inventory|stok)/.test(`${subKategori || ''} ${namaAkun || ''}`.toLowerCase());
}
function isHutangUsaha(subKategori: string | null | undefined, namaAkun: string | null | undefined): boolean {
  return /(hutang usaha|utang usaha|payable)/.test(`${subKategori || ''} ${namaAkun || ''}`.toLowerCase());
}

function labelKategori(subKategori: string | null | undefined, namaAkun: string | null | undefined): string {
  return (subKategori && subKategori.trim()) || namaAkun || 'Lainnya';
}

function bulatkanJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

function growthPct(current: number, previous: number): number {
  if (Math.abs(previous) < 0.01) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function scoreHigherBetter(value: number, target: number): number {
  if (!isFinite(value)) return 0;
  if (target <= 0) return 50;
  const pct = Math.min(value / target, 1.5) * 70 + 15;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
function scoreLowerBetter(value: number, target: number): number {
  if (!isFinite(value)) return 0;
  if (value <= 0) return 90;
  if (target <= 0) return 50;
  const pct = Math.min(target / value, 1.5) * 70 + 15;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

interface AkunInfo { noAkun: string; namaAkun: string; subKategori: string | null; perBulan: number[]; }

function hitungAnalytics(hasil: any, coa: any[], tahun: number) {
  if (!hasil?.trial_balance_bulanan || !hasil?.laba_rugi_bulanan) return null;

  const petaCoa: Record<string, any> = {};
  for (const akun of coa || []) {
    if (akun?.no_akun) petaCoa[String(akun.no_akun)] = akun;
  }

  const { trial_balance_bulanan, laba_rugi_bulanan } = hasil;
  const totalPendapatanYtd: number[] = laba_rugi_bulanan.total_pendapatan_ytd || [];
  const totalBebanYtd: number[] = laba_rugi_bulanan.total_beban_ytd || [];
  const totalPendapatanBulanan: number[] = laba_rugi_bulanan.total_pendapatan_bulanan || [];
  const labaBersihYtd: number[] = laba_rugi_bulanan.laba_bersih_ytd || [];

  let lastIdx = -1;
  for (let i = 0; i < 12; i++) {
    if ((totalPendapatanYtd[i] || 0) > 0.01 || (totalBebanYtd[i] || 0) > 0.01) lastIdx = i;
  }
  if (lastIdx === -1) return null;

  const akunPendapatan: AkunInfo[] = [];
  const akunBeban: (AkunInfo & { ember: EmberBeban })[] = [];
  const akunAset: AkunInfo[] = [];
  const akunLiabilitas: AkunInfo[] = [];
  const akunEkuitas: AkunInfo[] = [];

  for (const [noAkun, infoRaw] of Object.entries<any>(trial_balance_bulanan)) {
    const coaInfo = petaCoa[noAkun] || {};
    const subKategori: string | null = coaInfo.sub_kategori || null;
    const perBulan: number[] = infoRaw.per_bulan || [];
    const namaAkun: string = infoRaw.nama_akun || noAkun;
    const entri: AkunInfo = { noAkun, namaAkun, subKategori, perBulan };
    if (infoRaw.kategori === 'PENDAPATAN') akunPendapatan.push(entri);
    else if (infoRaw.kategori === 'BEBAN') akunBeban.push({ ...entri, ember: klasifikasiBeban(subKategori, namaAkun) });
    else if (infoRaw.kategori === 'ASET') akunAset.push(entri);
    else if (infoRaw.kategori === 'LIABILITAS') akunLiabilitas.push(entri);
    else if (infoRaw.kategori === 'EKUITAS') akunEkuitas.push(entri);
  }

  const deltaBulan = (perBulan: number[], i: number) => (perBulan[i] || 0) - (i > 0 ? perBulan[i - 1] || 0 : 0);
  const prevIdx = lastIdx > 0 ? lastIdx - 1 : -1;

  // ── P&L (bulanan, dihitung utk tiap bulan 0..lastIdx) ──
  const monthlyPL: { revenue: number; cogs: number; grossProfit: number; opEx: number; ebitda: number; da: number; ebit: number; interest: number; tax: number; netProfit: number }[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const ember = { cogs: 0, da: 0, interest: 0, tax: 0, opex: 0 };
    for (const a of akunBeban) ember[a.ember] += deltaBulan(a.perBulan, i);
    const revenue = totalPendapatanBulanan[i] || 0;
    const { cogs, da, interest, tax, opex: opEx } = ember;
    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - opEx;
    const ebit = ebitda - da;
    const netProfit = revenue - (cogs + opEx + da + interest + tax);
    monthlyPL.push({ revenue, cogs, grossProfit, opEx, ebitda, da, ebit, interest, tax, netProfit });
  }

  // ── Neraca (kumulatif per bulan 0..lastIdx) ──
  const monthlyBS: { cash: number; ar: number; inventory: number; otherCurrentAssets: number; totalCurrentAssets: number; totalAssets: number; ap: number; otherCurrentLiab: number; totalCurrentLiab: number; totalLiabilities: number; totalEquity: number }[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    let cash = 0, ar = 0, inventory = 0, currentAssets = 0, nonCurrentAssets = 0;
    for (const a of akunAset) {
      const v = a.perBulan[i] || 0;
      if (klasifikasiAset(a.subKategori, a.namaAkun) === 'current') {
        currentAssets += v;
        if (isKas(a.subKategori, a.namaAkun)) cash += v;
        else if (isPiutang(a.subKategori, a.namaAkun)) ar += v;
        else if (isPersediaan(a.subKategori, a.namaAkun)) inventory += v;
      } else {
        nonCurrentAssets += v;
      }
    }
    let ap = 0, currentLiab = 0, nonCurrentLiab = 0;
    for (const l of akunLiabilitas) {
      const v = l.perBulan[i] || 0;
      const teks = `${l.subKategori || ''} ${l.namaAkun || ''}`.toLowerCase();
      const isNonCurrent = /(jangka panjang|tidak lancar|non.?lancar)/.test(teks);
      if (isNonCurrent) {
        nonCurrentLiab += v;
      } else {
        currentLiab += v;
        if (isHutangUsaha(l.subKategori, l.namaAkun)) ap += v;
      }
    }
    const equityAccounts = akunEkuitas.reduce((s, a) => s + (a.perBulan[i] || 0), 0);
    const totalEquity = equityAccounts + (labaBersihYtd[i] || 0);
    monthlyBS.push({
      cash, ar, inventory, otherCurrentAssets: currentAssets - cash - ar - inventory,
      totalCurrentAssets: currentAssets, totalAssets: currentAssets + nonCurrentAssets,
      ap, otherCurrentLiab: currentLiab - ap, totalCurrentLiab: currentLiab,
      totalLiabilities: currentLiab + nonCurrentLiab, totalEquity,
    });
  }

  const pl = monthlyPL[lastIdx];
  const plPrev = prevIdx >= 0 ? monthlyPL[prevIdx] : null;
  const bs = monthlyBS[lastIdx];
  const bsPrev = prevIdx >= 0 ? monthlyBS[prevIdx] : null;

  // YTD revenue/cogs/opex dipakai utk anualisasi (DSO/DPO/Asset Turnover) --
  // lebih akurat drpd revenue satu bulan saja.
  const revenueYtd = totalPendapatanYtd[lastIdx] || 0;
  const emberYtd = { cogs: 0, da: 0, interest: 0, tax: 0, opex: 0 };
  for (const a of akunBeban) emberYtd[a.ember] += a.perBulan[lastIdx] || 0;
  const bulanBerjalan = lastIdx + 1;
  const annualRevenue = (revenueYtd / bulanBerjalan) * 12;
  const annualCogs = (emberYtd.cogs / bulanBerjalan) * 12;
  const netProfitYtd = revenueYtd - (emberYtd.cogs + emberYtd.opex + emberYtd.da + emberYtd.interest + emberYtd.tax);

  const netProfitYtdPrev = prevIdx >= 0 ? (labaBersihYtd[prevIdx] ?? null) : null;

  const metric = (cur: number, prev: number | null): AnalyticsMetric => ({ current: cur, previous: prev ?? cur });

  const grossMarginPct = (rev: number, gp: number) => (rev ? (gp / rev) * 100 : 0);
  const ebitdaMarginPct = (rev: number, e: number) => (rev ? (e / rev) * 100 : 0);
  const ebitMarginPct = (rev: number, e: number) => (rev ? (e / rev) * 100 : 0);
  const netMarginPct = (rev: number, np: number) => (rev ? (np / rev) * 100 : 0);

  const margins = {
    gross: metric(grossMarginPct(pl.revenue, pl.grossProfit), plPrev ? grossMarginPct(plPrev.revenue, plPrev.grossProfit) : null),
    ebitda: metric(ebitdaMarginPct(pl.revenue, pl.ebitda), plPrev ? ebitdaMarginPct(plPrev.revenue, plPrev.ebitda) : null),
    ebit: metric(ebitMarginPct(pl.revenue, pl.ebit), plPrev ? ebitMarginPct(plPrev.revenue, plPrev.ebit) : null),
    net: metric(netMarginPct(pl.revenue, pl.netProfit), plPrev ? netMarginPct(plPrev.revenue, plPrev.netProfit) : null),
    roa: metric(bs.totalAssets ? (netProfitYtd / bs.totalAssets) * 100 : 0, bsPrev && netProfitYtdPrev !== null && bsPrev.totalAssets ? (netProfitYtdPrev / bsPrev.totalAssets) * 100 : null),
    roe: metric(bs.totalEquity ? (netProfitYtd / bs.totalEquity) * 100 : 0, bsPrev && netProfitYtdPrev !== null && bsPrev.totalEquity ? (netProfitYtdPrev / bsPrev.totalEquity) * 100 : null),
  };

  const currentRatioOf = (b: typeof bs) => (b.ap ? b.totalCurrentAssets / (b.totalCurrentLiab || 1) : b.totalCurrentAssets ? Infinity : 0);
  const quickRatioOf = (b: typeof bs) => ((b.cash + b.ar) / (b.totalCurrentLiab || 1));
  const cashRatioOf = (b: typeof bs) => (b.cash / (b.totalCurrentLiab || 1));

  const monthlyOpExAvg = (emberYtd.opex + emberYtd.cogs === 0 ? 0 : (emberYtd.opex + emberYtd.cogs + emberYtd.da + emberYtd.interest + emberYtd.tax)) / bulanBerjalan;

  const liquidity = {
    currentRatio: metric(bs.totalCurrentLiab ? bs.totalCurrentAssets / bs.totalCurrentLiab : 0, bsPrev?.totalCurrentLiab ? bsPrev.totalCurrentAssets / bsPrev.totalCurrentLiab : null),
    quickRatio: metric(bs.totalCurrentLiab ? (bs.cash + bs.ar) / bs.totalCurrentLiab : 0, bsPrev?.totalCurrentLiab ? (bsPrev.cash + bsPrev.ar) / bsPrev.totalCurrentLiab : null),
    cashRatio: metric(bs.totalCurrentLiab ? bs.cash / bs.totalCurrentLiab : 0, bsPrev?.totalCurrentLiab ? bsPrev.cash / bsPrev.totalCurrentLiab : null),
    workingCapital: metric(bulatkanJuta(bs.totalCurrentAssets - bs.totalCurrentLiab), bsPrev ? bulatkanJuta(bsPrev.totalCurrentAssets - bsPrev.totalCurrentLiab) : null),
    cashRunwayMonths: metric(monthlyOpExAvg > 0 ? bs.cash / monthlyOpExAvg : 0, null),
  };

  const solvency = {
    debtToEquity: metric(bs.totalEquity ? bs.totalLiabilities / bs.totalEquity : 0, bsPrev?.totalEquity ? bsPrev.totalLiabilities / bsPrev.totalEquity : null),
    debtRatio: metric(bs.totalAssets ? bs.totalLiabilities / bs.totalAssets : 0, bsPrev?.totalAssets ? bsPrev.totalLiabilities / bsPrev.totalAssets : null),
    interestCoverage: metric(pl.interest > 0.01 ? pl.ebitda / pl.interest : (pl.ebitda > 0 ? 99 : 0), plPrev && plPrev.interest > 0.01 ? plPrev.ebitda / plPrev.interest : null),
    totalDebt: metric(bulatkanJuta(bs.totalLiabilities), bsPrev ? bulatkanJuta(bsPrev.totalLiabilities) : null),
  };

  const dsoOf = (ar: number) => (annualRevenue > 0.01 ? (ar / annualRevenue) * 365 : 0);
  const dpoOf = (ap: number) => (annualCogs > 0.01 ? (ap / annualCogs) * 365 : 0);
  const efficiency = {
    assetTurnover: metric(bs.totalAssets ? annualRevenue / bs.totalAssets : 0, null),
    dso: metric(dsoOf(bs.ar), null),
    dpo: metric(dpoOf(bs.ap), null),
    cashConversionCycle: metric(dsoOf(bs.ar) - dpoOf(bs.ap), null),
  };

  const growth = {
    revenue: plPrev ? growthPct(pl.revenue, plPrev.revenue) : 0,
    grossProfit: plPrev ? growthPct(pl.grossProfit, plPrev.grossProfit) : 0,
    ebitda: plPrev ? growthPct(pl.ebitda, plPrev.ebitda) : 0,
    netProfit: plPrev ? growthPct(pl.netProfit, plPrev.netProfit) : 0,
    assets: bsPrev ? growthPct(bs.totalAssets, bsPrev.totalAssets) : 0,
    equity: bsPrev ? growthPct(bs.totalEquity, bsPrev.totalEquity) : 0,
  };

  // ── Monthly trend (bulan 0..lastIdx, dipakai chart) ──
  const monthlyTrend: MonthlyAnalyticsRow[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const p = monthlyPL[i];
    const b = monthlyBS[i];
    monthlyTrend.push({
      month: NAMA_BULAN[i],
      grossMargin: Math.round(grossMarginPct(p.revenue, p.grossProfit) * 10) / 10,
      ebitdaMargin: Math.round(ebitdaMarginPct(p.revenue, p.ebitda) * 10) / 10,
      netMargin: Math.round(netMarginPct(p.revenue, p.netProfit) * 10) / 10,
      currentRatio: Math.round(currentRatioOf(b) * 100) / 100,
      quickRatio: Math.round(quickRatioOf(b) * 100) / 100,
      debtToEquity: b.totalEquity ? Math.round((b.totalLiabilities / b.totalEquity) * 100) / 100 : 0,
      debtRatio: b.totalAssets ? Math.round((b.totalLiabilities / b.totalAssets) * 1000) / 1000 : 0,
      dso: Math.round(cashRatioOf(b) >= 0 ? dsoOf(b.ar) : 0),
      dpo: Math.round(dpoOf(b.ap)),
    });
  }

  // ── Tren bulanan nilai absolut (Rp Juta) -- dipakai Trend Explorer ──
  const monthlyAbsoluteTrend: MonthlyAbsoluteRow[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const p = monthlyPL[i];
    const b = monthlyBS[i];
    monthlyAbsoluteTrend.push({
      month: NAMA_BULAN[i],
      revenue: bulatkanJuta(p.revenue), cogs: bulatkanJuta(p.cogs), grossProfit: bulatkanJuta(p.grossProfit),
      ebitda: bulatkanJuta(p.ebitda), netProfit: bulatkanJuta(p.netProfit),
      cash: bulatkanJuta(b.cash), ar: bulatkanJuta(b.ar), ap: bulatkanJuta(b.ap),
      assets: bulatkanJuta(b.totalAssets), liabilities: bulatkanJuta(b.totalLiabilities), equity: bulatkanJuta(b.totalEquity),
    });
  }

  // ── Revenue by category (dari akun PENDAPATAN, sub_kategori) ──
  const buatDriver = (akunList: AkunInfo[]): DriverItem[] => {
    const petaCurrent: Record<string, number> = {};
    const petaPrev: Record<string, number> = {};
    for (const a of akunList) {
      const key = labelKategori(a.subKategori, a.namaAkun);
      petaCurrent[key] = (petaCurrent[key] || 0) + (a.perBulan[lastIdx] || 0);
      petaPrev[key] = (petaPrev[key] || 0) + (prevIdx >= 0 ? (a.perBulan[prevIdx] || 0) : 0);
    }
    const total = Object.values(petaCurrent).reduce((s, v) => s + v, 0);
    return Object.keys(petaCurrent)
      .filter((k) => Math.abs(petaCurrent[k]) > 1)
      .map((k) => ({
        id: k, name: k,
        current: bulatkanJuta(petaCurrent[k]), previous: bulatkanJuta(petaPrev[k]),
        growth: growthPct(petaCurrent[k], petaPrev[k]),
        contribution: total !== 0 ? Math.round((petaCurrent[k] / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.current - a.current);
  };

  const revenueByCategory = buatDriver(akunPendapatan);
  const expenseBreakdown = buatDriver(akunBeban.filter((a) => a.ember === 'opex'));

  const periodLabel = lastIdx === 0 ? `${NAMA_BULAN[0]} ${tahun}` : `${NAMA_BULAN[0]} ${tahun} – ${NAMA_BULAN[lastIdx]} ${tahun}`;

  const absolutes = {
    revenue: metric(bulatkanJuta(pl.revenue), plPrev ? bulatkanJuta(plPrev.revenue) : null),
    grossProfit: metric(bulatkanJuta(pl.grossProfit), plPrev ? bulatkanJuta(plPrev.grossProfit) : null),
    ebitda: metric(bulatkanJuta(pl.ebitda), plPrev ? bulatkanJuta(plPrev.ebitda) : null),
    netProfit: metric(bulatkanJuta(pl.netProfit), plPrev ? bulatkanJuta(plPrev.netProfit) : null),
    cash: metric(bulatkanJuta(bs.cash), bsPrev ? bulatkanJuta(bsPrev.cash) : null),
    ar: metric(bulatkanJuta(bs.ar), bsPrev ? bulatkanJuta(bsPrev.ar) : null),
    ap: metric(bulatkanJuta(bs.ap), bsPrev ? bulatkanJuta(bsPrev.ap) : null),
  };

  return {
    periodLabel, margins, liquidity, solvency, efficiency, growth, absolutes, monthlyTrend, monthlyAbsoluteTrend, revenueByCategory, expenseBreakdown,
  };
}

function buildHealthDimensions(computed: NonNullable<ReturnType<typeof hitungAnalytics>>): { dims: HealthDimension[]; overall: number } {
  const { margins, liquidity, solvency, efficiency, growth } = computed;
  const profitabilityScore = Math.round((scoreHigherBetter(margins.net.current, 15) + scoreHigherBetter(margins.ebitda.current, 20)) / 2);
  const liquidityScore = scoreHigherBetter(liquidity.currentRatio.current, 2.0);
  const solvencyScore = Math.round((scoreLowerBetter(solvency.debtToEquity.current, 0.5) + scoreHigherBetter(solvency.interestCoverage.current, 5)) / 2);
  const efficiencyScore = Math.round((scoreLowerBetter(efficiency.cashConversionCycle.current, 30) + scoreHigherBetter(efficiency.assetTurnover.current, 1.0)) / 2);
  const growthScore = scoreHigherBetter(growth.revenue, 2);

  const dims: HealthDimension[] = [
    { label: 'Profitability', score: profitabilityScore, icon: 'ChartBarIcon', color: 'text-positive', detail: `Net Margin ${margins.net.current.toFixed(1)}%, EBITDA ${margins.ebitda.current.toFixed(1)}%` },
    { label: 'Liquidity', score: liquidityScore, icon: 'BanknotesIcon', color: 'text-chart-2', detail: `Current Ratio ${liquidity.currentRatio.current.toFixed(2)}, Cash Runway ${liquidity.cashRunwayMonths.current.toFixed(1)}mo` },
    { label: 'Solvency', score: solvencyScore, icon: 'ScaleIcon', color: 'text-chart-3', detail: `D/E ${solvency.debtToEquity.current.toFixed(2)}, Interest Coverage ${solvency.interestCoverage.current.toFixed(1)}x` },
    { label: 'Efficiency', score: efficiencyScore, icon: 'ArrowPathIcon', color: 'text-chart-4', detail: `DSO ${efficiency.dso.current.toFixed(1)}d, DPO ${efficiency.dpo.current.toFixed(1)}d` },
    { label: 'Growth', score: growthScore, icon: 'ArrowTrendingUpIcon', color: 'text-chart-5', detail: `Revenue ${growth.revenue >= 0 ? '+' : ''}${growth.revenue.toFixed(1)}%, NP ${growth.netProfit >= 0 ? '+' : ''}${growth.netProfit.toFixed(1)}%` },
  ];
  const overall = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
  return { dims, overall };
}

// ── Data contoh (fallback) -- dipakai saat belum ada client aktif / belum
// ada jurnal sama sekali, supaya nilai yang tampil SAMA seperti versi mock
// sebelumnya (tidak ada regresi tampilan saat demo tanpa data asli). ──
const SAMPLE: Omit<AnalyticsData, 'loading' | 'isSampleData' | 'companyName'> = {
  periodLabel: COMPANY.period,
  comparisonLabel: 'vs Previous Year',
  margins: {
    gross: { current: 44.2, previous: 42.8 }, ebitda: { current: 27.4, previous: 25.9 },
    ebit: { current: 25.9, previous: 24.3 }, net: { current: 21.9, previous: 20.1 },
    roa: { current: 14.4, previous: 12.8 }, roe: { current: 21.4, previous: 18.2 },
  },
  liquidity: {
    currentRatio: { current: 2.41, previous: 2.18 }, quickRatio: { current: 2.12, previous: 1.94 },
    cashRatio: { current: 1.35, previous: 1.18 }, workingCapital: { current: 4192, previous: 3720 },
    cashRunwayMonths: { current: 9.4, previous: 8.6 },
  },
  solvency: {
    debtToEquity: { current: 0.21, previous: 0.24 }, debtRatio: { current: 0.14, previous: 0.15 },
    interestCoverage: { current: 27.5, previous: 22.1 }, totalDebt: { current: 1800, previous: 1860 },
  },
  efficiency: {
    assetTurnover: { current: 1.42, previous: 1.28 }, dso: { current: 53.8, previous: 56.2 },
    dpo: { current: 66.8, previous: 64.1 }, cashConversionCycle: { current: -13.0, previous: -7.9 },
  },
  growth: { revenue: 12.8, grossProfit: 15.2, ebitda: 18.4, netProfit: 16.2, assets: 8.4, equity: 11.6 },
  absolutes: {
    revenue: { current: 842, previous: 747 }, grossProfit: { current: 372, previous: 319 },
    ebitda: { current: 231, previous: 195 }, netProfit: { current: 184, previous: 158 },
    cash: { current: 296, previous: 248 }, ar: { current: 124, previous: 108 }, ap: { current: 86, previous: 78 },
  },
  monthlyTrend: [
    { month: 'Jan', grossMargin: 42.1, ebitdaMargin: 22.1, netMargin: 19.8, currentRatio: 2.12, quickRatio: 1.88, debtToEquity: 0.26, debtRatio: 0.16, dso: 56, dpo: 62 },
    { month: 'Feb', grossMargin: 43.2, ebitdaMargin: 23.4, netMargin: 19.4, currentRatio: 2.18, quickRatio: 1.94, debtToEquity: 0.25, debtRatio: 0.15, dso: 54, dpo: 64 },
    { month: 'Mar', grossMargin: 45.1, ebitdaMargin: 24.8, netMargin: 18.2, currentRatio: 2.24, quickRatio: 1.98, debtToEquity: 0.24, debtRatio: 0.15, dso: 55, dpo: 68 },
    { month: 'Apr', grossMargin: 44.6, ebitdaMargin: 23.2, netMargin: 18.2, currentRatio: 2.19, quickRatio: 1.92, debtToEquity: 0.23, debtRatio: 0.14, dso: 58, dpo: 66 },
    { month: 'May', grossMargin: 45.1, ebitdaMargin: 25.1, netMargin: 18.5, currentRatio: 2.31, quickRatio: 2.04, debtToEquity: 0.22, debtRatio: 0.14, dso: 52, dpo: 70 },
    { month: 'Jun', grossMargin: 44.9, ebitdaMargin: 26.4, netMargin: 17.9, currentRatio: 2.38, quickRatio: 2.12, debtToEquity: 0.22, debtRatio: 0.14, dso: 51, dpo: 68 },
    { month: 'Jul', grossMargin: 45.1, ebitdaMargin: 27.1, netMargin: 17.9, currentRatio: 2.35, quickRatio: 2.08, debtToEquity: 0.21, debtRatio: 0.14, dso: 54, dpo: 67 },
    { month: 'Aug', grossMargin: 44.3, ebitdaMargin: 28.2, netMargin: 20.1, currentRatio: 2.41, quickRatio: 2.12, debtToEquity: 0.21, debtRatio: 0.14, dso: 54, dpo: 67 },
  ],
  monthlyAbsoluteTrend: [
    { month: "Sep'25", revenue: 680, cogs: 374, grossProfit: 306, ebitda: 176, netProfit: 138, cash: 2420, ar: 1020, ap: 780, assets: 11800, liabilities: 4100, equity: 7700 },
    { month: 'Oct', revenue: 712, cogs: 392, grossProfit: 320, ebitda: 188, netProfit: 148, cash: 2480, ar: 1060, ap: 800, assets: 11900, liabilities: 4120, equity: 7780 },
    { month: 'Nov', revenue: 748, cogs: 411, grossProfit: 337, ebitda: 198, netProfit: 158, cash: 2560, ar: 1120, ap: 820, assets: 12000, liabilities: 4140, equity: 7860 },
    { month: 'Dec', revenue: 692, cogs: 381, grossProfit: 311, ebitda: 172, netProfit: 132, cash: 2620, ar: 1080, ap: 810, assets: 12100, liabilities: 4160, equity: 7940 },
    { month: "Jan'26", revenue: 780, cogs: 429, grossProfit: 351, ebitda: 204, netProfit: 162, cash: 2700, ar: 1140, ap: 840, assets: 12200, liabilities: 4180, equity: 8020 },
    { month: 'Feb', revenue: 842, cogs: 463, grossProfit: 379, ebitda: 228, netProfit: 182, cash: 2780, ar: 1200, ap: 860, assets: 12400, liabilities: 4200, equity: 8200 },
    { month: 'Mar', revenue: 818, cogs: 450, grossProfit: 368, ebitda: 218, netProfit: 174, cash: 2840, ar: 1180, ap: 850, assets: 12500, liabilities: 4190, equity: 8310 },
    { month: 'Apr', revenue: 702, cogs: 386, grossProfit: 316, ebitda: 177, netProfit: 141, cash: 2960, ar: 1240, ap: 860, assets: 12800, liabilities: 4200, equity: 8600 },
    { month: 'May', revenue: 820, cogs: 451, grossProfit: 369, ebitda: 208, netProfit: 166, cash: 3020, ar: 1260, ap: 870, assets: 12900, liabilities: 4210, equity: 8690 },
    { month: 'Jun', revenue: 864, cogs: 475, grossProfit: 389, ebitda: 224, netProfit: 178, cash: 3080, ar: 1280, ap: 880, assets: 13000, liabilities: 4220, equity: 8780 },
    { month: 'Jul', revenue: 892, cogs: 490, grossProfit: 402, ebitda: 236, netProfit: 188, cash: 3140, ar: 1300, ap: 890, assets: 13100, liabilities: 4230, equity: 8870 },
    { month: 'Aug', revenue: 920, cogs: 506, grossProfit: 414, ebitda: 244, netProfit: 196, cash: 3200, ar: 1320, ap: 900, assets: 13200, liabilities: 4240, equity: 8960 },
  ],
  revenueByCategory: [
    { id: 'cat-1', name: 'Recurring Revenue', current: 5820, previous: 4924, growth: 18.2, contribution: 69.1 },
    { id: 'cat-2', name: 'Project Revenue', current: 1840, previous: 1756, growth: 4.8, contribution: 21.8 },
    { id: 'cat-3', name: 'One-time Revenue', current: 760, previous: 830, growth: -8.4, contribution: 9.0 },
  ],
  expenseBreakdown: [
    { id: 'exp-cogs', name: 'Cost of Revenue', current: 4700, previous: 4180, growth: 12.4, contribution: 79.9 },
    { id: 'exp-payroll', name: 'Payroll & Benefits', current: 598, previous: 542, growth: 10.3, contribution: 10.2 },
    { id: 'exp-tech', name: 'Technology & Infrastructure', current: 138, previous: 108, growth: 27.8, contribution: 2.3 },
    { id: 'exp-marketing', name: 'Marketing & Sales', current: 202, previous: 164, growth: 23.2, contribution: 3.4 },
    { id: 'exp-profsvc', name: 'Professional Services', current: 68, previous: 72, growth: -5.6, contribution: 1.2 },
    { id: 'exp-admin', name: 'Administration', current: 92, previous: 88, growth: 4.5, contribution: 1.6 },
    { id: 'exp-travel', name: 'Travel & Entertainment', current: 41, previous: 32, growth: 28.1, contribution: 0.7 },
    { id: 'exp-other', name: 'Other Operating', current: 27, previous: 28, growth: -3.6, contribution: 0.5 },
  ],
  healthDimensions: [
    { label: 'Profitability', score: 88, icon: 'ChartBarIcon', color: 'text-positive', detail: 'Net Margin 21.9%, EBITDA 27.4%' },
    { label: 'Liquidity', score: 92, icon: 'BanknotesIcon', color: 'text-chart-2', detail: 'Current Ratio 2.41, Cash Rp 2.96M' },
    { label: 'Solvency', score: 79, icon: 'ScaleIcon', color: 'text-chart-3', detail: 'D/E 0.21, Interest Coverage 27.5x' },
    { label: 'Efficiency', score: 74, icon: 'ArrowPathIcon', color: 'text-chart-4', detail: 'DSO 53.8d, DPO 66.8d' },
    { label: 'Growth', score: 83, icon: 'ArrowTrendingUpIcon', color: 'text-chart-5', detail: 'Revenue +12.8%, NP +16.2%' },
  ],
  overallHealthScore: 83,
};

export function useAnalyticsData(): AnalyticsData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState<ReturnType<typeof hitungAnalytics> | null>(null);
  const requestIdRef = useRef(0);

  const load = () => {
    if (!activeClientId) {
      setComputed(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const tahun = new Date().getFullYear();
    Promise.all([
      ambilCoaClient(activeClientId).catch(() => ({ coa: [] })),
      ambilLaporanBulanan(activeClientId, tahun).catch(() => generateLaporanBulanan(activeClientId, tahun)),
    ])
      .then(([coaRes, laporanRes]: any) => {
        if (requestIdRef.current !== requestId) return;
        const hasil = laporanRes?.hasil;
        const coa = coaRes?.coa || [];
        setComputed(hitungAnalytics(hasil, coa, tahun));
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setComputed(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  // [BARU] Auto-refresh begitu Agent AI selesai upload & auto-posting utk
  // client yang sedang aktif -- supaya Financial Analytics ikut ter-update
  // tanpa perlu ganti client / reload manual (sama seperti Transaksi).
  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  if (computed) {
    const { dims, overall } = buildHealthDimensions(computed);
    return {
      loading, isSampleData: false, companyName: activeClientName || COMPANY.name,
      comparisonLabel: 'vs Previous Month',
      ...computed,
      healthDimensions: dims, overallHealthScore: overall,
    };
  }

  return { loading, isSampleData: true, companyName: COMPANY.name, ...SAMPLE };
}