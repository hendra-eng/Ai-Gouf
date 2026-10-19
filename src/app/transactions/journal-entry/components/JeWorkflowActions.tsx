'use client';

// Tombol aksi workflow Journal Entry yang dipakai bersama oleh tab JE Transaction,
// Journal Preview, dan Exceptions:
//   draft/pending/exception --Approve--> approved --Post--> posted
//   draft/pending/exception/approved --Reject--> rejected --Reopen--> draft
//   draft/pending/exception/rejected --Delete--> (hilang)
// Aturan status & level diambil dari journalEntryStore (sama dengan backend).
// Tombol yang tidak boleh dipakai user (level kurang) atau tidak berlaku untuk status
// jurnal yang dipilih tidak ditampilkan.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import {
  runJeDraftAction, jeRoleLevel, JE_ACTION_FROM, JE_ACTION_LEVEL,
  type JeStatusAction, type JeUiEntry,
} from '@/lib/journalEntryStore';

interface ActionMeta {
  action: JeStatusAction;
  label: string;
  title: string;
  confirm: string;
  tone: 'primary' | 'neutral' | 'danger';
}

const ACTIONS: ActionMeta[] = [
  { action: 'approve', label: 'Approve', title: 'Approve journal entries', confirm: 'Approve', tone: 'primary' },
  { action: 'post', label: 'Post', title: 'Post to general ledger', confirm: 'Post', tone: 'primary' },
  { action: 'reopen', label: 'Reopen', title: 'Reopen as draft', confirm: 'Reopen', tone: 'neutral' },
  { action: 'reject', label: 'Reject', title: 'Reject journal entries', confirm: 'Reject', tone: 'danger' },
  { action: 'bulk-delete', label: 'Delete', title: 'Delete journal entries', confirm: 'Delete', tone: 'danger' },
];

const TONE: Record<ActionMeta['tone'], string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  neutral: 'border border-border text-foreground hover:bg-muted',
  danger: 'border border-red-200 text-red-700 hover:bg-red-50',
};

interface Props {
  /** Jurnal yang dikenai aksi (satu atau banyak). */
  entries: JeUiEntry[];
  /** Dipanggil setelah aksi sukses (mis. kosongkan pilihan). Data otomatis dimuat ulang oleh hook store. */
  onDone?: () => void;
  /** Batasi aksi yang ditampilkan (default: semua yang berlaku). */
  only?: JeStatusAction[];
  className?: string;
}

export default function JeWorkflowActions({ entries, onDone, only, className = '' }: Props) {
  const { user } = useAuth();
  const level = jeRoleLevel(user?.role);
  const [pending, setPending] = useState<ActionMeta | null>(null);
  const [reason, setReason] = useState('');
  const [postingDate, setPostingDate] = useState('');
  const [busy, setBusy] = useState(false);

  // Untuk tiap aksi: jurnal terpilih yang statusnya memenuhi syarat.
  const eligibleBy = useMemo(() => {
    const map = {} as Record<JeStatusAction, JeUiEntry[]>;
    (Object.keys(JE_ACTION_FROM) as JeStatusAction[]).forEach(a => {
      map[a] = entries.filter(e => JE_ACTION_FROM[a].includes(e.status));
    });
    return map;
  }, [entries]);

  const visible = ACTIONS.filter(m =>
    (!only || only.includes(m.action)) &&
    level >= JE_ACTION_LEVEL[m.action] &&
    eligibleBy[m.action].length > 0,
  );

  if (entries.length === 0 || visible.length === 0) return null;

  const close = () => { setPending(null); setReason(''); setPostingDate(''); };

  const run = async () => {
    if (!pending) return;
    const targets = eligibleBy[pending.action];
    setBusy(true);
    try {
      const hasil = await runJeDraftAction(pending.action, targets.map(t => t.id), {
        postingDate: pending.action === 'post' ? postingDate : undefined,
        reason: pending.action === 'reject' ? reason.trim() : undefined,
      });
      const done = hasil.done.length;
      const skipped = hasil.skipped;
      const kata = { approve: 'approved', post: 'posted', reject: 'rejected', reopen: 'reopened', 'bulk-delete': 'deleted' }[pending.action];
      if (done > 0) {
        toast.success(`${done} journal ${done === 1 ? 'entry' : 'entries'} ${kata}`, {
          description: skipped.length ? `${skipped.length} skipped.` : undefined,
        });
      }
      if (skipped.length > 0) {
        // Tampilkan alasan backend apa adanya (mis. akun tidak ada di COA, belum seimbang).
        const rincian = skipped.slice(0, 3).map(s => `${s.je_number ?? s.id}: ${s.reason}`).join('\n');
        (done > 0 ? toast.warning : toast.error)(done > 0 ? 'Some entries were skipped' : `No entries ${kata}`, {
          description: rincian + (skipped.length > 3 ? `\n…and ${skipped.length - 3} more.` : ''),
          duration: 10000,
        });
      }
      close();
      if (done > 0) onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${pending.label.toLowerCase()} journal entries`);
    } finally {
      setBusy(false);
    }
  };

  const targets = pending ? eligibleBy[pending.action] : [];
  const ignored = pending ? entries.length - targets.length : 0;

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        {visible.map(m => {
          const n = eligibleBy[m.action].length;
          return (
            <button
              key={m.action}
              type="button"
              title={m.title}
              onClick={e => { e.stopPropagation(); setPending(m); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${TONE[m.tone]}`}
            >
              {m.label}{entries.length > 1 ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.stopPropagation()}>
          <div className="je-card bg-card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">{pending.title}</h3>
              <button onClick={close} className="p-1 hover:bg-muted rounded" disabled={busy}><XMarkIcon className="w-4 h-4" /></button>
            </div>

            <p className="text-sm text-foreground">
              {pending.action === 'bulk-delete'
                ? <>Delete <b>{targets.length}</b> journal {targets.length === 1 ? 'entry' : 'entries'}? This cannot be undone.</>
                : <>{pending.confirm} <b>{targets.length}</b> journal {targets.length === 1 ? 'entry' : 'entries'}?</>}
            </p>
            {targets.length <= 5 && (
              <p className="text-xs text-muted-foreground font-mono">{targets.map(t => t.jeNumber).join(', ')}</p>
            )}
            {ignored > 0 && (
              <p className="text-xs text-muted-foreground">{ignored} selected {ignored === 1 ? 'entry is' : 'entries are'} not eligible for this action and will be left unchanged.</p>
            )}

            {pending.action === 'post' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Posting date (optional)</label>
                <input type="date" className="je-input" value={postingDate} onChange={e => setPostingDate(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Leave empty to use each entry&apos;s entry date. Posting needs at least 2 lines, balanced debit/credit, and accounts that exist in the client&apos;s chart of accounts.</p>
              </div>
            )}

            {pending.action === 'reject' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Reason (optional)</label>
                <textarea className="je-input min-h-[72px]" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="Why is this being rejected? It is saved to the entry notes." />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={close} disabled={busy} className="flex-1 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted disabled:opacity-50">Cancel</button>
              <button
                onClick={run}
                disabled={busy || targets.length === 0}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${pending.tone === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-primary text-primary-foreground hover:opacity-90'}`}
              >
                {busy ? 'Working…' : pending.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}