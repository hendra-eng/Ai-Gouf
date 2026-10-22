'use client';

// Transaction Templates: daftar template per jenis + editor aturan jurnal
// (akun default per peran tiap sub jenis), approval & auto-post. Template
// sistem (1 per jenis) bisa diubah/dinonaktifkan; template buatan sendiri bisa dihapus.

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTemplate, saveTemplate, type Meta, type Role, type TemplateInput, type TxTemplate, type TypeKey } from '@/lib/otherTransactionStore';
import { btnOutline, btnPrimary, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, Modal } from '@/components/shared/moduleUi';
import { TYPE_ORDER, TYPE_UI, TypeIcon } from './otherUi';

type Draft = TemplateInput & { id?: string; is_system?: boolean };

function dariTemplate(t: TxTemplate): Draft {
  return {
    id: t.id, is_system: t.is_system, type_key: t.type_key, code: t.code, name: t.name, description: t.description,
    requires_approval: t.requires_approval, auto_post: t.auto_post, is_active: t.is_active,
    rules: t.rules.map(r => ({
      subtype: r.subtype, is_active: r.is_active, main_coa_id: r.accounts.main?.id ?? null, bank_coa_id: r.accounts.bank?.id ?? null,
      offset_coa_id: r.accounts.offset?.id ?? null, extra_coa_id: r.accounts.extra?.id ?? null,
    })),
  };
}

export default function TemplatesModal({ clientId, meta, onClose }: { clientId: string; meta: Meta; onClose: () => void }) {
  const [templates, setTemplates] = useState<TxTemplate[]>(meta.templates);
  const [pilih, setPilih] = useState<string | null>(meta.templates[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(meta.templates[0] ? dariTemplate(meta.templates[0]) : null);
  const [busy, setBusy] = useState(false);
  const [baru, setBaru] = useState<TypeKey | ''>('');
  useEffect(() => setTemplates(meta.templates), [meta.templates]);

  const jenis = meta.types.find(t => t.key === draft?.type_key);
  const grup = useMemo(() => TYPE_ORDER.map(k => ({ k, items: templates.filter(t => t.type_key === k) })), [templates]);

  const buka = (t: TxTemplate) => { setPilih(t.id); setDraft(dariTemplate(t)); };
  const mulaiBaru = (k: TypeKey) => {
    const j = meta.types.find(t => t.key === k)!;
    const sistem = templates.find(t => t.type_key === k && t.is_system);
    setPilih(null);
    setDraft({
      type_key: k, code: '', name: `${j.name} (Custom)`, description: j.description, requires_approval: true, auto_post: false, is_active: true,
      rules: sistem ? dariTemplate(sistem).rules : j.subtypes.map(s => ({ subtype: s.key, is_active: true, main_coa_id: null, bank_coa_id: null, offset_coa_id: null, extra_coa_id: null })),
    });
    setBaru('');
  };
  const ubahRule = (subtype: string, patch: Partial<Draft['rules'][number]>) =>
    setDraft(d => d && {
      ...d,
      rules: d.rules.some(r => r.subtype === subtype)
        ? d.rules.map(r => (r.subtype === subtype ? { ...r, ...patch } : r))
        : [...d.rules, { subtype, is_active: true, main_coa_id: null, bank_coa_id: null, offset_coa_id: null, extra_coa_id: null, ...patch }],
    });

  const simpan = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const { id, is_system: _s, ...body } = draft;
      const r = await saveTemplate(clientId, body, id);
      toast.success(r.message);
      setTemplates(ts => (id ? ts.map(t => (t.id === id ? r.data : t)) : [...ts, r.data]));
      setPilih(r.data.id);
      setDraft(dariTemplate(r.data));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hapus = async () => {
    if (!draft?.id || !window.confirm(`Delete template ${draft.name}?`)) return;
    setBusy(true);
    try {
      toast.success((await deleteTemplate(clientId, draft.id)).message);
      const sisa = templates.filter(t => t.id !== draft.id);
      setTemplates(sisa);
      if (sisa[0]) buka(sisa[0]); else { setPilih(null); setDraft(null); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width="max-w-6xl" title="Transaction Templates"
      subtitle="Each template defines the journal rule per transaction subtype. Default accounts are pre-filled on the form and can still be changed per transaction."
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Close</button>
        {draft && <button type="button" onClick={simpan} disabled={busy || draft.name.trim().length < 2} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save Template</button>}
      </>}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={baru} onChange={e => setBaru(e.target.value as TypeKey | '')} className={`${inputCls} py-2 text-xs`}>
              <option value="">New template based on...</option>
              {meta.types.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <button type="button" disabled={!baru} onClick={() => baru && mulaiBaru(baru)} className={`${btnPrimary} px-3`}><Plus size={14} /></button>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {grup.map(g => (
              <div key={g.k}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{TYPE_UI[g.k].title}</p>
                {g.items.map(t => (
                  <button key={t.id} type="button" onClick={() => buka(t)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${pilih === t.id ? 'border-[#0F7D4E] bg-emerald-50/60' : 'border-border hover:bg-slate-50'}`}>
                    <TypeIcon type={t.type_key} />
                    <span className="min-w-0 flex-1"><b className="block truncate font-medium">{t.name}</b>
                      <span className="text-muted-foreground">{t.code} · {t.usage} used{t.is_active ? '' : ' · inactive'}</span></span>
                    {t.rules.some(r => r.is_active && !r.complete) && <span className="h-2 w-2 rounded-full bg-amber-400" title="Some rules have no default account" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {!draft || !jenis ? <p className="py-10 text-center text-sm text-muted-foreground">Select a template.</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Template Name" required className="sm:col-span-2">
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={150} className={inputCls} />
              </FormField>
              <FormField label="Code" hint={draft.id ? undefined : 'Leave empty to generate'}>
                <input value={draft.code ?? ''} disabled={!!draft.id} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} maxLength={40} className={inputCls} />
              </FormField>
              <FormField label="Description" className="sm:col-span-3">
                <input value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} maxLength={2000} className={inputCls} />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-5 text-sm">
              {([['requires_approval', 'Requires approval', 'Submitted transactions wait in the Review Queue'],
                ['auto_post', 'Auto-post on approval', 'Posted immediately when approved by a Manager+'],
                ['is_active', 'Active', 'Available in Create Transaction']] as const).map(([k, l, h]) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="checkbox" checked={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.checked })} className="mt-1" />
                  <span><span className="font-medium">{l}</span><span className="block text-[11px] text-muted-foreground">{h}</span></span>
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold">Journal Rules</p>
              {jenis.subtypes.map(s => {
                const r = draft.rules.find(x => x.subtype === s.key) ?? { subtype: s.key, is_active: true, main_coa_id: null, bank_coa_id: null, offset_coa_id: null, extra_coa_id: null };
                return (
                  <div key={s.key} className={`rounded-2xl border p-4 ${r.is_active ? 'border-border' : 'border-dashed border-border opacity-60'}`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{s.label}</p>
                        <p className="text-[11px] text-muted-foreground">{s.lines.map(l => `${l.side === 'D' ? 'Dr' : 'Cr'} ${jenis.roles[l.role]}${l.portion === 'extra' ? ` (${s.extra_label})` : ''}`).join(' · ')}</p>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.is_active} onChange={e => ubahRule(s.key, { is_active: e.target.checked })} /> Active</label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {s.roles.map((p: Role) => (
                        <FormField key={p} label={jenis.roles[p] ?? p}>
                          <AccountSelect accounts={meta.accounts} value={r[`${p}_coa_id` as const]} placeholder="No default account"
                            filter={p === 'bank' ? a => !!a.cash_type : undefined}
                            onChange={v => ubahRule(s.key, { [`${p}_coa_id`]: v } as Partial<Draft['rules'][number]>)} />
                        </FormField>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {draft.id && !draft.is_system && (
              <button type="button" onClick={hapus} disabled={busy} className={`${btnOutline} text-rose-600`}><Trash2 size={14} /> Delete Template</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
