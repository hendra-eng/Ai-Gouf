'use client';

// Form Create Bill (Purchase > Purchase Transaction) -- layout mengikuti
// dataset/picture/Template UI/Purchase/1.png & 2.png: Bill Information,
// Source & Classification, Tax & Journal Accounts, Additional Information,
// Bill Items + ringkasan; panel kanan Accounting Impact, Validation, Approval
// Flow. Backend: modules/transactions/purchase_bill_v1.py (Bill = Purchase
// Transaction + baris item). Save Draft -> draft; Submit for Approval ->
// pending_review, lalu Approve & Post di Purchase Preview.
// Mode edit: ?id=<purchase transaction>.

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Eye, FileText, Info, Loader2, Loader, Percent, Plus, Printer,
  ReceiptText, Save, Search, Send, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { computeInvoiceLine, fmtDate, LEVEL_INPUT, roleLevel, rupiah, TAX_LABEL, todayIso } from '@/lib/receivablesPayablesStore';
import {
  checkBillDuplicate, fetchBill, fetchBillFormOptions, saveBill,
  type BillAccountOption, type BillDiscountType, type BillEntry, type BillFormOptions, type BillInput, type BillTaxType, type BillVendorOption,
} from '@/lib/purchaseStore';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { Label, MoneyInput } from '@/components/arap/SettlementForm';

const TERMIN_DEFAULT = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90'];
const MAKS_CATATAN = 500;
const DAFTAR_URL = '/transactions/purchase/transaction';
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Baris {
  key: string; item_code: string; description: string; account_code: string; quantity: number; unit: string;
  unit_price: number; discount_type: BillDiscountType; discount_value: number; tax_type: BillTaxType;
}

let urutKunci = 0;
const kunciBaru = () => `b${++urutKunci}`;
const barisKosong = (tax: BillTaxType, akun = ''): Baris => ({
  key: kunciBaru(), item_code: '', description: '', account_code: akun, quantity: 1, unit: '', unit_price: 0, discount_type: 'percent', discount_value: 0, tax_type: tax,
});
const isiBaris = (b: Baris) => !!(b.description.trim() || b.unit_price || b.item_code.trim());
const hitung = (b: Baris, inklusif: boolean) => computeInvoiceLine({ ...b, tax_code: b.tax_type }, inklusif);
const pajakDariTarif = (rate: number): BillTaxType => (rate >= 11.5 ? 'ppn_12' : rate > 0 ? 'ppn_11' : 'non_ppn');

const tambahHari = (iso: string, hari: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + hari);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hariTermin = (t: string) => {
  const s = t.trim().toLowerCase();
  if (!s || ['cod', 'cash', 'due on receipt', 'cbd'].includes(s)) return 0;
  const m = /(\d{1,3})/.exec(s);
  return m ? Number(m[1]) : 0;
};
const labelPeriode = (iso: string) => (iso ? `${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');
const labelAkun = (a?: BillAccountOption) => (a ? `${a.code} · ${a.name}` : '');

function Section({ icon: Ikon, title, subtitle, tone = 'bg-sky-50 text-sky-600', action, children, className = '' }: {
  icon: React.ElementType; title: React.ReactNode; subtitle?: string; tone?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Ikon size={18} /></span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B5E5C]">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Pilih vendor dari bill sebelumnya, atau ketik nama baru. */
function VendorPicker({ vendors, value, onPick, onClear, disabled }: {
  vendors: BillVendorOption[]; value: string; onPick: (v: BillVendorOption | string) => void; onClear: () => void; disabled?: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!buka) return;
    const tutup = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false); };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [buka]);
  const kata = q.trim().toLowerCase();
  const daftar = vendors.filter(v => !kata || v.name.toLowerCase().includes(kata) || (v.code ?? '').toLowerCase().includes(kata)).slice(0, 60);
  const persis = vendors.some(v => v.name.toLowerCase() === kata);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => { setBuka(o => !o); setQ(''); }}
        className={`${inputCls} flex items-center justify-between gap-2 py-3 text-left`}>
        <span className={`truncate ${value ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{value || 'Select or type a vendor...'}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {value && !disabled && (
            <span role="button" tabIndex={0} aria-label="Clear vendor" onClick={e => { e.stopPropagation(); onClear(); }}
              className="rounded p-0.5 hover:bg-slate-100"><X size={14} /></span>
          )}
          <ChevronRight size={14} className={`transition ${buka ? '-rotate-90' : 'rotate-90'}`} />
        </span>
      </button>
      {buka && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg">
          <label className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor name or code..."
              className="w-full bg-transparent text-sm focus:outline-none"
              onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !persis) { onPick(q.trim()); setBuka(false); } }} />
          </label>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {daftar.map(v => (
              <button key={v.name} type="button" onClick={() => { onPick(v); setBuka(false); }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{v.name}</span>
                  <span className="text-[11px] text-muted-foreground">{v.code ?? 'No vendor code'} · {v.bills} bill{v.bills === 1 ? '' : 's'}</span>
                </span>
                {v.last_date && <span className="shrink-0 text-[11px] text-muted-foreground">last {fmtDate(v.last_date)}</span>}
              </button>
            ))}
            {q.trim() && !persis && (
              <button type="button" onClick={() => { onPick(q.trim()); setBuka(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#0F7D4E] hover:bg-[#ECFDF5]">
                <Plus size={14} /> New vendor &quot;{q.trim().toUpperCase()}&quot;
              </button>
            )}
            {!daftar.length && !q.trim() && <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">No vendors yet — type a name to add one.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountSelect({ accounts, value, onChange, disabled, className = '' }: {
  accounts: BillAccountOption[]; value: string; onChange: (code: string) => void; disabled?: boolean; className?: string;
}) {
  const ada = !value || accounts.some(a => a.code === value);
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${inputCls} ${className}`}>
      <option value="">Select account...</option>
      {!ada && <option value={value}>{value} · (not in chart of accounts)</option>}
      {accounts.map(a => <option key={a.code} value={a.code}>{labelAkun(a)}</option>)}
    </select>
  );
}

interface Cek { key: string; label: string; ok: boolean; level: 'error' | 'warning' }
interface BarisJurnal { code: string; name: string; debit: number; credit: number }

function PreviewModal({ data, onClose }: {
  data: { company: string; nomor: string; status: string; vendor: string; vendorCode: string; invoice: string; po: string; invoiceDate: string;
    purchaseDate: string; dueDate: string; termin: string; catatan: string; inklusif: boolean; subtotal: number; tax: number; total: number;
    baris: { b: Baris; amount: number; discount: number; tax: number }[]; jurnal: BarisJurnal[] };
  onClose: () => void;
}) {
  const cetak = () => {
    const el = document.getElementById('bill-preview-doc');
    const w = el && window.open('', '_blank', 'width=900,height=1000');
    if (!el || !w) return;
    w.document.write(`<html><head><title>${data.nomor}</title><style>
      body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:32px;font-size:12px}
      table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}
      th{background:#ECFDF5;color:#0B5E5C;font-size:11px}.text-right{text-align:right}h1{font-size:22px;margin:0;color:#0F7D4E}
    </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-bold text-foreground">Bill Preview</h3>
          <div className="flex gap-2">
            <button type="button" onClick={cetak} className={btnSmall}><Printer size={13} /> Print</button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          <div id="bill-preview-doc" className="space-y-5 text-sm text-slate-900">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <div>
                <h1 className="text-2xl font-bold text-[#0F7D4E]">VENDOR BILL</h1>
                <p className="text-xs text-slate-500">{data.nomor || '(number assigned on save)'} · {data.status}</p>
              </div>
              <div className="text-right"><p className="font-bold">{data.company}</p></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <div>
                <p className="text-[11px] uppercase text-slate-500">Vendor</p>
                <p className="font-semibold">{data.vendor || '—'}{data.vendorCode ? ` (${data.vendorCode})` : ''}</p>
              </div>
              <table style={{ width: 'auto' }} className="text-xs">
                <tbody>
                  <tr><td className="pr-4 text-slate-500">Vendor Invoice No.</td><td>{data.invoice || '—'}</td></tr>
                  {data.po && <tr><td className="pr-4 text-slate-500">PO Number</td><td>{data.po}</td></tr>}
                  <tr><td className="pr-4 text-slate-500">Invoice Date</td><td>{fmtDate(data.invoiceDate)}</td></tr>
                  <tr><td className="pr-4 text-slate-500">Purchase Date</td><td>{fmtDate(data.purchaseDate)}</td></tr>
                  <tr><td className="pr-4 text-slate-500">Due Date</td><td>{fmtDate(data.dueDate)} ({data.termin})</td></tr>
                </tbody>
              </table>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#ECFDF5] text-[#0B5E5C]">
                  <th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-left">GL Account</th>
                  <th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Unit Price</th>
                  <th className="px-2 py-1.5 text-right">Discount</th><th className="px-2 py-1.5 text-left">Tax</th><th className="px-2 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.baris.map((x, i) => (
                  <tr key={x.b.key} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">{i + 1}</td>
                    <td className="px-2 py-1.5">{x.b.item_code && <b>{x.b.item_code} </b>}{x.b.description || '—'}</td>
                    <td className="px-2 py-1.5">{x.b.account_code || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{x.b.quantity}{x.b.unit ? ` ${x.b.unit}` : ''}</td>
                    <td className="px-2 py-1.5 text-right">{rupiah(x.b.unit_price)}</td>
                    <td className="px-2 py-1.5 text-right">{x.discount ? rupiah(x.discount) : '—'}</td>
                    <td className="px-2 py-1.5">{TAX_LABEL[x.b.tax_type]}</td>
                    <td className="px-2 py-1.5 text-right">{rupiah(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="text-xs" style={{ width: 300, marginLeft: 'auto' }}>
              <tbody>
                <tr><td>Subtotal{data.inklusif ? ' (excl. tax)' : ''}</td><td className="text-right">{rupiah(data.subtotal)}</td></tr>
                <tr><td>Input VAT</td><td className="text-right">{rupiah(data.tax)}</td></tr>
                <tr className="text-sm font-bold"><td className="border-t-2 border-[#0F7D4E] pt-1">Accounts Payable</td><td className="border-t-2 border-[#0F7D4E] pt-1 text-right">{rupiah(data.total)}</td></tr>
              </tbody>
            </table>
            {data.jurnal.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Journal entry on posting</p>
                <table className="w-full text-xs">
                  <thead><tr className="bg-[#ECFDF5] text-[#0B5E5C]"><th className="px-2 py-1.5 text-left">Account</th><th className="px-2 py-1.5 text-right">Debit</th><th className="px-2 py-1.5 text-right">Credit</th></tr></thead>
                  <tbody>{data.jurnal.map(j => (
                    <tr key={`${j.code}-${j.credit ? 'c' : 'd'}`} className="border-b border-slate-100">
                      <td className="px-2 py-1.5">{j.code} · {j.name}</td>
                      <td className="px-2 py-1.5 text-right">{j.debit ? rupiah(j.debit) : ''}</td><td className="px-2 py-1.5 text-right">{j.credit ? rupiah(j.credit) : ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {data.catatan && <p className="whitespace-pre-line text-xs text-slate-600"><b>Notes:</b> {data.catatan}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending_review: 'Pending Review', approved: 'Approved', pending_posting: 'Pending Posting', posted: 'Posted',
  rejected: 'Rejected', exception: 'Exception', cancelled: 'Cancelled',
};

function CreateBillInner() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const { user } = useAuth();
  const bolehInput = roleLevel(user?.role) >= LEVEL_INPUT;

  const [opsi, setOpsi] = useState<BillFormOptions | null>(null);
  const [asal, setAsal] = useState<BillEntry | null>(null);
  const [memuat, setMemuat] = useState(!!editId);
  const [nomor, setNomor] = useState('');
  const [nomorManual, setNomorManual] = useState(false);
  const [vendor, setVendor] = useState('');
  const [vendorKode, setVendorKode] = useState('');
  const [invoice, setInvoice] = useState('');
  const [po, setPo] = useState('');
  const [tglInvoice, setTglInvoice] = useState(todayIso());
  const [tglBeli, setTglBeli] = useState(todayIso());
  const [termin, setTermin] = useState('Net 30');
  const [jatuhTempo, setJatuhTempo] = useState(tambahHari(todayIso(), 30));
  const [tempoManual, setTempoManual] = useState(false);
  const [mataUang, setMataUang] = useState('IDR');
  const [sumber, setSumber] = useState('Manual');
  const [refSumber, setRefSumber] = useState('');
  const [kategori, setKategori] = useState('Other');
  const [deskripsi, setDeskripsi] = useState('');
  const [pajak, setPajak] = useState<BillTaxType>('ppn_11');
  const [inklusif, setInklusif] = useState(false);
  const [akunAp, setAkunAp] = useState('');
  const [akunVat, setAkunVat] = useState('');
  const [catatan, setCatatan] = useState('');
  const [baris, setBaris] = useState<Baris[]>(() => [barisKosong('ppn_11')]);
  const [dobel, setDobel] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const [preview, setPreview] = useState(false);
  const defaultDiisi = useRef(false);

  // Opsi form (nomor berikut mengikuti bulan purchase date).
  useEffect(() => {
    if (!kid) return;
    const ctrl = new AbortController();
    fetchBillFormOptions(kid, tglBeli, ctrl.signal).then(o => {
      setOpsi(o);
      if (!editId && !nomorManual) setNomor(o.next_number);
      // Akun default dari Settings > Account Mapping -- sekali saja, untuk bill baru.
      if (!editId && !defaultDiisi.current) {
        defaultDiisi.current = true;
        if (o.defaults.ap) setAkunAp(o.defaults.ap);
        if (o.defaults.tax) setAkunVat(o.defaults.tax);
        if (o.defaults.line) setBaris(bs => bs.map(b => (b.account_code ? b : { ...b, account_code: o.defaults.line! })));
      }
    }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error((e as Error).message); });
    return () => ctrl.abort();
  }, [kid, tglBeli.slice(0, 7)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode edit.
  useEffect(() => {
    if (!kid || !editId) return;
    setMemuat(true);
    fetchBill(kid, editId).then(e => {
      setAsal(e);
      setNomor(e.purchase_no); setNomorManual(true);
      setVendor(e.vendor_name); setVendorKode(e.vendor_code ?? '');
      setInvoice(e.invoice_number ?? ''); setPo(e.po_number ?? '');
      setTglInvoice(e.invoice_date ?? e.purchase_date); setTglBeli(e.purchase_date);
      setTermin(e.payment_terms || 'Net 30'); setJatuhTempo(e.due_date ?? e.purchase_date); setTempoManual(true);
      setMataUang(e.currency || 'IDR'); setSumber(e.source_doc_type || 'Manual'); setRefSumber(e.source_ref ?? '');
      setKategori(e.category || 'Other'); setDeskripsi(e.description ?? '');
      setInklusif(!!e.tax_inclusive);
      setAkunAp(e.ap_account_code ?? ''); setAkunVat(e.tax_account_code ?? ''); setCatatan(e.notes ?? '');
      const pajakBaris = e.lines.map(l => pajakDariTarif(Number(l.tax_rate)));
      setPajak(e.tax_type ?? pajakBaris.find(t => t !== 'non_ppn') ?? 'non_ppn');
      setBaris(e.lines.length ? e.lines.map((l, i) => ({
        key: kunciBaru(), item_code: l.item_code ?? '', description: l.description, account_code: l.account_code, quantity: Number(l.quantity),
        unit: l.unit ?? '', unit_price: Number(l.unit_price), tax_type: pajakBaris[i],
        // Bill hasil import tidak menyimpan input diskon -- tampilkan nominalnya.
        discount_type: l.discount_type ?? 'amount', discount_value: l.discount_value != null ? Number(l.discount_value) : Number(l.discount),
      })) : [barisKosong(e.tax_type ?? 'ppn_11')]);
    }).catch(e => toast.error((e as Error).message)).finally(() => setMemuat(false));
  }, [kid, editId]);

  // Jatuh tempo otomatis dari termin (kecuali diubah manual).
  useEffect(() => {
    if (!tempoManual && tglInvoice) setJatuhTempo(tambahHari(tglInvoice, hariTermin(termin)));
  }, [tglInvoice, termin, tempoManual]);

  // Duplicate Invoice -- dicek ke server (debounce) tiap vendor / nomor invoice berubah.
  useEffect(() => {
    if (!kid || !vendor.trim() || !invoice.trim()) { setDobel(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      checkBillDuplicate(kid, vendor, invoice, asal?.id, ctrl.signal)
        .then(r => setDobel(r.duplicate ? r.purchase_no : null))
        .catch(() => undefined);
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [kid, vendor, invoice, asal?.id]);

  const akun = useMemo(() => opsi?.accounts ?? [], [opsi]);
  const petaAkun = useMemo(() => new Map(akun.map(a => [a.code, a])), [akun]);
  const adaCoa = akun.length > 0;
  const akunValid = (kode: string) => !!kode.trim() && (!adaCoa || petaAkun.has(kode.trim()));

  const pilihVendor = (v: BillVendorOption | string) => {
    if (typeof v === 'string') { setVendor(v.toUpperCase()); setVendorKode(''); return; }
    setVendor(v.name); setVendorKode(v.code ?? '');
    if (v.payment_terms) { setTermin(v.payment_terms); setTempoManual(false); }
  };
  const ubahBaris = (key: string, patch: Partial<Baris>) => setBaris(bs => bs.map(b => (b.key === key ? { ...b, ...patch } : b)));
  const tambahBaris = () => setBaris(bs => [...bs, barisKosong(pajak, opsi?.defaults.line ?? '')]);
  const gantiPajak = (t: BillTaxType) => { setPajak(t); setBaris(bs => bs.map(b => ({ ...b, tax_type: t }))); };

  const ring = useMemo(() => {
    const isi = baris.filter(isiBaris).map(b => ({ b, ...hitung(b, inklusif) }));
    const dpp = isi.reduce((n, x) => n + x.dpp, 0);
    const tax = isi.reduce((n, x) => n + x.tax, 0);
    return {
      isi, dpp, tax, total: Math.round((dpp + tax) * 100) / 100,
      gross: isi.reduce((n, x) => n + x.gross, 0), discount: isi.reduce((n, x) => n + x.discount, 0),
    };
  }, [baris, inklusif]);

  // Jurnal saat diposting: Dr akun item (DPP) + Dr PPN Masukan = Cr Hutang Usaha.
  const jurnal = useMemo<BarisJurnal[]>(() => {
    const perAkun = new Map<string, number>();
    ring.isi.forEach(x => { if (x.b.account_code) perAkun.set(x.b.account_code, (perAkun.get(x.b.account_code) ?? 0) + x.dpp); });
    if (!perAkun.size) return [];
    const nama = (k: string) => petaAkun.get(k)?.name ?? (k ? '(not in chart of accounts)' : 'Not chosen');
    const hasil: BarisJurnal[] = Array.from(perAkun.entries()).map(([code, debit]) => ({ code, name: nama(code), debit, credit: 0 }));
    if (ring.tax > 0) hasil.push({ code: akunVat || '—', name: akunVat ? nama(akunVat) : 'Input VAT account not chosen', debit: ring.tax, credit: 0 });
    hasil.push({ code: akunAp || '—', name: akunAp ? nama(akunAp) : 'Accounts Payable account not chosen', debit: 0, credit: ring.total });
    return hasil;
  }, [ring, akunAp, akunVat, petaAkun]);

  // Sama dengan purchase_bill_v1._validasi -- server tetap cek ulang saat simpan.
  const cek: Cek[] = useMemo(() => {
    const isi = baris.filter(isiBaris);
    return [
      { key: 'vendor', label: 'Vendor selected', ok: !!vendor.trim(), level: 'error' },
      { key: 'invoice', label: 'Vendor invoice number filled', ok: !!invoice.trim(), level: 'error' },
      { key: 'duplicate', label: 'Invoice number not used before for this vendor (Duplicate Invoice)', ok: !dobel, level: 'error' },
      { key: 'po', label: 'PO number filled for Purchase Order source', ok: sumber !== 'Purchase Order' || !!po.trim(), level: 'error' },
      { key: 'items', label: 'Every item has description, qty and unit price', ok: isi.length > 0 && isi.every(b => b.description.trim() && b.quantity > 0 && b.unit_price > 0), level: 'error' },
      { key: 'gl', label: 'Every item has a GL account', ok: isi.length > 0 && isi.every(b => akunValid(b.account_code)), level: 'error' },
      { key: 'ap', label: 'Accounts Payable account chosen', ok: akunValid(akunAp), level: 'error' },
      { key: 'vat', label: 'Input VAT account chosen (tax is charged)', ok: ring.tax <= 0 || akunValid(akunVat), level: 'error' },
      { key: 'due', label: 'Due date is not before invoice date', ok: !!jatuhTempo && jatuhTempo >= tglInvoice, level: 'error' },
      { key: 'tax', label: 'Tax is charged on at least one item (Tax Mismatch)', ok: pajak === 'non_ppn' || ring.tax > 0, level: 'warning' },
    ];
  }, [vendor, invoice, dobel, sumber, po, baris, akunAp, akunVat, ring.tax, jatuhTempo, tglInvoice, pajak]); // eslint-disable-line react-hooks/exhaustive-deps
  const salah = cek.filter(c => !c.ok && c.level === 'error');
  const peringatan = cek.filter(c => !c.ok && c.level === 'warning');

  const simpan = async (submit: boolean) => {
    if (!kid) return;
    if (submit && salah.length) { toast.error(`Fix ${salah.length} validation item${salah.length === 1 ? '' : 's'} before submitting.`, { description: salah[0].label }); return; }
    const input: BillInput = {
      management_client_id: kid, purchase_no: nomor.trim() || null, vendor_name: vendor.trim(), vendor_code: vendorKode.trim() || null,
      invoice_number: invoice.trim(), po_number: po.trim() || null, invoice_date: tglInvoice, purchase_date: tglBeli, due_date: jatuhTempo,
      payment_terms: termin, currency: mataUang, source_doc_type: sumber, source_ref: refSumber.trim() || null, category: kategori,
      description: deskripsi.trim() || null, tax_type: pajak, tax_inclusive: inklusif, ap_account_code: akunAp, tax_account_code: akunVat || null,
      notes: catatan.trim() || null, submit,
      lines: baris.filter(isiBaris).map(b => ({
        item_code: b.item_code.trim() || null, description: b.description.trim(), account_code: b.account_code, quantity: b.quantity,
        unit: b.unit.trim() || null, unit_price: b.unit_price, discount_type: b.discount_type, discount_value: b.discount_value, tax_type: b.tax_type,
      })),
    };
    setBusy(submit ? 'submit' : 'draft');
    try {
      const r = await saveBill(input, asal?.id);
      toast.success(submit ? `${r.purchase_no} submitted for approval.` : `${r.purchase_no} saved as draft.`);
      if (submit) {
        router.push(DAFTAR_URL);
      } else {
        setAsal(r);
        setNomor(r.purchase_no); setNomorManual(true);
        if (!editId) router.replace(`/transactions/purchase/bill/new?id=${r.id}`, { scroll: false });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!kid) return <div className="p-6 text-sm text-amber-800">Select a company first (Switch Company in the top bar).</div>;
  if (memuat) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading...</div>;

  const terkunci = !!asal && !asal.editable;
  const nonaktif = terkunci || !bolehInput;
  const status = asal?.status ?? 'draft';
  const terminDaftar = opsi?.payment_terms?.length ? opsi.payment_terms : TERMIN_DEFAULT;
  const terminList = terminDaftar.includes(termin) ? terminDaftar : [termin, ...terminDaftar];
  const kategoriList = Array.from(new Set([...(opsi?.categories ?? ['Other']), kategori]));
  const sumberList = Array.from(new Set([...(opsi?.source_types ?? ['Manual']), sumber]));
  const langkah = ['draft', 'pending_review', 'approved', 'posted'];
  const posisi = Math.max(0, langkah.indexOf(status === 'pending_posting' ? 'approved' : status));
  const badge = asal ? STATUS_LABEL[status] ?? status : 'Draft (not saved)';

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Link href={DAFTAR_URL} className={`${btnOutline} w-fit`}><ArrowLeft size={16} /> Back to Purchase Transaction</Link>
            <div>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-[#0B5E5C] sm:text-3xl">
                <ReceiptText size={26} className="text-[#0F7D4E]" /> {asal ? 'Edit Bill' : 'Create Bill'}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === 'pending_review' ? 'bg-amber-50 text-amber-700' : status === 'posted' ? 'bg-emerald-50 text-emerald-700' : status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{badge}</span>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Record a vendor bill to book a trade payable for {activeClientName || 'the active company'}. <span className="font-mono">{nomor}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreview(true)} className={btnOutline}><Eye size={16} /> Preview</button>
            <Link href={DAFTAR_URL} className={btnOutline}>Cancel</Link>
            <button type="button" onClick={() => simpan(false)} disabled={!!busy || nonaktif} className={btnOutline}>
              {busy === 'draft' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Draft
            </button>
            <button type="button" onClick={() => simpan(true)} disabled={!!busy || nonaktif} className={btnPrimary}>
              {busy === 'submit' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit for Approval
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>
            Save Draft keeps the bill as <b>Draft</b>; Submit marks it <b>Pending Review</b>. Approve and post it in <b>Purchase Preview</b> — once posted it appears in Posted, Financial Statements and Accounts Payable.
          </span>
          <Link href="/transactions/purchase/preview" className="font-semibold text-[#0B5E5C] underline">Open Purchase Preview</Link>
        </div>
        {!bolehInput && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Your role can view but not create bills (Supervisor or above).</div>
        )}
        {terkunci && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{asal!.purchase_no} is {badge}; it can no longer be edited.</div>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-5">
            {/* Bill Information */}
            <Section icon={FileText} title="Bill Information" subtitle="Vendor, invoice and payment details.">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Label wajib>Vendor</Label>
                  <VendorPicker vendors={opsi?.vendors ?? []} value={vendor} onPick={pilihVendor} disabled={nonaktif}
                    onClear={() => { setVendor(''); setVendorKode(''); }} />
                  {vendor && (
                    <div className="mt-3">
                      <Label>Vendor Code</Label>
                      <input value={vendorKode} disabled={nonaktif} maxLength={50} onChange={e => setVendorKode(e.target.value)} placeholder="Optional" className={inputCls} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
                  <div>
                    <Label wajib>Purchase No.</Label>
                    <input value={nomor} disabled={nonaktif} maxLength={100} onChange={e => { setNomor(e.target.value); setNomorManual(true); }} className={inputCls} />
                    {nomorManual && !asal && opsi && (
                      <button type="button" onClick={() => { setNomorManual(false); setNomor(opsi.next_number); }} className="mt-1 text-[11px] text-[#0F7D4E] hover:underline">Use automatic number</button>
                    )}
                  </div>
                  <div>
                    <Label wajib>Vendor Invoice No.</Label>
                    <input value={invoice} disabled={nonaktif} maxLength={100} onChange={e => setInvoice(e.target.value)} placeholder="Invoice number from vendor" className={inputCls} />
                    {dobel && <p className="mt-1 text-[11px] text-rose-600">Already recorded in {dobel}.</p>}
                  </div>
                  <div>
                    <Label wajib={sumber === 'Purchase Order'}>PO Number</Label>
                    <input value={po} disabled={nonaktif} maxLength={100} onChange={e => setPo(e.target.value)} placeholder="e.g. PO-2026-0042" className={inputCls} />
                  </div>
                  <div>
                    <Label wajib>Invoice Date</Label>
                    <input type="date" value={tglInvoice} disabled={nonaktif} max="2999-12-31" onChange={e => setTglInvoice(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <Label wajib>Purchase Date</Label>
                    <input type="date" value={tglBeli} disabled={nonaktif} max="2999-12-31" onChange={e => setTglBeli(e.target.value)} className={inputCls} />
                    <p className="mt-1 text-[11px] text-muted-foreground">Period: {labelPeriode(tglBeli)}</p>
                  </div>
                  <div>
                    <Label wajib>Payment Terms</Label>
                    <select value={termin} disabled={nonaktif} onChange={e => { setTermin(e.target.value); setTempoManual(false); }} className={inputCls}>
                      {terminList.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label wajib>Due Date</Label>
                    <input type="date" value={jatuhTempo} disabled={nonaktif} min={tglInvoice} max="2999-12-31"
                      onChange={e => { setJatuhTempo(e.target.value); setTempoManual(true); }} className={inputCls} />
                    {tempoManual && !nonaktif && (
                      <button type="button" onClick={() => setTempoManual(false)} className="mt-1 text-[11px] text-[#0F7D4E] hover:underline">Follow payment terms</button>
                    )}
                  </div>
                  <div>
                    <Label wajib>Currency</Label>
                    <select value={mataUang} disabled={nonaktif} onChange={e => setMataUang(e.target.value)} className={inputCls}>
                      <option value="IDR">IDR - Indonesian Rupiah</option>
                    </select>
                  </div>
                </div>
              </div>
            </Section>

            {/* Source & Classification */}
            <Section icon={BookOpen} title="Source & Classification" subtitle="Where this bill comes from and how it is categorised." tone="bg-violet-50 text-violet-600">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label wajib>Source Document</Label>
                  <select value={sumber} disabled={nonaktif} onChange={e => setSumber(e.target.value)} className={inputCls}>
                    {sumberList.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Source Reference</Label>
                  <input value={refSumber} disabled={nonaktif} maxLength={100} onChange={e => setRefSumber(e.target.value)} placeholder="e.g. GR-2026-0105" className={inputCls} />
                </div>
                <div>
                  <Label wajib>Category</Label>
                  <select value={kategori} disabled={nonaktif} onChange={e => setKategori(e.target.value)} className={inputCls}>
                    {kategoriList.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <Label>Description</Label>
                  <input value={deskripsi} disabled={nonaktif} maxLength={2000} onChange={e => setDeskripsi(e.target.value)} placeholder="Short summary of what was purchased" className={inputCls} />
                </div>
              </div>
            </Section>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Tax & Journal Accounts */}
              <Section icon={Percent} title={<>Tax &amp; Journal Accounts <span title="Tax type applies to all items (you can still change it per item). Accounts default to Settings > Account Mapping."><Info size={14} className="text-muted-foreground" /></span></>}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label wajib>Tax Type</Label>
                    <select value={pajak} disabled={nonaktif} onChange={e => gantiPajak(e.target.value as BillTaxType)} className={inputCls}>
                      {(Object.keys(TAX_LABEL) as BillTaxType[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Tax Inclusive</Label>
                    <button type="button" role="switch" aria-checked={inklusif} disabled={nonaktif} onClick={() => setInklusif(v => !v)}
                      className={`relative mt-1 inline-flex h-6 w-11 items-center rounded-full transition ${inklusif ? 'bg-[#0F7D4E]' : 'bg-slate-200'}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${inklusif ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">{inklusif ? 'Prices include tax' : 'Prices exclude tax'}</p>
                  </div>
                  <div className="col-span-2">
                    <Label wajib>Accounts Payable (Cr)</Label>
                    <AccountSelect accounts={akun} value={akunAp} onChange={setAkunAp} disabled={nonaktif} />
                  </div>
                  <div className="col-span-2">
                    <Label wajib={ring.tax > 0}>Input VAT (Dr)</Label>
                    <AccountSelect accounts={akun} value={akunVat} onChange={setAkunVat} disabled={nonaktif} />
                  </div>
                </div>
              </Section>

              {/* Additional Information */}
              <Section icon={FileText} title="Additional Information">
                <Label>Notes</Label>
                <textarea value={catatan} disabled={nonaktif} onChange={e => setCatatan(e.target.value.slice(0, MAKS_CATATAN))} rows={6}
                  placeholder="e.g. Pay by bank transfer before the due date" className={inputCls} />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{catatan.length}/{MAKS_CATATAN}</p>
              </Section>
            </div>

            {/* Bill Items */}
            <Section icon={FileText} title="Bill Items" subtitle="Each item is posted to its own GL account."
              action={<button type="button" disabled={nonaktif} onClick={tambahBaris} className={`${btnSmall} px-4 py-2`}><Plus size={14} /> Add Item</button>}>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[1250px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                      <th className="w-10 px-2 py-2.5 text-center font-medium">#</th>
                      <th className="w-[110px] px-2 py-2.5 text-left font-medium">Item Code</th>
                      <th className="w-[200px] px-2 py-2.5 text-left font-medium">Description <span className="text-rose-500">*</span></th>
                      <th className="w-[220px] px-2 py-2.5 text-left font-medium">GL Account <span className="text-rose-500">*</span></th>
                      <th className="w-[80px] px-2 py-2.5 text-left font-medium">Qty <span className="text-rose-500">*</span></th>
                      <th className="w-[140px] px-2 py-2.5 text-left font-medium">Unit Price <span className="text-rose-500">*</span></th>
                      <th className="w-[130px] px-2 py-2.5 text-left font-medium">Discount</th>
                      <th className="w-[110px] px-2 py-2.5 text-left font-medium">Tax</th>
                      <th className="w-[130px] px-2 py-2.5 text-right font-medium">Amount</th>
                      <th className="w-12 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {baris.map((b, i) => {
                      const h = hitung(b, inklusif);
                      return (
                        <tr key={b.key} className="align-top">
                          <td className="px-2 py-2 pt-4 text-center text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-2">
                            <input value={b.item_code} disabled={nonaktif} maxLength={50} placeholder="Code" onChange={e => ubahBaris(b.key, { item_code: e.target.value })} className={`${inputCls} py-2`} />
                          </td>
                          <td className="px-2 py-2">
                            <input value={b.description} disabled={nonaktif} maxLength={2000} placeholder="Item or service description"
                              onChange={e => ubahBaris(b.key, { description: e.target.value })} className={`${inputCls} py-2`} />
                          </td>
                          <td className="px-2 py-2">
                            <AccountSelect accounts={akun} value={b.account_code} disabled={nonaktif} onChange={c => ubahBaris(b.key, { account_code: c })} className="py-2" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min={0} step="any" value={b.quantity || ''} disabled={nonaktif}
                              onChange={e => ubahBaris(b.key, { quantity: Number(e.target.value) })} className={`${inputCls} py-2`} />
                            <input value={b.unit} disabled={nonaktif} maxLength={20} placeholder="unit" onChange={e => ubahBaris(b.key, { unit: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:border-border focus:border-border focus:outline-none" />
                          </td>
                          <td className="px-2 py-2"><MoneyInput value={b.unit_price} disabled={nonaktif} onChange={n => ubahBaris(b.key, { unit_price: n })} className="py-0.5" /></td>
                          <td className="px-2 py-2">
                            <div className="flex">
                              <input type="number" min={0} step="any" value={b.discount_value || ''} disabled={nonaktif} placeholder="0"
                                onChange={e => ubahBaris(b.key, { discount_value: Number(e.target.value) })}
                                className="w-full min-w-0 rounded-l-lg border border-border bg-card px-2 py-2 text-right text-sm focus:outline-none" />
                              <select value={b.discount_type} disabled={nonaktif} onChange={e => ubahBaris(b.key, { discount_type: e.target.value as BillDiscountType })}
                                className="rounded-r-lg border border-l-0 border-border bg-card px-1 text-xs">
                                <option value="percent">%</option>
                                <option value="amount">Rp</option>
                              </select>
                            </div>
                            {h.discount > 0 && <p className="mt-1 text-right text-[11px] text-muted-foreground">-{rupiah(h.discount)}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <select value={b.tax_type} disabled={nonaktif} onChange={e => ubahBaris(b.key, { tax_type: e.target.value as BillTaxType })} className={`${inputCls} py-2`}>
                              {(Object.keys(TAX_LABEL) as BillTaxType[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2 pt-4 text-right font-semibold text-foreground">{rupiah(h.amount)}</td>
                          <td className="px-2 py-2 pt-3 text-center">
                            <button type="button" disabled={nonaktif} aria-label="Remove item"
                              onClick={() => setBaris(bs => (bs.length > 1 ? bs.filter(x => x.key !== b.key) : [barisKosong(pajak, opsi?.defaults.line ?? '')]))}
                              className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={16} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
                <button type="button" disabled={nonaktif} onClick={tambahBaris}
                  className="flex items-center gap-4 rounded-xl border-2 border-dashed border-[#22C55E]/50 bg-[#ECFDF5]/40 px-4 py-3 text-left hover:bg-[#ECFDF5] disabled:opacity-50">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#0F7D4E]"><Plus size={20} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Add Item</span>
                    <span className="text-xs text-muted-foreground">Add a line for another product or service.</span>
                  </span>
                </button>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Subtotal{inklusif ? ' (excl. tax)' : ''}</span><span>{rupiah(ring.dpp)}</span></div>
                  {ring.discount > 0 && <div className="flex justify-between py-0.5 text-xs"><span className="text-muted-foreground">Discount included</span><span>-{rupiah(ring.discount)}</span></div>}
                  <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Input VAT</span><span>{rupiah(ring.tax)}</span></div>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    <span className="text-base font-bold text-[#0B5E5C]">Accounts Payable</span>
                    <span className="text-xl font-bold text-[#0B5E5C]">{rupiah(ring.total)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Payment status after posting: Unpaid · due {jatuhTempo || '—'}</p>
                </div>
              </div>
            </Section>
          </div>

          {/* Panel kanan */}
          <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
            <Section icon={BookOpen} title="Accounting Impact" subtitle="Journal entry created when this bill is posted." tone="bg-emerald-50 text-emerald-600">
              {jurnal.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-5 text-center text-xs text-muted-foreground">Add items with a GL account to see the journal entry.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1.5 text-left font-medium">Account</th><th className="py-1.5 text-right font-medium">Debit</th><th className="py-1.5 text-right font-medium">Credit</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {jurnal.map(j => (
                      <tr key={`${j.code}-${j.credit ? 'c' : 'd'}`}>
                        <td className={`py-1.5 pr-2 ${j.credit ? 'pl-4' : ''}`}><span className="font-mono">{j.code}</span><span className="block text-[11px] text-muted-foreground">{j.name}</span></td>
                        <td className="py-1.5 text-right align-top">{j.debit ? rupiah(j.debit) : ''}</td>
                        <td className="py-1.5 text-right align-top">{j.credit ? rupiah(j.credit) : ''}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold"><td className="py-1.5">Total</td><td className="py-1.5 text-right">{rupiah(ring.dpp + ring.tax)}</td><td className="py-1.5 text-right">{rupiah(ring.total)}</td></tr>
                  </tbody>
                </table>
              )}
            </Section>

            <Section icon={CheckCircle2} title="Validation" tone="bg-amber-50 text-amber-600"
              subtitle={salah.length || peringatan.length ? `${salah.length} to fix · ${peringatan.length} warning${peringatan.length === 1 ? '' : 's'}` : 'Ready to submit'}>
              <ul className="space-y-2 text-xs">
                {cek.map(c => (
                  <li key={c.key} className={`flex items-start gap-2 ${c.ok ? 'text-slate-600' : c.level === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
                    {c.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">The server re-checks everything on save (including that every account exists in this company&apos;s chart of accounts).</p>
            </Section>

            <Section icon={Loader} title="Approval Flow" subtitle="What happens after you save." tone="bg-violet-50 text-violet-600">
              <ol className="space-y-3 text-sm">
                {['Draft', 'Pending Review', 'Approved', 'Posted'].map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i <= posisi ? 'bg-[#0F7D4E] text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className={i === posisi ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{s}{i === posisi ? ' — you are here' : ''}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">After posting, the bill appears in Accounts Payable and can be paid from Cash &amp; Bank.</p>
            </Section>
          </aside>
        </div>
      </div>

      {preview && (
        <PreviewModal onClose={() => setPreview(false)} data={{
          company: activeClientName ?? '', nomor, status: badge, vendor, vendorCode: vendorKode, invoice, po, invoiceDate: tglInvoice,
          purchaseDate: tglBeli, dueDate: jatuhTempo, termin, catatan, inklusif, subtotal: ring.dpp, tax: ring.tax, total: ring.total,
          baris: ring.isi.map(x => ({ b: x.b, amount: x.amount, discount: x.discount, tax: x.tax })), jurnal,
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
