'use client';

// [BARU] Sambungkan halaman Reports ke data ASLI client aktif -- pola SAMA
// dengan halaman lain yang sudah tersambung (lihat src/lib/neracaBridge.ts /
// src/app/documents/lib/useDocumentsData.ts).
//
// SUMBER BACKEND (3 sumber digabung jadi 1 daftar Report[]):
//   1. GET /api/client/{id}/laporan-keuangan -> tiap snapshot = 1 kali
//      generate 5 Laporan Keuangan Standar sekaligus (Neraca, Laba Rugi,
//      Perubahan Ekuitas, Arus Kas, CALK ringkas). category='financial-statements'.
//   2. GET /api/client/{id}/calk/riwayat -> CALK LENGKAP gaya akuntan publik
//      (docx+pdf, 15+ note). category='financial-statements'.
//   3. GET /api/client/{id}/pph-badan/riwayat -> perhitungan PPh Badan
//      Pasal 31E. category='tax'.
//
// KETERBATASAN (jujur, bukan tebakan pasti benar):
//  - Kategori 'management', 'ar-ap', 'budget', 'audit', 'custom' BELUM
//    punya sumber backend sama sekali (tidak ada endpoint generate/riwayat
//    utk itu) -- report contoh (reportsMockData.tsx) dipertahankan APA
//    ADANYA untuk kategori2 itu, digabung dgn data real yg sudah ada.
//  - 'size' (ukuran file) tidak pernah dihitung backend -> selalu '-'.
//  - `status` selalu 'ready' utk data real (histori hanya menyimpan hasil
//    yang SUDAH selesai digenerate; tidak ada rekaman 'generating'/
//    'scheduled'/'error' di backend).

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanKeuangan, riwayatCalk, riwayatPphBadan } from '@/app/agent-ai/lib/api';
import { reports as sampleReports, type Report } from '@/lib/reportsMockData';

// Kategori2 yang di data contoh TIDAK punya sumber backend sama sekali --
// baris contohnya dipertahankan apa adanya (lihat catatan keterbatasan di atas).
const KATEGORI_TANPA_BACKEND = new Set(['management', 'ar-ap', 'budget', 'audit', 'custom']);

function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function petakanLaporanKeuangan(riwayat: any[]): Report[] {
  return riwayat.map((r, i) => ({
    id: `lapkeu-${r.id ?? i}`,
    name: 'Laporan Keuangan Lengkap (5 Laporan)',
    description: 'Neraca, Laba Rugi, Perubahan Ekuitas, Arus Kas, dan CALK ringkas dari jurnal + COA client periode ini.',
    category: 'financial-statements',
    period: r.periode || '-',
    lastGenerated: formatTanggal(r.dibuat_at),
    createdBy: r.dibuat_oleh || '-',
    formats: ['Excel'],
    status: 'ready',
    size: '-',
    tags: ['Neraca', 'Laba Rugi', 'Arus Kas'],
  }));
}

function petakanCalk(riwayat: any[]): Report[] {
  return riwayat.map((r, i) => {
    const h = r.hasil || {};
    return {
      id: `calk-${r.id ?? i}`,
      name: 'Catatan Atas Laporan Keuangan (CALK)',
      description: 'CALK lengkap dwibahasa ID/EN gaya akuntan publik dengan note bernomor otomatis.',
      category: 'financial-statements',
      period: h.periode_now ? `${h.periode_lalu ? h.periode_lalu + ' vs ' : ''}${h.periode_now}` : '-',
      lastGenerated: formatTanggal(r.dibuat_at),
      createdBy: '-',
      formats: ['PDF', 'Word'],
      status: 'ready',
      size: '-',
      tags: ['CALK'],
    } as Report;
  });
}

function petakanPphBadan(riwayat: any[]): Report[] {
  return riwayat.map((r, i) => {
    const h = r.hasil || {};
    return {
      id: `pphbadan-${r.id ?? i}`,
      name: 'Perhitungan PPh Badan (Pasal 31E)',
      description: 'Rekonsiliasi fiskal dan perhitungan PPh Badan terutang tahun pajak berjalan.',
      category: 'tax',
      period: h.tahun_pajak ? `Tahun Pajak ${h.tahun_pajak}` : '-',
      lastGenerated: formatTanggal(r.dibuat_at),
      createdBy: '-',
      formats: ['Excel'],
      status: 'ready',
      size: '-',
      tags: ['PPh Badan', '31E'],
    } as Report;
  });
}

export interface ReportsData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string | null;
  reports: Report[];
}

export function useReportsData(): ReportsData {
  const { activeClientId, activeClientName } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [realReports, setRealReports] = useState<Report[] | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeClientId) {
      setRealReports(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);

    (async () => {
      try {
        const [lapkeuRes, calkRes, pphRes] = await Promise.all([
          ambilLaporanKeuangan(activeClientId).catch(() => ({ riwayat: [] })),
          riwayatCalk(activeClientId).catch(() => ({ riwayat: [] })),
          riwayatPphBadan(activeClientId).catch(() => ({ riwayat: [] })),
        ]);
        if (requestIdRef.current !== requestId) return;

        const gabungan = [
          ...petakanLaporanKeuangan((lapkeuRes as any)?.riwayat || []),
          ...petakanCalk((calkRes as any)?.riwayat || []),
          ...petakanPphBadan((pphRes as any)?.riwayat || []),
        ];
        setRealReports(gabungan);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setRealReports(null); // gagal fetch -> fallback sample, bukan halaman kosong
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    })();
  }, [activeClientId, activeClientName]);

  const adaDataReal = !!realReports && realReports.length > 0;
  // Kategori tanpa sumber backend tetap dipertahankan dari data contoh,
  // supaya UI tidak mendadak kosong untuk kategori yang memang belum
  // disambungkan -- lihat KATEGORI_TANPA_BACKEND di atas.
  const contohUntukKategoriBelumAda = sampleReports.filter((r) => KATEGORI_TANPA_BACKEND.has(r.category));

  return {
    loading,
    isSampleData: !adaDataReal,
    companyName: activeClientName,
    reports: adaDataReal ? [...(realReports as Report[]), ...contohUntukKategoriBelumAda] : sampleReports,
  };
}
