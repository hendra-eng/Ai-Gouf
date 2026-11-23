'use client';

// Tab Bank Feed: upload rekening koran (PDF/Excel/CSV) per akun bank -> baris
// mutasi tersimpan di database (financial_transaction_bank_cash_mutations).
// Upload = preview dulu (backend bank_statement_extractor: tabel PDF / posisi
// kata / OCR + validasi saldo). File yang template-nya cocok & lolos validasi
// langsung di-import; selain itu muncul StatementReviewModal untuk mengecek /
// mengoreksi kolom dan menyimpan template ekstraksi. Baris "Needs review"
// dikoreksi lewat ReviewLineModal. Upload ulang file / baris yang sama
// dilewati otomatis. Pencocokan ke invoice / akun di tab Reconciliation.
// Akun tujuan default "Auto-detect": backend memilih akun dari mapping bank
// (BankMappings -- nomor rekening / judul dokumen / template / nama bank);
// upload dengan akun pilihan manual mencatat mapping baru untuk rekening itu.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Upload, FileText, ShieldCheck, AlertTriangle, CheckCircle, Loader2, Trash2, Pencil, EyeOff, Undo2, FileUp,
} from 'lucide-react';
import BankMappings from '../components/BankMappings';
import CashBankTabs from '../components/CashBankTabs';
import ConfidenceBadge from '../components/ConfidenceBadge';
import ExtractionTemplates from '../components/ExtractionTemplates';
import ReviewLineModal from '../components/ReviewLineModal';
import StatementReviewModal from '../components/StatementReviewModal';
import {
  FIELD_CLS, ICON_BTN, ICON_BTN_DANGER, PANEL_ICON_CHIP, TD_CLS, TH_CLS, TR_CLS,
  FileTypeChip, FilterSelect, MiniBar, SourceKpiTile, SourcePanel, StatusPill, TablePagination,
  type PillTone,
} from '../components/sourceUi';
import { formatIDR } from '../lib/formatMoney';
import { useBankFeed, type BankFeedMutation, type MatchStatus } from '../context/BankFeedContext';
import { useActiveClient } from '@/lib/activeClient';
import {
  useBcAccounts, METHOD_LABEL, TX_STATUS_LABEL, VALIDATION_LABEL,
  type BcPreview, type BcStatement, type BcUploadResult,
} from '@/lib/bankCashStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const STATUS_LABEL: Record<MatchStatus, string> = { unmatched: 'Unmatched', matched: 'Matched', ignored: 'Ignored' };
const STATUS_TONE: Record<MatchStatus, PillTone> = { unmatched: 'amber', matched: 'emerald', ignored: 'neutral' };
const VALIDATION_TONE: Record<NonNullable<BcStatement['validation']>['status'], PillTone> = {
  verified: 'emerald', partial: 'amber', unverified: 'neutral', failed: 'red',
};

/** Baris hasil ekstraksi yang meragukan & belum dicocokkan -> wajib review (dilewati auto-match). */
const perluReview = (m: BankFeedMutation) => m.confidence === 'low' && m.status !== 'matched';

function toastImport({ data, message }: { data: BcUploadResult; message: string }) {
  const tpl = data.template
    ? data.template.action === 'used'
      ? ` Read with template “${data.template.name}”.`
      : ` Saved as extraction template “${data.template.name}”.`
    : '';
  const map = data.bank_mapping
    ? data.bank_mapping.action === 'created'
      ? ` Bank mapping saved: ${data.bank_mapping.bank_name}${data.bank_mapping.account_number ? ` ${data.bank_mapping.account_number}` : ''} → ${kodeAkun(data.bank_account_code)}.`
      : ''
    : '';
  const auto = data.auto_match;
  const arahan = auto
    ? `Auto-match: ${auto.matched} matched to invoices, ${auto.rule_matched} recorded by auto rules (saved as DRAFT, review in Journal Preview). ${auto.skipped} line(s) still need matching in the Reconciliation tab.`
      + (data.confidence?.low ? ' Lines marked “Needs review” are skipped until you review them below.' : '')
    : data.confidence?.low
      ? 'Lines marked “Needs review” are skipped by auto-match until you review them below.'
      : 'Match the imported lines in the Reconciliation tab.';
  toast.success(`${message} Posted to ${kodeAkun(data.bank_account_code)} - ${data.bank_account_name}.`, {
    description: arahan + tpl + map,
  });
  if (data.warnings.length) toast.warning(data.warnings.join(' '));
}

/** Pilihan akun "Auto-detect": akun tujuan dari mapping bank (nomor rekening / judul dokumen / template). */
const AUTO = '';

function UploadPanel() {
  const { previewFile, importFile, importing } = useBankFeed();
  const { activeClientId } = useActiveClient();
  const { accounts, loading: loadingAkun } = useBcAccounts(activeClientId ? String(activeClientId) : null);
  // Rekening koran untuk akun bank; laporan kas tunai (mis. Laporan Kas Kasir) untuk akun kas.
  const akunBank = useMemo(() => accounts.filter((a) => a.cash_type === 'bank' && a.is_active), [accounts]);
  const akunKas = useMemo(
    () => accounts.filter((a) => (a.cash_type === 'cash_on_hand' || a.cash_type === 'petty_cash') && a.is_active),
    [accounts],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [bankCoaId, setBankCoaId] = useState(AUTO);
  const [isDragging, setIsDragging] = useState(false);
  const [review, setReview] = useState<{ file: File; preview: BcPreview } | null>(null);

  useEffect(() => {
    if (bankCoaId !== AUTO && ![...akunBank, ...akunKas].some((a) => a.id === bankCoaId)) setBankCoaId(AUTO);
  }, [akunBank, akunKas, bankCoaId]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const preview = await previewFile(file, bankCoaId);
      // Pola sudah dikenal (template) & seluruh saldo cocok & akun tidak bentrok dengan mapping
      // -> langsung import tanpa modal, ke akun hasil mapping / pilihan user.
      if (preview.template_matched && preview.validation.status === 'verified' && !preview.already_uploaded_on
          && !preview.bank_mapping?.conflict) {
        toastImport(await importFile(file, preview.bank_coa_id));
      } else {
        setReview({ file, preview });
      }
    } catch (e: any) {
      if (e?.code === 'BANK_ACCOUNT_REQUIRED') {
        toast.error(e.message, { duration: 10000 });
      } else {
        toast.error(e?.message || 'Failed to import the bank statement.');
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const akunTerpilih = [...akunBank, ...akunKas].find((a) => a.id === bankCoaId);

  return (
    <>
      <SourcePanel
        title="Import Bank Statement"
        subtitle="PDF (including scanned), Excel or CSV, or a cash report. Every line is checked against the running balance and statement totals."
        leading={<span className={PANEL_ICON_CHIP}><Upload size={17} /></span>}
        action={
          <FilterSelect
            value={bankCoaId}
            onChange={setBankCoaId}
            disabled={importing || loadingAkun}
            ariaLabel="Target account"
            className="min-w-[260px] max-w-[340px] shrink-0"
            menuMaxWidth={380}
            options={[
              { value: AUTO, label: loadingAkun ? 'Loading accounts...' : 'Auto-detect account (bank mapping)' },
              ...akunBank.map((a) => ({ value: a.id, label: `${kodeAkun(a.code)} - ${a.name}`, group: 'Bank accounts' })),
              ...akunKas.map((a) => ({ value: a.id, label: `${kodeAkun(a.code)} - ${a.name}`, group: 'Cash accounts' })),
            ]}
          />
        }
      >
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => { e.preventDefault(); if (!importing) setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (importing) return;
            handleFile(e.dataTransfer.files?.[0] || null);
          }}
          onClick={() => { if (!importing) inputRef.current?.click(); }}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !importing) { e.preventDefault(); inputRef.current?.click(); } }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-9 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-800 ${
            importing
              ? 'cursor-wait border-neutral-300 bg-neutral-50'
              : isDragging
                ? 'cursor-copy border-neutral-800 bg-neutral-100'
                : 'cursor-pointer border-neutral-300 bg-neutral-50/60 hover:border-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {importing ? (
            <>
              <span className={PANEL_ICON_CHIP}><Loader2 size={18} className="animate-spin" /></span>
              <p className="text-sm font-semibold text-neutral-900">Reading bank statement…</p>
              <p className="text-xs font-medium text-neutral-500">Long PDFs may take a moment.</p>
            </>
          ) : (
            <>
              <span className={PANEL_ICON_CHIP}><FileUp size={18} /></span>
              <p className="text-sm font-semibold text-neutral-900">Drop a file here or click to browse</p>
              <p className="text-xs font-medium text-neutral-500">
                {akunTerpilih
                  ? `Statement for account ${kodeAkun(akunTerpilih.code)} - ${akunTerpilih.name}`
                  : 'Target account is detected from the bank / account number in the file'}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {['PDF', 'XLSX', 'XLS', 'CSV'].map((t) => (
                  <span key={t} className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-neutral-600">{t}</span>
                ))}
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv"
            className="hidden"
            disabled={importing}
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </div>
        <p className="mt-3 text-[11px] font-medium text-neutral-500">
          Known layouts are imported straight away; new ones are shown for review first. Files and lines already uploaded are skipped.
        </p>
      </SourcePanel>

      {review && (
        <StatementReviewModal
          file={review.file}
          bankCoaId={review.preview.bank_coa_id}
          bankLabel={`${kodeAkun(review.preview.bank_account_code)} - ${review.preview.bank_account_name}`}
          initial={review.preview}
          onClose={() => setReview(null)}
          onImported={(hasil) => {
            setReview(null);
            toastImport(hasil);
          }}
        />
      )}
    </>
  );
}

function StatementList() {
  const { statements, removeStatement } = useBankFeed();
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  if (statements.length === 0) return null;

  const hapus = async (id: string, nama: string) => {
    if (!window.confirm(`Delete bank statement "${nama}" and all of its unmatched lines?`)) return;
    try {
      await removeStatement(id);
      toast.success('Bank statement deleted.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete the bank statement.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(statements.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paginated = statements.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const heads = ['File', 'Bank Account', 'Period', 'Opening Balance', 'Closing Balance', 'Lines', 'Check', 'Matched', 'Uploaded', ''];
  const numeric = ['Opening Balance', 'Closing Balance', 'Lines'];

  return (
    <SourcePanel
      title="Bank Statement Files"
      subtitle={`${statements.length} file(s) imported`}
      leading={<span className={PANEL_ICON_CHIP}><FileText size={17} /></span>}
      flush
    >
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[1000px] select-text border-separate border-spacing-0">
          <thead>
            <tr className="bg-neutral-300">
              {heads.map((h, i) => (
                <th key={`${h}-${i}`} className={`${TH_CLS} ${numeric.includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((s) => (
              <tr key={s.id} className={TR_CLS}>
                <td className="max-w-[260px] px-2 py-2" title={s.warnings.join('\n') || undefined}>
                  <div className="flex items-center gap-2">
                    <FileTypeChip name={s.file_name} type={s.file_type} />
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-blue-700">{s.file_name}</span>
                      {(s.extraction_method || s.duplicate_count > 0) && (
                        <span className="block truncate text-[11px] text-neutral-500">
                          {s.extraction_method ? METHOD_LABEL[s.extraction_method] : ''}{s.template_name ? ` · ${s.template_name}` : ''}
                          {s.duplicate_count > 0 ? `${s.extraction_method ? ' · ' : ''}${s.duplicate_count} duplicate lines skipped` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`${TD_CLS} font-medium text-neutral-900`}>{kodeAkun(s.bank_account_code)} - {s.bank_account_name}</td>
                <td className={`${TD_CLS} text-neutral-600`}>{s.period_start} – {s.period_end}</td>
                <td className={`${TD_CLS} text-right tabular-nums`}>{s.opening_balance === null ? '—' : formatIDR(s.opening_balance, true)}</td>
                <td className={`${TD_CLS} text-right tabular-nums`}>{s.closing_balance === null ? '—' : formatIDR(s.closing_balance, true)}</td>
                <td className={`${TD_CLS} text-right tabular-nums`}>{s.line_count.toLocaleString('id-ID')}</td>
                <td className={TD_CLS}>
                  <div className="flex flex-col items-start gap-1">
                    {s.validation ? (
                      <StatusPill
                        tone={VALIDATION_TONE[s.validation.status]}
                        label={VALIDATION_LABEL[s.validation.status]}
                        title={(s.validation.checks || []).map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join('\n') || undefined}
                      />
                    ) : '—'}
                    {s.low_confidence_count > 0 && <span className="text-[11px] font-medium text-red-700">{s.low_confidence_count} to review</span>}
                  </div>
                </td>
                <td className={TD_CLS}>
                  <div className="flex items-center gap-2">
                    <MiniBar pct={s.line_count - s.ignored_count > 0 ? (s.matched_count / (s.line_count - s.ignored_count)) * 100 : null} />
                    <span className={`tabular-nums ${s.unmatched_count ? 'text-amber-700' : 'text-emerald-700'}`}>{s.matched_count}/{s.line_count - s.ignored_count}</span>
                  </div>
                </td>
                <td className={`${TD_CLS} text-neutral-600`}>
                  {(s.created_at || '').slice(0, 10)}
                  {s.created_by_name && <span className="block text-[11px] text-neutral-500">{s.created_by_name}</span>}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={() => hapus(s.id, s.file_name)}
                    disabled={s.matched_count > 0}
                    className={ICON_BTN_DANGER}
                    title={s.matched_count > 0 ? 'Some lines are already matched — unmatch them first in the Reconciliation tab' : 'Delete file & its lines'}
                    aria-label="Delete file"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination
        total={statements.length}
        page={pageSafe}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => { setPageSize(n); setPage(1); }}
        unit="files"
      />
    </SourcePanel>
  );
}

export default function BankFeedPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { mutations, statements, loading, error, refetch, removeMutation, ignoreMutation, restoreMutation } = useBankFeed();
  const [statusFilter, setStatusFilter] = useState<'all' | MatchStatus | 'review'>('all');
  const [akunFilter, setAkunFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [dikoreksi, setDikoreksi] = useState<BankFeedMutation | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const akunList = useMemo(() => Array.from(new Set(mutations.map((m) => m.bankAccount))).sort(), [mutations]);
  const filtered = useMemo(
    () => mutations.filter((m) =>
      (statusFilter === 'all' || (statusFilter === 'review' ? perluReview(m) : m.status === statusFilter))
      && (akunFilter === 'all' || m.bankAccount === akunFilter)),
    [mutations, statusFilter, akunFilter],
  );
  const unmatchedCount = mutations.filter((m) => m.status === 'unmatched').length;
  const reviewCount = mutations.filter(perluReview).length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  // KPI: dihitung dari file rekening koran (sama dengan KPI Source Data Sales/Purchase).
  const kpiTiles = useMemo(() => {
    const total = statements.length;
    const sumLines = (rows: BcStatement[]) => rows.reduce((acc, r) => acc + (r.line_count || 0), 0);
    const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const verified = statements.filter((s) => s.validation?.status === 'verified');
    const perluCek = statements.filter((s) => s.low_confidence_count > 0 || s.validation?.status === 'partial' || s.validation?.status === 'failed');
    const selesai = statements.filter((s) => s.line_count - s.ignored_count > 0 && s.unmatched_count === 0);
    return [
      { label: 'Total Statements', rows: statements, icon: FileText },
      { label: 'Verified', rows: verified, icon: ShieldCheck },
      { label: 'Needs Review', rows: perluCek, icon: AlertTriangle },
      { label: 'Fully Matched', rows: selesai, icon: CheckCircle },
    ].map((k) => ({ ...k, count: k.rows.length, lines: sumLines(k.rows), pct: pctOf(k.rows.length) }));
  }, [statements]);

  const jalankan = async (id: string, fn: () => Promise<void>, sukses: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(sukses);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to process the bank line.');
    } finally {
      setBusy(null);
    }
  };

  const aksi = (m: BankFeedMutation) => {
    if (m.status === 'matched') {
      return m.transaction ? (
        <Link href="/transactions/bank-cash/journal-preview" className="text-[11px] font-medium tabular-nums text-blue-700 hover:underline">
          {m.transaction.tx_number}
        </Link>
      ) : null;
    }
    return (
      <div className="flex items-center justify-end gap-0.5">
        <button
          onClick={() => setDikoreksi(m)}
          disabled={busy === m.id}
          className={`${ICON_BTN} ${perluReview(m) ? '!text-red-600' : ''}`}
          title={perluReview(m) ? 'Review this line (needed before auto-match)' : 'Correct this line'}
          aria-label="Correct line"
        >
          <Pencil size={14} />
        </button>
        {m.status === 'unmatched' ? (
          <button
            onClick={() => jalankan(m.id, () => ignoreMutation(m.id), 'Line ignored.')}
            disabled={busy === m.id}
            className={ICON_BTN}
            title="Ignore (not a transaction to be recorded)"
            aria-label="Ignore line"
          >
            <EyeOff size={14} />
          </button>
        ) : (
          <button
            onClick={() => jalankan(m.id, () => restoreMutation(m.id), 'Line restored to Unmatched.')}
            disabled={busy === m.id}
            className={ICON_BTN}
            title="Restore to Unmatched"
            aria-label="Restore line"
          >
            <Undo2 size={14} />
          </button>
        )}
        <button
          onClick={() => window.confirm('Delete this bank line?') && jalankan(m.id, () => removeMutation(m.id), 'Bank line deleted.')}
          disabled={busy === m.id}
          className={ICON_BTN_DANGER}
          title="Delete line"
          aria-label="Delete line"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  const lineHeads = ['Date', 'Description', 'Bank Account', 'In', 'Out', 'Balance', 'Status', ''];
  const lineNumeric = ['In', 'Out', 'Balance'];

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {/* KPI Cards -- ukuran & posisi sama dengan Source Data Sales / Purchase */}
      <div className="!mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiTiles.map((k) => (
          <SourceKpiTile
            key={k.label}
            label={k.label}
            count={k.count}
            detail={k.lines.toLocaleString('id-ID')}
            detailUnit="lines extracted"
            pct={k.pct}
            pctLabel="of all statements"
            icon={k.icon}
          />
        ))}
      </div>

      <UploadPanel />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          <span>{error}</span>
          <button onClick={refetch} className="shrink-0 font-semibold underline hover:no-underline">Retry</button>
        </div>
      )}

      <StatementList />

      {dikoreksi && <ReviewLineModal line={dikoreksi} onClose={() => setDikoreksi(null)} />}

      <SourcePanel
        title="Source Data Lines"
        subtitle={`${unmatchedCount.toLocaleString('id-ID')} of ${mutations.length.toLocaleString('id-ID')} unmatched`}
        leading={<span className={PANEL_ICON_CHIP}><FileText size={17} /></span>}
        flush
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilterSelect
              value={akunFilter}
              onChange={(v) => { setAkunFilter(v); setPage(1); }}
              ariaLabel="Filter by account"
              options={[{ value: 'all', label: 'All accounts' }, ...akunList.map((a) => ({ value: a, label: a }))]}
            />
            <div className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-100 p-1">
              {(['all', 'unmatched', 'matched', 'ignored', 'review'] as const)
                .filter((s) => s !== 'review' || reviewCount > 0 || statusFilter === 'review')
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      statusFilter === s
                        ? 'bg-blue-600 text-white shadow-sm'
                        : s === 'review' ? 'text-red-700 hover:text-red-800' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    {s === 'all' ? 'All' : s === 'review' ? `Needs review (${reviewCount})` : STATUS_LABEL[s]}
                  </button>
                ))}
            </div>
          </div>
        }
      >
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[900px] select-text border-separate border-spacing-0">
            <thead>
              <tr className="bg-neutral-300">
                {lineHeads.map((h, i) => (
                  <th key={`${h}-${i}`} className={`${TH_CLS} ${lineNumeric.includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && mutations.length === 0 && (
                <tr><td colSpan={lineHeads.length} className="px-2 py-10 text-center text-xs text-neutral-500">Loading Source Data lines...</td></tr>
              )}
              {!(loading && mutations.length === 0) && filtered.length === 0 && (
                <tr>
                  <td colSpan={lineHeads.length} className="px-2 py-10 text-center text-xs text-neutral-500">
                    {mutations.length === 0 ? 'No lines yet. Import a bank statement above to get started.' : 'No lines match this filter.'}
                  </td>
                </tr>
              )}
              {paginated.map((m) => (
                <tr
                  key={m.id}
                  className={`${TR_CLS} transition-colors ${m.status === 'ignored' ? 'opacity-60' : ''} ${perluReview(m) ? '[&>td]:bg-red-50/60' : ''}`}
                >
                  <td className={`${TD_CLS} text-neutral-600`}>{m.date}</td>
                  <td className="max-w-[300px] px-2 py-2" title={[m.description, ...m.confidenceNotes].filter(Boolean).join('\n')}>
                    <span className="block truncate font-medium text-neutral-900">{m.description || '—'}</span>
                    {m.confidence && m.confidence !== 'high' && (
                      <span className="mt-0.5 inline-block"><ConfidenceBadge value={m.confidence} notes={m.confidenceNotes} /></span>
                    )}
                    {m.ignoreReason && <span className="block truncate text-[11px] text-neutral-500">Ignored: {m.ignoreReason}</span>}
                  </td>
                  <td className={`${TD_CLS} text-neutral-600`}>{m.bankAccount}</td>
                  <td className={`${TD_CLS} text-right font-semibold tabular-nums text-emerald-700`}>{m.credit ? formatIDR(m.credit, true) : '—'}</td>
                  <td className={`${TD_CLS} text-right font-semibold tabular-nums text-red-700`}>{m.debit ? formatIDR(m.debit, true) : '—'}</td>
                  <td className={`${TD_CLS} text-right tabular-nums`}>{m.balanceAfter === null ? '—' : formatIDR(m.balanceAfter, true)}</td>
                  <td className={TD_CLS}>
                    <StatusPill
                      tone={STATUS_TONE[m.status]}
                      label={m.status === 'matched' && m.transaction ? `${STATUS_LABEL.matched} · ${TX_STATUS_LABEL[m.transaction.status]}` : STATUS_LABEL[m.status]}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{aksi(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={filtered.length}
          page={pageSafe}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
          unit="lines"
        />
      </SourcePanel>

      {/* Pengaturan -- Bank Mapping & Extraction Templates (panel lipat) */}
      <BankMappings />
      <ExtractionTemplates />
    </div>
  );
}