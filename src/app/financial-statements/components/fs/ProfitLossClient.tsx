'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchProfitLoss, fetchSegments, type PeriodQuery, type ProfitLoss, type SegmentType } from '@/lib/fsStore';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import StatementTable, { type StatementRow } from './StatementTable';
import DownloadMenu from './DownloadMenu';
import { WarningsPanel } from './CheckBanner';
import PeriodPicker, { Field, Select, defaultPeriod } from './PeriodPicker';
import { buildStatementReport } from './statementPrint';
import { fmtAmount } from './fsFormat';

// Task Plan 17 -- Profit & Loss dari posted GL (bukan dokumen Sales/Purchase
// langsung) + mapping COA. Periode bulanan / YTD / custom, pembanding,
// filter segment, rincian per bulan, drill-down akun -> GL.

interface Segmen { type: string; value: string }

export default function ProfitLossClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodQuery>(defaultPeriod);
  const [segForm, setSegForm] = useState<Segmen>({ type: '', value: '' });
  const [segmen, setSegmen] = useState<Segmen>({ type: '', value: '' });
  const [monthly, setMonthly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);

  // Cache lewat react-query: pindah tab lalu kembali langsung menampilkan data
  // terakhir (tanpa skeleton / kedip); data lama dipertahankan saat filter diubah.
  const segQuery = useQuery({
    queryKey: ['fs', 'segments', activeClientId],
    queryFn: () => fetchSegments(activeClientId!),
    enabled: hydrated && !!activeClientId,
  });
  const segTypes: SegmentType[] = segQuery.data?.types ?? [];

  const plQuery = useQuery({
    queryKey: ['fs', 'profit-loss', activeClientId, period, segmen, monthly],
    queryFn: ({ signal }) => fetchProfitLoss(activeClientId!, {
      ...period,
      segment_type: segmen.type && segmen.value ? segmen.type : undefined,
      segment_value: segmen.type && segmen.value ? segmen.value : undefined,
      breakdown: monthly ? 'monthly' : 'none',
    }, signal),
    enabled: hydrated && !!activeClientId,
    placeholderData: keepPreviousData,
  });
  const data: ProfitLoss | null = plQuery.data ?? null;
  const loading = plQuery.isFetching && (plQuery.isPlaceholderData || !plQuery.data);
  const error = plQuery.error ? (plQuery.error as Error).message : null;

  const rows = useMemo<StatementRow[]>(() => {
    if (!data) return [];
    return data.rows.map(r => r.type === 'section'
      ? { kind: 'section' as const, section: r }
      : { kind: r.key === 'net_profit' ? 'total' as const : 'subtotal' as const, key: r.key, label: r.label, amount: r.amount, compare_amount: r.compare_amount, monthly: r.monthly });
  }, [data]);

  const info = data?.period_info;
  const currentLabel = info?.label ?? '';
  const compareLabel = info?.compare?.label ?? null;
  const company = data?.client.company_name ?? '';
  const segOptions = segTypes.find(t => t.key === segForm.type)?.values ?? [];
  const s = data?.summary;

  return (
    <FsShell
      title="Profit & Loss"
      subtitle={<>Statement of Profit or Loss{company ? ` · ${company}` : ''} · from posted General Ledger, grouped by the client COA mapping</>}
      actions={
        <>
          <label className="flex items-center gap-2 text-sm text-foreground mr-2">
            <input type="checkbox" checked={monthly} onChange={e => setMonthly(e.target.checked)} className="rounded border-slate-300" />
            Monthly columns
          </label>
          <DownloadMenu
            disabled={!data}
            build={() => buildStatementReport({
              title: 'Statement of Profit or Loss', fileBase: `Profit-Loss-${data!.period.start}_${data!.period.end}`, companyName: company,
              subtitle: `Period ${currentLabel}${compareLabel ? ` vs ${compareLabel}` : ''}${data!.segment ? ` · ${data!.segment.type}: ${data!.segment.value}` : ''}`,
              rows, currentLabel, compareLabel, months: data!.months, printedBy: user?.nama || user?.username,
            })}
          />
        </>
      }
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <PeriodPicker
            value={period}
            loading={loading}
            onApply={q => { setPeriod(q); setSegmen(segForm); }}
            extra={
              <>
                <Field label="Segment" className="w-40">
                  <Select value={segForm.type} onChange={v => setSegForm({ type: v, value: '' })}>
                    <option value="">All segments</option>
                    {segTypes.map(t => <option key={t.key} value={t.key} disabled={t.values.length === 0}>{t.label}{t.values.length === 0 ? ' (no data)' : ''}</option>)}
                  </Select>
                </Field>
                {segForm.type && (
                  <Field label="Value" className="w-44">
                    <Select value={segForm.value} onChange={v => setSegForm(f => ({ ...f, value: v }))}>
                      <option value="">Choose…</option>
                      {segOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  </Field>
                )}
              </>
            }
          />

          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && s && (
            <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {(['gross_profit', 'operating_profit', 'profit_before_tax', 'net_profit'] as const).map(k => (
                  <div key={k} className={`border rounded-xl px-4 py-3 ${k === 'net_profit' ? 'bg-blue-50 border-blue-200' : 'bg-card border-border'}`}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{s[k].label}</p>
                    <p className={`text-lg font-bold tabular-nums mt-0.5 ${s[k].amount < 0 ? 'text-rose-700' : 'text-foreground'}`}>{fmtAmount(s[k].amount)}</p>
                    {s[k].compare_amount !== null && <p className="text-xs text-muted-foreground tabular-nums">vs {fmtAmount(s[k].compare_amount)}</p>}
                  </div>
                ))}
              </div>
              <WarningsPanel warnings={data.warnings} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {currentLabel}{compareLabel ? ` · compared with ${compareLabel}` : ''}{data.segment ? ` · ${segTypes.find(t => t.key === data.segment!.type)?.label ?? data.segment.type}: ${data.segment.value}` : ''}
                </p>
                <button type="button" onClick={() => setExpandAll(v => !v)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium bg-card hover:bg-slate-50">
                  {expandAll ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandAll ? 'Collapse all' : 'Expand all accounts'}
                </button>
              </div>
              <StatementTable
                rows={rows}
                currentLabel={currentLabel}
                compareLabel={compareLabel}
                months={data.months}
                glRange={{ start: data.period.start, end: data.period.end }}
                expandAll={expandAll}
              />
              <p className="text-xs text-muted-foreground">
                Year to date starts on 1 January, or on the client&apos;s first bookkeeping month when it started mid-year.
                Department and Business Unit filters become available once transactions carry those dimensions.
              </p>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}
