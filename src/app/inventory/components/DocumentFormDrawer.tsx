'use client';

// Form dokumen stok: Opening Balance, Goods Receipt (bisa dari Purchase posted),
// Goods Issue (bisa dari invoice Sales posted), Adjustment (perubahan qty atau
// hasil hitung fisik), Transfer antar gudang. Save Draft atau Save & Post.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Info, Loader2, Plus, Trash2 } from 'lucide-react';
import { fmtDate, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  DOC_TYPE_LABEL, fetchInvAccounts, fetchItems, fetchPurchaseSources, fetchSalesSources, fetchWarehouses, qty, REASON_LABEL, saveDocument, useInvData,
  type AdjustmentReason, type CoaAccount, type DocInput, type DocType, type SourceDoc, type StockDoc, type Warehouse,
} from '@/lib/inventoryStore';
import { btnOutline, btnPrimary, btnSmall, Drawer, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField } from '@/components/shared/moduleUi';

interface Baris { key: number; item_id: string; quantity: string; counted_qty: string; unit_cost: string; source_line_id: string | null; info?: string }

let urut = 0;
const barisBaru = (item_id = ''): Baris => ({ key: ++urut, item_id, quantity: '', counted_qty: '', unit_cost: '', source_line_id: null });

export default function DocumentFormDrawer({ clientId, docType, doc, presetItemId, asOf, onClose, onSetup }: {
  clientId: string; docType: DocType; doc: StockDoc | null; presetItemId?: string; asOf: string; onClose: () => void; onSetup: () => void;
}) {
  const items = useInvData(`items:${clientId}:${asOf}`, s => fetchItems(clientId, asOf, s), null as Awaited<ReturnType<typeof fetchItems>> | null);
  const gudang = useInvData<Warehouse[]>(`wh:${clientId}`, s => fetchWarehouses(clientId, s), []);
  const akun = useInvData<CoaAccount[]>(`iacc:${clientId}`, s => fetchInvAccounts(clientId, s), []);
  const sumber = useInvData<SourceDoc[]>(docType === 'receipt' || docType === 'issue' ? `src:${clientId}:${docType}` : null,
    s => (docType === 'receipt' ? fetchPurchaseSources(clientId, s) : fetchSalesSources(clientId, s)), []);

  const [h, setH] = useState({
    doc_date: doc?.doc_date ?? todayIso(), warehouse_id: doc?.warehouse_id ?? '', to_warehouse_id: doc?.to_warehouse_id ?? '',
    reason: (doc?.reason ?? (docType === 'adjustment' ? 'stock_count' : null)) as AdjustmentReason | null,
    source_id: doc?.source_id ?? '', source_ref: doc?.source_ref ?? '', notes: doc?.notes ?? '',
    post_journal: doc ? doc.post_journal : docType === 'issue', offset_coa_id: doc?.offset_coa_id ?? null as string | null,
  });
  const [modeHitung, setModeHitung] = useState(docType === 'adjustment' && (doc ? (doc.lines ?? []).some(l => l.counted_qty !== null) : true));
  const [baris, setBaris] = useState<Baris[]>(() => doc?.lines?.length
    ? doc.lines.map(l => ({ key: ++urut, item_id: l.item_id, quantity: String(l.quantity), counted_qty: l.counted_qty != null ? String(l.counted_qty) : '',
      unit_cost: l.unit_cost != null ? String(l.unit_cost) : '', source_line_id: l.source_line_id }))
    : [barisBaru(presetItemId)]);
  const [busy, setBusy] = useState<null | 'draft' | 'post'>(null);

  const daftarItem = useMemo(() => items.data?.items ?? [], [items.data]);
  const petaItem = useMemo(() => new Map(daftarItem.map(i => [i.id, i])), [daftarItem]);
  const gudangAktif = gudang.data.filter(w => w.is_active || w.id === h.warehouse_id || w.id === h.to_warehouse_id);
  useEffect(() => {
    if (!h.warehouse_id && gudang.data.length) {
      const pref = presetItemId ? petaItem.get(presetItemId)?.default_warehouse_id : null;
      setH(x => ({ ...x, warehouse_id: pref || gudang.data.find(w => w.is_active)?.id || '' }));
    }
  }, [gudang.data, h.warehouse_id, presetItemId, petaItem]);

  const butuhBiaya = docType === 'opening' || docType === 'receipt';
  const stokDi = (itemId: string, wh: string) => petaItem.get(itemId)?.stock_by_warehouse.find(w => w.warehouse_id === wh)?.qty ?? 0;
  const ubah = (key: number, patch: Partial<Baris>) => setBaris(b => b.map(x => (x.key === key ? { ...x, ...patch } : x)));

  const muatSumber = (id: string) => {
    const s = sumber.data.find(x => x.id === id);
    setH(x => ({ ...x, source_id: id, source_ref: s?.number ?? '', post_journal: docType === 'issue' }));
    if (!s) return;
    const b = s.lines.filter(l => l.open_qty > 0).map(l => ({
      ...barisBaru(l.matched_item_id ?? ''), quantity: String(l.open_qty), unit_cost: l.unit_cost != null ? String(Math.round(l.unit_cost * 100) / 100) : '',
      source_line_id: l.line_id, info: `${l.item_code ? `${l.item_code} · ` : ''}${l.description}${l.unit ? ` (${l.unit})` : ''}`,
    }));
    setBaris(b.length ? b : [barisBaru()]);
    const tanpa = b.filter(x => !x.item_id).length;
    if (tanpa) toast.message(`${tanpa} line(s) could not be matched to an item — pick the item or remove the line.`);
  };

  const simpan = async (post: boolean) => {
    const valid = baris.filter(b => b.item_id);
    if (!h.warehouse_id || !valid.length) { toast.error('Choose the warehouse and at least one item.'); return; }
    setBusy(post ? 'post' : 'draft');
    try {
      const body: DocInput = {
        doc_type: docType, doc_date: h.doc_date, warehouse_id: h.warehouse_id, to_warehouse_id: docType === 'transfer' ? h.to_warehouse_id || null : null,
        reason: docType === 'adjustment' ? h.reason : null, source_type: h.source_id ? (docType === 'receipt' ? 'purchase' : 'sales') : null,
        source_id: h.source_id || null, source_ref: h.source_ref.trim() || null, notes: h.notes.trim() || null,
        post_journal: h.post_journal, offset_coa_id: h.offset_coa_id, post_now: post,
        lines: valid.map(b => ({
          item_id: b.item_id,
          quantity: docType === 'adjustment' && modeHitung ? 0 : Number(b.quantity || 0),
          counted_qty: docType === 'adjustment' && modeHitung ? Number(b.counted_qty || 0) : null,
          unit_cost: b.unit_cost.trim() === '' ? null : Number(b.unit_cost), source_line_id: b.source_line_id,
        })),
      };
      const r = await saveDocument(clientId, body, doc?.id);
      toast.success(r.message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const total = baris.reduce((n, b) => n + (Number(b.quantity || 0) && Number(b.unit_cost || 0) ? Math.abs(Number(b.quantity)) * Number(b.unit_cost) : 0), 0);

  return (
    <Drawer open onClose={onClose} title={doc ? `Edit ${doc.doc_no}` : `New ${DOC_TYPE_LABEL[docType]}`}
      subtitle={{ opening: 'Starting quantity and cost per item (no journal — the GL value comes from Opening Balance).',
        receipt: 'Goods received into a warehouse, from a posted purchase or manual.', issue: 'Goods leaving a warehouse, for a posted sales invoice or internal use.',
        adjustment: 'Correct the book quantity (stock count, damage, expiry...). Posts a journal against the adjustment account.',
        transfer: 'Move stock between warehouses (no journal).' }[docType]}
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" disabled={!!busy} onClick={() => simpan(false)} className={btnOutline}>{busy === 'draft' && <Loader2 size={14} className="animate-spin" />} Save Draft</button>
        <button type="button" disabled={!!busy} onClick={() => simpan(true)} className={btnPrimary}>{busy === 'post' && <Loader2 size={14} className="animate-spin" />} Save &amp; Post</button>
      </>}>
      {!gudang.loading && !gudang.data.length && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">No warehouse yet. <button type="button" onClick={onSetup} className="font-semibold underline">Create one first.</button></p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required><input type="date" value={h.doc_date} onChange={e => setH({ ...h, doc_date: e.target.value })} className={inputCls} /></FormField>
        <FormField label={docType === 'transfer' ? 'From Warehouse' : 'Warehouse'} required>
          <select value={h.warehouse_id} onChange={e => setH({ ...h, warehouse_id: e.target.value })} className={inputCls}>
            <option value="">Select</option>{gudangAktif.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </FormField>
        {docType === 'transfer' && (
          <FormField label="To Warehouse" required>
            <select value={h.to_warehouse_id} onChange={e => setH({ ...h, to_warehouse_id: e.target.value })} className={inputCls}>
              <option value="">Select</option>{gudangAktif.filter(w => w.id !== h.warehouse_id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </FormField>
        )}
        {docType === 'adjustment' && (
          <FormField label="Reason" required>
            <select value={h.reason ?? ''} onChange={e => setH({ ...h, reason: e.target.value as AdjustmentReason })} className={inputCls}>
              {(Object.keys(REASON_LABEL) as AdjustmentReason[]).map(r => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </FormField>
        )}
        {(docType === 'receipt' || docType === 'issue') && (
          <FormField label={docType === 'receipt' ? 'From Purchase (optional)' : 'For Sales Invoice (optional)'} className="col-span-2"
            hint={docType === 'issue' ? 'Only invoices created with item lines (Accounts Receivable > Create Invoice) are listed.' : 'Posted purchases with quantities not yet received.'}>
            <select value={h.source_id} onChange={e => muatSumber(e.target.value)} className={inputCls}>
              <option value="">{sumber.loading ? 'Loading...' : `Manual — no ${docType === 'receipt' ? 'purchase' : 'invoice'}`}</option>
              {sumber.data.map(s => <option key={s.id} value={s.id}>{s.number} · {fmtDate(s.date)} · {s.party ?? '—'} · open {qty(s.open_qty)}</option>)}
            </select>
          </FormField>
        )}
        <FormField label="Reference" className={docType === 'adjustment' || docType === 'transfer' ? 'col-span-2' : 'col-span-2'}>
          <input value={h.source_ref} onChange={e => setH({ ...h, source_ref: e.target.value })} className={inputCls} maxLength={100} placeholder="PO / SO / delivery note no." />
        </FormField>
      </div>

      {docType === 'adjustment' && (
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          <button type="button" onClick={() => setModeHitung(true)} className={`flex-1 rounded-lg px-3 py-1.5 ${modeHitung ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>Counted quantity (stock count)</button>
          <button type="button" onClick={() => setModeHitung(false)} className={`flex-1 rounded-lg px-3 py-1.5 ${!modeHitung ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>Quantity change (+/−)</button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Items</h4>
          <button type="button" onClick={() => setBaris(b => [...b, barisBaru()])} className={btnSmall}><Plus size={13} /> Add Line</button>
        </div>
        {baris.map(b => {
          const it = petaItem.get(b.item_id);
          const stok = b.item_id && h.warehouse_id ? stokDi(b.item_id, h.warehouse_id) : null;
          return (
            <div key={b.key} className="space-y-2 rounded-xl border border-border p-3">
              {b.info && <p className="text-[11px] text-muted-foreground">Source line: {b.info}</p>}
              <div className="flex gap-2">
                <select value={b.item_id} onChange={e => ubah(b.key, { item_id: e.target.value })} className={`${inputCls} flex-1`}>
                  <option value="">Select item</option>
                  {daftarItem.filter(i => i.status === 'active' || i.id === b.item_id).map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
                </select>
                <button type="button" onClick={() => setBaris(x => (x.length > 1 ? x.filter(y => y.key !== b.key) : [barisBaru()]))} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" aria-label="Remove line"><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {docType === 'adjustment' && modeHitung ? (
                  <FormField label={`Counted Qty${it ? ` (${it.unit})` : ''}`} hint={stok !== null ? `Book: ${qty(stok)}` : undefined}>
                    <input type="number" min={0} value={b.counted_qty} onChange={e => ubah(b.key, { counted_qty: e.target.value })} className={inputCls} />
                  </FormField>
                ) : (
                  <FormField label={`${docType === 'adjustment' ? 'Qty Change (+/−)' : 'Quantity'}${it ? ` (${it.unit})` : ''}`}
                    hint={stok !== null && docType !== 'opening' && docType !== 'receipt' ? `Available: ${qty(stok)}` : undefined}>
                    <input type="number" value={b.quantity} onChange={e => ubah(b.key, { quantity: e.target.value })} className={inputCls} />
                  </FormField>
                )}
                {(butuhBiaya || docType === 'adjustment') && (
                  <FormField label={butuhBiaya ? 'Unit Cost (IDR)' : 'Unit Cost (for increases)'} hint={!butuhBiaya ? `Empty = average${it ? ` ${rupiah(it.avg_cost)}` : ''}` : undefined}>
                    <input type="number" min={0} step="0.01" value={b.unit_cost} onChange={e => ubah(b.key, { unit_cost: e.target.value })} className={inputCls}
                      placeholder={it?.purchase_price != null ? String(it.purchase_price) : ''} />
                  </FormField>
                )}
                {(docType === 'issue' || docType === 'transfer') && it && (
                  <div className="self-end pb-2 text-xs text-muted-foreground">Valued at average cost {rupiah(it.avg_cost)}</div>
                )}
              </div>
            </div>
          );
        })}
        {butuhBiaya && total > 0 && <p className="text-right text-sm">Total value: <b>{rupiah(total)}</b></p>}
      </div>

      {docType === 'receipt' && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={h.post_journal} onChange={e => setH({ ...h, post_journal: e.target.checked })} className="mt-1" />
            <span><b>Post receipt journal</b><span className="block text-xs text-muted-foreground">Dr inventory account / Cr the account below.</span></span>
          </label>
          {h.source_id && h.post_journal && (
            <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><Info size={14} className="shrink-0" />The linked purchase is already posted to the ledger. Posting another journal books the cost twice.</p>
          )}
          {h.post_journal && <FormField label="Credit Account" required><AccountSelect accounts={akun.data.filter(a => a.is_active)} value={h.offset_coa_id} onChange={v => setH({ ...h, offset_coa_id: v })} /></FormField>}
        </div>
      )}
      {docType === 'issue' && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={h.post_journal} onChange={e => setH({ ...h, post_journal: e.target.checked })} className="mt-1" />
            <span><b>Post COGS journal</b><span className="block text-xs text-muted-foreground">Dr COGS (category account, or the override below) / Cr inventory, at average cost.</span></span>
          </label>
          {h.post_journal && <FormField label="Debit Account Override (optional)"><AccountSelect accounts={akun.data.filter(a => a.is_active)} value={h.offset_coa_id} onChange={v => setH({ ...h, offset_coa_id: v })} placeholder="Use category COGS account" /></FormField>}
        </div>
      )}
      {docType === 'adjustment' && (
        <FormField label="Offset Account Override (optional)" hint="Default: the adjustment account of each item's category">
          <AccountSelect accounts={akun.data.filter(a => a.is_active)} value={h.offset_coa_id} onChange={v => setH({ ...h, offset_coa_id: v })} placeholder="Use category adjustment account" />
        </FormField>
      )}
      <FormField label="Notes"><textarea rows={2} value={h.notes} onChange={e => setH({ ...h, notes: e.target.value })} className={inputCls} maxLength={2000} /></FormField>
    </Drawer>
  );
}
