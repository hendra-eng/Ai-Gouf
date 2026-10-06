'use client';
// ─── JEMBATAN backend (jurnal_posting) → Audit Trail (halaman Audit) ──────
// Sebelumnya file ini SALAH ISI (ketuker dengan hook Fixed Asset Register),
// sehingga `useAuditTrail` yang diimpor page.tsx tidak pernah ada -> build
// gagal ("is not exported"/"is not a function").
//
// Sumber data: GET /api/client/{client_id}/jurnal-posting TANPA filter
// status (daftarJurnalPosting(clientId, '') -- status kosong = semua
// status: draft/terposting/ditolak), endpoint & fungsi yang SAMA dipakai
// jurnalBridge.ts di halaman Transaksi. Ini juga yang dirujuk komentar di
// agent-ai/lib/api.js dan clientActivityBridge.ts.
//
// [Keterbatasan yang SENGAJA dibiarkan jujur, bukan bug]
// 1) Backend jurnal_posting TIDAK menyimpan histori before/after per field
//    (beda dari audit_log admin generik) -- jadi "Previous Value"/"New
//    Value" di tabel tidak bisa diisi dari data asli dan dibiarkan '—',
//    bukan diisi angka karangan.
// 2) "Module" diturunkan dari jenis_dokumen upload asal baris ini kalau
//    ada; kalau tidak ada, fallback ke label generik "Jurnal".

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { daftarJurnalPosting } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';

export interface AuditTrailRow {
  id: string;
  user: string;
  action: 'Created' | 'Posted' | 'Rejected';
  module: string;
  record: string;
  timestamp: string;
  prevValue?: string;
  newValue?: string;
}

interface BackendJurnalRow {
  id: number;
  jenis_dokumen?: string | null;
  no_dokumen?: string | null;
  status?: string | null; // 'draft' | 'terposting' | 'ditolak'
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

// 'draft' backend = sudah masuk sistem tapi belum diposting ke buku besar
// (lihat catatan sama di jurnalBridge.ts) -> ditampilkan sebagai "Created",
// BUKAN "Draft", supaya konsisten dgn styling badge di page.tsx (hijau
// utk Created, biru utk Posted, merah utk selain itu).
const ACTION_MAP: Record<string, AuditTrailRow['action']> = {
  draft: 'Created',
  terposting: 'Posted',
  ditolak: 'Rejected',
};

function mapAction(status?: string | null): AuditTrailRow['action'] {
  if (!status) return 'Created';
  return ACTION_MAP[status] || 'Created';
}

function labelModule(jenis?: string | null): string {
  if (!jenis) return 'Jurnal';
  return jenis.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtWaktu(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function fromRow(row: BackendJurnalRow): AuditTrailRow {
  const timestamp = row.diposting_at || row.dibuat_at || null;
  return {
    id: `jp-${row.id}`,
    user: row.diposting_oleh || 'System',
    action: mapAction(row.status),
    module: labelModule(row.jenis_dokumen),
    record: row.no_dokumen || `JE-${row.id}`,
    timestamp: fmtWaktu(timestamp),
  };
}

export interface AuditTrailData {
  loading: boolean;
  isSampleData: boolean;
  trail: AuditTrailRow[];
}

export function useAuditTrail(): AuditTrailData {
  const { activeClientId, hydrated } = useActiveClient();
  // [FIX flash-ke-0] Default true -- lihat penjelasan di useProfitLossData.ts
  const [loading, setLoading] = useState(true);
  const [trail, setTrail] = useState<AuditTrailRow[]>([]);
  const requestIdRef = useRef(0);

  const load = () => {
    if (!activeClientId) {
      setTrail([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    daftarJurnalPosting(activeClientId, '')
      .then((res: any) => {
        if (requestIdRef.current !== requestId) return;
        const rows: BackendJurnalRow[] = res?.jurnal || [];
        const sorted = [...rows].sort((a, b) => {
          const ta = a.diposting_at || a.dibuat_at || '';
          const tb = b.diposting_at || b.dibuat_at || '';
          return tb.localeCompare(ta);
        });
        setTrail(sorted.map(fromRow));
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setTrail([]);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  };

  useEffect(() => {
    if (!hydrated) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeClientId]);

  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  return { loading, isSampleData: trail.length === 0, trail };
}