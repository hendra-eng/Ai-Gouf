'use client';

// Kelola kategori aset: metode, umur ekonomis, % residu, dan akun COA
// (aset, akumulasi penyusutan, beban penyusutan). Bisa dibuat otomatis dari
// akun aset tetap di COA klien.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  deleteCategory, fetchCategories, fetchFaAccounts, lifeLabel, METHOD_LABEL, saveCategory, seedCategoriesFromCoa, useFaData,
  type Category, type CategoryInput, type CoaAccount, type DepMethod,
} from '@/lib/fixedAssetsStore';
import { btnOutline, btnPrimary, btnSmall, Drawer, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, isAccumAccount, isDepExpense, isPpeAccount } from '@/components/shared/moduleUi';

const BARU: CategoryInput = {
  name: '', description: '', is_depreciable: true, depreciation_method: 'straight_line', useful_life_months: 48, residual_rate: 0,
  asset_coa_id: null, accum_coa_id: null, expense_coa_id: null,
};

export default function CategoriesDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const kategori = useFaData<Category[]>(`cat:${clientId}`, s => fetchCategories(clientId, s), []);
  const akun = useFaData<CoaAccount[]>(`acc:${clientId}`, s => fetchFaAccounts(clientId, s), []);
  const [form, setForm] = useState<{ id?: string; v: CategoryInput } | null>(null);
  const [busy, setBusy] = useState(false);

  const ubah = (c: Category) => setForm({
    id: c.id, v: {
      name: c.name, description: c.description, is_depreciable: c.is_depreciable, depreciation_method: c.depreciation_method,
      useful_life_months: c.useful_life_months, residual_rate: c.residual_rate, asset_coa_id: c.asset_account?.id ?? null,
      accum_coa_id: c.accum_account?.id ?? null, expense_coa_id: c.expense_account?.id ?? null,
    },
  });

  const jalan = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      toast.success((await fn()).message);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const simpan = async () => {
    if (!form) return;
    if (await jalan(() => saveCategory(clientId, form.v, form.id))) setForm(null);
  };

  const set = <K extends keyof CategoryInput>(k: K, val: CategoryInput[K]) => setForm(x => (x ? { ...x, v: { ...x.v, [k]: val } } : x));

  return (
    <Drawer open onClose={onClose} title="Asset Categories" subtitle="Default depreciation method, useful life and accounts per category"
      footer={form ? <>
        <button type="button" onClick={() => setForm(null)} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy || !form.v.name.trim()} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save Category</button>
      </> : <>
        <button type="button" onClick={() => jalan(() => seedCategoriesFromCoa(clientId))} disabled={busy} className={btnOutline}><Wand2 size={15} /> Create from COA</button>
        <button type="button" onClick={() => setForm({ v: { ...BARU } })} className={btnPrimary}><Plus size={15} /> New Category</button>
      </>}>
      {form ? (
        <div className="space-y-3">
          <FormField label="Name" required><input value={form.v.name} onChange={e => set('name', e.target.value)} className={inputCls} maxLength={150} placeholder="e.g. Vehicles" /></FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.v.is_depreciable} onChange={e => set('is_depreciable', e.target.checked)} />
            Depreciable <span className="text-xs text-muted-foreground">(untick for land or construction in progress)</span>
          </label>
          {form.v.is_depreciable && (
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Method">
                <select value={form.v.depreciation_method} onChange={e => set('depreciation_method', e.target.value as DepMethod)} className={inputCls}>
                  <option value="straight_line">Straight Line</option><option value="declining_balance">Double Declining</option>
                </select>
              </FormField>
              <FormField label="Useful Life (months)" required hint={lifeLabel(form.v.useful_life_months)}>
                <input type="number" min={1} max={1200} value={form.v.useful_life_months ?? ''} onChange={e => set('useful_life_months', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
              </FormField>
              <FormField label="Residual (%)">
                <input type="number" min={0} max={99} step="0.01" value={form.v.residual_rate} onChange={e => set('residual_rate', Number(e.target.value || 0))} className={inputCls} />
              </FormField>
            </div>
          )}
          <FormField label="Asset Account"><AccountSelect accounts={akun.data} value={form.v.asset_coa_id} onChange={v => set('asset_coa_id', v)} filter={isPpeAccount} /></FormField>
          {form.v.is_depreciable && <>
            <FormField label="Accumulated Depreciation Account"><AccountSelect accounts={akun.data} value={form.v.accum_coa_id} onChange={v => set('accum_coa_id', v)} filter={isAccumAccount} /></FormField>
            <FormField label="Depreciation Expense Account"><AccountSelect accounts={akun.data} value={form.v.expense_coa_id} onChange={v => set('expense_coa_id', v)} filter={isDepExpense} /></FormField>
          </>}
          <FormField label="Description"><textarea rows={2} value={form.v.description ?? ''} onChange={e => set('description', e.target.value)} className={inputCls} /></FormField>
          <p className="text-[11px] text-muted-foreground">Fiscal useful life reference (PMK 72/2023): Group 1 = 4 years, Group 2 = 8, Group 3 = 16, Group 4 = 20, permanent buildings = 20, non-permanent = 10.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {kategori.loading && !kategori.data.length && <div className="h-16 animate-pulse bg-slate-50" />}
          {!kategori.loading && !kategori.data.length && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">No categories yet. Create them from the fixed asset accounts in your chart of accounts, or add one manually.</p>
          )}
          {kategori.data.map(c => (
            <div key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-foreground">{c.name} <span className="text-xs font-normal text-muted-foreground">· {c.asset_count} asset(s)</span></p>
                <p className="text-xs text-muted-foreground">
                  {c.is_depreciable ? `${METHOD_LABEL[c.depreciation_method]} · ${lifeLabel(c.useful_life_months)} · residual ${c.residual_rate}%` : 'Not depreciated'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Asset {c.asset_account?.code ?? '—'} · Accum. {c.is_depreciable ? c.accum_account?.code ?? <b className="text-amber-700">missing</b> : '—'} · Expense {c.is_depreciable ? c.expense_account?.code ?? <b className="text-amber-700">missing</b> : '—'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => ubah(c)} className={btnSmall} aria-label="Edit"><Pencil size={13} /></button>
                <button type="button" disabled={busy || c.asset_count > 0} onClick={() => window.confirm(`Delete category ${c.name}?`) && jalan(() => deleteCategory(clientId, c.id))}
                  className={`${btnSmall} text-rose-600`} aria-label="Delete" title={c.asset_count ? 'Category is used by assets' : 'Delete'}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
