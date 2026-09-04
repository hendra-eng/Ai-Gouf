'use client';

// [BARU] Sambungkan halaman Balance Sheet ke data ASLI client aktif --
// pola koneksinya SAMA PERSIS dengan useProfitLossData.ts (P&L, sudah
// duluan tersambung): baca `activeClientId` dari context global
// (src/lib/activeClient.tsx) -> fetch dari backend -> kalau belum ada
// client aktif / client belum punya jurnal sama sekali tahun ini,
// fallback ke data contoh (financialData.tsx) supaya halaman tidak
// pernah kosong.
//
// Sumber data backend (lihat backend/modules/laporan_keuangan.py):
//   - GET/POST /api/client/{id}/laporan-bulanan/{tahun} -> trial_balance_bulanan
//     (saldo tiap akun ASET/LIABILITAS/EKUITAS per bulan, kumulatif) +
//     laba_rugi_bulanan.laba_bersih_ytd (laba bersih kumulatif per bulan --
//     dipakai sbg "Laba Tahun Berjalan" di sisi Ekuitas, karena laba tahun
//     berjalan belum tentu sudah "ditutup"/posting ke akun Laba Ditahan).
//   - GET /api/client/{id}/coa -> field "sub_kategori" per akun, dipakai
//     utk kelompokkan tiap akun & heuristik Lancar/Tidak Lancar.
//
// [PENTING -- keterbatasan yang SENGAJA dibiarkan best-effort, sama
// seperti useProfitLossData.ts]
// "sub_kategori" adalah TEKS BEBAS per client (mis. "Aset Lancar", "Aset
// Tetap") -- klasifikasiAset()/klasifikasiLiabilitas() di bawah cuma
// cocokkan KATA KUNCI, bukan sumber kebenaran akuntansi. Supaya total
// tetap PERSIS = saldo akun asli dari backend, akun yang tidak cocok kata
// kunci apa pun jatuh ke ember DEFAULT (Aset -> Non-Lancar, Liabilitas ->
// Lancar) -- keduanya ember paling umum utk akun yang belum diberi label.
//
// Perbandingan "Previous Period" di sini adalah BULAN SEBELUMNYA (MoM),
// bukan tahun sebelumnya seperti versi mock -- karena trial_balance_bulanan
// cuma punya data 1 tahun berjalan per akun. Kalau bulan berjalan adalah
// Januari (belum ada bulan sebelumnya), previous = 0.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';
import {
  BS_CORE as MOCK_BS_CORE,
  BS_MONTHLY_TREND as MOCK_BS_MONTHLY_TREND,
  COMPANY,
} from '@/lib/financialData';

export interface BSItem { name: string; current: number; prev: number; href: string }
export interface BSSection { label: string; items: BSItem[]; total: number; prevTotal: number }
export interface BSMonthlyRow { month: string; assets: number; liabilities: number; equity: number }

interface BalanceSheetData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string;
  periodLabel: string;
  totalAssets: number; prevTotalAssets: number;
  totalLiabilities: number; prevTotalLiabilities: number;
  totalEquity: number; prevTotalEquity: number;
  currentAssets: BSSection; nonCurrentAssets: BSSection;
  currentLiabilities: BSSection; nonCurrentLiabilities: BSSection;
  equity: BSSection;
  BS_MONTHLY_TREND: BSMonthlyRow[];
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function klasifikasiAset(subKategori: string | null | undefined, namaAkun: string | null | undefined): 'current' | 'nonCurrent' {
  const teks = `${subKategori || ''} ${namaAkun || ''}`.toLowerCase();
  if (/(tidak lancar|non.?lancar|aset tetap|tak berwujud|jangka panjang)/.test(teks)) return 'nonCurrent';
  if (/lancar/.test(teks)) return 'current';
  return 'nonCurrent'; // default: akun tanpa label diasumsikan aset tetap/jangka panjang
}

function klasifikasiLiabilitas(subKategori: string | null | undefined, namaAkun: string | null | undefined): 'current' | 'nonCurrent' {
  const teks = `${subKategori || ''} ${namaAkun || ''}`.toLowerCase();
  if (/(jangka panjang|tidak lancar|non.?lancar)/.test(teks)) return 'nonCurrent';
  return 'current'; // default: liabilitas tanpa label diasumsikan jangka pendek
}

function tebakHref(kategori: 'ASET' | 'LIABILITAS' | 'EKUITAS', label: string): string {
  const teks = label.toLowerCase();
  if (kategori === 'ASET') {
    if (/piutang/.test(teks)) return '/accounts-receivable';
    return '/assets';
  }
  if (kategori === 'LIABILITAS') {
    if (/hutang usaha|utang usaha|payable/.test(teks)) return '/accounts-payable';
    return '/liabilities';
  }
  return '/equity';
}

function bulatkanJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

function labelKategori(subKategori: string | null | undefined, namaAkun: string | null | undefined): string {
  return (subKategori && subKategori.trim()) || namaAkun || 'Lainnya';
}

interface AkunNeraca {
  noAkun: string; namaAkun: string; subKategori: string | null; perBulan: number[];
}

function buatSeksi(
  akunList: AkunNeraca[],
  kategori: 'ASET' | 'LIABILITAS' | 'EKUITAS',
  lastIdx: number,
  label: string
): BSSection {
  const petaCurrent: Record<string, number> = {};
  const petaPrev: Record<string, number> = {};
  for (const a of akunList) {
    const key = labelKategori(a.subKategori, a.namaAkun);
    petaCurrent[key] = (petaCurrent[key] || 0) + (a.perBulan[lastIdx] || 0);
    petaPrev[key] = (petaPrev[key] || 0) + (lastIdx > 0 ? (a.perBulan[lastIdx - 1] || 0) : 0);
  }
  const items: BSItem[] = Object.keys(petaCurrent)
    .filter((k) => Math.abs(petaCurrent[k]) > 1)
    .sort((a, b) => petaCurrent[b] - petaCurrent[a])
    .map((k) => ({ name: k, current: bulatkanJuta(petaCurrent[k]), prev: bulatkanJuta(petaPrev[k]), href: tebakHref(kategori, k) }));
  const total = items.reduce((s, i) => s + i.current, 0);
  const prevTotal = items.reduce((s, i) => s + i.prev, 0);
  return { label, items, total, prevTotal };
}

function hitungDataNeraca(hasil: any, coa: any[], tahun: number) {
  if (!hasil?.trial_balance_bulanan) return null;

  const petaCoa: Record<string, any> = {};
  for (const akun of coa || []) {
    if (akun?.no_akun) petaCoa[String(akun.no_akun)] = akun;
  }

  const { trial_balance_bulanan, laba_rugi_bulanan } = hasil;
  const labaBersihYtd: number[] = laba_rugi_bulanan?.laba_bersih_ytd || [];

  let lastIdx = -1;
  const akunAset: AkunNeraca[] = [];
  const akunLiabilitas: AkunNeraca[] = [];
  const akunEkuitas: AkunNeraca[] = [];

  for (const [noAkun, infoRaw] of Object.entries<any>(trial_balance_bulanan)) {
    const coaInfo = petaCoa[noAkun] || {};
    const subKategori: string | null = coaInfo.sub_kategori || null;
    const perBulan: number[] = infoRaw.per_bulan || [];
    const namaAkun: string = infoRaw.nama_akun || noAkun;
    const entri: AkunNeraca = { noAkun, namaAkun, subKategori, perBulan };
    if (infoRaw.kategori === 'ASET') akunAset.push(entri);
    else if (infoRaw.kategori === 'LIABILITAS') akunLiabilitas.push(entri);
    else if (infoRaw.kategori === 'EKUITAS') akunEkuitas.push(entri);
    for (let i = 0; i < 12; i++) {
      if (Math.abs(perBulan[i] || 0) > 0.01) lastIdx = Math.max(lastIdx, i);
    }
  }
  for (let i = 0; i < 12; i++) {
    if (Math.abs(labaBersihYtd[i] || 0) > 0.01) lastIdx = Math.max(lastIdx, i);
  }
  if (lastIdx === -1) return null; // belum ada jurnal sama sekali tahun ini

  const asetLancar = akunAset.filter((a) => klasifikasiAset(a.subKategori, a.namaAkun) === 'current');
  const asetTidakLancar = akunAset.filter((a) => klasifikasiAset(a.subKategori, a.namaAkun) === 'nonCurrent');
  const liabLancar = akunLiabilitas.filter((a) => klasifikasiLiabilitas(a.subKategori, a.namaAkun) === 'current');
  const liabTidakLancar = akunLiabilitas.filter((a) => klasifikasiLiabilitas(a.subKategori, a.namaAkun) === 'nonCurrent');

  const currentAssets = buatSeksi(asetLancar, 'ASET', lastIdx, 'Current Assets');
  const nonCurrentAssets = buatSeksi(asetTidakLancar, 'ASET', lastIdx, 'Non-Current Assets');
  const currentLiabilities = buatSeksi(liabLancar, 'LIABILITAS', lastIdx, 'Current Liabilities');
  const nonCurrentLiabilities = buatSeksi(liabTidakLancar, 'LIABILITAS', lastIdx, 'Non-Current Liabilities');
  const equity = buatSeksi(akunEkuitas, 'EKUITAS', lastIdx, "Shareholders' Equity");

  // Laba tahun berjalan (YTD) belum tentu diposting ke akun Laba Ditahan di
  // COA -- ditambahkan manual sbg baris Ekuitas terpisah, sama seperti
  // BS_CORE.currentYearProfit di data contoh, supaya Aset = Liabilitas +
  // Ekuitas tetap balance.
  const labaBerjalanCurrent = bulatkanJuta(labaBersihYtd[lastIdx] || 0);
  const labaBerjalanPrev = bulatkanJuta(lastIdx > 0 ? (labaBersihYtd[lastIdx - 1] || 0) : 0);
  if (Math.abs(labaBerjalanCurrent) > 0.01 || Math.abs(labaBerjalanPrev) > 0.01) {
    equity.items.unshift({ name: 'Laba Tahun Berjalan (YTD)', current: labaBerjalanCurrent, prev: labaBerjalanPrev, href: '/equity' });
    equity.total += labaBerjalanCurrent;
    equity.prevTotal += labaBerjalanPrev;
  }

  const totalAssets = currentAssets.total + nonCurrentAssets.total;
  const prevTotalAssets = currentAssets.prevTotal + nonCurrentAssets.prevTotal;
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  const prevTotalLiabilities = currentLiabilities.prevTotal + nonCurrentLiabilities.prevTotal;
  const totalEquity = equity.total;
  const prevTotalEquity = equity.prevTotal;

  const BS_MONTHLY_TREND: BSMonthlyRow[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const assets = akunAset.reduce((s, a) => s + (a.perBulan[i] || 0), 0);
    const liabilities = akunLiabilitas.reduce((s, a) => s + (a.perBulan[i] || 0), 0);
    const equityBulan = akunEkuitas.reduce((s, a) => s + (a.perBulan[i] || 0), 0) + (labaBersihYtd[i] || 0);
    BS_MONTHLY_TREND.push({ month: NAMA_BULAN[i], assets: bulatkanJuta(assets), liabilities: bulatkanJuta(liabilities), equity: bulatkanJuta(equityBulan) });
  }

  const periodLabel = lastIdx === 0 ? `As of ${NAMA_BULAN[0]} 30, ${tahun}` : `As of ${NAMA_BULAN[lastIdx]} 30, ${tahun}`;

  return {
    totalAssets, prevTotalAssets, totalLiabilities, prevTotalLiabilities, totalEquity, prevTotalEquity,
    currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities, equity,
    BS_MONTHLY_TREND, periodLabel,
  };
}

function seksiKosong(label: string): BSSection {
  return { label, items: [], total: 0, prevTotal: 0 };
}

export function useBalanceSheetData(): BalanceSheetData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState<ReturnType<typeof hitungDataNeraca> | null>(null);
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
          ambilLaporanBulanan(activeClientId, tahun).catch(() => generateLaporanBulanan(activeClientId, tahun)),
        ]);
        if (requestIdRef.current !== requestId) return;
        const hasil = (laporanRes as any)?.hasil;
        const coa = (coaRes as any)?.coa || [];
        setComputed(hitungDataNeraca(hasil, coa, tahun));
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
      totalAssets: computed.totalAssets, prevTotalAssets: computed.prevTotalAssets,
      totalLiabilities: computed.totalLiabilities, prevTotalLiabilities: computed.prevTotalLiabilities,
      totalEquity: computed.totalEquity, prevTotalEquity: computed.prevTotalEquity,
      currentAssets: computed.currentAssets, nonCurrentAssets: computed.nonCurrentAssets,
      currentLiabilities: computed.currentLiabilities, nonCurrentLiabilities: computed.nonCurrentLiabilities,
      equity: computed.equity,
      BS_MONTHLY_TREND: computed.BS_MONTHLY_TREND,
    };
  }

  // Fallback: data contoh (financialData.tsx) -- dibentuk ulang jadi
  // struktur BSSection yang sama supaya komponen tidak perlu tahu bedanya.
  const mk = MOCK_BS_CORE;
  return {
    loading,
    isSampleData: true,
    companyName: COMPANY.name,
    periodLabel: `As of Aug 31, ${new Date().getFullYear()}`,
    totalAssets: mk.totalAssets, prevTotalAssets: 5820,
    totalLiabilities: mk.totalLiabilities, prevTotalLiabilities: 2380,
    totalEquity: mk.totalEquity, prevTotalEquity: 3440,
    currentAssets: {
      label: 'Current Assets', total: mk.cash + mk.accountsReceivable + mk.inventory + mk.prepaidExpenses + mk.otherCurrentAssets, prevTotal: 4040,
      items: [
        { name: 'Cash & Bank', current: mk.cash, prev: 2480, href: '/assets' },
        { name: 'Accounts Receivable', current: mk.accountsReceivable, prev: 1080, href: '/accounts-receivable' },
        { name: 'Inventory', current: mk.inventory, prev: 320, href: '/assets' },
        { name: 'Prepaid Expenses', current: mk.prepaidExpenses, prev: 100, href: '/assets' },
        { name: 'Other Current Assets', current: mk.otherCurrentAssets, prev: 60, href: '/assets' },
      ],
    },
    nonCurrentAssets: {
      label: 'Non-Current Assets', total: mk.property + mk.equipment + mk.vehicles + mk.computerEquipment + mk.intangibleAssets + mk.otherNonCurrentAssets, prevTotal: 1780,
      items: [
        { name: 'Property', current: mk.property, prev: 820, href: '/assets' },
        { name: 'Equipment', current: mk.equipment, prev: 580, href: '/assets' },
        { name: 'Vehicles', current: mk.vehicles, prev: 180, href: '/assets' },
        { name: 'Computer Equipment', current: mk.computerEquipment, prev: 180, href: '/assets' },
        { name: 'Intangible Assets', current: mk.intangibleAssets, prev: 130, href: '/assets' },
        { name: 'Other Non-Current Assets', current: mk.otherNonCurrentAssets, prev: 50, href: '/assets' },
      ],
    },
    currentLiabilities: {
      label: 'Current Liabilities', total: mk.accountsPayable + mk.taxPayable + mk.accruedExpenses + mk.payrollLiabilities + mk.shortTermDebt + mk.otherCurrentLiabilities, prevTotal: 2100,
      items: [
        { name: 'Accounts Payable', current: mk.accountsPayable, prev: 920, href: '/accounts-payable' },
        { name: 'Tax Payable', current: mk.taxPayable, prev: 210, href: '/liabilities' },
        { name: 'Accrued Expenses', current: mk.accruedExpenses, prev: 280, href: '/liabilities' },
        { name: 'Payroll Liabilities', current: mk.payrollLiabilities, prev: 200, href: '/liabilities' },
        { name: 'Short-Term Debt', current: mk.shortTermDebt, prev: 380, href: '/liabilities' },
        { name: 'Other Current Liabilities', current: mk.otherCurrentLiabilities, prev: 110, href: '/liabilities' },
      ],
    },
    nonCurrentLiabilities: {
      label: 'Non-Current Liabilities', total: mk.longTermDebt + mk.leaseLiabilities + mk.otherLongTermLiabilities, prevTotal: 280,
      items: [
        { name: 'Long-Term Debt', current: mk.longTermDebt, prev: 200, href: '/liabilities' },
        { name: 'Lease Liabilities', current: mk.leaseLiabilities, prev: 80, href: '/liabilities' },
        { name: 'Other Long-Term Liabilities', current: mk.otherLongTermLiabilities, prev: 30, href: '/liabilities' },
      ],
    },
    equity: {
      label: "Shareholders' Equity", total: mk.totalEquity, prevTotal: 3440,
      items: [
        { name: 'Paid-in Capital', current: mk.paidInCapital, prev: 1500, href: '/equity' },
        { name: 'Additional Paid-in Capital', current: mk.additionalPaidInCapital, prev: 500, href: '/equity' },
        { name: 'Retained Earnings', current: mk.retainedEarnings, prev: 440, href: '/equity' },
        { name: 'Current Year Profit', current: mk.currentYearProfit, prev: 1600, href: '/equity' },
        { name: 'Other Equity', current: mk.otherEquity, prev: 0, href: '/equity' },
      ],
    },
    BS_MONTHLY_TREND: MOCK_BS_MONTHLY_TREND,
  };
}