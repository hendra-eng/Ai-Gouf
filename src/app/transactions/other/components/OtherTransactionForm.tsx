'use client';

// Form Create / Edit Other Transaction (dataset/picture/Template UI/other/2-8.jpeg):
// stepper Transaction Details -> Journal Preview -> Supporting Document -> Review & Submit,
// kolom kanan Summary + Journal Preview (dihitung backend POST /preview dari aturan template).
// URL: /transactions/other/create?type=<jenis>&template=<id>  atau  ?id=<transaksi> untuk edit.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, CloudUpload, FileText, Info, Loader2, Lock, Paperclip, Save, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveClient } from '@/lib/activeClient';
import { fmtDate, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  attachmentUrl, bulkAction, CURRENCIES, deleteAttachment, fetchMeta, fetchTransaction, previewTransaction, saveTransaction, uploadAttachments, useOtherTxData,
  type Meta, type OtherTx, type Preview, type Role, type TxInput, type TypeKey,
} from '@/lib/otherTransactionStore';
import { btnOutline, btnPrimary, inputCls, Menu, MenuItem } from '@/components/arap/arapUi';
import { AccountSelect, FormField } from '@/components/shared/moduleUi';
import { IssueList, StatusPill, TYPE_UI, TypeIcon, type DetailField } from './otherUi';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const STEPS = [
  ['Transaction Details', 'Enter transaction information'], ['Journal Preview', 'Review automatic journal'],
  ['Supporting Document', 'Attach documents (optional)'], ['Review & Submit', 'Submit for approval'],
] as const;
const MAKS = 10 * 1024 * 1024;

const kosong = (type: TypeKey): TxInput => ({
  template_id: null, type_key: type, subtype: '', journal_no: null, journal_date: todayIso(), counterparty: '', counterparty_code: '', reference_no: '',
  description: '', currency: 'IDR', exchange_rate: 1, amount: 0, extra_amount: 0, main_coa_id: null, bank_coa_id: null, offset_coa_id: null, extra_coa_id: null,
  branch: '', department: '', project: '', cost_center: '', due_date: null, period_start: null, period_end: null, details: {}, notes: '', requires_approval: true,
});

const dariTx = (t: OtherTx): TxInput => ({
  template_id: t.template_id, type_key: t.type_key, subtype: t.subtype, journal_no: t.journal_no, journal_date: t.journal_date,
  counterparty: t.counterparty ?? '', counterparty_code: t.counterparty_code ?? '', reference_no: t.reference_no ?? '', description: t.description ?? '',
  currency: t.currency, exchange_rate: t.exchange_rate, amount: t.amount, extra_amount: t.extra_amount,
  main_coa_id: t.main_coa_id, bank_coa_id: t.bank_coa_id, offset_coa_id: t.offset_coa_id, extra_coa_id: t.extra_coa_id,
  branch: t.branch ?? '', department: t.department ?? '', project: t.project ?? '', cost_center: t.cost_center ?? '',
  due_date: t.due_date, period_start: t.period_start, period_end: t.period_end, details: t.details ?? {}, notes: t.notes ?? '', requires_approval: t.requires_approval,
});

const tambahBulan = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const akhir = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, akhir)).padStart(2, '0')}`;
};

/** Input angka dengan pemisah ribuan id-ID. */
function MoneyInput({ value, onChange, prefix = 'Rp', disabled }: { value: number; onChange: (n: number) => void; prefix?: string; disabled?: boolean }) {
  const [teks, setTeks] = useState(value ? value.toLocaleString('id-ID') : '');
  const fokus = useRef(false);
  useEffect(() => { if (!fokus.current) setTeks(value ? value.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : ''); }, [value]);
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-l-xl border border-r-0 border-border bg-slate-50 px-3 text-sm text-muted-foreground">{prefix}</span>
      <input value={teks} disabled={disabled} inputMode="decimal"
        onFocus={() => { fokus.current = true; }}
        onBlur={() => { fokus.current = false; setTeks(value ? value.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : ''); }}
        onChange={e => {
          const t = e.target.value.replace(/[^\d,]/g, '');
          setTeks(t);
          onChange(Number(t.replace(/\./g, '').replace(',', '.')) || 0);
        }}
        className={`${inputCls} rounded-l-none text-right`} placeholder="0" />
    </div>
  );
}

function Suggest({ id, value, onChange, options, placeholder, disabled }: {
  id: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; disabled?: boolean;
}) {
  return <>
    <input list={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} maxLength={255} />
    <datalist id={id}>{options.map(o => <option key={o} value={o} />)}</datalist>
  </>;
}

export default function OtherTransactionForm() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const router = useRouter();
  const params = useSearchParams();
  const { activeClientId } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const editId = params.get('id');
  const tipeQuery = (params.get('type') as TypeKey) || 'employee_advance';
  const meta = useOtherTxData<Meta | null>(kid ? `otmeta:${kid}` : null, s => fetchMeta(kid as string, s), null);
  const tx = useOtherTxData<OtherTx | null>(kid && editId ? `otx:${kid}:${editId}` : null, s => fetchTransaction(kid as string, editId as string, s), null);

  const [f, setF] = useState<TxInput>(() => kosong(tipeQuery));
  const [siap, setSiap] = useState(false);
  const [step, setStep] = useState(0);
  const [pv, setPv] = useState<Preview | null>(null);
  const [pvBusy, setPvBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tampilErr, setTampilErr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const m = meta.data;
  const t = editId ? tx.data : null;
  const jenis = m?.types.find(x => x.key === f.type_key);
  const sub = jenis?.subtypes.find(s => s.key === f.subtype);
  const ui = TYPE_UI[f.type_key] ?? TYPE_UI.other_event;
  const template = m?.templates.find(x => x.id === f.template_id);
  const terkunci = !!t && (['posted', 'reversed'].includes(t.status) || t.source === 'legacy');

  // Isi awal: dari transaksi (edit) atau dari template + aturan sub jenis pertama (baru).
  useEffect(() => {
    if (siap || !m) return;
    if (editId) {
      if (!tx.data) return;
      setF(dariTx(tx.data));
      setSiap(true);
      return;
    }
    const tp = m.templates.find(x => x.id === params.get('template') && x.type_key === tipeQuery)
      ?? m.templates.find(x => x.type_key === tipeQuery && x.is_system);
    const j = m.types.find(x => x.key === tipeQuery);
    if (!j) return;
    const s0 = j.subtypes[0];
    const r = tp?.rules.find(x => x.subtype === s0.key);
    setF(v => ({
      ...v, type_key: tipeQuery, template_id: tp?.id ?? null, subtype: s0.key, requires_approval: tp?.requires_approval ?? true,
      main_coa_id: r?.accounts.main?.id ?? null, bank_coa_id: r?.accounts.bank?.id ?? null, offset_coa_id: r?.accounts.offset?.id ?? null, extra_coa_id: r?.accounts.extra?.id ?? null,
      details: (tipeQuery === 'intercompany' ? { from_entity: m.client_name ?? '', settlement_type: 'Bank Transfer' } : {}) as TxInput['details'],
    }));
    setSiap(true);
  }, [m, tx.data, editId, siap, tipeQuery, params]);

  const set = <K extends keyof TxInput>(k: K, v: TxInput[K]) => setF(x => ({ ...x, [k]: v }));
  const setDetail = (k: string, v: string | number) => setF(x => ({ ...x, details: { ...x.details, [k]: v } }));

  const gantiSub = (key: string) => {
    const r = template?.rules.find(x => x.subtype === key);
    setF(x => {
      const n: TxInput = { ...x, subtype: key };
      (['main', 'bank', 'offset', 'extra'] as Role[]).forEach(p => {
        const a = r?.accounts[p]?.id;
        if (a) n[`${p}_coa_id`] = a;
      });
      if (x.type_key === 'intercompany') {
        const kita = m?.client_name ?? '';
        const keluar = key === 'due_from_funding' || key === 'due_to_settlement';
        n.details = { ...x.details, from_entity: keluar ? kita : x.counterparty || '', to_entity: keluar ? x.counterparty || '' : kita };
      }
      if (!jenis?.subtypes.find(s => s.key === key)?.extra_label) n.extra_amount = 0;
      return n;
    });
  };

  // Intercompany: entitas lawan ikut counterparty.
  useEffect(() => {
    if (f.type_key !== 'intercompany' || !siap) return;
    const kita = m?.client_name ?? '';
    const keluar = f.subtype === 'due_from_funding' || f.subtype === 'due_to_settlement';
    setF(x => ({ ...x, details: { ...x.details, [keluar ? 'to_entity' : 'from_entity']: x.counterparty || '', [keluar ? 'from_entity' : 'to_entity']: x.details[keluar ? 'from_entity' : 'to_entity'] || kita } }));
  }, [f.counterparty, f.subtype, f.type_key, siap, m?.client_name]);

  // Loan: maturity date = tanggal + jangka waktu (kalau belum diisi manual).
  const term = Number(f.details.loan_term_months) || 0;
  useEffect(() => {
    if (f.type_key === 'loan_financing' && f.subtype === 'loan_received' && term > 0 && f.journal_date) set('due_date', tambahBulan(f.journal_date, term));
  }, [term, f.journal_date, f.type_key, f.subtype]);  

  // Journal Preview live dari backend.
  const kunciPv = JSON.stringify(f);
  useEffect(() => {
    if (!kid || !siap || !f.subtype || terkunci) return;
    const h = setTimeout(async () => {
      setPvBusy(true);
      try { setPv(await previewTransaction(kid, f)); } catch { setPv(null); } finally { setPvBusy(false); }
    }, 350);
    return () => clearTimeout(h);
  }, [kunciPv, kid, siap, terkunci]); // eslint-disable-line react-hooks/exhaustive-deps

  const baris = terkunci ? t?.lines ?? [] : pv?.lines ?? [];
  const isu = terkunci ? [] : pv?.issues ?? [];
  const totalIdr = Math.round(f.amount * (f.currency === 'IDR' ? 1 : f.exchange_rate || 1) * 100) / 100;

  const wajibKosong = useMemo(() => {
    const k: string[] = [];
    if (!f.journal_date) k.push('Transaction Date');
    if (!(f.counterparty || '').trim()) k.push(jenis?.party_label ?? 'Counterparty');
    if (ui.referenceRequired && !(f.reference_no || '').trim()) k.push(ui.referenceLabel);
    if (!(f.description || '').trim()) k.push(ui.descriptionLabel);
    if (f.amount <= 0) k.push('Amount');
    ui.details.filter(d => d.required && !String(f.details[d.key] ?? '').trim()).forEach(d => k.push(d.label));
    if (ui.claimPeriod && (!f.period_start || !f.period_end)) k.push('Claim Period');
    return k;
  }, [f, ui, jenis]);

  const simpan = async (action: 'draft' | 'submit') => {
    if (!kid) return;
    if (action === 'submit' && wajibKosong.length) {
      setTampilErr(true);
      setStep(0);
      toast.error(`Complete the required fields: ${wajibKosong.join(', ')}.`);
      return;
    }
    setBusy(action);
    try {
      const r = await saveTransaction(kid, f, action, editId ?? undefined);
      if (files.length) {
        try { await uploadAttachments(kid, r.data.id, files); } catch (e) { toast.error(`Saved, but documents failed to upload: ${(e as Error).message}`); }
      }
      (r.message.includes('could not be submitted') ? toast.warning : toast.success)(r.message);
      router.push(r.data.status === 'pending_review' ? '/transactions/other?tab=review' : r.data.status === 'posted' ? '/transactions/other?tab=posted' : '/transactions/other');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const post = async () => {
    if (!kid || !t) return;
    setBusy('post');
    try {
      const r = await bulkAction(kid, 'post', [t.id]);
      (r.data.failed.length ? toast.warning : toast.success)(r.message);
      if (!r.data.failed.length) router.push('/transactions/other?tab=posted');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pilihFile = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    Array.from(list).forEach(x => {
      if (!/\.(pdf|jpe?g|png)$/i.test(x.name)) toast.error(`${x.name}: only PDF, JPG and PNG are supported.`);
      else if (x.size > MAKS) toast.error(`${x.name} is larger than 10 MB.`);
      else ok.push(x);
    });
    setFiles(s => [...s, ...ok]);
  };

  if (!kid) return <div className="p-6"><div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div></div>;
  if (meta.error || tx.error) return <div className="p-6"><div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{meta.error || tx.error}</div></div>;
  if (!siap || !jenis) return <div className="p-6"><div className="h-96 animate-pulse rounded-2xl bg-slate-100" /></div>;

  const err = (label: string) => tampilErr && wajibKosong.includes(label) ? 'border-rose-400' : '';
  const roleLabel = (p: Role) => jenis.roles[p] ?? p;
  const akunNama = (id: string | null) => { const a = m?.accounts.find(x => x.id === id); return a ? `${kodeAkun(a.code)} - ${a.name}` : '—'; };
  const statusTx = t?.status ?? 'draft';
  const bolehPost = !!t && t.status === 'approved' && !!m?.can_post;

  const detailInput = (d: DetailField) => {
    const v = f.details[d.key] ?? '';
    if (d.kind === 'select') {
      return <select value={String(v)} disabled={terkunci} onChange={e => setDetail(d.key, e.target.value)} className={`${inputCls} ${err(d.label)}`}>
        <option value="">Select...</option>{d.options?.map(o => <option key={o} value={o}>{o}</option>)}</select>;
    }
    if (d.kind === 'date') return <input type="date" value={String(v)} disabled={terkunci} onChange={e => setDetail(d.key, e.target.value)} className={`${inputCls} ${err(d.label)}`} />;
    if (d.kind === 'percent' || d.kind === 'number') {
      return <div className="flex"><input type="number" min={0} step={d.kind === 'percent' ? 0.01 : 1} value={String(v)} disabled={terkunci} placeholder={d.placeholder}
        onChange={e => setDetail(d.key, e.target.value === '' ? '' : Number(e.target.value))} className={`${inputCls} ${d.kind === 'percent' ? 'rounded-r-none' : ''}`} />
        {d.kind === 'percent' && <span className="inline-flex items-center rounded-r-xl border border-l-0 border-border bg-slate-50 px-3 text-sm text-muted-foreground">%</span>}</div>;
    }
    if (d.key === 'from_entity' || d.key === 'to_entity') {
      return <Suggest id={`ent-${d.key}`} value={String(v)} disabled={terkunci} onChange={x => setDetail(d.key, x)} options={(m?.entities ?? []).map(e => e.name)} />;
    }
    return <input value={String(v)} disabled={terkunci} onChange={e => setDetail(d.key, e.target.value)} className={`${inputCls} ${err(d.label)}`} maxLength={255} />;
  };

  const ringkas: [string, React.ReactNode][] = [
    ['Transaction Type', sub?.label ?? '—'],
    ['Amount', <b key="a" className="text-[#0F7D4E]">{rupiah(totalIdr)}</b>],
    [jenis.party_label, `${f.counterparty || '—'}${f.counterparty_code ? ` (${f.counterparty_code})` : ''}`],
    ...(sub?.extra_label && f.extra_amount > 0 ? [
      [f.type_key === 'capital_injection' ? 'Share Capital Portion' : 'Principal Portion', rupiah(f.amount - f.extra_amount)] as [string, React.ReactNode],
      [sub.extra_label, rupiah(f.extra_amount)] as [string, React.ReactNode],
    ] : []),
    ...((sub?.roles ?? []) as Role[]).map(p => [roleLabel(p), akunNama(f[`${p}_coa_id`])] as [string, React.ReactNode]),
    ...(f.type_key === 'loan_financing' && f.details.interest_rate ? [['Interest Rate (p.a)', `${f.details.interest_rate}%`] as [string, React.ReactNode]] : []),
    ...(f.type_key === 'loan_financing' && term ? [['Loan Term', `${term} months`] as [string, React.ReactNode]] : []),
    ...(ui.dueDateLabel && f.due_date ? [[ui.dueDateLabel, fmtDate(f.due_date)] as [string, React.ReactNode]] : []),
    ...(ui.claimPeriod && f.period_start ? [['Claim Period', `${fmtDate(f.period_start)} – ${fmtDate(f.period_end)}`] as [string, React.ReactNode]] : []),
    ...ui.details.filter(d => f.details[d.key] && !['interest_rate', 'loan_term_months'].includes(d.key))
      .map(d => [d.label, d.kind === 'date' ? fmtDate(String(f.details[d.key])) : String(f.details[d.key])] as [string, React.ReactNode]),
    ...(f.branch ? [['Branch', f.branch] as [string, React.ReactNode]] : []),
    ...(f.department ? [['Department', f.department] as [string, React.ReactNode]] : []),
  ];

  const panelJurnal = (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="bg-slate-50 text-left text-muted-foreground">
          <th className="px-2 py-2">#</th><th className="px-2 py-2">Account</th><th className="px-2 py-2">Description</th>
          <th className="px-2 py-2 text-right">Debit (Rp)</th><th className="px-2 py-2 text-right">Credit (Rp)</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {!baris.length && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{pvBusy ? 'Calculating...' : 'Fill in the amount and accounts to generate the journal.'}</td></tr>}
          {baris.map((l, i) => (
            <tr key={i}>
              <td className="px-2 py-2 align-top">{i + 1}</td>
              <td className="px-2 py-2 align-top"><b className="font-semibold">{kodeAkun(l.account_code)}</b><span className="block text-[10px] text-muted-foreground">{l.account_name}</span></td>
              <td className="px-2 py-2 align-top text-[11px]">{l.description}</td>
              <td className="px-2 py-2 text-right align-top">{l.debit ? l.debit.toLocaleString('id-ID') : '-'}</td>
              <td className="px-2 py-2 text-right align-top">{l.credit ? l.credit.toLocaleString('id-ID') : '-'}</td>
            </tr>
          ))}
        </tbody>
        {baris.length > 0 && <tfoot><tr className="bg-emerald-50/60 font-semibold">
          <td colSpan={3} className="px-2 py-2">Total</td>
          <td className="px-2 py-2 text-right">{baris.reduce((n, l) => n + l.debit, 0).toLocaleString('id-ID')}</td>
          <td className="px-2 py-2 text-right">{baris.reduce((n, l) => n + l.credit, 0).toLocaleString('id-ID')}</td>
        </tr></tfoot>}
      </table>
    </div>
  );
  const seimbang = terkunci ? true : !!pv?.balanced;

  const dropzone = (
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!terkunci) pilihFile(e.dataTransfer.files); }}
      onClick={() => !terkunci && fileRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground hover:bg-slate-50 ${terkunci ? 'pointer-events-none opacity-50' : ''}`}>
      <CloudUpload size={22} />
      <span>Drag &amp; drop files here or <span className="text-[#0F7D4E]">click to upload</span></span>
      <span className="text-[10px]">PDF, JPG, PNG (Max. 10 MB per file)</span>
      <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { pilihFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
  const daftarFile = (
    <ul className="space-y-1 text-xs">
      {t?.attachments?.map(a => (
        <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <FileText size={14} className="text-muted-foreground" />
          <a href={attachmentUrl(kid, a.id)} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline">{a.file_name}</a>
          <span className="text-muted-foreground">{(a.size_bytes / 1024).toFixed(0)} KB</span>
          {!terkunci && <button type="button" onClick={async () => { try { toast.success((await deleteAttachment(kid, a.id)).message); } catch (e) { toast.error((e as Error).message); } }}
            className="text-rose-500"><Trash2 size={13} /></button>}
        </li>
      ))}
      {files.map((x, i) => (
        <li key={`${x.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed border-[#22C55E] px-3 py-2">
          <Paperclip size={14} className="text-[#0F7D4E]" /><span className="flex-1 truncate">{x.name}</span>
          <span className="text-muted-foreground">{(x.size / 1024).toFixed(0)} KB · uploads on save</span>
          <button type="button" onClick={() => setFiles(s => s.filter((_, j) => j !== i))} className="text-muted-foreground"><X size={13} /></button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/transactions/other" className="hover:text-foreground">Other Transactions</Link><ChevronRight size={14} />
          <span>{ui.title}</span><ChevronRight size={14} /><span className="text-foreground">{editId ? t?.journal_no ?? 'Edit' : 'Create'}</span>
        </nav>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <TypeIcon type={f.type_key} size="lg" />
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-[#0B5E5C] sm:text-3xl">
                {editId ? `${t?.journal_no ?? ''} · ${ui.title}` : ui.title}
                <StatusPill s={statusTx} />
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{ui.subtitle}</p>
              {template && <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><BookOpen size={11} /> Template: {template.name}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/transactions/other" className={btnOutline}>Cancel</Link>
            {!terkunci && (
              <div className="flex">
                <button type="button" disabled={!!busy} onClick={() => simpan('draft')} className={`${btnPrimary} rounded-r-none`}>
                  {busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save as Draft
                </button>
                <Menu width="w-56" button={() => <button type="button" disabled={!!busy} className={`${btnPrimary} rounded-l-none border-l border-white/30 px-2.5`}><ChevronDown size={14} /></button>}>
                  {close => <>
                    <MenuItem onClick={() => { close(); simpan('submit'); }}><Send size={13} /> {f.requires_approval ? 'Submit for Review' : 'Submit (no approval)'}</MenuItem>
                    {bolehPost && <MenuItem onClick={() => { close(); post(); }}><CheckCircle2 size={13} /> Post to GL</MenuItem>}
                  </>}
                </Menu>
              </div>
            )}
          </div>
        </div>
        {terkunci && t && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {t.source === 'legacy' ? 'This journal was migrated from the old Other journal and cannot be edited. Reverse or delete it from the transaction list.'
              : `This transaction is ${t.status_label.toLowerCase()} and can no longer be edited.`}
          </div>
        )}
        {t?.status === 'rejected' && t.rejected_reason && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Rejected by {t.rejected_by_name ?? '—'}: {t.rejected_reason}</div>}

        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([judul, ket], i) => (
            <button key={judul} type="button" onClick={() => setStep(i)} className="flex items-center gap-3 text-left">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === step ? 'bg-[#0F7D4E] text-white' : i < step ? 'bg-emerald-100 text-emerald-700' : 'border border-border bg-card text-foreground'}`}>
                {i < step ? <CheckCircle2 size={16} /> : i + 1}
              </span>
              <span><span className={`block text-sm font-semibold ${i === step ? 'text-[#0F7D4E]' : 'text-foreground'}`}>{judul}</span><span className="text-xs text-muted-foreground">{ket}</span></span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_440px]">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-[#0B5E5C]">Transaction Information</h2>
                  <p className="text-xs text-muted-foreground">Fill in the details. The journal entry is generated automatically from the template rules.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField label="Transaction Type" required>
                    <select value={f.subtype} disabled={terkunci} onChange={e => gantiSub(e.target.value)} className={inputCls}>
                      {jenis.subtypes.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Transaction Date" required>
                    <input type="date" value={f.journal_date} disabled={terkunci} onChange={e => set('journal_date', e.target.value)} className={`${inputCls} ${err('Transaction Date')}`} />
                  </FormField>
                  <FormField label={jenis.party_label} required>
                    <Suggest id="ot-party" value={f.counterparty || ''} disabled={terkunci} onChange={v => set('counterparty', v)}
                      options={[...(f.type_key === 'intercompany' ? (m?.entities ?? []).map(e => e.name).filter(n => n !== m?.client_name) : []), ...(m?.suggestions.counterparty ?? [])]} />
                    {err(jenis.party_label) && <span className="text-[11px] text-rose-600">Required</span>}
                  </FormField>
                  {ui.partyCodeLabel ? (
                    <FormField label={ui.partyCodeLabel}>
                      <input value={f.counterparty_code || ''} disabled={terkunci} onChange={e => set('counterparty_code', e.target.value)} className={inputCls} maxLength={100} />
                    </FormField>
                  ) : (
                    <FormField label={ui.referenceLabel} required={ui.referenceRequired}>
                      <input value={f.reference_no || ''} disabled={terkunci} onChange={e => set('reference_no', e.target.value)} className={`${inputCls} ${err(ui.referenceLabel)}`} maxLength={100} />
                    </FormField>
                  )}
                  {ui.details.filter(d => d.kind === 'select' && d.key !== 'reimbursement_category').map(d => (
                    <FormField key={d.key} label={d.label} required={d.required}>{detailInput(d)}</FormField>
                  ))}
                  {ui.partyCodeLabel && (
                    <FormField label={ui.referenceLabel} required={ui.referenceRequired}>
                      <input value={f.reference_no || ''} disabled={terkunci} onChange={e => set('reference_no', e.target.value)} className={`${inputCls} ${err(ui.referenceLabel)}`} maxLength={100} />
                    </FormField>
                  )}
                  <FormField label={ui.descriptionLabel} required className="md:col-span-2">
                    <textarea value={f.description || ''} disabled={terkunci} onChange={e => set('description', e.target.value)} rows={2} maxLength={500}
                      className={`${inputCls} ${err(ui.descriptionLabel)}`} />
                    <span className="mt-0.5 block text-right text-[10px] text-muted-foreground">{(f.description || '').length}/500</span>
                  </FormField>
                  <FormField label="Amount" required>
                    <MoneyInput value={f.amount} disabled={terkunci} prefix={f.currency === 'IDR' ? 'Rp' : f.currency} onChange={v => set('amount', v)} />
                  </FormField>
                  <FormField label="Currency">
                    <select value={f.currency} disabled={terkunci} onChange={e => setF(x => ({ ...x, currency: e.target.value, exchange_rate: e.target.value === 'IDR' ? 1 : x.exchange_rate }))} className={inputCls}>
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </FormField>
                  {f.currency !== 'IDR' && (
                    <FormField label={`Exchange Rate (IDR per ${f.currency})`} required hint={`Journal amount: ${rupiah(totalIdr)}`}>
                      <input type="number" min={0} step="0.000001" value={f.exchange_rate} disabled={terkunci} onChange={e => set('exchange_rate', Number(e.target.value) || 0)} className={inputCls} />
                    </FormField>
                  )}
                  {sub?.extra_label && (f.type_key === 'capital_injection' ? <>
                    <FormField label="Share Capital Portion" required>
                      <MoneyInput value={Math.max(0, f.amount - f.extra_amount)} disabled={terkunci} onChange={v => set('extra_amount', Math.max(0, f.amount - v))} />
                    </FormField>
                    <FormField label={sub.extra_label} hint={f.amount ? `${((f.extra_amount / f.amount) * 100).toFixed(2)}% of the amount` : undefined}>
                      <MoneyInput value={f.extra_amount} disabled={terkunci} onChange={v => set('extra_amount', v)} />
                    </FormField>
                  </> : (
                    <FormField label={sub.extra_label} hint={`Principal portion: ${rupiah(Math.max(0, f.amount - f.extra_amount))}`}>
                      <MoneyInput value={f.extra_amount} disabled={terkunci} onChange={v => set('extra_amount', v)} />
                    </FormField>
                  ))}
                  {(sub?.roles ?? []).map(p => (
                    <FormField key={p} label={roleLabel(p)} required={sub?.lines.some(l => l.role === p && l.portion !== 'extra') || (p === 'extra' && f.extra_amount > 0)}>
                      <AccountSelect accounts={m?.accounts ?? []} value={f[`${p}_coa_id`]} disabled={terkunci} placeholder="Select account"
                        filter={p === 'bank' ? a => !!a.cash_type : undefined} onChange={v => set(`${p}_coa_id`, v)} />
                    </FormField>
                  ))}
                  {ui.details.filter(d => d.kind !== 'select' || d.key === 'reimbursement_category').map(d => (
                    <FormField key={d.key} label={d.label} required={d.required}>{detailInput(d)}</FormField>
                  ))}
                  {ui.dueDateLabel && (
                    <FormField label={ui.dueDateLabel}>
                      <input type="date" value={f.due_date ?? ''} disabled={terkunci} onChange={e => set('due_date', e.target.value || null)} className={inputCls} />
                    </FormField>
                  )}
                  {ui.claimPeriod && (
                    <FormField label="Claim Period" required>
                      <div className="flex items-center gap-2">
                        <input type="date" value={f.period_start ?? ''} disabled={terkunci} onChange={e => set('period_start', e.target.value || null)} className={`${inputCls} ${err('Claim Period')}`} />
                        <span className="text-muted-foreground">–</span>
                        <input type="date" value={f.period_end ?? ''} min={f.period_start ?? undefined} disabled={terkunci} onChange={e => set('period_end', e.target.value || null)} className={`${inputCls} ${err('Claim Period')}`} />
                      </div>
                    </FormField>
                  )}
                  {(['branch', 'department', 'project', 'cost_center'] as const).map(k => (
                    <FormField key={k} label={{ branch: 'Branch', department: 'Department', project: 'Project (Optional)', cost_center: 'Cost Center (Optional)' }[k]}>
                      <Suggest id={`ot-${k}`} value={f[k] || ''} disabled={terkunci} onChange={v => set(k, v)} options={m?.suggestions[k] ?? []} />
                    </FormField>
                  ))}
                  <FormField label="Notes (Optional)" className="md:col-span-2">
                    <textarea value={f.notes || ''} disabled={terkunci} onChange={e => set('notes', e.target.value)} rows={2} maxLength={500} placeholder="Add additional notes (optional)..." className={inputCls} />
                    <span className="mt-0.5 block text-right text-[10px] text-muted-foreground">{(f.notes || '').length}/500</span>
                  </FormField>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-[#0B5E5C]">Journal Preview</h2>
                    <p className="text-xs text-muted-foreground">Generated from the {sub?.label} rule of template {template?.name ?? jenis.name}.</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${seimbang ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{seimbang ? 'Balanced' : 'Not balanced'}</span>
                </div>
                {panelJurnal}
                {!terkunci && <IssueList issues={isu} />}
              </div>
            )}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-[#0B5E5C]">Supporting Document</h2>
                  <p className="text-xs text-muted-foreground">Attach invoices, agreements, receipts or approval memos. Files are uploaded when the transaction is saved.</p>
                </div>
                {dropzone}
                {daftarFile}
              </div>
            )}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-[#0B5E5C]">Review &amp; Submit</h2>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {ringkas.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-border py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>)}
                  <div className="flex justify-between gap-3 border-b border-border py-1.5"><dt className="text-muted-foreground">Supporting Documents</dt><dd>{(t?.attachments?.length ?? 0) + files.length}</dd></div>
                </dl>
                {!terkunci && <IssueList issues={isu} />}
                {wajibKosong.length > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Required before submitting: {wajibKosong.join(', ')}.</p>}
                <label className="flex items-start gap-3 rounded-xl border border-border p-3">
                  <input type="checkbox" checked={f.requires_approval} disabled={terkunci} onChange={e => set('requires_approval', e.target.checked)} className="mt-1" />
                  <span className="text-sm"><b className="font-medium">Requires approval</b>
                    <span className="block text-xs text-muted-foreground">This transaction must be approved in the Review Queue before it can be posted.{template?.auto_post ? ' The template posts it automatically once approved by a Manager+.' : ''}</span></span>
                </label>
                {!terkunci && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={!!busy} onClick={() => simpan('draft')} className={btnOutline}>{busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Draft</button>
                    <button type="button" disabled={!!busy || !!pv?.has_error} onClick={() => simpan('submit')} className={`${btnPrimary} bg-[#0E2F26] hover:bg-[#0B5E5C]`}>
                      {busy === 'submit' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {f.requires_approval ? 'Submit for Review' : 'Submit'}
                    </button>
                    <span className="flex flex-col items-center">
                      <button type="button" disabled={!bolehPost || !!busy} onClick={post} className={btnOutline}>{busy === 'post' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Post</button>
                      {!bolehPost && <span className="mt-0.5 text-[10px] text-muted-foreground">Posting is available after approval.</span>}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="mt-6 flex justify-between border-t border-border pt-4">
              <button type="button" disabled={step === 0} onClick={() => setStep(s => s - 1)} className={btnOutline}>Back</button>
              {step < STEPS.length - 1 && <button type="button" onClick={() => setStep(s => s + 1)} className={btnPrimary}>Next: {STEPS[step + 1][0]} <ChevronRight size={14} /></button>}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-emerald-100 bg-card shadow-sm">
              <h3 className="flex items-center gap-2 rounded-t-2xl bg-emerald-50/60 px-5 py-3 text-base font-bold text-[#0B5E5C]"><FileText size={17} /> Summary</h3>
              <dl className="space-y-2 px-5 py-4 text-sm">
                {ringkas.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>)}
              </dl>
            </section>
            <section className="rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between px-5 py-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-[#0B5E5C]"><BookOpen size={17} /> Journal Preview</h3>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${seimbang ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {pvBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} {seimbang ? 'Balanced' : 'Auto-generated'}
                </span>
              </div>
              <div className="px-3 pb-3">{panelJurnal}</div>
              <p className="mx-5 mb-4 flex gap-2 rounded-xl bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800">
                <Info size={14} className="mt-0.5 shrink-0" /> This journal entry is auto-generated from the {ui.title} template. You can preview the entry before submitting.
              </p>
            </section>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-[#0B5E5C]"><Paperclip size={17} /> Supporting Document</h3>
              {dropzone}
              <div className="mt-2">{daftarFile}</div>
            </section>
            <section className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-xs text-sky-900">
              <p className="mb-1 flex items-center gap-1.5 font-semibold"><Info size={14} /> About {ui.title}</p>
              <p>{ui.about}</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
