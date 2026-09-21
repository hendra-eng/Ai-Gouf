// [BARU] ─── JEMBATAN REPORT REGISTRY & SCHEDULE (SUPABASE) → HALAMAN REPORTS ──
// Mengambil data mentah 2 tabel Supabase schema "7_Management":
//   - Management_Reports_report_registry -> daftar laporan APAPUN
//     kategorinya yang dicatat manual/proses lain (lihat
//     GET /api/client/{id}/reports-registry di main.py). Ini pelengkap 3
//     sumber otomatis yang sudah ada (Laporan Keuangan/CALK/PPh Badan --
//     lihat src/app/reports/lib/useReportsData.ts), TIDAK menggantikannya.
//   - Management_Reports_report_schedule -> jadwal laporan berkala, dipakai
//     tab "Report Scheduler" (GET /api/client/{id}/report-schedule).
//     Sebelumnya tab ini cuma state lokal browser, tidak pernah tersimpan
//     ke database.
// Pola sama dengan src/app/documents/lib/documentsDbBridge.ts /
// src/app/transactions/purchase/purchasebridge.ts.
'use client';

import { useQuery } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { reportRegistryClient, reportScheduleClient } from '@/app/agent-ai/lib/api';
import type {
  Report,
  ReportCategory,
  ReportFormat,
  ReportStatus,
  ScheduledReport,
} from '@/lib/reportsMockData';

// ─── Bentuk mentah dari backend (lihat db_client.py::ambil_data_report_*) ──
interface RawReportRegistry {
  id: string;
  name: string;
  description: string | null;
  category: string;
  period: string | null;
  created_by: string | null;
  formats: string | null; // 1 string dipisah koma di database, bukan array
  status: string | null;
  file_size: string | null;
  tags: string | null; // 1 string dipisah koma di database, bukan array
  created_at: string | null;
  updated_at: string | null;
}

interface RawReportSchedule {
  id: string;
  report_name: string;
  frequency: string;
  recipients: string | null; // 1 string dipisah koma (daftar email)
  format: string | null;
  next_run: string | null;
  status: string | null;
}

// ─── Helper umum (sama seperti documentsDbBridge.ts / purchasebridge.ts) ───
function matchEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(raw);
  const found = allowed.find((a) => norm(a) === target);
  return found ?? fallback;
}

const REPORT_CATEGORIES: ReportCategory[] = ['financial-statements', 'management', 'tax', 'ar-ap', 'budget', 'audit', 'custom'];
const REPORT_FORMATS: ReportFormat[] = ['PDF', 'Excel', 'CSV', 'Word'];
const REPORT_STATUSES: ReportStatus[] = ['ready', 'generating', 'scheduled', 'error'];
const SCHEDULE_FREQUENCIES: ScheduledReport['frequency'][] = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];
const SCHEDULE_STATUSES: ScheduledReport['status'][] = ['Active', 'Paused', 'Error'];

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function mapReportRegistry(raw: RawReportRegistry[]): Report[] {
  return raw.map((r) => {
    const formats = splitList(r.formats).map((f) => matchEnum(f, REPORT_FORMATS, 'PDF')) as ReportFormat[];
    return {
      id: `registry-${r.id}`,
      name: r.name || '-',
      description: r.description || '',
      category: matchEnum(r.category, REPORT_CATEGORIES, 'custom'),
      period: r.period || '-',
      lastGenerated: formatTanggal(r.created_at),
      createdBy: r.created_by || '-',
      formats: formats.length > 0 ? formats : ['PDF'],
      status: matchEnum(r.status, REPORT_STATUSES, 'ready'),
      size: r.file_size || '-',
      tags: splitList(r.tags),
    };
  });
}

function mapReportSchedule(raw: RawReportSchedule[]): ScheduledReport[] {
  return raw.map((s) => ({
    id: s.id,
    reportName: s.report_name || '-',
    frequency: matchEnum(s.frequency, SCHEDULE_FREQUENCIES, 'Monthly'),
    recipients: splitList(s.recipients),
    nextRun: formatTanggal(s.next_run),
    status: matchEnum(s.status, SCHEDULE_STATUSES, 'Active'),
    format: matchEnum(s.format, REPORT_FORMATS, 'PDF'),
  }));
}

export interface ReportRegistryData {
  loading: boolean;
  reports: Report[];
}

/** Daftar laporan dari report_registry (kategori APAPUN) -- digabung dengan
 * 3 sumber otomatis oleh useReportsData.ts, bukan pengganti. */
export function useReportRegistry(): ReportRegistryData {
  const { activeClientId, hydrated } = useActiveClient();

  const { data, isLoading } = useQuery({
    queryKey: ['report-registry', activeClientId],
    queryFn: async () => {
      const res = (await reportRegistryClient(activeClientId as string | number)) as { report_registry: RawReportRegistry[] };
      return mapReportRegistry(res.report_registry || []);
    },
    enabled: hydrated && !!activeClientId,
  });

  return { loading: !hydrated || isLoading, reports: data || [] };
}

export interface ReportScheduleData {
  loading: boolean;
  isSampleData: boolean;
  scheduledReports: ScheduledReport[];
}

/** Jadwal laporan berkala dari report_schedule -- dipakai sebagai nilai
 * awal tab "Report Scheduler". Menambah/menghapus jadwal lewat UI saat ini
 * MASIH lokal (belum ada endpoint POST/DELETE) -- lihat catatan di
 * ReportsPageClient.tsx. */
export function useReportSchedule(): ReportScheduleData {
  const { activeClientId, hydrated } = useActiveClient();

  const { data, isLoading } = useQuery({
    queryKey: ['report-schedule', activeClientId],
    queryFn: async () => {
      const res = (await reportScheduleClient(activeClientId as string | number)) as { report_schedule: RawReportSchedule[] };
      return mapReportSchedule(res.report_schedule || []);
    },
    enabled: hydrated && !!activeClientId,
  });

  const adaDataReal = !!data && data.length > 0;
  return {
    loading: !hydrated || isLoading,
    isSampleData: !adaDataReal,
    scheduledReports: data || [],
  };
}