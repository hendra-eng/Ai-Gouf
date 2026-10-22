'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Send, XCircle, RotateCcw, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { updateJeDraftFull, type BackendJeDraftWithLines } from '@/lib/journalEntryStore';
import { useOtherData } from '../lib/otherStore';
import {
  buildOtherJournals,
  allowedActions,
  ACTION_LABEL,
  journalsToCsv,
  downloadCsv,
  type OtherAction,
  type OtherJournal,
} from '../lib/otherJournals';
import OtherJournalModal from './OtherJournalModal';

// Satu "ruang kerja" yang dipakai semua tab Other: data jurnal + semua aksi
// (tambah, edit, approve, posting, tolak, buka kembali, hapus, ekspor CSV)
// + dialog yang dibutuhkan. Setiap tab cukup memanggil useOtherWorkspace()
// dan merender {ws.dialogs}.

type PendingConfirm = {
  action: 'post' | 'reject' | 'delete';
  journals: OtherJournal[];
};

const CONFIRM_TEXT: Record<PendingConfirm['action'], { title: string; button: string; tone: string }> = {
  post: { title: 'Posting jurnal', button: 'Posting Sekarang', tone: 'bg-emerald-600 hover:bg-emerald-700' },
  reject: { title: 'Tolak jurnal', button: 'Tolak', tone: 'bg-rose-600 hover:bg-rose-700' },
  delete: { title: 'Hapus jurnal', button: 'Hapus', tone: 'bg-rose-600 hover:bg-rose-700' },
};

export function useOtherWorkspace() {
  const data = useOtherData();
  const { user } = useAuth();
  const [modal, setModal] = useState<{ draft: BackendJeDraftWithLines | null } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [reason, setReason] = useState('');
  const [postingDate, setPostingDate] = useState('');
  const [busy, setBusy] = useState(false);

  const journals = useMemo(() => buildOtherJournals(data.transactions), [data.transactions]);
  const createdByName = user?.nama || user?.username || 'System';

  const openNew = useCallback(() => setModal({ draft: null }), []);

  const run = useCallback(
    async (action: 'approve' | 'post' | 'reject' | 'reopen' | 'delete', js: OtherJournal[], opts: { reason?: string; postingDate?: string } = {}) => {
      const ids = js.filter((j) => allowedActions(j).includes(action)).map((j) => j.draftId as string);
      if (ids.length === 0) {
        toast.info(`Tidak ada jurnal yang bisa di-${ACTION_LABEL[action].toLowerCase()} pada status saat ini.`);
        return 0;
      }
      setBusy(true);
      try {
        const res = await data.runAction(action === 'delete' ? 'bulk-delete' : action, ids, opts);
        return res.done;
      } finally {
        setBusy(false);
      }
    },
    [data],
  );

  /** Titik masuk tunggal untuk semua tombol aksi. */
  const act = useCallback(
    (action: OtherAction, js: OtherJournal[]) => {
      if (js.length === 0) return;
      if (action === 'edit') {
        const d = data.drafts.find((x) => x.id === js[0].draftId) || null;
        if (!d) { toast.error('Data jurnal tidak ditemukan di server.'); return; }
        setModal({ draft: d });
        return;
      }
      if (action === 'approve' || action === 'reopen') { void run(action, js); return; }
      setReason('');
      setPostingDate('');
      setConfirm({ action, journals: js.filter((j) => allowedActions(j).includes(action)) });
    },
    [data.drafts, run],
  );

  /** Tandai catatan review selesai (menghapus notes jurnal). */
  const clearNotes = useCallback(
    async (j: OtherJournal) => {
      if (!j.draftId) return;
      setBusy(true);
      try {
        await updateJeDraftFull(j.draftId, { notes: null });
        toast.success('Catatan ditandai selesai.', { description: j.jeId });
        data.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan perubahan.');
      } finally {
        setBusy(false);
      }
    },
    [data],
  );

  const exportCsv = useCallback((js: OtherJournal[], name = 'jurnal-other') => {
    if (js.length === 0) { toast.info('Tidak ada data untuk diekspor.'); return; }
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, journalsToCsv(js));
    toast.success(`${js.length} jurnal diekspor ke CSV.`);
  }, []);

  const submitConfirm = async () => {
    if (!confirm) return;
    if (confirm.action === 'reject' && !reason.trim()) { toast.error('Alasan penolakan wajib diisi.'); return; }
    const c = confirm;
    await run(c.action, c.journals, { reason: reason.trim() || undefined, postingDate: postingDate || undefined });
    setConfirm(null);
  };

  const dialogs = (
    <>
      {modal && data.clientId && (
        <OtherJournalModal
          clientId={data.clientId}
          createdByName={createdByName}
          draft={modal.draft}
          onClose={() => setModal(null)}
          onSaved={data.refresh}
        />
      )}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card w-full max-w-md rounded-xl p-5 space-y-3 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">{CONFIRM_TEXT[confirm.action].title}</h3>
            <p className="text-sm text-muted-foreground">
              {confirm.journals.length} jurnal akan {ACTION_LABEL[confirm.action].toLowerCase()}:{' '}
              <span className="font-mono text-xs">{confirm.journals.slice(0, 3).map((j) => j.jeId).join(', ')}{confirm.journals.length > 3 ? ` +${confirm.journals.length - 3} lagi` : ''}</span>
            </p>
            {confirm.action === 'post' && (
              <>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Jurnal yang diposting langsung masuk Buku Besar & Financial Statements dan tidak bisa diedit lagi.
                  Jurnal tidak balance atau berakun di luar COA klien akan dilewati.
                </p>
                <div>
                  <label className="text-[11px] text-muted-foreground">Tanggal posting (opsional, default = tanggal jurnal)</label>
                  <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} className="w-full mt-0.5 px-2 py-1.5 text-sm bg-background border border-border rounded-md" />
                </div>
              </>
            )}
            {confirm.action === 'reject' && (
              <div>
                <label className="text-[11px] text-muted-foreground">Alasan penolakan</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full mt-0.5 px-2 py-1.5 text-sm bg-background border border-border rounded-md" />
              </div>
            )}
            {confirm.action === 'delete' && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">Jurnal yang dihapus tidak tampil lagi di halaman ini.</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setConfirm(null)} className="flex-1 py-2 border border-border rounded-lg text-xs font-medium hover:bg-muted">Batal</button>
              <button onClick={submitConfirm} disabled={busy} className={`flex-1 py-2 text-white rounded-lg text-xs font-semibold disabled:opacity-50 ${CONFIRM_TEXT[confirm.action].tone}`}>
                {busy ? 'Memproses…' : CONFIRM_TEXT[confirm.action].button}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { ...data, journals, busy, openNew, act, clearNotes, exportCsv, dialogs };
}

export type OtherWorkspace = ReturnType<typeof useOtherWorkspace>;

const ACTION_STYLE: Record<OtherAction, { icon: React.ReactNode; cls: string }> = {
  edit: { icon: <Pencil size={12} />, cls: 'border-border hover:bg-muted text-foreground' },
  approve: { icon: <CheckCircle2 size={12} />, cls: 'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700' },
  post: { icon: <Send size={12} />, cls: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
  reject: { icon: <XCircle size={12} />, cls: 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700' },
  reopen: { icon: <RotateCcw size={12} />, cls: 'border-border hover:bg-muted text-foreground' },
  delete: { icon: <Trash2 size={12} />, cls: 'border-rose-200 hover:bg-rose-50 text-rose-600' },
};

/** Deretan tombol aksi untuk satu jurnal (hanya yang diizinkan status-nya). */
export function OtherActionButtons({
  journal,
  ws,
  only,
  compact = false,
}: {
  journal: OtherJournal;
  ws: OtherWorkspace;
  only?: OtherAction[];
  compact?: boolean;
}) {
  const actions = allowedActions(journal).filter((a) => !only || only.includes(a));
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          disabled={ws.busy}
          onClick={() => ws.act(a, [journal])}
          title={ACTION_LABEL[a]}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium disabled:opacity-50 ${ACTION_STYLE[a].cls}`}
        >
          {ACTION_STYLE[a].icon}
          {!compact && ACTION_LABEL[a]}
        </button>
      ))}
    </div>
  );
}
