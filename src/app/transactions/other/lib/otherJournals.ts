import type { Transaction } from '../../components/transactionData';

// Pengelompokan baris transaksi grup "Other" per NOMOR JURNAL, dipakai bersama
// oleh semua tab di halaman Other (Source Data, Transaction, Journal Preview,
// Exceptions, Posted). Semua dihitung dari data yang sama dengan tab Overview
// (useTransactions().getByGroup('other')), jadi angkanya selalu sinkron.

export type JournalStatus = Transaction['status'];

export interface OtherJournal {
  /** id unik untuk tabel (kunci pengelompokan) */
  id: string;
  /** nomor jurnal; '—' bila baris tidak punya jeId */
  jeId: string;
  date: string;
  party: string;
  description: string;
  category: string;
  sourceLabel: string;
  status: JournalStatus;
  lines: Transaction[];
  debit: number;
  credit: number;
  /** nilai jurnal = sisi terbesar (sama dengan aturan journalAmount di groupAnalytics) */
  amount: number;
  diff: number;
  /** hanya bermakna untuk jurnal >= 2 baris (baris tunggal sengaja tidak dicek, lihat unbalancedJournals) */
  balanced: boolean;
  multiLine: boolean;
  missingJeId: boolean;
  notes: string[];
  unmapped: boolean;
}

const STATUS_PRIORITY: JournalStatus[] = ['Draft', 'Unposted', 'Posted', 'Reconciled', 'Voided'];

export function sourceLabelOf(tx: Transaction): string {
  const s = (tx.sourceModule || '').trim();
  if (!s) return 'Import / Legacy';
  return s.toUpperCase() === 'GENERAL_JOURNAL' ? 'General Journal' : s;
}

function journalStatus(lines: Transaction[]): JournalStatus {
  if (lines.every((l) => l.status === 'Voided')) return 'Voided';
  const active = lines.filter((l) => l.status !== 'Voided');
  for (const st of STATUS_PRIORITY) {
    if (active.some((l) => l.status === st)) return st;
  }
  return active[0].status;
}

export function buildOtherJournals(transactions: Transaction[]): OtherJournal[] {
  const groups = new Map<string, Transaction[]>();
  transactions.forEach((tx) => {
    const je = (tx.jeId || '').trim();
    const ref = (tx.reference || '').trim();
    const key = je ? `je:${je}` : ref ? `ref:${ref}|${tx.date}` : `solo:${tx.id}`;
    const arr = groups.get(key);
    if (arr) arr.push(tx);
    else groups.set(key, [tx]);
  });

  const result: OtherJournal[] = [];
  groups.forEach((lines, key) => {
    const first = lines[0];
    const debit = lines.reduce((s, r) => s + r.debit, 0);
    const credit = lines.reduce((s, r) => s + r.credit, 0);
    const multiLine = lines.length >= 2;
    const notes = Array.from(new Set(lines.map((l) => (l.notes || '').trim()).filter(Boolean)));
    result.push({
      id: key,
      jeId: (first.jeId || '').trim() || '—',
      date: first.date,
      party: first.party,
      description: first.description,
      category: first.category,
      sourceLabel: sourceLabelOf(first),
      status: journalStatus(lines),
      lines,
      debit,
      credit,
      amount: Math.max(debit, credit),
      diff: Math.abs(debit - credit),
      balanced: !multiLine || Math.round(debit) === Math.round(credit),
      multiLine,
      missingJeId: !(first.jeId || '').trim(),
      notes,
      unmapped: lines.some((l) => !l.standardAccountCode),
    });
  });

  return result.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ── Exceptions ──────────────────────────────────────────────────────────────

export type ExceptionType =
  | 'Tanpa Nomor Jurnal'
  | 'Jurnal Tidak Balance'
  | 'Draft Menunggu Approval'
  | 'Perlu Ditinjau'
  | 'Akun Belum Dipetakan';

export type ExceptionSeverity = 'High' | 'Medium' | 'Low';

export interface OtherException {
  id: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  detail: string;
  journal: OtherJournal;
}

export const EXCEPTION_TYPES: ExceptionType[] = [
  'Tanpa Nomor Jurnal',
  'Jurnal Tidak Balance',
  'Draft Menunggu Approval',
  'Perlu Ditinjau',
  'Akun Belum Dipetakan',
];

export function buildOtherExceptions(journals: OtherJournal[]): OtherException[] {
  const out: OtherException[] = [];
  journals.forEach((j) => {
    if (j.status === 'Voided') return; // jurnal batal tidak perlu ditindaklanjuti
    const push = (type: ExceptionType, severity: ExceptionSeverity, detail: string) =>
      out.push({ id: `${j.id}#${type}`, type, severity, detail, journal: j });

    if (j.missingJeId) {
      push('Tanpa Nomor Jurnal', 'High', 'Baris tidak memiliki nomor jurnal (jeId); dikelompokkan memakai nomor referensi.');
    }
    if (!j.balanced) {
      push('Jurnal Tidak Balance', 'High', `Total debit dan kredit berbeda (selisih ${j.diff.toLocaleString('id-ID')}).`);
    }
    if (j.status === 'Draft') {
      push('Draft Menunggu Approval', 'Medium', 'Masih berstatus Draft, belum termasuk total Other sampai disetujui.');
    }
    if (j.notes.length > 0) {
      push('Perlu Ditinjau', 'Low', j.notes[0]);
    }
    if (j.unmapped) {
      push('Akun Belum Dipetakan', 'Low', 'Ada baris yang belum punya kode akun standar (standardAccountCode).');
    }
  });
  return out;
}

// ── Status, checklist & kesiapan posting ────────────────────────────────────

export const OTHER_STATUS_VARIANT: Record<JournalStatus, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

export interface JournalCheck {
  key: string;
  label: string;
  ok: boolean;
  /** true = menghalangi posting; false = peringatan saja */
  blocking: boolean;
}

export function journalChecks(j: OtherJournal): JournalCheck[] {
  return [
    { key: 'je', label: 'Nomor jurnal ada', ok: !j.missingJeId, blocking: true },
    { key: 'bal', label: 'Debit = Kredit', ok: j.balanced, blocking: true },
    { key: 'map', label: 'Akun terpetakan', ok: !j.unmapped, blocking: false },
    { key: 'notes', label: 'Tanpa catatan review', ok: j.notes.length === 0, blocking: false },
  ];
}

export type Readiness = 'draft' | 'fix' | 'ready';

export function readinessOf(j: OtherJournal): Readiness {
  if (j.status === 'Draft') return 'draft';
  return journalChecks(j).some((c) => c.blocking && !c.ok) ? 'fix' : 'ready';
}

/** Masalah per baris sumber (dipakai tab Source Data). */
export function lineIssues(tx: Transaction): string[] {
  const out: string[] = [];
  if (!(tx.jeId || '').trim()) out.push('Tanpa no. jurnal');
  if (!tx.standardAccountCode) out.push('Akun belum dipetakan');
  if ((tx.notes || '').trim()) out.push('Ada catatan');
  return out;
}

export const REMEDIATION: Record<ExceptionType, string> = {
  'Tanpa Nomor Jurnal': 'Lengkapi nomor jurnal (jeId) di halaman Transaksi utama agar kedua kaki jurnal terpasang benar.',
  'Jurnal Tidak Balance': 'Periksa nominal debit dan kredit tiap baris, lalu samakan totalnya.',
  'Draft Menunggu Approval': 'Minta approver menyetujui draft; sebelum itu nilainya belum masuk total Other.',
  'Perlu Ditinjau': 'Baca catatan pada baris jurnal, selesaikan tindak lanjutnya, lalu hapus catatan.',
  'Akun Belum Dipetakan': 'Petakan akun ke akun standar (COA) supaya laporan keuangan membacanya benar.',
};

export function monthKeyOf(date: string): string {
  return (date || '').slice(0, 7);
}

export function monthLabelOf(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
