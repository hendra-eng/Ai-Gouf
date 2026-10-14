'use client';

// Modal tambah / ubah master customer AR (kode CUST-###, NPWP, alamat tagih,
// kontak). Backend: /api/v1/finance/receivables/customers.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { createArCustomer, updateArCustomer, type ArCustomer } from '@/lib/receivablesPayablesStore';
import { btnOutline, btnPrimary, inputCls } from './arapUi';

export default function CustomerModal({ clientId, customer, terms, onClose, onSaved }: {
  clientId: string;
  /** null = customer baru; boleh berisi nama dari invoice (id null). */
  customer: Partial<ArCustomer> | null;
  terms: string[];
  onClose: () => void;
  onSaved: (c: ArCustomer) => void;
}) {
  const [f, setF] = useState({ code: '', name: '', npwp: '', billing_address: '', phone: '', email: '', contact_person: '', payment_terms: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({
      code: customer?.code ?? '', name: customer?.name ?? '', npwp: customer?.npwp ?? '', billing_address: customer?.billing_address ?? '',
      phone: customer?.phone ?? '', email: customer?.email ?? '', contact_person: customer?.contact_person ?? '',
      payment_terms: customer?.payment_terms ?? '',
    });
  }, [customer]);
  const ubah = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF(s => ({ ...s, [k]: e.target.value }));

  const simpan = async () => {
    setBusy(true);
    try {
      const input = { client_id: clientId, ...f, code: f.code.trim() || null };
      const r = customer?.id ? await updateArCustomer(customer.id, input) : await createArCustomer(input);
      toast.success(r.message);
      onSaved({ ...r.data, in_master: true, outstanding: customer?.outstanding ?? 0 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">{customer?.id ? 'Customer Details' : 'New Customer'}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Used on invoices and customer statements.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-foreground">
            Customer ID
            <input value={f.code} onChange={ubah('code')} maxLength={30} placeholder="Auto (CUST-###)" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground sm:col-span-2">
            Customer Name <span className="text-rose-500">*</span>
            <input value={f.name} onChange={ubah('name')} maxLength={255} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground">
            NPWP
            <input value={f.npwp} onChange={ubah('npwp')} maxLength={30} placeholder="01.234.567.8-901.000" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground">
            Phone
            <input value={f.phone} onChange={ubah('phone')} maxLength={50} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground">
            Default Terms
            <select value={f.payment_terms} onChange={ubah('payment_terms')} className={`${inputCls} mt-1`}>
              <option value="">—</option>
              {terms.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-foreground sm:col-span-2">
            Email
            <input type="email" value={f.email} onChange={ubah('email')} maxLength={255} placeholder="finance@customer.co.id" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground">
            Contact Person
            <input value={f.contact_person} onChange={ubah('contact_person')} maxLength={255} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-foreground sm:col-span-3">
            Billing Address
            <textarea value={f.billing_address} onChange={ubah('billing_address')} rows={3} maxLength={1000} className={`${inputCls} mt-1`} />
          </label>
        </div>
        {customer?.id && customer.name && f.name.trim().toUpperCase() !== customer.name.toUpperCase() && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Renaming also renames this customer on all of its invoices, so its receivable balance stays together.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" onClick={simpan} disabled={busy || !f.name.trim()} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save Customer
          </button>
        </div>
      </div>
    </div>
  );
}
