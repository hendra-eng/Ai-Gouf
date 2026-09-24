'use client';
// [FIX - audit #3] Sebelumnya TransactionDrawer.tsx menampilkan
// `mockAuditTrail` hardcoded (2 entri fiktif "Rizky Wardana"/"Siti Rahayu",
// tanggal tetap) untuk SETIAP transaksi apa pun. Backend sebenarnya SUDAH
// punya audit trail asli: GET /api/client/{client_id}/audit-log (lihat
// main.py::api_audit_log_client + modules/history.py + db_client.py::
// log_audit/get_audit_history), dan endpoint /konfirmasi, /tolak, PATCH
// jurnal-posting semuanya mencatat `detail: {"posting_id": <id>, ...}` —
// jadi riwayat SATU transaksi bisa didapat dengan memfilter log audit
// client (client-wide) berdasarkan posting_id yang sama dengan transaksi
// ini. Tidak ada endpoint baru yang diperlukan.
//
// Catatan jujur: log ini per-CLIENT, bukan per-transaksi secara native di
// backend — filternya dilakukan di sini (frontend). Untuk baris yang belum
// pernah disentuh lewat posting/edit/tolak (mis. baru diimpor, belum
// diposting/diedit sama sekali) hasilnya akan kosong — itu benar & jujur,
// bukan bug, beda dari mock lama yang SELALU menampilkan 2 entri palsu.

import { useQuery } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { auditLogClient } from '@/app/agent-ai/lib/api';
import { extractPostingId } from './jurnalBridge';

export interface AuditTrailEntry {
  id: string;
  user: string;
  action: string;
  time: string;
  detail: string;
}

interface BackendAuditRow {
  id: number;
  user?: string | null;
  aksi: string;
  detail?: Record<string, unknown> | null;
  dibuat_at?: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  posting_jurnal: 'Diposting',
  edit_jurnal: 'Diedit',
  tolak_jurnal: 'Ditolak/dibatalkan',
};

function formatWaktu(iso?: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return `${dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}, ${dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
}

function ringkasDetail(aksi: string, detail: Record<string, unknown>): string {
  if (aksi === 'tolak_jurnal') {
    return detail.alasan ? `Alasan: ${detail.alasan}` : 'Tidak ada alasan dicatat';
  }
  if (aksi === 'edit_jurnal' || aksi === 'posting_jurnal') {
    const fields = Object.keys(detail).filter((k) => k !== 'posting_id');
    return fields.length > 0 ? `Field diubah: ${fields.join(', ')}` : 'Tidak ada detail perubahan';
  }
  return aksi;
}

export interface TransactionAuditTrail {
  /** Sedang memuat riwayat dari server. */
  loading: boolean;
  /**
   * false = transaksi ini tidak berasal dari jurnal_posting backend asli
   * (data contoh / hasil import lokal yang belum sempat direfetch) —
   * tidak ada riwayat server untuk dicari sama sekali, beda dari "sudah
   * dicari tapi kosong".
   */
  hasPostingId: boolean;
  /** Pesan error kalau fetch ke server gagal (mis. tidak berwenang). */
  error: string | null;
  entries: AuditTrailEntry[];
}

async function fetchAuditTrail(clientId: string, postingId: number): Promise<AuditTrailEntry[]> {
  const res: { audit_log: BackendAuditRow[] } = await auditLogClient(clientId);
  const rows = (res?.audit_log || []).filter(
    (e) => e.detail && Number(e.detail.posting_id) === postingId
  );
  return rows.map((e) => ({
    id: `audit-${e.id}`,
    user: e.user || 'System',
    action: ACTION_LABELS[e.aksi] || e.aksi,
    time: formatWaktu(e.dibuat_at),
    detail: ringkasDetail(e.aksi, e.detail || {}),
  }));
}

// [DIUBAH -- cache lewat TanStack Query] Kalau drawer transaksi yang sama
// dibuka-tutup berkali-kali dalam waktu singkat, riwayatnya tidak fetch
// ulang tiap kali (cache 60 detik per posting_id).
/** Ambil riwayat perubahan ASLI untuk satu transaksi (dicocokkan lewat jeId -> posting_id). */
export function useTransactionAuditTrail(jeId: string | undefined | null): TransactionAuditTrail {
  const { activeClientId, hydrated } = useActiveClient();
  const postingId = extractPostingId(jeId);

  const query = useQuery({
    queryKey: ['transaction-audit-trail', activeClientId, postingId],
    queryFn: () => fetchAuditTrail(activeClientId as string, postingId as number),
    enabled: hydrated && postingId !== null && !!activeClientId,
    staleTime: 60 * 1000,
  });

  const loading = hydrated && postingId !== null && !!activeClientId && query.isPending;
  return {
    loading,
    hasPostingId: postingId !== null,
    error: query.error ? (query.error as Error)?.message || 'Gagal memuat riwayat perubahan.' : null,
    entries: query.data ?? [],
  };
}