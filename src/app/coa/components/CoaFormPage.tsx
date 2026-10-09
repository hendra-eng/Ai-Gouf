'use client';

// Halaman penuh Tambah / Edit akun COA (/coa/new & /coa/[id]/edit) --
// pengganti CoaFormModal (pop-up) lama. Kiri: form per section; kanan
// (sticky): live preview akun, pilihan "Link to" (mode tambah), & tombol simpan.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, Building2, Check, ChevronRight, FileText, Hash, Inbox, Layers, ListTree, Loader2, Save, Scale, Sparkles,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  ACCOUNT_CLASSIFICATIONS,
  createCoaAccount,
  fetchCoaAccount,
  updateCoaAccount,
  type AccountClassification,
  type CoaAccount,
  type CoaAccountInput,
  type NormalBalance,
} from '@/lib/coaStore';
import { DEFAULT_NORMAL_BALANCE, labelClassification, themeOf } from './coaTheme';

type Target = 'client' | 'unassigned';

const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2.5 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelCls = 'block text-xs font-semibold text-foreground mb-1.5';
const hintCls = 'mt-1 text-[11px] text-muted-foreground';

interface FormState {
  accNo: string;
  accountName: string;
  classification: AccountClassification;
  normalBalance: NormalBalance;
  accountHead: string;
  accountSub: string;
  standardCode: string;
  standardGroup: string;
  ifrsRef: string;
  description: string;
  isActive: boolean;
}

const KOSONG: FormState = {
  accNo: '', accountName: '', classification: 'ASSET', normalBalance: 'DEBIT', accountHead: '', accountSub: '',
  standardCode: '', standardGroup: '', ifrsRef: '', description: '', isActive: true,
};

function dariAkun(a: CoaAccount): FormState {
  return {
    accNo: a.acc_no ?? '',
    accountName: a.account_name ?? '',
    classification: a.account_classification ?? 'ASSET',
    normalBalance: a.normal_balance ?? DEFAULT_NORMAL_BALANCE[a.account_classification] ?? 'DEBIT',
    accountHead: a.account_head ?? '',
    accountSub: a.account_sub ?? '',
    standardCode: a.standard_account_code ?? '',
    standardGroup: a.international_standard_group ?? '',
    ifrsRef: a.ifrs_taxonomy_reference ?? '',
    description: a.description ?? '',
    isActive: a.is_active ?? true,
  };
}

function keInput(f: FormState): CoaAccountInput {
  return {
    acc_no: f.accNo.trim(),
    account_name: f.accountName.trim(),
    account_classification: f.classification,
    normal_balance: f.normalBalance,
    account_head: f.accountHead.trim() || null,
    account_sub: f.accountSub.trim() || null,
    standard_account_code: f.standardCode.trim() || null,
    international_standard_group: f.standardGroup.trim() || null,
    ifrs_taxonomy_reference: f.ifrsRef.trim() || null,
    description: f.description.trim() || null,
    is_active: f.isActive,
  };
}

function Section({ icon: Icon, title, subtitle, children }: {
  icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-6 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100">
          <Icon size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export default function CoaFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const { activeClientId, activeClientName } = useActiveClient();
  const isEdit = mode === 'edit';
  const editId = isEdit ? params?.id ?? null : null;

  // Tab asal (?view=unassigned) dibawa balik ke halaman list setelah simpan/batal.
  const viewAsal = searchParams.get('view') === 'unassigned' ? 'unassigned' : 'client';
  const backHref = viewAsal === 'unassigned' ? '/coa?view=unassigned' : '/coa';

  const [form, setForm] = useState<FormState>(KOSONG);
  const [target, setTarget] = useState<Target>(viewAsal);
  const [original, setOriginal] = useState<CoaAccount | null>(null);
  const [loadingAkun, setLoadingAkun] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'save' | 'again' | null>(null);
  const [errors, setErrors] = useState<{ accNo?: string; accountName?: string }>({});

  // Belum ada klien aktif -> mode tambah hanya bisa unassigned.
  useEffect(() => {
    if (!isEdit && !activeClientId) setTarget('unassigned');
  }, [isEdit, activeClientId]);

  useEffect(() => {
    if (!editId) return;
    let batal = false;
    setLoadingAkun(true);
    fetchCoaAccount(editId)
      .then(a => { if (!batal) { setOriginal(a); setForm(dariAkun(a)); setLoadError(null); } })
      .catch(err => { if (!batal) setLoadError(err instanceof Error ? err.message : 'Failed to load account.'); })
      .finally(() => { if (!batal) setLoadingAkun(false); });
    return () => { batal = true; };
  }, [editId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'accNo' || key === 'accountName') setErrors(e => ({ ...e, [key]: undefined }));
  };

  const pilihKlasifikasi = (c: AccountClassification) => {
    setForm(f => ({ ...f, classification: c, normalBalance: isEdit ? f.normalBalance : DEFAULT_NORMAL_BALANCE[c] }));
  };

  async function simpan(lagi: boolean) {
    if (submitting) return;
    const err: typeof errors = {};
    if (!form.accNo.trim()) err.accNo = 'ACC No is required.';
    if (!form.accountName.trim()) err.accountName = 'Account name is required.';
    setErrors(err);
    if (err.accNo || err.accountName) {
      toast.error('Please complete the required fields.');
      return;
    }
    setSubmitting(lagi ? 'again' : 'save');
    try {
      if (isEdit && editId) {
        const akun = await updateCoaAccount(editId, keInput(form));
        toast.success('Account updated', { description: `${akun.acc_no} — ${akun.account_name}` });
        router.push(backHref);
        return;
      }
      const clientId = target === 'client' ? activeClientId : null;
      const akun = await createCoaAccount(clientId, keInput(form));
      toast.success(clientId ? 'Account added' : 'Unassigned account added', { description: `${akun.acc_no} — ${akun.account_name}` });
      if (lagi) {
        // Klasifikasi & hierarki dipertahankan -- biasanya akun berikutnya satu kelompok.
        setForm(f => ({ ...KOSONG, classification: f.classification, normalBalance: f.normalBalance, accountHead: f.accountHead, accountSub: f.accountSub }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        router.push(target === 'unassigned' ? '/coa?view=unassigned' : '/coa');
      }
    } catch (e) {
      toast.error(isEdit ? 'Failed to update account' : 'Failed to add account', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(null);
    }
  }

  const theme = themeOf(form.classification);
  const judul = isEdit ? 'Edit Account' : 'New Account';

  if (isEdit && (loadingAkun || loadError)) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-6xl px-6 py-16">
          {loadingAkun ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading account…
            </div>
          ) : (
            <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><Inbox size={18} /></div>
              <h2 className="text-sm font-semibold text-foreground">Account not found</h2>
              <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
              <Link href={backHref} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50">
                <ArrowLeft size={14} /> Back to Chart of Accounts
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="pb-2">
        <div className="mx-auto max-w-6xl px-6">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href={backHref} className="hover:text-foreground">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">{isEdit ? original?.acc_no ?? 'Edit' : 'New account'}</span>
          </nav>
          <div className="flex items-center gap-3">
            <Link href={backHref} title="Back" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{judul}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isEdit
                  ? original?.client_id ? `Linked to ${original.client_code ?? activeClientName ?? 'client'}` : 'Unassigned — not linked to any client'
                  : 'Create an account and map it to the IFRS-aligned standard layer.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); simpan(false); }}
        className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        {/* Kolom kiri: section form */}
        <div className="space-y-5">
          <Section icon={Hash} title="Account identity" subtitle="Number and name as they appear in journals and reports.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={labelCls}>ACC No <span className="text-red-500">*</span></label>
                <input
                  value={form.accNo}
                  onChange={e => set('accNo', e.target.value)}
                  placeholder="11100001"
                  autoFocus={!isEdit}
                  className={`${inputCls} font-mono ${errors.accNo ? 'border-red-400 focus:ring-red-100' : ''}`}
                />
                {errors.accNo && <p className="mt-1 text-[11px] text-red-600">{errors.accNo}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Account name <span className="text-red-500">*</span></label>
                <input
                  value={form.accountName}
                  onChange={e => set('accountName', e.target.value)}
                  placeholder="KAS KASIR"
                  className={`${inputCls} ${errors.accountName ? 'border-red-400 focus:ring-red-100' : ''}`}
                />
                {errors.accountName && <p className="mt-1 text-[11px] text-red-600">{errors.accountName}</p>}
              </div>
            </div>
          </Section>

          <Section icon={Scale} title="Classification & balance" subtitle="Determines where the account lands in the financial statements.">
            <label className={labelCls}>Classification <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACCOUNT_CLASSIFICATIONS.map(c => {
                const t = themeOf(c);
                const aktif = form.classification === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pilihKlasifikasi(c)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-all ${
                      aktif ? `border-transparent ring-2 ${t.ring} text-foreground` : 'border-border text-muted-foreground hover:border-slate-300 hover:text-foreground'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
                    <span className="truncate">{labelClassification(c)}</span>
                    {aktif && <Check size={13} className="ml-auto shrink-0 text-foreground" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <label className={labelCls}>Normal balance</label>
              <div className="inline-flex rounded-xl bg-muted p-1">
                {(['DEBIT', 'CREDIT'] as const).map(nb => (
                  <button
                    key={nb}
                    type="button"
                    onClick={() => set('normalBalance', nb)}
                    className={`rounded-lg px-5 py-1.5 text-xs font-semibold transition-all ${
                      form.normalBalance === nb ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {nb === 'DEBIT' ? 'Debit' : 'Credit'}
                  </button>
                ))}
              </div>
              <p className={hintCls}>
                {isEdit ? 'Change only for contra accounts.' : 'Set automatically from the classification — switch it for contra accounts.'}
              </p>
            </div>
          </Section>

          <Section icon={Layers} title="Hierarchy" subtitle="Grouping used for subtotals in reports.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Account head</label>
                <input value={form.accountHead} onChange={e => set('accountHead', e.target.value)} placeholder="CURRENT ASSET" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Account sub</label>
                <input value={form.accountSub} onChange={e => set('accountSub', e.target.value)} placeholder="CASH & CASH EQUIVALENTS" className={inputCls} />
              </div>
            </div>
          </Section>

          <Section icon={Sparkles} title="Standard mapping" subtitle="Links the client account to the IFRS-aligned standard layer.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Standard account code</label>
                <input value={form.standardCode} onChange={e => set('standardCode', e.target.value)} placeholder="std_asset_current_cash_bank" className={`${inputCls} font-mono text-xs`} />
              </div>
              <div>
                <label className={labelCls}>IFRS taxonomy reference</label>
                <input value={form.ifrsRef} onChange={e => set('ifrsRef', e.target.value)} placeholder="Cash and cash equivalents" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>International standard group (IFRS-aligned)</label>
                <input value={form.standardGroup} onChange={e => set('standardGroup', e.target.value)} placeholder="Assets > Current assets > Cash and cash equivalents" className={inputCls} />
              </div>
            </div>
          </Section>

          <Section icon={FileText} title="Notes" subtitle="Optional description shown as a tooltip in the account list.">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="What is this account used for?" className={`${inputCls} resize-y`} />
          </Section>
        </div>

        {/* Kolom kanan (sticky): preview + link + simpan */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className={`h-1.5 ${theme.dot}`} />
            <div className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{form.accNo.trim() || '— — — —'}</p>
              <p className="mt-0.5 break-words text-base font-semibold leading-snug text-foreground">{form.accountName.trim() || 'Account name'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${theme.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />{labelClassification(form.classification)}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{form.normalBalance === 'DEBIT' ? 'Dr' : 'Cr'}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${form.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                  {form.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {(form.accountHead || form.accountSub) && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {[form.accountHead, form.accountSub].filter(Boolean).join(' › ')}
                </p>
              )}
              {form.standardCode && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{form.standardCode}</p>}
            </div>
          </div>

          {!isEdit && (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold text-foreground">Link to</p>
              <div className="space-y-2">
                {([
                  ['client', Building2, activeClientName ?? 'Client', activeClientId ? 'Added to this client right away.' : 'Select a client in the header first.'],
                  ['unassigned', Inbox, 'Unassigned', 'Kept in the pool — assign it to a client later.'],
                ] as const).map(([value, Icon, title, hint]) => {
                  const aktif = target === value;
                  const nonaktif = value === 'client' && !activeClientId;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={nonaktif}
                      onClick={() => setTarget(value)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                        aktif ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-border hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={15} className={`mt-0.5 shrink-0 ${aktif ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="min-w-0">
                        <span className={`block truncate text-xs font-semibold ${aktif ? 'text-primary' : 'text-foreground'}`}>{title}</span>
                        <span className="block text-[11px] text-muted-foreground">{hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-xs font-semibold text-foreground">Active</span>
                <span className="block text-[11px] text-muted-foreground">Inactive accounts are hidden from pickers.</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.isActive}
                onClick={() => set('isActive', !form.isActive)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.isActive ? 'bg-primary' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>

          <div className="space-y-2">
            <button
              type="submit"
              disabled={!!submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isEdit ? 'Save changes' : 'Create account'}
            </button>
            {!isEdit && (
              <button
                type="button"
                disabled={!!submitting}
                onClick={() => simpan(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {submitting === 'again' && <Loader2 size={15} className="animate-spin" />}
                Save &amp; add another
              </button>
            )}
            <Link href={backHref} className="block w-full rounded-xl px-4 py-2 text-center text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  );
}
