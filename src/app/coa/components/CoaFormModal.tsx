'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACCOUNT_CLASSIFICATIONS,
  type AccountClassification,
  type CoaAccount,
  type CoaAccountInput,
  type NormalBalance,
} from '@/lib/coaStore';

// Saldo normal default per klasifikasi -- sama dengan aturan di
// backend/migrations/generate_seed_coa.py::normal_balance() (tanpa akun kontra;
// untuk akun kontra user tinggal ganti manual).
const DEFAULT_NORMAL_BALANCE: Record<AccountClassification, NormalBalance> = {
  ASSET: 'DEBIT',
  'COST OF SALES': 'DEBIT',
  EXPENSE: 'DEBIT',
  'OTHER EXPENSE': 'DEBIT',
  'INCOME TAX': 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  'OTHER INCOME': 'CREDIT',
};

const inputCls = 'w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20';
const labelCls = 'block text-xs font-medium text-foreground mb-1';

export type CoaFormTarget = 'client' | 'unassigned';

export default function CoaFormModal({
  initial,
  activeClientName,
  defaultTarget = 'client',
  onClose,
  onSubmit,
}: {
  /** Diisi = mode Edit. */
  initial?: CoaAccount;
  /** Nama klien aktif (header). null = belum ada klien dipilih -> hanya bisa unassigned. */
  activeClientName?: string | null;
  /** Mode tambah: akun langsung dihubungkan ke klien aktif, atau unassigned. */
  defaultTarget?: CoaFormTarget;
  onClose: () => void;
  onSubmit: (data: CoaAccountInput, target: CoaFormTarget) => Promise<void>;
}) {
  const isEdit = !!initial;
  const [target, setTarget] = useState<CoaFormTarget>(activeClientName ? defaultTarget : 'unassigned');
  const [accNo, setAccNo] = useState(initial?.acc_no ?? '');
  const [accountName, setAccountName] = useState(initial?.account_name ?? '');
  const [classification, setClassification] = useState<AccountClassification>(initial?.account_classification ?? 'ASSET');
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(initial?.normal_balance ?? 'DEBIT');
  const [accountHead, setAccountHead] = useState(initial?.account_head ?? '');
  const [accountSub, setAccountSub] = useState(initial?.account_sub ?? '');
  const [standardCode, setStandardCode] = useState(initial?.standard_account_code ?? '');
  const [standardGroup, setStandardGroup] = useState(initial?.international_standard_group ?? '');
  const [ifrsRef, setIfrsRef] = useState(initial?.ifrs_taxonomy_reference ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);

  const changeClassification = (value: AccountClassification) => {
    setClassification(value);
    if (!isEdit) setNormalBalance(DEFAULT_NORMAL_BALANCE[value]);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!accNo.trim() || !accountName.trim()) {
      toast.error('ACC No and Account Name are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        acc_no: accNo.trim(),
        account_name: accountName.trim(),
        account_classification: classification,
        normal_balance: normalBalance,
        account_head: accountHead.trim() || null,
        account_sub: accountSub.trim() || null,
        standard_account_code: standardCode.trim() || null,
        international_standard_group: standardGroup.trim() || null,
        ifrs_taxonomy_reference: ifrsRef.trim() || null,
        description: description.trim() || null,
        is_active: isActive,
      }, target);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-card rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{isEdit ? `Edit Account ${initial?.acc_no}` : 'Add Account'}</h2>
            {isEdit && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {initial?.client_id ? `Client: ${initial.client_code ?? activeClientName ?? '-'}` : 'Unassigned (not linked to any client)'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {!isEdit && (
            <div>
              <label className={labelCls}>Link to</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['client', activeClientName ? `Client: ${activeClientName}` : 'Client (select one in the header)', 'Account is added to this client right away.'],
                  ['unassigned', 'Unassigned', 'Not linked to any client yet. Add it to a client later.'],
                ] as const).map(([value, title, hint]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={value === 'client' && !activeClientName}
                    onClick={() => setTarget(value)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${target === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                  >
                    <span className={`block text-xs font-medium truncate ${target === value ? 'text-primary' : 'text-foreground'}`}>{title}</span>
                    <span className="block text-[11px] text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>ACC No *</label>
              <input value={accNo} onChange={e => setAccNo(e.target.value)} placeholder="11100001" className={`${inputCls} font-mono`} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Account Name *</label>
              <input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="KAS KASIR" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Classification *</label>
              <select value={classification} onChange={e => changeClassification(e.target.value as AccountClassification)} className={inputCls}>
                {ACCOUNT_CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Normal Balance</label>
              <select value={normalBalance} onChange={e => setNormalBalance(e.target.value as NormalBalance)} className={inputCls}>
                <option value="DEBIT">DEBIT</option>
                <option value="CREDIT">CREDIT</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={isActive ? 'active' : 'inactive'} onChange={e => setIsActive(e.target.value === 'active')} className={inputCls}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Account Head</label>
              <input value={accountHead} onChange={e => setAccountHead(e.target.value)} placeholder="CURRENT ASSET" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Account Sub</label>
              <input value={accountSub} onChange={e => setAccountSub(e.target.value)} placeholder="CASH & CASH EQUIVALENTS" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Standard Account Code</label>
              <input value={standardCode} onChange={e => setStandardCode(e.target.value)} placeholder="std_asset_current_cash_bank" className={`${inputCls} font-mono text-xs`} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>International Standard Group (IFRS-aligned)</label>
              <input value={standardGroup} onChange={e => setStandardGroup(e.target.value)} placeholder="Assets > Current assets > Cash and cash equivalents" className={inputCls} />
            </div>
            <div className="sm:col-span-3">
              <label className={labelCls}>IFRS Taxonomy Reference</label>
              <input value={ifrsRef} onChange={e => setIfrsRef(e.target.value)} placeholder="Cash and cash equivalents" className={inputCls} />
            </div>
            <div className="sm:col-span-3">
              <label className={labelCls}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls} />
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
