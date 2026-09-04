'use client';

// [BARU] Sumber data BERSAMA untuk halaman Assets, Liabilities, Equity
// (dan nanti Financial Analytics) -- pola & sumber backend-nya SAMA PERSIS
// dengan yang sudah dipakai halaman Balance Sheet
// (src/app/financial-statements/lib/useBalanceSheetData.ts):
//   - GET/POST /api/client/{id}/laporan-bulanan/{tahun} -> trial_balance_bulanan
//     (saldo tiap akun ASET/LIABILITAS/EKUITAS per bulan, kumulatif) +
//     laba_rugi_bulanan.laba_bersih_ytd
//   - GET /api/client/{id}/coa -> "sub_kategori" per akun, dipakai untuk
//     kelompokkan akun (Cash & Bank, Fixed Assets, Tax Payable, dst).
//
// Dibuat sebagai modul TERPISAH (bukan mengubah useBalanceSheetData.ts yang
// sudah jalan) supaya Assets/Liabilities/Equity bisa pakai fetch+klasifikasi
// yang sama tanpa risiko mengubah perilaku halaman Balance Sheet yang sudah
// tersambung duluan.
//
// Sama seperti Balance Sheet: kalau client belum aktif / belum ada jurnal
// tahun ini / fetch gagal, pemanggil (hook per halaman) yang memutuskan
// fallback ke data contoh -- modul ini cukup mengembalikan `null`.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanBulanan, generateLaporanBulanan, ambilCoaClient } from '@/app/agent-ai/lib/api';

export interface AkunNeraca {
  noAkun: string;
  namaAkun: string;
  subKategori: string | null;
  perBulan: number[];
}

export interface NeracaAccounts {
  tahun: number;
  lastIdx: number; // index bulan terakhir yang sudah ada datanya (0 = Jan)
  aset: AkunNeraca[];
  liabilitas: AkunNeraca[];
  ekuitas: AkunNeraca[];
  labaBersihYtd: number[];
}

export const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function teksAkun(a: AkunNeraca): string {
  return `${a.subKategori || ''} ${a.namaAkun || ''}`.toLowerCase();
}

export function bulatkanJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

function hitungAccounts(hasil: any, coa: any[], tahun: number): NeracaAccounts | null {
  if (!hasil?.trial_balance_bulanan) return null;

  const petaCoa: Record<string, any> = {};
  for (const akun of coa || []) {
    if (akun?.no_akun) petaCoa[String(akun.no_akun)] = akun;
  }

  const { trial_balance_bulanan, laba_rugi_bulanan } = hasil;
  const labaBersihYtd: number[] = laba_rugi_bulanan?.laba_bersih_ytd || [];

  let lastIdx = -1;
  const aset: AkunNeraca[] = [];
  const liabilitas: AkunNeraca[] = [];
  const ekuitas: AkunNeraca[] = [];

  for (const [noAkun, infoRaw] of Object.entries<any>(trial_balance_bulanan)) {
    const coaInfo = petaCoa[noAkun] || {};
    const subKategori: string | null = coaInfo.sub_kategori || null;
    const perBulan: number[] = infoRaw.per_bulan || [];
    const namaAkun: string = infoRaw.nama_akun || noAkun;
    const entri: AkunNeraca = { noAkun, namaAkun, subKategori, perBulan };
    if (infoRaw.kategori === 'ASET') aset.push(entri);
    else if (infoRaw.kategori === 'LIABILITAS') liabilitas.push(entri);
    else if (infoRaw.kategori === 'EKUITAS') ekuitas.push(entri);
    for (let i = 0; i < 12; i++) {
      if (Math.abs(perBulan[i] || 0) > 0.01) lastIdx = Math.max(lastIdx, i);
    }
  }
  for (let i = 0; i < 12; i++) {
    if (Math.abs(labaBersihYtd[i] || 0) > 0.01) lastIdx = Math.max(lastIdx, i);
  }
  if (lastIdx === -1) return null; // belum ada jurnal sama sekali tahun ini

  return { tahun, lastIdx, aset, liabilitas, ekuitas, labaBersihYtd };
}

export interface UseNeracaAccountsResult {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  data: NeracaAccounts | null;
}

/** Hook fetch mentah -- dipakai oleh useAssetsData/useLiabilitiesData/useEquityData. */
export function useNeracaAccounts(): UseNeracaAccountsResult {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [computed, setComputed] = useState<NeracaAccounts | null>(null);
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
        setComputed(hitungAccounts(hasil, coa, tahun));
      } catch {
        if (requestIdRef.current !== requestId) return;
        setComputed(null);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    })();
  }, [activeClientId]);

  return { loading, isSampleData: !computed, companyName: activeClientName, data: computed };
}
