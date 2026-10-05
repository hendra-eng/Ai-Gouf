'use client';

// Settings > Purchase: variabel default fitur purchase per company
// (tabel management_setting_purchase). Form langsung bisa diedit; simpan lewat
// PUT /api/v1/management/settings/purchase?client_id= (upsert, minimal Tahap 5
// -- lihat settings_v1.py). Company yang belum pernah menyimpan tampil dengan
// nilai default.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Loader2, MessageSquareText, RotateCcw, Save, SlidersHorizontal, ToggleLeft } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  fetchPurchaseSetting, savePurchaseSetting, useLoader, type PurchaseSetting, type PurchaseSettingInput,
} from '@/lib/settingsStore';

const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2.5 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelCls = 'block text-xs font-semibold text-foreground mb-1.5';

type Flag = 'activate_supplier_in_purchase_request' | 'shipping' | 'discount' | 'discount_per_lines' | 'deposit';

const FLAGS: { key: Flag; label: string; hint: string }[] = [
  { key: 'activate_supplier_in_purchase_request', label: 'Activate supplier in Purchase Request', hint: 'Let purchase requests pick a supplier up front.' },
  { key: 'shipping', label: 'Shipping', hint: 'Show shipping cost on purchase documents.' },
  { key: 'discount', label: 'Discount', hint: 'Allow a discount on the purchase total.' },
  { key: 'discount_per_lines', label: 'Discount per lines', hint: 'Allow a discount on each item line.' },
  { key: 'deposit', label: 'Deposit', hint: 'Allow recording a down payment to the supplier.' },
];

const fmtTanggal = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function keForm(s: PurchaseSetting): PurchaseSettingInput {
  return {
    preferred_purchase_term: s.preferred_purchase_term ?? '',
    activate_supplier_in_purchase_request: s.activate_supplier_in_purchase_request,
    shipping: s.shipping,
    discount: s.discount,
    discount_per_lines: s.discount_per_lines,
    deposit: s.deposit,
    default_purchase_message: s.default_purchase_message ?? '',
  };
}

export default function PurchaseSettings() {
  const { activeClientId } = useActiveClient();
  const { data: setting, setData, loading, error } = useLoader<PurchaseSetting | null>(activeClientId, fetchPurchaseSetting, null);
  const [form, setForm] = useState<PurchaseSettingInput | null>(null);
  const [saving, setSaving] = useState(false);

  // Data baru (ganti company / habis simpan) -> isi ulang form.
  useEffect(() => { setForm(setting ? keForm(setting) : null); }, [setting]);

  const awal = useMemo(() => (setting ? keForm(setting) : null), [setting]);
  const jumlahBerubah = useMemo(() => {
    if (!form || !awal) return 0;
    return (Object.keys(form) as (keyof PurchaseSettingInput)[]).filter(k => form[k] !== awal[k]).length;
  }, [form, awal]);

  const set = <K extends keyof PurchaseSettingInput>(k: K, v: PurchaseSettingInput[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  async function simpan() {
    if (!activeClientId || !form || saving) return;
    setSaving(true);
    try {
      const baru = await savePurchaseSetting(activeClientId, {
        ...form,
        preferred_purchase_term: form.preferred_purchase_term || null,
        default_purchase_message: form.default_purchase_message?.trim() || null,
      });
      setData(baru);
      toast.success(setting?.exists ? 'Purchase settings updated' : 'Purchase settings saved');
    } catch (e) {
      toast.error('Failed to save purchase settings', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (!activeClientId) {
    return <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Select a company to configure purchase settings.</div>;
  }
  if (loading && !setting) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  }
  if (error && !setting) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  }
  if (!setting || !form) return null;

  const opsi = setting.term_options;
  const term = form.preferred_purchase_term ?? '';

  return (
    <div className="space-y-5 pb-20">
      {!setting.exists && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          This company has no purchase settings yet — defaults are shown. Save to create them.
        </div>
      )}

      <Section icon={SlidersHorizontal} title="Payment term" subtitle="Default term suggested on new purchases.">
        <div className="max-w-sm">
          <label className={labelCls}>Preferred purchase term</label>
          <select value={term} onChange={e => set('preferred_purchase_term', e.target.value)} className={inputCls}>
            <option value="">Not set</option>
            {opsi.map(o => <option key={o} value={o}>{o}</option>)}
            {term && !opsi.includes(term) && <option value={term}>{term}</option>}
          </select>
        </div>
      </Section>

      <Section icon={ToggleLeft} title="Purchase features" subtitle="Turn optional parts of the purchase form on or off.">
        <div className="divide-y divide-border">
          {FLAGS.map(f => (
            <label key={f.key} className="flex cursor-pointer items-start gap-3 py-3 first:pt-0 last:pb-0">
              <input
                type="checkbox"
                checked={Boolean(form[f.key])}
                onChange={e => set(f.key, e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{f.label}</span>
                <span className="block text-xs text-muted-foreground">{f.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section icon={MessageSquareText} title="Default purchase message" subtitle="Pre-filled note on new purchase documents.">
        <textarea
          value={form.default_purchase_message ?? ''}
          onChange={e => set('default_purchase_message', e.target.value)}
          rows={4}
          placeholder="e.g. Please deliver to our main warehouse during working hours."
          className={`${inputCls} resize-y`}
        />
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-6 py-3">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {jumlahBerubah
              ? <span className="font-medium text-amber-700">{jumlahBerubah} unsaved change{jumlahBerubah > 1 ? 's' : ''}</span>
              : setting.edited_at
                ? <><CalendarDays size={12} /> Updated {fmtTanggal.format(new Date(setting.edited_at))}</>
                : 'No changes yet'}
            <span className="hidden sm:inline"> · Saving requires Tahap 5 (Partner) access.</span>
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => awal && setForm(awal)} disabled={saving || !jumlahBerubah} className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-slate-50 disabled:opacity-50">
              <RotateCcw size={14} /> Reset
            </button>
            <button onClick={simpan} disabled={saving || (setting.exists && !jumlahBerubah)} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-800 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-6 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary ring-1 ring-blue-100"><Icon size={16} /></span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
