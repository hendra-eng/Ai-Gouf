'use client';

// DATA LAYER HALAMAN OTHER (6 tab).
//
// Jurnal Other disimpan di tabel Journal Entry (financial_transaction_journal_
// entry_drafts + _draft_lines) dengan source_type = "Other" -- lihat
// backend/modules/transactions/journal_entry_v1.py. Begitu berstatus 'posted',
// jurnal otomatis dibaca Buku Besar / Financial Statements.
//
// Hook useOtherData() mengubah draft + barisnya menjadi Transaction[] (1 baris
// jurnal = 1 Transaction) supaya seluruh logika pengelompokan/analitik yang
// sudah ada (otherJournals.ts, groupAnalytics.ts) tetap dipakai apa adanya.
//
// Pemetaan status backend -> Transaction.status:
//   draft / pending / exception -> 'Draft'      (menunggu approval)
//   approved                    -> 'Unposted'   (disetujui, siap diposting)
//   posted                      -> 'Posted'
//   rejected                    -> 'Voided'     (ditolak; bisa dibuka lagi)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import {
  listJeDraftsWithLines,
  runJeDraftAction,
  onJeChanged,
  type BackendJeDraftWithLines,
  type JeStatusAction,
} from '@/lib/journalEntryStore';
import type { Transaction } from '../../components/transactionData';

export const OTHER_SOURCE_TYPE = 'Other';

export function mapOtherStatus(raw: string | null | undefined): Transaction['status'] {
  switch ((raw || '').toLowerCase()) {
    case 'approved': return 'Unposted';
    case 'posted': return 'Posted';
    case 'rejected': return 'Voided';
    default: return 'Draft';
  }
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

export function transactionsFromOtherDrafts(drafts: BackendJeDraftWithLines[]): Transaction[] {
  const out: Transaction[] = [];
  drafts.forEach((d) => {
    (d.lines || []).forEach((l) => {
      const debit = num(l.debit);
      const credit = num(l.credit);
      out.push({
        id: `other-${l.id}`,
        date: d.entry_date,
        txId: `${d.je_number}-${l.line_no}`,
        accountCode: l.account_code || '—',
        accountName: l.account_name || '—',
        description: l.description || d.description || '—',
        debit,
        credit,
        reference: d.source_reference || d.je_number,
        party: d.source_reference || d.created_by_name || '—',
        category: d.period_label || 'Other',
        type: debit > 0 ? 'debit' : 'credit',
        status: mapOtherStatus(d.status),
        jeId: d.je_number,
        notes: d.notes || undefined,
        voucherNo: d.je_number,
        saldoAkhir: 0,
        cek: false,
        sourceModule: 'GENERAL_JOURNAL',
        standardAccountCode: l.account_code || undefined,
        otherDraftId: d.id,
        otherStatus: (d.status || '').toLowerCase(),
      } as Transaction);
    });
  });
  return out;
}

export interface OtherActionOutcome {
  done: number;
  skipped: { je_number: string | null; reason: string }[];
}

export function useOtherData() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const [drafts, setDrafts] = useState<BackendJeDraftWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!clientId) { setDrafts([]); setLoading(false); return; }
    listJeDraftsWithLines(clientId, OTHER_SOURCE_TYPE)
      .then((rows) => { setDrafts(rows); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat jurnal Other'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    refresh();
    return onJeChanged(refresh);
  }, [refresh]);

  const transactions = useMemo(() => transactionsFromOtherDrafts(drafts), [drafts]);

  /** Jalankan aksi status massal + tampilkan toast ringkasan. Mengembalikan jumlah yang berhasil. */
  const runAction = useCallback(
    async (
      action: JeStatusAction,
      draftIds: string[],
      opts: { postingDate?: string; reason?: string } = {},
    ): Promise<OtherActionOutcome> => {
      const ids = Array.from(new Set(draftIds.filter(Boolean)));
      if (ids.length === 0) {
        toast.error('Pilih minimal satu jurnal yang memiliki data di server.');
        return { done: 0, skipped: [] };
      }
      const label: Record<JeStatusAction, string> = {
        approve: 'disetujui', post: 'diposting', reject: 'ditolak', reopen: 'dibuka kembali sebagai draft', 'bulk-delete': 'dihapus',
      };
      try {
        const hasil = await runJeDraftAction(action, ids, opts);
        const done = hasil.done.length;
        if (done > 0) toast.success(`${done} jurnal ${label[action]}.`);
        if (hasil.skipped.length > 0) {
          const first = hasil.skipped[0];
          toast.warning(`${hasil.skipped.length} jurnal dilewati.`, {
            description: `${first.je_number || first.id}: ${first.reason}`,
            duration: 8000,
          });
        }
        if (done === 0 && hasil.skipped.length === 0) toast.info('Tidak ada perubahan.');
        refresh();
        return { done, skipped: hasil.skipped };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Aksi gagal dijalankan.');
        return { done: 0, skipped: [] };
      }
    },
    [refresh],
  );

  return { clientId, drafts, transactions, loading, error, refresh, runAction };
}
