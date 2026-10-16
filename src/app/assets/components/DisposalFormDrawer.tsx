'use client';

// Form New / Edit Disposal: pilih aset aktif, tanggal, metode, hasil penjualan
// + akun hasil dan akun laba/rugi pelepasan. Simpan draft atau langsung ajukan.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  DISPOSAL_METHOD_LABEL, fetchFaAccounts, fetchRegister, saveDisposal, useFaData, type CoaAccount, type Disposal, type DisposalMethod, type Register,
} from '@/lib/fixedAssetsStore';
import { btnOutline, btnPrimary, Drawer, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, isPnlAccount } from '@/components/shared/moduleUi';

export default function DisposalFormDrawer({ clientId, asOf, disposal, assetId, onClose }: {
  clientId: string; asOf: string; disposal: Disposal | null; assetId?: string; onClose: () => void;
}) {
  const reg = useFaData<Register | null>(`reg:${clientId}:${asOf}`, s => fetchRegister(clientId, asOf, s), null);
  const akun = useFaData<CoaAccount[]>(`acc:${clientId}`, s => fetchFaAccounts(clientId, s), []);
  const [f, setF] = useState({
    asset_id: disposal?.asset_id ?? assetId ?? '', disposal_date: disposal?.disposal_date ?? todayIso(),
    method: (disposal?.method ?? 'sold') as DisposalMethod, reason: disposal?.reason ?? '', counterparty: disposal?.counterparty ?? '',
    proceeds: disposal ? String(disposal.proceeds || '') : '', proceeds_coa_id: disposal?.proceeds_coa_id ?? null as string | null,
    gain_loss_coa_id: disposal?.gain_loss_coa_id ?? null as string | null,
  });
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));

  const pilihan = useMemo(() => (reg.data?.assets ?? []).filter(a => a.status !== 'disposed' || a.id === f.asset_id), [reg.data, f.asset_id]);
  const aset = pilihan.find(a => a.id === f.asset_id);
  const hasil = Number(f.proceeds || 0);
  const laba = aset ? hasil - aset.net_book_value : 0;
  const akunAktif = useMemo(() => akun.data.filter(a => a.is_active), [akun.data]);
  // Default akun laba/rugi: akun standar rugi pelepasan aset kalau ada.
  const defaultLaba = akun.data.find(a => a.standard_code === 'std_other_expense_loss_disposal')?.id ?? null;

  const simpan = async (submit: boolean) => {
    if (!f.asset_id) {
      toast.error('Choose the asset to dispose.');
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    try {
      const r = await saveDisposal(clientId, {
        asset_id: f.asset_id, disposal_date: f.disposal_date, method: f.method, reason: f.reason.trim() || null,
        counterparty: f.counterparty.trim() || null, proceeds: hasil, proceeds_coa_id: hasil > 0 ? f.proceeds_coa_id : null,
        gain_loss_coa_id: f.gain_loss_coa_id ?? defaultLaba, submit,
      }, disposal?.id);
      toast.success(r.message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer open onClose={onClose} title={disposal ? `Edit ${disposal.disposal_no}` : 'New Disposal'} subtitle="Record the sale, scrapping, loss or transfer of a fixed asset"
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" disabled={!!busy} onClick={() => simpan(false)} className={btnOutline}>{busy === 'draft' && <Loader2 size={14} className="animate-spin" />} Save Draft</button>
        <button type="button" disabled={!!busy} onClick={() => simpan(true)} className={btnPrimary}>{busy === 'submit' && <Loader2 size={14} className="animate-spin" />} Submit for Approval</button>
      </>}>
      <FormField label="Asset" required>
        <select value={f.asset_id} onChange={e => set('asset_id', e.target.value)} className={inputCls}>
          <option value="">{reg.loading ? 'Loading...' : 'Select asset'}</option>
          {pilihan.map(a => <option key={a.id} value={a.id}>{a.asset_code} · {a.name}</option>)}
        </select>
      </FormField>
      {aset && (
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center text-xs">
          <div><p className="text-muted-foreground">Cost</p><p className="font-semibold">{rupiah(aset.cost)}</p></div>
          <div><p className="text-muted-foreground">Accumulated</p><p className="font-semibold">{rupiah(aset.accumulated_depreciation)}</p></div>
          <div><p className="text-muted-foreground">Net Book Value</p><p className="font-semibold">{rupiah(aset.net_book_value)}</p></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Disposal Date" required hint="Planned date while pending; the journal is dated on this day">
          <input type="date" value={f.disposal_date} min={aset?.acquisition_date ?? undefined} onChange={e => set('disposal_date', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="Method" required>
          <select value={f.method} onChange={e => set('method', e.target.value as DisposalMethod)} className={inputCls}>
            {(Object.keys(DISPOSAL_METHOD_LABEL) as DisposalMethod[]).map(m => <option key={m} value={m}>{DISPOSAL_METHOD_LABEL[m]}</option>)}
          </select>
        </FormField>
        <FormField label="Sale Proceeds (IDR)">
          <input type="number" min={0} step="0.01" value={f.proceeds} onChange={e => set('proceeds', e.target.value)} className={inputCls} placeholder="0" />
        </FormField>
        <FormField label="Buyer / Recipient"><input value={f.counterparty} onChange={e => set('counterparty', e.target.value)} className={inputCls} /></FormField>
      </div>
      {hasil > 0 && (
        <FormField label="Proceeds Account" required hint="Cash/bank account receiving the money, or a receivable account">
          <AccountSelect accounts={akunAktif} value={f.proceeds_coa_id} onChange={v => set('proceeds_coa_id', v)} />
        </FormField>
      )}
      <FormField label="Gain / Loss on Disposal Account" hint={aset ? `Estimated ${laba >= 0 ? 'gain' : 'loss'}: ${rupiah(Math.abs(laba))}` : undefined}>
        <AccountSelect accounts={akunAktif} value={f.gain_loss_coa_id ?? defaultLaba} onChange={v => set('gain_loss_coa_id', v)} filter={isPnlAccount} />
      </FormField>
      <FormField label="Reason / Notes"><textarea rows={3} value={f.reason} onChange={e => set('reason', e.target.value)} className={inputCls} maxLength={2000} /></FormField>
    </Drawer>
  );
}
