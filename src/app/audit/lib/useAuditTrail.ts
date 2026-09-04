'use client';

// [BARU] Sambungkan bagian "Audit Trail" di halaman Audit ke data ASLI
// client aktif -- SATU-SATUNYA bagian di halaman Audit yang benar-benar
// bisa diturunkan dari data transaksi (jurnal), karena isinya memang
// sebuah LOG PERUBAHAN RECORD (siapa mengubah apa, kapan) -- bukan hasil
// judgment/analisis auditor seperti Findings, Root Cause, Recommendation,
// Management Response, atau Audit Stages/KPI completion yang TETAP data
// contoh (lihat komentar di page.tsx) karena tidak ada sumber data
// terstruktur utk itu di backend saat ini.
//
// Sumber data: GET /api/client/{id}/jurnal-posting (semua status), fungsi
// daftarJurnalPosting() yang SAMA dipakai TransactionsContext.tsx
// (halaman Transaksi) -- jadi tidak ada endpoint baru, dan baris yang
// tampil di sini selalu konsisten dengan tabel Transaksi client yang sama.
// Satu baris jurnal_posting (debet+kredit) dijadikan SATU baris Audit
// Trail (bukan dipecah dua leg seperti jurnalBridge.ts), karena di sini
// yang relevan adalah "record apa yang berubah", bukan sisi debet/kredit.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { daftarJurnalPosting } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';
import { formatIDR } from '@/lib/financialData';

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

const SAMPLE_TRAIL: AuditTrailRow[] = [
  { id: 't1', user: 'Budi S.', action: 'Posted', module: 'Accounts Receivable', record: 'INV-2026-089', timestamp: '2026-08-28 10:30', prevValue: 'Draft', newValue: 'Rp 45M' },
  { id: 't2', user: 'Sari W.', action: 'Created', module: 'Audit Finding', record: 'AUD-002', timestamp: '2026-08-27 14:15', prevValue: '—', newValue: 'New Finding' },
  { id: 't3', user: 'System', action: 'Posted', module: 'Revenue', record: 'JE-2026-445', timestamp: '2026-08-26 09:00', prevValue: '—', newValue: 'Anomaly detected' },
  { id: 't4', user: 'Ahmad R.', action: 'Posted', module: 'Expenses', record: 'EXP-2026-440', timestamp: '2026-08-25 16:45', prevValue: 'Pending', newValue: 'Approved' },
  { id: 't5', user: 'Dewi P.', action: 'Posted', module: 'Audit Finding', record: 'AUD-004', timestamp: '2026-08-25 11:20', prevValue: 'Open', newValue: 'Resolved' },
];

interface BackendJurnalRow {
  id: number;
  tanggal?: string | null;
  keterangan?: string | null;
  no_dokumen?: string | null;
  lawan_transaksi?: string | null;
  nama_akun_debet?: string | null;
  nama_akun_kredit?: string | null;
  jml_debet?: number | null;
  jml_kredit?: number | null;
  status?: string | null; // 'draft' | 'terposting' | 'ditolak'
  diposting_oleh?: string | null;
  diposting_at?: string | null;
  dibuat_at?: string | null;
}

const ACTION_MAP: Record<string, AuditTrailRow['action']> = {
  terposting: 'Posted',
  draft: 'Created',
  ditolak: 'Rejected',
};

function toRow(r: BackendJurnalRow): AuditTrailRow {
  const amount = r.jml_debet || r.jml_kredit || 0;
  const timestamp = r.diposting_at || r.dibuat_at || r.tanggal || '';
  return {
    id: `jp-${r.id}`,
    user: r.diposting_oleh || 'System',
    action: ACTION_MAP[r.status || ''] || 'Created',
    module: r.nama_akun_debet || r.nama_akun_kredit || 'Jurnal',
    record: r.no_dokumen || `JE-${r.id}`,
    timestamp: timestamp ? timestamp.replace('T', ' ').slice(0, 16) : '—',
    prevValue: r.status === 'terposting' ? 'Draft' : '—',
    newValue: amount ? formatIDR(amount, true) : (r.keterangan || '—'),
  };
}

interface AuditTrailData {
  loading: boolean;
  isSampleData: boolean;
  trail: AuditTrailRow[];
}

export function useAuditTrail(): AuditTrailData {
  const { activeClientId } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [trail, setTrail] = useState<AuditTrailRow[] | null>(null);
  const requestIdRef = useRef(0);

  const load = () => {
    if (!activeClientId) {
      setTrail(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    daftarJurnalPosting(activeClientId, '') // '' -> semua status (draft + terposting + ditolak)
      .then((res: { jurnal: BackendJurnalRow[] }) => {
        if (requestIdRef.current !== requestId) return;
        const rows = res?.jurnal || [];
        if (rows.length === 0) {
          setTrail(null);
        } else {
          const sorted = [...rows].sort((a, b) => {
            const ta = a.diposting_at || a.dibuat_at || a.tanggal || '';
            const tb = b.diposting_at || b.dibuat_at || b.tanggal || '';
            return tb.localeCompare(ta);
          });
          setTrail(sorted.slice(0, 25).map(toRow));
        }
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setTrail(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  if (trail) return { loading, isSampleData: false, trail };
  return { loading, isSampleData: true, trail: SAMPLE_TRAIL };
}
