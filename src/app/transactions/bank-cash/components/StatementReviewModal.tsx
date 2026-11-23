'use client';

// Modal review hasil ekstraksi rekening koran SEBELUM disimpan ke Bank Feed.
// Muncul kalau file belum punya template yang cocok, atau validasi saldonya
// belum lolos penuh. User bisa:
//   - melihat cek saldo berjalan & total resmi rekening koran,
//   - mengoreksi peran tiap kolom / format angka / urutan tanggal lalu
//     "Re-read" (preview ulang dengan aturan itu),
//   - menyimpan pola kolom ini sebagai template ekstraksi (dipakai otomatis
//     untuk file berikutnya dengan header yang sama),
//   - meng-import; baris "Needs review" tetap tersimpan tapi dilewati auto-match.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle2, AlertTriangle, FileSearch } from 'lucide-react';
import { formatIDR } from '../lib/formatMoney';
import ConfidenceBadge from './ConfidenceBadge';
import { useBankFeed } from '../context/BankFeedContext';
import { ACTION_BTN_PRIMARY, ACTION_BTN_SECONDARY, CHECKBOX_CLS, FilterSelect, ModalShell } from './sourceUi';
import {
  MATCH_BY_LABEL,
  METHOD_LABEL,
  ROLE_LABEL,
  VALIDATION_LABEL,
  type BcMappingRules,
  type BcPreview,
  type BcUploadResult,
  type ColumnRole,
} from '@/lib/bankCashStore';

const ROLES = Object.keys(ROLE_LABEL) as ColumnRole[];

const WARNA_STATUS: Record<BcPreview['validation']['status'], string> = {
  verified: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  partial: 'bg-amber-100 text-amber-900 border-amber-300',
  unverified: 'bg-neutral-100 text-neutral-600 border-neutral-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
};

function aturanDari(p: BcPreview): BcMappingRules {
  return {
    columns: p.columns.map((c) => ({ header: c.header, role: c.role })),
    number_format: p.number_format,
    date_order: p.date_order,
    default_direction: p.default_direction,
    method: p.method,
  };
}

const angka = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatIDR(n, true));

export default function StatementReviewModal({ file, bankCoaId, bankLabel, initial, onClose, onImported }: {
  file: File;
  bankCoaId: string;
  bankLabel: string;
  initial: BcPreview;
  onClose: () => void;
  onImported: (hasil: { data: BcUploadResult; message: string }) => void;
}) {
  const { previewFile, importFile } = useBankFeed();
  const [preview, setPreview] = useState<BcPreview>(initial);
  const [aturan, setAturan] = useState<BcMappingRules>(() => aturanDari(initial));
  const [berubah, setBerubah] = useState(false);          // aturan diedit tapi belum di-Re-read
  const [pakaiAturanUser, setPakaiAturanUser] = useState(false); // preview sekarang hasil aturan user
  const [simpanTemplate, setSimpanTemplate] = useState(initial.will_learn_template);
  const [filter, setFilter] = useState<'all' | 'review'>(initial.validation.rows_low > 0 ? 'review' : 'all');
  const [busy, setBusy] = useState<'reread' | 'import' | null>(null);

  const v = preview.validation;
  const pakaiTemplate = preview.template_matched && !pakaiAturanUser;
  const adaKolomJumlah = aturan.columns.some((c) => c.role === 'amount');
  const baris = useMemo(
    () => (filter === 'review' ? preview.rows.filter((r) => r.confidence !== 'high') : preview.rows),
    [preview.rows, filter],
  );

  const ubahAturan = (patch: Partial<BcMappingRules>) => {
    setAturan((a) => ({ ...a, ...patch }));
    setBerubah(true);
  };
  const ubahPeran = (i: number, role: ColumnRole) =>
    ubahAturan({ columns: aturan.columns.map((c, j) => (j === i ? { ...c, role } : c)) });

  const bacaUlang = async () => {
    setBusy('reread');
    try {
      const p = await previewFile(file, bankCoaId, aturan);
      setPreview(p);
      setBerubah(false);
      setPakaiAturanUser(true);
      setSimpanTemplate(true);
      if (p.validation.rows_low === 0) setFilter('all');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to re-read the bank statement.');
    } finally {
      setBusy(null);
    }
  };

  const importSekarang = async () => {
    setBusy('import');
    try {
      // Aturan user dikirim kalau preview ini hasil koreksi user, atau kalau user ingin menyimpan
      // template untuk layout yang belum lolos validasi otomatis (jadi template 'manual').
      const kirimAturan = pakaiAturanUser || (simpanTemplate && preview.recognized && !preview.template_matched && !preview.will_learn_template);
      const hasil = await importFile(file, bankCoaId, {
        mappingRules: kirimAturan ? aturan : null,
        saveTemplate: simpanTemplate,
      });
      onImported(hasil);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to import the bank statement.');
    } finally {
      setBusy(null);
    }
  };

  const labelSimpan = pakaiAturanUser
    ? 'Save my column settings as the extraction template for this layout'
    : preview.will_learn_template
      ? 'Save this layout as an extraction template (all balances check out)'
      : 'Save this layout as an extraction template anyway';

  return (
    <ModalShell
      title={<>Review bank statement — {preview.file_name}</>}
      subtitle={
        <>
            <p>
          {bankLabel}
          {preview.bank_name ? ` · Detected bank: ${preview.bank_name}` : ''}
          {preview.account_number ? ` · Account no. ${preview.account_number}` : ''}
          {preview.period_start ? ` · Period ${preview.period_start} – ${preview.period_end}` : ''}
          {` · Read via ${METHOD_LABEL[preview.method]}`}
        </p>
        {preview.bank_mapping && !preview.bank_mapping.conflict && (
          <p className="mt-1 text-emerald-700">
            Target account from bank mapping “{preview.bank_mapping.bank_name}” (matched by {MATCH_BY_LABEL[preview.bank_mapping.match_by]}).
          </p>
        )}
        {pakaiTemplate && preview.template && (
          <p className="mt-1 text-emerald-700">
            Using extraction template “{preview.template.name}” ({preview.template.detected_by === 'manual' ? 'set manually' : 'learned automatically'}).
          </p>
        )}
        </>
      }
      icon={<FileSearch size={17} />}
      onClose={onClose}
      closeDisabled={busy !== null}
      maxWidth="max-w-6xl"
      footer={
        <>
          {preview.recognized && !pakaiTemplate ? (
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-900">
              <input type="checkbox" checked={simpanTemplate} onChange={(e) => setSimpanTemplate(e.target.checked)} className={CHECKBOX_CLS} />
              {labelSimpan}
            </label>
          ) : <span />}
          <div className="ml-auto flex items-center gap-2">
            {berubah && <span className="text-[11px] text-amber-700">Re-read the file to apply the new settings.</span>}
            <button onClick={onClose} disabled={busy !== null} className={ACTION_BTN_SECONDARY}>Cancel</button>
            <button
              onClick={importSekarang}
              disabled={busy !== null || berubah || preview.importable === 0 || !!preview.already_uploaded_on}
              className={ACTION_BTN_PRIMARY}
            >
              {busy === 'import'
                ? 'Importing…'
                : `Import ${preview.importable - preview.already_in_feed} line(s)${v.rows_low ? ` · ${v.rows_low} flagged for review` : ''}`}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
          {preview.already_uploaded_on && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={16} className="shrink-0" />
              This exact file was already uploaded for this account on {String(preview.already_uploaded_on).slice(0, 10)} — importing it again will be rejected.
            </div>
          )}

          {/* Ringkasan validasi */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="space-y-2 rounded-lg border border-neutral-300 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${WARNA_STATUS[v.status]}`}>
                  {v.status === 'verified' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {VALIDATION_LABEL[v.status]}
                </span>
                <span className="text-xs text-neutral-500">{v.verified_pct}% of lines verified</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span><b className="text-emerald-700">{v.rows_high}</b> verified</span>
                <span><b className="text-neutral-600">{v.rows_medium}</b> unverified</span>
                <span><b className="text-red-700">{v.rows_low}</b> need review</span>
              </div>
              <p className="text-[11px] text-neutral-500">
                {v.balance_checkpoints > 0
                  ? `${v.balance_checkpoints} running-balance check(s), ${v.balance_mismatches} mismatch(es).`
                  : 'No balance column — lines are checked against the statement totals only.'}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-300 bg-white p-3 shadow-sm lg:col-span-2">
              <p className="text-xs font-semibold text-neutral-900 mb-2">Statement totals check</p>
              {v.checks.length === 0 ? (
                <p className="text-xs text-neutral-500">The statement has no printed summary (opening/closing balance, totals) to compare with.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="text-left font-semibold pb-1">Check</th>
                      <th className="text-right font-semibold pb-1">On statement</th>
                      <th className="text-right font-semibold pb-1">Extracted</th>
                      <th className="pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {v.checks.map((c) => (
                      <tr key={c.label} className="border-t border-neutral-200">
                        <td className="py-1 text-neutral-900">{c.label}</td>
                        <td className="py-1 text-right tabular-nums">{c.label.includes('count') ? c.statement : angka(c.statement)}</td>
                        <td className="py-1 text-right tabular-nums">{c.label.includes('count') ? c.extracted : angka(c.extracted)}</td>
                        <td className="py-1 pl-2 text-right">
                          {c.ok ? <CheckCircle2 size={16} className="inline text-emerald-600" /> : <AlertTriangle size={16} className="inline text-red-600" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 list-disc list-inside space-y-0.5">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {/* Pengaturan kolom */}
          {preview.recognized ? (
            <div className="space-y-3 rounded-lg border border-neutral-300 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-neutral-900">Column settings</p>
                  <p className="text-[11px] text-neutral-500">If amounts or directions look wrong, fix the column roles below, then re-read the file.</p>
                </div>
                <button
                  onClick={bacaUlang}
                  disabled={!berubah || busy !== null}
                  className={ACTION_BTN_SECONDARY}
                >
                  <RefreshCw size={13} className={busy === 'reread' ? 'animate-spin' : ''} />
                  {busy === 'reread' ? 'Re-reading…' : 'Re-read with these settings'}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                {aturan.columns.map((c, i) => (
                  <div key={`${c.header}-${i}`} className="block rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1.5">
                    <span className="mb-1 block truncate text-[11px] font-semibold text-neutral-900" title={c.header}>{c.header || `(column ${i + 1})`}</span>
                    <FilterSelect
                      size="sm"
                      className="w-full"
                      value={c.role}
                      onChange={(v) => ubahPeran(i, v as ColumnRole)}
                      options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
                  Number format
                  <FilterSelect
                    size="sm"
                    value={aturan.number_format}
                    onChange={(v) => ubahAturan({ number_format: v as 'en' | 'id' })}
                    options={[{ value: 'en', label: '1,234,567.89' }, { value: 'id', label: '1.234.567,89' }]}
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
                  Date order
                  <FilterSelect
                    size="sm"
                    value={aturan.date_order}
                    onChange={(v) => ubahAturan({ date_order: v as 'dmy' | 'mdy' })}
                    options={[{ value: 'dmy', label: 'Day / Month' }, { value: 'mdy', label: 'Month / Day' }]}
                  />
                </div>
                {adaKolomJumlah && (
                  <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
                    Amount without DB/CR marker is
                    <FilterSelect
                      size="sm"
                      value={aturan.default_direction ?? ''}
                      onChange={(v) => ubahAturan({ default_direction: (v || null) as 'credit' | 'debit' | null })}
                      options={[
                        { value: 'credit', label: 'Money in' },
                        { value: 'debit', label: 'Money out' },
                        { value: '', label: 'Decide from the balance' },
                      ]}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              The column layout of this file was not recognized, so it was read with the generic parser. Column settings and templates are not available for it.
            </p>
          )}

          {/* Baris */}
          <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-300 bg-neutral-50 px-3 py-2">
              <p className="text-xs font-semibold text-neutral-900">Extracted lines ({preview.row_count})</p>
              <span className="text-[11px] text-neutral-500">
                {preview.importable} to import
                {preview.already_in_feed ? ` · ${preview.already_in_feed} already in the Source Data (skipped)` : ''}
                {preview.without_date ? ` · ${preview.without_date} without a date (skipped)` : ''}
              </span>
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-100 p-0.5">
                {(['all', 'review'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${filter === f ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`}
                  >
                    {f === 'all' ? 'All lines' : `Not verified (${v.rows_low + v.rows_medium})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[42vh] overflow-y-auto scrollbar-thin">
              {baris.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-8">
                  {preview.row_count === 0 ? 'No lines could be read — check the column settings above.' : 'Every line is verified.'}
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-neutral-300">
                    <tr className="border-b border-neutral-800">
                      {['Date', 'Description', 'In', 'Out', 'Balance', 'Check'].map((h) => (
                        <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-black ${['In', 'Out', 'Balance'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {baris.slice(0, 1000).map((r, i) => (
                      <tr key={i} className={`border-b border-neutral-200 ${r.confidence === 'low' ? 'bg-red-50/60' : ''}`}>
                        <td className="px-3 py-1.5 whitespace-nowrap text-neutral-500">{r.date ?? '—'}</td>
                        <td className="px-3 py-1.5 text-neutral-900 max-w-[420px]">
                          <span className="line-clamp-2" title={r.description}>{r.description || '—'}</span>
                          {r.confidence !== 'high' && r.notes.length > 0 && (
                            <span className="block text-[10px] text-neutral-500">{r.notes.join(' ')}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{r.credit ? angka(r.credit) : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-red-700 whitespace-nowrap">{r.debit ? angka(r.debit) : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{r.balance === null ? '' : angka(r.balance)}</td>
                        <td className="px-3 py-1.5"><ConfidenceBadge value={r.confidence} notes={r.notes} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {baris.length > 1000 && <p className="text-[11px] text-neutral-500 text-center py-2">Showing the first 1,000 lines.</p>}
            </div>
          </div>
      </div>
    </ModalShell>
  );
}