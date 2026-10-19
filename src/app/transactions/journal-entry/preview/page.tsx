'use client';

import React, { useState, useMemo, useEffect } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiStatus } from '@/lib/journalEntryStore';
import { PreviewSection, FieldList, JournalTable, PickerPagination, PREVIEW_CARD } from '@/app/transactions/components/PreviewLayout';
import { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';
import JeWorkflowActions from '@/app/transactions/journal-entry/components/JeWorkflowActions';

type JEStatus = JeUiStatus;

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const statusColors: Record<JEStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
};

const statusLabels: Record<JEStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
};

export default function JournalPreviewPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && journalEntries.length > 0) setSelectedId(journalEntries[0].id);
  }, [journalEntries, selectedId]);

  const [selectorPage, setSelectorPage] = useState(1);
  const selectorTotalPages = Math.max(1, Math.ceil(journalEntries.length / JE_PAGE_SIZE));
  const selectorPageSafe = Math.min(selectorPage, selectorTotalPages);
  const paginatedEntries = journalEntries.slice((selectorPageSafe - 1) * JE_PAGE_SIZE, selectorPageSafe * JE_PAGE_SIZE);

  const je = journalEntries.find(t => t.id === selectedId) || journalEntries[0];
  const { lines: backendLines } = useJeDraftLines(je?.id);
  const lines = useMemo(() => backendLines.map(mapJeDraftLineToUi), [backendLines]);
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const readiness = useMemo(() => {
    const emptyAccount = lines.filter(l => !l.accountCode.trim()).length;
    const bothSides = lines.filter(l => l.debit > 0 && l.credit > 0).length;
    const noAmount = lines.filter(l => l.debit === 0 && l.credit === 0).length;
    return [
      { label: 'At least 2 journal lines', ok: lines.length >= 2 },
      { label: 'Every line has an account code', ok: lines.length > 0 && emptyAccount === 0 },
      { label: 'Each line is either debit or credit, with an amount', ok: lines.length > 0 && bothSides === 0 && noAmount === 0 },
      { label: 'Debit equals credit', ok: lines.length > 0 && isBalanced && totalDebit > 0 },
    ];
  }, [lines, isBalanced, totalDebit]);
  const readyToPost = readiness.every(r => r.ok);

  // Tahap workflow: Draft -> Approved -> Posted (rejected/exception ditampilkan sebagai badge di header).
  const stageIndex = je ? ({ draft: 0, pending: 0, exception: 0, rejected: 0, approved: 1, posted: 2 } as Record<JEStatus, number>)[je.status] : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <JournalEntryTabs activeTab="preview" />
        <div className={`${PREVIEW_CARD} p-12 text-center text-sm text-muted-foreground`}>Loading journal entries…</div>
      </div>
    );
  }

  if (!je) {
    return (
      <div className="space-y-6">
        <JournalEntryTabs activeTab="preview" />
        <div className={`${PREVIEW_CARD} p-12 text-center text-sm text-muted-foreground`}>No journal entries to preview yet.</div>
      </div>
    );
  }

  return (
      <div className="space-y-6">
        <JournalEntryTabs activeTab="preview" />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Selector Panel */}
          <div className={`${PREVIEW_CARD} p-4 lg:col-span-1 self-start`}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select Journal Entry</h3>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto scrollbar-thin">
              {paginatedEntries.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs ${
                    selectedId === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <p className="font-mono font-semibold">{t.jeNumber}</p>
                  <p className={`truncate mt-0.5 ${selectedId === t.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{t.description}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${selectedId === t.id ? 'bg-white/20 text-white' : statusColors[t.status]}`}>
                      {statusLabels[t.status]}
                    </span>
                    <span className={`font-semibold tabular-nums ${selectedId === t.id ? 'text-primary-foreground' : ''}`}>{fmt(t.totalDebit)}</span>
                  </div>
                </button>
              ))}
            </div>
            <PickerPagination
              page={selectorPageSafe}
              totalPages={selectorTotalPages}
              total={journalEntries.length}
              itemLabel="journal entries"
              onPageChange={setSelectorPage}
            />
          </div>

          {/* Preview Document — bagian ditumpuk dari atas ke bawah */}
          <div className="lg:col-span-3 space-y-4">
            {/* Header */}
            <div className={`${PREVIEW_CARD} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DocumentTextIcon className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold text-foreground">Journal Entry Preview</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{je.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[je.status]}`}>{statusLabels[je.status]}</span>
                  <JeWorkflowActions entries={[je]} className="justify-end" />
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${isBalanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {isBalanced ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <ExclamationTriangleIcon className="w-3.5 h-3.5" />}
                    {isBalanced ? 'Balanced' : 'Unbalanced'}
                  </span>
                </div>
              </div>
            </div>

            {/* 1. Reference */}
            <PreviewSection step={1} stepColor="blue" title="Reference">
              <FieldList rows={[
                { label: 'JE Number', value: <span className="font-mono">{je.jeNumber}</span> },
                { label: 'Source Type', value: je.sourceType || '—' },
                { label: 'Source Reference', value: je.sourceReference || '—' },
              ]} />
            </PreviewSection>

            {/* 2. Dates */}
            <PreviewSection step={2} stepColor="purple" title="Dates">
              <FieldList rows={[
                { label: 'Entry Date', value: je.date || '—' },
                { label: 'Posting Date', value: je.postingDate || '—' },
                { label: 'Period', value: je.period || '—' },
              ]} />
            </PreviewSection>

            {/* 3. Workflow */}
            <PreviewSection step={3} stepColor="emerald" title="Workflow">
              <FieldList rows={[
                { label: 'Created by', value: je.createdBy || '—' },
                { label: 'Reviewed by', value: je.reviewedBy || '— Pending —' },
                { label: 'Approved by', value: je.approvedBy || '— Pending —' },
              ]} />
            </PreviewSection>

            {/* 4. Journal Lines */}
            <PreviewSection step={4} stepColor="amber" title="Journal Lines" flush>
              <JournalTable
                lines={lines.map(l => ({
                  key: l.id, code: l.accountCode, name: l.accountName,
                  description: l.description, costCenter: l.costCenter, debit: l.debit, credit: l.credit,
                }))}
                totalDebit={totalDebit}
                totalCredit={totalCredit}
                formatAmount={fmt}
                showDescription
                showCostCenter
              />
            </PreviewSection>

            {/* 5. Posting readiness */}
            <PreviewSection
              step={5}
              stepColor="emerald"
              title="Approval & Posting"
              aside={je.status === 'posted'
                ? <span className="text-xs font-medium text-green-700">Posted{je.postedAt ? ` on ${je.postedAt}` : ''}</span>
                : <span className={`text-xs font-medium ${readyToPost ? 'text-green-700' : 'text-amber-700'}`}>{readyToPost ? 'Ready to post' : 'Not ready to post'}</span>}
            >
              <ol className="flex items-center gap-2 mb-4 text-xs">
                {['Draft', 'Approved', 'Posted'].map((label, i) => (
                  <React.Fragment key={label}>
                    <li className={`px-3 py-1 rounded-full font-medium ${i < stageIndex ? 'bg-green-100 text-green-700' : i === stageIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{label}</li>
                    {i < 2 && <span className="h-px w-6 bg-border" />}
                  </React.Fragment>
                ))}
              </ol>
              {je.status === 'rejected' && <p className="text-xs text-red-700 mb-3">This entry was rejected. Reopen it to send it back to draft.</p>}
              {je.status === 'exception' && <p className="text-xs text-orange-700 mb-3">This entry is flagged as an exception. Approve it once the issue is resolved, or reject it.</p>}
              <ul className="space-y-1.5">
                {readiness.map(r => (
                  <li key={r.label} className="flex items-center gap-2 text-xs">
                    {r.ok ? <CheckCircleIcon className="w-4 h-4 text-green-600" /> : <ExclamationTriangleIcon className="w-4 h-4 text-amber-600" />}
                    <span className={r.ok ? 'text-foreground' : 'text-amber-700'}>{r.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-3">
                Accounts must also exist in the client&apos;s chart of accounts. The system checks this again when you post.
                Approve needs Supervisor level; Post needs Manager level.
              </p>
            </PreviewSection>

            {je.notes && (
              <div className="rounded-xl border border-amber-200 p-4 bg-amber-50">
                <p className="text-xs text-amber-700">{je.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}