'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LinkIcon, XMarkIcon, BoltIcon } from '@heroicons/react/24/outline';
import CashBankTabs from '../components/CashBankTabs';
import NonInvoiceForm from '../components/NonInvoiceForm';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR } from '../../lib/groupAnalytics';
import { useBankFeed } from '../context/BankFeedContext';
import { useBankReconciliation, type SaranKandidat, type BarisLawanInput } from '../lib/useBankReconciliation';
import { useCashPaymentsFromPurchase } from '../lib/usePurchaseCashPayments';
import { useCashReceiptsFromSales } from '../lib/useSalesCashReceipts';

// Ringkasan Saldo Menurut Bank vs Menurut Buku.
//  - Bank  = saldo terbaru tiap rekening di Bank Feed sesi ini, dijumlahkan (dihitung dari 0 + kredit - debit).
//  - Buku  = penerimaan - pembayaran dari mutasi yang SUDAH dicocokkan ke invoice (backend).
//  - Selisih = mutasi yang belum dicocokkan (sisanya harus 0 kalau semua mutasi sudah cocok).
function ReconciliationSummary({
  saldoBank,
  saldoBuku,
}: {
  saldoBank: number;
  saldoBuku: number;
}) {
  const selisih = saldoBank - saldoBuku;
  const balance = Math.abs(selisih) < 1;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div className="card-elevated-md rounded-xl p-5">
        <p className="text-xs text-muted-foreground mb-1">Saldo Menurut Bank</p>
        <p className="text-xl font-bold text-foreground font-mono">{formatIDR(saldoBank)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">Semua mutasi Bank Feed sesi ini</p>
      </div>
      <div className="card-elevated-md rounded-xl p-5">
        <p className="text-xs text-muted-foreground mb-1">Saldo Menurut Buku</p>
        <p className="text-xl font-bold text-foreground font-mono">{formatIDR(saldoBuku)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">Mutasi yang sudah dicocokkan (invoice atau tanpa invoice)</p>
      </div>
      <div className={`rounded-xl p-5 border ${balance ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <p className={`text-xs mb-1 ${balance ? 'text-emerald-700' : 'text-amber-700'}`}>Selisih</p>
        <p className={`text-xl font-bold font-mono ${balance ? 'text-emerald-700' : 'text-amber-700'}`}>{formatIDR(selisih)}</p>
        <p className={`text-[11px] mt-1 ${balance ? 'text-emerald-600' : 'text-amber-600'}`}>
          {balance ? 'BALANCE — semua mutasi sudah dicocokkan' : 'Selisih = mutasi yang belum dicocokkan (lihat daftar di bawah)'}
        </p>
      </div>
    </div>
  );
}

// [DIUBAH] Kolom kanan sekarang SELALU menampilkan invoice Purchase (posted) dan Sales
// (Posted/Partial/Paid) -- sumber yang sama dengan tab Cash Payment/Receipt -- tanpa perlu memilih
// mutasi di kolom kiri dulu (fitur "kandidat per mutasi terpilih" dihapus). Pencocokan tetap lewat
// tombol Cocokkan/Auto-match di kolom kiri, ke INVOICE Purchase (mutasi debet) dan Sales (mutasi kredit), lewat backend
// /api/v1/finance/bank-reconciliation. Kalau matched: pembayaran tercatat (saldo invoice
// diperbarui trigger DB) dan jurnal Kas vs Hutang/Piutang terbentuk (DRAFT). Yang belum
// cocok dicatat di tab Exceptions. Sebelumnya: cocok lokal berdasarkan tanggal + nominal.

const namaKandidat = (k: SaranKandidat) =>
  k.allocations.map((a) => a.invoice_no || a.invoice_id.slice(0, 8)).join(' + ');

const pihakKandidat = (k: SaranKandidat) =>
  Array.from(new Set(k.allocations.map((a) => a.party).filter(Boolean))).join(', ') || '-';

export default function ReconciliationPage() {
  const { mutations } = useBankFeed();
  const {
    saran, pembayaran, saldoBuku, refById, loading, error, busy, autoRunning,
    cocokkan, catatNonInvoice, akunLawan, batalkan, autoCocokkan, muatUlang,
  } = useBankReconciliation();
  const [tab, setTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');
  const [selectedMutation, setSelectedMutation] = useState<string | null>(null);
  // Kolom kanan: daftar invoice posted dari halaman Purchase (Cash Payment) / Sales (Cash Receipt).
  const [sisiInvoice, setSisiInvoice] = useState<'payment' | 'receipt'>('payment');
  const purchase = useCashPaymentsFromPurchase();
  const sales = useCashReceiptsFromSales();
  // Akun bank jurnal ditentukan backend dari label akun di tiap mutasi (dipilih saat upload di
  // Bank Feed) -- tidak ada lagi pilihan global di halaman ini.

  // Mutasi sudah terurut terbaru dulu, jadi kemunculan pertama per rekening = saldo terbaru rekening itu.
  const saldoBank = useMemo(() => {
    const sudah = new Set<string>();
    let total = 0;
    for (const m of mutations) {
      if (sudah.has(m.bankAccount)) continue;
      sudah.add(m.bankAccount);
      total += m.balanceAfter;
    }
    return total;
  }, [mutations]);

  // Saldo awal rekening (dari footer PDF) = saldo terbaru - total arus (kredit - debit) per akun.
  // Saldo Bank sekarang sudah termasuk saldo awal, sedangkan saldoBuku di bawah hanya arus hasil
  // pencocokan -- jadi saldo awal yang sama ditambahkan ke sisi buku supaya Selisih tetap berarti
  // "mutasi yang belum dicocokkan", bukan ikut membawa saldo awal.
  const saldoAwalBank = useMemo(() => {
    const terbaru = new Map<string, number>();
    const arus = new Map<string, number>();
    for (const m of mutations) {
      if (!terbaru.has(m.bankAccount)) terbaru.set(m.bankAccount, m.balanceAfter);
      arus.set(m.bankAccount, (arus.get(m.bankAccount) || 0) + m.credit - m.debit);
    }
    let total = 0;
    terbaru.forEach((saldo, akun) => {
      total += saldo - (arus.get(akun) || 0);
    });
    return total;
  }, [mutations]);

  const unmatchedMutations = useMemo(() => mutations.filter((m) => m.status === 'unmatched'), [mutations]);
  const matchedMutations = useMemo(() => mutations.filter((m) => m.status === 'matched'), [mutations]);

  const mutasiTerpilih = useMemo(
    () => unmatchedMutations.find((m) => m.id === selectedMutation) || null,
    [unmatchedMutations, selectedMutation],
  );

  const daftarInvoice = useMemo(
    () =>
      sisiInvoice === 'payment'
        ? purchase.rows.map((r) => ({
            id: r.id, no: r.invoiceNumber || r.purchaseId, pihak: r.vendor, tanggal: r.date, jatuhTempo: r.dueDate,
            total: r.total, sisa: r.outstanding, dalamProses: r.dalamProses, overdue: r.isOverdue,
          }))
        : sales.rows.map((r) => ({
            id: r.id, no: r.invoiceNo, pihak: r.customer, tanggal: r.date, jatuhTempo: r.dueDate,
            total: r.total, sisa: r.outstanding, dalamProses: r.dalamProses, overdue: r.isOverdue,
          })),
    [sisiInvoice, purchase.rows, sales.rows],
  );
  const loadingInvoice = sisiInvoice === 'payment' ? purchase.loading : sales.loading;
  const errorInvoice = sisiInvoice === 'payment' ? purchase.error : sales.error;

  const handleMatch = async (mutationId: string, kandidat: SaranKandidat) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await cocokkan(m, kandidat, null);
      setSelectedMutation(null);
      toast.success(`Dicocokkan dengan ${namaKandidat(kandidat)}. Jurnal berstatus DRAFT.`);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mencocokkan mutasi.');
    }
  };

  // Cocokkan manual: mutasi terpilih di kiri + invoice yang diklik di kanan. Nominal alokasi = nominal
  // mutasi (backend menolak kalau total alokasi != nominal mutasi), jadi invoice harus punya sisa >= nominal.
  const handleMatchInvoice = async (r: { id: string; no: string; pihak: string; sisa: number }) => {
    if (!mutasiTerpilih) return;
    const nominal = mutasiTerpilih.credit || mutasiTerpilih.debit;
    await handleMatch(mutasiTerpilih.id, {
      kind: 'single',
      exact: Math.abs(r.sisa - nominal) < 0.5,
      ref_hit: false,
      party_ratio: 0,
      score: 0,
      allocations: [{ invoice_id: r.id, invoice_no: r.no || null, party: r.pihak || null, outstanding: r.sisa, amount: nominal }],
    });
  };

  const handleNonInvoice = async (mutationId: string, kategori: string, baris: BarisLawanInput[]) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    await catatNonInvoice(m, kategori, baris, null); // error dilempar ke form supaya tampil di sana
    setSelectedMutation(null);
    toast.success(`${kategori} dicatat. Jurnal berstatus DRAFT, lanjutkan Approve di Journal Preview.`);
  };

  const handleUnmatch = async (mutationId: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await batalkan(m);
      toast.success('Pencocokan dibatalkan.');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal membatalkan pencocokan.');
    }
  };

  const handleAuto = async () => {
    try {
      const r = await autoCocokkan(null);
      toast.success(`${r.matched} mutasi dicocokkan, ${r.unmatched} belum cocok (dicatat di Exceptions).`);
    } catch (e: any) {
      toast.error(e?.message || 'Auto-match gagal.');
    }
  };

  return (
    <div className="p-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={muatUlang} className="font-semibold underline hover:no-underline shrink-0">Coba lagi</button>
        </div>
      )}

      <ReconciliationSummary saldoBank={saldoBank} saldoBuku={saldoBuku + saldoAwalBank} />

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border w-fit">
          {(['unreconciled', 'reconciled'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                tab === t ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'unreconciled' ? `Unreconciled (${unmatchedMutations.length})` : `Reconciled (${matchedMutations.length})`}
            </button>
          ))}
        </div>
        {tab === 'unreconciled' && (
          <button
            onClick={handleAuto}
            disabled={autoRunning || loading || unmatchedMutations.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            title="Cocokkan otomatis mutasi yang pasti (nominal pas + nomor invoice/nama pihak, tanpa pesaing). Sisanya dicatat di Exceptions."
          >
            <BoltIcon className="w-3.5 h-3.5" />
            {autoRunning ? 'Mencocokkan…' : 'Auto-match'}
          </button>
        )}
      </div>

      {loading && mutations.length === 0 ? (
        <p className="text-xs text-muted-foreground py-12 text-center">Memuat data rekonsiliasi...</p>
      ) : tab === 'unreconciled' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Kolom kiri — mutasi Bank Feed belum cocok */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Bank Feed — Belum Dicocokkan</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Pakai tombol Cocokkan / Auto-match, atau klik satu baris untuk mencatat tanpa invoice</p>
            </div>
            {unmatchedMutations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Tidak ada mutasi Bank Feed yang menunggu.</p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {unmatchedMutations.map((m) => {
                  const s = saran[refById.get(m.id) || ''];
                  const auto = s?.auto_match ? s.candidates[0] : null;
                  const selected = selectedMutation === m.id;
                  const isBusy = busy.has(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => {
                        if (isBusy) return;
                        setSelectedMutation(selected ? null : m.id);
                        if (!selected) setSisiInvoice(m.credit ? 'receipt' : 'payment');
                      }}
                      className={`px-4 py-3 transition-colors ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'} ${selected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{m.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {m.date} · {m.bankAccount} · {m.credit ? 'Masuk (Sales / lainnya)' : 'Keluar (Purchase / lainnya)'}
                          </p>
                        </div>
                        <span className={`text-xs font-mono font-semibold whitespace-nowrap ${m.credit ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatIDR(m.credit || m.debit, true)}
                        </span>
                      </div>
                      {auto && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                          <span className="text-[11px] text-emerald-700 truncate">Kandidat: {namaKandidat(auto)} · {pihakKandidat(auto)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMatch(m.id, auto); }}
                            disabled={isBusy}
                            className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                          >
                            <LinkIcon className="w-3 h-3" /> Cocokkan
                          </button>
                        </div>
                      )}
                      {s?.error && <p className="mt-1.5 text-[11px] text-amber-700">{s.error}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Kolom kanan — invoice posted dari Purchase (Cash Payment) & Sales (Cash Receipt), selalu tampil */}
          <div className="card-elevated-md rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Invoice Posted — Cash Payment &amp; Cash Receipt</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sisiInvoice === 'payment'
                  ? 'Invoice Purchase berstatus posted (sumber tab Cash Payment)'
                  : 'Invoice Sales berstatus Posted/Partial/Paid (sumber tab Cash Receipt)'}
              </p>
              <p className="text-xs text-foreground mt-2">
                {mutasiTerpilih
                  ? `Mutasi terpilih: ${formatIDR(mutasiTerpilih.credit || mutasiTerpilih.debit)} (${mutasiTerpilih.credit ? 'masuk' : 'keluar'}). Klik invoice untuk mencocokkan.`
                  : 'Pilih satu mutasi di kiri, lalu klik invoice di sini untuk mencocokkan.'}
              </p>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border w-fit mt-3">
                {([
                  ['payment', `Cash Payment (${purchase.rows.length})`],
                  ['receipt', `Cash Receipt (${sales.rows.length})`],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSisiInvoice(k)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      sisiInvoice === k ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {mutasiTerpilih && (
              <div className="p-3 border-b border-border">
                <NonInvoiceForm
                  key={mutasiTerpilih.id}
                  nominal={mutasiTerpilih.credit || mutasiTerpilih.debit}
                  masuk={!!mutasiTerpilih.credit}
                  akun={akunLawan}
                  busy={busy.has(mutasiTerpilih.id)}
                  onSubmit={(kategori, baris) => handleNonInvoice(mutasiTerpilih.id, kategori, baris)}
                />
              </div>
            )}
            {errorInvoice ? (
              <p className="text-xs text-rose-700 py-10 px-6 text-center">{errorInvoice}</p>
            ) : loadingInvoice && daftarInvoice.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">Memuat invoice…</p>
            ) : daftarInvoice.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 px-6 text-center">
                {sisiInvoice === 'payment'
                  ? 'Belum ada invoice Purchase berstatus posted untuk client ini.'
                  : 'Belum ada invoice Sales berstatus Posted/Partial/Paid untuk client ini.'}
              </p>
            ) : (
              <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
                {daftarInvoice.map((r) => {
                  const nominalTerpilih = mutasiTerpilih ? mutasiTerpilih.credit || mutasiTerpilih.debit : 0;
                  const sisiSesuai = mutasiTerpilih ? (mutasiTerpilih.credit ? 'receipt' : 'payment') === sisiInvoice : false;
                  const tersedia = Math.max(r.sisa - r.dalamProses, 0);
                  const cukup = tersedia + 0.5 >= nominalTerpilih;
                  const bisa = !!mutasiTerpilih && sisiSesuai && cukup;
                  const isBusy = !!mutasiTerpilih && busy.has(mutasiTerpilih.id);
                  const alasan = !mutasiTerpilih
                    ? ''
                    : !sisiSesuai
                      ? mutasiTerpilih.credit ? 'Mutasi masuk: pilih invoice di tab Cash Receipt' : 'Mutasi keluar: pilih invoice di tab Cash Payment'
                      : !cukup
                        ? 'Sisa invoice lebih kecil dari nominal mutasi'
                        : 'Klik untuk mencocokkan';
                  return (
                    <div
                      key={r.id}
                      title={alasan}
                      onClick={() => bisa && !isBusy && handleMatchInvoice(r)}
                      className={`px-4 py-3 flex items-center justify-between gap-2 transition-colors ${
                        !mutasiTerpilih ? '' : bisa ? (isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-primary/5') : 'opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{r.no || '—'}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.pihak || '—'} · {r.tanggal}
                          {r.jatuhTempo ? ` · jatuh tempo ${r.jatuhTempo}` : ''}
                          {r.overdue ? ' · overdue' : ''}
                        </p>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-xs font-mono font-semibold text-foreground">{formatIDR(r.total, true)}</p>
                        <p className={`text-[11px] ${r.sisa > 0.005 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {r.sisa > 0.005 ? `Sisa ${formatIDR(r.sisa, true)}` : 'Lunas'}
                          {r.dalamProses > 0.005 ? ` · proses ${formatIDR(r.dalamProses, true)}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card-elevated-md rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-bold text-foreground">Riwayat Reconciled</h2>
          </div>
          {matchedMutations.length === 0 ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Belum ada mutasi yang dicocokkan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Tanggal', 'Mutasi Bank Feed', 'Dicocokkan Dengan', 'Nominal', 'Jurnal', 'Status', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchedMutations.map((m) => {
                    const p = pembayaran[refById.get(m.id) || ''];
                    const isBusy = busy.has(m.id);
                    return (
                      <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.date}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{m.description}</td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-[220px] truncate">
                          {p
                            ? p.nonInvoice
                              ? `Tanpa invoice · ${p.party || '—'}`
                              : `${p.invoices.join(', ') || '—'}${p.party ? ` · ${p.party}` : ''}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-right whitespace-nowrap">{formatIDR(m.credit || m.debit, true)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {p?.journalNo ? `${p.journalNo}${p.journalStatus ? ` (${p.journalStatus})` : ''}` : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge label="Reconciled" variant="positive" /></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleUnmatch(m.id)}
                            disabled={isBusy}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Batalkan pencocokan"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}