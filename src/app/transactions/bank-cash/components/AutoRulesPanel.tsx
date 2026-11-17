'use client';

// Panel "Auto-reconcile" di tab Reconciliation. Accounting mengatur sendiri apa yang di-auto-rekonsil (gaya Jurnal.id):
//  - Saklar per jenis: match invoice uang masuk (AR), match invoice uang keluar (AP), aturan tanpa invoice,
//    auto-approve hasil match invoice, dan baris confidence rendah.
//  - Aturan buatan sendiri, masing-masing bisa di-on/off: aturan AKUN (biaya admin, bunga: dicatat ke akun lawan) dan
//    aturan INVOICE (cocokkan ke 1 invoice AR/AP; syarat pihak/referensi/toleransi selisih).
// Hasil auto-match = transaksi DRAFT, atau APPROVED kalau auto-approve menyala. POST selalu manual di Journal Preview.
// Backend: /api/v1/transactions/bank-cash/auto-rules & /auto-settings (modules/transactions/bank_cash_willi.py).

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lightbulb, Pencil, Plus, SlidersHorizontal, Trash2, Wand2, Zap } from 'lucide-react';
import { formatIDR } from '../lib/formatMoney';
import type { AkunLawan } from '../lib/useBankReconciliation';
import type { BcAutoRule, BcAutoRuleInput, BcAutoRuleKind, BcAutoRuleSuggestion, BcAutoSettings } from '@/lib/bankCashStore';
import { kodeAkun } from '@/lib/accountCode';

const CARD = 'relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm';
const LABEL = 'min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600';
const PILL = 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium';
const INPUT = 'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none';
const FIELD_LABEL = 'mb-0.5 block text-[11px] font-medium text-neutral-600';
const BTN = 'rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50';
const BTN_PRIMARY = 'rounded-md bg-neutral-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50';

interface Props {
  /** Naik setiap kali halaman minta form aturan dibuka dari baris terpilih (tombol "Rule" di baris mutasi). */
  permintaanBuka?: number;
  aturan: BcAutoRule[];
  /** Saran aturan dari baris berulang yang sudah dicatat manual. */
  saran: BcAutoRuleSuggestion[];
  akun: AkunLawan[];
  autoSetelahUpload: boolean;
  /** Saklar auto-match per jenis (AR / AP / aturan), auto-approve invoice, baris confidence rendah. */
  pengaturan: BcAutoSettings;
  onUbahPengaturan: (patch: Partial<BcAutoSettings>) => Promise<unknown>;
  /** Baris yang sedang dipilih di kolom kiri -- dipakai untuk mengisi form otomatis. */
  mutasiTerpilih: { description: string; debit: number; credit: number } | null;
  onSave: (input: BcAutoRuleInput, id?: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onToggleUpload: (aktif: boolean) => Promise<unknown>;
}

interface FormState {
  id?: string;
  name: string;
  direction: 'payment' | 'receipt';
  keywords: string;
  amounts: string;
  maxAmount: string;
  bankCoaId: string;
  counterCoaId: string;
  category: string;
  counterparty: string;
  isActive: boolean;
  autoApprove: boolean;
  kind: BcAutoRuleKind;
  keywordMode: 'any' | 'all';
  excludeKeywords: string;
  referenceKeywords: string;
  counterpartyKeywords: string;
  minAmount: string;
  tolerance: string;
  priority: string;
}

const KOSONG: FormState = {
  name: '', direction: 'payment', keywords: '', amounts: '', maxAmount: '', bankCoaId: '', counterCoaId: '',
  category: 'Bank admin fee', counterparty: '', isActive: true, autoApprove: false,
  kind: 'account', keywordMode: 'any', excludeKeywords: '', referenceKeywords: '', counterpartyKeywords: '',
  minAmount: '', tolerance: '', priority: '100',
};

// "2.500; 6.500" / "2500 6500" / "2500,6500" / "2.500,50" -> [2500, 6500] (null kalau ada yang tidak terbaca).
function bacaNominal(teks: string): number[] | null {
  const hasil: number[] = [];
  for (const tok of teks.replace(/rp/gi, '').split(/[;\s/]+/).filter(Boolean)) {
    const coba = (t: string): number | null => {
      if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
      if (/^\d+(,\d{1,2})$/.test(t)) return Number(t.replace(',', '.'));
      if (/^\d+(\.\d{1,2})?$/.test(t)) return Number(t);
      return null;
    };
    const langsung = coba(tok);
    if (langsung !== null) { hasil.push(langsung); continue; }
    if (tok.includes(',')) {
      const bagian = tok.split(',').filter(Boolean).map(coba);
      if (bagian.length && bagian.every((x) => x !== null)) { hasil.push(...(bagian as number[])); continue; }
    }
    return null;
  }
  return hasil;
}

// Tebakan kata kunci dari keterangan mutasi: 3 kata pertama yang bukan angka (bisa diedit sebelum disimpan).
function tebakKataKunci(keterangan: string): string {
  return keterangan
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 3)
    .join(' ');
}

// "2.500" / "1500000" -> angka tunggal; kosong -> null; tidak terbaca -> undefined.
function bacaSatu(teks: string): number | null | undefined {
  if (!teks.trim()) return null;
  const x = bacaNominal(teks);
  return x && x.length === 1 ? x[0] : undefined;
}

const daftarKata = (t: string | null) => (t ?? '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const kataTeks = (t: string | null, sambung = ' or ') => daftarKata(t).map((x) => `“${x}”`).join(sambung);

const nominalTeks = (r: BcAutoRule) => {
  const bagian: string[] = [];
  if (r.amounts.length) {
    bagian.push(r.amounts.map((a) => formatIDR(a)).join(' / ') + (r.kind === 'account' && r.amount_tolerance ? ` (±${formatIDR(r.amount_tolerance)})` : ''));
  } else if (r.min_amount != null || r.max_amount != null) {
    bagian.push(`${r.min_amount != null ? `${formatIDR(r.min_amount)} ` : ''}${r.min_amount != null && r.max_amount != null ? '–' : '≤'} ${r.max_amount != null ? formatIDR(r.max_amount) : ''}`.replace(/\s+/g, ' ').trim());
  } else if (r.kind === 'invoice') {
    bagian.push('any amount that fits an invoice');
  } else {
    bagian.push('—');
  }
  return bagian.join(' ');
};

// Ringkasan syarat aturan untuk daftar (kata kunci, referensi, pihak, pengecualian, nominal, rekening).
const syaratTeks = (r: BcAutoRule) => {
  const bagian: string[] = [];
  if (daftarKata(r.keywords).length) bagian.push(`contains ${kataTeks(r.keywords, r.keyword_mode === 'all' ? ' and ' : ' or ')}`);
  if (daftarKata(r.reference_keywords).length) bagian.push(`reference ${kataTeks(r.reference_keywords)}`);
  if (daftarKata(r.counterparty_keywords).length) bagian.push(`party ${kataTeks(r.counterparty_keywords)}`);
  if (daftarKata(r.exclude_keywords).length) bagian.push(`not ${kataTeks(r.exclude_keywords)}`);
  bagian.push(nominalTeks(r));
  if (r.bank_account) bagian.push(`only ${r.bank_account}`);
  return bagian.join(' · ');
};

const tujuanTeks = (r: BcAutoRule) =>
  r.kind === 'invoice'
    ? `→ matched to the open ${r.direction === 'payment' ? 'Purchase' : 'Sales'} invoice${r.amount_tolerance ? ` (difference up to ${formatIDR(r.amount_tolerance)} closed by adjustment)` : ''}`
    : `→ ${r.counter_account_code ? kodeAkun(r.counter_account_code) : '?'} ${r.counter_account_name ?? ''}`;

// Baris saklar: kotak centang + judul + penjelasan singkat.
function Saklar({ checked, onChange, disabled, judul, petunjuk, anak }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; judul: string; petunjuk: string; anak?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 ${anak ? 'ml-6' : ''} ${disabled ? 'text-neutral-400' : 'text-neutral-800'}`}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[11px]">
        <span className="font-medium">{judul}</span>
        <span className={disabled ? 'block text-neutral-400' : 'block text-neutral-500'}>{petunjuk}</span>
      </span>
    </label>
  );
}

export default function AutoRulesPanel({ aturan, saran, akun, autoSetelahUpload, pengaturan, onUbahPengaturan, mutasiTerpilih, permintaanBuka, onSave, onDelete, onToggleUpload }: Props) {
  const kartuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const akunLawan = akun.filter((a) => !a.jenis_kas);
  const akunBank = akun.filter((a) => !!a.jenis_kas);
  const label = (a: AkunLawan) => `${kodeAkun(a.no_akun)} · ${a.nama_akun}`;
  const aktif = aturan.filter((r) => r.is_active).length;

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const mulaiBaru = () => {
    if (mutasiTerpilih) {
      const nominal = mutasiTerpilih.credit || mutasiTerpilih.debit;
      const kata = tebakKataKunci(mutasiTerpilih.description);
      setForm({
        ...KOSONG,
        name: kata ? kata.replace(/\b\w/g, (c) => c.toUpperCase()) : '',
        direction: mutasiTerpilih.credit ? 'receipt' : 'payment',
        keywords: kata,
        amounts: String(nominal),
        category: mutasiTerpilih.credit ? 'Bank interest' : 'Bank admin fee',
      });
    } else {
      setForm({ ...KOSONG });
    }
    setOpen(true);
  };

  // Tombol "Rule" di baris mutasi: baris sudah dipilih oleh halaman, jadi form langsung terisi dari baris itu.
  useEffect(() => {
    if (!permintaanBuka) return;
    mulaiBaru();
    kartuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [permintaanBuka]); // eslint-disable-line react-hooks/exhaustive-deps

  const nominalSaran = (x: BcAutoRuleSuggestion) =>
    x.amounts.length ? x.amounts.map((a) => formatIDR(a)).join(' / ') : x.max_amount != null ? `≤ ${formatIDR(x.max_amount)}` : '—';

  const saranKeInput = (x: BcAutoRuleSuggestion): BcAutoRuleInput => ({
    name: x.name, direction: x.direction, keywords: x.keywords,
    amounts: x.amounts.length ? x.amounts : null, max_amount: x.max_amount,
    bank_coa_id: null, counter_coa_id: x.counter_coa_id, category: x.category,
    counterparty: x.counterparty, is_active: true, auto_approve: false,
  });

  const buatDariSaran = async (x: BcAutoRuleSuggestion) => {
    try {
      await onSave(saranKeInput(x));
      toast.success(`Rule “${x.name}” created.${x.pending_unmatched ? ` ${x.pending_unmatched} waiting line(s) are covered on the next Auto-match.` : ''}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create the rule.');
    }
  };

  const editDariSaran = (x: BcAutoRuleSuggestion) => {
    setForm({
      ...KOSONG, name: x.name, direction: x.direction, keywords: x.keywords, amounts: x.amounts.join('; '),
      maxAmount: x.max_amount != null ? String(x.max_amount) : '', counterCoaId: x.counter_coa_id,
      category: x.category, counterparty: x.counterparty ?? '',
    });
    setOpen(true);
  };

  const mulaiUbah = (r: BcAutoRule) => {
    setForm({
      id: r.id, name: r.name, direction: r.direction, keywords: r.keywords,
      amounts: r.amounts.join('; '), maxAmount: r.max_amount != null ? String(r.max_amount) : '',
      bankCoaId: r.bank_coa_id ?? '', counterCoaId: r.counter_coa_id ?? '', category: r.category,
      counterparty: r.counterparty ?? '', isActive: r.is_active, autoApprove: r.auto_approve,
      kind: r.kind ?? 'account', keywordMode: r.keyword_mode ?? 'any', excludeKeywords: r.exclude_keywords ?? '',
      referenceKeywords: r.reference_keywords ?? '', counterpartyKeywords: r.counterparty_keywords ?? '',
      minAmount: r.min_amount != null ? String(r.min_amount) : '', tolerance: r.amount_tolerance != null ? String(r.amount_tolerance) : '',
      priority: String(r.priority ?? 100),
    });
    setOpen(true);
  };

  const inputDari = (f: FormState): BcAutoRuleInput | null => {
    const invoice = f.kind === 'invoice';
    const amounts = invoice ? [] : bacaNominal(f.amounts);
    if (amounts === null) { toast.error('Amounts could not be read. Use e.g. 2.500; 6.500'); return null; }
    const max = f.maxAmount.trim() ? bacaNominal(f.maxAmount) : [];
    if (max === null || max.length > 1) { toast.error('Maximum amount must be a single number.'); return null; }
    const min = bacaSatu(f.minAmount);
    if (min === undefined) { toast.error('Minimum amount must be a single number.'); return null; }
    const tol = bacaSatu(f.tolerance);
    if (tol === undefined) { toast.error('Tolerance must be a single number.'); return null; }
    if (min != null && max.length && min > max[0]) { toast.error('Minimum amount cannot be above the maximum amount.'); return null; }
    const prioritas = Number(f.priority.trim() || '100');
    if (!Number.isInteger(prioritas) || prioritas < 1 || prioritas > 9999) { toast.error('Priority must be a whole number from 1 to 9999.'); return null; }
    return {
      name: f.name.trim(), direction: f.direction, keywords: f.keywords.trim(),
      amounts: amounts.length ? amounts : null, max_amount: max.length ? max[0] : null,
      bank_coa_id: f.bankCoaId || null, counter_coa_id: invoice ? null : f.counterCoaId,
      category: f.category.trim() || (invoice ? 'Invoice settlement' : 'Bank admin fee'), counterparty: f.counterparty.trim() || null,
      is_active: f.isActive,
      auto_approve: invoice ? f.autoApprove : f.autoApprove && amounts.length > 0 && !max.length,
      kind: f.kind, keyword_mode: f.keywordMode,
      exclude_keywords: f.excludeKeywords.trim() || null, reference_keywords: f.referenceKeywords.trim() || null,
      counterparty_keywords: f.counterpartyKeywords.trim() || null,
      min_amount: min, amount_tolerance: tol, priority: prioritas,
    };
  };

  const simpan = async () => {
    if (!form) return;
    if (form.kind === 'account' && (!form.name.trim() || !form.keywords.trim() || !form.counterCoaId)) {
      toast.error('Name, keywords and counter account are required.');
      return;
    }
    if (form.kind === 'invoice' && (!form.name.trim() || !(form.keywords.trim() || form.referenceKeywords.trim() || form.counterpartyKeywords.trim()))) {
      toast.error('Name and at least one keyword, reference or counterparty are required, so the rule cannot match every transfer.');
      return;
    }
    const input = inputDari(form);
    if (!input) return;
    setSaving(true);
    try {
      await onSave(input, form.id);
      toast.success(form.id ? 'Auto rule updated.' : 'Auto rule saved. It is used the next time you run Auto-match.');
      setForm(null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the auto rule.');
    } finally {
      setSaving(false);
    }
  };

  const ubahAktif = async (r: BcAutoRule) => {
    try {
      await onSave({
        name: r.name, direction: r.direction, keywords: r.keywords,
        amounts: r.amounts.length ? r.amounts : null, max_amount: r.max_amount,
        bank_coa_id: r.bank_coa_id, counter_coa_id: r.counter_coa_id, category: r.category,
        counterparty: r.counterparty, is_active: !r.is_active, auto_approve: r.auto_approve,
        kind: r.kind, keyword_mode: r.keyword_mode, exclude_keywords: r.exclude_keywords,
        reference_keywords: r.reference_keywords, counterparty_keywords: r.counterparty_keywords,
        min_amount: r.min_amount, amount_tolerance: r.amount_tolerance, priority: r.priority,
      }, r.id);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update the rule.');
    }
  };

  const hapus = async (r: BcAutoRule) => {
    if (!window.confirm(`Delete the rule "${r.name}"? Transactions it already recorded are not changed.`)) return;
    try {
      await onDelete(r.id);
      toast.success('Auto rule deleted.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete the rule.');
    }
  };

  const toggleUpload = async (v: boolean) => {
    try {
      await onToggleUpload(v);
      toast.success(v ? 'Auto-match will run automatically after each upload and when an invoice is posted.' : 'Automatic Auto-match is off.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the setting.');
    }
  };

  const ubahPengaturan = async (patch: Partial<BcAutoSettings>, pesan: string) => {
    try {
      await onUbahPengaturan(patch);
      toast.success(pesan);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the setting.');
    }
  };

  return (
    <div ref={kartuRef} className={`${CARD} !pt-4`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 size={14} className="text-neutral-700" />
          <p className={LABEL}>Auto-reconcile — your rules &amp; controls</p>
          <span className={`${PILL} border-neutral-300 bg-neutral-100 text-neutral-700`}>{aktif} active</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={mulaiBaru} className={`${BTN_PRIMARY} inline-flex items-center gap-1`}>
            <Plus size={12} /> {mutasiTerpilih ? 'Rule from selected line' : 'New rule'}
          </button>
          <button onClick={() => setOpen((o) => !o)} className="text-[11px] font-medium text-neutral-600 underline hover:text-neutral-900">
            {open ? 'Hide' : 'Manage'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-neutral-600">
        You decide what is reconciled automatically. Turn each type on or off below and add your own rules:
        account rules record recurring lines without an invoice (bank admin fees such as 2.500 / 6.500, interest) to the account you choose;
        invoice rules match a transfer to one AR/AP invoice using the customer/vendor, a reference or an allowed difference.
        Auto-match runs{autoSetelahUpload ? ' automatically after each upload and invoice posting, or when you press Auto-match' : ' when you press Auto-match'}.
        Results are saved as DRAFT journals (or APPROVED where you turned on Auto-approve); Post is always manual. Tip: press “Rule” on a line below to start a rule from it.
      </p>

      <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800">
          <SlidersHorizontal size={13} /> What should Auto-match do?
          <span className="font-normal text-neutral-500">(changing these needs Level 5)</span>
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Saklar
              checked={pengaturan.auto_match_ar}
              onChange={(v) => ubahPengaturan({ auto_match_ar: v }, v ? 'Money-in lines will be matched to Sales invoices automatically.' : 'Money-in invoice matching is off. These lines stay for manual review.')}
              judul="Match money in to Sales invoices (AR)"
              petunjuk="When the amount equals the open invoice and the invoice no. or customer name is in the description."
            />
            <Saklar
              anak checked={pengaturan.auto_approve_ar} disabled={!pengaturan.auto_match_ar}
              onChange={(v) => ubahPengaturan({ auto_approve_ar: v }, v ? 'AR invoice matches will be saved as APPROVED (Post stays manual).' : 'AR invoice matches will be saved as DRAFT.')}
              judul="Auto-approve these matches"
              petunjuk="Skip the Approve step. Post stays manual."
            />
            <Saklar
              checked={pengaturan.auto_match_ap}
              onChange={(v) => ubahPengaturan({ auto_match_ap: v }, v ? 'Money-out lines will be matched to Purchase invoices automatically.' : 'Money-out invoice matching is off. These lines stay for manual review.')}
              judul="Match money out to Purchase invoices (AP)"
              petunjuk="When the amount equals the open invoice and the invoice no. or vendor name is in the description."
            />
            <Saklar
              anak checked={pengaturan.auto_approve_ap} disabled={!pengaturan.auto_match_ap}
              onChange={(v) => ubahPengaturan({ auto_approve_ap: v }, v ? 'AP invoice matches will be saved as APPROVED (Post stays manual).' : 'AP invoice matches will be saved as DRAFT.')}
              judul="Auto-approve these matches"
              petunjuk="Skip the Approve step. Post stays manual."
            />
          </div>
          <div className="space-y-1.5">
            <Saklar
              checked={pengaturan.auto_match_rules}
              onChange={(v) => ubahPengaturan({ auto_match_rules: v }, v ? 'Account rules are on.' : 'Account rules are off. Lines without an invoice stay for manual review.')}
              judul="Apply account rules (lines without an invoice)"
              petunjuk="Bank admin fees, interest, tax. Each rule below can also be turned on or off on its own."
            />
            <Saklar
              checked={pengaturan.auto_include_low_confidence}
              onChange={(v) => ubahPengaturan({ auto_include_low_confidence: v }, v ? 'Low-confidence lines will be matched too, as DRAFT only.' : 'Low-confidence lines are skipped until reviewed.')}
              judul="Include low-confidence lines"
              petunjuk="Lines the reader was unsure about are normally skipped until you review them. When on, they are matched too but always saved as DRAFT, never auto-approved."
            />
            <label className="flex items-start gap-2 text-neutral-800">
              <input type="checkbox" className="mt-0.5" checked={autoSetelahUpload} onChange={(e) => toggleUpload(e.target.checked)} />
              <span className="text-[11px]">
                <span className="inline-flex items-center gap-1 font-medium"><Zap size={12} /> Run Auto-match automatically</span>
                <span className="block text-neutral-500">After each upload and when an invoice is posted.</span>
              </span>
            </label>
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">
          Invoice rules you create below always run when switched on, whatever the invoice switches above say. Auto-approve never applies to a line that needed an adjustment or was low-confidence.
        </p>
      </div>

      {saran.length > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-amber-300 border-l-[3px] border-l-amber-500 bg-amber-50 px-2.5 py-1.5 text-left text-[11px] font-medium text-amber-900 hover:bg-amber-100"
        >
          <Lightbulb size={12} className="shrink-0" />
          {saran.length} suggested rule{saran.length > 1 ? 's' : ''} found from lines you recorded by hand — review
        </button>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          {saran.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <Lightbulb size={13} /> Suggested rules — lines you keep recording by hand
              </p>
              <div className="divide-y divide-amber-200">
                {saran.map((x) => (
                  <div key={`${x.direction}|${x.keywords}|${x.counter_coa_id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-neutral-900">
                        “{x.keywords}” · {x.direction === 'payment' ? 'Out' : 'In'} · {nominalSaran(x)}
                      </p>
                      <p className="truncate text-[11px] text-neutral-600">
                        recorded {x.occurrences}× by hand → {x.counter_account_code ? kodeAkun(x.counter_account_code) : '?'} {x.counter_account_name}
                        {x.pending_unmatched > 0 ? ` · ${x.pending_unmatched} line(s) waiting now` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => editDariSaran(x)} className={BTN}>Edit first</button>
                      <button onClick={() => buatDariSaran(x)} className={BTN_PRIMARY}>Create rule</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {aturan.length === 0 && !form && (
            <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-center text-[11px] text-neutral-500">
              No rules yet. Select a line on the left, then press “Rule from selected line” — or press “New rule” to match transfers from a customer/vendor to their invoices.
            </p>
          )}

          {aturan.length > 0 && (
            <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
              {aturan.map((r) => (
                <div key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${r.is_active ? '' : 'opacity-50'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-neutral-900">
                      {r.name}{' '}
                      <span className={`${PILL} !py-0 ${r.direction === 'payment' ? 'border-rose-300 bg-rose-100 text-rose-800' : 'border-emerald-300 bg-emerald-100 text-emerald-800'}`}>
                        {r.direction === 'payment' ? 'Out' : 'In'}
                      </span>
                      <span className={`${PILL} ml-1 !py-0 border-neutral-300 bg-neutral-100 text-neutral-700`}>
                        {r.kind === 'invoice' ? 'Invoice rule' : 'Account rule'}
                      </span>
                      {r.auto_approve && (
                        <span className={`${PILL} ml-1 !py-0 border-amber-300 bg-amber-100 text-amber-900`}>Auto-approve</span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-neutral-500" title={`${syaratTeks(r)} ${tujuanTeks(r)}`}>
                      {syaratTeks(r)} {tujuanTeks(r)}
                      {r.priority !== 100 ? ` · priority ${r.priority}` : ''}
                      {` · used ${r.usage_count}×`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => ubahAktif(r)} className={BTN}>{r.is_active ? 'Disable' : 'Enable'}</button>
                    <button onClick={() => mulaiUbah(r)} className={BTN} aria-label="Edit rule"><Pencil size={12} /></button>
                    <button onClick={() => hapus(r)} className={`${BTN} hover:!border-red-300 hover:!bg-red-50 hover:!text-red-600`} aria-label="Delete rule"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {form && (
            <div className="space-y-3 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
              <p className="text-xs font-semibold text-neutral-800">{form.id ? 'Edit rule' : 'New rule'}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className={FIELD_LABEL}>What should this rule do?</label>
                  <select className={INPUT} value={form.kind} onChange={(e) => set({ kind: e.target.value as BcAutoRuleKind, autoApprove: false })}>
                    <option value="account">Record the line to an account — no invoice (bank fee, interest, tax, …)</option>
                    <option value="invoice">Match the line to an AR/AP invoice (customer or vendor payments)</option>
                  </select>
                </div>
                <div>
                  <label className={FIELD_LABEL}>Rule name</label>
                  <input className={INPUT} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={form.kind === 'invoice' ? 'PT Sinar Jaya payments' : 'Bank admin fee'} />
                </div>
                <div>
                  <label className={FIELD_LABEL}>Direction</label>
                  <select className={INPUT} value={form.direction} onChange={(e) => set({ direction: e.target.value as 'payment' | 'receipt' })}>
                    <option value="payment">{form.kind === 'invoice' ? 'Money out (debit) — Purchase invoices' : 'Money out (debit) — fees, tax'}</option>
                    <option value="receipt">{form.kind === 'invoice' ? 'Money in (credit) — Sales invoices' : 'Money in (credit) — interest'}</option>
                  </select>
                </div>
                <div>
                  <label className={FIELD_LABEL}>Only for bank account (optional)</label>
                  <select className={INPUT} value={form.bankCoaId} onChange={(e) => set({ bankCoaId: e.target.value })}>
                    <option value="">All bank accounts</option>
                    {akunBank.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">When the line…</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className={FIELD_LABEL}>
                      Keywords in the description (separate with , or ;){form.kind === 'invoice' ? ' — optional' : ''}
                    </label>
                    <input className={INPUT} value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="biaya adm; adm fee" />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Keyword match</label>
                    <select className={INPUT} value={form.keywordMode} onChange={(e) => set({ keywordMode: e.target.value as 'any' | 'all' })}>
                      <option value="any">Any keyword is enough</option>
                      <option value="all">All keywords must appear</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={FIELD_LABEL}>
                      {form.kind === 'invoice' ? 'Customer / vendor name (only invoices of this party are matched)' : 'Counterparty name in the description (optional)'}
                    </label>
                    <input className={INPUT} value={form.counterpartyKeywords} onChange={(e) => set({ counterpartyKeywords: e.target.value })} placeholder={form.kind === 'invoice' ? 'sinar jaya' : 'e.g. bca'} />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Reference no. in the description (optional)</label>
                    <input className={INPUT} value={form.referenceKeywords} onChange={(e) => set({ referenceKeywords: e.target.value })} placeholder="TRX-; INV/2026" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={FIELD_LABEL}>Never apply when the description contains (optional)</label>
                    <input className={INPUT} value={form.excludeKeywords} onChange={(e) => set({ excludeKeywords: e.target.value })} placeholder="reversal; koreksi" />
                  </div>
                  {form.kind === 'account' && (
                    <div>
                      <label className={FIELD_LABEL}>Exact amounts (e.g. 2.500; 6.500)</label>
                      <input className={INPUT} value={form.amounts} onChange={(e) => set({ amounts: e.target.value })} placeholder="2.500; 6.500" />
                    </div>
                  )}
                  <div>
                    <label className={FIELD_LABEL}>{form.kind === 'account' ? '…or maximum amount (when amounts vary)' : 'Maximum amount (optional)'}</label>
                    <input className={INPUT} value={form.maxAmount} onChange={(e) => set({ maxAmount: e.target.value })} placeholder={form.kind === 'account' ? 'Only used if no exact amounts' : 'No limit'} />
                  </div>
                  <div>
                    <label className={FIELD_LABEL}>Minimum amount (optional)</label>
                    <input className={INPUT} value={form.minAmount} onChange={(e) => set({ minAmount: e.target.value })} placeholder="No minimum" />
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">…then</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {form.kind === 'account' ? (
                    <>
                      <div className="sm:col-span-2">
                        <label className={FIELD_LABEL}>Record to account</label>
                        <select className={INPUT} value={form.counterCoaId} onChange={(e) => set({ counterCoaId: e.target.value })}>
                          <option value="">Select account…</option>
                          {akunLawan.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={FIELD_LABEL}>Category</label>
                        <input className={INPUT} value={form.category} onChange={(e) => set({ category: e.target.value })} />
                      </div>
                      <div>
                        <label className={FIELD_LABEL}>Amount tolerance ± (optional)</label>
                        <input className={INPUT} value={form.tolerance} onChange={(e) => set({ tolerance: e.target.value })} placeholder="Applies to exact amounts" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="sm:col-span-2">
                        <p className="text-[11px] text-neutral-600">
                          The line is matched to the single open {form.direction === 'payment' ? 'Purchase' : 'Sales'} invoice whose remaining balance equals the amount.
                          If two invoices fit equally well, the line is left for manual review.
                        </p>
                      </div>
                      <div>
                        <label className={FIELD_LABEL}>Allowed difference (optional)</label>
                        <input className={INPUT} value={form.tolerance} onChange={(e) => set({ tolerance: e.target.value })} placeholder="e.g. 5.000 — closed by adjustment" />
                      </div>
                    </>
                  )}
                  <div>
                    <label className={FIELD_LABEL}>Priority (1 = tried first)</label>
                    <input className={INPUT} value={form.priority} onChange={(e) => set({ priority: e.target.value })} />
                  </div>
                </div>
                {form.kind === 'invoice' && (
                  <p className="text-[11px] text-neutral-500">
                    A difference is only absorbed when it is within this rule&apos;s allowed difference, within the adjustment limit, and the adjustment account is set in Settings &gt; Account Mapping.
                  </p>
                )}
              </div>
              {(() => {
                const nominalPersis = form.kind === 'invoice' || ((bacaNominal(form.amounts) ?? []).length > 0 && !form.maxAmount.trim());
                return (
                  <label className={`flex items-start gap-1.5 text-[11px] ${nominalPersis ? 'text-neutral-800' : 'text-neutral-400'}`}>
                    <input
                      type="checkbox" className="mt-0.5" disabled={!nominalPersis}
                      checked={form.autoApprove && nominalPersis}
                      onChange={(e) => set({ autoApprove: e.target.checked })}
                    />
                    <span>
                      Auto-approve results of this rule (skip the Approve step; Post stays manual).
                      {form.kind === 'invoice' && ' Not applied when the line needed an adjustment.'}
                      {!nominalPersis && ' Only available with exact amounts and no maximum amount.'}
                    </span>
                  </label>
                );
              })()}
              <p className="text-[11px] text-neutral-500">
                A line matches only when its direction, conditions and amount all fit.
                {form.kind === 'account' ? ' Exact amounts (or a maximum) are required so the rule can never swallow a large transaction.' : ' At least one keyword, reference or customer/vendor name is required.'}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setForm(null)} disabled={saving} className={BTN}>Cancel</button>
                <button onClick={simpan} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save rule'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
