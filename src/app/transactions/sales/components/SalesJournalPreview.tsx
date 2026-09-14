'use client';

import React, { useMemo, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, CheckCircle, ChevronRight as Arrow, X, Eye } from 'lucide-react';
import { useLanguage } from '@/lib/language';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type InvoiceStatus = 'Diproses' | 'Siap Posting' | 'Diposting';

interface Invoice {
  id: string;
  customer: string;
  date: string;
  amount: number;
  status: InvoiceStatus;
}

const INITIAL_INVOICES: Invoice[] = [
  { id: 'INV-2024-0185', customer: 'PT Maju Bersama', date: '14 Nov 2024', amount: 620000000, status: 'Diproses' },
  { id: 'INV-2024-0184', customer: 'PT Solusi Digital', date: '14 Nov 2024', amount: 480000000, status: 'Siap Posting' },
  { id: 'INV-2024-0183', customer: 'PT Nusantara Teknologi', date: '12 Nov 2024', amount: 350000000, status: 'Siap Posting' },
  { id: 'INV-2024-0182', customer: 'CV Kreatif Indonesia', date: '10 Nov 2024', amount: 287500000, status: 'Diproses' },
  { id: 'INV-2024-0181', customer: 'PT Global Solusi', date: '08 Nov 2024', amount: 225000000, status: 'Diposting' },
  { id: 'INV-2024-0180', customer: 'PT Sejahtera Abadi', date: '06 Nov 2024', amount: 150000000, status: 'Diposting' },
  { id: 'INV-2024-0179', customer: 'PT Inovasi Mandiri', date: '02 Nov 2024', amount: 175000000, status: 'Siap Posting' },
  { id: 'INV-2024-0178', customer: 'CV Mitra Usaha', date: '01 Nov 2024', amount: 98000000, status: 'Diproses' },
];

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  'Diproses': 'bg-blue-100 text-blue-700',
  'Siap Posting': 'bg-emerald-100 text-emerald-700',
  'Diposting': 'bg-gray-100 text-gray-600',
};

const STEPS = [
  { n: 1, label: 'Source Document', sub: 'Dokumen sumber' },
  { n: 2, label: 'AI Extraction', sub: 'Ekstraksi data' },
  { n: 3, label: 'Accounting Classification', sub: 'Klasifikasi akun' },
  { n: 4, label: 'Tax Treatment', sub: 'Perlakuan pajak' },
  { n: 5, label: 'Journal', sub: 'Jurnal akuntansi' },
  { n: 6, label: 'Approve/Post', sub: 'Persetujuan' },
];

// Step yang sudah tercapai berdasarkan status invoice saat ini.
const stepForStatus = (status: InvoiceStatus) => {
  if (status === 'Diposting') return 6;
  if (status === 'Siap Posting') return 5;
  return 4;
};

const PIUTANG_ACCOUNTS = [
  { code: '1120-01', name: 'Piutang Usaha - IDR' },
  { code: '1120-02', name: 'Piutang Usaha - USD' },
  { code: '1121-01', name: 'Piutang Lain-lain' },
];
const PENDAPATAN_ACCOUNTS = [
  { code: '4100-01', name: 'Pendapatan Jasa Konsultasi' },
  { code: '4100-02', name: 'Pendapatan Jasa Implementasi' },
  { code: '4200-01', name: 'Pendapatan Lain-lain' },
];
const PPN_ACCOUNTS = [
  { code: '2100-01', name: 'PPN Keluaran' },
  { code: '2100-02', name: 'PPN Keluaran - Dipungut Pihak Lain' },
];
const PPH_ACCOUNTS: { code: string | null; name: string }[] = [
  { code: null, name: 'Tidak ada potongan PPh' },
  { code: '1170-01', name: 'PPh Pasal 23 Dibayar Dimuka' },
  { code: '1170-02', name: 'PPh Pasal 4(2) Dibayar Dimuka' },
];

interface Mapping {
  piutang: string;
  pendapatan: string;
  ppn: string;
  pph: string | null;
}

const DEFAULT_MAPPING: Mapping = {
  piutang: PIUTANG_ACCOUNTS[0].code,
  pendapatan: PENDAPATAN_ACCOUNTS[0].code,
  ppn: PPN_ACCOUNTS[0].code,
  pph: null,
};

const findAccount = (list: { code: string | null; name: string }[], code: string | null) =>
  list.find(a => a.code === code) ?? list[0];

const ITEMS_PER_PAGE = 5;

export default function SalesJournalPreview() {
  const { t } = useLanguage();

  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [selectedId, setSelectedId] = useState(INITIAL_INVOICES[0].id);

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [showDocPreview, setShowDocPreview] = useState(false);
  const [isEditingMapping, setIsEditingMapping] = useState(false);
  const [draftMapping, setDraftMapping] = useState<Mapping>(DEFAULT_MAPPING);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(inv => inv.id.toLowerCase().includes(q) || inv.customer.toLowerCase().includes(q));
  }, [invoices, search]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedInvoices = filteredInvoices.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  const selectedInvoice = invoices.find(inv => inv.id === selectedId) ?? invoices[0];
  const mapping = mappings[selectedInvoice.id] ?? DEFAULT_MAPPING;

  // Angka jurnal dihitung ulang dari nominal invoice yang sedang dipilih (bukan statis lagi).
  const dpp = Math.round(selectedInvoice.amount / 1.11);
  const ppn = selectedInvoice.amount - dpp;

  const piutangAcc = findAccount(PIUTANG_ACCOUNTS, mapping.piutang);
  const pendapatanAcc = findAccount(PENDAPATAN_ACCOUNTS, mapping.pendapatan);
  const ppnAcc = findAccount(PPN_ACCOUNTS, mapping.ppn);
  const pphAcc = findAccount(PPH_ACCOUNTS, mapping.pph);

  const journalLines = [
    { no: 1, code: piutangAcc.code as string, name: piutangAcc.name, debit: selectedInvoice.amount, credit: 0 },
    { no: 2, code: pendapatanAcc.code as string, name: pendapatanAcc.name, debit: 0, credit: dpp },
    { no: 3, code: ppnAcc.code as string, name: ppnAcc.name, debit: 0, credit: ppn },
  ];

  const activeStep = stepForStatus(selectedInvoice.status);
  const isPosted = selectedInvoice.status === 'Diposting';

  const handleSelectInvoice = (inv: Invoice) => {
    setSelectedId(inv.id);
    setIsEditingMapping(false);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const goToPage = (p: number) => {
    setCurrentPage(Math.min(Math.max(1, p), totalPages));
  };

  const startEditMapping = () => {
    setDraftMapping(mapping);
    setIsEditingMapping(true);
  };

  const cancelEditMapping = () => {
    setIsEditingMapping(false);
  };

  const saveEditMapping = () => {
    setMappings(prev => ({ ...prev, [selectedInvoice.id]: draftMapping }));
    setIsEditingMapping(false);
  };

  const updateInvoiceStatus = (id: string, status: InvoiceStatus) => {
    setInvoices(prev => prev.map(inv => (inv.id === id ? { ...inv, status } : inv)));
  };

  const handleApprove = () => {
    if (selectedInvoice.status !== 'Diproses') return;
    updateInvoiceStatus(selectedInvoice.id, 'Siap Posting');
  };

  const handlePostJournal = () => {
    if (selectedInvoice.status !== 'Siap Posting') return;
    updateInvoiceStatus(selectedInvoice.id, 'Diposting');
    setIsEditingMapping(false);
  };

  const footerMessage =
    selectedInvoice.status === 'Diposting'
      ? t('Jurnal ini sudah diposting ke buku besar.')
      : selectedInvoice.status === 'Siap Posting'
      ? t('Jurnal ini siap untuk diposting. Silakan periksa kembali hasil klasifikasi akun dan pastikan sudah sesuai sebelum diposting ke buku besar.')
      : t('Jurnal masih diproses. Setujui klasifikasi akun terlebih dahulu sebelum bisa diposting.');

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Invoice List */}
      <div className="w-72 flex-shrink-0 card overflow-hidden self-start">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground mb-2">{t('Daftar Invoice Penjualan')}</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={t('Cari nomor invoice atau pelanggan...')}
              className="w-full text-xs border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card text-foreground"
            />
          </div>
        </div>
        <div className="overflow-y-auto max-h-[600px] scrollbar-thin">
          {pagedInvoices.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">{t('Tidak ada invoice yang cocok.')}</div>
          )}
          {pagedInvoices.map(inv => (
            <div
              key={inv.id}
              onClick={() => handleSelectInvoice(inv)}
              className={`p-3 border-b border-border/50 cursor-pointer transition-colors ${selectedInvoice.id === inv.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-blue-600">INV</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{inv.id}</p>
                    <p className="text-[11px] text-muted-foreground">{inv.customer}</p>
                    <p className="text-[11px] text-muted-foreground">{inv.date}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-foreground">{formatIDR(inv.amount)}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[inv.status]}`}>{t(inv.status)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredInvoices.length === 0
              ? t('0 invoice')
              : `${t('Menampilkan')} ${pageStart + 1} – ${Math.min(pageStart + ITEMS_PER_PAGE, filteredInvoices.length)} ${t('dari')} ${filteredInvoices.length} ${t('invoice')}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage <= 1}
              className="p-0.5 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={12} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={`w-5 h-5 rounded text-[11px] ${p === safePage ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="p-0.5 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">{t('Detail Journal Preview')}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[selectedInvoice.status]}`}>{t(selectedInvoice.status)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('Lihat bagaimana transaksi penjualan diubah menjadi jurnal akuntansi')}</p>

          {/* Steps */}
          <div className="flex items-center gap-0 mt-4 overflow-x-auto scrollbar-thin pb-1">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.n}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${s.n === activeStep ? 'bg-primary border-primary text-primary-foreground' : s.n < activeStep ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-card border-border text-muted-foreground'}`}>
                    {s.n < activeStep ? <CheckCircle size={14} /> : s.n}
                  </div>
                  <div className="text-center">
                    <p className={`text-[10px] font-semibold whitespace-nowrap ${s.n === activeStep ? 'text-primary' : 'text-muted-foreground'}`}>{t(s.label)}</p>
                    <p className="text-[9px] text-muted-foreground whitespace-nowrap">{t(s.sub)}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-1 mt-[-12px]" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* 1. Source Document */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">1</span>
              {t('Source Document')}
            </h4>
            <div className="bg-muted/30 rounded-lg p-3 mb-3 flex items-center gap-3">
              <div className="w-10 h-12 bg-white border border-border rounded flex items-center justify-center text-[9px] text-muted-foreground">PDF</div>
              <div className="text-xs space-y-1">
                {[
                  ['Nama File', `${selectedInvoice.id}.pdf`],
                  ['No. Invoice', selectedInvoice.id],
                  ['Pelanggan', selectedInvoice.customer],
                  ['Tanggal Invoice', selectedInvoice.date],
                  ['Total Invoice', formatIDR(selectedInvoice.amount)],
                  ['Tanggal Upload', '14 Nov 2024, 09:17'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-muted-foreground w-24 flex-shrink-0">{t(k)}</span>
                    <span className="font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowDocPreview(true)}
              className="w-full py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
            >
              <Eye size={12} /> {t('Lihat Dokumen')}
            </button>
          </div>

          {/* 2. AI Extraction */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold flex items-center justify-center">2</span>
              {t('AI Extraction')}
            </h4>
            <div className="space-y-2 text-xs">
              {[
                ['No. Invoice', selectedInvoice.id],
                ['Pelanggan', selectedInvoice.customer],
                ['Tipe Transaksi', <span key="t" className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{t('Penjualan Jasa')}</span>],
                ['Status Pajak', <span key="s" className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">{t('Dikenakan PPN')}</span>],
                ['Total DPP', formatIDR(dpp)],
                ['PPN (11%)', formatIDR(ppn)],
                ['Total Invoice', formatIDR(selectedInvoice.amount)],
                ['Confidence Score', <div key="c" className="flex items-center gap-2"><span className="text-emerald-600 font-bold">98%</span><div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: '98%' }} /></div></div>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">{t(k as string)}</span>
                  <span className="font-medium text-foreground text-right">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Accounting Classification */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold flex items-center justify-center">3</span>
                {t('Accounting Classification')}
              </h4>
              {isEditingMapping && <span className="text-[10px] text-primary font-medium">{t('Mode Edit')}</span>}
            </div>

            {!isEditingMapping ? (
              <div className="space-y-2">
                {[
                  { label: 'Akun Piutang Usaha', code: piutangAcc.code, name: piutangAcc.name },
                  { label: 'Akun Pendapatan', code: pendapatanAcc.code, name: pendapatanAcc.name },
                  { label: 'Akun PPN Keluaran', code: ppnAcc.code, name: ppnAcc.name },
                  { label: 'Akun PPh (Jika ada)', code: pphAcc.code, name: pphAcc.name },
                ].map(a => (
                  <div key={a.label} className="flex items-center justify-between py-1.5 border-b border-border/50">
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t(a.label)}</p>
                      <p className="text-xs font-medium text-foreground">{a.code ? `${a.code} - ${t(a.name)}` : t(a.name)}</p>
                    </div>
                    <Arrow size={12} className="text-muted-foreground flex-shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {[
                  { label: 'Akun Piutang Usaha', options: PIUTANG_ACCOUNTS, value: draftMapping.piutang, key: 'piutang' as const },
                  { label: 'Akun Pendapatan', options: PENDAPATAN_ACCOUNTS, value: draftMapping.pendapatan, key: 'pendapatan' as const },
                  { label: 'Akun PPN Keluaran', options: PPN_ACCOUNTS, value: draftMapping.ppn, key: 'ppn' as const },
                  { label: 'Akun PPh (Jika ada)', options: PPH_ACCOUNTS, value: draftMapping.pph, key: 'pph' as const },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-[11px] text-muted-foreground block mb-1">{t(f.label)}</label>
                    <select
                      value={f.value ?? ''}
                      onChange={e => setDraftMapping(prev => ({ ...prev, [f.key]: e.target.value || null }))}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
                    >
                      {f.options.map(opt => (
                        <option key={String(opt.code)} value={opt.code ?? ''}>
                          {opt.code ? `${opt.code} - ${t(opt.name)}` : t(opt.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={saveEditMapping}
                    className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    {t('Simpan')}
                  </button>
                  <button
                    onClick={cancelEditMapping}
                    className="flex-1 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors"
                  >
                    {t('Batal')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* 4. Tax Treatment */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold flex items-center justify-center">4</span>
              {t('Tax Treatment')}
            </h4>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-3 flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-700">{t('Dikenakan PPN (Taxable)')}</p>
                <p className="text-[11px] text-emerald-600">{t('Transaksi ini dikenakan PPN sesuai ketentuan yang berlaku.')}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {[
                ['Dasar Pengenaan Pajak (DPP)', formatIDR(dpp)],
                ['Tarif PPN', '11%'],
                ['PPN Keluaran', formatIDR(ppn)],
                ['Total Termasuk PPN', formatIDR(selectedInvoice.amount)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{t(k)}</span>
                  <span className="font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Journal Entry */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">5</span>
              {t('Journal Entry')}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('No.')}</th>
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Account Code')}</th>
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Account Name')}</th>
                    <th className="text-right py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Debit (IDR)')}</th>
                    <th className="text-right py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Credit (IDR)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {journalLines.map(l => (
                    <tr key={l.no} className="border-b border-border/50">
                      <td className="py-1.5 px-2 text-muted-foreground">{l.no}</td>
                      <td className="py-1.5 px-2 text-primary font-medium">{l.code}</td>
                      <td className="py-1.5 px-2 text-foreground">{t(l.name)}</td>
                      <td className="py-1.5 px-2 text-right">{l.debit > 0 ? l.debit.toLocaleString('id-ID') : '—'}</td>
                      <td className="py-1.5 px-2 text-right">{l.credit > 0 ? l.credit.toLocaleString('id-ID') : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={3} className="py-1.5 px-2 text-xs">{t('Total')}</td>
                    <td className="py-1.5 px-2 text-right text-xs">{selectedInvoice.amount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2 text-right text-xs">{selectedInvoice.amount.toLocaleString('id-ID')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="card p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <span className="w-4 h-4 bg-blue-100 rounded-full flex items-center justify-center text-[9px]">ℹ</span>
            <span>{footerMessage}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={startEditMapping}
              disabled={isPosted || isEditingMapping}
              className="px-3 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✏ {t('Edit Mapping')}
            </button>
            <button
              onClick={handleApprove}
              disabled={selectedInvoice.status !== 'Diproses'}
              className="px-3 py-1.5 border border-emerald-500 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <CheckCircle size={12} /> {t('Approve')}
            </button>
            <button
              onClick={handlePostJournal}
              disabled={selectedInvoice.status !== 'Siap Posting'}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
              📋 {t('Post Journal')}
            </button>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {showDocPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDocPreview(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{selectedInvoice.id}.pdf</h3>
              <button onClick={() => setShowDocPreview(false)} className="p-1 hover:bg-muted rounded">
                <X size={16} />
              </button>
            </div>
            <div className="bg-muted/30 rounded-lg h-64 flex items-center justify-center text-xs text-muted-foreground border border-border">
              {t('Pratinjau dokumen belum tersedia untuk data contoh ini.')}
            </div>
            <div className="text-xs space-y-1 mt-3">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Pelanggan')}</span><span className="font-medium text-foreground">{selectedInvoice.customer}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Tanggal')}</span><span className="font-medium text-foreground">{selectedInvoice.date}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Total')}</span><span className="font-medium text-foreground">{formatIDR(selectedInvoice.amount)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}