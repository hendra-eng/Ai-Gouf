'use client';

// Import Other Transactions dari CSV/Excel -- diparse di browser (SheetJS),
// 1 baris = 1 transaksi, lalu dikirim ke POST /import (backend membuat DRAFT;
// kode akun kosong = akun default aturan template). Jenis/sub jenis boleh diisi
// key (loan_financing / loan_repayment) atau label (Loan & Financing / Loan Repayment).

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { CheckCircle2, Download, Loader2, Upload, XCircle } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { importRows, type ImportRow, type Meta } from '@/lib/otherTransactionStore';
import { btnOutline, btnPrimary } from '@/components/arap/arapUi';
import { Modal, tdCls } from '@/components/shared/moduleUi';

const KOLOM: { field: keyof ImportRow; label: string; aliases: string[]; required?: boolean }[] = [
  { field: 'type_key', label: 'Type', aliases: ['type', 'transaction type', 'jenis'], required: true },
  { field: 'subtype', label: 'Subtype', aliases: ['subtype', 'sub type', 'transaction subtype'] },
  { field: 'journal_date', label: 'Date', aliases: ['date', 'transaction date', 'tanggal'], required: true },
  { field: 'reference_no', label: 'Reference No.', aliases: ['reference', 'reference no', 'ref'] },
  { field: 'counterparty', label: 'Counterparty', aliases: ['counterparty', 'party', 'employee', 'vendor', 'lender', 'investor'] },
  { field: 'description', label: 'Description', aliases: ['description', 'purpose', 'keterangan'] },
  { field: 'amount', label: 'Amount', aliases: ['amount', 'nominal', 'total'], required: true },
  { field: 'extra_amount', label: 'Extra Amount', aliases: ['extra amount', 'interest portion', 'apic portion', 'interest'] },
  { field: 'main_account', label: 'Main Account', aliases: ['main account', 'account', 'debit account'] },
  { field: 'bank_account', label: 'Bank Account', aliases: ['bank account', 'bank', 'cash account'] },
  { field: 'offset_account', label: 'Offset Account', aliases: ['offset account', 'credit account', 'expense account'] },
  { field: 'extra_account', label: 'Extra Account', aliases: ['extra account', 'interest account', 'apic account'] },
  { field: 'branch', label: 'Branch', aliases: ['branch', 'cabang'] },
  { field: 'department', label: 'Department', aliases: ['department', 'departemen'] },
  { field: 'project', label: 'Project', aliases: ['project', 'proyek'] },
  { field: 'cost_center', label: 'Cost Center', aliases: ['cost center', 'cost centre'] },
  { field: 'due_date', label: 'Due Date', aliases: ['due date', 'maturity date', 'settlement due date'] },
  { field: 'notes', label: 'Notes', aliases: ['notes', 'catatan'] },
];

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s./]+/g, '');

function tanggalIso(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    const p = XLSX.SSF.parse_date_code(raw);
    return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function angka(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  // 1.234.567,89 (format Indonesia) atau 1,234,567.89
  const n = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return Number(n) || 0;
}

interface Baris { data: ImportRow; errors: string[] }

export default function OtherImportModal({ clientId, meta, onClose }: { clientId: string; meta: Meta; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<Baris[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<{ created: string[]; failed: { row: number; reason: string }[] } | null>(null);

  const jenis = useMemo(() => {
    const m = new Map<string, { key: string; subs: Map<string, string> }>();
    meta.types.forEach(t => {
      const subs = new Map<string, string>();
      t.subtypes.forEach(s => { subs.set(norm(s.key), s.key); subs.set(norm(s.label), s.key); });
      const v = { key: t.key, subs };
      m.set(norm(t.key), v); m.set(norm(t.name), v); m.set(norm(t.code), v);
    });
    return m;
  }, [meta.types]);

  const baca = async (f: File) => {
    setHasil(null);
    setFile(f.name);
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!json.length) { setRows([]); setMissing([]); toast.error('The file has no rows.'); return; }
    const headers = Object.keys(json[0]);
    const peta: Partial<Record<keyof ImportRow, string>> = {};
    KOLOM.forEach(k => {
      const a = [k.label, ...k.aliases].map(norm);
      const h = headers.find(x => a.includes(norm(x)));
      if (h) peta[k.field] = h;
    });
    const kurang = KOLOM.filter(k => k.required && !peta[k.field]).map(k => k.label);
    setMissing(kurang);
    if (kurang.length) { setRows([]); return; }
    const ambil = (r: Record<string, unknown>, f: keyof ImportRow) => (peta[f] ? r[peta[f] as string] : '');
    const teks = (r: Record<string, unknown>, f: keyof ImportRow) => String(ambil(r, f) ?? '').trim() || null;
    setRows(json.map((r, i) => {
      const errors: string[] = [];
      const j = jenis.get(norm(String(ambil(r, 'type_key') ?? '')));
      if (!j) errors.push('Unknown type');
      const subRaw = teks(r, 'subtype');
      const sub = subRaw ? j?.subs.get(norm(subRaw)) : undefined;
      if (subRaw && j && !sub) errors.push('Unknown subtype');
      const tgl = tanggalIso(ambil(r, 'journal_date'));
      if (!tgl) errors.push('Invalid date');
      const amount = angka(ambil(r, 'amount'));
      if (amount <= 0) errors.push('Amount must be > 0');
      return {
        errors,
        data: {
          row: i + 2, type_key: j?.key ?? String(ambil(r, 'type_key') ?? ''), subtype: sub ?? null, journal_date: tgl,
          reference_no: teks(r, 'reference_no'), counterparty: teks(r, 'counterparty'), description: teks(r, 'description'),
          amount, extra_amount: angka(ambil(r, 'extra_amount')), main_account: teks(r, 'main_account'), bank_account: teks(r, 'bank_account'),
          offset_account: teks(r, 'offset_account'), extra_account: teks(r, 'extra_account'), branch: teks(r, 'branch'),
          department: teks(r, 'department'), project: teks(r, 'project'), cost_center: teks(r, 'cost_center'),
          due_date: tanggalIso(ambil(r, 'due_date')), notes: teks(r, 'notes'),
        },
      };
    }));
  };

  const valid = rows.filter(r => !r.errors.length);
  const kirim = async () => {
    setBusy(true);
    try {
      const r = await importRows(clientId, valid.map(x => x.data));
      setHasil(r.data);
      (r.data.failed.length ? toast.warning : toast.success)(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unduhTemplate = () => {
    const contoh = [
      ['Employee Advance', 'Advance Issued', '2026-03-10', 'ADV-2026-003', 'Budi Santoso', 'Travel advance for client visit', '5000000', '', '', '', '', '', 'Head Office', 'Operations', '', '', '2026-03-31', ''],
      ['Loan & Financing', 'Loan Repayment', '2026-03-31', 'LM/012/2026', 'PT Bank Mandiri Tbk', 'Installment March', '12500000', '2500000', '', '', '', '', '', 'Finance', '', '', '', ''],
    ];
    const csv = [KOLOM.map(k => k.label), ...contoh].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'other-transactions-import-template.csv');
  };

  return (
    <Modal open onClose={onClose} width="max-w-5xl" title="Import Other Transactions"
      subtitle="Upload a CSV or Excel file — one row per transaction. Imported rows are saved as drafts; empty account columns use the template's default accounts."
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Close</button>
        {!hasil && <button type="button" disabled={!valid.length || busy} onClick={kirim} className={btnPrimary}>
          {busy && <Loader2 size={14} className="animate-spin" />} Import {valid.length} row(s)
        </button>}
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) baca(f); e.target.value = ''; }} />
        <button type="button" onClick={() => ref.current?.click()} className={btnPrimary}><Upload size={14} /> Choose File</button>
        <button type="button" onClick={unduhTemplate} className={btnOutline}><Download size={14} /> Download Template</button>
        {file && <span className="text-xs text-muted-foreground">{file}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Columns: {KOLOM.map(k => `${k.label}${k.required ? '*' : ''}`).join(', ')}. Types: {meta.types.map(t => t.name).join(', ')}.
        Account columns take the account code from the chart of accounts.
      </p>
      {missing.length > 0 && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Missing required column(s): {missing.join(', ')}.</p>}
      {hasil && (
        <div className="rounded-xl border border-border p-3 text-xs">
          <p className="font-semibold text-emerald-700">{hasil.created.length} draft(s) created{hasil.created.length ? `: ${hasil.created.slice(0, 10).join(', ')}${hasil.created.length > 10 ? '…' : ''}` : ''}</p>
          {hasil.failed.map(f => <p key={f.row} className="text-rose-600">Row {f.row}: {f.reason}</p>)}
        </div>
      )}
      {rows.length > 0 && !hasil && (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-muted-foreground"><tr>
              <th className="px-3 py-2">Row</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Counterparty</th>
              <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Check</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.data.row}>
                  <td className={tdCls}>{r.data.row}</td>
                  <td className={tdCls}>{meta.types.find(t => t.key === r.data.type_key)?.name ?? r.data.type_key}{r.data.subtype ? ` · ${r.data.subtype}` : ''}</td>
                  <td className={tdCls}>{r.data.journal_date ?? '—'}</td>
                  <td className={tdCls}>{r.data.counterparty ?? '—'}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(r.data.amount)}</td>
                  <td className={tdCls}>{r.errors.length
                    ? <span className="inline-flex items-center gap-1 text-rose-600"><XCircle size={13} /> {r.errors.join(', ')}</span>
                    : <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> Ready</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
