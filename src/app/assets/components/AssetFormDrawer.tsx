'use client';

// Form Add / Edit Asset. Default metode, umur, residu, dan akun diambil dari
// kategori; bisa ditimpa per aset. Jurnal perolehan opsional (Manager+) --
// hanya untuk aset yang belum tercatat lewat Purchase / Cash & Bank / Opening Balance.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Info, Loader2 } from 'lucide-react';
import { rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  fetchCategories, fetchFaAccounts, METHOD_LABEL, saveAsset, useFaData, type AssetInput, type Category, type CoaAccount, type DepMethod, type FixedAsset,
} from '@/lib/fixedAssetsStore';
import { btnOutline, btnPrimary, Drawer, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, isAccumAccount, isDepExpense, isPpeAccount } from '@/components/shared/moduleUi';

const kosong = (s: string) => (s.trim() ? s.trim() : null);

export default function AssetFormDrawer({ clientId, asset, onClose, onManageCategories }: {
  clientId: string; asset: FixedAsset | null; onClose: () => void; onManageCategories: () => void;
}) {
  const kategori = useFaData<Category[]>(`cat:${clientId}`, s => fetchCategories(clientId, s), []);
  const akun = useFaData<CoaAccount[]>(`acc:${clientId}`, s => fetchFaAccounts(clientId, s), []);
  const edit = !!asset;

  const [f, setF] = useState({
    asset_code: asset?.asset_code ?? '', name: asset?.name ?? '', description: asset?.description ?? '',
    category_id: asset?.category_id ?? '', acquisition_date: asset?.acquisition_date ?? todayIso(),
    depreciation_start_date: asset?.depreciation_start_date ?? '', cost: asset ? String(asset.original_cost) : '',
    residual_value: asset?.residual_value != null ? String(asset.residual_value) : '',
    useful_life_months: asset?.life_override ? String(asset.life_override) : '',
    depreciation_method: (asset?.method_override ?? '') as DepMethod | '',
    opening_accumulated_depreciation: asset ? String(asset.opening_accumulated_depreciation || '') : '',
    location: asset?.location ?? '', branch: asset?.branch ?? '', department: asset?.department ?? '', custodian: asset?.custodian ?? '',
    serial_number: asset?.serial_number ?? '', supplier: asset?.supplier ?? '', reference: asset?.reference ?? '',
    status: (asset && asset.status !== 'disposed' ? asset.status : 'active') as AssetInput['status'],
    asset_coa_id: asset?.asset_coa_override ?? null as string | null, accum_coa_id: asset?.accum_coa_override ?? null as string | null,
    expense_coa_id: asset?.expense_coa_override ?? null as string | null,
    post_acquisition: false, acquisition_credit_coa_id: null as string | null,
  });
  const [akunTerbuka, setAkunTerbuka] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));

  const kat = kategori.data.find(c => c.id === f.category_id) ?? null;
  useEffect(() => {
    if (!f.category_id && kategori.data.length === 1) setF(x => ({ ...x, category_id: kategori.data[0].id }));
  }, [kategori.data, f.category_id]);

  const residuDefault = kat && f.cost ? (Number(f.cost) * kat.residual_rate) / 100 : 0;
  const metode = (f.depreciation_method || kat?.depreciation_method || 'none') as DepMethod;
  const umur = Number(f.useful_life_months) || kat?.useful_life_months || 0;
  const bulanan = metode === 'straight_line' && umur ? (Number(f.cost || 0) - Number(f.residual_value || residuDefault)) / umur : null;
  const akunLawan = useMemo(() => akun.data.filter(a => a.is_active), [akun.data]);

  const simpan = async () => {
    if (!f.name.trim() || !f.category_id || !f.acquisition_date || !(Number(f.cost) > 0)) {
      toast.error('Name, category, acquisition date and cost are required.');
      return;
    }
    if (f.post_acquisition && !f.acquisition_credit_coa_id) {
      toast.error('Choose the credit account for the acquisition journal.');
      return;
    }
    setBusy(true);
    try {
      const body: AssetInput = {
        asset_code: kosong(f.asset_code), name: f.name.trim(), description: kosong(f.description), category_id: f.category_id,
        acquisition_date: f.acquisition_date, depreciation_start_date: f.depreciation_start_date || null, cost: Number(f.cost),
        residual_value: f.residual_value === '' ? null : Number(f.residual_value),
        useful_life_months: f.useful_life_months ? Number(f.useful_life_months) : null,
        depreciation_method: f.depreciation_method || null,
        opening_accumulated_depreciation: Number(f.opening_accumulated_depreciation || 0),
        location: kosong(f.location), branch: kosong(f.branch), department: kosong(f.department), custodian: kosong(f.custodian),
        serial_number: kosong(f.serial_number), supplier: kosong(f.supplier), reference: kosong(f.reference), status: f.status,
        asset_coa_id: f.asset_coa_id, accum_coa_id: f.accum_coa_id, expense_coa_id: f.expense_coa_id,
        post_acquisition: f.post_acquisition, acquisition_credit_coa_id: f.acquisition_credit_coa_id,
      };
      const r = await saveAsset(clientId, body, asset?.id);
      toast.success(r.message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bolehJurnal = !asset?.acquisition_journal_id;

  return (
    <Drawer open onClose={onClose} title={edit ? `Edit ${asset!.asset_code}` : 'Add Asset'}
      subtitle={edit ? asset!.name : 'Register a new fixed asset'}
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save Asset</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Asset Code" hint="Leave empty to auto-number (FA-0001)">
          <input value={f.asset_code} onChange={e => set('asset_code', e.target.value)} className={inputCls} placeholder="Auto" maxLength={50} />
        </FormField>
        <FormField label="Status">
          <select value={f.status} onChange={e => set('status', e.target.value as AssetInput['status'])} className={inputCls}>
            <option value="active">Active</option><option value="under_construction">Under Construction</option><option value="inactive">Inactive</option>
          </select>
        </FormField>
        <FormField label="Asset Name" required className="col-span-2">
          <input value={f.name} onChange={e => set('name', e.target.value)} className={inputCls} maxLength={255} placeholder="e.g. Toyota Innova B 1234 CD" />
        </FormField>
        <FormField label="Category" required className="col-span-2" hint={
          <button type="button" onClick={onManageCategories} className="font-medium text-[#0F7D4E] hover:underline">Manage categories</button>
        }>
          <select value={f.category_id} onChange={e => set('category_id', e.target.value)} className={inputCls}>
            <option value="">{kategori.loading ? 'Loading...' : kategori.data.length ? 'Select category' : 'No categories — create one first'}</option>
            {kategori.data.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Acquisition Date" required>
          <input type="date" value={f.acquisition_date} onChange={e => set('acquisition_date', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="Depreciation Start" hint="Default: acquisition date">
          <input type="date" value={f.depreciation_start_date} min={f.acquisition_date} onChange={e => set('depreciation_start_date', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="Acquisition Cost (IDR)" required>
          <input type="number" min={0} step="0.01" value={f.cost} onChange={e => set('cost', e.target.value)} className={inputCls} />
        </FormField>
        <FormField label="Residual / Salvage Value" hint={kat ? `Default ${kat.residual_rate}% of cost = ${rupiah(residuDefault)}` : undefined}>
          <input type="number" min={0} step="0.01" value={f.residual_value} onChange={e => set('residual_value', e.target.value)} className={inputCls} placeholder={String(residuDefault || 0)} />
        </FormField>
        <FormField label="Depreciation Method" hint={kat ? `Category: ${METHOD_LABEL[kat.depreciation_method]}` : undefined}>
          <select value={f.depreciation_method} onChange={e => set('depreciation_method', e.target.value as DepMethod | '')} className={inputCls}>
            <option value="">Use category default</option>
            {(Object.keys(METHOD_LABEL) as DepMethod[]).map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </FormField>
        <FormField label="Useful Life (months)" hint={kat?.useful_life_months ? `Category: ${kat.useful_life_months} months` : undefined}>
          <input type="number" min={1} max={1200} value={f.useful_life_months} onChange={e => set('useful_life_months', e.target.value)} className={inputCls}
            placeholder={kat?.useful_life_months ? String(kat.useful_life_months) : ''} />
        </FormField>
        <FormField label="Opening Accumulated Depreciation" className="col-span-2"
          hint="For assets migrated from another system: depreciation already recorded before you started using this module.">
          <input type="number" min={0} step="0.01" value={f.opening_accumulated_depreciation} onChange={e => set('opening_accumulated_depreciation', e.target.value)} className={inputCls} placeholder="0" />
        </FormField>
      </div>
      {bulanan !== null && bulanan > 0 && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Estimated monthly depreciation: <b>{rupiah(Math.round(bulanan * 100) / 100)}</b> ({METHOD_LABEL[metode]}, {umur} months)</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Location"><input value={f.location} onChange={e => set('location', e.target.value)} className={inputCls} placeholder="e.g. Jakarta HQ" /></FormField>
        <FormField label="Branch"><input value={f.branch} onChange={e => set('branch', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Department"><input value={f.department} onChange={e => set('department', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Custodian"><input value={f.custodian} onChange={e => set('custodian', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Serial Number"><input value={f.serial_number} onChange={e => set('serial_number', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Supplier"><input value={f.supplier} onChange={e => set('supplier', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Reference (PO / Invoice No.)" className="col-span-2"><input value={f.reference} onChange={e => set('reference', e.target.value)} className={inputCls} /></FormField>
        <FormField label="Description" className="col-span-2"><textarea rows={2} value={f.description} onChange={e => set('description', e.target.value)} className={inputCls} /></FormField>
      </div>

      <div className="rounded-xl border border-border">
        <button type="button" onClick={() => setAkunTerbuka(x => !x)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-foreground">
          Accounts <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">Category defaults: {kat?.asset_account?.code ?? '—'} / {kat?.accum_account?.code ?? '—'} / {kat?.expense_account?.code ?? '—'}
            <ChevronDown size={14} className={akunTerbuka ? 'rotate-180' : ''} /></span>
        </button>
        {akunTerbuka && (
          <div className="space-y-3 border-t border-border p-3">
            <FormField label="Asset Account (override)"><AccountSelect accounts={akun.data} value={f.asset_coa_id} onChange={v => set('asset_coa_id', v)} filter={isPpeAccount} placeholder="Use category account" /></FormField>
            <FormField label="Accumulated Depreciation Account (override)"><AccountSelect accounts={akun.data} value={f.accum_coa_id} onChange={v => set('accum_coa_id', v)} filter={isAccumAccount} placeholder="Use category account" /></FormField>
            <FormField label="Depreciation Expense Account (override)"><AccountSelect accounts={akun.data} value={f.expense_coa_id} onChange={v => set('expense_coa_id', v)} filter={isDepExpense} placeholder="Use category account" /></FormField>
          </div>
        )}
      </div>

      {bolehJurnal && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.post_acquisition} onChange={e => set('post_acquisition', e.target.checked)} className="mt-1" />
            <span><span className="font-semibold text-foreground">Post acquisition journal</span>
              <span className="block text-xs text-muted-foreground">Dr asset account / Cr the account below, dated on the acquisition date. Manager level required.</span></span>
          </label>
          {f.post_acquisition && (
            <>
              <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><Info size={14} className="shrink-0" />
                Only use this when the purchase is not already recorded through Purchase, Cash &amp; Bank or Opening Balance — otherwise the cost is booked twice.</p>
              <FormField label="Credit Account" required>
                <AccountSelect accounts={akunLawan} value={f.acquisition_credit_coa_id} onChange={v => set('acquisition_credit_coa_id', v)} placeholder="e.g. Accounts Payable / Bank" />
              </FormField>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
