'use client';

// [BARU] Sambungkan halaman Profit & Loss ke data ASLI client aktif --
// sebelumnya halaman ini 100% pakai konstanta hardcoded dari
// src/lib/financialData.tsx. Pola koneksinya SAMA seperti
// src/app/components/KPIBentoGrid.tsx (Financial Overview) yang sudah
// duluan tersambung: baca `activeClientId` dari context global
// (src/lib/activeClient.tsx, dipasang di root layout) -> fetch dari
// backend -> kalau belum ada client aktif / client belum punya jurnal
// sama sekali tahun ini, fallback ke data contoh (financialData.tsx)
// supaya halaman tidak pernah kosong.
//
// Sumber data backend (lihat backend/modules/laporan_keuangan.py):
//   - GET/POST /api/client/{id}/laporan-bulanan/{tahun} (ambilLaporanBulanan
//     / generateLaporanBulanan di agent-ai/lib/api.js) -> trial_balance_bulanan
//     (saldo tiap akun per bulan, kumulatif YTD) + laba_rugi_bulanan
//     (total_pendapatan_ytd/total_beban_ytd/laba_bersih_ytd per bulan).
//   - GET /api/client/{id}/coa (ambilCoaClient) -> field "sub_kategori"
//     per akun, dipakai utk kelompokkan Revenue by Category & Expense
//     Breakdown, dan utk heuristik COGS/D&A/Interest/Tax di bawah.
//
// [PENTING -- keterbatasan yang SENGAJA dibiarkan best-effort]
// Backend cuma mengenal 2 kelompok Laba Rugi: PENDAPATAN & BEBAN --
// tidak ada kategori baku "COGS" vs "OpEx" vs "D&A" vs "Interest" vs
// "Income Tax" (itu murni tampilan/analisis, bukan skema akuntansi
// backend). Field "sub_kategori" di COA itu TEKS BEBAS per client (lihat
// db_client.py: "mis. Aset Lancar, Beban Operasional"), jadi
// klasifikasiBeban() di bawah cuma cocokkan KATA KUNCI -- best-effort,
// BUKAN sumber kebenaran akuntansi. Supaya tetap konsisten & tidak ada
// angka yang "hilang", OpEx dijadikan ember DEFAULT (menampung semua akun
// beban yang tidak cocok kata kunci lain) -- sehingga total
// cogs+opEx+da+interest+tax SELALU PERSIS = total beban asli dari
// backend, dan Revenue - Total Beban SELALU PERSIS = Net Profit resmi.
//
// REVENUE_BY_CUSTOMER, BUDGET_VS_ACTUAL, dan PL_AI_INSIGHTS TIDAK
// disambungkan di sini -- backend tidak (belum) punya dimensi "per
// customer" di jurnal/GL, dan tidak ada modul Budget/AI-insight utk P&L
// yang expose data terstruktur lewat API saat ini. Ketiganya tetap pakai
// data contoh (financialData.tsx) sampai ada sumber data yang jelas.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';
import {
  PL_CORE as MOCK_PL_CORE,
  MARGINS as MOCK_MARGINS,
  MONTHLY_PL as MOCK_MONTHLY_PL,
  REVENUE_BY_CATEGORY as MOCK_REVENUE_BY_CATEGORY,
  EXPENSE_BREAKDOWN as MOCK_EXPENSE_BREAKDOWN,
  COMPANY,
} from '@/lib/financialData';

export interface PLCoreValues {
  revenue: number; cogs: number; grossProfit: number; operatingExpenses: number;
  ebitda: number; da: number; ebit: number; interestExpense: number; ebt: number;
  incomeTax: number; netProfit: number;
}
export interface MarginValues { grossMargin: number; ebitdaMargin: number; ebitMargin: number; netMargin: number; }
export interface MonthlyPLRow {
  month: string; revenue: number; cogs: number; grossProfit: number; opEx: number;
  ebitda: number; da: number; ebit: number; interest: number; tax: number; netProfit: number;
}
export interface BreakdownItem { name: string; value: number; pct: number; }

interface ProfitLossData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string;
  periodLabel: string;
  PL_CORE: PLCoreValues;
  MARGINS: MarginValues;
  MONTHLY_PL: MonthlyPLRow[];
  REVENUE_BY_CATEGORY: BreakdownItem[];
  EXPENSE_BREAKDOWN: BreakdownItem[];
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type EmberBeban = 'cogs' | 'da' | 'interest' | 'tax' | 'opex';

function klasifikasiBeban(subKategori: string | null | undefined, namaAkun: string | null | undefined): EmberBeban {
  const teks = `${subKategori || ''} ${namaAkun || ''}`.toLowerCase();
  if (/(harga pokok|hpp|cogs|produksi|bahan baku)/.test(teks)) return 'cogs';
  if (/(penyusutan|depresiasi|amortisasi|depreciation|amortization)/.test(teks)) return 'da';
  if (/(beban bunga|biaya bunga|interest expense|bunga pinjaman|bunga bank)/.test(teks)) return 'interest';
  if (/(pajak penghasilan|pph badan|income tax|pph *29|pph *25)/.test(teks)) return 'tax';
  return 'opex';
}

function labelKategori(subKategori: string | null | undefined, namaAkun: string | null | undefined): string {
  return (subKategori && subKategori.trim()) || namaAkun || 'Lainnya';
}

function bulatkanJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 1000) / 10 : 0;
}

function buatBreakdown(map: Record<string, number>): BreakdownItem[] {
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  return Object.entries(map)
    .filter(([, v]) => Math.abs(v) > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value: bulatkanJuta(value),
      pct: total !== 0 ? Math.round((value / total) * 1000) / 10 : 0,
    }));
}

interface AkunBeban {
  noAkun: string; namaAkun: string; subKategori: string | null; perBulan: number[]; ember: EmberBeban;
}
interface AkunPendapatan {
  noAkun: string; namaAkun: string; subKategori: string | null; perBulan: number[];
}

function hitungDataProfitLoss(hasil: any, coa: any[], tahun: number) {
  if (!hasil?.trial_balance_bulanan || !hasil?.laba_rugi_bulanan) return null;

  const petaCoa: Record<string, any> = {};
  for (const akun of coa || []) {
    if (akun?.no_akun) petaCoa[String(akun.no_akun)] = akun;
  }

  const { trial_balance_bulanan, laba_rugi_bulanan } = hasil;
  const totalPendapatanYtd: number[] = laba_rugi_bulanan.total_pendapatan_ytd || [];
  const totalBebanYtd: number[] = laba_rugi_bulanan.total_beban_ytd || [];
  const totalPendapatanBulanan: number[] = laba_rugi_bulanan.total_pendapatan_bulanan || [];

  // Bulan terakhir yang sudah punya transaksi (revenue/beban YTD > 0).
  let lastIdx = -1;
  for (let i = 0; i < 12; i++) {
    if ((totalPendapatanYtd[i] || 0) > 0.01 || (totalBebanYtd[i] || 0) > 0.01) lastIdx = i;
  }
  if (lastIdx === -1) return null; // belum ada jurnal sama sekali tahun ini

  const akunPendapatan: AkunPendapatan[] = [];
  const akunBeban: AkunBeban[] = [];
  for (const [noAkun, infoRaw] of Object.entries<any>(trial_balance_bulanan)) {
    const coaInfo = petaCoa[noAkun] || {};
    const subKategori: string | null = coaInfo.sub_kategori || null;
    const perBulan: number[] = infoRaw.per_bulan || [];
    const namaAkun: string = infoRaw.nama_akun || noAkun;
    if (infoRaw.kategori === 'PENDAPATAN') {
      akunPendapatan.push({ noAkun, namaAkun, subKategori, perBulan });
    } else if (infoRaw.kategori === 'BEBAN') {
      akunBeban.push({ noAkun, namaAkun, subKategori, perBulan, ember: klasifikasiBeban(subKategori, namaAkun) });
    }
  }

  const deltaBulan = (perBulan: number[], i: number) => (perBulan[i] || 0) - (i > 0 ? perBulan[i - 1] || 0 : 0);

  // ── MONTHLY_PL (bulan 0..lastIdx) ──
  const MONTHLY_PL: MonthlyPLRow[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const ember = { cogs: 0, da: 0, interest: 0, tax: 0, opex: 0 };
    for (const a of akunBeban) ember[a.ember] += deltaBulan(a.perBulan, i);
    const revenue = totalPendapatanBulanan[i] || 0;
    const { cogs, da, interest, tax, opex: opEx } = ember;
    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - opEx;
    const ebit = ebitda - da;
    const netProfit = revenue - (cogs + opEx + da + interest + tax);
    MONTHLY_PL.push({
      month: NAMA_BULAN[i],
      revenue: bulatkanJuta(revenue), cogs: bulatkanJuta(cogs), grossProfit: bulatkanJuta(grossProfit),
      opEx: bulatkanJuta(opEx), ebitda: bulatkanJuta(ebitda), da: bulatkanJuta(da), ebit: bulatkanJuta(ebit),
      interest: bulatkanJuta(interest), tax: bulatkanJuta(tax), netProfit: bulatkanJuta(netProfit),
    });
  }

  // ── PL_CORE (kumulatif YTD s.d. bulan terakhir yang ada transaksi) ──
  const emberYtd = { cogs: 0, da: 0, interest: 0, tax: 0, opex: 0 };
  for (const a of akunBeban) emberYtd[a.ember] += a.perBulan[lastIdx] || 0;
  const revenueYtd = totalPendapatanYtd[lastIdx] || 0;
  const { cogs: cogsYtd, da: daYtd, interest: interestYtd, tax: taxYtd, opex: opExYtd } = emberYtd;
  const grossProfitYtd = revenueYtd - cogsYtd;
  const ebitdaYtd = grossProfitYtd - opExYtd;
  const ebitYtd = ebitdaYtd - daYtd;
  const ebtYtd = ebitYtd - interestYtd;
  const netProfitYtd = ebtYtd - taxYtd;

  const PL_CORE: PLCoreValues = {
    revenue: bulatkanJuta(revenueYtd), cogs: bulatkanJuta(cogsYtd), grossProfit: bulatkanJuta(grossProfitYtd),
    operatingExpenses: bulatkanJuta(opExYtd), ebitda: bulatkanJuta(ebitdaYtd), da: bulatkanJuta(daYtd),
    ebit: bulatkanJuta(ebitYtd), interestExpense: bulatkanJuta(interestYtd), ebt: bulatkanJuta(ebtYtd),
    incomeTax: bulatkanJuta(taxYtd), netProfit: bulatkanJuta(netProfitYtd),
  };

  const MARGINS: MarginValues = {
    grossMargin: pct(grossProfitYtd, revenueYtd),
    ebitdaMargin: pct(ebitdaYtd, revenueYtd),
    ebitMargin: pct(ebitYtd, revenueYtd),
    netMargin: pct(netProfitYtd, revenueYtd),
  };

  // ── Revenue by category (akun PENDAPATAN dikelompokkan per sub_kategori) ──
  const petaPendapatan: Record<string, number> = {};
  for (const a of akunPendapatan) {
    const label = labelKategori(a.subKategori, a.namaAkun);
    petaPendapatan[label] = (petaPendapatan[label] || 0) + (a.perBulan[lastIdx] || 0);
  }
  const REVENUE_BY_CATEGORY = buatBreakdown(petaPendapatan);

  // ── Expense breakdown (akun beban ember=opex, dikelompokkan per sub_kategori) ──
  const petaOpex: Record<string, number> = {};
  for (const a of akunBeban) {
    if (a.ember !== 'opex') continue;
    const label = labelKategori(a.subKategori, a.namaAkun);
    petaOpex[label] = (petaOpex[label] || 0) + (a.perBulan[lastIdx] || 0);
  }
  const EXPENSE_BREAKDOWN = buatBreakdown(petaOpex);

  const periodLabel = lastIdx === 0 ? `${NAMA_BULAN[0]} ${tahun}` : `${NAMA_BULAN[0]} ${tahun} – ${NAMA_BULAN[lastIdx]} ${tahun}`;

  return { PL_CORE, MARGINS, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN, periodLabel };
}

export function useProfitLossData(): ProfitLossData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState<ReturnType<typeof hitungDataProfitLoss> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeClientId) {
      setComputed(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const tahun = new Date().getFullYear();

    (async () => {
      try {
        const [coaRes, laporanRes] = await Promise.all([
          ambilCoaClient(activeClientId).catch(() => ({ coa: [] })),
          // Kalau belum pernah digenerate tahun ini, generate on-the-fly
          // (sekali) supaya halaman tetap bisa tampil data asli tanpa
          // user harus buka menu lain dulu.
          ambilLaporanBulanan(activeClientId, tahun).catch(() => generateLaporanBulanan(activeClientId, tahun)),
        ]);
        if (requestIdRef.current !== requestId) return;
        const hasil = (laporanRes as any)?.hasil;
        const coa = (coaRes as any)?.coa || [];
        setComputed(hitungDataProfitLoss(hasil, coa, tahun));
      } catch {
        if (requestIdRef.current !== requestId) return;
        setComputed(null);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    })();
  }, [activeClientId]);

  if (computed) {
    return {
      loading,
      isSampleData: false,
      companyName: activeClientName || COMPANY.name,
      periodLabel: computed.periodLabel,
      PL_CORE: computed.PL_CORE,
      MARGINS: computed.MARGINS,
      MONTHLY_PL: computed.MONTHLY_PL,
      REVENUE_BY_CATEGORY: computed.REVENUE_BY_CATEGORY.length ? computed.REVENUE_BY_CATEGORY : MOCK_REVENUE_BY_CATEGORY,
      EXPENSE_BREAKDOWN: computed.EXPENSE_BREAKDOWN.length ? computed.EXPENSE_BREAKDOWN : MOCK_EXPENSE_BREAKDOWN,
    };
  }

  return {
    loading,
    isSampleData: true,
    companyName: COMPANY.name,
    periodLabel: COMPANY.period,
    PL_CORE: MOCK_PL_CORE,
    MARGINS: MOCK_MARGINS,
    MONTHLY_PL: MOCK_MONTHLY_PL,
    REVENUE_BY_CATEGORY: MOCK_REVENUE_BY_CATEGORY,
    EXPENSE_BREAKDOWN: MOCK_EXPENSE_BREAKDOWN,
  };
}
