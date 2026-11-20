'use client';

import React, { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, History, Loader2, Pencil, Plus, RotateCcw, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import {
  createNote, deleteNote, fetchNoteAudit, fetchNotes, notesDocxUrl, removeNoteOverride, saveNoteContent, setNoteOverride, updateNote,
  type FsNote, type FsNotes, type NoteAudit, type NoteRow, type PeriodQuery,
} from '@/lib/fsStore';
import FsShell, { ErrorBlock, LoadingBlock, NoClient } from './FsShell';
import PeriodPicker, { Field, Select, defaultPeriod } from './PeriodPicker';
import { inputCls as monoInputCls, thCls, thRowCls, trCls } from './bs/BsMono';

// Font gaya Sales: input teks text-xs neutral-900 (tanpa medium), label kecil neutral-500, tabel text-xs.
const fieldCls = monoInputCls;
import { fmtAmount, fmtDate, glHref, startOfYear } from './fsFormat';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Task Plan 20 -- framework CALK: template note -> note klien -> isi per
// periode. Tabel angka ditarik dari GL (read-only); override angka hanya
// untuk Manager+ dengan alasan & audit trail. Narasi bisa diedit Supervisor+.

const STATEMENT_LABEL: Record<string, string> = {
  GENERAL: 'General', BALANCE_SHEET: 'Balance Sheet', PROFIT_LOSS: 'Profit & Loss', EQUITY: 'Equity', CASH_FLOW: 'Cash Flow',
};
const SOURCE_LABEL: Record<FsNote['narrative_source'], string> = {
  period: 'Text for this period', client: 'Client standard text', template: 'Template text',
};
const AUDIT_LABEL: Record<string, string> = {
  narrative_update: 'Narrative changed', status_update: 'Status changed', note_update: 'Note settings changed',
  override_set: 'Override set', override_remove: 'Override removed', note_create: 'Note created', note_delete: 'Note deleted',
};

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Request failed';
}

// ── Override 1 baris ─────────────────────────────────────────────────

function OverrideEditor({ row, onSave, onCancel }: { row: NoteRow; onSave: (v: number, reason: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(String(row.override?.override_value ?? row.system_amount));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const num = Number(value.replace(/\./g, '').replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(num) && reason.trim().length >= 3;
  return (
    <div className="mt-1 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-300 border-l-[3px] border-l-amber-600 bg-neutral-50 p-3">
      <Field salesFont label={`Override value (system ${fmtAmount(row.system_amount)})`} className="w-56">
        <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" className={fieldCls} />
      </Field>
      <Field salesFont label="Reason (required, kept in audit trail)" className="flex-1 min-w-[16rem]">
        <input value={reason} onChange={e => setReason(e.target.value)} className={fieldCls} placeholder="e.g. Audit adjustment not yet journaled" />
      </Field>
      <button type="button" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSave(num, reason.trim()); } finally { setBusy(false); } }}
        className="px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-700 text-xs font-semibold disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save override'}
      </button>
      <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">Cancel</button>
    </div>
  );
}

// ── 1 note ───────────────────────────────────────────────────────────

function NoteCard({ note, d, clientId, onChanged }: { note: FsNote; d: FsNotes; clientId: string; onChanged: () => void }) {
  const perms = d.permissions;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.narrative_raw);
  const [scope, setScope] = useState<'period' | 'client'>(note.narrative_source === 'client' ? 'client' : 'period');
  const [busy, setBusy] = useState(false);
  const [overrideRow, setOverrideRow] = useState<string | null>(null);
  const [audit, setAudit] = useState<NoteAudit[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(note.title);

  useEffect(() => { setText(note.narrative_raw); setTitle(note.title); }, [note.narrative_raw, note.title]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged(); if (audit) setAudit(await fetchNoteAudit(clientId, note.id)); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const saveNarrative = () => run(async () => {
    if (scope === 'period') await saveNoteContent(clientId, note.id, { period_end: d.as_of, narrative: text });
    else await updateNote(clientId, note.id, { narrative: text });
    setEditing(false);
  }, 'Narrative saved');

  const toggleAudit = async () => {
    if (audit) { setAudit(null); return; }
    try { setAudit(await fetchNoteAudit(clientId, note.id)); } catch (e) { toast.error(errMsg(e)); }
  };

  const glStart = (statement: string) => (statement === 'BALANCE_SHEET' ? startOfYear(d.as_of) : d.period.start);

  return (
    <section id={`note-${note.id}`} className="card-elevated-md rounded-xl p-5 scroll-mt-24">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input value={title} onChange={e => setTitle(e.target.value)} className={`${fieldCls} max-w-md`} />
              <button type="button" disabled={!title.trim() || busy} onClick={() => run(async () => { await updateNote(clientId, note.id, { title: title.trim() }); setRenaming(false); }, 'Title updated')}
                className="px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-700 text-xs font-semibold disabled:opacity-50">Save</button>
              <button type="button" onClick={() => { setRenaming(false); setTitle(note.title); }} className="p-2 text-neutral-500"><X size={14} /></button>
            </div>
          ) : (
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">{note.no}. {note.title}</h2>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200 rounded px-1.5 py-0.5">{STATEMENT_LABEL[note.statement] ?? note.statement}</span>
            {note.is_custom && <span className="text-[10px] font-semibold uppercase tracking-wide bg-neutral-800 text-white rounded px-1.5 py-0.5">Custom</span>}
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${note.status === 'final' ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-300'}`}>{note.status}</span>
            {note.has_override && <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">Overridden</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {perms.edit_narrative && (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => saveNoteContent(clientId, note.id, { period_end: d.as_of, status: note.status === 'final' ? 'draft' : 'final' }), note.status === 'final' ? 'Marked as draft' : 'Marked as final')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                <CheckCircle2 size={13} /> {note.status === 'final' ? 'Reopen draft' : 'Mark final'}
              </button>
              <button type="button" onClick={() => setRenaming(true)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                <Pencil size={13} /> Rename
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => (note.is_custom ? deleteNote(clientId, note.id) : updateNote(clientId, note.id, { is_enabled: false })), note.is_custom ? 'Note deleted' : 'Note hidden')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-red-700 shadow-sm transition-colors hover:border-red-700 hover:bg-neutral-50">
                <Trash2 size={13} /> {note.is_custom ? 'Delete' : 'Hide'}
              </button>
            </>
          )}
          <button type="button" onClick={toggleAudit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
            <History size={13} /> Audit trail
          </button>
        </div>
      </div>

      {/* Narasi */}
      <div className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} className={`${fieldCls} leading-relaxed`} />
            <p className="text-[11px] font-medium text-neutral-500">Placeholders: {'{company}'} {'{period_start}'} {'{period_end}'} {'{year}'}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select mono value={scope} onChange={v => setScope(v as 'period' | 'client')}>
                <option value="period">Save for this period only (as at {fmtDate(d.as_of)})</option>
                <option value="client">Save as client standard text (all periods)</option>
              </Select>
              <button type="button" disabled={busy} onClick={saveNarrative} className="px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-700 text-xs font-semibold disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save narrative'}
              </button>
              <button type="button" onClick={() => { setEditing(false); setText(note.narrative_raw); }} className="px-3 py-2 rounded-lg text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="group">
            <p className="text-sm text-neutral-800 leading-relaxed whitespace-pre-line">{note.narrative || <span className="italic text-neutral-500">No narrative yet.</span>}</p>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-medium text-neutral-500">
              <span>{SOURCE_LABEL[note.narrative_source]}</span>
              {perms.edit_narrative && (
                <>
                  <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 font-semibold text-neutral-900 hover:underline"><Pencil size={11} /> Edit narrative</button>
                  {note.narrative_source === 'period' && (
                    <button type="button" disabled={busy} onClick={() => run(() => saveNoteContent(clientId, note.id, { period_end: d.as_of, narrative: '' }), 'Period text removed')} className="inline-flex items-center gap-1 hover:underline">
                      <RotateCcw size={11} /> Use standard text
                    </button>
                  )}
                  {note.narrative_source === 'client' && !note.is_custom && (
                    <button type="button" disabled={busy} onClick={() => run(() => updateNote(clientId, note.id, { narrative: '' }), 'Back to template text')} className="inline-flex items-center gap-1 hover:underline">
                      <RotateCcw size={11} /> Reset to template
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabel angka dari GL */}
      {note.note_type === 'account' && note.groups.length === 0 && (
        <p className="mt-3 text-xs italic text-neutral-500">No balances for accounts mapped to this note in the selected period.</p>
      )}
      {note.groups.map(g => (
        <div key={g.label} className="mt-4 overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr className={thRowCls}>
                <th className={`${thCls} text-left`}>{g.label}</th>
                <th className={`${thCls} w-40 text-right`}>{fmtDate(d.as_of)}</th>
                {d.compare_period && <th className={`${thCls} w-40 text-right`}>{fmtDate(d.compare_period.end)}</th>}
                {perms.override && <th className={`${thCls} w-28`} />}
              </tr>
            </thead>
            <tbody>
              {g.rows.map(r => (
                <React.Fragment key={r.code}>
                  <tr className={`${trCls} ${r.override ? '[&>td]:bg-amber-50' : ''}`}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-[11px] text-neutral-500">{kodeAkun(r.code)}</span>
                        <span className="text-neutral-700">{r.name}</span>
                        <Link href={glHref(r.code, glStart(g.statement), d.as_of)} target="_blank" title="Open in General Ledger" className="text-neutral-500 hover:text-neutral-900"><ExternalLink size={12} /></Link>
                        {r.override && (
                          <span title={`System: ${fmtAmount(r.system_amount)}\nReason: ${r.override.reason ?? ''}\nBy: ${r.override.created_by_name ?? '-'}`} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-700">
                            <AlertTriangle size={12} /> override
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-900">{fmtAmount(r.amount)}</td>
                    {d.compare_period && <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{fmtAmount(r.compare_amount)}</td>}
                    {perms.override && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.override ? (
                          <button type="button" disabled={busy} onClick={() => run(() => removeNoteOverride(clientId, note.id, r.override!.id, 'Reverted to system value'), 'Override removed')}
                            className="text-[11px] font-semibold text-red-700 hover:underline">Remove override</button>
                        ) : (
                          <button type="button" onClick={() => setOverrideRow(overrideRow === r.code ? null : r.code)} className="text-[11px] font-semibold text-neutral-900 hover:underline">Override</button>
                        )}
                      </td>
                    )}
                  </tr>
                  {overrideRow === r.code && (
                    <tr><td colSpan={4}>
                      <OverrideEditor
                        row={r}
                        onCancel={() => setOverrideRow(null)}
                        onSave={async (v, reason) => {
                          await run(() => setNoteOverride(clientId, note.id, { period_end: d.as_of, row_key: r.code, override_value: v, system_value: r.system_amount, reason }), 'Override saved');
                          setOverrideRow(null);
                        }}
                      />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              <tr className="text-xs font-bold text-neutral-900 [&>td]:bg-neutral-200 [&>td]:shadow-[inset_0_-1px_0_#171717,inset_0_1px_0_#171717]">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtAmount(g.total)}</td>
                {d.compare_period && <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtAmount(g.compare_total)}</td>}
                {perms.override && <td />}
              </tr>
            </tbody>
          </table>
          <p className={`mt-1 text-[11px] font-medium ${g.reconciled ? 'text-neutral-600' : 'text-amber-700'}`}>
            {g.reconciled
              ? `Reconciles to ${g.statement === 'BALANCE_SHEET' ? 'Balance Sheet' : 'Profit & Loss'} (${fmtAmount(g.system_total)})`
              : `Differs from ${g.statement === 'BALANCE_SHEET' ? 'Balance Sheet' : 'Profit & Loss'} (${fmtAmount(g.system_total)}) by ${fmtAmount(g.difference)} because of overrides`}
          </p>
        </div>
      ))}

      {audit && (
        <div className="mt-4 border-t border-neutral-300 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600 mb-2">Audit trail</p>
          {audit.length === 0 ? <p className="text-xs italic text-neutral-500">No changes recorded yet.</p> : (
            <ul className="space-y-1.5 text-xs">
              {audit.map(a => (
                <li key={a.id} className="flex flex-wrap gap-x-2">
                  <span className="text-neutral-500">{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="font-semibold text-neutral-900">{a.user_name || '—'}</span>
                  <span>{AUDIT_LABEL[a.action] ?? a.action}{a.field ? ` (${a.field})` : ''}{a.period_end ? ` · period ${fmtDate(a.period_end)}` : ''}</span>
                  {(a.old_value || a.new_value) && a.field !== 'narrative' && <span className="text-neutral-500">{a.old_value ?? '∅'} → {a.new_value ?? '∅'}</span>}
                  {a.reason && <span className="italic text-neutral-500">“{a.reason}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ── Kelola note (aktifkan lagi / tambah custom) ──────────────────────

function ManageNotes({ d, clientId, onChanged }: { d: FsNotes; clientId: string; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('GENERAL');
  const [type, setType] = useState<'policy' | 'account'>('policy');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await createNote(clientId, { title: title.trim(), statement, note_type: type, note_key: type === 'account' ? key.trim() : undefined });
      toast.success('Note added');
      setTitle(''); setKey('');
      onChanged();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-dashed border-neutral-400 bg-white p-5 space-y-4">
      <p className="text-sm font-semibold text-neutral-900">Manage notes</p>
      {d.disabled_notes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-1.5">Hidden notes</p>
          <div className="flex flex-wrap gap-2">
            {d.disabled_notes.map(n => (
              <button key={n.id} type="button" onClick={async () => { try { await updateNote(clientId, n.id, { is_enabled: true }); toast.success('Note shown'); onChanged(); } catch (e) { toast.error(errMsg(e)); } }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                <Plus size={12} /> {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field salesFont label="New note title" className="flex-1 min-w-[14rem]">
          <input value={title} onChange={e => setTitle(e.target.value)} className={fieldCls} placeholder="e.g. Commitments and Contingencies" />
        </Field>
        <Field salesFont label="Statement" className="w-40">
          <Select mono value={statement} onChange={setStatement}>
            {Object.entries(STATEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field salesFont label="Type" className="w-44">
          <Select mono value={type} onChange={v => setType(v as 'policy' | 'account')}>
            <option value="policy">Narrative only</option>
            <option value="account">Narrative + GL table</option>
          </Select>
        </Field>
        {type === 'account' && (
          <Field salesFont label="Note key (map accounts to it)" className="w-52">
            <input value={key} onChange={e => setKey(e.target.value)} className={fieldCls} placeholder="e.g. commitments" />
          </Field>
        )}
        <button type="button" disabled={busy || !title.trim() || (type === 'account' && !key.trim())} onClick={add}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-700 text-xs font-semibold disabled:opacity-50">
          <Plus size={15} /> Add note
        </button>
      </div>
      <p className="text-[11px] font-medium text-neutral-500">
        A GL table note shows every account whose mapping note key equals the note key (set it per account in the <Link href="/financial-statements/mapping" className="underline">Mapping tab</Link>).
      </p>
    </section>
  );
}

// ── Halaman ──────────────────────────────────────────────────────────

export default function NotesClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId, hydrated } = useActiveClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodQuery>(defaultPeriod);
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: ['fs', 'notes', activeClientId, period],
    queryFn: ({ signal }) => fetchNotes(activeClientId!, period, signal),
    enabled: hydrated && !!activeClientId,
    placeholderData: keepPreviousData,
  });
  const data: FsNotes | null = notesQuery.data ?? null;
  const loading = notesQuery.isFetching && (notesQuery.isPlaceholderData || !notesQuery.data);
  const error = notesQuery.error ? errMsg(notesQuery.error) : null;

  // Setelah edit catatan/override, segarkan semua cache laporan.
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['fs'] }); };
  const company = data?.client.company_name ?? '';

  const downloadMenu = data && activeClientId ? (
    <div className="flex items-center gap-2">
      <button type="button" onClick={async () => { const { downloadNotesPdf } = await import('./notesPdf'); downloadNotesPdf(data, user?.nama || user?.username); }} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium border border-neutral-300 bg-white text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
        <FileText size={14} className="text-neutral-500" /> PDF
      </button>
      <a href={notesDocxUrl(activeClientId, period)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-800 text-white shadow-sm transition-colors hover:bg-neutral-700 text-xs font-semibold">
        <Download size={14} /> Word (.docx)
      </a>
    </div>
  ) : null;

  return (
    <FsShell
      title="Notes to Financial Statements"
      subtitle={<>CALK framework — template, client and period-specific notes with GL-linked tables{company ? ` · ${company}` : ''}</>}
    >
      {!hydrated ? <LoadingBlock /> : !activeClientId ? <NoClient /> : (
        <>
          <PeriodPicker mono value={period} onApply={setPeriod} loading={loading} trailing={downloadMenu} />
          {error && <ErrorBlock message={error} />}
          {loading && !data && <LoadingBlock />}
          {data && (
            <div className={`grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] ${loading ? 'opacity-60' : ''}`}>
              <aside className="hidden lg:block">
                <nav className="card-elevated-md sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl p-2 scrollbar-thin">
                  {data.notes.map(n => (
                    <a key={n.id} href={`#note-${n.id}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900">
                      <span className="text-neutral-500 tabular-nums w-5">{n.no}.</span>
                      <span className="truncate flex-1">{n.title}</span>
                      {n.has_override && <AlertTriangle size={12} className="text-amber-500" />}
                      <span className={`w-2 h-2 rounded-full ${n.status === 'final' ? 'bg-neutral-800' : 'border border-neutral-400 bg-white'}`} title={n.status} />
                    </a>
                  ))}
                </nav>
              </aside>
              <div className="space-y-4 min-w-0">
                <p className="text-xs font-medium text-neutral-500">
                  As at {fmtDate(data.as_of)} · profit &amp; loss figures for {fmtDate(data.period.start)} – {fmtDate(data.as_of)}
                  {data.compare_period ? ` · comparative ${fmtDate(data.compare_period.end)}` : ''}.
                  {!data.permissions.edit_narrative && ' You have read-only access (editing narratives requires Supervisor or above).'}
                </p>
                {data.accounts_without_note.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-neutral-300 border-l-[3px] border-l-amber-600 bg-neutral-50 px-4 py-3 text-xs font-medium text-neutral-800">
                    <AlertTriangle size={16} className="text-amber-500 mt-0.5" />
                    <span>
                      {data.accounts_without_note.length} account{data.accounts_without_note.length > 1 ? 's' : ''} with balances are not shown in any note:{' '}
                      {data.accounts_without_note.slice(0, 6).map(a => `${kodeAkun(a.code)} ${a.name}`).join(' · ')}{data.accounts_without_note.length > 6 ? ' …' : ''}{' '}
                      <Link href="/financial-statements/mapping" className="font-semibold underline">Map them</Link>
                    </span>
                  </div>
                )}
                {data.notes.map(n => <NoteCard key={n.id} note={n} d={data} clientId={activeClientId} onChanged={refresh} />)}
                {data.permissions.edit_narrative && <ManageNotes d={data} clientId={activeClientId} onChanged={refresh} />}
              </div>
            </div>
          )}
        </>
      )}
    </FsShell>
  );
}