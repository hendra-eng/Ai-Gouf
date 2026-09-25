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
//
// [BARU - Bank & Cash] Baris "BC-" (finance_transaction_bank_cash, entri
// manual dari halaman Cash Payment/Cash Receipt) TIDAK tercatat di
// audit-log umum di atas (yang isinya cuma aksi jurnal_posting) --
// riwayatnya ada sendiri di finance_transaction_bank_cash_activity_log,
// yang sudah ditulis sejak lama (_catat_log_bank_cash di db_client.py)
// tapi baru sekarang ada endpoint yang membacanya: GET
// /api/v1/transaction/getBankCashActivityLog (sudah difilter server-side
// per bank_cash_id, beda dari audit-log umum yang difilter di frontend).

import { useQuery } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { auditLogClient, bankCashActivityLogClient } from '@/app/agent-ai/lib/api';
import { extractPostingId } from './jurnalBridge';
import { extractBankCashId } from './bankCashBridge';

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

// [BARU - Bank & Cash] label event_type dari finance_transaction_bank_cash_activity_log
// (lihat _catat_log_bank_cash di db_client.py -- nilai persis "CREATED"/"UPDATED"/"POSTING"/"REJECTED").
interface BackendBankCashActivityRow {
  id: string;
  event_type: string;
  description: string;
  reference_no?: string | null;
  performed_by: string;
  created_at?: string | null;
}

const BANK_CASH_ACTION_LABELS: Record<string, string> = {
  CREATED: 'Dibuat',
  UPDATED: 'Diedit',
  POSTING: 'Diposting',
  REJECTED: 'Ditolak/dibatalkan',
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
   * false = transaksi ini bukan baris backend asli (bukan dari
   * jurnal_posting MAUPUN finance_transaction_bank_cash -- data contoh /
   * hasil import lokal yang belum sempat direfetch) — tidak ada riwayat
   * server untuk dicari sama sekali, beda dari "sudah dicari tapi kosong".
   * (Nama field dipertahankan "hasPostingId" utk kompatibilitas kode lama;
   * sekarang juga true untuk baris "BC-" -- lihat hasBankCashId kalau perlu
   * bedakan sumbernya secara eksplisit.)
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

// [BARU - Bank & Cash] Sumbernya sudah difilter per bank_cash_id di
// backend (lihat dbc.daftar_log_bank_cash) -- beda dari fetchAuditTrail
// di atas yang harus filter sendiri di frontend dari log client-wide.
async function fetchBankCashActivityLog(clientId: string, bankCashId: string): Promise<AuditTrailEntry[]> {
  const res: { activity_log: BackendBankCashActivityRow[] } = await bankCashActivityLogClient(clientId, bankCashId);
  const rows = res?.activity_log || [];
  return rows.map((e) => ({
    id: `bank-cash-log-${e.id}`,
    user: e.performed_by || 'System',
    action: BANK_CASH_ACTION_LABELS[e.event_type] || e.event_type,
    time: formatWaktu(e.created_at),
    detail: e.description + (e.reference_no ? ` (Ref: ${e.reference_no})` : ''),
  }));
}

// [DIUBAH -- cache lewat TanStack Query] Kalau drawer transaksi yang sama
// dibuka-tutup berkali-kali dalam waktu singkat, riwayatnya tidak fetch
// ulang tiap kali (cache 60 detik per posting_id/bank_cash_id).
/** Ambil riwayat perubahan ASLI untuk satu transaksi (dicocokkan lewat jeId
 * -> posting_id UNTUK baris jurnal_posting, ATAU jeId -> bank_cash_id
 * UNTUK baris manual Bank & Cash -- lihat catatan modul di atas). */
export function useTransactionAuditTrail(jeId: string | undefined | null): TransactionAuditTrail {
  const { activeClientId, hydrated } = useActiveClient();
  const postingId = extractPostingId(jeId);
  const bankCashId = postingId === null ? extractBankCashId(jeId) : null;

  const query = useQuery({
    queryKey: ['transaction-audit-trail', activeClientId, postingId, bankCashId],
    queryFn: () => {
      if (postingId !== null) return fetchAuditTrail(activeClientId as string, postingId);
      return fetchBankCashActivityLog(activeClientId as string, bankCashId as string);
    },
    enabled: hydrated && (postingId !== null || bankCashId !== null) && !!activeClientId,
    staleTime: 60 * 1000,
  });

  const hasHistorySource = postingId !== null || bankCashId !== null;
  const loading = hydrated && hasHistorySource && !!activeClientId && query.isPending;
  return {
    loading,
    hasPostingId: hasHistorySource,
    error: query.error ? (query.error as Error)?.message || 'Gagal memuat riwayat perubahan.' : null,
    entries: query.data ?? [],
  };
}