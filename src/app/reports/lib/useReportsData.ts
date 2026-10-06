'use client';

// [DIUBAH] Sambungkan halaman Reports ke data ASLI client aktif -- pola SAMA
// dengan halaman lain yang sudah tersambung (lihat src/lib/neracaBridge.ts /
// src/app/documents/lib/useDocumentsData.ts).
//
// SUMBER BACKEND (4 sumber digabung jadi 1 daftar Report[]):
//   1. GET /api/client/{id}/laporan-keuangan -> tiap snapshot = 1 kali
//      generate 5 Laporan Keuangan Standar sekaligus (Neraca, Laba Rugi,
//      Perubahan Ekuitas, Arus Kas, CALK ringkas). category='financial-statements'.
//   2. GET /api/client/{id}/calk/riwayat -> CALK LENGKAP gaya akuntan publik
//      (docx+pdf, 15+ note). category='financial-statements'.
//   3. GET /api/client/{id}/pph-badan/riwayat -> perhitungan PPh Badan
//      Pasal 31E. category='tax'.
//   4. [BARU] GET /api/client/{id}/reports-registry (tabel
//      "7_Management"."Management_Reports_report_registry", lihat
//      src/app/reports/lib/reportsDbBridge.ts) -> laporan APAPUN
//      kategorinya yang dicatat manual/proses lain. Ini yang mengisi
//      kategori 'management'/'ar-ap'/'budget'/'audit'/'custom' yang
//      sebelumnya SAMA SEKALI tidak punya sumber backend.
//
// KETERBATASAN (jujur, bukan tebakan pasti benar):
//  - Kategori yang MASIH belum ada baris real sama sekali (baik dari 3
//    sumber otomatis maupun dari report_registry) tetap fallback ke data
//    contoh utk kategori itu saja, supaya UI tidak mendadak kosong.
//  - 'size' (ukuran file) dari 3 sumber otomatis tidak pernah dihitung
//    backend -> selalu '-' (khusus baris dari report_registry, 'size'
//    ikut apa yang diisi manual di kolom file_size).
//  - `status` dari 3 sumber otomatis selalu 'ready' (histori hanya
//    menyimpan hasil yang SUDAH selesai digenerate; tidak ada rekaman
//    'generating'/'scheduled'/'error' di backend). Baris dari
//    report_registry ikut kolom `status` aslinya.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { ambilLaporanKeuangan, riwayatCalk, riwayatPphBadan } from '@/app/agent-ai/lib/api';
import { useReportRegistry, useReportSchedule } from './reportsDbBridge';
import { reports as sampleReports, scheduledReports as sampleScheduledReports, type Report, type ReportCategory, type ScheduledReport } from '@/lib/reportsMockData';

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
  /** [BARU] Catat laporan baru ke report_registry (tombol "Create Report").
   * Menyambung ke tabel report_registry saja -- 3 sumber otomatis
   * (Laporan Keuangan/CALK/PPh Badan) tetap dihasilkan lewat alur
   * generate masing-masing, bukan lewat sini. */
  addReport: ReturnType<typeof useReportRegistry>['addReport'];
}

export function useReportsData(): ReportsData {
  const { activeClientId, activeClientName, hydrated } = useActiveClient();
  // [FIX flash-ke-0] Default true -- lihat penjelasan di useProfitLossData.ts
  const [loading, setLoading] = useState(true);
  const [realReports, setRealReports] = useState<Report[] | null>(null);
  const requestIdRef = useRef(0);
  const { reports: registryReports, loading: loadingRegistry, addReport } = useReportRegistry();

  useEffect(() => {
    if (!hydrated) return;
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
  }, [hydrated, activeClientId, activeClientName]);

  // Gabung 3 sumber otomatis + report_registry (kategori apapun).
  const semuaReal = [...(realReports || []), ...registryReports];
  const adaDataReal = semuaReal.length > 0;

  // Kategori yang MASIH belum ada baris real sama sekali (dari sumber
  // manapun) tetap fallback ke data contoh utk kategori itu saja.
  const kategoriReal = new Set(semuaReal.map((r) => r.category));
  const contohUntukKategoriBelumAda = sampleReports.filter((r) => !kategoriReal.has(r.category));

  return {
    loading: loading || loadingRegistry,
    isSampleData: !adaDataReal,
    companyName: activeClientName,
    reports: adaDataReal ? [...semuaReal, ...contohUntukKategoriBelumAda] : sampleReports,
    addReport,
  };
}

export interface ReportScheduleViewData {
  loading: boolean;
  isSampleData: boolean;
  scheduledReports: ScheduledReport[];
  /** [BARU] Buat jadwal baru + simpan ke report_schedule. */
  addSchedule: ReturnType<typeof useReportSchedule>['addSchedule'];
  /** [BARU] Ubah status jadwal ("Pause"/"Resume") + simpan ke report_schedule. */
  changeScheduleStatus: ReturnType<typeof useReportSchedule>['changeScheduleStatus'];
}

/** [DIUBAH] Jadwal laporan berkala (tab "Report Scheduler") dari tabel
 * report_schedule. Menambah jadwal & ubah status sekarang beneran
 * tersimpan ke Supabase (addSchedule/changeScheduleStatus) -- sebelumnya
 * cuma state lokal browser (scheduledReports di reportsMockData.tsx),
 * hilang tiap reload. Menghapus jadwal lewat UI MASIH lokal saja (belum
 * ada endpoint DELETE report_schedule di backend) -- lihat
 * ReportsPageClient.tsx. */
export function useScheduledReportsData(): ReportScheduleViewData {
  const { loading, isSampleData, scheduledReports, addSchedule, changeScheduleStatus } = useReportSchedule();
  return {
    loading,
    isSampleData,
    scheduledReports: isSampleData ? sampleScheduledReports : scheduledReports,
    addSchedule,
    changeScheduleStatus,
  };
}