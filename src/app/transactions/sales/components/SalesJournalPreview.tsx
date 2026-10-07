'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, CheckCircle, X, Eye } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import {
  useSalesInvoices, updateSalesInvoice, upsertSalesAccountMapping,
  ensureSalesAccountMapping, createSalesActivityLog,
  type BackendSalesInvoice, type BackendSalesAccountMapping,
} from '@/lib/salesStore';
import { useClientCoa, type CoaAccount } from '@/lib/coaStore';
import { useActiveClient } from '@/lib/activeClient';
import { PreviewSection, FieldList, JournalTable, PickerPagination, PREVIEW_CARD } from '@/app/transactions/components/PreviewLayout';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type UiStatus = 'Diproses' | 'Siap Posting' | 'Diposting';

function keUiStatus(posting_status: string): UiStatus {
  if (posting_status === 'Posted' || posting_status === 'Partial' || posting_status === 'Paid') return 'Diposting';
  if (posting_status === 'Approved') return 'Siap Posting';
  return 'Diproses';
}

function formatTanggal(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return '-';
  }
}

const STATUS_BADGE: Record<UiStatus, string> = {
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

const stepForStatus = (status: UiStatus) => {
  if (status === 'Diposting') return 6;
  if (status === 'Siap Posting') return 5;
  return 4;
};

// Opsi akun jurnal diambil dari master COA klien pemilik invoice (Management >
// Chart of Accounts). Daftar di bawah HANYA fallback untuk klien yang belum
// punya COA -- sama dengan db_client._AKUN_DEFAULT_SALES di backend.
const FALLBACK_PIUTANG = [
  { code: '1120-01', name: 'Piutang Usaha - IDR' },
  { code: '1120-02', name: 'Piutang Usaha - USD' },
  { code: '1121-01', name: 'Piutang Lain-lain' },
];
const FALLBACK_PENDAPATAN = [
  { code: '4100-01', name: 'Pendapatan Jasa Konsultasi' },
  { code: '4100-02', name: 'Pendapatan Jasa Implementasi' },
  { code: '4200-01', name: 'Pendapatan Lain-lain' },
];
const FALLBACK_PPN = [
  { code: '2100-01', name: 'PPN Keluaran' },
  { code: '2100-02', name: 'PPN Keluaran - Dipungut Pihak Lain' },
];
const FALLBACK_PPH = [
  { code: '1170-01', name: 'PPh Pasal 23 Dibayar Dimuka' },
  { code: '1170-02', name: 'PPh Pasal 4(2) Dibayar Dimuka' },
];

interface Acc { code: string | null; name: string }
const NO_PPH: Acc = { code: null, name: 'Tidak ada potongan PPh' };

interface Mapping {
  piutang: Acc;
  pendapatan: Acc;
  ppn: Acc;
  pph: Acc;
}

interface AccountOptions { piutang: Acc[]; pendapatan: Acc[]; ppn: Acc[]; pph: Acc[] }

function opsiAkunDariCoa(coa: CoaAccount[]): AccountOptions {
  if (coa.length === 0) {
    return { piutang: FALLBACK_PIUTANG, pendapatan: FALLBACK_PENDAPATAN, ppn: FALLBACK_PPN, pph: [NO_PPH, ...FALLBACK_PPH] };
  }
  const pilih = (f: (a: CoaAccount) => boolean): Acc[] => coa.filter(f).map(a => ({ code: a.acc_no, name: a.account_name }));
  // Kalau sub-akun spesifik kosong di COA klien, tawarkan seluruh klasifikasinya.
  const atauKelas = (list: Acc[], kelas: string[]) => (list.length ? list : pilih(a => kelas.includes(a.account_classification)));
  return {
    piutang: atauKelas(pilih(a => ['TRADE RECEIVABLES', 'OTHER RECEIVABLES', 'RELATED PARTY RECEIVABLES'].includes(a.account_sub ?? '')), ['ASSET']),
    pendapatan: atauKelas(pilih(a => ['REVENUE', 'OTHER INCOME'].includes(a.account_classification)), ['REVENUE']),
    ppn: atauKelas(pilih(a => a.account_sub === 'TAX PAYABLES'), ['LIABILITY']),
    pph: [NO_PPH, ...atauKelas(pilih(a => a.account_sub === 'INCOME TAX RECEIVABLE'), ['ASSET'])],
  };
}

function mappingDariBackend(m: BackendSalesAccountMapping, opsi: AccountOptions): Mapping {
  return {
    piutang: { code: m.piutang_account_code, name: m.piutang_account_name || '' },
    pendapatan: { code: m.pendapatan_account_code, name: m.pendapatan_account_name || '' },
    ppn: m.ppn_account_code ? { code: m.ppn_account_code, name: m.ppn_account_name || '' } : opsi.ppn[0] ?? { code: null, name: '-' },
    pph: m.pph_account_code ? { code: m.pph_account_code, name: m.pph_account_name || '' } : NO_PPH,
  };
}

/** Usulan kalau invoice belum punya mapping & klien belum punya akun default. */
function mappingUsulan(opsi: AccountOptions): Mapping {
  const kosong: Acc = { code: null, name: '-' };
  return { piutang: opsi.piutang[0] ?? kosong, pendapatan: opsi.pendapatan[0] ?? kosong, ppn: opsi.ppn[0] ?? kosong, pph: NO_PPH };
}

/** Pastikan akun yang sedang terpasang ikut muncul di dropdown walau di luar filter. */
const denganAkunAktif = (list: Acc[], aktif: Acc) =>
  aktif.code === null || list.some(a => a.code === aktif.code) ? list : [aktif, ...list];

const ITEMS_PER_PAGE = 5;

export default function SalesJournalPreview() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { activeClientId } = useActiveClient();

  // Journal Preview cuma menampilkan invoice yang BELUM final "Paid"
  // (masih dalam proses klasifikasi/posting) -- invoice yang sudah lunas
  // penuh ada di tab Posted.
  const { invoices: backendInvoices, loading, refresh } = useSalesInvoices(activeClientId ?? null);
  const invoices = useMemo(() => backendInvoices.filter(i => i.posting_status !== 'Paid'), [backendInvoices]);

  // Mapping tersimpan per invoice; null = sudah dicek, belum ada mapping.
  const [mappings, setMappings] = useState<Record<string, BackendSalesAccountMapping | null>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [showDocPreview, setShowDocPreview] = useState(false);
  const [isEditingMapping, setIsEditingMapping] = useState(false);
  const [draftMapping, setDraftMapping] = useState<Mapping>(() => mappingUsulan(opsiAkunDariCoa([])));
  const [savingMapping, setSavingMapping] = useState(false);

  useEffect(() => {
    if (!selectedId && invoices.length > 0) setSelectedId(invoices[0].id);
  }, [invoices, selectedId]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(inv => inv.invoice_no.toLowerCase().includes(q) || inv.customer_name.toLowerCase().includes(q));
  }, [invoices, search]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedInvoices = filteredInvoices.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  const selectedInvoice: BackendSalesInvoice | null = invoices.find(inv => inv.id === selectedId) ?? invoices[0] ?? null;

  // COA klien pemilik invoice -> opsi dropdown akun.
  const { accounts: coaKlien } = useClientCoa(selectedInvoice?.management_client_id ?? null, { activeOnly: true });
  const opsiAkun = useMemo(() => opsiAkunDariCoa(coaKlien), [coaKlien]);

  // Muat mapping akun invoice terpilih; kalau belum ada, backend membuatnya dari
  // akun default klien (lihat db_client.pastikan_mapping_sales).
  useEffect(() => {
    if (!selectedInvoice || selectedInvoice.id in mappings) return;
    const invoiceId = selectedInvoice.id;
    ensureSalesAccountMapping(invoiceId)
      .then(m => setMappings(prev => ({ ...prev, [invoiceId]: m })))
      .catch(() => setMappings(prev => ({ ...prev, [invoiceId]: null })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice?.id]);

  if (!selectedInvoice) {
    return (
      <div className={`${PREVIEW_CARD} p-8 text-center text-xs text-muted-foreground`}>
        {loading ? t('Memuat...') : t('Belum ada invoice penjualan untuk diproses ke jurnal.')}
      </div>
    );
  }

  const uiStatus = keUiStatus(selectedInvoice.posting_status);
  const mappingTersimpan = mappings[selectedInvoice.id] ?? null;
  const mapping = mappingTersimpan ? mappingDariBackend(mappingTersimpan, opsiAkun) : mappingUsulan(opsiAkun);

  const dpp = selectedInvoice.dpp || Math.round(selectedInvoice.gross_amount / 1.11);
  const ppn = selectedInvoice.ppn || (selectedInvoice.gross_amount - dpp);

  const { piutang: piutangAcc, pendapatan: pendapatanAcc, ppn: ppnAcc, pph: pphAcc } = mapping;

  const journalLines = [
    { no: 1, code: piutangAcc.code as string, name: piutangAcc.name, debit: selectedInvoice.gross_amount, credit: 0 },
    { no: 2, code: pendapatanAcc.code as string, name: pendapatanAcc.name, debit: 0, credit: dpp },
    { no: 3, code: ppnAcc.code as string, name: ppnAcc.name, debit: 0, credit: ppn },
  ];

  const activeStep = stepForStatus(uiStatus);
  const isPosted = uiStatus === 'Diposting';

  const handleSelectInvoice = (inv: BackendSalesInvoice) => {
    setSelectedId(inv.id);
    setIsEditingMapping(false);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const startEditMapping = () => {
    setDraftMapping(mapping);
    setIsEditingMapping(true);
  };

  const cancelEditMapping = () => setIsEditingMapping(false);

  const simpanMapping = (m: Mapping) =>
    upsertSalesAccountMapping(selectedInvoice.id, clientId, {
      piutang_account_code: m.piutang.code as string,
      piutang_account_name: m.piutang.name,
      pendapatan_account_code: m.pendapatan.code as string,
      pendapatan_account_name: m.pendapatan.name,
      ppn_account_code: m.ppn.code,
      ppn_account_name: m.ppn.code ? m.ppn.name : null,
      pph_account_code: m.pph.code,
      pph_account_name: m.pph.code ? m.pph.name : null,
      is_ai_suggested: false,
      mapped_by: clientId ?? undefined,
    });

  const saveEditMapping = async () => {
    setSavingMapping(true);
    try {
      const tersimpan = await simpanMapping(draftMapping);
      setMappings(prev => ({ ...prev, [selectedInvoice.id]: tersimpan }));
      setIsEditingMapping(false);
      toast.success(t('Mapping akun disimpan'), { description: selectedInvoice.invoice_no });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyimpan mapping'));
    } finally {
      setSavingMapping(false);
    }
  };

  const handleApprove = async () => {
    if (uiStatus !== 'Diproses') return;
    try {
      // Klien tanpa akun default: simpan usulan yang sedang tampil supaya
      // jurnal yang disetujui == jurnal yang dilihat user.
      if (!mappingTersimpan) {
        const tersimpan = await simpanMapping(mapping);
        setMappings(prev => ({ ...prev, [selectedInvoice.id]: tersimpan }));
      }
      await updateSalesInvoice(selectedInvoice.id, { posting_status: 'Approved' });
      toast.success(t('Klasifikasi akun disetujui'), { description: selectedInvoice.invoice_no });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal menyetujui'));
    }
  };

  const handlePostJournal = async () => {
    if (uiStatus !== 'Siap Posting') return;
    try {
      await updateSalesInvoice(selectedInvoice.id, {
        posting_status: 'Posted',
        // Invoice Posted langsung terbaca GL/Financial Statements (ambil_baris_jurnal_posted_transaksi).
        journal_sync_status: 'Synced',
        posted_at: new Date().toISOString(),
        posted_by: clientId ?? undefined,
      });
      await createSalesActivityLog({
        client_id: clientId ?? undefined,
        invoice_id: selectedInvoice.id,
        event_type: 'JOURNAL_SYNC',
        description: 'Jurnal berhasil disinkronkan ke General Ledger',
        reference_no: selectedInvoice.invoice_no,
        performed_by: user?.nama || user?.username || 'System',
      }).catch(() => {});
      setIsEditingMapping(false);
      toast.success(t('Jurnal berhasil diposting'), { description: selectedInvoice.invoice_no });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Gagal memposting jurnal'));
    }
  };

  const footerMessage =
    uiStatus === 'Diposting'
      ? t('Jurnal ini sudah diposting ke buku besar.')
      : uiStatus === 'Siap Posting'
      ? t('Jurnal ini siap untuk diposting. Silakan periksa kembali hasil klasifikasi akun dan pastikan sudah sesuai sebelum diposting ke buku besar.')
      : t('Jurnal masih diproses. Setujui klasifikasi akun terlebih dahulu sebelum bisa diposting.');

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Invoice List */}
      <div className={`w-72 flex-shrink-0 ${PREVIEW_CARD} overflow-hidden self-start`}>
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
            <div className="p-4 text-center text-xs text-muted-foreground">{loading ? t('Memuat...') : t('Tidak ada invoice yang cocok.')}</div>
          )}
          {pagedInvoices.map(inv => {
            const s = keUiStatus(inv.posting_status);
            return (
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
                      <p className="text-xs font-semibold text-foreground">{inv.invoice_no}</p>
                      <p className="text-[11px] text-muted-foreground">{inv.customer_name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatTanggal(inv.invoice_date)}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-semibold text-foreground">{formatIDR(inv.gross_amount)}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[s]}`}>{t(s)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <PickerPagination
          page={safePage}
          totalPages={totalPages}
          total={filteredInvoices.length}
          itemLabel="invoices"
          onPageChange={goToPage}
          className="p-3"
        />
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className={`${PREVIEW_CARD} p-4`}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">{t('Detail Journal Preview')}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[uiStatus]}`}>{t(uiStatus)}</span>
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

        {/* Bagian-bagian ditumpuk dari atas ke bawah: 1 → 5 */}
        {/* 1. Source Document */}
        <PreviewSection
          step={1}
          stepColor="blue"
          title={t('Source Document')}
          aside={
            <button
              onClick={() => setShowDocPreview(true)}
              className="px-2.5 py-1 border border-border rounded-lg text-xs text-muted-foreground bg-card hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <Eye size={12} /> {t('Lihat Dokumen')}
            </button>
          }
        >
          <FieldList rows={[
            { label: t('No. Invoice'), value: selectedInvoice.invoice_no },
            { label: t('Pelanggan'), value: selectedInvoice.customer_name },
            { label: t('Tanggal Invoice'), value: formatTanggal(selectedInvoice.invoice_date) },
            { label: t('Total Invoice'), value: formatIDR(selectedInvoice.gross_amount) },
          ]} />
        </PreviewSection>

        {/* 2. AI Extraction */}
        <PreviewSection step={2} stepColor="purple" title={t('AI Extraction')}>
          <FieldList rows={[
            { label: t('Tipe Transaksi'), value: <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{t(selectedInvoice.transaction_type || 'Penjualan Jasa')}</span> },
            { label: t('Status Pajak'), value: <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">{t(selectedInvoice.tax_invoice_status)}</span> },
            { label: t('Total DPP'), value: formatIDR(dpp) },
            { label: t('PPN (11%)'), value: formatIDR(ppn) },
            { label: t('Total Invoice'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
          ]} />
        </PreviewSection>

        {/* 3. Accounting Classification */}
        <PreviewSection
          step={3}
          stepColor="emerald"
          title={t('Accounting Classification')}
          aside={isEditingMapping && <span className="text-[11px] text-primary font-medium">{t('Mode Edit')}</span>}
        >
          {!isEditingMapping ? (
            <FieldList rows={[
              { label: t('Akun Piutang Usaha'), acc: piutangAcc },
              { label: t('Akun Pendapatan'), acc: pendapatanAcc },
              { label: t('Akun PPN Keluaran'), acc: ppnAcc },
              { label: t('Akun PPh (Jika ada)'), acc: pphAcc },
            ].map(r => ({
              label: r.label,
              value: r.acc.code
                ? <><span className="font-mono text-primary">{r.acc.code}</span> — {t(r.acc.name)}</>
                : t(r.acc.name),
            }))} />
          ) : (
            <div className="space-y-3 max-w-xl">
              {([
                { label: 'Akun Piutang Usaha', key: 'piutang' },
                { label: 'Akun Pendapatan', key: 'pendapatan' },
                { label: 'Akun PPN Keluaran', key: 'ppn' },
                { label: 'Akun PPh (Jika ada)', key: 'pph' },
              ] as const).map(({ label, key }) => ({
                label, key, value: draftMapping[key].code, options: denganAkunAktif(opsiAkun[key], draftMapping[key]),
              })).map(f => (
                <div key={f.label}>
                  <label className="text-[11px] text-muted-foreground block mb-1">{t(f.label)}</label>
                  <select
                    value={f.value ?? ''}
                    onChange={e => {
                      const dipilih = f.options.find(o => (o.code ?? '') === e.target.value) ?? NO_PPH;
                      setDraftMapping(prev => ({ ...prev, [f.key]: dipilih }));
                    }}
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
                  disabled={savingMapping}
                  className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {savingMapping ? t('Menyimpan...') : t('Simpan')}
                </button>
                <button
                  onClick={cancelEditMapping}
                  className="px-4 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors"
                >
                  {t('Batal')}
                </button>
              </div>
            </div>
          )}
        </PreviewSection>

        {/* 4. Tax Treatment */}
        <PreviewSection step={4} stepColor="amber" title={t('Tax Treatment')}>
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-4 flex items-start gap-2">
            <CheckCircle size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-emerald-700">{t('Dikenakan PPN (Taxable)')}</p>
              <p className="text-[11px] text-emerald-600">{t('Transaksi ini dikenakan PPN sesuai ketentuan yang berlaku.')}</p>
            </div>
          </div>
          <FieldList rows={[
            { label: t('Dasar Pengenaan Pajak (DPP)'), value: formatIDR(dpp) },
            { label: t('Tarif PPN'), value: '11%' },
            { label: t('PPN Keluaran'), value: formatIDR(ppn) },
            { label: t('Total Termasuk PPN'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
          ]} />
        </PreviewSection>

        {/* 5. Journal Entry */}
        <PreviewSection step={5} stepColor="blue" title={t('Journal Entry')} flush>
          <JournalTable
            lines={journalLines.map(l => ({ key: l.no, code: l.code, name: t(l.name), debit: l.debit, credit: l.credit }))}
            totalDebit={journalLines.reduce((s, l) => s + l.debit, 0)}
            totalCredit={journalLines.reduce((s, l) => s + l.credit, 0)}
            formatAmount={n => n.toLocaleString('id-ID')}
            labels={{ no: t('No.'), code: t('Account Code'), name: t('Account Name'), debit: t('Debit (IDR)'), credit: t('Credit (IDR)'), total: t('Total') }}
          />
        </PreviewSection>

        {/* Footer Action Bar */}
        <div className={`${PREVIEW_CARD} p-3 flex items-center justify-between gap-3 flex-wrap`}>
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
              disabled={uiStatus !== 'Diproses'}
              className="px-3 py-1.5 border border-emerald-500 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <CheckCircle size={12} /> {t('Approve')}
            </button>
            <button
              onClick={handlePostJournal}
              disabled={uiStatus !== 'Siap Posting'}
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
              <h3 className="text-sm font-semibold text-foreground">{selectedInvoice.invoice_no}</h3>
              <button onClick={() => setShowDocPreview(false)} className="p-1 hover:bg-muted rounded">
                <X size={16} />
              </button>
            </div>
            <div className="bg-muted/30 rounded-lg h-64 flex items-center justify-center text-xs text-muted-foreground border border-border">
              {t('Pratinjau dokumen sumber belum tersedia (belum ada file yang tertaut ke invoice ini).')}
            </div>
            <div className="text-xs space-y-1 mt-3">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Pelanggan')}</span><span className="font-medium text-foreground">{selectedInvoice.customer_name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Tanggal')}</span><span className="font-medium text-foreground">{formatTanggal(selectedInvoice.invoice_date)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Total')}</span><span className="font-medium text-foreground">{formatIDR(selectedInvoice.gross_amount)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
