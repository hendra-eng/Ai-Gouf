'use client';

// Form Record Receipt (AR) / Record Payment (AP) -- layout mengikuti
// dataset/picture/Template UI/Account Receivable/2.jpeg: Receipt Information,
// Allocate to Invoices, Receipt Summary, lalu Cancel / Save Draft / Print
// Receipt / Submit. Disimpan backend sebagai transaksi Cash & Bank
// (source 'ar' / 'ap'); Submit oleh Manager+ langsung posted, Supervisor ->
// menunggu Post. Mode edit: ?id=<settlement>. Prefill: ?party=..&invoice=..

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CreditCard, FileText, Filter, Landmark,
  Loader2, Printer, RotateCcw, Save, Search, Wallet,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { useBcAccounts } from '@/lib/bankCashStore';
import {
  amountInWords, createSettlement, fetchArApDocs, fetchArApParties, fetchNextSettlementNumber, fetchSettlement, fmtDate,
  LEVEL_INPUT, LEVEL_POST, PAYMENT_METHOD_LABEL, roleLevel, rupiah, SIDE_CONFIG, todayIso, updateSettlement, useArApData,
  type ArApDoc, type ArApParty, type ArApSide, type PaymentMethod, type Settlement, type SettlementInput,
} from '@/lib/receivablesPayablesStore';
import { buildVoucherPdf } from './arapExport';
import { btnOutline, btnPrimary, inputCls, SettlementBadge } from './arapUi';
import { useReportHeader } from './StatementsTab';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const angka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const parseUang = (s: string) => {
  const bersih = s.replace(/[^\d,]/g, '').replace(',', '.');
  const n = Number(bersih);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function MoneyInput({ value, onChange, disabled, autoFocus, className = '' }: {
  value: number; onChange: (n: number) => void; disabled?: boolean; autoFocus?: boolean; className?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [teks, setTeks] = useState(value ? angka.format(value) : '');
  const fokus = useRef(false);
  useEffect(() => { if (!fokus.current) setTeks(value ? angka.format(value) : ''); }, [value]);
  return (
    <div className={`flex items-center rounded-lg border px-2.5 ${disabled ? 'border-border bg-slate-50 text-muted-foreground' : 'border-border bg-card focus-within:border-[#22C55E] focus-within:ring-2 focus-within:ring-[#22C55E]/20'} ${className}`}>
      <span className="text-xs text-muted-foreground">Rp</span>
      <input
        value={teks} disabled={disabled} autoFocus={autoFocus} inputMode="decimal" placeholder="0"
        onFocus={() => { fokus.current = true; }}
        onBlur={() => { fokus.current = false; setTeks(value ? angka.format(value) : ''); }}
        onChange={e => { setTeks(e.target.value); onChange(parseUang(e.target.value)); }}
        className="w-full bg-transparent px-1.5 py-1.5 text-right text-sm focus:outline-none"
      />
    </div>
  );
}

export function Label({ children, wajib }: { children: React.ReactNode; wajib?: boolean }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return <label className="mb-1 block text-sm font-medium text-foreground">{children}{wajib && <span className="ml-0.5 text-rose-500">*</span>}</label>;
}

/** Combobox pihak (customer / vendor) dengan pencarian. */
function PartyPicker({ side, parties, value, onChange, disabled }: {
  side: ArApSide; parties: ArApParty[]; value: string; onChange: (p: string) => void; disabled?: boolean;
}) {
  const cfg = SIDE_CONFIG[side];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const tutup = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [open]);
  const pilih = parties.find(p => p.name === value);
  const daftar = parties.filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => b.outstanding - a.outstanding);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left disabled:bg-slate-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#0F7D4E]"><Building2 size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{value || `Select ${cfg.party.toLowerCase()}...`}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {pilih ? `${pilih.open_count} open ${pilih.open_count === 1 ? cfg.doc.toLowerCase() : cfg.docs.toLowerCase()} · ${rupiah(pilih.outstanding)}${pilih.tax_id ? ` · ${side === 'ar' ? 'NPWP' : 'Code'}: ${pilih.tax_id}` : ''}` : `${cfg.parties} with posted ${cfg.docs.toLowerCase()}`}
          </span>
        </span>
        {!disabled && <ChevronDown size={16} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg">
          <label className="mb-1 flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}...`} className="w-full bg-transparent text-sm focus:outline-none" />
          </label>
          <div className="max-h-72 overflow-y-auto">
            {daftar.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">No {cfg.parties.toLowerCase()} found.</p>}
            {daftar.map(p => (
              <button key={p.name} type="button" onClick={() => { onChange(p.name); setOpen(false); setQ(''); }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${p.name === value ? 'bg-[#ECFDF5]' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{p.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.open_count} open · {p.invoice_count} total{p.tax_id ? ` · ${p.tax_id}` : ''}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${p.overdue ? 'text-rose-600' : 'text-foreground'}`}>{rupiah(p.outstanding)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettlementFormInner({ side }: { side: ArApSide }) {
  const cfg = SIDE_CONFIG[side];
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');
  const { activeClientId } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const { user } = useAuth();
  const level = roleLevel(user?.role);
  const header = useReportHeader();
  const listHref = `${cfg.basePath}?tab=settlements`;

  const [asal, setAsal] = useState<Settlement | null>(null);
  const [memuat, setMemuat] = useState(!!editId);
  const [party, setParty] = useState(params.get('party') ?? '');
  const [tanggal, setTanggal] = useState(todayIso());
  const [nomor, setNomor] = useState('');
  const [nomorManual, setNomorManual] = useState(false);
  const [metode, setMetode] = useState<PaymentMethod>('bank_transfer');
  const [bankId, setBankId] = useState('');
  const [referensi, setReferensi] = useState('');
  const [tglRef, setTglRef] = useState('');
  const [catatan, setCatatan] = useState('');
  const [alokasi, setAlokasi] = useState<Record<string, number>>({});
  const [pakaiSisa, setPakaiSisa] = useState(false);
  const [sisa, setSisa] = useState(0);
  const [akunSisa, setAkunSisa] = useState('');
  const [cari, setCari] = useState('');
  const [hanyaTelat, setHanyaTelat] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'submit' | 'print' | null>(null);
  const invoiceAwal = useRef(params.get('invoice'));

  const accounts = useBcAccounts(kid);
  const akunKas = useMemo(() => accounts.accounts.filter(a => a.cash_type && a.is_active), [accounts.accounts]);
  const akunLain = useMemo(() => {
    const suka = side === 'ar' ? 'LIABILIT' : 'ASSET';
    return accounts.accounts.filter(a => !a.cash_type && a.is_active)
      .sort((a, b) => Number((b.classification ?? '').toUpperCase().includes(suka)) - Number((a.classification ?? '').toUpperCase().includes(suka)) || a.code.localeCompare(b.code));
  }, [accounts.accounts, side]);
  const parties = useArApData<ArApParty[]>(kid ? `parties:${side}:${kid}` : null, s => fetchArApParties(side, kid!, s), []);
  const docs = useArApData<ArApDoc[]>(
    kid && party ? `open:${side}:${kid}:${party}:${editId ?? ''}` : null,
    s => fetchArApDocs(side, kid!, { party, only_open: true, exclude_settlement: editId ?? undefined }, s), [],
  );

  // Mode edit: muat receipt / payment.
  useEffect(() => {
    if (!kid || !editId) return;
    setMemuat(true);
    fetchSettlement(side, kid, editId)
      .then(s => {
        setAsal(s);
        setParty(s.counterparty ?? '');
        setTanggal(s.tx_date);
        setNomor(s.tx_number);
        setNomorManual(true);
        setMetode(s.payment_method ?? 'bank_transfer');
        setBankId(s.bank_coa_id);
        setReferensi(s.reference ?? '');
        setTglRef(s.reference_date ?? '');
        setCatatan(s.description ?? '');
        const a: Record<string, number> = {};
        let lain = 0;
        let akun = '';
        for (const l of s.lines) {
          const id = l.sales_invoice_id ?? l.purchase_transaction_id;
          if (id) a[id] = (a[id] ?? 0) + l.amount;
          else { lain += l.amount; akun = l.coa_id ?? ''; }
        }
        setAlokasi(a);
        setPakaiSisa(lain > 0);
        setSisa(lain);
        setAkunSisa(akun);
      })
      .catch(e => toast.error((e as Error).message))
      .finally(() => setMemuat(false));
  }, [kid, editId, side]);

  // Nomor otomatis (ikut tahun tanggal) selama belum diketik manual.
  useEffect(() => {
    if (!kid || nomorManual || editId) return;
    let batal = false;
    fetchNextSettlementNumber(side, kid, tanggal).then(n => { if (!batal) setNomor(n); }).catch(() => undefined);
    return () => { batal = true; };
  }, [kid, side, tanggal, nomorManual, editId]);

  // Akun bank default: akun bank pertama.
  useEffect(() => {
    if (!bankId && akunKas.length) setBankId((akunKas.find(a => a.cash_type === 'bank') ?? akunKas[0]).id);
  }, [akunKas, bankId]);

  // Ganti pihak (bukan dari mode edit) -> alokasi direset.
  const gantiPihak = (p: string) => {
    if (p === party) return;
    setParty(p);
    setAlokasi({});
  };

  // Prefill ?invoice=id1,id2: centang invoice itu dengan sisa penuh begitu daftar dimuat.
  useEffect(() => {
    const ids = invoiceAwal.current?.split(',').filter(Boolean);
    if (!ids?.length || !docs.data.length) return;
    const isi: Record<string, number> = {};
    docs.data.filter(x => ids.includes(x.id) && x.available > 0).forEach(d => { isi[d.id] = d.available; });
    setAlokasi(a => ({ ...a, ...isi }));
    invoiceAwal.current = null;
  }, [docs.data]);

  const daftar = useMemo(() => {
    const kata = cari.trim().toLowerCase();
    return docs.data
      .filter(d => (!hanyaTelat || d.days_overdue > 0 || alokasi[d.id]) && (!kata || d.no.toLowerCase().includes(kata) || (d.ref_no ?? '').toLowerCase().includes(kata)))
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.no.localeCompare(b.no));
  }, [docs.data, cari, hanyaTelat, alokasi]);

  const totalAlokasi = Object.values(alokasi).reduce((n, v) => n + (v || 0), 0);
  const nilaiSisa = pakaiSisa ? sisa : 0;
  const totalTerima = totalAlokasi + nilaiSisa;
  const lebih = docs.data.filter(d => (alokasi[d.id] ?? 0) > d.available + 0.5);
  const semuaDicentang = daftar.length > 0 && daftar.every(d => alokasi[d.id] !== undefined);
  const terkunci = !!asal && !asal.editable;

  const toggle = (d: ArApDoc) => setAlokasi(a => {
    const n = { ...a };
    if (n[d.id] !== undefined) delete n[d.id]; else n[d.id] = d.available;
    return n;
  });
  const toggleSemua = () => setAlokasi(a => {
    const n = { ...a };
    if (semuaDicentang) daftar.forEach(d => delete n[d.id]);
    else daftar.forEach(d => { if (n[d.id] === undefined) n[d.id] = d.available; });
    return n;
  });

  const masalah = (): string | null => {
    if (!kid) return 'Select a client first.';
    if (!party) return `Select a ${cfg.party.toLowerCase()}.`;
    if (!tanggal) return `${cfg.settle} date is required.`;
    if (!nomor.trim()) return `${cfg.settle} number is required.`;
    if (!bankId) return `Select the ${side === 'ar' ? 'bank account receiving the money' : 'bank account paying the money'}.`;
    if (lebih.length) return `Amount for ${lebih[0].no} exceeds its outstanding balance.`;
    if (Object.values(alokasi).some(v => !v || v <= 0)) return `Enter an amount for every selected ${cfg.doc.toLowerCase()} (or untick it).`;
    if (pakaiSisa && sisa > 0 && !akunSisa) return 'Choose the account for the unapplied amount.';
    if (totalTerima <= 0) return `Allocate the ${cfg.settle.toLowerCase()} to at least one ${cfg.doc.toLowerCase()}.`;
    return null;
  };

  const simpan = async (submit: boolean) => {
    const m = masalah();
    if (m) { toast.error(m); return; }
    const input: SettlementInput = {
      client_id: kid!, number: nomor.trim(), tx_date: tanggal, party, bank_coa_id: bankId, payment_method: metode, currency: 'IDR',
      reference: referensi.trim() || null, reference_date: tglRef || null, notes: catatan.trim() || null,
      allocations: Object.entries(alokasi).filter(([, v]) => v > 0).map(([invoice_id, amount]) => ({ invoice_id, amount })),
      unapplied_amount: nilaiSisa, unapplied_coa_id: nilaiSisa > 0 ? akunSisa : null, submit,
    };
    setBusy(submit ? 'submit' : 'draft');
    try {
      const r = editId ? await updateSettlement(side, editId, input) : await createSettlement(side, input);
      toast.success(r.message);
      router.push(listHref);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cetak = async () => {
    const m = masalah();
    if (m) { toast.error(m); return; }
    setBusy('print');
    try {
      const bank = akunKas.find(a => a.id === bankId);
      const doc = await buildVoucherPdf({
        cfg, header, number: nomor, date: tanggal, party, method: metode, bank: bank ? `${kodeAkun(bank.code)} · ${bank.name}` : '—',
        reference: referensi, referenceDate: tglRef, notes: catatan, status: asal ? asal.status.toUpperCase() : 'NOT SAVED YET',
        allocations: docs.data.filter(d => alokasi[d.id]).map(d => ({ no: d.no, date: d.date, due_date: d.due_date, amount: alokasi[d.id] })),
        unapplied: nilaiSisa,
      });
      doc.autoPrint();
      window.open(doc.output('bloburl').toString(), '_blank');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to build the receipt.');
    } finally {
      setBusy(null);
    }
  };

  const nomorUlang = async () => {
    if (!kid) return;
    setNomorManual(false);
    try { setNomor(await fetchNextSettlementNumber(side, kid, tanggal)); } catch { /* biarkan */ }
  };

  if (memuat) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading...</div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <nav className="mb-1 flex items-center gap-2 text-sm">
              <Link href={cfg.basePath} className="text-[#0F7D4E] hover:underline">{cfg.title}</Link>
              <ChevronRight size={14} className="text-muted-foreground" />
              <span className="font-semibold text-foreground">Record {cfg.settle}</span>
            </nav>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {editId ? `Edit ${cfg.settle}` : `Record ${cfg.settle}`}
              {asal && <SettlementBadge status={asal.status} />}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {side === 'ar'
                ? 'Record a payment received from a customer and allocate it to receivable invoices.'
                : 'Record a payment made to a vendor and allocate it to payable bills.'}
            </p>
          </div>
          <Link href={cfg.basePath} className={btnOutline}><ArrowLeft size={16} /> Back to {cfg.title}</Link>
        </div>

        {terkunci && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {asal!.tx_number} is {asal!.status}{asal!.source !== side ? ' and was created in Cash & Bank' : ''}; it can no longer be edited here.
          </div>
        )}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-foreground">{cfg.settle} Information</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <Label wajib>{cfg.party}</Label>
              <PartyPicker side={side} parties={parties.data} value={party} onChange={gantiPihak} disabled={!!editId || terkunci} />
            </div>
            <div className="lg:col-span-3">
              <Label wajib>{cfg.settle} Date</Label>
              <div className="relative">
                <CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="date" value={tanggal} disabled={terkunci} onChange={e => setTanggal(e.target.value)} className={`${inputCls} py-3.5 pl-9`} />
              </div>
            </div>
            <div className="lg:col-span-3">
              <Label wajib>{cfg.settle} No.</Label>
              <div className="flex gap-2">
                <input value={nomor} disabled={terkunci} maxLength={50} onChange={e => { setNomor(e.target.value); setNomorManual(true); }}
                  placeholder={cfg.settleNumberHint} className={`${inputCls} py-3.5`} />
                {!editId && (
                  <button type="button" onClick={nomorUlang} title="Use the next automatic number" disabled={terkunci}
                    className="shrink-0 rounded-xl border border-border px-3 text-muted-foreground hover:bg-slate-50 hover:text-foreground"><RotateCcw size={16} /></button>
                )}
              </div>
            </div>

            <div className="lg:col-span-4">
              <Label wajib>Payment Method</Label>
              <div className="relative">
                <CreditCard size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select value={metode} disabled={terkunci} onChange={e => setMetode(e.target.value as PaymentMethod)} className={`${inputCls} pl-9`}>
                  {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="lg:col-span-4">
              <Label wajib>{metode === 'cash' ? 'Cash Account' : 'Bank Account'}</Label>
              <div className="relative">
                <Landmark size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select value={bankId} disabled={terkunci} onChange={e => setBankId(e.target.value)} className={`${inputCls} pl-9`}>
                  {!akunKas.length && <option value="">{accounts.loading ? 'Loading...' : 'No cash / bank accounts in the COA'}</option>}
                  {akunKas.map(a => <option key={a.id} value={a.id}>{kodeAkun(a.code)} · {a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="lg:col-span-4">
              <Label wajib>Currency</Label>
              <select value="IDR" disabled className={inputCls} title="The ledger is kept in IDR">
                <option value="IDR">IDR - Indonesian Rupiah</option>
              </select>
            </div>

            <div className="lg:col-span-4">
              <Label>Reference No.</Label>
              <input value={referensi} disabled={terkunci} maxLength={255} onChange={e => setReferensi(e.target.value)}
                placeholder="Transfer / cheque number" className={inputCls} />
            </div>
            <div className="lg:col-span-3">
              <Label>Reference Date</Label>
              <input type="date" value={tglRef} disabled={terkunci} onChange={e => setTglRef(e.target.value)} className={inputCls} />
            </div>
            <div className="lg:col-span-5">
              <Label>Notes</Label>
              <div className="relative">
                <textarea value={catatan} disabled={terkunci} maxLength={500} rows={2} onChange={e => setCatatan(e.target.value)}
                  placeholder={side === 'ar' ? 'e.g. Partial settlement of invoices' : 'e.g. Payment for June bills'} className={`${inputCls} resize-none pb-5`} />
                <span className="absolute bottom-1.5 right-3 text-[10px] text-muted-foreground">{catatan.length}/500</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 px-5 pb-3 pt-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">Allocate to {cfg.docs}</h2>
              <p className="text-xs text-muted-foreground">Choose the {cfg.docs.toLowerCase()} this {cfg.settle.toLowerCase()} settles. Ticking a row fills its full outstanding amount.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-64">
                <Search size={14} className="text-muted-foreground" />
                <input value={cari} onChange={e => setCari(e.target.value)} placeholder={`Search ${cfg.doc.toLowerCase()} number...`} className="w-full bg-transparent text-sm focus:outline-none" />
              </label>
              <button type="button" onClick={() => setHanyaTelat(v => !v)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${hanyaTelat ? 'border-[#0F7D4E] bg-[#ECFDF5] text-[#0F7D4E]' : 'border-border text-foreground'}`}>
                <Filter size={14} /> {hanyaTelat ? 'Overdue only' : 'All open'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" checked={semuaDicentang} onChange={toggleSemua} disabled={!daftar.length || terkunci} className="h-4 w-4 accent-[#0F7D4E]" aria-label="Select all" />
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">{cfg.doc} No.</th>
                  <th className="px-3 py-2.5 text-left font-medium">{cfg.doc} Date</th>
                  <th className="px-3 py-2.5 text-left font-medium">Due Date</th>
                  <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="w-56 px-3 py-2.5 text-left font-medium">Amount {side === 'ar' ? 'Received' : 'Paid'}</th>
                  <th className="px-3 py-2.5 text-right font-medium">Balance After Allocation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!party ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground">Select a {cfg.party.toLowerCase()} to list the open {cfg.docs.toLowerCase()}.</td></tr>
                ) : docs.loading && !docs.data.length ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground"><Loader2 size={14} className="mr-2 inline animate-spin" />Loading...</td></tr>
                ) : daftar.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground">No open {cfg.docs.toLowerCase()} for {party}. You can still record an unapplied amount below.</td></tr>
                ) : daftar.map(d => {
                  const dipilih = alokasi[d.id] !== undefined;
                  const nilai = alokasi[d.id] ?? 0;
                  const sesudah = d.available - nilai;
                  return (
                    <tr key={d.id} className={dipilih ? 'bg-[#ECFDF5]/40' : ''}>
                      <td className="px-3 py-2"><input type="checkbox" checked={dipilih} onChange={() => toggle(d)} disabled={terkunci} className="h-4 w-4 accent-[#0F7D4E]" aria-label={`Select ${d.no}`} /></td>
                      <td className="px-3 py-2">
                        <span className={dipilih ? 'font-medium text-[#0F7D4E]' : 'text-foreground'}>{d.no}</span>
                        {d.ref_no && d.ref_no !== d.no && <span className="block text-[11px] text-muted-foreground">{d.ref_no}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(d.date)}</td>
                      <td className={`px-3 py-2 ${d.days_overdue > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>{fmtDate(d.due_date)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {rupiah(d.available)}
                        {d.in_process > 0 && <span className="block text-[10px] font-normal text-sky-600">{rupiah(d.in_process)} in other drafts</span>}
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput value={nilai} disabled={!dipilih || terkunci} onChange={n => setAlokasi(a => ({ ...a, [d.id]: n }))}
                          className={nilai > d.available + 0.5 ? '!border-rose-400' : ''} />
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${sesudah < -0.5 ? 'text-rose-600' : 'text-foreground'}`}>{rupiah(sesudah)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 rounded-xl border border-dashed border-border p-4">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={pakaiSisa} disabled={terkunci} onChange={e => setPakaiSisa(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0F7D4E]" />
                <span>
                  <span className="font-medium text-foreground">Record an unapplied amount</span>
                  <span className="block text-xs text-muted-foreground">{cfg.unappliedHint}</span>
                </span>
              </label>
              {pakaiSisa && (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                  <MoneyInput value={sisa} onChange={setSisa} disabled={terkunci} className="py-1" />
                  <select value={akunSisa} disabled={terkunci} onChange={e => setAkunSisa(e.target.value)} className={inputCls}>
                    <option value="">Select account...</option>
                    {akunLain.map(a => <option key={a.id} value={a.id}>{kodeAkun(a.code)} · {a.name}{a.classification ? ` (${a.classification})` : ''}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-bold text-foreground">{cfg.settle} Summary</h2>
          <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              { label: `Total ${side === 'ar' ? 'Received' : 'Paid'}`, value: totalTerima, icon: Wallet, tone: 'bg-[#ECFDF5] text-[#0F7D4E]' },
              { label: 'Total Allocated', value: totalAlokasi, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' },
              { label: 'Unapplied Amount', value: nilaiSisa, icon: FileText, tone: 'bg-sky-50 text-sky-600' },
            ].map(k => {
              const Ikon = k.icon;
              return (
                <div key={k.label} className="flex items-center gap-4 px-2 py-3 md:px-6">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><Ikon size={22} /></span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <p className="text-xl font-bold text-foreground">{rupiah(k.value)}</p>
                    <p className="truncate text-[11px] text-muted-foreground" title={amountInWords(k.value)}>{amountInWords(k.value)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-border bg-white">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Link href={cfg.basePath} className={btnOutline}>Cancel</Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-muted-foreground xl:inline">
              {level >= LEVEL_POST ? `Submit posts the ${cfg.settle.toLowerCase()} to the ledger.` : `Submit sends it to a Manager for posting.`}
            </span>
            <button type="button" className={btnOutline} disabled={!!busy || terkunci || level < LEVEL_INPUT} onClick={() => simpan(false)}>
              {busy === 'draft' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Draft
            </button>
            <button type="button" className={btnOutline} disabled={!!busy} onClick={cetak}>
              {busy === 'print' ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Print {cfg.settle}
            </button>
            <button type="button" className={btnPrimary} disabled={!!busy || terkunci || level < LEVEL_INPUT} onClick={() => simpan(true)}>
              {busy === 'submit' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Submit {cfg.settle}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettlementForm({ side }: { side: ArApSide }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
      <SettlementFormInner side={side} />
    </Suspense>
  );
}
