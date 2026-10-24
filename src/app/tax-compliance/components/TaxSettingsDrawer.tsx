'use client';

// Tax Accounts: akun COA yang mewakili tiap jenis pajak. Dipakai untuk
// menarik baris pajak dari Journal Entry / Cash & Bank dan untuk rekonsiliasi
// Tax Ledger vs GL. Tanpa mapping tersimpan, backend menebak dari nama &
// kode standar akun.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { fetchTaxAccounts, saveTaxMappings, syncTax, useTaxData, type TaxAccountsData, type TaxType } from '@/lib/taxComplianceStore';
import { btnOutline, btnPrimary, Drawer, inputCls } from '@/components/arap/arapUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

export default function TaxSettingsDrawer({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const data = useTaxData<TaxAccountsData | null>(`tacc:${clientId}`, s => fetchTaxAccounts(clientId, s), null);
  const [peta, setPeta] = useState<Record<string, TaxType | ''>>({});
  const [cari, setCari] = useState('');
  const [semua, setSemua] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data.data) setPeta(Object.fromEntries(data.data.accounts.map(a => [a.id, a.tax_type ?? ''])));
  }, [data.data]);

  const akun = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (data.data?.accounts ?? []).filter(a => (semua || peta[a.id] || /pajak|tax|pph|ppn|vat/i.test(`${a.name} ${a.standard_code ?? ''}`))
      && (!q || `${a.code} ${kodeAkun(a.code)} ${a.name}`.toLowerCase().includes(q)));
  }, [data.data, peta, cari, semua]);

  const simpan = async () => {
    setBusy(true);
    try {
      const r = await saveTaxMappings(clientId, Object.entries(peta).filter(([, v]) => v).map(([coa_id, tax_type]) => ({ coa_id, tax_type: tax_type as TaxType })));
      toast.success(r.message);
      await syncTax(clientId);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title="Tax Accounts" subtitle={data.data?.saved ? 'Saved mapping' : 'Detected automatically — review and save'}
      footer={<><button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={simpan} disabled={busy || !data.data} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save &amp; Sync</button></>}>
      <p className="text-xs text-muted-foreground">Credits on payable accounts (VAT output, PPh payable) and debits on input VAT / prepaid tax accounts from Journal Entry and Cash &amp; Bank become tax ledger entries. Sales and Purchase taxes are read from the documents themselves.</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Search account..." className={`${inputCls} pl-9`} /></div>
        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs"><input type="checkbox" checked={semua} onChange={e => setSemua(e.target.checked)} /> All accounts</label>
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {data.loading && !data.data && <div className="h-24 animate-pulse bg-slate-50" />}
        {akun.map(a => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><b>{kodeAkun(a.code)}</b> · {a.name}<span className="block text-[11px] text-muted-foreground">{a.classification} · {a.standard_code ?? '—'}</span></span>
            <select value={peta[a.id] ?? ''} onChange={e => setPeta(p => ({ ...p, [a.id]: e.target.value as TaxType | '' }))} className="w-48 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
              <option value="">Not a tax account</option>
              {data.data?.tax_types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
        ))}
        {!data.loading && data.data && !akun.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching accounts.</p>}
      </div>
    </Drawer>
  );
}
