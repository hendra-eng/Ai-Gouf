import { useNotesStatement } from '../../lib/useStatementData';

export interface NoteTableRow {
  id: string;
  cells: string[];
  isTotal?: boolean;
  isSubtotal?: boolean;
}

export interface NoteTable {
  id: string;
  headers: string[];
  rows: NoteTableRow[];
}

export interface AccordionItem {
  id: string;
  title: string;
  content: string;
}

export interface CrossRef {
  id: string;
  label: string;
}

export interface NoteData {
  num: string;
  title: string;
  tag: 'Policy Note' | 'Disclosed' | 'Supporting Schedule';
  relatedStatement: string;
  intro: string;
  tables?: NoteTable[];
  accordion?: AccordionItem[];
  crossRefs?: CrossRef[];
}

// Catatan dibangun dari API /api/v1/financial-statements (bagian `notes`) --
// transaksi POSTED fitur Transactions. Tiap catatan pos berisi tabel rincian
// saldo per akun (periode berjalan vs awal tahun), dalam JUTA rupiah.
function fmtJuta(v: number): string {
  if (Math.abs(v) < 0.005) return '—';
  const teks = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${teks})` : teks;
}

export function useAllNotes(): NoteData[] {
  const { notes, asOfLabel, compareLabel } = useNotesStatement();
  return notes.map((n) => ({
    num: n.no,
    title: n.title,
    tag: n.tag,
    relatedStatement: n.statement,
    intro: n.narasi,
    tables: n.rows.length === 0 ? undefined : [{
      id: `tbl-${n.key}`,
      headers: ['Code', 'Account', `${asOfLabel} (Rp Jt)`, `${compareLabel} (Rp Jt)`],
      rows: [
        ...n.rows.map((r) => ({ id: `${n.key}-${r.code}`, cells: [r.code, r.name, fmtJuta(r.current), fmtJuta(r.prev)] })),
        { id: `${n.key}-total`, cells: ['', 'Total', fmtJuta(n.total ?? 0), fmtJuta(n.prevTotal ?? 0)], isTotal: true },
      ],
    }],
  }));
}
