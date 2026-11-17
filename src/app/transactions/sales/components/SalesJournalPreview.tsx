'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Search, CheckCircle, Check, X, Eye, Pencil, Info, FileText, Clock, ShieldCheck, BookOpen,
  Sparkles, Landmark, Scale, Inbox, Send, FileSpreadsheet,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import {
  useSalesInvoices, updateSalesInvoice, upsertSalesAccountMapping,
  ensureSalesAccountMapping, createSalesActivityLog,
  type BackendSalesInvoice, type BackendSalesAccountMapping,
} from '@/lib/salesStore';
import { useClientCoa, type CoaAccount } from '@/lib/coaStore';
import { useActiveClient } from '@/lib/activeClient';
import SalesLoading from './SalesLoading';
import { salesFont } from './salesFont';
import { PickerPagination } from '@/app/transactions/components/PreviewLayout';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

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

// Warna status disamakan dengan pill bergaris di Sales Transaction (Review / Approved / Posted).
const STATUS_BADGE: Record<UiStatus, string> = {
  'Diproses': 'bg-amber-100 text-amber-900 border-amber-300',
  'Siap Posting': 'bg-blue-100 text-blue-800 border-blue-300',
  'Diposting': 'bg-teal-100 text-teal-800 border-teal-300',
};
const STATUS_DOT: Record<UiStatus, string> = {
  'Diproses': 'bg-amber-600',
  'Siap Posting': 'bg-blue-600',
  'Diposting': 'bg-teal-600',
};

// Gaya kontrol -- sama dengan filter/tombol di tab Source Data, Sales Transaction & Posted.
const BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY = `${BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const BTN_PRIMARY = `${BTN_BASE} border border-neutral-800 bg-neutral-800 text-white hover:bg-neutral-700`;
const CONTROL = 'w-full text-xs border border-neutral-300 rounded-[6px] px-2.5 py-1.5 bg-white text-neutral-900 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300';

const iconBadge = (node: React.ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200">{node}</span>
);

function StatusPill({ status, label }: { status: UiStatus; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {label}
    </span>
  );
}

// Panel putih dengan header terpisah garis -- sama dengan PostedPanel / SourcePanel.
function JPanel({ title, subtitle, leading, action, children, className = '', flush }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-neutral-900">{title}</h3>
            {subtitle && <p className="truncate text-xs font-medium text-neutral-700">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children !== undefined && children !== null && children !== false && (
        <div className={`flex flex-1 flex-col ${flush ? '' : 'p-4'}`}>{children}</div>
      )}
    </section>
  );
}

// Kartu KPI -- desain sama dengan SalesKpiTile di Sales Transaction (garis aksen hitam tipis,
// ikon kecil, angka semibold, bar netral).
function JournalKpiTile({ label, value, pct, pctLabel, icon: Icon }: {
  label: string; value: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-700" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-50">
          <Icon size={16} className="text-neutral-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-neutral-700">{p}% {pctLabel}</p>
    </div>
  );
}

type SectionState = 'done' | 'active' | 'todo';

// Kartu langkah (1-5): badge nomor mengikuti progres stepper di atas (selesai = centang, aktif = hijau penuh).
function StepCard({ step, state, icon: Icon, title, aside, flush, children }: {
  step: number;
  state: SectionState;
  icon: React.ElementType;
  title: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  const badge =
    state === 'done' ? 'bg-neutral-100 text-neutral-700'
    : state === 'active' ? 'bg-white text-neutral-900 ring-1 ring-neutral-400'
    : 'bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200';
  return (
    <section className={`flex h-full flex-col overflow-hidden rounded-[10px] border bg-white transition-colors ${state === 'active' ? 'border-neutral-400' : 'border-neutral-200'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${badge}`}>
            {state === 'done' ? <Check size={14} strokeWidth={2.5} /> : step}
          </span>
          <h4 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-neutral-900">
            <Icon size={15} className="shrink-0 text-neutral-700" />
            <span className="truncate">{title}</span>
          </h4>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className={`flex-1 ${flush ? '' : 'p-4'}`}>{children}</div>
    </section>
  );
}

interface RowSpec { label: React.ReactNode; value: React.ReactNode; strong?: boolean }

// Daftar label : nilai (label kiri, nilai rata kanan) -- sama dengan baris ringkasan di panel detail Posted.
function Rows({ rows }: { rows: RowSpec[] }) {
  return (
    <dl className="divide-y divide-neutral-200 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="font-medium text-neutral-700">{r.label}</dt>
          <dd className={`min-w-0 break-words text-right tabular-nums ${r.strong ? 'text-sm font-bold text-neutral-900' : 'font-semibold text-neutral-900'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TAG = 'inline-flex rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-800';

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
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
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
  const [statusFilter, setStatusFilter] = useState<'all' | UiStatus>('all');
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
    return invoices.filter(inv => {
      if (statusFilter !== 'all' && keUiStatus(inv.posting_status) !== statusFilter) return false;
      if (!q) return true;
      return inv.invoice_no.toLowerCase().includes(q) || inv.customer_name.toLowerCase().includes(q);
    });
  }, [invoices, search, statusFilter]);

  // Ringkasan antrian untuk kartu KPI di atas (dihitung dari invoice yang belum final "Paid").
  const stats = useMemo(() => {
    const hitung = (u: UiStatus) => invoices.filter(i => keUiStatus(i.posting_status) === u);
    const jumlah = (list: BackendSalesInvoice[]) => list.reduce((n, i) => n + i.gross_amount, 0);
    const diproses = hitung('Diproses');
    const siap = hitung('Siap Posting');
    const diposting = hitung('Diposting');
    return {
      total: invoices.length,
      diproses: diproses.length,
      siap: siap.length,
      diposting: diposting.length,
      nilaiAntrian: jumlah(diproses) + jumlah(siap),
      nilaiTotal: jumlah(invoices),
    };
  }, [invoices]);
  const persen = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

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
      <SalesLoading
        loading={loading}
        emptyIcon={Inbox}
        message={loading ? t('Memuat...') : t('Belum ada invoice penjualan untuk diproses ke jurnal.')}
      />
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


  const totalDebit = journalLines.reduce((n, l) => n + l.debit, 0);
  const totalCredit = journalLines.reduce((n, l) => n + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const isTaxable = ppn !== 0;
  const formatAngka = (n: number) => n.toLocaleString('id-ID');

  // Status tiap bagian mengikuti progres stepper.
  const stateOf = (n: number): SectionState => (isPosted || n < activeStep ? 'done' : n === activeStep ? 'active' : 'todo');

  const statusTabs: { key: 'all' | UiStatus; label: string; count: number }[] = [
    { key: 'all', label: 'Semua', count: stats.total },
    { key: 'Diproses', label: 'Diproses', count: stats.diproses },
    { key: 'Siap Posting', label: 'Siap Posting', count: stats.siap },
    { key: 'Diposting', label: 'Diposting', count: stats.diposting },
  ];

  // Notifikasi: kotak netral tipis, hanya ikon yang diberi warna status.
  const footerTone = 'border-neutral-200 bg-neutral-50 text-neutral-800';
  const footerIconTone =
    uiStatus === 'Diposting' ? 'text-teal-700' : uiStatus === 'Siap Posting' ? 'text-blue-700' : 'text-amber-700';
  const FooterIcon = uiStatus === 'Diposting' ? ShieldCheck : uiStatus === 'Siap Posting' ? Info : Clock;

  return (
    <div className={`${salesFont.className} space-y-5`}>
      {/* KPI -- desain sama dengan Sales Transaction */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <JournalKpiTile label={t('Antrian Jurnal')} value={String(stats.total)} pct={100} pctLabel={t('invoice belum final')} icon={FileText} />
        <JournalKpiTile label={t('Menunggu Approval')} value={String(stats.diproses)} pct={persen(stats.diproses, stats.total)} pctLabel={t('dari antrian')} icon={Clock} />
        <JournalKpiTile label={t('Siap Posting')} value={String(stats.siap)} pct={persen(stats.siap, stats.total)} pctLabel={t('dari antrian')} icon={ShieldCheck} />
        <JournalKpiTile label={t('Nilai Belum Diposting')} value={formatIDR(stats.nilaiAntrian)} pct={persen(stats.nilaiAntrian, stats.nilaiTotal)} pctLabel={t('dari total nilai antrian')} icon={BookOpen} />
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        {/* Kiri: daftar invoice */}
        <JPanel
          className="w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-80"
          title={t('Daftar Invoice Penjualan')}
          leading={iconBadge(<FileSpreadsheet size={17} />)}
          flush
        >
          <div className="space-y-2.5 border-b border-neutral-200 p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder={t('Cari nomor invoice atau pelanggan...')}
                className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusTabs.map(tab => {
                const on = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setStatusFilter(tab.key); setCurrentPage(1); }}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'border-neutral-300 bg-neutral-200 text-neutral-900' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'}`}
                  >
                    {t(tab.label)} <span className="text-neutral-600">{tab.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="scrollbar-thin max-h-[560px] space-y-2 overflow-y-auto p-3">
            {pagedInvoices.length === 0 && (
              <div className="py-8 text-center text-xs text-neutral-600">{loading ? t('Memuat...') : t('Tidak ada invoice yang cocok.')}</div>
            )}
            {pagedInvoices.map(inv => {
              const s = keUiStatus(inv.posting_status);
              const aktif = selectedInvoice.id === inv.id;
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => handleSelectInvoice(inv)}
                  aria-current={aktif ? 'true' : undefined}
                  className={`group flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${aktif ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50'}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${aktif ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-600'}`}>INV</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold leading-snug text-blue-700">{inv.invoice_no}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-neutral-800">{inv.customer_name}</span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-neutral-700">{formatTanggal(inv.invoice_date)}</span>
                      <StatusPill status={s} label={t(s)} />
                    </span>
                    <span className="mt-1 block text-sm font-semibold tabular-nums text-neutral-900">{formatIDR(inv.gross_amount)}</span>
                  </span>
                </button>
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
        </JPanel>

        {/* Kanan: detail */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Header: ringkasan invoice + stepper */}
          <JPanel
            title={t('Detail Journal Preview')}
            subtitle={t('Lihat bagaimana transaksi penjualan diubah menjadi jurnal akuntansi')}
            leading={iconBadge(<Eye size={17} />)}
            action={<StatusPill status={uiStatus} label={t(uiStatus)} />}
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200">INV</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-blue-700">{selectedInvoice.invoice_no}</p>
                  <p className="truncate text-xs font-semibold text-neutral-700">{selectedInvoice.customer_name} · {formatTanggal(selectedInvoice.invoice_date)}</p>
                </div>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-600">{t('Total Invoice')}</p>
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{formatIDR(selectedInvoice.gross_amount)}</p>
              </div>
            </div>

            {/* Stepper */}
            <ol className="mt-5 grid grid-cols-6">
              {STEPS.map((s, i) => {
                const done = isPosted || s.n < activeStep;
                const active = !isPosted && s.n === activeStep;
                return (
                  <li key={s.n} className="relative flex flex-col items-center px-1 text-center">
                    {i > 0 && (
                      <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 rounded-full ${s.n <= activeStep || isPosted ? 'bg-neutral-300' : 'bg-neutral-200'}`} />
                    )}
                    <span
                      className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                        done ? 'border-neutral-300 bg-neutral-100 text-neutral-700'
                        : active ? 'border-neutral-500 bg-white text-neutral-900'
                        : 'border-neutral-200 bg-white text-neutral-500'
                      }`}
                    >
                      {done ? <Check size={14} strokeWidth={2.5} /> : s.n}
                    </span>
                    <p className={`mt-2 text-[11px] font-semibold leading-tight ${done || active ? 'text-neutral-900' : 'text-neutral-600'}`}>{t(s.label)}</p>
                    <p className="hidden text-[10px] font-medium leading-tight text-neutral-600 sm:block">{t(s.sub)}</p>
                  </li>
                );
              })}
            </ol>
          </JPanel>

          {/* 1 & 2 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <StepCard
              step={1}
              state={stateOf(1)}
              icon={FileText}
              title={t('Source Document')}
              aside={
                <button onClick={() => setShowDocPreview(true)} className={`${BTN_SECONDARY} !px-2.5 !py-1`}>
                  <Eye size={12} /> {t('Lihat Dokumen')}
                </button>
              }
            >
              <Rows rows={[
                { label: t('No. Invoice'), value: selectedInvoice.invoice_no },
                { label: t('Pelanggan'), value: selectedInvoice.customer_name },
                { label: t('Tanggal Invoice'), value: formatTanggal(selectedInvoice.invoice_date) },
                { label: t('Total Invoice'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
              ]} />
            </StepCard>

            <StepCard step={2} state={stateOf(2)} icon={Sparkles} title={t('AI Extraction')}>
              <Rows rows={[
                { label: t('Tipe Transaksi'), value: <span className={TAG}>{t(selectedInvoice.transaction_type || 'Penjualan Jasa')}</span> },
                { label: t('Status Pajak'), value: <span className={TAG}>{t(selectedInvoice.tax_invoice_status)}</span> },
                { label: t('Total DPP'), value: formatIDR(dpp) },
                { label: t('PPN (11%)'), value: formatIDR(ppn) },
                { label: t('Total Invoice'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
              ]} />
            </StepCard>
          </div>

          {/* 3 & 4 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <StepCard
              step={3}
              state={stateOf(3)}
              icon={Landmark}
              title={t('Accounting Classification')}
              aside={isEditingMapping && <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">{t('Mode Edit')}</span>}
            >
              {!isEditingMapping ? (
                <Rows rows={[
                  { label: t('Akun Piutang Usaha'), acc: piutangAcc },
                  { label: t('Akun Pendapatan'), acc: pendapatanAcc },
                  { label: t('Akun PPN Keluaran'), acc: ppnAcc },
                  { label: t('Akun PPh (Jika ada)'), acc: pphAcc },
                ].map(r => ({
                  label: r.label,
                  value: r.acc.code
                    ? <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5"><span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-neutral-900">{kodeAkun(r.acc.code)}</span><span>{t(r.acc.name)}</span></span>
                    : <span className="font-medium text-neutral-600">{t(r.acc.name)}</span>,
                }))} />
              ) : (
                <div className="space-y-3">
                  {([
                    { label: 'Akun Piutang Usaha', key: 'piutang' },
                    { label: 'Akun Pendapatan', key: 'pendapatan' },
                    { label: 'Akun PPN Keluaran', key: 'ppn' },
                    { label: 'Akun PPh (Jika ada)', key: 'pph' },
                  ] as const).map(({ label, key }) => ({
                    label, key, value: draftMapping[key].code, options: denganAkunAktif(opsiAkun[key], draftMapping[key]),
                  })).map(f => (
                    <div key={f.label}>
                      <label className="mb-1 block text-[11px] font-semibold text-neutral-700">{t(f.label)}</label>
                      <select
                        value={f.value ?? ''}
                        onChange={e => {
                          const dipilih = f.options.find(o => (o.code ?? '') === e.target.value) ?? NO_PPH;
                          setDraftMapping(prev => ({ ...prev, [f.key]: dipilih }));
                        }}
                        className={CONTROL}
                      >
                        {f.options.map(opt => (
                          <option key={String(opt.code)} value={opt.code ?? ''}>
                            {opt.code ? `${kodeAkun(opt.code)} - ${t(opt.name)}` : t(opt.name)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-neutral-300 pt-3">
                    <button onClick={saveEditMapping} disabled={savingMapping} className={BTN_PRIMARY}>
                      <Check size={13} /> {savingMapping ? t('Menyimpan...') : t('Simpan')}
                    </button>
                    <button onClick={cancelEditMapping} className={BTN_SECONDARY}>
                      {t('Batal')}
                    </button>
                  </div>
                </div>
              )}
            </StepCard>

            <StepCard step={4} state={stateOf(4)} icon={Scale} title={t('Tax Treatment')}>
              <div className="mb-3 flex items-start gap-2.5 rounded-[10px] border border-neutral-200 bg-neutral-50 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-600">
                  {isTaxable ? <CheckCircle size={15} /> : <Info size={15} />}
                </span>
                <div>
                  <p className="text-xs font-semibold text-neutral-900">
                    {isTaxable ? t('Dikenakan PPN (Taxable)') : t('Tidak ada PPN Keluaran')}
                  </p>
                  <p className="text-[11px] font-medium text-neutral-700">
                    {isTaxable ? t('Transaksi ini dikenakan PPN sesuai ketentuan yang berlaku.') : t('Transaksi ini tidak menghasilkan PPN keluaran.')}
                  </p>
                </div>
              </div>
              <Rows rows={[
                { label: t('Dasar Pengenaan Pajak (DPP)'), value: formatIDR(dpp) },
                { label: t('Tarif PPN'), value: '11%' },
                { label: t('PPN Keluaran'), value: formatIDR(ppn) },
                { label: t('Total Termasuk PPN'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
              ]} />
            </StepCard>
          </div>

          {/* 5. Journal Entry */}
          <StepCard
            step={5}
            state={stateOf(5)}
            icon={BookOpen}
            title={t('Journal Entry')}
            flush
            aside={
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${balanced ? 'border-neutral-200 bg-neutral-50 text-neutral-700' : 'border-red-300 bg-red-100 text-red-700'}`}>
                {balanced ? <Check size={12} strokeWidth={3} /> : <X size={12} />} {balanced ? t('Seimbang') : t('Tidak seimbang')}
              </span>
            }
          >
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[560px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    {[
                      { h: t('No.'), cls: 'w-12 text-left' },
                      { h: t('Account Code'), cls: 'text-left' },
                      { h: t('Account Name'), cls: 'text-left' },
                      { h: t('Debit (IDR)'), cls: 'text-right' },
                      { h: t('Credit (IDR)'), cls: 'text-right' },
                    ].map(c => (
                      <th key={c.h} className={`whitespace-nowrap border-b border-t border-neutral-800 px-4 py-2 text-xs font-bold text-black ${c.cls}`}>{c.h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {journalLines.map(l => (
                    <tr key={l.no} className="text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                      <td className="px-4 py-2.5 text-neutral-600">{l.no}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold text-neutral-900">{l.code ? kodeAkun(l.code) : '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-neutral-900">{l.name ? t(l.name) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{l.debit !== 0 ? formatAngka(l.debit) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{l.credit !== 0 ? formatAngka(l.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`text-xs font-semibold ${balanced ? 'bg-neutral-100 text-neutral-900' : 'bg-red-50 text-red-700'}`}>
                    <td colSpan={3} className="border-t border-neutral-800 px-4 py-3">{t('Total')}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{formatAngka(totalDebit)}</td>
                    <td className="whitespace-nowrap border-t border-neutral-800 px-4 py-3 text-right tabular-nums">{formatAngka(totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </StepCard>

          {/* Bar aksi -- menempel di bawah supaya tombol selalu terjangkau */}
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border px-3 py-2 text-xs ${footerTone}`}>
              <FooterIcon size={15} className={`mt-0.5 shrink-0 ${footerIconTone}`} />
              <span className="font-medium leading-snug">{footerMessage}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={startEditMapping}
                disabled={isPosted || isEditingMapping}
                className={BTN_SECONDARY}
              >
                <Pencil size={12} /> {t('Edit Mapping')}
              </button>
              <button
                onClick={handleApprove}
                disabled={uiStatus !== 'Diproses'}
                className={BTN_SECONDARY}
              >
                <CheckCircle size={13} /> {t('Approve')}
              </button>
              <button
                onClick={handlePostJournal}
                disabled={uiStatus !== 'Siap Posting'}
                className={BTN_PRIMARY}
              >
                <Send size={12} /> {t('Post Journal')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {showDocPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setShowDocPreview(false)}>
          <div className={`${salesFont.className} w-full max-w-md overflow-hidden rounded-[10px] border border-neutral-200 bg-white shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {iconBadge(<FileText size={17} />)}
                <h3 className="truncate text-base font-semibold tracking-tight text-neutral-900">{selectedInvoice.invoice_no}</h3>
              </div>
              <button onClick={() => setShowDocPreview(false)} className="rounded p-1 transition-colors hover:bg-neutral-100" aria-label={t('Tutup')}>
                <X size={16} className="text-neutral-600" />
              </button>
            </div>
            <div className="p-4">
              <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-neutral-300 bg-neutral-50 px-6 text-center text-xs text-neutral-600">
                <FileText size={26} className="text-neutral-500" />
                {t('Pratinjau dokumen sumber belum tersedia (belum ada file yang tertaut ke invoice ini).')}
              </div>
              <div className="mt-3">
                <Rows rows={[
                  { label: t('Pelanggan'), value: selectedInvoice.customer_name },
                  { label: t('Tanggal'), value: formatTanggal(selectedInvoice.invoice_date) },
                  { label: t('Total'), value: formatIDR(selectedInvoice.gross_amount), strong: true },
                ]} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}