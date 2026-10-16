'use client';

// Run Depreciation: pilih bulan, lihat preview per aset, lalu buat batch draft
// (Supervisor+) atau langsung post ke buku besar (Manager+).

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { rupiah } from '@/lib/receivablesPayablesStore';
import { createRun, fetchDepreciation, METHOD_LABEL, previewDepreciation, type DepPreview } from '@/lib/fixedAssetsStore';
import { btnOutline, btnPrimary, inputCls } from '@/components/arap/arapUi';
import { FormField, Modal } from '@/components/shared/moduleUi';

export default function RunDepreciationModal({ clientId, asOf, onClose }: { clientId: string; asOf: string; onClose: () => void }) {
  const [bulan, setBulan] = useState('');
  const [catatan, setCatatan] = useState('');
  const [preview, setPreview] = useState<DepPreview | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [busy, setBusy] = useState<null | 'draft' | 'post'>(null);

  useEffect(() => {
    fetchDepreciation(clientId, asOf).then(d => setBulan(d.next_run.period.slice(0, 7))).catch(() => setBulan(asOf.slice(0, 7)));
  }, [clientId, asOf]);

  useEffect(() => {
    if (!bulan) return;
    let batal = false;
    setMemuat(true);
    previewDepreciation(clientId, `${bulan}-01`)
      .then(r => { if (!batal) setPreview(r.data); })
      .catch(e => { if (!batal) { setPreview(null); toast.error((e as Error).message); } })
      .finally(() => { if (!batal) setMemuat(false); });
    return () => { batal = true; };
  }, [clientId, bulan]);

  const buat = async (post: boolean) => {
    setBusy(post ? 'post' : 'draft');
    try {
      const r = await createRun(clientId, `${bulan}-01`, catatan.trim() || null, post);
      toast.success(post ? `${r.data.run_no} posted to the ledger.` : `${r.data.run_no} created as draft.`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ada = (preview?.lines.length ?? 0) > 0;
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title="Run Depreciation"
      subtitle="One journal per asset: Dr depreciation expense / Cr accumulated depreciation, dated at month end. Batches must be run in period order."
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" disabled={!ada || !!busy} onClick={() => buat(false)} className={btnOutline}>{busy === 'draft' && <Loader2 size={14} className="animate-spin" />} Create Draft Batch</button>
        <button type="button" disabled={!ada || !!busy} onClick={() => buat(true)} className={btnPrimary}>{busy === 'post' && <Loader2 size={14} className="animate-spin" />} Create &amp; Post</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Period"><input type="month" value={bulan} onChange={e => setBulan(e.target.value)} className={inputCls} /></FormField>
        <FormField label="Notes"><input value={catatan} onChange={e => setCatatan(e.target.value)} className={inputCls} maxLength={1000} /></FormField>
      </div>
      {memuat ? <div className="h-32 animate-pulse rounded-xl bg-slate-50" /> : preview && (
        <>
          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span>{preview.lines.length} asset(s) eligible</span><b>{rupiah(preview.total)}</b>
          </div>
          {preview.lines.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2">Asset</th><th className="px-3 py-2">Method</th><th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Accum. Before</th><th className="px-3 py-2 text-right">Depreciation</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {preview.lines.map(l => (
                    <tr key={l.asset_id}>
                      <td className="px-3 py-1.5"><b>{l.asset_code}</b> · {l.name}<span className="block text-[10px] text-muted-foreground">Dr {l.expense_account} / Cr {l.accum_account}</span></td>
                      <td className="px-3 py-1.5">{METHOD_LABEL[l.method]}</td>
                      <td className="px-3 py-1.5 text-right">{rupiah(l.cost)}</td>
                      <td className="px-3 py-1.5 text-right">{rupiah(l.accumulated_before)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{rupiah(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.issues.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-semibold">{preview.issues.length} asset(s) skipped (need review):</p>
              <ul className="mt-1 list-disc pl-4">
                {preview.issues.slice(0, 8).map(i => <li key={i.asset_id}>{i.asset_code} {i.name}: {i.issues.join(', ')}</li>)}
              </ul>
            </div>
          )}
          {!ada && !preview.issues.length && <p className="text-center text-xs text-muted-foreground">No assets need depreciation in this period (already run, fully depreciated, or not yet acquired).</p>}
        </>
      )}
    </Modal>
  );
}
