'use client';

// [BARU] Sambungkan halaman Cash Flow ke data ASLI client aktif -- pola
// koneksinya SAMA PERSIS dengan useBalanceSheetData.ts & useProfitLossData.ts:
// baca `activeClientId` dari context global (src/lib/activeClient.tsx) ->
// fetch dari backend -> kalau belum ada client aktif / client belum punya
// jurnal sama sekali tahun ini, fallback ke data contoh (financialData.tsx)
// supaya halaman tidak pernah kosong.
//
// [CATATAN] `cash-flow/page.tsx` SUDAH lebih dulu meng-import hook ini
// (lihat komentar "[BARU] CF_CORE, CF_MONTHLY, ..." di sana) tapi file
// hook-nya sendiri belum pernah dibuat -- itu sebabnya halaman Cash Flow
// belum bisa jalan sebelum file ini ada.
//
// Sumber data backend (lihat backend/modules/laporan_keuangan.py):
//   - GET/POST /api/client/{id}/laporan-bulanan/{tahun} (ambilLaporanBulanan
//     / generateLaporanBulanan di agent-ai/lib/api.js) -> field BARU
//     "arus_kas_bulanan" (lihat susun_arus_kas_bulanan_setahun()): per bulan
//     berisi { begin_cash, operating_cf, investing_cf, financing_cf,
//     net_change, end_cash, rincian: { operasi/investasi/pendanaan:
//     [{tanggal, keterangan, arah, nominal, akun_lawan}] } }. Field ini
//     dihitung dari jurnal+COA yang SAMA yang dipakai trial_balance_bulanan
//     (Balance Sheet) -- endpoint yang sama, tidak perlu panggilan API baru.
//   - GET /api/client/{id}/coa (ambilCoaClient) -> dipakai memetakan
//     "akun_lawan" (nomor akun) di tiap rincian ke NAMA akun, supaya
//     Operating/Investing/Financing Items bisa dikelompokkan per akun
//     (sama seperti pengelompokkan per sub_kategori di Balance Sheet).
//
// [PENTING -- keterbatasan yang SENGAJA dibiarkan best-effort, sama seperti
// useBalanceSheetData.ts / useProfitLossData.ts]
// Backend mengklasifikasikan tiap baris arus kas ke operasi/investasi/
// pendanaan berdasarkan KATEGORI akun lawan (lihat _klasifikasi_arus_kas di
// backend, sudah akurat). Tapi field rinci ala buku teks di CF_CORE
// (customerCollections, supplierPayments, payrollPayments, taxPayments,
// assetPurchases, debtProceeds, dst) TIDAK ADA sebagai kategori baku di
// backend -- di sini diturunkan lagi dari NAMA akun lawan tiap transaksi
// pakai heuristik kata kunci (klasifikasiOperasi/Investasi/Pendanaan di
// bawah), PERSIS pola klasifikasiAset/klasifikasiLiabilitas di
// useBalanceSheetData.ts. Akun yang tidak cocok kata kunci apa pun jatuh ke
// ember "other" per aktivitas -- supaya total sub-line SELALU PERSIS =
// operating_cf/investing_cf/financing_cf resmi dari backend (tidak ada
// nominal yang "hilang"), meski labelnya belum tentu 100% tepat secara
// akuntansi. WAJIB direview akuntan untuk pelaporan resmi.
//
// CF_FORECAST & CF_AI_INSIGHTS TIDAK disambungkan di sini -- backend belum
// punya modul proyeksi/AI-insight untuk Cash Flow (sama seperti
// BUDGET_VS_ACTUAL & PL_AI_INSIGHTS di halaman Profit & Loss). Keduanya
// tetap dipakai langsung dari financialData.tsx oleh cash-flow/page.tsx.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';
import {
  CF_CORE as MOCK_CF_CORE,
  CF_MONTHLY as MOCK_CF_MONTHLY,
  COMPANY,
} from '@/lib/financialData';

export interface CFItem { name: string; inflow: number; outflow: number; href: string }
export interface CFMonthlyRow {
  month: string; beginCash: number; operatingCF: number; investingCF: number;
  financingCF: number; netChange: number; endCash: number;
}
export interface CFTransaction {
  id: string; date: string; type: 'Receipt' | 'Payment'; desc: string;
  account: string; inflow: number; outflow: number; party: string; status: string;
}

interface CashFlowData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string;
  periodLabel: string;
  CF_CORE: typeof MOCK_CF_CORE;
  CF_MONTHLY: CFMonthlyRow[];
  OPERATING_ITEMS: CFItem[];
  INVESTING_ITEMS: CFItem[];
  FINANCING_ITEMS: CFItem[];
  RECENT_TRANSACTIONS: CFTransaction[];
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bulatkanJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '-';
  }
}

interface RincianEntry {
  tanggal: string | null;
  keterangan: string | null;
  arah: 'masuk' | 'keluar';
  nominal: number;
  akun_lawan: string;
}
type PerBulanArusKas = {
  bulan: number; begin_cash: number; operating_cf: number; investing_cf: number;
  financing_cf: number; net_change: number; end_cash: number;
  rincian: { operasi?: RincianEntry[]; investasi?: RincianEntry[]; pendanaan?: RincianEntry[] };
};

// --- Heuristik klasifikasi nama akun lawan -> sub-line CF_CORE (best-effort) ---
function klasifikasiOperasi(nama: string): 'customer' | 'supplier' | 'payroll' | 'tax' | 'expense' | 'other' {
  const t = (nama || '').toLowerCase();
  if (/piutang|penjualan|pendapatan|revenue|customer/.test(t)) return 'customer';
  if (/hutang usaha|utang usaha|supplier|vendor|pembelian|purchase/.test(t)) return 'supplier';
  if (/gaji|payroll|upah|karyawan|thr/.test(t)) return 'payroll';
  if (/pajak|tax|pph|ppn/.test(t)) return 'tax';
  if (/beban|expense|biaya/.test(t)) return 'expense';
  return 'other';
}
function klasifikasiInvestasi(nama: string): 'equipment' | 'asset' | 'investment' | 'other' {
  const t = (nama || '').toLowerCase();
  if (/peralatan|mesin|kendaraan|komputer|equipment/.test(t)) return 'equipment';
  if (/tanah|bangunan|properti|aset tetap/.test(t)) return 'asset';
  if (/tak berwujud|investasi jangka panjang|surat berharga|saham penyertaan/.test(t)) return 'investment';
  return 'other';
}
function klasifikasiPendanaan(nama: string): 'debt' | 'dividend' | 'lease' | 'other' {
  const t = (nama || '').toLowerCase();
  if (/hutang bank|pinjaman|loan|kredit bank|jangka panjang|debt/.test(t)) return 'debt';
  if (/dividen|dividend/.test(t)) return 'dividend';
  if (/sewa|lease/.test(t)) return 'lease';
  return 'other';
}

function tebakHrefArusKas(aktivitas: 'operasi' | 'investasi' | 'pendanaan', nama: string): string {
  const t = (nama || '').toLowerCase();
  if (aktivitas === 'operasi') {
    if (/piutang/.test(t)) return '/accounts-receivable';
    if (/hutang usaha|utang usaha|payable/.test(t)) return '/accounts-payable';
    if (/pajak|tax/.test(t)) return '/liabilities';
    return '/transactions';
  }
  if (aktivitas === 'investasi') return '/assets';
  if (/modal|capital|saham/.test(t)) return '/equity';
  return '/liabilities';
}

function namaAkunDari(noAkun: string, petaCoa: Record<string, any>): string {
  return petaCoa[noAkun]?.nama_akun || noAkun || 'Lainnya';
}

function hitungDataArusKas(hasil: any, coa: any[], tahun: number) {
  const arusKasBulanan = hasil?.arus_kas_bulanan;
  if (!arusKasBulanan?.per_bulan) return null;

  const petaCoa: Record<string, any> = {};
  for (const akun of coa || []) {
    if (akun?.no_akun) petaCoa[String(akun.no_akun)] = akun;
  }

  const perBulan: PerBulanArusKas[] = arusKasBulanan.per_bulan;

  // Bulan terakhir yang benar-benar ada pergerakan (sama seperti lastIdx di
  // Balance Sheet/P&L) -- supaya bulan kosong di akhir tahun tidak ikut
  // ditampilkan sebelum client benar-benar sampai ke bulan itu.
  let lastIdx = -1;
  for (let i = 0; i < perBulan.length; i++) {
    const b = perBulan[i];
    if (Math.abs(b.operating_cf) > 0.01 || Math.abs(b.investing_cf) > 0.01 || Math.abs(b.financing_cf) > 0.01) {
      lastIdx = i;
    }
  }
  if (lastIdx === -1) return null; // belum ada arus kas sama sekali tahun ini

  const CF_MONTHLY: CFMonthlyRow[] = perBulan.slice(0, lastIdx + 1).map((b) => ({
    month: NAMA_BULAN[b.bulan - 1] || `Bulan ${b.bulan}`,
    beginCash: bulatkanJuta(b.begin_cash),
    operatingCF: bulatkanJuta(b.operating_cf),
    investingCF: bulatkanJuta(b.investing_cf),
    financingCF: bulatkanJuta(b.financing_cf),
    netChange: bulatkanJuta(b.net_change),
    endCash: bulatkanJuta(b.end_cash),
  }));

  // Kumpulkan semua rincian transaksi (Jan..bulan terakhir) per aktivitas,
  // dipakai baik utk Operating/Investing/Financing Items (dikelompokkan per
  // akun lawan) maupun Recent Transactions (daftar mentah, urut tanggal).
  const kumpulan: Record<'operasi' | 'investasi' | 'pendanaan', RincianEntry[]> = { operasi: [], investasi: [], pendanaan: [] };
  for (let i = 0; i <= lastIdx; i++) {
    const rincian = perBulan[i]?.rincian || {};
    (['operasi', 'investasi', 'pendanaan'] as const).forEach((aktivitas) => {
      for (const entri of rincian[aktivitas] || []) kumpulan[aktivitas].push(entri);
    });
  }

  function kelompokkanPerAkun(aktivitas: 'operasi' | 'investasi' | 'pendanaan'): CFItem[] {
    const peta: Record<string, { inflow: number; outflow: number }> = {};
    for (const entri of kumpulan[aktivitas]) {
      const nama = namaAkunDari(entri.akun_lawan, petaCoa);
      if (!peta[nama]) peta[nama] = { inflow: 0, outflow: 0 };
      if (entri.arah === 'masuk') peta[nama].inflow += entri.nominal;
      else peta[nama].outflow += entri.nominal;
    }
    return Object.keys(peta)
      .filter((k) => Math.abs(peta[k].inflow) > 1 || Math.abs(peta[k].outflow) > 1)
      .sort((a, b) => (peta[b].inflow + peta[b].outflow) - (peta[a].inflow + peta[a].outflow))
      .map((k) => ({
        name: k,
        inflow: bulatkanJuta(peta[k].inflow),
        outflow: bulatkanJuta(peta[k].outflow),
        href: tebakHrefArusKas(aktivitas, k),
      }));
  }

  const OPERATING_ITEMS = kelompokkanPerAkun('operasi');
  const INVESTING_ITEMS = kelompokkanPerAkun('investasi');
  const FINANCING_ITEMS = kelompokkanPerAkun('pendanaan');

  // Sub-line CF_CORE -- signed sum (masuk = +, keluar = -) per ember
  // heuristik, supaya jumlah semua ember per aktivitas SELALU PERSIS =
  // operating_cf/investing_cf/financing_cf resmi dari backend.
  const opBucket = { customer: 0, supplier: 0, payroll: 0, tax: 0, expense: 0, other: 0 };
  for (const e of kumpulan.operasi) {
    const nilai = e.arah === 'masuk' ? e.nominal : -e.nominal;
    opBucket[klasifikasiOperasi(namaAkunDari(e.akun_lawan, petaCoa))] += nilai;
  }
  const invBucket = { equipmentOut: 0, assetOut: 0, assetIn: 0, investment: 0, other: 0 };
  for (const e of kumpulan.investasi) {
    const nama = namaAkunDari(e.akun_lawan, petaCoa);
    const jenis = klasifikasiInvestasi(nama);
    const nilai = e.arah === 'masuk' ? e.nominal : -e.nominal;
    if (jenis === 'equipment' && e.arah === 'keluar') invBucket.equipmentOut += nilai;
    else if (jenis === 'asset' && e.arah === 'keluar') invBucket.assetOut += nilai;
    else if ((jenis === 'equipment' || jenis === 'asset') && e.arah === 'masuk') invBucket.assetIn += nilai;
    else if (jenis === 'investment') invBucket.investment += nilai;
    else invBucket.other += nilai;
  }
  const finBucket = { debtIn: 0, debtOut: 0, dividend: 0, lease: 0, other: 0 };
  for (const e of kumpulan.pendanaan) {
    const nama = namaAkunDari(e.akun_lawan, petaCoa);
    const jenis = klasifikasiPendanaan(nama);
    const nilai = e.arah === 'masuk' ? e.nominal : -e.nominal;
    if (jenis === 'debt' && e.arah === 'masuk') finBucket.debtIn += nilai;
    else if (jenis === 'debt' && e.arah === 'keluar') finBucket.debtOut += nilai;
    else if (jenis === 'dividend') finBucket.dividend += nilai;
    else if (jenis === 'lease') finBucket.lease += nilai;
    else finBucket.other += nilai;
  }

  const beginningCash = CF_MONTHLY[0].beginCash;
  const endingCash = CF_MONTHLY[CF_MONTHLY.length - 1].endCash;
  const netOperatingCF = CF_MONTHLY.reduce((s, m) => s + m.operatingCF, 0);
  const netInvestingCF = CF_MONTHLY.reduce((s, m) => s + m.investingCF, 0);
  const netFinancingCF = CF_MONTHLY.reduce((s, m) => s + m.financingCF, 0);

  const CF_CORE = {
    beginningCash,
    customerCollections: bulatkanJuta(opBucket.customer),
    supplierPayments: bulatkanJuta(opBucket.supplier),
    payrollPayments: bulatkanJuta(opBucket.payroll),
    taxPayments: bulatkanJuta(opBucket.tax),
    operatingExpensesCF: bulatkanJuta(opBucket.expense),
    otherOperatingCF: bulatkanJuta(opBucket.other),
    netOperatingCF,
    assetPurchases: bulatkanJuta(invBucket.assetOut),
    assetSales: bulatkanJuta(invBucket.assetIn),
    equipmentPurchases: bulatkanJuta(invBucket.equipmentOut),
    investments: bulatkanJuta(invBucket.investment),
    otherInvestingCF: bulatkanJuta(invBucket.other),
    netInvestingCF,
    debtProceeds: bulatkanJuta(finBucket.debtIn),
    debtRepayment: bulatkanJuta(finBucket.debtOut),
    capitalInjection: 0, // backend belum bedakan setoran modal dari akun EKUITAS lain
    dividendPayments: bulatkanJuta(finBucket.dividend),
    leasePayments: bulatkanJuta(finBucket.lease),
    otherFinancingCF: bulatkanJuta(finBucket.other),
    netFinancingCF,
    netChange: Math.round((endingCash - beginningCash) * 100) / 100,
    endingCash,
  };

  // Recent Transactions -- gabungkan rincian ketiga aktivitas, urut tanggal
  // terbaru dulu, ambil 5 teratas (sama seperti panjang data contoh).
  const semuaTransaksi: (RincianEntry & { aktivitas: 'operasi' | 'investasi' | 'pendanaan' })[] = [];
  (['operasi', 'investasi', 'pendanaan'] as const).forEach((aktivitas) => {
    for (const e of kumpulan[aktivitas]) semuaTransaksi.push({ ...e, aktivitas });
  });
  semuaTransaksi.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  const RECENT_TRANSACTIONS: CFTransaction[] = semuaTransaksi.slice(0, 5).map((e, i) => {
    const nama = namaAkunDari(e.akun_lawan, petaCoa);
    return {
      id: `CF-${tahun}-${String(i + 1).padStart(4, '0')}`,
      date: formatTanggal(e.tanggal),
      type: e.arah === 'masuk' ? 'Receipt' : 'Payment',
      desc: e.keterangan || nama,
      account: nama,
      inflow: e.arah === 'masuk' ? bulatkanJuta(e.nominal) : 0,
      outflow: e.arah === 'keluar' ? bulatkanJuta(e.nominal) : 0,
      party: nama,
      status: 'Posted',
    };
  });

  const periodLabel = lastIdx === 0 ? `${NAMA_BULAN[0]} ${tahun}` : `${NAMA_BULAN[0]} ${tahun} – ${NAMA_BULAN[lastIdx]} ${tahun}`;

  return { CF_CORE, CF_MONTHLY, OPERATING_ITEMS, INVESTING_ITEMS, FINANCING_ITEMS, RECENT_TRANSACTIONS, periodLabel };
}

export function useCashFlowData(): CashFlowData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState<ReturnType<typeof hitungDataArusKas> | null>(null);
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
        setComputed(hitungDataArusKas(hasil, coa, tahun));
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
      CF_CORE: computed.CF_CORE,
      CF_MONTHLY: computed.CF_MONTHLY,
      OPERATING_ITEMS: computed.OPERATING_ITEMS,
      INVESTING_ITEMS: computed.INVESTING_ITEMS,
      FINANCING_ITEMS: computed.FINANCING_ITEMS,
      RECENT_TRANSACTIONS: computed.RECENT_TRANSACTIONS,
    };
  }

  // Fallback: data contoh (financialData.tsx) -- OPERATING/INVESTING/
  // FINANCING_ITEMS & RECENT_TRANSACTIONS contoh disusun manual di sini
  // (sebelumnya hardcoded langsung di cash-flow/page.tsx sebelum halaman
  // ini tersambung ke hook), supaya bentuknya tetap konsisten dengan
  // struktur ASLI (CFItem / CFTransaction) di atas.
  return {
    loading,
    isSampleData: true,
    companyName: COMPANY.name,
    periodLabel: 'Jan 2026 – Aug 2026',
    CF_CORE: MOCK_CF_CORE,
    CF_MONTHLY: MOCK_CF_MONTHLY,
    OPERATING_ITEMS: [
      { name: 'Piutang Usaha', inflow: 0, outflow: 142, href: '/accounts-receivable' },
      { name: 'Persediaan', inflow: 0, outflow: 38, href: '/transactions' },
      { name: 'Hutang Usaha', inflow: 86, outflow: 0, href: '/accounts-payable' },
      { name: 'Kewajiban Akrual', inflow: 44, outflow: 0, href: '/liabilities' },
    ],
    INVESTING_ITEMS: [
      { name: 'Peralatan & Mesin', inflow: 0, outflow: 380, href: '/assets' },
      { name: 'Aset Tak Berwujud', inflow: 0, outflow: 120, href: '/assets' },
      { name: 'Investasi Jangka Panjang', inflow: 0, outflow: 200, href: '/assets' },
      { name: 'Penjualan Aset Tetap', inflow: 45, outflow: 0, href: '/assets' },
    ],
    FINANCING_ITEMS: [
      { name: 'Hutang Bank', inflow: 500, outflow: 280, href: '/liabilities' },
      { name: 'Dividen', inflow: 0, outflow: 320, href: '/equity' },
      { name: 'Sewa (Lease)', inflow: 0, outflow: 85, href: '/liabilities' },
    ],
    RECENT_TRANSACTIONS: [
      { id: 'CF-2026-0001', date: '28 Aug 2026', type: 'Receipt', desc: 'Invoice payment — PT Mitra Solusi', account: 'Piutang Usaha', inflow: 185, outflow: 0, party: 'PT Mitra Solusi', status: 'Posted' },
      { id: 'CF-2026-0002', date: '27 Aug 2026', type: 'Payment', desc: 'Vendor payment — ABC Supplier', account: 'Hutang Usaha', inflow: 0, outflow: 42, party: 'ABC Supplier', status: 'Posted' },
      { id: 'CF-2026-0003', date: '27 Aug 2026', type: 'Payment', desc: 'Payroll — August 2026', account: 'Beban Gaji', inflow: 0, outflow: 124, party: 'Karyawan', status: 'Posted' },
      { id: 'CF-2026-0004', date: '26 Aug 2026', type: 'Receipt', desc: 'Service revenue — PT Karya Digital', account: 'Pendapatan Jasa', inflow: 68, outflow: 0, party: 'PT Karya Digital', status: 'Posted' },
      { id: 'CF-2026-0005', date: '26 Aug 2026', type: 'Payment', desc: 'Office rent — August 2026', account: 'Beban Sewa', inflow: 0, outflow: 22.5, party: 'Landlord', status: 'Posted' },
    ],
  };
}
