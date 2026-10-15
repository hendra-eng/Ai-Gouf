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
import { DocumentArrowUpIcon, TrashIcon, ArrowPathIcon, EyeSlashIcon, ArrowUturnLeftIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import BankMappings from '../components/BankMappings';
import CashBankTabs from '../components/CashBankTabs';
import ConfidenceBadge from '../components/ConfidenceBadge';
import ExtractionTemplates from '../components/ExtractionTemplates';
import ReviewLineModal from '../components/ReviewLineModal';
import StatementReviewModal from '../components/StatementReviewModal';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR } from '../../lib/groupAnalytics';
import { useBankFeed, type BankFeedMutation, type MatchStatus } from '../context/BankFeedContext';
import { useActiveClient } from '@/lib/activeClient';
import {
  useBcAccounts, METHOD_LABEL, TX_STATUS_LABEL, VALIDATION_LABEL,
  type BcPreview, type BcStatement, type BcUploadResult,
} from '@/lib/bankCashStore';

const STATUS_LABEL: Record<MatchStatus, string> = { unmatched: 'Unmatched', matched: 'Matched', ignored: 'Ignored' };
const STATUS_VARIANT: Record<MatchStatus, 'warning' | 'positive' | 'neutral'> = { unmatched: 'warning', matched: 'positive', ignored: 'neutral' };
const VALIDATION_VARIANT: Record<NonNullable<BcStatement['validation']>['status'], 'positive' | 'warning' | 'neutral' | 'negative'> = {
  verified: 'positive', partial: 'warning', unverified: 'neutral', failed: 'negative',
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
      ? ` Bank mapping saved: ${data.bank_mapping.bank_name}${data.bank_mapping.account_number ? ` ${data.bank_mapping.account_number}` : ''} → ${data.bank_account_code}.`
      : ''
    : '';
  toast.success(`${message} Posted to ${data.bank_account_code} - ${data.bank_account_name}.`, {
    description: (data.confidence?.low
      ? 'Lines marked “Needs review” are skipped by auto-match until you review them below.'
      : 'Match the imported lines in the Reconciliation tab.') + tpl + map,
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
    <div className="card-elevated-md rounded-xl p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Import Bank Statement</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bank statement PDF (including scanned), Excel or CSV, or a cash report. Every line is checked against the running balance and
            statement totals; known layouts are imported straight away, new ones are shown for review first. With Auto-detect, the
            target account comes from the Bank Mapping below. Files/lines already uploaded are skipped.
          </p>
        </div>
        <select
          value={bankCoaId}
          onChange={(e) => setBankCoaId(e.target.value)}
          disabled={importing || loadingAkun}
          className="px-3 py-2 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground disabled:opacity-60"
        >
          <option value={AUTO}>{loadingAkun ? 'Loading accounts...' : 'Auto-detect account (bank mapping)'}</option>
          {akunBank.length > 0 && (
            <optgroup label="Bank accounts">
              {akunBank.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </optgroup>
          )}
          {akunKas.length > 0 && (
            <optgroup label="Cash accounts">
              {akunKas.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!importing) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (importing) return;
          handleFile(e.dataTransfer.files?.[0] || null);
        }}
        onClick={() => { if (!importing) inputRef.current?.click(); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 transition-colors ${
          importing ? 'border-border bg-muted/20 cursor-wait' : 'cursor-pointer'
        } ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-border hover:border-blue-300 hover:bg-muted/30'}`}
      >
        {importing ? (
          <>
            <ArrowPathIcon className="w-8 h-8 text-muted-foreground animate-spin" />
            <p className="text-sm text-foreground font-medium">Reading bank statement — long PDFs may take a moment...</p>
          </>
        ) : (
          <>
            <DocumentArrowUpIcon className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">Drop a file here or click to browse</p>
            <p className="text-xs text-muted-foreground">
              {akunTerpilih
                ? `Statement for account ${akunTerpilih.code} - ${akunTerpilih.name}`
                : 'Target account detected from the bank / account number in the file'}
            </p>
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

      {review && (
        <StatementReviewModal
          file={review.file}
          bankCoaId={review.preview.bank_coa_id}
          bankLabel={`${review.preview.bank_account_code} - ${review.preview.bank_account_name}`}
          initial={review.preview}
          onClose={() => setReview(null)}
          onImported={(hasil) => {
            setReview(null);
            toastImport(hasil);
          }}
        />
      )}
    </div>
  );
}

function StatementList() {
  const { statements, removeStatement } = useBankFeed();
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

  return (
    <div className="card-elevated-md rounded-xl overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Bank Statement Files</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              {['File', 'Bank Account', 'Period', 'Opening Balance', 'Closing Balance', 'Lines', 'Check', 'Matched', 'Uploaded', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 text-xs text-foreground max-w-[220px] truncate" title={s.warnings.join('\n') || undefined}>
                  {s.file_name}
                  {s.extraction_method && (
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {METHOD_LABEL[s.extraction_method]}{s.template_name ? ` · ${s.template_name}` : ''}
                    </span>
                  )}
                  {s.duplicate_count > 0 && <span className="block text-[11px] text-muted-foreground">{s.duplicate_count} duplicate lines skipped</span>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.bank_account_code} - {s.bank_account_name}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{s.period_start} – {s.period_end}</td>
                <td className="px-4 py-3 text-xs font-mono text-right whitespace-nowrap">{s.opening_balance === null ? '—' : formatIDR(s.opening_balance, true)}</td>
                <td className="px-4 py-3 text-xs font-mono text-right whitespace-nowrap">{s.closing_balance === null ? '—' : formatIDR(s.closing_balance, true)}</td>
                <td className="px-4 py-3 text-xs text-right">{s.line_count}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {s.validation ? (
                    <span title={(s.validation.checks || []).map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join('\n') || undefined}>
                      <StatusBadge label={VALIDATION_LABEL[s.validation.status]} variant={VALIDATION_VARIANT[s.validation.status]} />
                    </span>
                  ) : '—'}
                  {s.low_confidence_count > 0 && <span className="block text-[11px] text-rose-700 mt-0.5">{s.low_confidence_count} to review</span>}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  <span className={s.unmatched_count ? 'text-amber-700' : 'text-emerald-700'}>{s.matched_count}/{s.line_count - s.ignored_count}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{(s.created_at || '').slice(0, 10)}{s.created_by_name ? ` · ${s.created_by_name}` : ''}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => hapus(s.id, s.file_name)}
                    disabled={s.matched_count > 0}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={s.matched_count > 0 ? 'Some lines are already matched — unmatch them first in the Reconciliation tab' : 'Delete file & its lines'}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BankFeedPage() {
  const { mutations, loading, error, refetch, removeMutation, ignoreMutation, restoreMutation } = useBankFeed();
  const [statusFilter, setStatusFilter] = useState<'all' | MatchStatus | 'review'>('all');
  const [akunFilter, setAkunFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [dikoreksi, setDikoreksi] = useState<BankFeedMutation | null>(null);

  const akunList = useMemo(() => Array.from(new Set(mutations.map((m) => m.bankAccount))).sort(), [mutations]);
  const filtered = useMemo(
    () => mutations.filter((m) =>
      (statusFilter === 'all' || (statusFilter === 'review' ? perluReview(m) : m.status === statusFilter))
      && (akunFilter === 'all' || m.bankAccount === akunFilter)),
    [mutations, statusFilter, akunFilter],
  );
  const unmatchedCount = mutations.filter((m) => m.status === 'unmatched').length;
  const reviewCount = mutations.filter(perluReview).length;

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
        <Link href="/transactions/bank-cash/journal-preview" className="text-[11px] font-mono text-teal-600 hover:underline">
          {m.transaction.tx_number}
        </Link>
      ) : null;
    }
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => setDikoreksi(m)}
          disabled={busy === m.id}
          className={`p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 ${perluReview(m) ? 'text-rose-600' : 'text-muted-foreground hover:text-foreground'}`}
          title={perluReview(m) ? 'Review this line (needed before auto-match)' : 'Correct this line'}
        >
          <PencilSquareIcon className="w-3.5 h-3.5" />
        </button>
        {m.status === 'unmatched' ? (
          <button
            onClick={() => jalankan(m.id, () => ignoreMutation(m.id), 'Line ignored.')}
            disabled={busy === m.id}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Ignore (not a transaction to be recorded)"
          >
            <EyeSlashIcon className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => jalankan(m.id, () => restoreMutation(m.id), 'Line restored to Unmatched.')}
            disabled={busy === m.id}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Restore to Unmatched"
          >
            <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => window.confirm('Delete this bank line?') && jalankan(m.id, () => removeMutation(m.id), 'Bank line deleted.')}
          disabled={busy === m.id}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 disabled:opacity-40"
          title="Delete line"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <CashBankTabs />

      <UploadPanel />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refetch} className="font-semibold underline hover:no-underline shrink-0">Retry</button>
        </div>
      )}

      <StatementList />

      <BankMappings />

      <ExtractionTemplates />

      {dikoreksi && <ReviewLineModal line={dikoreksi} onClose={() => setDikoreksi(null)} />}

      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-foreground">Bank Feed Lines</h2>
          <span className="text-xs text-muted-foreground">{unmatchedCount} of {mutations.length} unmatched</span>
          <select
            value={akunFilter}
            onChange={(e) => setAkunFilter(e.target.value)}
            className="ml-auto text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
          >
            <option value="all">All accounts</option>
            {akunList.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border">
            {(['all', 'unmatched', 'matched', 'ignored', 'review'] as const)
              .filter((s) => s !== 'review' || reviewCount > 0 || statusFilter === 'review')
              .map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    statusFilter === s ? 'bg-card text-foreground shadow-card' : s === 'review' ? 'text-rose-700 hover:text-rose-800' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s === 'all' ? 'All' : s === 'review' ? `Needs review (${reviewCount})` : STATUS_LABEL[s]}
                </button>
              ))}
          </div>
        </div>

        {loading && mutations.length === 0 ? (
          <p className="text-xs text-muted-foreground py-12 text-center">Loading Bank Feed lines...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-12 text-center">
            {mutations.length === 0 ? 'No lines yet. Import a bank statement above to get started.' : 'No lines match this filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Date', 'Description', 'Bank Account', 'In', 'Out', 'Balance', 'Status', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${m.status === 'ignored' ? 'opacity-60' : ''} ${perluReview(m) ? 'bg-rose-50/50' : ''}`}>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.date}</td>
                    <td className="px-4 py-3 text-xs text-foreground max-w-[260px]" title={[m.description, ...m.confidenceNotes].filter(Boolean).join('\n')}>
                      <span className="block truncate">{m.description || '—'}</span>
                      {m.confidence && m.confidence !== 'high' && (
                        <span className="mt-0.5 inline-block"><ConfidenceBadge value={m.confidence} notes={m.confidenceNotes} /></span>
                      )}
                      {m.ignoreReason && <span className="block text-[11px] text-muted-foreground truncate">Ignored: {m.ignoreReason}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.bankAccount}</td>
                    <td className="px-4 py-3 text-xs font-mono font-semibold text-emerald-700 text-right whitespace-nowrap">
                      {m.credit ? formatIDR(m.credit, true) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-semibold text-rose-700 text-right whitespace-nowrap">
                      {m.debit ? formatIDR(m.debit, true) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-foreground text-right whitespace-nowrap">
                      {m.balanceAfter === null ? '—' : formatIDR(m.balanceAfter, true)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        label={m.status === 'matched' && m.transaction ? `${STATUS_LABEL.matched} · ${TX_STATUS_LABEL[m.transaction.status]}` : STATUS_LABEL[m.status]}
                        variant={STATUS_VARIANT[m.status]}
                      />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{aksi(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
