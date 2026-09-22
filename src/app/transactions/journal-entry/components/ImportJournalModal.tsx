'use client';

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  XMarkIcon, ArrowUpTrayIcon, DocumentArrowDownIcon, CheckCircleIcon,
  ExclamationTriangleIcon, XCircleIcon,
} from '@heroicons/react/24/outline';
import { createJeDraftWithLines, uploadJeSourceFile, type JeDraftLineInput } from '@/lib/journalEntryStore';
import { useActiveClient } from '@/lib/activeClient';

// ============================================================
// Import Journal (frontend) -- 2 jalur, dicoba berurutan tiap file:
//
//   1. Backend Journal Entry Import Template (journal_entry_import_v1.py):
//      file MENTAH dikirim ke backend, dicocokkan ke pola kolom yang sudah
//      "dipelajari" untuk klien aktif (dropdown Switch Company) + format
//      file ini (lihat root/SALES_IMPORT_TEMPLATES.md -- versi Journal
//      Entry-nya). Kalau cocok, backend LANGSUNG membuat draft + baris
//      debit/kreditnya (tidak ada tahap preview manual di sini -- pola
//      kolom sudah dikenal & tervalidasi sebelumnya). Cocok untuk laporan
//      klien yang formatnya baku/berulang (mis. Jurnal Kas Kasir SAU).
//   2. Fallback: kalau backend bilang belum ada template yang cocok
//      (template_matched=false) -- parse di browser (SheetJS), kelompokkan
//      baris per JE Number lewat pencocokan nama header yang fleksibel
//      (case/spasi-insensitive), tampilkan preview, baru simpan manual
//      lewat POST /drafts/full begitu user klik Import. Cocok untuk file
//      ad-hoc yang belum punya template tersimpan.
// ============================================================

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

interface ParsedLine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
  cost_center: string;
}

interface ParsedGroup {
  je_number: string;
  entry_date: string;
  description: string;
  source_type: string;
  lines: ParsedLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  errors: string[];
}

type ImportResult = { je_number: string; ok: boolean; message: string };

const HEADER_ALIASES: Record<string, string[]> = {
  je_number: ['jenumber', 'je number', 'journal entry number', 'journalno', 'nojurnal', 'nomorjurnal'],
  entry_date: ['date', 'entrydate', 'entry date', 'tanggal'],
  description: ['description', 'deskripsi', 'desc', 'keterangan'],
  source_type: ['sourcetype', 'source type', 'source', 'sumber'],
  account_code: ['accountcode', 'account code', 'kodeakun', 'kode akun'],
  account_name: ['accountname', 'account name', 'namaakun', 'nama akun'],
  debit: ['debit', 'dr'],
  credit: ['credit', 'kredit', 'cr'],
  cost_center: ['costcenter', 'cost center'],
};

function normalisasiHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s]+/g, '');
}

function petakanHeader(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const normalized = headers.map(h => ({ original: h, norm: normalisasiHeader(h) }));
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const aliasesNorm = aliases.map(normalisasiHeader);
    const found = normalized.find(h => aliasesNorm.includes(h.norm));
    if (found) map[field] = found.original;
  }
  return map;
}

function parseFileToGroups(rows: Record<string, unknown>[]): { groups: ParsedGroup[]; missingColumns: string[] } {
  if (rows.length === 0) return { groups: [], missingColumns: [] };
  const headerMap = petakanHeader(Object.keys(rows[0]));
  const wajib = ['je_number', 'entry_date', 'account_code'];
  const missingColumns = wajib.filter(f => !headerMap[f]);
  if (missingColumns.length > 0) return { groups: [], missingColumns };

  const groupsByJe = new Map<string, ParsedGroup>();
  rows.forEach(row => {
    const jeNumber = String(row[headerMap.je_number] ?? '').trim();
    if (!jeNumber) return;
    const debit = Number(row[headerMap.debit] ?? 0) || 0;
    const credit = Number(row[headerMap.credit] ?? 0) || 0;
    let group = groupsByJe.get(jeNumber);
    if (!group) {
      let entryDate = String(row[headerMap.entry_date] ?? '').trim();
      // SheetJS bisa balikin serial number Excel utk kolom tanggal -- konversi ke YYYY-MM-DD.
      const rawDate = row[headerMap.entry_date];
      if (typeof rawDate === 'number') {
        const parsed = XLSX.SSF.parse_date_code(rawDate);
        if (parsed) entryDate = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
      group = {
        je_number: jeNumber,
        entry_date: entryDate,
        description: headerMap.description ? String(row[headerMap.description] ?? '').trim() : '',
        source_type: headerMap.source_type ? String(row[headerMap.source_type] ?? '').trim() || 'Manual' : 'Manual',
        lines: [], totalDebit: 0, totalCredit: 0, balanced: false, errors: [],
      };
      groupsByJe.set(jeNumber, group);
    }
    group.lines.push({
      account_code: String(row[headerMap.account_code] ?? '').trim(),
      account_name: headerMap.account_name ? String(row[headerMap.account_name] ?? '').trim() : '',
      description: headerMap.description ? String(row[headerMap.description] ?? '').trim() : '',
      debit, credit,
      cost_center: headerMap.cost_center ? String(row[headerMap.cost_center] ?? '').trim() : '',
    });
  });

  const groups = Array.from(groupsByJe.values()).map(g => {
    const totalDebit = g.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = g.lines.reduce((s, l) => s + l.credit, 0);
    const errors: string[] = [];
    if (!g.entry_date) errors.push('Date is empty/invalid.');
    if (g.lines.length < 2) errors.push('Minimum 2 lines per journal entry.');
    if (g.lines.some(l => !l.account_code)) errors.push('There is a line without an Account Code.');
    if (g.lines.some(l => l.debit > 0 && l.credit > 0)) errors.push('There is a line with both Debit & Credit filled in.');
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
    if (!balanced) errors.push(`Not balanced (Debit ${fmt(totalDebit)} ≠ Credit ${fmt(totalCredit)}).`);
    return { ...g, totalDebit, totalCredit, balanced: balanced && errors.length === 0, errors };
  });

  return { groups, missingColumns: [] };
}

function unduhTemplate() {
  const csv = [
    'JE Number,Date,Description,Source Type,Account Code,Account Name,Debit,Credit,Cost Center',
    'JE-2026-09-0100,2026-09-18,Contoh setoran modal,Manual,1100,Cash,1000000,0,',
    'JE-2026-09-0100,2026-09-18,Contoh setoran modal,Manual,3100,Owner Equity,0,1000000,',
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'template-import-journal-entry.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportJournalModal({
  clientId,
  createdByName,
  onClose,
}: {
  clientId: string;
  createdByName: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [fileName, setFileName] = useState('');
  const [groups, setGroups] = useState<ParsedGroup[]>([]);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [checkingTemplate, setCheckingTemplate] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeClientId } = useActiveClient();

  const parseLokal = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const firstSheet = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: '' });
      const { groups: parsedGroups, missingColumns: missing } = parseFileToGroups(rows);
      if (missing.length > 0) {
        setMissingColumns(missing);
        setGroups([]);
        toast.error('File format not supported', { description: `Required columns not found: ${missing.join(', ')}` });
        return;
      }
      if (parsedGroups.length === 0) {
        toast.error('No valid rows could be read from this file.');
        return;
      }
      setMissingColumns([]);
      setGroups(parsedGroups);
      setStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? `Failed to read file: ${err.message}` : 'Failed to read file.');
    }
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);

    // Jalur 1: coba template backend dulu (kalau klien aktif sudah dipilih
    // di dropdown Switch Company) -- lihat catatan alur di kepala file.
    if (activeClientId) {
      setCheckingTemplate(true);
      try {
        const hasil = await uploadJeSourceFile(file, activeClientId);
        if (hasil.template_matched) {
          setResults(hasil.drafts);
          setResultMessage(
            `This file's column pattern is already recognized (template) -- ${hasil.created} of ${hasil.groups_detected} journal entries imported directly.`,
          );
          setStep('result');
          return;
        }
        // template_matched=false -> belum ada pola yang cocok, lanjut ke jalur 2 (parsing lokal) di bawah tanpa error ke user.
      } catch (err) {
        // Upload backend gagal (mis. network/auth) -- jangan blokir user, tetap coba jalur 2.
        toast.info('Failed to check server template, trying local column mapping…', {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setCheckingTemplate(false);
      }
    }

    // Jalur 2: parsing lokal (alias kolom fleksibel) -- lihat parseFileToGroups di atas.
    setResultMessage(null);
    await parseLokal(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const balancedGroups = groups.filter(g => g.balanced);
  const invalidGroups = groups.filter(g => !g.balanced);

  const runImport = async () => {
    setImporting(true);
    const hasil: ImportResult[] = [];
    for (const g of balancedGroups) {
      const lines: JeDraftLineInput[] = g.lines.map(l => ({
        account_code: l.account_code,
        account_name: l.account_name || undefined,
        description: l.description || undefined,
        debit: l.debit, credit: l.credit,
        cost_center: l.cost_center || undefined,
      }));
      try {
        await createJeDraftWithLines({
          client_id: clientId,
          je_number: g.je_number,
          entry_date: g.entry_date,
          period_label: (() => {
            try {
              const d = new Date(g.entry_date + 'T00:00:00');
              const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              return `${names[d.getMonth()]} ${d.getFullYear()}`;
            } catch { return ''; }
          })(),
          description: g.description || undefined,
          source_type: g.source_type,
          currency: 'IDR',
          status: 'draft',
          created_by_name: createdByName,
          lines,
        });
        hasil.push({ je_number: g.je_number, ok: true, message: 'Successfully imported.' });
      } catch (err) {
        hasil.push({ je_number: g.je_number, ok: false, message: err instanceof Error ? err.message : 'Failed to import.' });
      }
    }
    invalidGroups.forEach(g => hasil.push({ je_number: g.je_number, ok: false, message: g.errors.join(' ') }));
    setResults(hasil);
    setImporting(false);
    setStep('result');
  };

  const successCount = results.filter(r => r.ok).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="je-card bg-card w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Import Journal</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={checkingTemplate ? undefined : handleDrop}
              onClick={() => !checkingTemplate && fileInputRef.current?.click()}
              className={`border-2 border-dashed border-border rounded-lg py-12 text-center transition-colors ${checkingTemplate ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-muted/40'}`}
            >
              <ArrowUpTrayIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">
                {checkingTemplate ? 'Checking for a known column pattern…' : 'Drag & drop a file here, or click to choose a file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Format: .csv, .xlsx, .xls</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={checkingTemplate}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
            {missingColumns.length > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Required columns not found in file: <strong>{missingColumns.join(', ')}</strong>. At minimum you need JE Number, Date, and Account Code.</span>
              </div>
            )}
            <button onClick={unduhTemplate} type="button" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
              <DocumentArrowDownIcon className="w-3.5 h-3.5" /> Download template CSV
            </button>
            <p className="text-xs text-muted-foreground">
              Each row = 1 journal line. Rows with the same JE Number are automatically grouped into 1 multi-line journal entry. Required columns: JE Number, Date, Account Code, Debit/Credit.
            </p>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              File <strong className="text-foreground">{fileName}</strong>: {groups.length} journal entries read &mdash;{' '}
              <span className="text-green-700 font-medium">{balancedGroups.length} ready to import</span>
              {invalidGroups.length > 0 && <span className="text-red-700 font-medium">, {invalidGroups.length} problematic (skipped)</span>}.
            </p>
            <div className="border border-border rounded-lg overflow-hidden max-h-[420px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/90">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">JE Number</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-center font-semibold text-muted-foreground">Lines</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Debit</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Credit</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map(g => (
                    <tr key={g.je_number}>
                      <td className="px-3 py-2 font-mono text-primary font-medium whitespace-nowrap">{g.je_number}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{g.entry_date || '-'}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={g.description}>{g.description || '-'}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{g.lines.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(g.totalDebit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(g.totalCredit)}</td>
                      <td className="px-3 py-2">
                        {g.balanced ? (
                          <span className="inline-flex items-center gap-1 text-green-700"><CheckCircleIcon className="w-3.5 h-3.5" /> Ready</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700" title={g.errors.join(' ')}><XCircleIcon className="w-3.5 h-3.5" /> {g.errors[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => setStep('upload')} type="button" className="flex-1 py-2 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors">Back</button>
              <button
                onClick={runImport}
                type="button"
                disabled={importing || balancedGroups.length === 0}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing…' : `Import ${balancedGroups.length} Journal Entries`}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
              {resultMessage || `${successCount} of ${results.length} journal entries imported successfully.`}
            </div>
            <div className="border border-border rounded-lg overflow-hidden max-h-[360px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">JE Number</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map(r => (
                    <tr key={r.je_number}>
                      <td className="px-3 py-2 font-mono text-primary font-medium whitespace-nowrap">{r.je_number}</td>
                      <td className="px-3 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 text-green-700"><CheckCircleIcon className="w-3.5 h-3.5" /> Success</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700"><XCircleIcon className="w-3.5 h-3.5" /> Failed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={onClose} type="button" className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-colors">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
