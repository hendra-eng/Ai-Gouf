'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Pencil, RotateCcw, Search, Wand2 } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  applyFsMappingDefaults, fetchFsMapping, resetFsMapping, saveFsMapping, type FsMapping, type MappedAccount, type MappingFields,
} from '@/lib/fsStore';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import { Field, Select, inputCls } from './PeriodPicker';

// Master mapping laporan keuangan per klien (Task Plan 16-19): seksi &
// baris laporan, komponen ekuitas, kategori cash flow, note CALK -- per
// akun COA. Default dari head/sub COA + aturan standard_account_code;
// override disimpan di management_client_fs_mappings.

const SOURCE: Record<MappedAccount['mapping_source'], { label: string; cls: string }> = {
  client: { label: 'Client', cls: 'bg-blue-50 text-blue-700' },
  default: { label: 'Default', cls: 'bg-slate-100 text-slate-600' },
  none: { label: 'Unmapped', cls: 'bg-amber-50 text-amber-700' },
};

function Editor({ a, m, clientId, onDone }: { a: MappedAccount; m: FsMapping; clientId: string; onDone: (changed: boolean) => void }) {
  const s = a.saved;
  const [f, setF] = useState<MappingFields>({
    fs_section: s?.fs_section ?? null, fs_line: s?.fs_line ?? null, equity_component: s?.equity_component ?? null,
    cash_flow_category: s?.cash_flow_category ?? null, cash_flow_line: s?.cash_flow_line ?? null, note_key: s?.note_key ?? null,
  });
  const [busy, setBusy] = useState(false);
  const bs = a.jenis === 'BS';
  const sections = bs ? m.options.balance_sheet_sections : m.options.profit_loss_sections;
  const effectiveSection = f.fs_section ?? a.section;
  const set = (k: keyof MappingFields, v: string) => setF(p => ({ ...p, [k]: v || null }));

  const save = async () => {
    if (!a.coa_id) return;
    setBusy(true);
    try { await saveFsMapping(clientId, a.coa_id, f); toast.success(`Mapping saved for ${a.code}`); onDone(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!a.coa_id) return;
    setBusy(true);
    try { await resetFsMapping(clientId, a.coa_id); toast.success(`${a.code} back to default`); onDone(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Reset failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-50 border-t border-border px-5 py-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Report section">
          <Select value={f.fs_section ?? ''} onChange={v => set('fs_section', v)}>
            <option value="">Default ({sections.find(x => x.key === a.section)?.label ?? a.section})</option>
            {sections.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
        </Field>
        <Field label="Report line">
          <input value={f.fs_line ?? ''} onChange={e => set('fs_line', e.target.value)} placeholder={`Default: ${a.line}`} className={inputCls} />
        </Field>
        {effectiveSection === 'equity' && (
          <Field label="Equity component">
            <Select value={f.equity_component ?? ''} onChange={v => set('equity_component', v)}>
              <option value="">Default{a.equity_component ? ` (${m.options.equity_components.find(x => x.key === a.equity_component)?.label})` : ' (none)'}</option>
              {m.options.equity_components.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="CALK note">
          <Select value={f.note_key ?? ''} onChange={v => set('note_key', v)}>
            <option value="">Default{a.note_key ? ` (${m.options.notes.find(x => x.key === a.note_key)?.label ?? a.note_key})` : ' (none)'}</option>
            {m.options.notes.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
        </Field>
        {bs && (
          <>
            <Field label="Cash flow category">
              <Select value={f.cash_flow_category ?? ''} onChange={v => set('cash_flow_category', v)}>
                <option value="">Default{a.cash_flow_category ? ` (${m.options.cash_flow_categories.find(x => x.key === a.cash_flow_category)?.label})` : ' (unmapped)'}</option>
                {m.options.cash_flow_categories.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
              </Select>
            </Field>
            <Field label="Cash flow line" className="xl:col-span-2">
              <input value={f.cash_flow_line ?? ''} onChange={e => set('cash_flow_line', e.target.value)} placeholder={a.cash_flow_line ? `Default: ${a.cash_flow_line}` : 'e.g. (Increase)/decrease in trade receivables'} className={inputCls} />
            </Field>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save mapping'}
        </button>
        {a.saved && (
          <button type="button" disabled={busy} onClick={reset} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm bg-card hover:bg-slate-100">
            <RotateCcw size={14} /> Reset to default
          </button>
        )}
        <button type="button" onClick={() => onDone(false)} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        <span className="ml-auto text-[11px] text-muted-foreground">Empty fields follow the COA head/sub and the default rule for <span className="font-mono">{a.standard_account_code ?? '—'}</span>.</span>
      </div>
    </div>
  );
}

export default function MappingClient() {
  const { activeClientId, hydrated } = useActiveClient();
  const [data, setData] = useState<FsMapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statement, setStatement] = useState<'all' | 'BS' | 'PL'>('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(() => {
    if (!activeClientId) return;
    setLoading(true);
    setError(null);
    fetchFsMapping(activeClientId)
      .then(setData)
      .catch(e => { setError(e instanceof Error ? e.message : 'Failed to load mapping'); setData(null); })
      .finally(() => setLoading(false));
  }, [activeClientId]);

  useEffect(() => { if (hydrated) load(); }, [hydrated, load]);

  const label = useCallback((list: { key: string; label: string }[] | undefined, key: string | null) => (key ? list?.find(x => x.key === key)?.label ?? key : '—'), []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.accounts.filter(a =>
      (statement === 'all' || a.jenis === statement)
      && (!onlyIssues || a.warnings.length > 0)
      && (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.line.toLowerCase().includes(q)));
  }, [data, search, statement, onlyIssues]);

  const applyDefaults = async (overwrite: boolean) => {
    if (!activeClientId) return;
    setApplying(true);
    try {
      const r = await applyFsMappingDefaults(activeClientId, overwrite);
      toast.success(`Defaults applied: ${r.created} created, ${r.updated} updated, ${r.skipped} kept, ${r.without_rule} without a rule`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setApplying(false); }
  };

  const o = data?.options;
  const sectionLabel = (a: MappedAccount) => label(a.jenis === 'BS' ? o?.balance_sheet_sections : o?.profit_loss_sections, a.section);

  return (
    <FsShell
      title="Financial Statement Mapping"
      subtitle="Master mapping per client: how each COA account flows into the Balance Sheet, Profit & Loss, Changes in Equity, Cash Flow and CALK"
      actions={
        <>
          <button type="button" disabled={!data || applying} onClick={() => applyDefaults(false)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {applying ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Apply defaults
          </button>
          <button type="button" disabled={!data || applying} onClick={() => applyDefaults(true)} className="px-3.5 py-2.5 rounded-lg border border-border text-sm font-medium bg-card hover:bg-slate-50 disabled:opacity-50" title="Re-apply default rules to every account, replacing saved cash flow / equity / note values">
            Re-apply &amp; overwrite
          </button>
        </>
      }
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  ['Accounts', data.summary.accounts, ''],
                  ['Saved for client', data.summary.saved, ''],
                  ['With warnings', data.summary.with_warnings, data.summary.with_warnings ? 'text-amber-700' : ''],
                  ['No cash flow mapping', data.summary.no_cash_flow_mapping, data.summary.no_cash_flow_mapping ? 'text-rose-700' : ''],
                  ['No equity component', data.summary.no_equity_component, data.summary.no_equity_component ? 'text-rose-700' : ''],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="bg-card border border-border rounded-xl px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{l}</p>
                    <p className={`text-lg font-bold tabular-nums mt-0.5 ${c}`}>{v}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name or line" className={`${inputCls} pl-8 w-64`} />
                </div>
                <div className="w-48">
                  <Select value={statement} onChange={v => setStatement(v as 'all' | 'BS' | 'PL')}>
                    <option value="all">All accounts</option>
                    <option value="BS">Balance sheet accounts</option>
                    <option value="PL">Profit &amp; loss accounts</option>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="rounded border-slate-300" /> Only accounts with warnings
                </label>
                <span className="ml-auto text-xs text-muted-foreground">{rows.length} shown</span>
              </div>

              <div className="bg-card border border-border rounded-xl overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-slate-50 border-b border-border">
                      <th className="text-left font-semibold px-4 py-2.5">Account</th>
                      <th className="text-left font-semibold px-3 py-2.5">Report section / line</th>
                      <th className="text-left font-semibold px-3 py-2.5">Equity</th>
                      <th className="text-left font-semibold px-3 py-2.5">Cash flow</th>
                      <th className="text-left font-semibold px-3 py-2.5">CALK note</th>
                      <th className="text-left font-semibold px-3 py-2.5">Source</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(a => {
                      const k = a.coa_id ?? a.code;
                      return (
                        <React.Fragment key={k}>
                          <tr className={`border-t border-border ${editing === k ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                                <span className="text-foreground">{a.name}</span>
                                {a.warnings.length > 0 && (
                                  <span title={a.warnings.map(w => o?.warnings[w] ?? w).join('\n')}><AlertTriangle size={13} className="text-amber-500" /></span>
                                )}
                                {!a.is_active && <span className="text-[10px] uppercase bg-slate-100 text-slate-500 rounded px-1">inactive</span>}
                              </div>
                              <div className="text-[11px] text-muted-foreground">{a.classification ?? 'not in COA'}{a.account_head ? ` · ${a.account_head}` : ''}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="text-foreground">{sectionLabel(a)}</div>
                              <div className="text-[11px] text-muted-foreground">{a.line}</div>
                            </td>
                            <td className="px-3 py-2 text-[13px]">{a.section === 'equity' ? label(o?.equity_components, a.equity_component) : <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2 text-[13px]">
                              {a.jenis === 'BS' ? (
                                a.cash_flow_category
                                  ? <><div>{label(o?.cash_flow_categories, a.cash_flow_category)}</div><div className="text-[11px] text-muted-foreground">{a.cash_flow_line}</div></>
                                  : <span className="text-rose-700 font-medium">Not mapped</span>
                              ) : <span className="text-muted-foreground">Via net profit</span>}
                            </td>
                            <td className="px-3 py-2 text-[13px]">{label(o?.notes, a.note_key)}</td>
                            <td className="px-3 py-2"><span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${SOURCE[a.mapping_source].cls}`}>{SOURCE[a.mapping_source].label}</span></td>
                            <td className="px-3 py-2 text-right">
                              {a.coa_id && (
                                <button type="button" onClick={() => setEditing(editing === k ? null : k)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                                  <Pencil size={12} /> Edit
                                </button>
                              )}
                            </td>
                          </tr>
                          {editing === k && (
                            <tr><td colSpan={7} className="p-0">
                              <Editor a={a} m={data} clientId={activeClientId} onDone={changed => { setEditing(null); if (changed) load(); }} />
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                “Default” means the account follows its COA head/sub and the standard rule for its standard account code — new COA accounts are picked up
                automatically. “Apply defaults” copies those rules into this client&apos;s own mapping so they can be reviewed and edited.
                Editing requires Supervisor (Tahap 3) or above.
              </p>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}
