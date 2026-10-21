'use client';

// Form Create Invoice (Accounts Receivable) -- layout mengikuti
// dataset/picture/Template UI/Account Receivable/4.jpeg: Invoice Information,
// Billing Address, Tax Settings, Additional Information, Invoice Items +
// ringkasan, tombol Preview / Cancel / Save Draft / Submit for Approval.
// Disimpan backend sebagai invoice Sales (posting_status Draft / Review) +
// item & detail pajak (modules/finance/receivables_ar_v1.py). Submit for
// Approval -> disetujui & diposting di Sales > Journal Preview, baru masuk AR.
// Mode edit: ?id=<invoice>. Prefill customer: ?customer=<nama>.
// Dipakai juga dari Sales > Sales Transaction (context="sales"): form sama,
// cuma breadcrumb & halaman tujuan setelah simpan/cancel yang beda.

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDays, ChevronRight, Eye, FileText, Info, Loader2, MapPin, PackagePlus, Percent, Plus, Printer, Save, Search, Send,
  Settings2, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import {
  computeInvoiceLine, createInvoiceEntry, deleteInvoiceEntry, fetchArCustomers, fetchInvoiceEntry, fetchInvoiceFormOptions, fmtDate,
  LEVEL_INPUT, roleLevel, rupiah, TAX_LABEL, TAX_RATE, todayIso, updateInvoiceEntry, useArApData,
  type ArCustomer, type DiscountType, type InvoiceEntry, type InvoiceEntryInput, type InvoiceFormOptions, type InvoiceProductOption,
  type TaxCode,
} from '@/lib/receivablesPayablesStore';
import { btnOutline, btnPrimary, btnSmall, inputCls, Menu, MenuItem } from './arapUi';
import { Label, MoneyInput } from './SettlementForm';
import CustomerModal from './CustomerModal';

const TERMIN_DEFAULT = ['Due on Receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90'];
const MAKS_CATATAN = 500;

interface Baris {
  key: string;
  product_name: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_type: DiscountType;
  discount_value: number;
  tax_code: TaxCode;
}

let urutKunci = 0;
const kunciBaru = () => `l${++urutKunci}`;
const barisKosong = (tax: TaxCode): Baris => ({
  key: kunciBaru(), product_name: '', description: '', quantity: 1, unit: '', unit_price: 0, discount_type: 'percent', discount_value: 0, tax_code: tax,
});
const isiBaris = (b: Baris) => !!(b.product_name.trim() || b.description.trim() || b.unit_price);

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

function SectionTitle({ icon: Ikon, title, subtitle, tone = 'bg-sky-50 text-sky-600', extra }: {
  icon: React.ElementType; title: string; subtitle?: string; tone?: string; extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Ikon size={18} /></span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">{title}{extra}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

export type InvoiceFormContext = 'ar' | 'sales';

// Breadcrumb + halaman asal per pemanggil form.
const KONTEKS: Record<InvoiceFormContext, { crumbs: { label: string; href: string }[]; list: string; self: string; subtitle: string }> = {
  ar: {
    crumbs: [{ label: 'Accounts Receivable', href: '/accounts-receivable' }, { label: 'Invoices', href: '/accounts-receivable?tab=invoices' }],
    list: '/accounts-receivable?tab=invoices',
    self: '/accounts-receivable/invoices/new',
    subtitle: 'Create a customer invoice to record a trade receivable.',
  },
  sales: {
    crumbs: [{ label: 'Sales', href: '/transactions/sales' }, { label: 'Sales Transaction', href: '/transactions/sales?tab=sales-transaction' }],
    list: '/transactions/sales?tab=sales-transaction',
    self: '/transactions/sales/invoice/new',
    subtitle: 'Create a sales transaction (customer invoice). After approval and posting it is recorded as a trade receivable.',
  },
};

/** Pilih customer dari master / invoice, atau ketik nama baru. */
function CustomerPicker({ customers, value, onPick, onClear, disabled }: {
  customers: ArCustomer[]; value: string; onPick: (c: ArCustomer | string) => void; onClear: () => void; disabled?: boolean;
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
  const daftar = customers.filter(c => !kata || c.name.toLowerCase().includes(kata) || (c.code ?? '').toLowerCase().includes(kata)).slice(0, 60);
  const persis = customers.some(c => c.name.toLowerCase() === kata);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => { setBuka(o => !o); setQ(''); }}
        className={`${inputCls} flex items-center justify-between gap-2 py-3 text-left`}>
        <span className={`truncate ${value ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{value || 'Select or type a customer...'}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {value && !disabled && (
            <span role="button" tabIndex={0} aria-label="Clear customer" onClick={e => { e.stopPropagation(); onClear(); }}
              className="rounded p-0.5 hover:bg-slate-100"><X size={14} /></span>
          )}
          <ChevronRight size={14} className={`transition ${buka ? '-rotate-90' : 'rotate-90'}`} />
        </span>
      </button>
      {buka && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg">
          <label className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or customer ID..."
              className="w-full bg-transparent text-sm focus:outline-none"
              onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !persis) { onPick(q.trim()); setBuka(false); } }} />
          </label>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {daftar.map(c => (
              <button key={`${c.id ?? ''}${c.name}`} type="button" onClick={() => { onPick(c); setBuka(false); }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{c.name}</span>
                  <span className="text-[11px] text-muted-foreground">{c.code ?? 'Not in customer master yet'}{c.npwp ? ` · ${c.npwp}` : ''}</span>
                </span>
                {c.outstanding > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{rupiah(c.outstanding)}</span>}
              </button>
            ))}
            {q.trim() && !persis && (
              <button type="button" onClick={() => { onPick(q.trim()); setBuka(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[#0F7D4E] hover:bg-[#ECFDF5]">
                <Plus size={14} /> New customer &quot;{q.trim().toUpperCase()}&quot;
              </button>
            )}
            {!daftar.length && !q.trim() && <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">No customers yet — type a name to add one.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportProductModal({ products, onClose, onAdd }: {
  products: InvoiceProductOption[]; onClose: () => void; onAdd: (p: InvoiceProductOption[]) => void;
}) {
  const [q, setQ] = useState('');
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const kata = q.trim().toLowerCase();
  const daftar = products.filter(p => !kata || p.name.toLowerCase().includes(kata) || (p.description ?? '').toLowerCase().includes(kata));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">Import from Product</h3>
            <p className="text-xs text-muted-foreground">Products and services used on previous invoices, with their last price.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 pt-3">
          <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search product or service..." className="w-full bg-transparent text-sm focus:outline-none" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {daftar.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
              {products.length ? 'No matching products.' : 'No products yet. Items you add to invoices appear here for reuse.'}
            </p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {daftar.map(p => (
                <label key={p.name} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" className="accent-[#0F7D4E]" checked={pilih.has(p.name)}
                    onChange={() => setPilih(s => { const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; })} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{p.description || '—'} · used {p.times_used}× · last {fmtDate(p.last_used)}</span>
                  </span>
                  <span className="text-right text-sm font-semibold text-foreground">{rupiah(p.unit_price)}<span className="block text-[10px] font-normal text-muted-foreground">{TAX_LABEL[p.tax_code]}</span></span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" disabled={!pilih.size} className={btnPrimary}
            onClick={() => { onAdd(products.filter(p => pilih.has(p.name))); onClose(); }}>
            <PackagePlus size={16} /> Add {pilih.size || ''} Item{pilih.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Ringkasan {
  subtotal: number; discount: number; dpp: number; tax: number; total: number; perPajak: [TaxCode, number][];
  baris: (ReturnType<typeof computeInvoiceLine> & { b: Baris })[];
}

function hitungRingkasan(lines: Baris[], inklusif: boolean): Ringkasan {
  const baris = lines.filter(isiBaris).map(b => ({ ...computeInvoiceLine(b, inklusif), b }));
  const perPajak = new Map<TaxCode, number>();
  baris.forEach(x => { if (x.tax) perPajak.set(x.b.tax_code, (perPajak.get(x.b.tax_code) ?? 0) + x.tax); });
  const subtotal = baris.reduce((n, x) => n + x.amount, 0);
  const dpp = baris.reduce((n, x) => n + x.dpp, 0);
  const tax = baris.reduce((n, x) => n + x.tax, 0);
  return {
    subtotal, dpp, tax, total: Math.round((dpp + tax) * 100) / 100,
    discount: baris.reduce((n, x) => n + x.discount, 0), perPajak: Array.from(perPajak.entries()), baris,
  };
}

function PreviewModal({ data, ring, clientName, onClose }: {
  data: { nomor: string; tanggal: string; jatuhTempo: string; termin: string; customer: string; npwp: string; kode: string | null;
    alamat: string; cabang: string; proyek: string; catatan: string; inklusif: boolean; status: string };
  ring: Ringkasan; clientName: string; onClose: () => void;
}) {
  const cetak = () => {
    const el = document.getElementById('invoice-preview-doc');
    if (!el) return;
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) return;
    w.document.write(`<html><head><title>${data.nomor}</title><style>
      body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:32px;font-size:12px}
      table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}
      th{background:#ECFDF5;color:#0B5E5C;font-size:11px}.r{text-align:right}.muted{color:#64748b}
      h1{font-size:22px;margin:0;color:#0F7D4E}.grid{display:flex;justify-content:space-between;gap:24px;margin:20px 0}
      .tot td{border:none;padding:3px 8px}.grand td{font-size:15px;font-weight:700;border-top:2px solid #0F7D4E}
    </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-bold text-foreground">Invoice Preview</h3>
          <div className="flex gap-2">
            <button type="button" onClick={cetak} className={btnSmall}><Printer size={13} /> Print</button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          <div id="invoice-preview-doc" className="text-sm text-slate-900">
            <div className="grid" style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
              <div>
                <h1 className="text-2xl font-bold text-[#0F7D4E]">INVOICE</h1>
                <p className="muted text-xs text-slate-500">{data.nomor || '(number assigned on save)'} · {data.status}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{clientName}</p>
                <p className="muted text-xs text-slate-500">{data.cabang}</p>
              </div>
            </div>
            <div className="grid my-5" style={{ display: 'flex', justifyContent: 'space-between', gap: 24, margin: '20px 0' }}>
              <div>
                <p className="muted text-[11px] uppercase text-slate-500">Bill To</p>
                <p className="font-semibold">{data.customer || '—'}{data.kode ? ` (${data.kode})` : ''}</p>
                {data.npwp && <p className="text-xs">NPWP: {data.npwp}</p>}
                <p className="whitespace-pre-line text-xs text-slate-600">{data.alamat}</p>
              </div>
              <table style={{ width: 'auto' }} className="text-xs">
                <tbody>
                  <tr><td className="muted pr-4 text-slate-500">Invoice Date</td><td>{fmtDate(data.tanggal)}</td></tr>
                  <tr><td className="muted pr-4 text-slate-500">Due Date</td><td>{fmtDate(data.jatuhTempo)}</td></tr>
                  <tr><td className="muted pr-4 text-slate-500">Payment Terms</td><td>{data.termin}</td></tr>
                  {data.proyek && <tr><td className="muted pr-4 text-slate-500">Project</td><td>{data.proyek}</td></tr>}
                </tbody>
              </table>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#ECFDF5] text-[#0B5E5C]">
                  <th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Product / Service</th>
                  <th className="r px-2 py-1.5 text-right">Qty</th><th className="r px-2 py-1.5 text-right">Unit Price</th>
                  <th className="r px-2 py-1.5 text-right">Discount</th><th className="px-2 py-1.5 text-left">Tax</th>
                  <th className="r px-2 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ring.baris.map((x, i) => (
                  <tr key={x.b.key} className="border-b border-slate-100">
                    <td className="px-2 py-1.5">{i + 1}</td>
                    <td className="px-2 py-1.5"><b>{x.b.product_name || '—'}</b>{x.b.description && <div className="muted text-slate-500">{x.b.description}</div>}</td>
                    <td className="r px-2 py-1.5 text-right">{x.b.quantity}{x.b.unit ? ` ${x.b.unit}` : ''}</td>
                    <td className="r px-2 py-1.5 text-right">{rupiah(x.b.unit_price)}</td>
                    <td className="r px-2 py-1.5 text-right">{x.discount ? rupiah(x.discount) : '—'}</td>
                    <td className="px-2 py-1.5">{TAX_LABEL[x.b.tax_code]}</td>
                    <td className="r px-2 py-1.5 text-right">{rupiah(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="tot ml-auto mt-3 w-72 text-xs" style={{ width: 300, marginLeft: 'auto', marginTop: 12 }}>
              <tbody>
                <tr><td>Subtotal{data.inklusif ? ' (incl. tax)' : ''}</td><td className="r text-right">{rupiah(ring.subtotal)}</td></tr>
                {data.inklusif && <tr><td>Tax Base (DPP)</td><td className="r text-right">{rupiah(ring.dpp)}</td></tr>}
                {ring.perPajak.map(([k, v]) => <tr key={k}><td>{TAX_LABEL[k]}{data.inklusif ? ' (included)' : ''}</td><td className="r text-right">{rupiah(v)}</td></tr>)}
                <tr className="grand text-sm font-bold"><td className="border-t-2 border-[#0F7D4E] pt-1">Grand Total</td><td className="r border-t-2 border-[#0F7D4E] pt-1 text-right">{rupiah(ring.total)}</td></tr>
              </tbody>
            </table>
            {data.catatan && <p className="mt-6 whitespace-pre-line text-xs text-slate-600"><b>Notes:</b> {data.catatan}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateInvoiceInner({ context }: { context: InvoiceFormContext }) {
  const ktx = KONTEKS[context];
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');
  const { activeClientId, activeClientName } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const { user } = useAuth();
  const bolehInput = roleLevel(user?.role) >= LEVEL_INPUT;

  const customers = useArApData<ArCustomer[]>(kid ? `cust:${kid}` : null, s => fetchArCustomers(kid!, s), []);
  const [opsi, setOpsi] = useState<InvoiceFormOptions | null>(null);

  const [asal, setAsal] = useState<InvoiceEntry | null>(null);
  const [memuat, setMemuat] = useState(!!editId);
  const [nomor, setNomor] = useState('');
  const [nomorManual, setNomorManual] = useState(false);
  const [tanggal, setTanggal] = useState(todayIso());
  const [jatuhTempo, setJatuhTempo] = useState(tambahHari(todayIso(), 30));
  const [tempoManual, setTempoManual] = useState(false);
  const [termin, setTermin] = useState('Net 30');
  const [mataUang, setMataUang] = useState('IDR');
  const [cabang, setCabang] = useState('Head Office');
  const [proyek, setProyek] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerNama, setCustomerNama] = useState(params.get('customer') ?? '');
  const [npwp, setNpwp] = useState('');
  const [alamat, setAlamat] = useState('');
  const [pajak, setPajak] = useState<TaxCode>('ppn_11');
  const [inklusif, setInklusif] = useState(false);
  const [catatan, setCatatan] = useState('');
  const [baris, setBaris] = useState<Baris[]>(() => [barisKosong('ppn_11')]);
  const [busy, setBusy] = useState<null | 'draft' | 'submit' | 'delete'>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [modalCustomer, setModalCustomer] = useState<Partial<ArCustomer> | null | undefined>(undefined);
  const [importProduk, setImportProduk] = useState(false);
  const [preview, setPreview] = useState(false);

  const terkunci = !!asal && !asal.editable;
  const dipilih = customers.data.find(c => (customerId ? c.id === customerId : c.name === customerNama.trim().toUpperCase()));

  // Opsi form (nomor berikut mengikuti tahun tanggal invoice).
  useEffect(() => {
    if (!kid) return;
    const ctrl = new AbortController();
    fetchInvoiceFormOptions(kid, tanggal, ctrl.signal).then(o => {
      setOpsi(o);
      if (!editId && !nomorManual) setNomor(o.next_number);
    }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error((e as Error).message); });
    return () => ctrl.abort();
  }, [kid, tanggal.slice(0, 4)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode edit.
  useEffect(() => {
    if (!kid || !editId) return;
    setMemuat(true);
    fetchInvoiceEntry(kid, editId).then(e => {
      setAsal(e);
      setNomor(e.invoice_no); setNomorManual(true);
      setTanggal(e.invoice_date); setJatuhTempo(e.due_date ?? e.invoice_date); setTempoManual(true);
      setTermin(e.payment_terms || 'Net 30'); setMataUang(e.currency || 'IDR');
      setCabang(e.branch ?? ''); setProyek(e.project ?? '');
      setCustomerId(e.customer_id); setCustomerNama(e.customer_name); setNpwp(e.customer_npwp ?? ''); setAlamat(e.billing_address ?? '');
      setPajak(e.tax_type); setInklusif(e.tax_inclusive); setCatatan(e.notes ?? '');
      setBaris(e.lines.length ? e.lines.map(l => ({
        key: kunciBaru(), product_name: l.product_name, description: l.description ?? '', quantity: l.quantity, unit: l.unit ?? '',
        unit_price: l.unit_price, discount_type: l.discount_type, discount_value: l.discount_value, tax_code: l.tax_code,
      })) : [barisKosong(e.tax_type)]);
    }).catch(e => toast.error((e as Error).message)).finally(() => setMemuat(false));
  }, [kid, editId]);

  // Jatuh tempo otomatis dari termin (kecuali diubah manual).
  useEffect(() => {
    if (!tempoManual && tanggal) setJatuhTempo(tambahHari(tanggal, hariTermin(termin)));
  }, [tanggal, termin, tempoManual]);

  const pilihCustomer = (c: ArCustomer | string) => {
    if (typeof c === 'string') {
      setCustomerId(null); setCustomerNama(c.toUpperCase()); setNpwp(''); setAlamat('');
      return;
    }
    setCustomerId(c.id); setCustomerNama(c.name); setNpwp(c.npwp ?? ''); setAlamat(c.billing_address ?? '');
    if (c.payment_terms) { setTermin(c.payment_terms); setTempoManual(false); }
  };

  const ubahBaris = (key: string, patch: Partial<Baris>) => setBaris(bs => bs.map(b => (b.key === key ? { ...b, ...patch } : b)));
  const pilihProduk = (key: string, nama: string) => {
    const p = opsi?.products.find(x => x.name.toLowerCase() === nama.trim().toLowerCase());
    setBaris(bs => bs.map(b => (b.key !== key ? b : p ? {
      ...b, product_name: p.name, description: b.description || p.description || '', unit: b.unit || p.unit || '',
      unit_price: b.unit_price || p.unit_price, tax_code: pajak === 'non_ppn' ? 'non_ppn' : p.tax_code,
    } : { ...b, product_name: nama })));
  };
  const gantiPajak = (t: TaxCode) => {
    setPajak(t);
    setBaris(bs => bs.map(b => ({ ...b, tax_code: t })));
  };
  const tambahProduk = (ps: InvoiceProductOption[]) => setBaris(bs => [
    ...bs.filter(isiBaris),
    ...ps.map(p => ({ ...barisKosong(pajak === 'non_ppn' ? 'non_ppn' : p.tax_code), product_name: p.name, description: p.description ?? '', unit: p.unit ?? '', unit_price: p.unit_price })),
  ]);

  const ring = useMemo(() => hitungRingkasan(baris, inklusif), [baris, inklusif]);

  const validasi = (): string[] => {
    const e: string[] = [];
    if (!customerNama.trim()) e.push('Choose a customer.');
    if (!nomor.trim()) e.push('Enter the invoice number.');
    if (!tanggal) e.push('Enter the invoice date.');
    if (jatuhTempo && tanggal && jatuhTempo < tanggal) e.push('The due date cannot be earlier than the invoice date.');
    if (!cabang.trim()) e.push('Choose the branch.');
    const isi = baris.filter(isiBaris);
    if (!isi.length) e.push('Add at least one invoice item.');
    isi.forEach((b, i) => {
      if (!b.product_name.trim()) e.push(`Item ${i + 1}: choose or type a product / service.`);
      if (!(b.quantity > 0)) e.push(`Item ${i + 1}: quantity must be greater than zero.`);
      if (b.discount_type === 'percent' && b.discount_value > 100) e.push(`Item ${i + 1}: discount cannot exceed 100%.`);
      if (b.discount_type === 'amount' && b.discount_value > b.quantity * b.unit_price) e.push(`Item ${i + 1}: discount cannot exceed the line amount.`);
    });
    if (isi.length && ring.total <= 0) e.push('The invoice total must be greater than zero.');
    return e;
  };

  const simpan = async (submit: boolean) => {
    if (!kid) return;
    const e = validasi();
    setErrors(e);
    if (e.length) { toast.error(e[0]); return; }
    const input: InvoiceEntryInput = {
      client_id: kid, invoice_no: nomor.trim(), invoice_date: tanggal, due_date: jatuhTempo || null, payment_terms: termin,
      currency: mataUang, branch: cabang.trim(), project: proyek.trim() || null, customer_id: customerId,
      customer_name: customerNama.trim(), customer_npwp: npwp.trim() || null, billing_address: alamat.trim() || null,
      tax_type: pajak, tax_inclusive: inklusif, notes: catatan.trim() || null, submit,
      lines: baris.filter(isiBaris).map(b => ({
        product_name: b.product_name.trim(), description: b.description.trim() || null, quantity: b.quantity, unit: b.unit.trim() || null,
        unit_price: b.unit_price, discount_type: b.discount_type, discount_value: b.discount_value, tax_code: b.tax_code,
      })),
    };
    setBusy(submit ? 'submit' : 'draft');
    try {
      const r = asal ? await updateInvoiceEntry(asal.id, input) : await createInvoiceEntry(input);
      toast.success(r.message);
      if (submit) {
        router.push(ktx.list);
      } else {
        setAsal(r.data);
        setNomor(r.data.invoice_no); setNomorManual(true);
        setCustomerId(r.data.customer_id);
        customers.refresh();
        if (!editId) router.replace(`${ktx.self}?id=${r.data.id}`, { scroll: false });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const hapus = async () => {
    if (!kid || !asal || !window.confirm(`Delete ${asal.invoice_no}?`)) return;
    setBusy('delete');
    try {
      const r = await deleteInvoiceEntry(kid, asal.id);
      toast.success(r.message);
      router.push(ktx.list);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!kid) return <div className="p-6 text-sm text-amber-800">Select a client first (Switch Company in the top bar).</div>;
  if (memuat) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading...</div>;

  const termin2 = opsi?.payment_terms?.length ? opsi.payment_terms : TERMIN_DEFAULT;
  const terminList = termin2.includes(termin) ? termin2 : [termin, ...termin2];
  const nonaktif = terkunci || !bolehInput;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <nav className="mb-1 flex flex-wrap items-center gap-2 text-sm">
              {ktx.crumbs.map(c => (
                <React.Fragment key={c.href}>
                  <Link href={c.href} className="text-muted-foreground hover:text-foreground hover:underline">{c.label}</Link>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </React.Fragment>
              ))}
              <span className="font-semibold text-foreground">{asal ? asal.invoice_no : 'Create Invoice'}</span>
            </nav>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <FileText size={26} className="text-[#0F7D4E]" /> {asal ? 'Edit Invoice' : 'Create Invoice'}
              {asal && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${asal.status === 'Review' ? 'bg-sky-50 text-sky-700' : asal.status === 'Draft' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {asal.status === 'Review' ? 'Awaiting Approval' : asal.status}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{ktx.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreview(true)} className={btnOutline}><Eye size={16} /> Preview</button>
            <Link href={ktx.list} className={btnOutline}>Cancel</Link>
            {asal?.editable && (
              <button type="button" onClick={hapus} disabled={!!busy || !bolehInput} className={`${btnOutline} text-rose-600`}>
                {busy === 'delete' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete
              </button>
            )}
            <button type="button" onClick={() => simpan(false)} disabled={!!busy || nonaktif}
              className={`${btnOutline} border-[#0F7D4E] text-[#0F7D4E]`}>
              {busy === 'draft' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Draft
            </button>
            <button type="button" onClick={() => simpan(true)} disabled={!!busy || nonaktif} className={btnPrimary}>
              {busy === 'submit' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit for Approval
            </button>
          </div>
        </div>

        {!bolehInput && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Your role can view but not create invoices (Supervisor or above).</div>
        )}
        {terkunci && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {asal!.invoice_no} is {asal!.status}{asal!.created_here ? '' : ' and was imported in Sales'}; it can no longer be edited here.
          </div>
        )}
        {asal?.status === 'Review' && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            <span>Submitted for approval{asal.submitted_by_name ? ` by ${asal.submitted_by_name}` : ''}. Approve and post it in Sales &gt; Journal Preview — it appears in Accounts Receivable once posted. Saving changes returns it to draft.</span>
            <Link href="/transactions/sales?tab=journal-preview" className="font-semibold underline">Open Journal Preview</Link>
          </div>
        )}
        {errors.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <ul className="list-disc space-y-0.5 pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        {/* Invoice Information */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <SectionTitle icon={FileText} title="Invoice Information" subtitle="Basic invoice details." />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Label wajib>Customer</Label>
              <CustomerPicker customers={customers.data} value={customerNama} onPick={pilihCustomer} disabled={nonaktif}
                onClear={() => { setCustomerId(null); setCustomerNama(''); setNpwp(''); setAlamat(''); }} />
              {customerNama && (
                <div className="mt-3 flex items-start gap-3 rounded-xl bg-sky-50/70 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sky-600"><FileText size={16} /></span>
                  <div className="min-w-0 flex-1 text-xs text-slate-600">
                    <p className="truncate text-sm font-semibold text-foreground">{customerNama}</p>
                    <p>NPWP: {npwp || dipilih?.npwp || '—'}</p>
                    <p>Customer ID: {dipilih?.code ?? 'New — assigned on save'}</p>
                    {dipilih && dipilih.outstanding > 0 && <p>Outstanding: {rupiah(dipilih.outstanding)}</p>}
                  </div>
                  <button type="button" disabled={nonaktif && !dipilih?.id}
                    onClick={() => setModalCustomer(dipilih ?? { name: customerNama, npwp, billing_address: alamat })}
                    className="shrink-0 text-xs font-medium text-sky-700 hover:underline">
                    {dipilih?.id ? 'View Details' : 'Add Details'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-7">
              <div>
                <Label wajib>Invoice No.</Label>
                <div className="flex items-stretch">
                  <input value={nomor} disabled={nonaktif} maxLength={100} onChange={e => { setNomor(e.target.value); setNomorManual(true); }}
                    placeholder="INV/YYYY/####" className={`${inputCls} rounded-r-none`} />
                  <Menu width="w-56" button={() => (
                    <button type="button" disabled={nonaktif} title="Numbering" className="flex h-full items-center rounded-r-xl border border-l-0 border-border px-2.5 text-muted-foreground hover:bg-slate-50">
                      <Settings2 size={16} />
                    </button>
                  )}>
                    {close => (
                      <>
                        <MenuItem onClick={() => { close(); setNomorManual(false); if (opsi) setNomor(asal?.invoice_no ?? opsi.next_number); }}>Use automatic number{opsi ? ` (${asal?.invoice_no ?? opsi.next_number})` : ''}</MenuItem>
                        <MenuItem onClick={() => { close(); setNomorManual(true); }}>Enter number manually</MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
              <div>
                <Label wajib>Invoice Date</Label>
                <div className="relative">
                  <CalendarDays size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="date" value={tanggal} disabled={nonaktif} max="2999-12-31" onChange={e => setTanggal(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <Label wajib>Due Date</Label>
                <input type="date" value={jatuhTempo} disabled={nonaktif} min={tanggal} max="2999-12-31"
                  onChange={e => { setJatuhTempo(e.target.value); setTempoManual(true); }} className={inputCls} />
                {tempoManual && !nonaktif && (
                  <button type="button" onClick={() => setTempoManual(false)} className="mt-1 text-[11px] text-[#0F7D4E] hover:underline">Follow payment terms</button>
                )}
              </div>
              <div>
                <Label wajib>Payment Terms</Label>
                <select value={termin} disabled={nonaktif} onChange={e => { setTermin(e.target.value); setTempoManual(false); }} className={inputCls}>
                  {terminList.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label wajib>Currency</Label>
                <select value={mataUang} disabled={nonaktif} onChange={e => setMataUang(e.target.value)} className={inputCls}>
                  <option value="IDR">IDR - Indonesian Rupiah</option>
                </select>
              </div>
              <div>
                <Label wajib>Branch</Label>
                <input list="ar-branches" value={cabang} disabled={nonaktif} maxLength={100} onChange={e => setCabang(e.target.value)}
                  placeholder="Head Office" className={inputCls} />
                <datalist id="ar-branches">
                  {Array.from(new Set(['Head Office', ...(opsi?.branches ?? [])])).map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
              <div className="sm:col-span-2">
                <Label>Project</Label>
                <div className="relative">
                  <input list="ar-projects" value={proyek} disabled={nonaktif} maxLength={255} onChange={e => setProyek(e.target.value)}
                    placeholder="e.g. PRJ-001 - ERP Implementation" className={`${inputCls} pr-9`} />
                  {proyek && !nonaktif && (
                    <button type="button" onClick={() => setProyek('')} aria-label="Clear project"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-slate-100"><X size={14} /></button>
                  )}
                </div>
                <datalist id="ar-projects">{(opsi?.projects ?? []).map(p => <option key={p} value={p} />)}</datalist>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <SectionTitle icon={MapPin} title="Billing Address" subtitle="Customer billing address." tone="bg-emerald-50 text-emerald-600" />
            <textarea value={alamat} disabled={nonaktif} onChange={e => setAlamat(e.target.value)} rows={5} maxLength={1000}
              placeholder="Street, district, city, postal code, country" className={inputCls} />
          </section>
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <SectionTitle icon={Percent} title="Tax Settings" tone="bg-sky-50 text-sky-600"
              extra={<span title="The tax type applies to all items; you can still change the tax per item."><Info size={14} className="text-muted-foreground" /></span>} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label wajib>Tax Type</Label>
                <select value={pajak} disabled={nonaktif} onChange={e => gantiPajak(e.target.value as TaxCode)} className={inputCls}>
                  {(Object.keys(TAX_LABEL) as TaxCode[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <Label>Tax Inclusive</Label>
                <button type="button" role="switch" aria-checked={inklusif} disabled={nonaktif} onClick={() => setInklusif(v => !v)}
                  className={`relative mt-1 inline-flex h-6 w-11 items-center rounded-full transition ${inklusif ? 'bg-[#0F7D4E]' : 'bg-slate-200'}`}>
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${inklusif ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <p className="mt-1 text-xs text-muted-foreground">{inklusif ? 'Prices already include tax' : 'Prices exclude tax'}</p>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <SectionTitle icon={FileText} title="Additional Information" tone="bg-sky-50 text-sky-600" />
            <Label>Notes</Label>
            <textarea value={catatan} disabled={nonaktif} onChange={e => setCatatan(e.target.value.slice(0, MAKS_CATATAN))} rows={4}
              placeholder="e.g. Payment by bank transfer to ..." className={inputCls} />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{catatan.length}/{MAKS_CATATAN}</p>
          </section>
        </div>

        {/* Invoice Items */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <SectionTitle icon={FileText} title="Invoice Items" subtitle="Add the products or services being billed." />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={nonaktif} onClick={() => setBaris(bs => [...bs, barisKosong(pajak)])}
                className={`${btnSmall} border-[#0F7D4E] px-4 py-2 text-[#0F7D4E]`}><Plus size={14} /> Add Item</button>
              <button type="button" disabled={nonaktif} onClick={() => setImportProduk(true)} className={`${btnSmall} px-4 py-2`}>
                <PackagePlus size={14} /> Import from Product
              </button>
            </div>
          </div>
          <datalist id="ar-products">{(opsi?.products ?? []).map(p => <option key={p.name} value={p.name} />)}</datalist>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                  <th className="w-10 px-2 py-2.5 text-center font-medium">#</th>
                  <th className="w-[200px] px-2 py-2.5 text-left font-medium">Product / Service <span className="text-rose-500">*</span></th>
                  <th className="px-2 py-2.5 text-left font-medium">Description</th>
                  <th className="w-[80px] px-2 py-2.5 text-left font-medium">Qty <span className="text-rose-500">*</span></th>
                  <th className="w-[150px] px-2 py-2.5 text-left font-medium">Unit Price (IDR) <span className="text-rose-500">*</span></th>
                  <th className="w-[140px] px-2 py-2.5 text-left font-medium">Discount</th>
                  <th className="w-[120px] px-2 py-2.5 text-left font-medium">Tax</th>
                  <th className="w-[140px] px-2 py-2.5 text-right font-medium">Amount (IDR)</th>
                  <th className="w-14 px-2 py-2.5 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {baris.map((b, i) => {
                  const h = computeInvoiceLine(b, inklusif);
                  return (
                    <tr key={b.key} className="align-top">
                      <td className="px-2 py-2 pt-4 text-center text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-2">
                        <input list="ar-products" value={b.product_name} disabled={nonaktif} maxLength={255} placeholder="Select product/service..."
                          onChange={e => pilihProduk(b.key, e.target.value)} className={`${inputCls} py-2`} />
                      </td>
                      <td className="px-2 py-2">
                        <input value={b.description} disabled={nonaktif} maxLength={2000} onChange={e => ubahBaris(b.key, { description: e.target.value })}
                          className={`${inputCls} py-2`} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} step="any" value={b.quantity || ''} disabled={nonaktif}
                          onChange={e => ubahBaris(b.key, { quantity: Number(e.target.value) })} className={`${inputCls} py-2`} />
                        <input value={b.unit} disabled={nonaktif} maxLength={30} placeholder="unit" onChange={e => ubahBaris(b.key, { unit: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:border-border focus:border-border focus:outline-none" />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput value={b.unit_price} disabled={nonaktif} onChange={n => ubahBaris(b.key, { unit_price: n })} className="py-0.5" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex">
                          <input type="number" min={0} step="any" value={b.discount_value || ''} disabled={nonaktif} placeholder="0"
                            onChange={e => ubahBaris(b.key, { discount_value: Number(e.target.value) })}
                            className="w-full min-w-0 rounded-l-lg border border-border bg-card px-2 py-2 text-right text-sm focus:outline-none" />
                          <select value={b.discount_type} disabled={nonaktif} onChange={e => ubahBaris(b.key, { discount_type: e.target.value as DiscountType })}
                            className="rounded-r-lg border border-l-0 border-border bg-card px-1 text-xs">
                            <option value="percent">%</option>
                            <option value="amount">Rp</option>
                          </select>
                        </div>
                        {h.discount > 0 && <p className="mt-1 text-right text-[11px] text-muted-foreground">-{rupiah(h.discount)}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <select value={b.tax_code} disabled={nonaktif} onChange={e => ubahBaris(b.key, { tax_code: e.target.value as TaxCode })} className={`${inputCls} py-2`}>
                          {(Object.keys(TAX_LABEL) as TaxCode[]).map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 pt-4 text-right font-semibold text-foreground">{rupiah(h.amount)}</td>
                      <td className="px-2 py-2 pt-3 text-center">
                        <button type="button" disabled={nonaktif} aria-label="Remove item"
                          onClick={() => setBaris(bs => (bs.length > 1 ? bs.filter(x => x.key !== b.key) : [barisKosong(pajak)]))}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
            <button type="button" disabled={nonaktif} onClick={() => setBaris(bs => [...bs, barisKosong(pajak)])}
              className="flex items-center gap-4 rounded-xl border-2 border-dashed border-[#22C55E]/50 bg-[#ECFDF5]/40 px-4 py-3 text-left hover:bg-[#ECFDF5] disabled:opacity-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#0F7D4E]"><Plus size={20} /></span>
              <span>
                <span className="block text-sm font-semibold text-foreground">Add Item</span>
                <span className="text-xs text-muted-foreground">Add a line for another product or service.</span>
              </span>
            </button>
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Subtotal{inklusif ? ' (incl. tax)' : ''}</span><span>{rupiah(ring.subtotal)}</span></div>
              {ring.discount > 0 && <div className="flex justify-between py-0.5 text-xs"><span className="text-muted-foreground">Discount included</span><span>-{rupiah(ring.discount)}</span></div>}
              {inklusif && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Tax Base (DPP)</span><span>{rupiah(ring.dpp)}</span></div>}
              {ring.perPajak.length === 0 && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Tax</span><span>{rupiah(0)}</span></div>}
              {ring.perPajak.map(([k, v]) => (
                <div key={k} className="flex justify-between py-0.5"><span className="text-muted-foreground">{TAX_LABEL[k]}{inklusif ? ' (included)' : ''}</span><span>{rupiah(v)}</span></div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <span className="text-base font-bold text-foreground">Grand Total</span>
                <span className="text-xl font-bold text-foreground">{rupiah(ring.total)}</span>
              </div>
              {TAX_RATE[pajak] > 0 && ring.tax === 0 && ring.baris.length > 0 && <p className="mt-1 text-[11px] text-amber-700">No tax is charged on any item.</p>}
            </div>
          </div>
        </section>
      </div>

      {modalCustomer !== undefined && (
        <CustomerModal clientId={kid} customer={modalCustomer} terms={terminList} onClose={() => setModalCustomer(undefined)}
          onSaved={c => {
            setModalCustomer(undefined);
            customers.refresh();
            pilihCustomer(c);
          }} />
      )}
      {importProduk && <ImportProductModal products={opsi?.products ?? []} onClose={() => setImportProduk(false)} onAdd={tambahProduk} />}
      {preview && (
        <PreviewModal ring={ring} clientName={activeClientName ?? ''} onClose={() => setPreview(false)} data={{
          nomor, tanggal, jatuhTempo, termin, customer: customerNama, npwp: npwp || dipilih?.npwp || '', kode: dipilih?.code ?? null,
          alamat, cabang, proyek, catatan, inklusif, status: asal ? (asal.status === 'Review' ? 'Awaiting Approval' : asal.status) : 'Draft (not saved)',
        }} />
      )}
    </div>
  );
}

export default function CreateInvoiceForm({ context = 'ar' }: { context?: InvoiceFormContext }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
      <CreateInvoiceInner context={context} />
    </Suspense>
  );
}
