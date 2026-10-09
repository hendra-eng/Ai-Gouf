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
