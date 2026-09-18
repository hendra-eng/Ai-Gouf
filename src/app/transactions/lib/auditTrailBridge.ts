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

import { useEffect, useRef, useState } from 'react';
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

/** Ambil riwayat perubahan ASLI untuk satu transaksi (dicocokkan lewat jeId -> posting_id). */
export function useTransactionAuditTrail(jeId: string | undefined | null): TransactionAuditTrail {
  const { activeClientId, hydrated } = useActiveClient();
  const postingId = extractPostingId(jeId);
  // [FIX flash-ke-0] Default true -- lihat penjelasan di useProfitLossData.ts
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditTrailEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!hydrated) return;
    if (postingId === null || !activeClientId) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    auditLogClient(activeClientId)
      .then((res: { audit_log: BackendAuditRow[] }) => {
        if (requestIdRef.current !== requestId) return;
        const rows = (res?.audit_log || []).filter(
          (e) => e.detail && Number(e.detail.posting_id) === postingId
        );
        setEntries(
          rows.map((e) => ({
            id: `audit-${e.id}`,
            user: e.user || 'System',
            action: ACTION_LABELS[e.aksi] || e.aksi,
            time: formatWaktu(e.dibuat_at),
            detail: ringkasDetail(e.aksi, e.detail || {}),
          }))
        );
      })
      .catch((err: Error) => {
        if (requestIdRef.current !== requestId) return;
        setError(err?.message || 'Gagal memuat riwayat perubahan.');
        setEntries([]);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [hydrated, postingId, activeClientId]);

  return { loading, hasPostingId: postingId !== null, error, entries };
}
