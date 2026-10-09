'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronsDownUp, ChevronsUpDown, Filter, Loader2 } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchBalanceSheet, type BalanceSheet, type BsCompareMode } from '@/lib/fsStore';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import StatementTable, { type StatementRow } from './StatementTable';
import DownloadMenu from './DownloadMenu';
import { CheckBanner, WarningsPanel } from './CheckBanner';
import { Field, Select, inputCls } from './PeriodPicker';
import { buildStatementReport } from './statementPrint';
import { fmtAmount, fmtDate, startOfYear, todayIso } from './fsFormat';

// Task Plan 16 -- Statement of Financial Position dari GL + mapping COA.

const COMPARES: { id: BsCompareMode; label: string }[] = [
  { id: 'none', label: 'No comparison' },
  { id: 'previous_month', label: 'Previous month end' },
  { id: 'previous_year_end', label: 'Previous year end' },
  { id: 'same_date_last_year', label: 'Same date last year' },
  { id: 'custom', label: 'Custom date' },
];

interface BsQuery { as_of: string; compare: BsCompareMode; compare_as_of?: string; show_zero: boolean }

export default function BalanceSheetClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [form, setForm] = useState<BsQuery>({ as_of: todayIso(), compare: 'previous_year_end', show_zero: false });
  const [query, setQuery] = useState<BsQuery>(form);
  const [expandAll, setExpandAll] = useState(false);

  const bsQuery = useQuery({
    queryKey: ['fs', 'balance-sheet', activeClientId, query],
    queryFn: ({ signal }) => fetchBalanceSheet(activeClientId!, query, signal),
    enabled: hydrated && !!activeClientId,
    placeholderData: keepPreviousData,
  });
  const data: BalanceSheet | null = bsQuery.data ?? null;
  const loading = bsQuery.isFetching && (bsQuery.isPlaceholderData || !bsQuery.data);
  const error = bsQuery.error ? (bsQuery.error as Error).message : null;

  const rows = useMemo<StatementRow[]>(() => {
    if (!data) return [];
    const sec = (k: string) => data.sections.find(s => s.key === k)!;
    const t = data.totals;
    return [
      { kind: 'section', section: sec('current_assets') },
      { kind: 'section', section: sec('non_current_assets') },
      { kind: 'total', key: 'total_assets', label: 'Total Assets', amount: t.assets, compare_amount: t.compare_assets },
      { kind: 'section', section: sec('current_liabilities') },
      { kind: 'section', section: sec('non_current_liabilities') },
      { kind: 'subtotal', key: 'total_liabilities', label: 'Total Liabilities', amount: t.liabilities, compare_amount: t.compare_liabilities },
      { kind: 'section', section: sec('equity') },
      { kind: 'total', key: 'total_le', label: 'Total Liabilities & Equity', amount: t.liabilities_and_equity, compare_amount: t.compare_liabilities_and_equity },
    ];
  }, [data]);

  const currentLabel = data ? fmtDate(data.as_of) : '';
  const compareLabel = data?.compare_as_of ? fmtDate(data.compare_as_of) : null;
  const company = data?.client.company_name ?? '';
  const invalid = !form.as_of || (form.compare === 'custom' && !form.compare_as_of);

  return (
    <FsShell
      title="Balance Sheet"
      subtitle={<>Statement of Financial Position{company ? ` · ${company}` : ''} · built from posted General Ledger and the client COA mapping</>}
      actions={
        <DownloadMenu
          disabled={!data}
          build={() => buildStatementReport({
            title: 'Statement of Financial Position', fileBase: `Balance-Sheet-${data!.as_of}`, companyName: company,
            subtitle: `As at ${currentLabel}${compareLabel ? ` (comparative ${compareLabel})` : ''}`,
            rows, currentLabel, compareLabel, printedBy: user?.nama || user?.username,
          })}
        />
      }
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <form onSubmit={e => { e.preventDefault(); if (!invalid) setQuery(form); }} className="bg-card border border-border rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3">
            <Field label="As at" className="w-44">
              <input type="date" value={form.as_of} onChange={e => setForm(f => ({ ...f, as_of: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Compare with" className="w-52">
              <Select value={form.compare} onChange={v => setForm(f => ({ ...f, compare: v as BsCompareMode }))}>
                {COMPARES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            {form.compare === 'custom' && (
              <Field label="Comparative date" className="w-44">
                <input type="date" value={form.compare_as_of ?? ''} onChange={e => setForm(f => ({ ...f, compare_as_of: e.target.value }))} className={inputCls} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground pb-2">
              <input type="checkbox" checked={form.show_zero} onChange={e => setForm(f => ({ ...f, show_zero: e.target.checked }))} className="rounded border-slate-300" />
              Show zero-balance accounts
            </label>
            <button type="submit" disabled={invalid || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply
            </button>
          </form>

          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <CheckBanner
                ok={data.check.balanced}
                okText={`Balanced — Total Assets ${fmtAmount(data.totals.assets)} = Total Liabilities + Equity ${fmtAmount(data.totals.liabilities_and_equity)}`}
                failText={`Not balanced — difference ${fmtAmount(data.check.difference)}${data.check.compare_difference ? ` (comparative ${fmtAmount(data.check.compare_difference)})` : ''}. Caused by journals whose debit ≠ credit.`}
                journals={data.check.unbalanced_journals}
              />
              <WarningsPanel warnings={data.warnings} />
              <div className="flex justify-end">
                <button type="button" onClick={() => setExpandAll(v => !v)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium bg-card hover:bg-slate-50">
                  {expandAll ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandAll ? 'Collapse all' : 'Expand all accounts'}
                </button>
              </div>
              <StatementTable
                rows={rows}
                currentLabel={currentLabel}
                compareLabel={compareLabel}
                glRange={{ start: startOfYear(data.as_of), end: data.as_of }}
                expandAll={expandAll}
              />
              <p className="text-xs text-muted-foreground">
                Lines follow the account head &amp; sub-classification in the client COA (overridable in the Mapping tab). “Auto” rows are profit not yet closed by a journal.
                Click a line to see its accounts, then the link icon to open the account in the General Ledger.
              </p>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}
