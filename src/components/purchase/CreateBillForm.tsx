'use client';

// Form Create Bill (Purchase) -- TERHUBUNG KE BACKEND.
// Backend: backend/modules/transactions/purchase_bill_v1.py  (/api/v1/transactions/purchase/bills/...)
// Data layer: src/lib/purchaseStore.tsx (bagian "5) Create Bill").
//
// Alur:
//   Save Draft            -> Purchase Transaction berstatus 'draft'
//   Submit for Approval   -> berstatus 'pending_review'
//   lalu di tab Purchase Preview: Approve (Supervisor+) -> Post (Manager+) -> tab Posted
//   -> Financial Statements & Accounts Payable membaca bill berstatus 'posted'.
// Bill yang belum di-approve bisa dibuka lagi lewat ?id=<transaction_id> (mode edit).
//
// Angka di layar ini hanya tampilan -- server menghitung ulang DPP/PPN/total/AP dari
// qty, harga, diskon dan kode pajak sebelum menyimpan.
// Vendor = vendor yang pernah dipakai di company aktif (belum ada tabel master vendor);
// COA & akun default AP / PPN Masukan / akun baris = COA company + Settings > Account Mapping.

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, BookOpen, CalendarDays, CheckCircle2, ChevronRight, CircleDashed, Eye, FileText, Info,
  Percent, Plus, Receipt, Save, Search, Send, Trash2, X,
} from 'lucide-react';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { Label, MoneyInput } from '@/components/arap/SettlementForm';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { LEVEL_INPUT, roleLevel } from '@/lib/receivablesPayablesStore';
import {
  BillValidationError, checkBillInvoiceDuplicate, createBill, fetchBill, fetchBillFormOptions, updateBill,
  type BillFormOptions, type BillDetail, type BillInput, type BillTaxCode,
} from '@/lib/purchaseStore';
import type { PurchaseCategory, SourceDocType } from '@/lib/data/purchaseData';

type TaxCode = BillTaxCode;
type DiscountType = 'percent' | 'amount';

const TAX_LABEL: Record<TaxCode, string> = { ppn_11: 'PPN 11%', ppn_12: 'PPN 12%', non_ppn: 'Non-PPN' };
const TAX_RATE: Record<TaxCode, number> = { ppn_11: 0.11, ppn_12: 0.12, non_ppn: 0 };
const TERMS = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90'];
const MAX_NOTES = 500;
const EDITABLE_STATUS = ['draft', 'pending_review', 'rejected', 'exception'];
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending_review: 'Pending Review', approved: 'Approved', pending_posting: 'Pending Posting',
  posted: 'Posted', rejected: 'Rejected', exception: 'Exception', cancelled: 'Cancelled',
};

const CATEGORIES: PurchaseCategory[] = ['Inventory', 'Office Supplies', 'IT Equipment', 'Professional Services', 'Utilities', 'Maintenance', 'Marketing', 'Travel', 'Fixed Assets', 'Raw Materials', 'Logistics', 'Other'];
const SOURCE_DOCS: SourceDocType[] = ['Manual', 'Purchase Order', 'Vendor Invoice', 'Supplier Bill', 'Goods Receipt', 'Service Receipt', 'Expense Claim', 'Recurring Purchase'];
// Akun yang masuk akal sebagai lawan Hutang Usaha di baris bill (sisanya disembunyikan dari dropdown baris).
const LINE_CLASSES = ['ASSET', 'COST OF SALES', 'EXPENSE', 'OTHER EXPENSE', 'INCOME TAX'];

interface Account { code: string; name: string; cls: string | null }
interface Vendor { name: string; code: string | null; paymentTerms: string | null; category: string | null }

interface Row {
  key: string; itemCode: string; description: string; accountCode: string; qty: number; unit: string; price: number;
  discType: DiscountType; discValue: number; tax: TaxCode;
}
let seq = 0;
const newRow = (tax: TaxCode, accountCode = ''): Row => ({ key: `r${++seq}`, itemCode: '', description: '', accountCode, qty: 1, unit: '', price: 0, discType: 'percent', discValue: 0, tax });

const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const addDays = (isoDate: string, days: number) => { const d = new Date(`${isoDate}T00:00:00`); d.setDate(d.getDate() + days); return iso(d); };
const termDays = (t: string) => { const s = t.toLowerCase(); if (s.includes('receipt')) return 0; const m = /(\d{1,3})/.exec(s); return m ? Number(m[1]) : 0; };
const periodLabel = (isoDate: string) => { const d = new Date(`${isoDate}T00:00:00`); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const taxFromRate = (rate: number): TaxCode => (rate >= 11.5 ? 'ppn_12' : rate > 0 ? 'ppn_11' : 'non_ppn');

// Sama dengan hitung_baris() di purchase_bill_v1.py (dipakai server sebagai angka resmi).
function computeLine(r: Row, inclusive: boolean) {
  const gross = (r.qty || 0) * (r.price || 0);
  const discount = r.discType === 'percent' ? gross * Math.min(r.discValue || 0, 100) / 100 : Math.min(r.discValue || 0, gross);
  const net = gross - discount;
  const rate = TAX_RATE[r.tax];
  const dpp = r2(inclusive ? net / (1 + rate) : net);
  const tax = r2(dpp * rate);
  return { gross, discount, net, dpp, tax, amount: dpp + tax };
}

// ── Komponen kecil ──────────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title, subtitle, tone = 'bg-sky-50 text-sky-600', extra }: {
  icon: React.ElementType; title: string; subtitle?: string; tone?: string; extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={18} /></span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">{title}{extra}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}


function VendorPicker({ value, vendors, onPick, onClear }: { value: string; vendors: Vendor[]; onPick: (v: Vendor | string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const kw = q.trim().toLowerCase();
  const list = vendors.filter(v => !kw || v.name.toLowerCase().includes(kw) || (v.code ?? '').toLowerCase().includes(kw));
  const exact = vendors.some(v => v.name.toLowerCase() === kw);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen(o => !o); setQ(''); }} className={`${inputCls} flex items-center justify-between gap-2 py-3 text-left`}>
        <span className={`truncate ${value ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{value || 'Select or type a vendor...'}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {value && <span role="button" tabIndex={0} aria-label="Clear vendor" onClick={e => { e.stopPropagation(); onClear(); }} className="rounded p-0.5 hover:bg-slate-100"><X size={14} /></span>}
          <ChevronRight size={14} className={`transition ${open ? '-rotate-90' : 'rotate-90'}`} />
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg">
          <label className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor name or code..." className="w-full bg-transparent text-sm focus:outline-none"
              onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !exact) { onPick(q.trim()); setOpen(false); } }} />
          </label>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {list.map(v => (
              <button key={v.name} type="button" onClick={() => { onPick(v); setOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{v.name}</span>
                  <span className="text-[11px] text-muted-foreground">{[v.code, v.category, v.paymentTerms].filter(Boolean).join(' · ') || 'Used before'}</span>
                </span>
              </button>
            ))}
            {q.trim() && !exact && (
              <button type="button" onClick={() => { onPick(q.trim()); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#0F7D4E] hover:bg-[#ECFDF5]">
                <Plus size={14} /> New vendor &quot;{q.trim().toUpperCase()}&quot;
              </button>
            )}
            {!list.length && !q.trim() && <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">No vendors yet for this company — type a name to add one.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountSelect({ value, onChange, options, className = '', placeholder = 'Select account...' }: {
  value: string; onChange: (code: string) => void; options: Account[]; className?: string; placeholder?: string;
}) {
  // Akun terpilih yang tidak ada di daftar (mis. akun lama) tetap tampil supaya tidak hilang diam-diam.
  const punyaNilai = !value || options.some(a => a.code === value);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} py-2 ${!value ? 'text-muted-foreground' : ''} ${className}`}>
      <option value="">{placeholder}</option>
      {!punyaNilai && <option value={value}>{value}</option>}
      {options.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
    </select>
  );
}

const FLOW = ['Draft', 'Pending Review', 'Approved', 'Posted'];

interface Check { ok: boolean; level: 'error' | 'warn'; text: string }
interface JournalLine { code: string; name: string; debit: number; credit: number; memo: string }

function JournalTable({ lines, balanced }: { lines: JournalLine[]; balanced: boolean }) {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (!lines.length) return <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-muted-foreground">Add items with a GL account to see the journal entry.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="border-y border-border bg-slate-50 text-slate-600">
          <th className="px-2 py-2 text-left font-medium">Account</th>
          <th className="px-2 py-2 text-right font-medium">Debit</th>
          <th className="px-2 py-2 text-right font-medium">Credit</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {lines.map((l, i) => (
            <tr key={`${l.code}-${i}`}>
              <td className="px-2 py-2"><span className="font-mono font-semibold text-[#0F7D4E]">{l.code}</span> <span className="text-foreground">{l.name}</span><span className="block text-[10px] text-muted-foreground">{l.memo}</span></td>
              <td className="px-2 py-2 text-right tabular-nums">{l.debit ? rupiah(l.debit) : '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums">{l.credit ? rupiah(l.credit) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-border font-semibold">
          <td className="px-2 py-2">Total</td>
          <td className="px-2 py-2 text-right tabular-nums">{rupiah(dr)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{rupiah(cr)}</td>
        </tr></tfoot>
      </table>
      <p className={`mt-2 text-[11px] font-medium ${balanced ? 'text-emerald-700' : 'text-rose-600'}`}>{balanced ? '✓ Balanced — Total Debit = Total Credit' : '⚠ Unbalanced — Debit ≠ Credit'}</p>
    </div>
  );
}

function PreviewModal({ onClose, data, rows, inclusive, totals, journal, balanced, nameOf }: {
  onClose: () => void; data: Record<string, string>; rows: Row[]; inclusive: boolean; nameOf: (code: string) => string;
  totals: { subtotal: number; discount: number; tax: number; total: number }; journal: JournalLine[]; balanced: boolean;
}) {
  const F = ({ k, v }: { k: string; v: string }) => <div><p className="text-xs text-muted-foreground">{k}</p><p className="text-sm font-medium text-foreground">{v || '—'}</p></div>;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-4xl rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-foreground">Bill Preview</h3><p className="text-xs text-muted-foreground">{data.status}</p></div>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded p-1 text-muted-foreground hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <F k="Purchase No." v={data.purchaseNo} /><F k="Vendor" v={data.vendor} /><F k="Vendor Invoice No." v={data.invoiceNo} /><F k="PO Number" v={data.poNo} />
          <F k="Purchase Date" v={data.purchaseDate} /><F k="Invoice Date" v={data.invoiceDate} /><F k="Due Date" v={data.dueDate} /><F k="Period" v={data.period} />
          <F k="Source Document" v={data.source} /><F k="Category" v={data.category} /><F k="Payment Terms" v={data.terms} /><F k="Currency" v={data.currency} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
              <th className="px-2 py-2 text-left font-medium">Description</th><th className="px-2 py-2 text-left font-medium">GL Account</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Amount</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.filter(r => r.description || r.price).map(r => (
                <tr key={r.key}>
                  <td className="px-2 py-2">{r.description || '—'}</td>
                  <td className="px-2 py-2 text-xs">{r.accountCode ? `${r.accountCode} — ${nameOf(r.accountCode)}` : '—'}</td>
                  <td className="px-2 py-2 text-right">{r.qty} {r.unit}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{rupiah(computeLine(r, inclusive).amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div><p className="mb-2 text-sm font-semibold text-foreground">Accounting Impact (Journal Entry)</p><JournalTable lines={journal} balanced={balanced} /></div>
          <div className="space-y-1 self-start rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{rupiah(totals.subtotal)}</span></div>
            {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{rupiah(totals.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Input VAT</span><span>{rupiah(totals.tax)}</span></div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><span>Accounts Payable</span><span>{rupiah(totals.total)}</span></div>
          </div>
        </div>
        <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className={btnOutline}>Close</button></div>
      </div>
    </div>
  );
}


// ── Halaman ────────────────────────────────────────────────────────────────
function CreateBillInner() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const { user } = useAuth();
  const bolehInput = roleLevel(user?.role) >= LEVEL_INPUT;

  const today = todayIso();
  const [opts, setOpts] = useState<BillFormOptions | null>(null);
  const [asal, setAsal] = useState<BillDetail | null>(null);   // bill yang sedang diedit
  const [memuat, setMemuat] = useState(!!editId);
  const [vendorName, setVendorName] = useState('');
  const [vendorCode, setVendorCode] = useState<string | null>(null);
  const [purchaseNo, setPurchaseNo] = useState('');
  const [noManual, setNoManual] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [terms, setTerms] = useState('Net 30');
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [dueManual, setDueManual] = useState(false);
  const [currency] = useState('IDR');
  const [sourceDoc, setSourceDoc] = useState<SourceDocType>('Manual');
  const [sourceRef, setSourceRef] = useState('');
  const [poNo, setPoNo] = useState('');
  const [category, setCategory] = useState<PurchaseCategory>('Other');
  const [description, setDescription] = useState('');
  const [tax, setTax] = useState<TaxCode>('ppn_11');
  const [inclusive, setInclusive] = useState(false);
  const [apAccount, setApAccount] = useState('');
  const [taxAccount, setTaxAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow('ppn_11')]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [dupInfo, setDupInfo] = useState<{ duplicate: boolean; purchase_no: string | null } | null>(null);

  const locked = !!asal && !EDITABLE_STATUS.includes((asal.status || '').toLowerCase());
  const readOnly = locked || !bolehInput;

  // Opsi dari backend: nomor berikut, vendor, COA, akun default (Settings > Account Mapping).
  useEffect(() => {
    if (!kid) return;
    const ctrl = new AbortController();
    fetchBillFormOptions(kid, purchaseDate, ctrl.signal).then(o => {
      setOpts(o);
      if (!editId && !noManual) setPurchaseNo(o.next_number);
      if (!editId) {
        setApAccount(cur => cur || o.defaults.ap?.account_code || '');
        setTaxAccount(cur => cur || o.defaults.tax?.account_code || '');
        const akunBaris = o.defaults.line?.account_code;
        if (akunBaris) setRows(rs => rs.map(r => (r.accountCode ? r : { ...r, accountCode: akunBaris })));
      }
    }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error((e as Error).message); });
    return () => ctrl.abort();
  }, [kid, purchaseDate.slice(0, 7)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode edit: muat bill + barisnya.
  useEffect(() => {
    if (!editId) return;
    setMemuat(true);
    fetchBill(editId).then(b => {
      setAsal(b);
      setVendorName(b.vendor_name); setVendorCode(b.vendor_code ?? null);
      setPurchaseNo(b.purchase_no); setNoManual(true);
      setInvoiceNo(b.invoice_number ?? ''); setInvoiceDate(b.invoice_date ?? b.purchase_date); setPurchaseDate(b.purchase_date);
      setTerms(b.payment_terms && TERMS.includes(b.payment_terms) ? b.payment_terms : 'Net 30');
      setDueDate(b.due_date ?? addDays(b.purchase_date, 30)); setDueManual(true);
      setSourceDoc((b.source_doc_type || 'Manual') as SourceDocType); setSourceRef(b.source_ref ?? ''); setPoNo(b.po_number ?? '');
      setCategory((b.category || 'Other') as PurchaseCategory); setDescription(b.description ?? '');
      setApAccount(b.ap_account_code ?? ''); setTaxAccount(b.tax_account_code ?? ''); setNotes(b.notes ?? '');
      setInclusive(false); // baris tersimpan selalu dalam bentuk exclusive
      const lines = b.lines.map(l => ({
        key: `r${++seq}`, itemCode: l.item_code ?? '', description: l.description, accountCode: l.account_code, qty: l.quantity,
        unit: l.unit ?? '', price: l.unit_price, discType: 'amount' as DiscountType, discValue: l.discount, tax: taxFromRate(l.tax_rate),
      }));
      setRows(lines.length ? lines : [newRow('ppn_11')]);
      setTax(lines[0]?.tax ?? 'ppn_11');
    }).catch(e => toast.error((e as Error).message)).finally(() => setMemuat(false));
  }, [editId]);

  // Due date mengikuti Payment Terms (dihitung dari tanggal invoice) selama belum diubah manual.
  useEffect(() => { if (!dueManual) setDueDate(addDays(invoiceDate, termDays(terms))); }, [invoiceDate, terms, dueManual]);

  // Cek duplikat vendor + nomor invoice ke server (debounce).
  useEffect(() => {
    setDupInfo(null);
    if (!kid || !vendorName.trim() || !invoiceNo.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      checkBillInvoiceDuplicate(kid, vendorName, invoiceNo, asal?.id ?? null, ctrl.signal).then(setDupInfo).catch(() => undefined);
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [kid, vendorName, invoiceNo, asal?.id]);

  const vendors: Vendor[] = useMemo(() => (opts?.vendors ?? []).map(v => ({ name: v.name, code: v.code, paymentTerms: v.payment_terms, category: v.category })), [opts]);
  const allAccounts: Account[] = useMemo(() => (opts?.accounts ?? []).map(a => ({ code: a.acc_no, name: a.account_name, cls: a.account_classification })), [opts]);
  const lineAccounts = useMemo(() => { const f = allAccounts.filter(a => a.cls && LINE_CLASSES.includes(a.cls)); return f.length ? f : allAccounts; }, [allAccounts]);
  const apOptions = useMemo(() => { const f = allAccounts.filter(a => a.cls === 'LIABILITY'); return f.length ? f : allAccounts; }, [allAccounts]);
  const nameOf = (code: string) => allAccounts.find(a => a.code === code)?.name ?? '';
  const defaultLineAccount = opts?.defaults.line?.account_code ?? '';

  const pickVendor = (v: Vendor | string) => {
    if (typeof v === 'string') { setVendorCode(null); setVendorName(v.toUpperCase()); return; }
    setVendorCode(v.code); setVendorName(v.name);
    if (v.paymentTerms && TERMS.includes(v.paymentTerms)) { setTerms(v.paymentTerms); setDueManual(false); }
    if (v.category && CATEGORIES.includes(v.category as PurchaseCategory)) setCategory(v.category as PurchaseCategory);
  };
  const changeTax = (t: TaxCode) => { setTax(t); setRows(rs => rs.map(r => ({ ...r, tax: t }))); };
  const patchRow = (key: string, p: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));
  const addRow = () => setRows(rs => [...rs, newRow(tax, defaultLineAccount)]);

  const totals = useMemo(() => {
    const lines = rows.map(r => computeLine(r, inclusive));
    const sum = (f: (l: ReturnType<typeof computeLine>) => number) => lines.reduce((s, l) => s + f(l), 0);
    const perTax = (Object.keys(TAX_LABEL) as TaxCode[])
      .map(k => [k, rows.reduce((s, r) => s + (r.tax === k ? computeLine(r, inclusive).tax : 0), 0)] as const)
      .filter(([k, v]) => v > 0 && k !== 'non_ppn');
    return { subtotal: sum(l => l.net), discount: sum(l => l.discount), dpp: sum(l => l.dpp), tax: sum(l => l.tax), total: sum(l => l.amount), perTax };
  }, [rows, inclusive]);

  // Dampak jurnal: Dr akun baris (DPP) + Dr PPN Masukan, Cr Hutang Usaha -- sama seperti Purchase Preview.
  const journal = useMemo<JournalLine[]>(() => {
    const byAcc = new Map<string, number>();
    rows.forEach(r => {
      if (!r.accountCode) return;
      const l = computeLine(r, inclusive);
      if (l.dpp <= 0) return;
      byAcc.set(r.accountCode, (byAcc.get(r.accountCode) ?? 0) + l.dpp);
    });
    const out: JournalLine[] = [...byAcc.entries()].map(([code, v]) => ({ code, name: nameOf(code), debit: v, credit: 0, memo: description || 'Purchase' }));
    if (totals.tax > 0 && taxAccount) out.push({ code: taxAccount, name: nameOf(taxAccount) || 'Input VAT', debit: totals.tax, credit: 0, memo: 'Input VAT' });
    if (totals.total > 0 && apAccount) out.push({ code: apAccount, name: nameOf(apAccount) || 'Accounts Payable', debit: 0, credit: totals.total, memo: vendorName || 'Accounts payable' });
    return out;
  }, [rows, inclusive, totals, taxAccount, apAccount, description, vendorName, allAccounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const balanced = Math.abs(journal.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.01;

  // Validasi tampilan -- aturan finalnya tetap dijalankan server saat Save/Submit.
  const filled = rows.filter(r => r.description || r.price);
  const dupVendorInv = !!dupInfo?.duplicate;
  const checks: Check[] = [
    { ok: !!vendorName, level: 'error', text: 'Vendor selected' },
    { ok: !!invoiceNo.trim(), level: 'error', text: 'Vendor invoice number filled' },
    { ok: !dupVendorInv, level: 'error', text: 'Invoice number not used before for this vendor (Duplicate Invoice)' },
    { ok: sourceDoc !== 'Purchase Order' || !!poNo.trim(), level: 'error', text: 'PO number filled for Purchase Order source' },
    { ok: filled.length > 0 && filled.every(r => r.description.trim() && r.qty > 0 && r.price > 0), level: 'error', text: 'Every item has description, qty and unit price' },
    { ok: filled.length > 0 && filled.every(r => r.accountCode), level: 'error', text: 'Every item has a GL account' },
    { ok: !!apAccount, level: 'error', text: 'Accounts Payable account chosen' },
    { ok: totals.tax === 0 || !!taxAccount, level: 'error', text: 'Input VAT account chosen (tax is charged)' },
    { ok: dueDate >= invoiceDate, level: 'error', text: 'Due date is not before invoice date' },
    { ok: totals.tax > 0 || tax === 'non_ppn', level: 'warn', text: 'Tax is charged on at least one item (Tax Mismatch)' },
  ];
  const errorCount = checks.filter(c => !c.ok && c.level === 'error').length;
  const warnCount = checks.filter(c => !c.ok && c.level === 'warn').length;

  const simpan = async (submit: boolean) => {
    if (!kid || readOnly) return;
    if (errorCount > 0) {
      const pertama = checks.find(c => !c.ok && c.level === 'error');
      setServerErrors([]);
      toast.error(pertama ? `Fix first: ${pertama.text}` : 'Fix the validation issues first.');
      return;
    }
    const input: BillInput = {
      management_client_id: kid, purchase_no: purchaseNo.trim(), purchase_date: purchaseDate, invoice_date: invoiceDate || null,
      invoice_number: invoiceNo.trim(), po_number: poNo.trim() || null, vendor_name: vendorName.trim(), vendor_code: vendorCode,
      source_doc_type: sourceDoc, source_ref: sourceRef.trim() || null, category, description: description.trim() || null,
      currency, payment_terms: terms, due_date: dueDate || null, tax_inclusive: inclusive,
      ap_account_code: apAccount || null, tax_account_code: taxAccount || null, notes: notes.trim() || null, submit,
      lines: filled.map(r => ({
        item_code: r.itemCode.trim() || null, description: r.description.trim(), account_code: r.accountCode, quantity: r.qty,
        unit: r.unit.trim() || null, unit_price: r.price, discount_type: r.discType, discount_value: r.discValue, tax_code: r.tax,
      })),
    };
    setBusy(submit ? 'submit' : 'draft');
    setServerErrors([]);
    try {
      const hasil = asal ? await updateBill(asal.id, input) : await createBill(input);
      toast.success(submit ? `${hasil.purchase_no} submitted for approval.` : `${hasil.purchase_no} saved as draft.`);
      if (submit) {
        router.push('/transactions/purchase/transaction');
      } else {
        setAsal(hasil); setPurchaseNo(hasil.purchase_no); setNoManual(true);
        if (!editId) router.replace(`/transactions/purchase/bills/new?id=${hasil.id}`, { scroll: false });
      }
    } catch (err) {
      if (err instanceof BillValidationError) setServerErrors(err.details.map(d => d.message));
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!kid) return <div className="p-6 text-sm text-amber-800">Select a company first (Switch Company in the top bar).</div>;
  if (memuat) return <div className="p-6 text-sm text-muted-foreground">Loading bill...</div>;

  const statusText = asal ? (STATUS_LABEL[(asal.status || '').toLowerCase()] ?? asal.status) : 'Draft (not saved)';
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link href="/transactions/purchase/transaction" className={`${btnOutline} mb-3`}><ArrowLeft size={16} /> Back to Purchase Transaction</Link>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <Receipt size={26} className="text-[#0F7D4E]" /> {asal ? 'Edit Bill' : 'Create Bill'}
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{statusText}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Record a vendor bill to book a trade payable{activeClientName ? ` for ${activeClientName}` : ''}. {purchaseNo}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreview(true)} className={btnOutline}><Eye size={16} /> Preview</button>
            {!readOnly && <Link href="/transactions/purchase/transaction" className={btnOutline}>Cancel</Link>}
            <button type="button" disabled={readOnly || busy !== null} onClick={() => simpan(false)} className={`${btnOutline} border-[#0F7D4E] text-[#0F7D4E]`}><Save size={16} /> {busy === 'draft' ? 'Saving...' : 'Save Draft'}</button>
            <button type="button" disabled={readOnly || busy !== null} onClick={() => simpan(true)} className={btnPrimary}><Send size={16} /> {busy === 'submit' ? 'Submitting...' : 'Submit for Approval'}</button>
          </div>
        </div>

        {!bolehInput && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Your role can view this bill but not create or edit bills (Supervisor and above only).</div>}
        {locked && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">This bill is <b>{statusText}</b> and can no longer be edited.</div>}
        {serverErrors.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="font-semibold">The server rejected this bill:</p>
            <ul className="mt-1 list-disc pl-5">{serverErrors.map(m => <li key={m}>{m}</li>)}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <span>Save Draft keeps the bill as <b>Draft</b>; Submit marks it <b>Pending Review</b>. Approve and post it in <b>Purchase Preview</b> — once posted it appears in Posted, Financial Statements and Accounts Payable.</span>
          <Link href="/transactions/purchase/preview" className="font-semibold underline">Open Purchase Preview</Link>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* ── Kolom utama ── */}
          <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <SectionTitle icon={FileText} title="Bill Information" subtitle="Vendor, invoice and payment details." />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Label wajib>Vendor</Label>
                  <VendorPicker value={vendorName} vendors={vendors} onPick={pickVendor} onClear={() => { setVendorCode(null); setVendorName(''); }} />
                  {vendorName && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {vendorCode ? `Vendor code: ${vendorCode}` : vendors.some(v => v.name === vendorName) ? 'Existing vendor' : 'New vendor — created with this bill'}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
                  <div>
                    <Label wajib>Purchase No.</Label>
                    <input value={purchaseNo} maxLength={100} onChange={e => { setPurchaseNo(e.target.value); setNoManual(true); }} className={inputCls} />
                  </div>
                  <div>
                    <Label wajib>Vendor Invoice No.</Label>
                    <input value={invoiceNo} maxLength={100} onChange={e => setInvoiceNo(e.target.value)} placeholder="Invoice number from vendor" className={`${inputCls} ${dupVendorInv ? 'border-rose-400' : ''}`} />
                    {dupVendorInv && <p className="mt-1 text-[11px] text-rose-600">This invoice number already exists for this vendor{dupInfo?.purchase_no ? ` (${dupInfo.purchase_no})` : ''}.</p>}
                  </div>
                  <div>
                    <Label>PO Number</Label>
                    <input value={poNo} maxLength={100} onChange={e => setPoNo(e.target.value)} placeholder="e.g. PO-2026-0042" className={inputCls} />
                  </div>
                  <div>
                    <Label wajib>Invoice Date</Label>
                    <div className="relative">
                      <CalendarDays size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input type="date" value={invoiceDate} max="2999-12-31" onChange={e => setInvoiceDate(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <Label wajib>Purchase Date</Label>
                    <input type="date" value={purchaseDate} max="2999-12-31" onChange={e => setPurchaseDate(e.target.value)} className={inputCls} />
                    <p className="mt-1 text-[11px] text-muted-foreground">Period: {periodLabel(purchaseDate)}</p>
                  </div>
                  <div>
                    <Label wajib>Payment Terms</Label>
                    <select value={terms} onChange={e => { setTerms(e.target.value); setDueManual(false); }} className={inputCls}>
                      {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label wajib>Due Date</Label>
                    <input type="date" value={dueDate} min={invoiceDate} max="2999-12-31" onChange={e => { setDueDate(e.target.value); setDueManual(true); }} className={inputCls} />
                    {dueManual && <button type="button" onClick={() => setDueManual(false)} className="mt-1 text-[11px] text-[#0F7D4E] hover:underline">Follow payment terms</button>}
                  </div>
                  <div>
                    <Label wajib>Currency</Label>
                    <select value={currency} disabled className={inputCls}><option value="IDR">IDR - Indonesian Rupiah</option></select>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <SectionTitle icon={BookOpen} title="Source & Classification" subtitle="Where this bill comes from and how it is categorised." tone="bg-violet-50 text-violet-600" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label wajib>Source Document</Label>
                  <select value={sourceDoc} onChange={e => setSourceDoc(e.target.value as SourceDocType)} className={inputCls}>
                    {SOURCE_DOCS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Source Reference</Label>
                  <input value={sourceRef} maxLength={100} onChange={e => setSourceRef(e.target.value)} placeholder="e.g. GR-2026-0105" className={inputCls} />
                </div>
                <div>
                  <Label wajib>Category</Label>
                  <select value={category} onChange={e => setCategory(e.target.value as PurchaseCategory)} className={inputCls}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <Label>Description</Label>
                  <input value={description} maxLength={255} onChange={e => setDescription(e.target.value)} placeholder="Short summary of what was purchased" className={inputCls} />
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <SectionTitle icon={Percent} title="Tax & Journal Accounts" tone="bg-sky-50 text-sky-600"
                  extra={<span title="The tax type applies to all items; you can still change the tax per item. Empty accounts default to Settings > Account Mapping."><Info size={14} className="text-muted-foreground" /></span>} />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label wajib>Tax Type</Label>
                    <select value={tax} onChange={e => changeTax(e.target.value as TaxCode)} className={inputCls}>
                      {(Object.keys(TAX_LABEL) as TaxCode[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Tax Inclusive</Label>
                    <button type="button" role="switch" aria-checked={inclusive} onClick={() => setInclusive(v => !v)}
                      className={`relative mt-1 inline-flex h-6 w-11 items-center rounded-full transition ${inclusive ? 'bg-[#0F7D4E]' : 'bg-slate-200'}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${inclusive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">{inclusive ? 'Prices include tax' : 'Prices exclude tax'}</p>
                  </div>
                  <div className="col-span-2">
                    <Label wajib>Accounts Payable (Cr)</Label>
                    <AccountSelect value={apAccount} onChange={setApAccount} options={apOptions} />
                  </div>
                  <div className="col-span-2">
                    <Label>Input VAT (Dr)</Label>
                    <AccountSelect value={taxAccount} onChange={setTaxAccount} options={allAccounts} />
                  </div>
                </div>
              </section>
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <SectionTitle icon={FileText} title="Additional Information" tone="bg-sky-50 text-sky-600" />
                <Label>Notes</Label>
                <textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, MAX_NOTES))} rows={6} placeholder="e.g. Pay by bank transfer before the due date" className={inputCls} />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{notes.length}/{MAX_NOTES}</p>
              </section>
            </div>

            {/* Bill Items */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <SectionTitle icon={FileText} title="Bill Items" subtitle="Each item is posted to its own GL account." />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={addRow} className={`${btnSmall} border-[#0F7D4E] px-4 py-2 text-[#0F7D4E]`}><Plus size={14} /> Add Item</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                      <th className="w-10 px-2 py-2.5 text-center font-medium">#</th>
                      <th className="w-[120px] px-2 py-2.5 text-left font-medium">Item Code</th>
                      <th className="px-2 py-2.5 text-left font-medium">Description <span className="text-rose-500">*</span></th>
                      <th className="w-[230px] px-2 py-2.5 text-left font-medium">GL Account <span className="text-rose-500">*</span></th>
                      <th className="w-[90px] px-2 py-2.5 text-left font-medium">Qty <span className="text-rose-500">*</span></th>
                      <th className="w-[150px] px-2 py-2.5 text-left font-medium">Unit Price <span className="text-rose-500">*</span></th>
                      <th className="w-[140px] px-2 py-2.5 text-left font-medium">Discount</th>
                      <th className="w-[110px] px-2 py-2.5 text-left font-medium">Tax</th>
                      <th className="w-[140px] px-2 py-2.5 text-right font-medium">Amount (IDR)</th>
                      <th className="w-14 px-2 py-2.5 text-center font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r, i) => {
                      const h = computeLine(r, inclusive);
                      return (
                        <tr key={r.key} className="align-top">
                          <td className="px-2 py-2 pt-4 text-center text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-2"><input value={r.itemCode} maxLength={50} placeholder="Code" onChange={e => patchRow(r.key, { itemCode: e.target.value })} className={`${inputCls} py-2`} /></td>
                          <td className="px-2 py-2"><input value={r.description} maxLength={2000} placeholder="Item or service description" onChange={e => patchRow(r.key, { description: e.target.value })} className={`${inputCls} py-2`} /></td>
                          <td className="px-2 py-2"><AccountSelect value={r.accountCode} onChange={c => patchRow(r.key, { accountCode: c })} options={lineAccounts} /></td>
                          <td className="px-2 py-2">
                            <input type="number" min={0} step="any" value={r.qty || ''} onChange={e => patchRow(r.key, { qty: Number(e.target.value) })} className={`${inputCls} py-2`} />
                            <input value={r.unit} maxLength={20} placeholder="unit" onChange={e => patchRow(r.key, { unit: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:border-border focus:border-border focus:outline-none" />
                          </td>
                          <td className="px-2 py-2"><MoneyInput value={r.price} onChange={n => patchRow(r.key, { price: n })} className="py-0.5" /></td>
                          <td className="px-2 py-2">
                            <div className="flex">
                              <input type="number" min={0} step="any" value={r.discValue || ''} placeholder="0" onChange={e => patchRow(r.key, { discValue: Number(e.target.value) })}
                                className="w-full min-w-0 rounded-l-lg border border-border bg-card px-2 py-2 text-right text-sm focus:outline-none" />
                              <select value={r.discType} onChange={e => patchRow(r.key, { discType: e.target.value as DiscountType })} className="rounded-r-lg border border-l-0 border-border bg-card px-1 text-xs">
                                <option value="percent">%</option><option value="amount">Rp</option>
                              </select>
                            </div>
                            {h.discount > 0 && <p className="mt-1 text-right text-[11px] text-muted-foreground">-{rupiah(h.discount)}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <select value={r.tax} onChange={e => patchRow(r.key, { tax: e.target.value as TaxCode })} className={`${inputCls} py-2`}>
                              {(Object.keys(TAX_LABEL) as TaxCode[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                            </select>
                            {h.tax > 0 && <p className="mt-1 text-right text-[11px] text-muted-foreground">{rupiah(h.tax)}</p>}
                          </td>
                          <td className="px-2 py-2 pt-4 text-right font-semibold text-foreground">{rupiah(h.amount)}</td>
                          <td className="px-2 py-2 pt-3 text-center">
                            <button type="button" aria-label="Remove item" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : [newRow(tax, defaultLineAccount)]))} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={16} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
                <button type="button" onClick={addRow}
                  className="flex items-center gap-4 self-start rounded-xl border-2 border-dashed border-[#22C55E]/50 bg-[#ECFDF5]/40 px-4 py-3 text-left hover:bg-[#ECFDF5]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#0F7D4E]"><Plus size={20} /></span>
                  <span><span className="block text-sm font-semibold text-foreground">Add Item</span><span className="text-xs text-muted-foreground">Add a line for another product or service.</span></span>
                </button>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Subtotal{inclusive ? ' (incl. tax)' : ''}</span><span>{rupiah(totals.subtotal)}</span></div>
                  {totals.discount > 0 && <div className="flex justify-between py-0.5 text-xs"><span className="text-muted-foreground">Discount included</span><span>-{rupiah(totals.discount)}</span></div>}
                  {inclusive && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Tax Base (DPP)</span><span>{rupiah(totals.dpp)}</span></div>}
                  {totals.perTax.length === 0 && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Input VAT</span><span>{rupiah(0)}</span></div>}
                  {totals.perTax.map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="text-muted-foreground">{TAX_LABEL[k]}{inclusive ? ' (included)' : ''}</span><span>{rupiah(v)}</span></div>)}
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    <span className="text-base font-bold text-foreground">Accounts Payable</span>
                    <span className="text-xl font-bold text-foreground">{rupiah(totals.total)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Payment status after posting: Unpaid · due {dueDate || '—'}</p>
                </div>
              </div>
            </section>
          </fieldset>

          {/* ── Sidebar ── */}
          <aside className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <SectionTitle icon={BookOpen} title="Accounting Impact" subtitle="Journal entry created when this bill is posted." tone="bg-emerald-50 text-emerald-600" />
              <JournalTable lines={journal} balanced={balanced} />
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <SectionTitle icon={CheckCircle2} title="Validation" tone="bg-amber-50 text-amber-600"
                subtitle={errorCount + warnCount === 0 ? 'All checks passed.' : `${errorCount} to fix · ${warnCount} warning${warnCount === 1 ? '' : 's'}`} />
              <ul className="space-y-2">
                {checks.map(c => (
                  <li key={c.text} className="flex items-start gap-2 text-xs">
                    {c.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                      : c.level === 'error' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-500" />
                      : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />}
                    <span className={c.ok ? 'text-muted-foreground' : c.level === 'error' ? 'text-rose-700' : 'text-amber-700'}>{c.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">The server re-checks everything on save (including that every account exists in this company&apos;s chart of accounts).</p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <SectionTitle icon={CircleDashed} title="Approval Flow" subtitle="What happens after you save." tone="bg-violet-50 text-violet-600" />
              <ol className="space-y-3">
                {FLOW.map((s, i) => {
                  const aktif = i === (asal && (asal.status || '').toLowerCase() === 'pending_review' ? 1 : 0);
                  return (
                    <li key={s} className="flex items-center gap-3 text-sm">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${aktif ? 'bg-[#0F7D4E] text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                      <span className={aktif ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{s}{aktif ? ' — you are here' : ''}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">After posting, the bill appears in Accounts Payable and can be paid from Cash &amp; Bank.</p>
            </section>
          </aside>
        </div>
      </div>

      {preview && (
        <PreviewModal onClose={() => setPreview(false)} rows={rows} inclusive={inclusive} totals={totals} journal={journal} balanced={balanced} nameOf={nameOf}
          data={{
            status: statusText, purchaseNo, vendor: vendorName, invoiceNo, poNo, purchaseDate, invoiceDate, dueDate, period: periodLabel(purchaseDate),
            source: sourceRef ? `${sourceDoc} · ${sourceRef}` : sourceDoc, category, terms, currency,
          }} />
      )}
    </div>
  );
}

export default function CreateBillForm() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <CreateBillInner />
    </Suspense>
  );
}