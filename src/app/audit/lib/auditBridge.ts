'use client';
// ─── JEMBATAN backend (schema "6_Intelligence": audit_finding/audit_stage/
// audit_activity/audit_evidence) → halaman Audit Center (src/app/audit/
// page.tsx) ──────────────────────────────────────────────────────────────
// Sebelumnya halaman ini SENGAJA pakai array statis KOSONG untuk
// auditStages/findings/auditActivities (lihat komentar lama di page.tsx)
// karena belum ada jembatan yang membaca 4 tabel Supabase modul Audit --
// padahal backend (db_client.py::ambil_data_audit/tambah_audit_finding/
// ubah_audit_finding/tambah_audit_evidence/ubah_audit_stage) dan client API
// (src/app/agent-ai/lib/api.js::auditDataClient/dst) SUDAH lengkap. File
// ini melengkapi bagian yang hilang itu, mengikuti pola bridge lain
// (purchasebridge.ts, assetRegisterBridge.ts): satu hook `useAuditData()`
// yang fetch + memetakan raw response ke tipe yang dipakai page.tsx, plus
// helper `refetch()` yang dipanggil page.tsx setelah tiap mutasi
// (New Finding/Review/Resolve/Escalate/Add Evidence/klik stage) supaya
// tampilan langsung sinkron dengan Supabase.
//
// Catatan jujur: "Audit Trail" di bagian BAWAH halaman ini TETAP dari
// useAuditTrail.ts (diturunkan dari jurnal_posting) -- itu memang riwayat
// posting jurnal, beda konsep dari Audit Activity Timeline (audit_activity)
// yang dipetakan di sini. Keduanya sengaja tetap terpisah.

import { useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { auditDataClient } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';

// ─── Bentuk mentah dari backend (lihat db_client.py::ambil_data_audit) ─────
interface RawFinding {
  id: string; findingNo: number; area: string | null; description: string;
  account: string | null; amount: number; risk: string; assignedTo: string | null;
  dueDate: string | null; status: string; rootCause: string | null;
  recommendation: string | null; managementResponse: string | null;
  likelihood: number; impact: number;
}
interface RawStage {
  id: string; label: string; date: string | null; done: boolean;
  current: boolean; sortOrder: number;
}
interface RawActivity {
  id: string; findingId: string | null; user: string; action: string;
  type: string; date: string | null;
}
interface RawEvidence {
  id: string; findingId: string; fileName: string; fileSize: number | null;
  uploadedBy: string | null; uploadedAt: string | null; mimeType: string | null;
}
interface RawAuditResponse {
  findings: RawFinding[];
  stages: RawStage[];
  activities: RawActivity[];
  evidence: RawEvidence[];
}

// ─── Tipe yang dipakai page.tsx ─────────────────────────────────────────────
export type FindingRisk = 'Low' | 'Medium' | 'High' | 'Critical';
export type FindingStatus = 'Open' | 'Under Review' | 'Management Response' | 'Resolved' | 'Accepted';

export interface AuditFinding {
  /** Kode tampilan, mis. "AUD-003" (dari finding_no) -- dipakai sbg React key & label. */
  id: string;
  /** UUID asli baris di Supabase -- WAJIB dipakai utk panggil ubahAuditFinding/dst, BUKAN `id` di atas. */
  dbId: string;
  area: string;
  description: string;
  account: string;
  amount: number;
  risk: FindingRisk;
  assignedTo: string;
  dueDate: string;
  status: FindingStatus;
  rootCause: string;
  recommendation: string;
  managementResponse: string;
  likelihood: number;
  impact: number;
  /** Jumlah evidence yang sudah dilampirkan -- dipakai utk KPI "Pending Evidence". */
  evidenceCount: number;
}

export interface AuditStage {
  /** UUID asli -- dipakai langsung sbg id (dipakai jg utk panggil ubahAuditStage). */
  id: string;
  label: string;
  date: string;
  done: boolean;
  current: boolean;
}

export interface AuditActivityEntry {
  id: string;
  findingId: string | null;
  user: string;
  action: string;
  time: string;
  date: string;
  type: string;
}

export interface AuditEvidenceItem {
  id: string;
  findingId: string;
  fileName: string;
  fileSize: number | null;
  uploadedBy: string;
  uploadedAt: string;
  mimeType: string | null;
}

export interface AuditKpis {
  completionPct: number;
  openFindings: number;
  highRisk: number;
  pendingEvidence: number;
  totalAdjustments: number;
  controlsTestedPct: number;
}

// ─── Helper umum ────────────────────────────────────────────────────────────
const RISKS: FindingRisk[] = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES: FindingStatus[] = ['Open', 'Under Review', 'Management Response', 'Resolved', 'Accepted'];

function matchEnum<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const found = allowed.find((a) => a.toLowerCase() === raw.toLowerCase());
  return found ?? fallback;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function mapFindings(raw: RawFinding[], evidence: RawEvidence[]): AuditFinding[] {
  const evidenceCountByFinding = new Map<string, number>();
  evidence.forEach((e) => evidenceCountByFinding.set(e.findingId, (evidenceCountByFinding.get(e.findingId) || 0) + 1));
  return raw.map((f) => ({
    id: `AUD-${String(f.findingNo).padStart(3, '0')}`,
    dbId: f.id,
    area: f.area || 'General',
    description: f.description,
    account: f.account || '',
    amount: f.amount,
    risk: matchEnum(f.risk, RISKS, 'Medium'),
    assignedTo: f.assignedTo || 'Unassigned',
    dueDate: fmtDate(f.dueDate),
    status: matchEnum(f.status, STATUSES, 'Open'),
    rootCause: f.rootCause || '',
    recommendation: f.recommendation || '',
    managementResponse: f.managementResponse || '',
    likelihood: f.likelihood,
    impact: f.impact,
    evidenceCount: evidenceCountByFinding.get(f.id) || 0,
  }));
}

function mapStages(raw: RawStage[]): AuditStage[] {
  return [...raw]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ id: s.id, label: s.label, date: fmtDate(s.date), done: s.done, current: s.current }));
}

function mapActivities(raw: RawActivity[]): AuditActivityEntry[] {
  return raw.map((a) => ({
    id: a.id,
    findingId: a.findingId,
    user: a.user,
    action: a.action,
    time: fmtTime(a.date),
    date: fmtDate(a.date),
    type: a.type,
  }));
}

function mapEvidence(raw: RawEvidence[]): AuditEvidenceItem[] {
  return raw.map((e) => ({
    id: e.id,
    findingId: e.findingId,
    fileName: e.fileName,
    fileSize: e.fileSize,
    uploadedBy: e.uploadedBy || 'System',
    uploadedAt: fmtDate(e.uploadedAt),
    mimeType: e.mimeType,
  }));
}

/** Dipakai jg langsung oleh page.tsx kalau perlu hitung ulang dari findings yang sudah difilter. */
export function computeAuditKpis(findings: AuditFinding[], stages: AuditStage[]): AuditKpis {
  const doneStages = stages.filter((s) => s.done).length;
  const openFindings = findings.filter((f) => f.status === 'Open').length;
  const highRisk = findings.filter((f) => f.risk === 'High' || f.risk === 'Critical').length;
  // "Pending Evidence" = temuan yang belum di-resolve/accept TAPI belum ada bukti dilampirkan sama sekali.
  const pendingEvidence = findings.filter(
    (f) => f.status !== 'Resolved' && f.status !== 'Accepted' && f.evidenceCount === 0
  ).length;
  const totalAdjustments = findings.reduce((sum, f) => sum + f.amount, 0);
  // "Controls Tested" = proporsi temuan yang sudah bergerak melewati status Open (sudah direview/diproses).
  const controlsTestedPct = findings.length === 0 ? 0 : Math.round(((findings.length - openFindings) / findings.length) * 100);

  return {
    completionPct: stages.length === 0 ? 0 : Math.round((doneStages / stages.length) * 100),
    openFindings,
    highRisk,
    pendingEvidence,
    totalAdjustments,
    controlsTestedPct,
  };
}

export interface AuditData {
  loading: boolean;
  isSampleData: boolean;
  findings: AuditFinding[];
  stages: AuditStage[];
  activities: AuditActivityEntry[];
  evidence: AuditEvidenceItem[];
  kpis: AuditKpis;
  activeClientId: string | number | null;
  /** Ambil ulang data dari Supabase -- panggil setelah New Finding/Review/
   * Resolve/Escalate/Add Evidence/klik stage berhasil supaya halaman
   * langsung menampilkan data terbaru. */
  refetch: () => void;
}

const EMPTY_KPIS: AuditKpis = { completionPct: 0, openFindings: 0, highRisk: 0, pendingEvidence: 0, totalAdjustments: 0, controlsTestedPct: 0 };

export function useAuditData(): AuditData {
  const { activeClientId, hydrated } = useActiveClient();
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState<RawAuditResponse | null>(null);
  const requestIdRef = useRef(0);

  const load = () => {
    if (!activeClientId) {
      setRaw(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    auditDataClient(activeClientId)
      .then((res: RawAuditResponse) => {
        if (requestIdRef.current !== requestId) return;
        setRaw(res);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRaw(null);
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

  if (!raw) {
    return {
      loading: !hydrated || loading, isSampleData: true, findings: [], stages: [], activities: [], evidence: [],
      kpis: EMPTY_KPIS, activeClientId: activeClientId ?? null, refetch: load,
    };
  }

  const findings = mapFindings(raw.findings, raw.evidence);
  const stages = mapStages(raw.stages);
  const activities = mapActivities(raw.activities);
  const evidence = mapEvidence(raw.evidence);

  return {
    loading: !hydrated || loading,
    isSampleData: findings.length === 0 && stages.length === 0,
    findings,
    stages,
    activities,
    evidence,
    kpis: computeAuditKpis(findings, stages),
    activeClientId: activeClientId ?? null,
    refetch: load,
  };
}