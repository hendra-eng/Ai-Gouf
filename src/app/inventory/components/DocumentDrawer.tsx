'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { fmtDate, fmtDateTime, rupiah } from '@/lib/receivablesPayablesStore';
import {
  deleteDocument, DOC_STATUS_LABEL, DOC_STATUS_STYLE, DOC_TYPE_LABEL, fetchDocument, postDocument, qty, REASON_LABEL, useInvData, voidDocument, type StockDoc,
} from '@/lib/inventoryStore';
import { btnSmall, Drawer, Field } from '@/components/arap/arapUi';
import { JournalLines, Pill, ReasonDialog } from '@/components/shared/moduleUi';
import type { InvActions } from './InventoryWorkspace';

export default function DocumentDrawer({ clientId, docId, actions, onClose }: { clientId: string; docId: string; actions: InvActions; onClose: () => void }) {
  const d = useInvData<StockDoc | null>(`doc:${clientId}:${docId}`, s => fetchDocument(clientId, docId, s), null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const x = d.data;

  const jalan = async (label: string, fn: () => Promise<{ message: string }>, tutup = false) => {
    setBusy(label);
    try { toast.success((await fn()).message); if (tutup) onClose(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Drawer open onClose={onClose} title={x ? `${x.doc_no} · ${DOC_TYPE_LABEL[x.doc_type]}` : 'Loading...'} subtitle={x ? `${fmtDate(x.doc_date)} · ${x.warehouse}${x.to_warehouse ? ` → ${x.to_warehouse}` : ''}` : undefined}
      footer={x && <>
        {x.status === 'draft' && <button type="button" className={`${btnSmall} text-rose-600`} disabled={!!busy} onClick={() => window.confirm(`Delete draft ${x.doc_no}?`) && jalan('del', () => deleteDocument(clientId, x.id), true)}>Delete</button>}
        {x.status === 'draft' && <button type="button" className={btnSmall} onClick={() => actions.editDocument(x)}>Edit</button>}
        {x.status === 'draft' && (
          <button type="button" disabled={!!busy} onClick={() => jalan('post', () => postDocument(clientId, x.id))} className={`${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]`}>
            {busy === 'post' && <Loader2 size={12} className="animate-spin" />} Post
          </button>
        )}
        {x.status === 'posted' && <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => setVoidOpen(true)}>Void</button>}
      </>}>
      {d.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{d.error}</p>}
      {!x ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <Pill label={DOC_STATUS_LABEL[x.status]} style={DOC_STATUS_STYLE[x.status]} />
        <div className="grid grid-cols-2 gap-4">
          {x.reason && <Field label="Reason">{REASON_LABEL[x.reason]}</Field>}
          <Field label="Reference">{x.source_ref ?? '—'}{x.source_type ? ` (${x.source_type})` : ''}</Field>
          <Field label="Total Quantity">{qty(x.total_qty)}</Field>
          <Field label="Total Value">{rupiah(x.total_value)}</Field>
          <Field label="Created">{x.created_by_name ?? '—'} · {fmtDateTime(x.created_at)}</Field>
          <Field label="Posted">{x.posted_by_name ?? '—'} · {fmtDateTime(x.posted_at)}</Field>
        </div>
        {x.notes && <Field label="Notes">{x.notes}</Field>}
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1.5">Item</th>{x.doc_type === 'adjustment' && <th className="py-1.5 text-right">Book / Counted</th>}
            <th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Unit Cost</th><th className="py-1.5 text-right">Value</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {x.lines?.map(l => (
              <tr key={l.id}>
                <td className="py-1.5 pr-2"><b>{l.item_code}</b> · {l.item_name}</td>
                {x.doc_type === 'adjustment' && <td className="py-1.5 text-right">{l.counted_qty !== null ? `${qty(l.system_qty)} / ${qty(l.counted_qty)}` : '—'}</td>}
                <td className={`py-1.5 text-right ${l.quantity < 0 ? 'text-rose-600' : ''}`}>{qty(l.quantity)} {l.unit}</td>
                <td className="py-1.5 text-right">{l.unit_cost != null ? rupiah(l.unit_cost) : x.status === 'draft' ? 'avg' : '—'}</td>
                <td className="py-1.5 text-right">{l.amount != null ? rupiah(l.amount) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {x.journal ? (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Journal {x.journal.journal_no} {x.journal.status === 'reversed' && <span className="text-xs font-normal text-rose-600">(reversed {fmtDate(x.journal.reversal_date)})</span>}</h4>
            <JournalLines lines={x.journal.lines ?? []} />
          </div>
        ) : x.status === 'posted' && <p className="text-xs text-muted-foreground">No journal for this document (stock only).</p>}
        {x.status === 'void' && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">Voided on {fmtDate(x.void_date)} by {x.voided_by_name ?? '—'}. Reason: {x.void_reason}</p>}
      </>}
      <ReasonDialog open={voidOpen} title={`Void ${x?.doc_no ?? ''}`} withDate minDate={x?.doc_date} confirmLabel="Void"
        subtitle="Reversing stock movements are recorded on the void date and the journal (if any) is reversed." onClose={() => setVoidOpen(false)}
        onConfirm={async (reason, date) => {
          try { toast.success((await voidDocument(clientId, x!.id, reason, date)).message); } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </Drawer>
  );
}
