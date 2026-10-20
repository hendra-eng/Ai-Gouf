'use client';

// Upload file jurnal Other (CSV/Excel) -- diparse di browser (SheetJS),
// baris dikelompokkan per Journal No., kode akun dicocokkan ke COA company
// (GET /accounts), lalu tiap jurnal valid disimpan sebagai DRAFT lewat
// saveOtherJournal (POST /journals). Belum ada template backend untuk Other,
// jadi kolomnya generik (lihat OTHER_HEADER_ALIASES -- juga ditampilkan di
// modal Mapping Rules tab Source Data).

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { CheckCircle2, Upload, XCircle } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import {
  fetchOtherAccounts, OTHER_CATEGORY, saveOtherJournal, useOtherData, type OtherAccount, type OtherCategory,
} from '@/lib/otherJournalStore';
import { btnOutline, btnPrimary } from '@/components/arap/arapUi';
import { Modal, tdCls } from '@/components/shared/moduleUi';

export const OTHER_REQUIRED_COLUMNS = ['journal_no', 'journal_date', 'account_code'];
export const OTHER_HEADER_ALIASES: Record<string, string[]> = {
  journal_no: ['journal no', 'journal no.', 'journal number', 'je number', 'no jurnal', 'nomor jurnal'],
  journal_date: ['date', 'journal date', 'tanggal'],
  category: ['category', 'kategori'],
  reference: ['party', 'reference', 'party / reference', 'referensi'],
  description: ['description', 'deskripsi', 'keterangan'],
  account_code: ['account code', 'kode akun'],
  line_description: ['line description', 'line memo', 'memo'],
  debit: ['debit', 'dr'],
  credit: ['credit', 'kredit', 'cr'],
};
export const OTHER_FIELD_LABELS: Record<string, string> = {
  journal_no: 'Journal No.', journal_date: 'Date', category: 'Category', reference: 'Party / Reference', description: 'Description',
  account_code: 'Account Code', line_description: 'Line Description', debit: 'Debit', credit: 'Credit',
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s.]+/g, '');

function petakanHeader(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(OTHER_HEADER_ALIASES)) {
    const a = aliases.map(norm);
    const found = headers.find(h => a.includes(norm(h)));
    if (found) map[field] = found;
  }
  return map;
}

function tanggalIso(raw: unknown): string {
  if (typeof raw === 'number') {
    const p = XLSX.SSF.parse_date_code(raw);
    return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '';
  }
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** Kategori boleh diisi key (capex) atau label (CapEx) -- kosong = General Journal. */
function kategori(raw: string): OtherCategory | null {
  const s = raw.trim().toLowerCase();
  if (!s) return 'general';
  const hit = (Object.entries(OTHER_CATEGORY) as [OtherCategory, string][]).find(([k, l]) => k === s || l.toLowerCase() === s);
  return hit ? hit[0] : null;
}

interface Grup {
  journal_no: string; journal_date: string; category: OtherCategory; reference: string; description: string;
  lines: { account_code: string; coa_id: string | null; description: string; debit: number; credit: number }[];
  debit: number; credit: number; errors: string[];
}

function parse(rows: Record<string, unknown>[], akun: Map<string, OtherAccount>): { groups: Grup[]; missing: string[] } {
  if (!rows.length) return { groups: [], missing: [] };
  const hm = petakanHeader(Object.keys(rows[0]));
  const missing = OTHER_REQUIRED_COLUMNS.filter(f => !hm[f]);
  if (missing.length) return { groups: [], missing: missing.map(f => OTHER_FIELD_LABELS[f]) };
  const ambil = (row: Record<string, unknown>, f: string) => (hm[f] ? String(row[hm[f]] ?? '').trim() : '');

  const peta = new Map<string, Grup & { kategoriMentah: string }>();
  rows.forEach(row => {
    const no = ambil(row, 'journal_no').toUpperCase();
    if (!no) return;
    let g = peta.get(no);
    if (!g) {
      const kat = ambil(row, 'category');
      g = {
        journal_no: no, journal_date: tanggalIso(row[hm.journal_date]), category: kategori(kat) ?? 'general', kategoriMentah: kat,
        reference: ambil(row, 'reference'), description: ambil(row, 'description'), lines: [], debit: 0, credit: 0, errors: [],
      };
      peta.set(no, g);
    }
    const kode = ambil(row, 'account_code');
    g.lines.push({
      account_code: kode, coa_id: akun.get(kode)?.id ?? null, description: ambil(row, 'line_description'),
      debit: Number(row[hm.debit] ?? 0) || 0, credit: hm.credit ? Number(row[hm.credit] ?? 0) || 0 : 0,
    });
  });

  const groups = Array.from(peta.values()).map(({ kategoriMentah, ...g }) => {
    const debit = g.lines.reduce((s, l) => s + l.debit, 0);
    const credit = g.lines.reduce((s, l) => s + l.credit, 0);
    const errors: string[] = [];
    if (!g.journal_date) errors.push('Date is empty/invalid (use YYYY-MM-DD or DD/MM/YYYY).');
    if (kategori(kategoriMentah) === null) errors.push(`Unknown category "${kategoriMentah}".`);
    if (g.lines.length < 2) errors.push('Minimum 2 lines per journal.');
    const tanpaAkun = g.lines.filter(l => !l.coa_id).map(l => l.account_code || '(empty)');
    if (tanpaAkun.length) errors.push(`Account not found in COA: ${Array.from(new Set(tanpaAkun)).join(', ')}.`);
    if (g.lines.some(l => l.debit > 0 && l.credit > 0)) errors.push('A line has both Debit and Credit.');
    if (!(debit > 0 && Math.abs(debit - credit) < 0.01)) errors.push(`Not balanced (Debit ${rupiah(debit)} ≠ Credit ${rupiah(credit)}).`);
    return { ...g, debit, credit, errors };
  });
  return { groups, missing: [] };
}

export default function OtherImportModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const akun = useOtherData<OtherAccount[]>(`oacc:${clientId}`, s => fetchOtherAccounts(clientId, s), []);
  const kodeAkun = useMemo(() => new Map(akun.data.map(a => [a.code, a])), [akun.data]);
  const [fileName, setFileName] = useState('');
  const [groups, setGroups] = useState<Grup[]>([]);
  const [results, setResults] = useState<{ journal_no: string; ok: boolean; message: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = groups.filter(g => !g.errors.length);

  const baca = async (file: File) => {
    if (akun.loading) { toast.error('Chart of accounts is still loading, try again in a moment.'); return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const { groups: g, missing } = parse(rows, kodeAkun);
      if (missing.length) { toast.error('File format not supported', { description: `Required columns not found: ${missing.join(', ')}` }); return; }
      if (!g.length) { toast.error('No rows with a Journal No. could be read from this file.'); return; }
      setFileName(file.name);
      setGroups(g);
      setResults(null);
    } catch (e) {
      toast.error(`Failed to read file: ${(e as Error).message}`);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const impor = async () => {
    setBusy(true);
    const hasil: { journal_no: string; ok: boolean; message: string }[] = [];
    for (const g of valid) {
      try {
        await saveOtherJournal(clientId, {
          journal_no: g.journal_no, journal_date: g.journal_date, category: g.category,
          reference: g.reference || null, description: g.description || null,
          lines: g.lines.map(l => ({ coa_id: l.coa_id, description: l.description || null, debit: l.debit, credit: l.credit })),
        });
        hasil.push({ journal_no: g.journal_no, ok: true, message: `Imported as draft (${g.lines.length} lines).` });
      } catch (e) {
        hasil.push({ journal_no: g.journal_no, ok: false, message: (e as Error).message });
      }
    }
    setBusy(false);
    setResults(hasil);
    const ok = hasil.filter(r => r.ok).length;
    if (ok) toast.success(`${ok} of ${valid.length} journals imported as draft.`);
    else toast.error('No journal was imported.');
  };

  return (
    <Modal open onClose={busy ? () => undefined : onClose} width="max-w-4xl" title="Upload Other Journals"
      subtitle="Rows are grouped per Journal No.; each balanced journal is saved as a draft. See Mapping Rules for the accepted column headers."
      footer={results ? <button type="button" onClick={onClose} className={btnPrimary}>Done</button> : groups.length ? (
        <>
          <button type="button" onClick={() => setGroups([])} disabled={busy} className={btnOutline}>Choose Another File</button>
          <button type="button" onClick={impor} disabled={busy || !valid.length} className={btnPrimary}>
            {busy ? 'Importing…' : `Import ${valid.length} Journal${valid.length === 1 ? '' : 's'}`}
          </button>
        </>
      ) : undefined}>
      {!groups.length && (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) baca(f); }}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-border py-12 text-center hover:bg-slate-50"
        >
          <Upload size={28} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Drag & drop a file here, or click to choose a file</p>
          <p className="mt-1 text-xs text-muted-foreground">Format: .xlsx, .xls, .csv -- use the Excel Template for the expected columns</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) baca(f); }} />
        </div>
      )}

      {groups.length > 0 && !results && (
        <>
          <p className="text-sm"><b>{fileName}</b> · {groups.length} journals · <span className="text-emerald-700">{valid.length} valid</span>
            {groups.length - valid.length > 0 && <span className="text-rose-600"> · {groups.length - valid.length} with errors (skipped)</span>}</p>
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-muted-foreground">
                <tr>{['Journal No.', 'Date', 'Category', 'Lines', 'Debit', 'Credit', 'Check'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">{groups.map(g => (
                <tr key={g.journal_no}>
                  <td className={`${tdCls} font-mono text-xs`}>{g.journal_no}</td><td className={tdCls}>{g.journal_date || '—'}</td>
                  <td className={tdCls}>{OTHER_CATEGORY[g.category]}</td><td className={tdCls}>{g.lines.length}</td>
                  <td className={tdCls}>{rupiah(g.debit)}</td><td className={tdCls}>{rupiah(g.credit)}</td>
                  <td className={tdCls}>{g.errors.length
                    ? <span className="inline-flex items-start gap-1 text-xs text-rose-600"><XCircle size={13} className="mt-0.5 shrink-0" />{g.errors.join(' ')}</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={13} /> Ready</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {results && (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-muted-foreground">
              <tr>{['Journal No.', 'Status', 'Notes'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">{results.map(r => (
              <tr key={r.journal_no}>
                <td className={`${tdCls} font-mono text-xs`}>{r.journal_no}</td>
                <td className={tdCls}>{r.ok ? <span className="text-emerald-700">Success</span> : <span className="text-rose-600">Failed</span>}</td>
                <td className={`${tdCls} text-xs text-muted-foreground`}>{r.message}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
