'use client';

// [BARU] Sumber data REAL untuk widget "Recent Activity" di drawer detail
// client (ClientDetailDrawer, tab "Activity") -- sebelumnya pakai
// `clientActivityFeed` dari @/lib/clientsMockData yang sekarang SUDAH
// KOSONG (array `[]`, sudah dikosongkan sebelumnya saat halaman lain
// disambungkan), jadi tab Activity SELALU menampilkan "No recent activity"
// apa pun kliennya.
//
// PENTING beda dari hook lain di project ini (mis. useAuditTrail.ts): hook
// itu selalu baca `activeClientId` dari context global (client yang lagi
// dipilih di header). Tapi drawer client di halaman INI bisa dibuka untuk
// SEMBARANG client di daftar (bukan cuma yang lagi aktif) -- jadi di sini
// clientId diambil sebagai PARAMETER langsung dari `client.id` (baris yang
// diklik), bukan dari useActiveClient().
//
// Digabung dari 2 sumber backend yang sudah ada (tidak ada endpoint baru):
//   1) GET /api/client/{id}/audit-log (auditLogClient) -- log aksi admin
//      generik: konfirmasi/batalkan upload duplikat, dll (lihat
//      backend/main.py::api_audit_log_client + db_client.py::AuditLog).
//   2) GET /api/client/{id}/jurnal-posting?status= (daftarJurnalPosting,
//      SAMA seperti yang dipakai useAuditTrail.ts di halaman Audit) --
//      draft/posted/rejected journal entries, biasanya jauh lebih sering
//      terisi daripada audit_log murni.
// Digabung & diurutkan berdasarkan waktu terbaru supaya feed tidak kosong
// untuk client yang sudah punya transaksi tapi belum pernah kena aksi
// admin generik (batalkan/konfirmasi upload duplikat).

import { useEffect, useRef, useState } from 'react';
import { auditLogClient, daftarJurnalPosting } from '@/app/agent-ai/lib/api';

export interface ClientActivityItem {
  id: string;
  action: string;
  user: string;
  date: string;
  time: string;
}

interface BackendAuditLogRow {
  id: number;
  user?: string | null;
  aksi?: string | null;
  detail?: Record<string, any> | null;
  dibuat_at?: string | null;
}

interface BackendJurnalRow {
  id: number;
  tanggal?: string | null;
  no_dokumen?: string | null;
  nama_akun_debet?: string | null;
  nama_akun_kredit?: string | null;
  status?: string | null; // 'draft' | 'terposting' | 'ditolak'
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

const AKSI_LABEL: Record<string, string> = {
  batalkan_upload_duplikat: 'Membatalkan upload duplikat',
  konfirmasi_upload_duplikat: 'Mengonfirmasi upload duplikat',
};

function labelAksi(aksi: string | null | undefined): string {
  if (!aksi) return 'Aktivitas sistem';
  return AKSI_LABEL[aksi] || aksi.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const STATUS_LABEL: Record<string, string> = {
  terposting: 'Jurnal diposting',
  draft: 'Jurnal dibuat (draft)',
  ditolak: 'Jurnal ditolak',
};

function splitTimestamp(ts: string | null | undefined): { date: string; time: string } {
  if (!ts) return { date: '—', time: '' };
  const norm = ts.replace('T', ' ');
  const [date, time] = norm.split(' ');
  return { date: date || '—', time: (time || '').slice(0, 5) };
}

function fromAuditLog(row: BackendAuditLogRow): ClientActivityItem {
  const { date, time } = splitTimestamp(row.dibuat_at);
  const namaFile = row.detail?.nama_file ? ` — ${row.detail.nama_file}` : '';
  return { id: `al-${row.id}`, action: `${labelAksi(row.aksi)}${namaFile}`, user: row.user || 'System', date, time };
}

function fromJurnal(row: BackendJurnalRow): ClientActivityItem {
  const timestamp = row.diposting_at || row.dibuat_at || row.tanggal;
  const { date, time } = splitTimestamp(timestamp);
  const akun = row.nama_akun_debet || row.nama_akun_kredit || 'Jurnal';
  const dokumen = row.no_dokumen ? ` (${row.no_dokumen})` : '';
  const label = STATUS_LABEL[row.status || ''] || 'Aktivitas jurnal';
  return { id: `jp-${row.id}`, action: `${label} — ${akun}${dokumen}`, user: row.diposting_oleh || 'System', date, time };
}

interface ClientActivityData {
  loading: boolean;
  activity: ClientActivityItem[];
}

/** Ambil feed aktivitas real untuk SATU client tertentu (bukan client aktif global). */
export function useClientActivity(clientId: string | null): ClientActivityData {
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<ClientActivityItem[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!clientId) {
      setActivity([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);

    Promise.all([
      auditLogClient(clientId, 50).catch(() => ({ audit_log: [] })),
      daftarJurnalPosting(clientId, '').catch(() => ({ jurnal: [] })),
    ])
      .then(([auditRes, jurnalRes]: any) => {
        if (requestIdRef.current !== requestId) return;
        const auditItems = (auditRes?.audit_log || []).map(fromAuditLog);
        const jurnalItems = (jurnalRes?.jurnal || []).map(fromJurnal);
        const merged = [...auditItems, ...jurnalItems]
          .sort((a, b) => (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time))
          .slice(0, 20);
        setActivity(merged);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setActivity([]);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [clientId]);

  return { loading, activity };
}
