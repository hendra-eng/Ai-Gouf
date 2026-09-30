'use client';

// Salinan desain tab Journal Preview di Sales (sales/components/SalesJournalPreview.tsx)
// untuk Cash & Bank.
//
// Data REAL dari backend (/api/v1/finance/bank-reconciliation -- lihat lib/useBankCashRekon.ts):
// daftar = jurnal hasil Reconciliation (invoice maupun tanpa invoice), baris jurnal apa adanya dari
// journal_lines. Alur status: DRAFT -> Approve (Supervisor ke atas) -> APPROVED -> Post Journal
// (Manager ke atas) -> POSTED. Invoice baru berubah saat POSTED. Jurnal tanpa invoice (biaya admin,
// bunga, dst) dibuat dari form di tab Reconciliation dan lewat antrean yang sama.
// Jalur LENGKAP lama (klasifikasi akun & pajak per mutasi) tidak dipakai lagi; kodenya dibiarkan.
//
// [BARU] UI sekarang bercabang berdasarkan `matchStatus` tiap transaksi (lihat
// cashBankMock.ts untuk alasannya):
//   - 'matched'   -> jalur pendek. Akun lawan & pajak sudah diketahui dari
//                    invoice Sales/Purchase asal, jadi tidak lewat AI
//                    Extraction/Classification/Tax Treatment. Panel kiri
//                    diganti 1 panel "Invoice Terkait", jurnal otomatis 2
//                    baris, dan Edit Mapping dikunci.
//   - 'unmatched' -> jalur lengkap, TIDAK DIUBAH dari sebelumnya (AI
//                    Extraction -> Accounting Classification -> Tax
//                    Treatment -> Journal Entry, semua bisa diedit).

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, ChevronLeft, ChevronRight, CheckCircle, ChevronRight as Arrow, X, Eye, Link2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import type { CashBankTx } from '../lib/cashBankMock';
import { useActiveClient } from '@/lib/activeClient';
import { rekonApproveJurnal, rekonPostJurnal } from '@/app/agent-ai/lib/api';
import { useJurnalRekonTxs, type CashBankTxReal } from '../lib/useBankCashRekon';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type UiStatus = 'Diproses' | 'Siap Posting' | 'Diposting';

function keUiStatus(posting_status: string): UiStatus {
  if (posting_status === 'Posted') return 'Diposting';
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

// Jalur MATCHED: pendek (3 langkah) — akun lawan & pajak sudah diketahui dari invoice.
const STEPS_MATCHED = [
  { n: 1, label: 'Invoice Terkait', sub: 'Matched ke invoice' },
  { n: 2, label: 'Journal', sub: 'Jurnal akuntansi' },
  { n: 3, label: 'Approve/Post', sub: 'Persetujuan' },
];

// Jalur UNMATCHED: lengkap (6 langkah) — sama seperti sebelumnya, tidak diubah.
const STEPS_UNMATCHED = [
  { n: 1, label: 'Source Document', sub: 'Dokumen sumber' },
  { n: 2, label: 'AI Extraction', sub: 'Ekstraksi data' },
  { n: 3, label: 'Accounting Classification', sub: 'Klasifikasi akun' },
  { n: 4, label: 'Tax Treatment', sub: 'Perlakuan pajak' },
  { n: 5, label: 'Journal', sub: 'Jurnal akuntansi' },
  { n: 6, label: 'Approve/Post', sub: 'Persetujuan' },
];

const stepForStatus = (status: UiStatus, totalSteps: number) => {
  if (status === 'Diposting') return totalSteps;
  if (status === 'Siap Posting') return totalSteps - 1;
  return totalSteps - 2;
};

// Opsi akun statis untuk jalur lengkap lama (tidak dipakai jalur rekonsiliasi; akun jurnal nyata dari backend).
interface Acc { code: string | null; name: string }
const NO_PPH: Acc = { code: null, name: 'Tidak ada potongan PPh' };

interface Mapping { kas: Acc; lawan: Acc; ppn: Acc; pph: Acc }
interface AccountOptions { kas: Acc[]; lawan: Acc[]; ppn: Acc[]; pph: Acc[] }

const OPSI_AKUN: AccountOptions = {
  kas: [
    { code: '1110-01', name: 'Kas Besar' },
    { code: '1110-02', name: 'Bank BCA - IDR' },
    { code: '1110-03', name: 'Bank Mandiri - IDR' },
    { code: '1110-04', name: 'Bank BNI - IDR' },
  ],
  lawan: [
    { code: '1120-01', name: 'Piutang Usaha - IDR' },
    { code: '2110-01', name: 'Hutang Usaha - IDR' },
    { code: '6100-01', name: 'Beban Listrik & Air' },
    { code: '6200-01', name: 'Beban Pemeliharaan' },
    { code: '6900-01', name: 'Biaya Administrasi Bank' },
  ],
  ppn: [
    { code: '2100-01', name: 'PPN Keluaran' },
    { code: '1150-01', name: 'PPN Masukan' },
  ],
  pph: [NO_PPH, { code: '1170-01', name: 'PPh Pasal 23 Dibayar Dimuka' }, { code: '1170-02', name: 'PPh Pasal 4(2) Dibayar Dimuka' }],
};

function kasAccUntuk(tx: CashBankTx): Acc {
  const kasIdx = tx.bank_account.startsWith('Mandiri') ? 2 : tx.bank_account.startsWith('BNI') ? 3 : 1;
  return OPSI_AKUN.kas[kasIdx];
}

/** Mapping untuk transaksi MATCHED: akun lawan tetap (Piutang/Hutang Usaha dari invoice
 *  asal), tidak ada baris PPN/PPh terpisah karena pajaknya sudah tercatat di invoice. */
function mappingMatched(tx: CashBankTx): Mapping {
  const namaAkun = tx.linkedInvoice?.counterpartyAccount ?? (tx.direction === 'Cash Receipt' ? OPSI_AKUN.lawan[0].code + ' - ' + OPSI_AKUN.lawan[0].name : OPSI_AKUN.lawan[1].code + ' - ' + OPSI_AKUN.lawan[1].name);
  const [code, ...rest] = namaAkun.split(' - ');
  return { kas: kasAccUntuk(tx), lawan: { code, name: rest.join(' - ') }, ppn: OPSI_AKUN.ppn[0], pph: NO_PPH };
}

function mappingUsulan(tx: CashBankTx): Mapping {
  const lawan =
    tx.transaction_type.includes('Piutang') ? OPSI_AKUN.lawan[0]
    : tx.transaction_type.includes('Hutang') ? OPSI_AKUN.lawan[1]
    : tx.transaction_type.includes('Listrik') ? OPSI_AKUN.lawan[2]
    : tx.transaction_type.includes('Pemeliharaan') ? OPSI_AKUN.lawan[3]
    : tx.transaction_type.includes('Bank') ? OPSI_AKUN.lawan[4]
    : OPSI_AKUN.lawan[0];
  return {
    kas: kasAccUntuk(tx),
    lawan,
    ppn: tx.direction === 'Cash Payment' ? OPSI_AKUN.ppn[1] : OPSI_AKUN.ppn[0],
    pph: NO_PPH,
  };
}

/** Pastikan akun yang sedang terpasang ikut muncul di dropdown walau di luar filter. */
const denganAkunAktif = (list: Acc[], aktif: Acc) =>
  aktif.code === null || list.some(a => a.code === aktif.code) ? list : [aktif, ...list];

const ITEMS_PER_PAGE = 5;

export default function CashBankJournalPreview() {
  const { t } = useLanguage();

  const { activeClientId } = useActiveClient();
  const { txs, loading, error, refresh } = useJurnalRekonTxs();
  const [posting, setPosting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [showDocPreview, setShowDocPreview] = useState(false);
  const [isEditingMapping, setIsEditingMapping] = useState(false);
  const [draftMapping, setDraftMapping] = useState<Mapping | null>(null);
  const savingMapping = false;

  useEffect(() => {
    if (!selectedId && txs.length > 0) setSelectedId(txs[0].id);
  }, [txs, selectedId]);

  const filteredTxs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txs;
    return txs.filter(x => x.tx_no.toLowerCase().includes(q) || x.counterparty.toLowerCase().includes(q));
  }, [txs, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedTxs = filteredTxs.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  const selectedTx: CashBankTxReal | null = txs.find(x => x.id === selectedId) ?? txs[0] ?? null;

  if (!selectedTx) {
    return (
      <div className="card p-8 text-center text-xs text-muted-foreground space-y-2">
        {error && <p className="text-rose-600">{error}</p>}
        <p>
          {loading
            ? t('Memuat...')
            : t('Belum ada jurnal. Jurnal muncul di sini setelah mutasi Bank Feed dicocokkan ke invoice di tab Reconciliation.')}
        </p>
      </div>
    );
  }

  const isMatched = selectedTx.matchStatus === 'matched';
  const STEPS = isMatched ? STEPS_MATCHED : STEPS_UNMATCHED;

  const uiStatus = keUiStatus(selectedTx.posting_status);
  const mapping: Mapping = isMatched ? mappingMatched(selectedTx) : (mappings[selectedTx.id] ?? mappingUsulan(selectedTx));
  const opsiAkun = OPSI_AKUN;
  const dpp = selectedTx.dpp;
  const ppn = isMatched ? 0 : selectedTx.ppn; // matched: PPN sudah tercatat di invoice, tidak dipecah lagi di sini

  const { kas: kasAcc, lawan: lawanAcc, ppn: ppnAcc, pph: pphAcc } = mapping;
  const isReceipt = selectedTx.direction === 'Cash Receipt';

  // Cash Receipt: Debit Kas/Bank, Kredit akun lawan (+ PPN kalau unmatched). Cash Payment: kebalikannya.
  // Matched: selalu 2 baris (Kas/Bank vs Piutang/Hutang Usaha), sebesar nominal mutasi bank.
  const journalLines = isMatched && selectedTx.realLines && selectedTx.realLines.length > 0
    ? selectedTx.realLines
    : isMatched
    ? (isReceipt
        ? [
            { no: 1, code: kasAcc.code as string, name: kasAcc.name, debit: selectedTx.amount, credit: 0 },
            { no: 2, code: lawanAcc.code as string, name: lawanAcc.name, debit: 0, credit: selectedTx.amount },
          ]
        : [
            { no: 1, code: lawanAcc.code as string, name: lawanAcc.name, debit: selectedTx.amount, credit: 0 },
            { no: 2, code: kasAcc.code as string, name: kasAcc.name, debit: 0, credit: selectedTx.amount },
          ])
    : isReceipt
    ? [
        { no: 1, code: kasAcc.code as string, name: kasAcc.name, debit: selectedTx.amount, credit: 0 },
        { no: 2, code: lawanAcc.code as string, name: lawanAcc.name, debit: 0, credit: dpp },
        ...(ppn > 0 ? [{ no: 3, code: ppnAcc.code as string, name: ppnAcc.name, debit: 0, credit: ppn }] : []),
      ]
    : [
        { no: 1, code: lawanAcc.code as string, name: lawanAcc.name, debit: dpp, credit: 0 },
        ...(ppn > 0 ? [{ no: 2, code: ppnAcc.code as string, name: ppnAcc.name, debit: ppn, credit: 0 }] : []),
        { no: ppn > 0 ? 3 : 2, code: kasAcc.code as string, name: kasAcc.name, debit: 0, credit: selectedTx.amount },
      ];

  const activeStep = stepForStatus(uiStatus, STEPS.length);
  const isPosted = uiStatus === 'Diposting';

  const handleSelectTx = (x: CashBankTx) => {
    setSelectedId(x.id);
    setIsEditingMapping(false);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const startEditMapping = () => {
    if (isMatched) return; // akun mengikuti invoice asal, tidak bisa diedit di jalur matched
    setDraftMapping(mapping);
    setIsEditingMapping(true);
  };

  const cancelEditMapping = () => setIsEditingMapping(false);

  const saveEditMapping = () => {
    if (!draftMapping) return;
    setMappings(prev => ({ ...prev, [selectedTx.id]: draftMapping }));
    setIsEditingMapping(false);
    toast.success(t('Mapping akun disimpan'), { description: selectedTx.tx_no });
  };

  const handleApprove = async () => {
    if (uiStatus !== 'Diproses' || approving) return;
    if (!activeClientId) {
      toast.error(t('Belum ada client aktif — pilih client dulu di Topbar.'));
      return;
    }
    setApproving(true);
    try {
      await rekonApproveJurnal(String(activeClientId), selectedTx.id);
      await refresh();
      toast.success(t('Jurnal disetujui'), { description: selectedTx.tx_no });
    } catch (e: any) {
      toast.error(e?.message || t('Gagal menyetujui jurnal.'));
    } finally {
      setApproving(false);
    }
  };

  const handlePostJournal = async () => {
    if (uiStatus !== 'Siap Posting' || posting) return;
    if (!activeClientId) {
      toast.error(t('Belum ada client aktif — pilih client dulu di Topbar.'));
      return;
    }
    setPosting(true);
    try {
      await rekonPostJurnal(String(activeClientId), selectedTx.id);
      setIsEditingMapping(false);
      await refresh();
      toast.success(t('Jurnal berhasil diposting'), {
        description: selectedTx.linkedInvoice ? `${selectedTx.tx_no} → ${selectedTx.linkedInvoice.no}` : selectedTx.tx_no,
      });
    } catch (e: any) {
      toast.error(e?.message || t('Gagal memposting jurnal.'));
    } finally {
      setPosting(false);
    }
  };

  const footerMessage =
    uiStatus === 'Diposting'
      ? isMatched
        ? selectedTx.linkedInvoice
          ? t('Jurnal ini sudah diposting ke buku besar dan outstanding invoice sudah diperbarui.')
          : t('Jurnal ini sudah diposting ke buku besar.')
        : t('Jurnal ini sudah diposting ke buku besar.')
      : uiStatus === 'Siap Posting'
      ? isMatched
        ? selectedTx.linkedInvoice
          ? t('Jurnal sudah disetujui. Saat diposting, outstanding invoice ikut diperbarui. Posting butuh Manager ke atas.')
          : t('Jurnal sudah disetujui. Posting butuh Manager ke atas.')
        : t('Jurnal ini siap untuk diposting. Silakan periksa kembali hasil klasifikasi akun dan pastikan sudah sesuai sebelum diposting ke buku besar.')
      : isMatched
      ? selectedTx.linkedInvoice
        ? t('Mutasi ini sudah cocok dengan invoice, jurnal masih DRAFT. Setujui (Approve) dulu, lalu Post. Outstanding invoice baru berubah setelah diposting.')
        : t('Mutasi tanpa invoice, jurnal masih DRAFT. Setujui (Approve) dulu, lalu Post.')
      : t('Jurnal masih diproses. Setujui klasifikasi akun terlebih dahulu sebelum bisa diposting.');

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Daftar Transaksi */}
      <div className="w-72 flex-shrink-0 card overflow-hidden self-start">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground mb-2">{t('Daftar Transaksi Kas & Bank')}</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={t('Cari nomor transaksi atau counterparty...')}
              className="w-full text-xs border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card text-foreground"
            />
          </div>
        </div>
        <div className="overflow-y-auto max-h-[600px] scrollbar-thin">
          {pagedTxs.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">{loading ? t('Memuat...') : t('Tidak ada transaksi yang cocok.')}</div>
          )}
          {pagedTxs.map(x => {
            const s = keUiStatus(x.posting_status);
            const matched = x.matchStatus === 'matched';
            return (
              <div
                key={x.id}
                onClick={() => handleSelectTx(x)}
                className={`p-3 border-b border-border/50 cursor-pointer transition-colors ${selectedTx.id === x.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${matched ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                      {matched ? <Link2 size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-amber-600" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{x.tx_no}</p>
                      <p className="text-[11px] text-muted-foreground">{x.counterparty}</p>
                      <p className="text-[11px] text-muted-foreground">{formatTanggal(x.tx_date)}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-semibold text-foreground">{formatIDR(x.amount)}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[s]}`}>{t(s)}</span>
                  </div>
                </div>
                <span className={`inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${matched ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {matched ? t('Dari Invoice') : t('Perlu Klasifikasi')}
                </span>
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredTxs.length === 0
              ? t('0 transaksi')
              : `${t('Menampilkan')} ${pageStart + 1} – ${Math.min(pageStart + ITEMS_PER_PAGE, filteredTxs.length)} ${t('dari')} ${filteredTxs.length} ${t('transaksi')}`}
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
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[uiStatus]}`}>{t(uiStatus)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {isMatched
              ? t('Mutasi ini sudah cocok dengan invoice — akun & pajak mengikuti invoice asal.')
              : t('Lihat bagaimana transaksi kas & bank diubah menjadi jurnal akuntansi')}
          </p>

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

        {isMatched ? (
          <>
            {/* Jalur MATCHED: 1 panel ringkas Invoice Terkait, ganti Source Document/AI
                Extraction/Accounting Classification/Tax Treatment yang tidak relevan lagi. */}
            <div className="card p-4">
              <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold flex items-center justify-center">
                  <Link2 size={11} />
                </span>
                {selectedTx.linkedInvoice ? t('Invoice Terkait') : t('Detail Mutasi')}
              </h4>
              {selectedTx.linkedInvoice ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="text-xs space-y-1.5">
                    {[
                      ['No. Invoice', selectedTx.linkedInvoice.no],
                      ['Jenis', selectedTx.linkedInvoice.type === 'Sales' ? t('Sales (Piutang)') : t('Purchase (Hutang)')],
                      ['Counterparty', selectedTx.counterparty],
                      ['No. Mutasi Bank', selectedTx.tx_no],
                      ['Tanggal Mutasi', formatTanggal(selectedTx.tx_date)],
                      ['Akun Piutang/Hutang', selectedTx.linkedInvoice.counterpartyAccount],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground w-32 flex-shrink-0">{t(k)}</span>
                        <span className="font-medium text-foreground">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs space-y-1.5 border-l border-border pl-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('Outstanding Sebelum')}</span>
                      <span className="font-medium text-foreground">{formatIDR(selectedTx.linkedInvoice.outstandingBefore)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('Nominal Mutasi Bank')}</span>
                      <span className="font-medium text-foreground">{formatIDR(selectedTx.amount)}</span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-border/70">
                      <span className="text-muted-foreground">{t('Outstanding Sesudah')}</span>
                      <span className={`font-semibold ${selectedTx.linkedInvoice.outstandingAfter === 0 ? 'text-emerald-600' : 'text-foreground'}`}>
                        {formatIDR(selectedTx.linkedInvoice.outstandingAfter)}
                        {selectedTx.linkedInvoice.outstandingAfter === 0 ? ` (${t('Lunas')})` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs space-y-1.5">
                  {[
                    ['Jenis', t('Tanpa invoice (biaya admin, bunga, transfer, dll)')],
                    ['Kategori', selectedTx.counterparty],
                    ['No. Mutasi Bank', selectedTx.tx_no],
                    ['Tanggal Mutasi', formatTanggal(selectedTx.tx_date)],
                    ['Nominal Mutasi Bank', formatIDR(selectedTx.amount)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-muted-foreground w-32 flex-shrink-0">{t(k)}</span>
                      <span className="font-medium text-foreground">{v}</span>
                    </div>
                  ))}
                  <p className="text-muted-foreground pt-1">{t('Tidak ada invoice yang dilunasi, jadi outstanding Purchase/Sales tidak berubah.')}</p>
                </div>
              )}
            </div>

            {/* Journal Entry — 2 baris saja untuk jalur matched */}
            <div className="card p-4">
              <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">2</span>
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
                      <td className="py-1.5 px-2 text-right text-xs">{selectedTx.amount.toLocaleString('id-ID')}</td>
                      <td className="py-1.5 px-2 text-right text-xs">{selectedTx.amount.toLocaleString('id-ID')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                {t('Pajak (PPN/PPh) sudah tercatat saat invoice diposting, jadi tidak dipecah lagi di jurnal pelunasan ini.')}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Content Grid — jalur UNMATCHED, tidak diubah dari sebelumnya */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {/* 1. Source Document */}
              <div className="card p-4">
                <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">1</span>
                  {t('Source Document')}
                </h4>
                <div className="bg-muted/30 rounded-lg p-3 mb-3 flex items-center gap-3">
                  <div className="w-10 h-12 bg-white border border-border rounded flex items-center justify-center text-[9px] text-muted-foreground">TRX</div>
                  <div className="text-xs space-y-1">
                    {[
                      ['No. Transaksi', selectedTx.tx_no],
                      ['Counterparty', selectedTx.counterparty],
                      ['Tanggal Transaksi', formatTanggal(selectedTx.tx_date)],
                      ['Nominal', formatIDR(selectedTx.amount)],
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
                    ['No. Transaksi', selectedTx.tx_no],
                    ['Counterparty', selectedTx.counterparty],
                    ['Tipe Transaksi', <span key="t" className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{t(selectedTx.transaction_type || selectedTx.direction)}</span>],
                    ['Status Pajak', <span key="s" className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">{t(selectedTx.tax_status)}</span>],
                    ['Total DPP', formatIDR(dpp)],
                    ['PPN (11%)', formatIDR(ppn)],
                    ['Nominal', formatIDR(selectedTx.amount)],
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
                      { label: 'Akun Kas/Bank', code: kasAcc.code, name: kasAcc.name },
                      { label: 'Akun Lawan', code: lawanAcc.code, name: lawanAcc.name },
                      { label: 'Akun PPN', code: ppnAcc.code, name: ppnAcc.name },
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
                    {([
                      { label: 'Akun Kas/Bank', key: 'kas' },
                      { label: 'Akun Lawan', key: 'lawan' },
                      { label: 'Akun PPN', key: 'ppn' },
                      { label: 'Akun PPh (Jika ada)', key: 'pph' },
                    ] as const).map(({ label, key }) => ({
                      label, key, value: draftMapping![key].code, options: denganAkunAktif(opsiAkun[key], draftMapping![key]),
                    })).map(f => (
                      <div key={f.label}>
                        <label className="text-[11px] text-muted-foreground block mb-1">{t(f.label)}</label>
                        <select
                          value={f.value ?? ''}
                          onChange={e => {
                            const dipilih = f.options.find(o => (o.code ?? '') === e.target.value) ?? NO_PPH;
                            setDraftMapping(prev => ({ ...(prev as Mapping), [f.key]: dipilih }));
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
                        className="flex-1 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {savingMapping ? t('Menyimpan...') : t('Simpan')}
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
                {ppn > 0 ? (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-3 flex items-start gap-2">
                    <CheckCircle size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-700">{t('Dikenakan PPN (Taxable)')}</p>
                      <p className="text-[11px] text-emerald-600">{t('Transaksi ini dikenakan PPN sesuai ketentuan yang berlaku.')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg mb-3 flex items-start gap-2">
                    <CheckCircle size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{t('Tidak Dikenakan PPN (Non-Taxable)')}</p>
                      <p className="text-[11px] text-slate-600">{t('Transaksi ini tidak memiliki PPN.')}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5 text-xs">
                  {[
                    ['Dasar Pengenaan Pajak (DPP)', formatIDR(dpp)],
                    ['Tarif PPN', ppn > 0 ? '11%' : '—'],
                    ['PPN', formatIDR(ppn)],
                    ['Total Termasuk PPN', formatIDR(selectedTx.amount)],
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
                        <td className="py-1.5 px-2 text-right text-xs">{selectedTx.amount.toLocaleString('id-ID')}</td>
                        <td className="py-1.5 px-2 text-right text-xs">{selectedTx.amount.toLocaleString('id-ID')}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Footer Action Bar */}
        <div className="card p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <span className="w-4 h-4 bg-blue-100 rounded-full flex items-center justify-center text-[9px]">ℹ</span>
            <span>{footerMessage}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={startEditMapping}
              disabled={isPosted || isEditingMapping || isMatched}
              title={isMatched ? t('Akun mengikuti invoice asal, tidak bisa diedit di sini') : undefined}
              className="px-3 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✏ {t('Edit Mapping')}
            </button>
            <button
              onClick={handleApprove}
              disabled={uiStatus !== 'Diproses' || approving}
              className="px-3 py-1.5 border border-primary text-primary rounded-lg text-xs font-medium hover:bg-primary/5 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✅ {approving ? t('Menyetujui...') : t('Approve')}
            </button>
            <button
              onClick={handlePostJournal}
              disabled={uiStatus !== 'Siap Posting' || posting}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
              📋 {posting ? t('Memposting...') : t('Post Journal')}
            </button>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {showDocPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDocPreview(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{selectedTx.tx_no}</h3>
              <button onClick={() => setShowDocPreview(false)} className="p-1 hover:bg-muted rounded">
                <X size={16} />
              </button>
            </div>
            <div className="bg-muted/30 rounded-lg h-64 flex items-center justify-center text-xs text-muted-foreground border border-border">
              {t('Pratinjau dokumen sumber belum tersedia (belum ada file yang tertaut ke transaksi ini).')}
            </div>
            <div className="text-xs space-y-1 mt-3">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Counterparty')}</span><span className="font-medium text-foreground">{selectedTx.counterparty}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Tanggal')}</span><span className="font-medium text-foreground">{formatTanggal(selectedTx.tx_date)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('Total')}</span><span className="font-medium text-foreground">{formatIDR(selectedTx.amount)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}