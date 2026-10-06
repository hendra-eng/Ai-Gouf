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

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';
import { COMPANY } from '@/lib/financialData';

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

// [BARU] Dipakai OverviewCharts.tsx (Financial Overview) untuk fitur filter
// periode 12M/3Y yang butuh data tahun-tahun sebelumnya juga -- reuse
// LANGSUNG logika klasifikasi/hitung yang sama dengan hook di atas
// (hitungDataProfitLoss) supaya angkanya selalu konsisten dengan halaman
// P&L, tidak duplikat logic. Tidak mengubah perilaku useProfitLossData()
// yang sudah ada di atas.
export async function fetchMonthlyPLForYear(clientId: string, tahun: number): Promise<MonthlyPLRow[] | null> {
  try {
    const [coaRes, laporanRes] = await Promise.all([
      ambilCoaClient(clientId).catch(() => ({ coa: [] })),
      ambilLaporanBulanan(clientId, tahun).catch(() => generateLaporanBulanan(clientId, tahun)),
    ]);
    const hasil = (laporanRes as any)?.hasil;
    const coa = (coaRes as any)?.coa || [];
    const computed = hitungDataProfitLoss(hasil, coa, tahun);
    return computed?.MONTHLY_PL || null;
  } catch {
    return null;
  }
}

// Key generator dipisah supaya listener di bawah (invalidate/refresh
// paksa) selalu menunjuk ke entry cache yang SAMA PERSIS dengan yang
// dibaca oleh useQuery -- kalau sampai beda (typo array, urutan field,
// dst), refresh paksa itu akan menulis ke cache yang tidak pernah dibaca
// siapa pun, dan halaman P&L tidak pernah ikut ter-update.
function plQueryKey(clientId: string, tahun: number) {
  return ['profit-loss', clientId, tahun] as const;
}

async function fetchProfitLossData(clientId: string, tahun: number) {
  const [coaRes, laporanRes] = await Promise.all([
    ambilCoaClient(clientId).catch(() => ({ coa: [] })),
    // Kalau belum pernah digenerate tahun ini, generate on-the-fly (sekali)
    // supaya halaman tetap bisa tampil data asli tanpa user harus buka
    // menu lain dulu.
    ambilLaporanBulanan(clientId, tahun).catch(() => generateLaporanBulanan(clientId, tahun)),
  ]);
  const hasil = (laporanRes as any)?.hasil;
  const coa = (coaRes as any)?.coa || [];
  return hitungDataProfitLoss(hasil, coa, tahun);
}

export function useProfitLossData(): ProfitLossData {
  const { activeClientId, activeClientName, hydrated } = useActiveClient();
  const queryClient = useQueryClient();
  const tahun = new Date().getFullYear();

  // [DIUBAH -- cache lewat TanStack Query] Sebelumnya hook ini fetch
  // ulang dari nol (ambilCoaClient + ambilLaporanBulanan) SETIAP KALI
  // halaman P&L di-mount, termasuk saat user cuma pindah ke halaman lain
  // lalu balik lagi -- itu yang bikin muncul loading spinner berulang
  // padahal datanya belum tentu berubah. Sekarang hasilnya disimpan di
  // cache TanStack Query (staleTime 60 detik, sama seperti QueryClient
  // default di AppLayout.tsx): buka P&L lagi dalam 1 menit ke depan
  // langsung tampil dari cache, tanpa network call baru sama sekali.
  const query = useQuery({
    queryKey: activeClientId ? plQueryKey(activeClientId, tahun) : ['profit-loss', 'no-client'],
    queryFn: () => fetchProfitLossData(activeClientId as string, tahun),
    enabled: hydrated && !!activeClientId,
    staleTime: 60 * 1000,
  });

  // [FIX flash-ke-0] Selama context client aktif belum selesai dibaca
  // dari localStorage (hydrated === false), anggap "sedang memuat" --
  // sama seperti perilaku aslinya, supaya tidak sempat kelip ke ZERO_PL.
  const loading = !hydrated || (!!activeClientId && query.isPending);
  const computed = query.data ?? null;

  // [BARU] Auto-refresh begitu Agent AI selesai upload & auto-posting utk
  // client yang sedang aktif -- BEDA dari fetch normal di atas (yang GET
  // laporan CACHED biar hemat), di sini SENGAJA generateLaporanBulanan()
  // (POST, force hitung ulang dari jurnal+COA terbaru & timpa snapshot
  // lama) karena kita SUDAH TAHU datanya baru saja berubah, jadi cache
  // lama pasti basi. Hasilnya ditulis LANGSUNG ke cache TanStack Query
  // (queryClient.setQueryData) supaya halaman yang sedang terbuka ikut
  // ter-update seketika, dan kalau user pindah-balik halaman setelah ini
  // dia baca cache yang sudah segar, bukan fetch ulang lagi.
  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (!activeClientId || changedClientId !== activeClientId) return;
      const key = plQueryKey(activeClientId, tahun);
      (async () => {
        try {
          const [coaRes, laporanRes] = await Promise.all([
            ambilCoaClient(activeClientId).catch(() => ({ coa: [] })),
            generateLaporanBulanan(activeClientId, tahun),
          ]);
          const hasil = (laporanRes as any)?.hasil;
          const coa = (coaRes as any)?.coa || [];
          queryClient.setQueryData(key, hitungDataProfitLoss(hasil, coa, tahun));
        } catch {
          // Regenerate gagal (mis. user login tidak punya level Supervisor+)
          // -- biarkan data lama tetap tampil drpd halaman jadi kosong.
        }
      })();
    });
  }, [activeClientId, tahun, queryClient]);

  if (computed) {
    return {
      loading,
      isSampleData: false,
      companyName: activeClientName || COMPANY.name,
      periodLabel: computed.periodLabel,
      PL_CORE: computed.PL_CORE,
      MARGINS: computed.MARGINS,
      MONTHLY_PL: computed.MONTHLY_PL,
      REVENUE_BY_CATEGORY: computed.REVENUE_BY_CATEGORY,
      EXPENSE_BREAKDOWN: computed.EXPENSE_BREAKDOWN,
    };
  }

  const ZERO_PL: PLCoreValues = {
    revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, ebitda: 0,
    da: 0, ebit: 0, interestExpense: 0, ebt: 0, incomeTax: 0, netProfit: 0,
  };
  const ZERO_MARGINS: MarginValues = { grossMargin: 0, ebitdaMargin: 0, ebitMargin: 0, netMargin: 0 };
  return {
    loading,
    isSampleData: false,
    companyName: activeClientName || 'No client selected',
    periodLabel: `No posted data — ${new Date().getFullYear()}`,
    PL_CORE: ZERO_PL,
    MARGINS: ZERO_MARGINS,
    MONTHLY_PL: [],
    REVENUE_BY_CATEGORY: [],
    EXPENSE_BREAKDOWN: [],
  };
}