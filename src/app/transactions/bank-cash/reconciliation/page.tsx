'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Link2, X, Zap, EyeOff, Database, FileText, Info, Scale, Wand2, Search, Sparkles } from 'lucide-react';
import CashBankTabs from '../components/CashBankTabs';
import NonInvoiceForm from '../components/NonInvoiceForm';
import BookMatchPanel from '../components/BookMatchPanel';
import AutoRulesPanel from '../components/AutoRulesPanel';
import { SalesCardHeader } from '../components/salesStyleKit';
import { formatIDR } from '../lib/formatMoney';
import { useBankFeed } from '../context/BankFeedContext';
import { useBankReconciliation, type SaranKandidat, type BarisLawanInput, type AkunLawan } from '../lib/useBankReconciliation';
import { useActiveClient } from '@/lib/activeClient';
import {
  useBcOverview, TX_STATUS_LABEL, ADJUSTMENT_CATEGORY_LABEL, BankCashError, hitungAdjustment, kategoriBawaan,
  type AdjustmentCategory, type BcAdjustmentOverview, type BcAdjustmentSettings, type BcOverviewAccount, type TxStatus,
} from '@/lib/bankCashStore';
import { useCashPaymentsFromPurchase } from '../lib/usePurchaseCashPayments';
import { useCashReceiptsFromSales } from '../lib/useSalesCashReceipts';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Gaya elegant (sama dengan kartu KPI Sales Overview & tab Cash & Bank lain).
const SUM_CARD = 'relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700';
const SUM_HEAD = 'flex h-5 items-center justify-between gap-2';
const SUM_LABEL = 'min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600';
const SUM_VALUE = 'mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900';
const SUM_SUB = 'mt-1 text-[11px] font-medium text-neutral-500';
const TBL_TH = 'whitespace-nowrap border-b border-t border-neutral-800 px-2 py-2 text-xs font-bold text-black';
const TBL_ROW = 'text-xs [&:hover>td]:bg-neutral-200 [&>td]:shadow-[inset_0_-1px_0_#b4b4b4]';
const PILL = 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium';
const SUB_TAB = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;

// Nominal LENGKAP dengan koma (Rp 444.050,00), bukan singkatan 444Rb: di rekonsiliasi selisih Rp 50 harus terlihat.
const rp = (n: number) => formatIDR(n);

const KATEGORI_PILIHAN: AdjustmentCategory[] = ['bank_fee', 'discount', 'rounding'];
const SELECT_CLS = 'rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-[11px] text-neutral-800 focus:border-neutral-700 focus:outline-none disabled:opacity-50';

// Panel adjustment selisih kecil: status fitur, batas per match, akun tujuan (dari Settings > Account Mapping),
// dan pemantauan total adjustment (supaya accounting melihat kalau selisih mulai membesar).
const SLOT_AKUN: { slot: 'expense' | 'income' | AdjustmentCategory; label: string; kosong: string }[] = [
  { slot: 'expense', label: 'Expense account', kosong: '— not set —' },
  { slot: 'income', label: 'Income account', kosong: '— not set —' },
  { slot: 'bank_fee', label: 'Bank admin fee account', kosong: '— use expense account —' },
  { slot: 'discount', label: 'Discount account', kosong: '— use expense / income account —' },
  { slot: 'rounding', label: 'Rounding account', kosong: '— use expense / income account —' },
];

function AdjustmentPanel({ settings, ringkasan, akun, onSave }: {
  settings: BcAdjustmentSettings | null;
  ringkasan: BcAdjustmentOverview | undefined;
  akun: AkunLawan[];
  onSave: (enabled: boolean, limit: number, akun?: Record<string, string | null>) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState(false);
  const [limit, setLimit] = useState('');
  const [pilihAkun, setPilihAkun] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  if (!settings) return null;

  const akunSaatIni = (slot: 'expense' | 'income' | AdjustmentCategory): string =>
    (slot === 'expense' || slot === 'income' ? settings.accounts[slot] : settings.category_accounts?.[slot])?.id ?? '';
  const akunBisaDipilih = akun.filter((a) => !a.jenis_kas); // akun kas/bank tidak boleh jadi akun selisih
  const buka = () => {
    setLimit(String(settings.limit)); setEnabled(settings.enabled);
    setPilihAkun(Object.fromEntries(SLOT_AKUN.map((x) => [x.slot, akunSaatIni(x.slot)])));
    setEdit(true);
  };
  const simpan = async () => {
    const n = Number(limit.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > settings.max_limit) {
      toast.error(`The limit must be between ${rp(0)} and ${rp(settings.max_limit)}.`);
      return;
    }
    setSaving(true);
    try {
      // Kirim hanya akun yang berubah (key tidak dikirim = tidak diubah di server).
      const perubahan: Record<string, string | null> = {};
      for (const x of SLOT_AKUN) {
        const baru = pilihAkun[x.slot] ?? '';
        const kunci = settings.mapping_keys[x.slot];
        if (kunci && baru !== akunSaatIni(x.slot)) perubahan[kunci] = baru || null;
      }
      await onSave(enabled, n, perubahan);
      toast.success('Adjustment settings saved.');
      setEdit(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save the adjustment settings.');
    } finally {
      setSaving(false);
    }
  };

  const akunKat = (k: AdjustmentCategory) => settings.category_accounts?.[k] ?? null;
  // Admin fee hanya bisa jadi biaya; diskon & pembulatan bisa dua arah. Akun kategori menggantikan akun expense/income.
  const akunBelum = !(akunKat('bank_fee') || settings.ready.expense)
    || !(akunKat('discount') || (settings.ready.expense && settings.ready.income))
    || !(akunKat('rounding') || (settings.ready.expense && settings.ready.income));
  const postedTotal = ringkasan ? ringkasan.monthly.reduce((n, b) => n + b.expense + b.income, 0) : 0;
  const postedCount = ringkasan ? ringkasan.monthly.reduce((n, b) => n + b.count, 0) : 0;
  const akunTeks = (a: BcAdjustmentSettings['accounts']['expense']) => (a ? `${kodeAkun(a.code)} · ${a.name}` : null);

  return (
    <div className={`${SUM_CARD} !pt-4`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${akunBelum && settings.enabled ? 'bg-amber-500' : 'bg-blue-600'}`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale size={14} className="text-neutral-700" />
          <p className={SUM_LABEL}>Small-difference adjustment</p>
          <span className={`${PILL} ${settings.enabled ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-neutral-300 bg-neutral-100 text-neutral-600'}`}>
            {settings.enabled ? 'On' : 'Off'}
          </span>
        </div>
        {!edit && (
          <button onClick={buka} className="text-[11px] font-medium text-neutral-600 underline hover:text-neutral-900">
            Edit settings
          </button>
        )}
      </div>

      {edit ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-neutral-800">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable adjustments
          </label>
          <label className="flex items-center gap-1.5 text-neutral-800">
            Limit per match (Rp)
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="decimal"
              className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-right tabular-nums focus:border-neutral-700 focus:outline-none"
            />
          </label>
          <span className="text-[11px] text-neutral-500">max {rp(settings.max_limit)} · applies to the TOTAL difference of a match, not per invoice</span>
          <div className="grid w-full grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {SLOT_AKUN.map((x) => (
              <label key={x.slot} className="flex flex-col gap-1 text-[11px] text-neutral-600">
                {x.label}
                <select
                  value={pilihAkun[x.slot] ?? ''}
                  onChange={(e) => setPilihAkun((p) => ({ ...p, [x.slot]: e.target.value }))}
                  disabled={saving}
                  className={SELECT_CLS}
                >
                  <option value="">{x.kosong}</option>
                  {akunBisaDipilih.map((a) => (
                    <option key={a.id} value={a.id}>{kodeAkun(a.no_akun)} · {a.nama_akun}</option>
                  ))}
                </select>
              </label>
            ))}
            <p className="col-span-full text-[11px] text-neutral-500">Same data as Settings › Account Mapping (group “Bank &amp; Cash”). One account can only be used once.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setEdit(false)} disabled={saving} className="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">Cancel</button>
            <button onClick={simpan} disabled={saving} className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-neutral-600 sm:grid-cols-3">
          <p>
            Limit per match: <span className="font-semibold tabular-nums text-neutral-900">{rp(settings.limit)}</span>
            <span className="text-neutral-500"> · both directions</span>
          </p>
          <p>
            Expense account:{' '}
            {akunTeks(settings.accounts.expense)
              ? <span className="font-medium text-neutral-900">{akunTeks(settings.accounts.expense)}</span>
              : <span className="font-semibold text-amber-700">not set</span>}
            <br />
            Income account:{' '}
            {akunTeks(settings.accounts.income)
              ? <span className="font-medium text-neutral-900">{akunTeks(settings.accounts.income)}</span>
              : <span className="font-semibold text-amber-700">not set</span>}
          </p>
          <p>
            {KATEGORI_PILIHAN.map((k, i) => (
              <span key={k}>
                {i > 0 && <br />}
                {ADJUSTMENT_CATEGORY_LABEL[k]} account:{' '}
                {akunTeks(akunKat(k))
                  ? <span className="font-medium text-neutral-900">{akunTeks(akunKat(k))}</span>
                  : <span className="text-neutral-500">uses the expense / income account</span>}
              </span>
            ))}
          </p>
          <p>
            Posted this year: <span className="font-semibold tabular-nums text-neutral-900">{rp(postedTotal)}</span> ({postedCount})
            {ringkasan && ringkasan.pending.count > 0 && (
              <><br />Pending (draft/approved): <span className="font-semibold tabular-nums text-neutral-900">{rp(ringkasan.pending.amount)}</span> ({ringkasan.pending.count})</>
            )}
          </p>
        </div>
      )}

      {settings.enabled && akunBelum && !edit && (
        <p className="mt-2 text-[11px] font-medium text-amber-800">
          Set the bank adjustment account(s) with <button onClick={buka} className="underline">Edit settings</button> — until then, matching with an adjustment is disabled for the missing type.
        </p>
      )}
    </div>
  );
}

// Ringkasan per rekening bank: saldo menurut rekening koran (baris mutasi terakhir yang
// ber-saldo di Bank Feed) vs saldo menurut buku (GL: transaksi posted, termasuk saldo awal).
// Selisih = mutasi yang belum dicocokkan/diposting, atau transaksi buku yang belum ada di bank.
function ReconciliationSummary({ accounts }: { accounts: BcOverviewAccount[] }) {
  const rekening = accounts.filter((a) => a.bank_balance !== null);
  const totalBank = rekening.reduce((n, a) => n + (a.bank_balance ?? 0), 0);
  const totalBuku = rekening.reduce((n, a) => n + a.book_balance, 0);
  const selisih = totalBank - totalBuku;
  const balance = Math.abs(selisih) < 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={SUM_CARD}>
          <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
          <div className={SUM_HEAD}><p className={SUM_LABEL}>Balance per Bank</p></div>
          <p className={SUM_VALUE}>{formatIDR(totalBank)}</p>
          <p className={SUM_SUB}>Latest bank statement balance in Source Data</p>
        </div>
        <div className={SUM_CARD}>
          <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
          <div className={SUM_HEAD}><p className={SUM_LABEL}>Balance per Books</p></div>
          <p className={SUM_VALUE}>{formatIDR(totalBuku)}</p>
          <p className={SUM_SUB}>Bank account balance in the ledger (posted transactions)</p>
        </div>
        <div className={SUM_CARD}>
          <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
          <div className={SUM_HEAD}>
            <p className={SUM_LABEL}>Difference</p>
            <span className={`${PILL} shrink-0 ${balance ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-amber-300 bg-amber-100 text-amber-900'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${balance ? 'bg-emerald-600' : 'bg-amber-600'}`} />{balance ? 'Balanced' : 'Unbalanced'}
            </span>
          </div>
          <p className={SUM_VALUE}>{formatIDR(selisih)}</p>
          <p className={SUM_SUB}>
            {balance ? 'BALANCED — bank balance equals book balance' : 'Match & post the lines below until the difference is 0'}
          </p>
        </div>
      </div>
      {rekening.length > 1 && (
        <div className="card overflow-hidden">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  <th className={`${TBL_TH} text-left`}>Account</th>
                  <th className={`${TBL_TH} text-right`}>Bank</th>
                  <th className={`${TBL_TH} text-right`}>Books</th>
                  <th className={`${TBL_TH} text-right`}>Difference</th>
                  <th className={`${TBL_TH} text-right`}>Unmatched</th>
                </tr>
              </thead>
              <tbody>
                {rekening.map((a) => {
                  const d = (a.bank_balance ?? 0) - a.book_balance;
                  return (
                    <tr key={a.id} className={TBL_ROW}>
                      <td className="px-2 py-2 text-neutral-900">{kodeAkun(a.code)} · {a.name}{a.bank_balance_date ? <span className="text-neutral-500"> · as of {a.bank_balance_date}</span> : null}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatIDR(a.bank_balance ?? 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatIDR(a.book_balance)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums font-semibold ${Math.abs(d) < 1 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatIDR(d)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{a.unmatched_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

// ---- Skor kecocokan invoice <-> baris bank terpilih (hanya untuk mengurutkan kolom kanan; pencocokan tetap divalidasi backend).
const normTeks = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const KATA_ABAIKAN = new Set(['pt', 'cv', 'ud', 'tbk', 'bank', 'trf', 'transfer', 'dari', 'ke', 'the', 'and', 'inv', 'invoice', 'pembayaran', 'bayar', 'payment']);

function skorInvoice(
  r: { id: string; no: string; pihak: string; sisa: number; dalamProses: number },
  m: { description: string; credit: number; debit: number },
  rankSaran: number | undefined,
): { skor: number; saran: boolean; pas: boolean; refHit: boolean } {
  const nominal = m.credit || m.debit;
  const tersedia = Math.max(r.sisa - r.dalamProses, 0);
  const pas = tersedia > 0.005 && Math.abs(tersedia - nominal) < 0.5;
  const ket = normTeks(m.description);
  const noNorm = normTeks(r.no);
  const refHit = noNorm.length >= 3 && ket.includes(noNorm);
  const kataPihak = normTeks(r.pihak).split(' ').filter((k) => k.length >= 3 && !KATA_ABAIKAN.has(k));
  const hitPihak = kataPihak.filter((k) => ket.includes(k)).length;
  let skor = 0;
  if (rankSaran !== undefined) skor += 1000 - rankSaran;
  if (pas) skor += 100;
  if (refHit) skor += 80;
  skor += Math.min(hitPihak, 4) * 10;
  if (tersedia <= 0.005) skor -= 500;
  return { skor, saran: rankSaran !== undefined, pas, refHit };
}

export default function ReconciliationPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { mutations, ignoreMutation } = useBankFeed();
  const { activeClientId } = useActiveClient();
  const { overview } = useBcOverview(activeClientId ? String(activeClientId) : null);
  const {
    saran, saranSelisih, pengaturanAdjustment, applying, pembayaran, loading, error, busy, autoRunning,
    cocokkan, catatNonInvoice, transfer, pasangkanTransfer, tautkanTransaksi, transferMenunggu, akunLawan, batalkan, autoCocokkan, terapkanSelisih, simpanPengaturanAdjustment, muatUlang,
    aturan, saranAturan, aturanPerMutasi, autoSetelahUpload, simpanAturan, hapusAturan, simpanAutoSetelahUpload,
    autoSettings, simpanAutoSettings,
  } = useBankReconciliation();
  const [tab, setTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');
  const [selectedMutation, setSelectedMutation] = useState<string | null>(null);
  // Naik 1 setiap kali user menekan "Rule" di sebuah baris -> AutoRulesPanel membuka form aturan dari baris itu.
  const [permintaanAturan, setPermintaanAturan] = useState(0);
  // Kolom kanan: daftar invoice posted dari halaman Purchase (Cash Payment) / Sales (Cash Receipt).
  const [sisiInvoice, setSisiInvoice] = useState<'payment' | 'receipt'>('payment');
  // Adjustment selisih kecil: kategori per saran (kiri) dan pilihan untuk pencocokan manual (kanan).
  const [kategoriSaran, setKategoriSaran] = useState<Record<string, AdjustmentCategory>>({});
  const [kategoriManual, setKategoriManual] = useState<AdjustmentCategory | null>(null);
  const [pakaiAdj, setPakaiAdj] = useState(true);
  // Kolom kanan: pencarian + tampilkan invoice lunas (default disembunyikan).
  const [cariInvoice, setCariInvoice] = useState('');
  const [tampilLunas, setTampilLunas] = useState(false);
  // Kolom kiri: pencarian baris bank + pilihan massal (checkbox).
  const [cariMutasi, setCariMutasi] = useState('');
  const [pilihMassal, setPilihMassal] = useState<Set<string>>(new Set());
  const [massalBusy, setMassalBusy] = useState(false);
  const batasAdj = pengaturanAdjustment?.enabled ? pengaturanAdjustment.limit : 0;
  const purchase = useCashPaymentsFromPurchase();
  const sales = useCashReceiptsFromSales();
  // Akun bank jurnal ditentukan backend dari label akun di tiap mutasi (dipilih saat upload di
  // Bank Feed) -- tidak ada lagi pilihan global di halaman ini.

  // [BARU] Dropdown akun bank (seperti Xero: selalu satu akun aktif). Akun yang bisa dipilih = akun bank
  // client aktif yang punya saldo rekening koran atau mutasi di Source Data. Default = akun dengan baris
  // belum cocok terbanyak. Kolom kiri, riwayat Reconciled, kartu saldo, dan Auto-match mengikuti akun ini.
  const [akunDipilih, setAkunDipilih] = useState<string | null>(null);
  useEffect(() => { setAkunDipilih(null); }, [activeClientId]); // ganti client -> kembali ke default

  const belumCocokPerAkun = useMemo(() => {
    const peta: Record<string, number> = {};
    for (const m of mutations) if (m.status === 'unmatched') peta[m.bankCoaId] = (peta[m.bankCoaId] ?? 0) + 1;
    return peta;
  }, [mutations]);

  const daftarAkunBank = useMemo(
    () => (overview?.accounts ?? []).filter(
      (a) => a.is_active && (a.cash_type === 'bank' || a.bank_balance !== null || mutations.some((m) => m.bankCoaId === a.id)),
    ),
    [overview?.accounts, mutations],
  );

  const akunAktif = useMemo(() => {
    if (daftarAkunBank.length === 0) return null;
    if (akunDipilih && daftarAkunBank.some((a) => a.id === akunDipilih)) return akunDipilih;
    return [...daftarAkunBank].sort((a, b) => (belumCocokPerAkun[b.id] ?? 0) - (belumCocokPerAkun[a.id] ?? 0))[0].id;
  }, [daftarAkunBank, akunDipilih, belumCocokPerAkun]);

  const mutasiAkun = useMemo(
    () => (akunAktif ? mutations.filter((m) => m.bankCoaId === akunAktif) : mutations),
    [mutations, akunAktif],
  );
  const unmatchedMutations = useMemo(() => mutasiAkun.filter((m) => m.status === 'unmatched'), [mutasiAkun]);
  const matchedMutations = useMemo(() => mutasiAkun.filter((m) => m.status === 'matched'), [mutasiAkun]);

  const mutasiTerpilih = useMemo(
    () => unmatchedMutations.find((m) => m.id === selectedMutation) || null,
    [unmatchedMutations, selectedMutation],
  );

  // Pencarian baris kiri (keterangan / nominal / tanggal).
  const mutasiTampil = useMemo(() => {
    const q = cariMutasi.trim().toLowerCase();
    if (!q) return unmatchedMutations;
    const qAngka = q.replace(/[^0-9]/g, '');
    return unmatchedMutations.filter((m) =>
      (m.description || '').toLowerCase().includes(q)
      || String(m.date).includes(q)
      || (qAngka.length >= 3 && String(Math.round(m.credit || m.debit)).includes(qAngka)),
    );
  }, [unmatchedMutations, cariMutasi]);

  // Pilihan massal hanya berlaku untuk baris yang masih unmatched & terlihat.
  const idMassal = useMemo(() => mutasiTampil.filter((m) => pilihMassal.has(m.id)).map((m) => m.id), [mutasiTampil, pilihMassal]);
  const semuaTerpilih = mutasiTampil.length > 0 && idMassal.length === mutasiTampil.length;
  const togglePilih = (id: string) => setPilihMassal((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const togglePilihSemua = () => setPilihMassal((prev) => {
    const n = new Set(prev);
    if (semuaTerpilih) mutasiTampil.forEach((m) => n.delete(m.id));
    else mutasiTampil.forEach((m) => n.add(m.id));
    return n;
  });
  useEffect(() => { setPilihMassal(new Set()); }, [akunAktif, activeClientId]);

  // Mutasi berselisih kecil yang bisa langsung diterapkan sekaligus (akun selisih sudah diatur, baris sudah di-review).
  const siapSelisih = useMemo(
    () => unmatchedMutations.filter((m) => m.confidence !== 'low' && saranSelisih[m.id]?.adjustment?.ready),
    [unmatchedMutations, saranSelisih],
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
  // Peringkat invoice yang disarankan backend untuk baris terpilih (0 = teratas).
  const rankSaran = useMemo(() => {
    const peta = new Map<string, number>();
    if (!mutasiTerpilih) return peta;
    (saran[mutasiTerpilih.id]?.candidates ?? []).forEach((c, i) => {
      c.allocations.forEach((a) => { if (a.invoice_id && !peta.has(a.invoice_id)) peta.set(a.invoice_id, i); });
    });
    return peta;
  }, [mutasiTerpilih, saran]);

  const sisiBarisSesuai = mutasiTerpilih ? (mutasiTerpilih.credit ? 'receipt' : 'payment') === sisiInvoice : false;

  const jumlahTerbuka = useMemo(() => daftarInvoice.filter((r) => r.sisa > 0.005).length, [daftarInvoice]);

  // Sembunyikan invoice lunas, cari, lalu urutkan menurut kecocokan dengan baris terpilih.
  const invoiceTampil = useMemo(() => {
    const q = cariInvoice.trim().toLowerCase();
    const qAngka = q.replace(/[^0-9]/g, '');
    const hasil = daftarInvoice
      .filter((r) => tampilLunas || r.sisa > 0.005)
      .filter((r) => !q
        || (r.no || '').toLowerCase().includes(q)
        || (r.pihak || '').toLowerCase().includes(q)
        || String(r.tanggal).includes(q)
        || (qAngka.length >= 3 && (String(Math.round(r.total)).includes(qAngka) || String(Math.round(r.sisa)).includes(qAngka))))
      .map((r, i) => ({
        r, i,
        info: mutasiTerpilih && sisiBarisSesuai
          ? skorInvoice(r, mutasiTerpilih, rankSaran.get(r.id))
          : { skor: r.sisa > 0.005 ? 0 : -500, saran: false, pas: false, refHit: false },
      }));
    hasil.sort((a, b) => (b.info.skor - a.info.skor) || (a.i - b.i)); // seri: urutan awal (tanggal terbaru)
    return hasil;
  }, [daftarInvoice, tampilLunas, cariInvoice, mutasiTerpilih, sisiBarisSesuai, rankSaran]);

  const loadingInvoice = sisiInvoice === 'payment' ? purchase.loading : sales.loading;
  const errorInvoice = sisiInvoice === 'payment' ? purchase.error : sales.error;

  const handleMatch = async (
    mutationId: string, kandidat: SaranKandidat,
    adjustment?: { category: AdjustmentCategory } | null, jumlahAdj?: number,
  ) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await cocokkan(m, kandidat, adjustment ?? null);
      setSelectedMutation(null);
      toast.success(
        adjustment
          ? `Matched with ${namaKandidat(kandidat)}${jumlahAdj ? ` — ${rp(jumlahAdj)} booked as ${ADJUSTMENT_CATEGORY_LABEL[adjustment.category]}` : ''}. Journal saved as DRAFT.`
          : `Matched with ${namaKandidat(kandidat)}. Journal saved as DRAFT.`,
      );
    } catch (e: any) {
      // Pesan backend sudah jelas (di atas batas / akun belum diatur / adjustment dimatikan / ...).
      const kode = e instanceof BankCashError ? e.code : undefined;
      toast.error(e?.message || 'Failed to match the bank line.', {
        description: kode === 'ALLOCATION_MISMATCH' ? 'The amounts differ. Settle the invoice partially, or record the line without an invoice.' : undefined,
      });
    }
  };

  // Cocokkan manual: mutasi terpilih di kiri + invoice yang diklik di kanan. Nominal alokasi = nominal
  // mutasi (backend menolak kalau total alokasi != nominal mutasi), jadi invoice harus punya sisa >= nominal.
  // Kalau selisih kecil (<= batas) dan `adj` diberikan: invoice dilunasi PENUH (alokasi = sisa tagihan) dan
  // selisihnya jadi baris adjustment di jurnal yang sama. Tanpa `adj`: alokasi = nominal mutasi (partial / pas).
  const handleMatchInvoice = async (
    r: { id: string; no: string; pihak: string; sisa: number; dalamProses: number },
    adj: ReturnType<typeof hitungAdjustment>,
  ) => {
    if (!mutasiTerpilih) return;
    const nominal = mutasiTerpilih.credit || mutasiTerpilih.debit;
    const tersedia = Math.max(r.sisa - r.dalamProses, 0);
    await handleMatch(mutasiTerpilih.id, {
      kind: adj ? 'single_adjust' : 'single',
      exact: Math.abs(r.sisa - nominal) < 0.5,
      ref_hit: false,
      party_ratio: 0,
      score: 0,
      allocations: [{
        type: sisiInvoice === 'payment' ? 'purchase' : 'sales_invoice',
        invoice_id: r.id, invoice_no: r.no || null, party: r.pihak || null, outstanding: r.sisa,
        amount: adj ? tersedia : nominal,
      }],
    }, adj ? { category: kategoriManual ?? kategoriBawaan(adj.type) } : null, adj?.amount);
  };

  const handleApplyAll = async () => {
    if (siapSelisih.length === 0) return;
    const total = siapSelisih.reduce((n, m) => n + (saranSelisih[m.id]?.adjustment?.amount ?? 0), 0);
    const ok = window.confirm(
      `Match ${siapSelisih.length} line(s) that differ slightly from an invoice?\n\n`
      + `Total difference booked as adjustment: ${rp(total)}.\n`
      + 'The top suggestion of each line is used with its default category. Journals are saved as DRAFT and can be reviewed before posting.',
    );
    if (!ok) return;
    try {
      const r = await terapkanSelisih(siapSelisih.map((m) => m.id));
      toast.success(`${r.done.length} line(s) matched with an adjustment${r.failed.length ? `, ${r.failed.length} skipped` : ''}.`, {
        description: r.failed[0]?.reason,
      });
    } catch (e: any) {
      const detail = e instanceof BankCashError && Array.isArray(e.detail) ? (e.detail as { reason?: string }[])[0]?.reason : undefined;
      toast.error(e?.message || 'Failed to apply the adjustments.', { description: detail });
    }
  };

  const handleNonInvoice = async (mutationId: string, kategori: string, baris: BarisLawanInput[]) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    await catatNonInvoice(m, kategori, baris); // error dilempar ke form supaya tampil di sana
    setSelectedMutation(null);
    toast.success(`${kategori} recorded as a DRAFT journal — continue with Approve in Journal Preview.`);
  };

  // [BARU] Transfer antar akun bank (ala Xero): dicatat sekali dari salah satu akun, akun lawan ikut tertaut.
  const [akunTransfer, setAkunTransfer] = useState<Record<string, string>>({});
  const akunKasLain = (m: { bankCoaId: string }) => (overview?.accounts ?? []).filter((a) => a.id !== m.bankCoaId && a.is_active);
  const transferMenungguUntuk = (m: { bankCoaId: string; credit: number; debit: number }) =>
    transferMenunggu.find((t) =>
      t.to_bank_coa_id === m.bankCoaId
      && Math.abs(t.amount - (m.credit || m.debit)) < 0.5
      && (t.needs === 'credit') === (m.credit > 0));

  const handleTransfer = async (mutationId: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    const tujuan = akunTransfer[mutationId];
    if (!m || !tujuan) { toast.error('Choose the other bank account first.'); return; }
    try {
      const hasil = await transfer(m, tujuan);
      toast.success(
        hasil.paired_mutation_id
          ? 'Transfer recorded and the matching line in the other account was paired. Journal saved as DRAFT.'
          : 'Transfer recorded as DRAFT. When the other account’s line is uploaded, pair it from that account.',
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to record the transfer.');
    }
  };

  const handlePasangkan = async (mutationId: string, transactionId: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await pasangkanTransfer(m, transactionId);
      toast.success('Paired with the transfer. No new journal was created.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to pair the transfer.');
    }
  };

  // Rekonsiliasi manual ke transaksi buku yang sudah dicatat (tanpa jurnal baru).
  const handleTautkan = async (mutationId: string, transactionId: string, txNumber: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await tautkanTransaksi(m, transactionId);
      toast.success(`Reconciled with ${txNumber}. No new journal was created.`);
      setSelectedMutation(null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reconcile the bank line.');
    }
  };

  const handleUnmatch = async (mutationId: string) => {
    const m = mutations.find((x) => x.id === mutationId);
    if (!m) return;
    try {
      await batalkan(m);
      toast.success('Match removed.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove the match.');
    }
  };

  const handleIgnore = async (mutationId: string) => {
    const alasan = window.prompt('Ignore this line (not a transaction to be recorded)? Reason (optional):', '');
    if (alasan === null) return;
    try {
      await ignoreMutation(mutationId, alasan);
      toast.success('Line ignored. You can restore it from the Source Data tab.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to ignore the line.');
    }
  };

  // Aksi massal: Ignore banyak baris sekaligus (satu alasan untuk semua). Tidak membuat jurnal apa pun.
  const handleIgnoreMassal = async () => {
    if (idMassal.length === 0) return;
    const alasan = window.prompt(`Ignore ${idMassal.length} selected line(s)? Reason for all (optional):`, '');
    if (alasan === null) return;
    setMassalBusy(true);
    let ok = 0;
    let gagalPertama = '';
    for (const id of idMassal) {
      try { await ignoreMutation(id, alasan); ok += 1; } catch (e: any) { gagalPertama = gagalPertama || e?.message || 'Failed.'; }
    }
    setMassalBusy(false);
    setPilihMassal(new Set());
    setSelectedMutation(null);
    const gagalN = idMassal.length - ok;
    if (gagalN === 0) toast.success(`${ok} line(s) ignored. You can restore them from the Source Data tab.`);
    else toast.error(`${ok} line(s) ignored, ${gagalN} failed.`, { description: gagalPertama });
  };

  // Aturan dibuat dari baris pertama yang dipilih (aturan berbasis kata kunci, jadi berlaku untuk semua baris serupa).
  const handleRuleMassal = () => {
    if (idMassal.length === 0) return;
    setSelectedMutation(idMassal[0]);
    setPermintaanAturan((n) => n + 1);
  };

  const handleAuto = async () => {
    try {
      const r = await autoCocokkan(akunAktif);
      // Catatan tambahan sesuai pengaturan Auto-match (jenis yang dimatikan, baris confidence rendah).
      const catatan: string[] = [];
      if (r.skippedBySetting > 0) catatan.push(`${r.skippedBySetting} line(s) have a sure invoice match but that auto-match type is turned off, so they stay for manual review.`);
      if (r.lowSkipped > 0) catatan.push(`${r.lowSkipped} low-confidence line(s) were skipped until reviewed in the Bank Feed tab (or turn on “Include low-confidence lines”).`);
      if (r.lowMatched > 0) catatan.push(`${r.lowMatched} low-confidence line(s) were matched as DRAFT only — please double-check them.`);
      if (r.matched + r.ruleMatched === 0) {
        toast.info('Nothing could be matched automatically.', {
          description: [`${r.unmatched + r.lowSkipped} line(s) need manual review. Match them to an invoice, or create an auto rule from a line with the “Rule” button.`, ...catatan].join(' '),
        });
        return;
      }
      toast.success(
        `${r.matched} matched to invoices, ${r.ruleMatched} recorded by auto rules, ${r.unmatched} need manual review (see also the Exceptions tab).`,
        {
          description: [
            r.autoApproved > 0
              ? `${r.autoApproved} auto-approved; the rest are saved as DRAFT. Post is always manual in Journal Preview.`
              : 'Matched lines are saved as DRAFT journals — review and post them in Journal Preview.',
            ...catatan,
          ].join(' '),
        },
      );
    } catch (e: any) {
      toast.error(e?.message || 'Auto-match failed.');
    }
  };

  return (
    <div className="space-y-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">Error:</span>
          <span>{error}</span>
          <button onClick={muatUlang} className="ml-auto shrink-0 font-medium underline">Retry</button>
        </div>
      )}

      <ReconciliationSummary accounts={(overview?.accounts ?? []).filter((a) => !akunAktif || a.id === akunAktif)} />

      <AdjustmentPanel
        settings={pengaturanAdjustment}
        ringkasan={overview?.adjustments}
        akun={akunLawan}
        onSave={simpanPengaturanAdjustment}
      />

      <AutoRulesPanel
        aturan={aturan}
        saran={saranAturan}
        akun={akunLawan}
        autoSetelahUpload={autoSetelahUpload}
        pengaturan={autoSettings}
        onUbahPengaturan={simpanAutoSettings}
        mutasiTerpilih={mutasiTerpilih}
        permintaanBuka={permintaanAturan}
        onSave={simpanAturan}
        onDelete={hapusAturan}
        onToggleUpload={simpanAutoSetelahUpload}
      />

      {daftarAkunBank.length === 0 && (
        <p className="text-xs text-neutral-500">
          Bank account selector: no bank account found for this client yet. Add one in Chart of Accounts (Cash &amp; Cash Equivalents) or upload a statement in Source Data.
        </p>
      )}
      {daftarAkunBank.length > 0 && akunAktif && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="rekon-akun-bank" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Bank account</label>
          <select
            id="rekon-akun-bank"
            value={akunAktif}
            onChange={(e) => { setAkunDipilih(e.target.value); setSelectedMutation(null); }}
            className="min-w-[260px] rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm focus:border-neutral-800 focus:outline-none"
          >
            {daftarAkunBank.map((a) => (
              <option key={a.id} value={a.id}>
                {kodeAkun(a.code)} · {a.name} ({belumCocokPerAkun[a.id] ?? 0} to reconcile)
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500">Only this account’s Source Data lines are shown and matched below.</span>
        </div>
      )}

      <div className="flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {(['unreconciled', 'reconciled'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={SUB_TAB(tab === t)}
            >
              {t === 'unreconciled' ? `Unreconciled (${unmatchedMutations.length})` : `Reconciled (${matchedMutations.length})`}
            </button>
          ))}
        </nav>
        {tab === 'unreconciled' && (
          <div className="mb-2 flex flex-wrap items-center gap-2 lg:mb-0">
            {siapSelisih.length > 0 && (
              <button
                onClick={handleApplyAll}
                disabled={applying || autoRunning || loading}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Match all lines that differ slightly from an invoice (within the limit), booking the difference as an adjustment. You are asked to confirm first."
              >
                <Scale size={13} />
                {applying ? 'Applying…' : `Apply adjustments (${siapSelisih.length})`}
              </button>
            )}
            <button
              onClick={handleAuto}
              disabled={autoRunning || applying || loading || unmatchedMutations.length === 0}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Automatically match certain lines (exact amount + invoice number/party name, no competing candidate) and record lines that fit an Auto rule (e.g. bank admin fee). Lines with an invoice difference are never auto-matched. The rest is logged in Exceptions."
            >
              <Zap size={13} />
              {autoRunning ? 'Matching…' : 'Auto-match'}
            </button>
          </div>
        )}
      </div>

      {loading && mutations.length === 0 ? (
        <p className="py-12 text-center text-xs text-neutral-500">Loading reconciliation data...</p>
      ) : tab === 'unreconciled' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Kolom kiri — mutasi Bank Feed belum cocok */}
          <div className="card-elevated-md overflow-hidden rounded-xl">
            <div className="border-b border-neutral-200 px-5 pt-5 pb-1">
              <SalesCardHeader
                neutral
                icon={Database}
                title="Source Data — Unmatched"
                subtitle="Use Match / Auto-match, or click a line to match it to an invoice or record it without one"
              />
            </div>
            {unmatchedMutations.length > 0 && (
              <div className="space-y-2 border-b border-neutral-200 px-5 py-2.5">
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={cariMutasi}
                    onChange={(e) => setCariMutasi(e.target.value)}
                    placeholder="Search description, amount or date…"
                    className="w-full rounded-md border border-neutral-300 bg-white py-1.5 pl-8 pr-2 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-700">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" checked={semuaTerpilih} onChange={togglePilihSemua} disabled={mutasiTampil.length === 0 || massalBusy} />
                    {idMassal.length > 0 ? `${idMassal.length} selected` : `Select all${cariMutasi.trim() ? ' (filtered)' : ''} (${mutasiTampil.length})`}
                  </label>
                  {idMassal.length > 0 && (
                    <>
                      <button
                        onClick={handleIgnoreMassal}
                        disabled={massalBusy}
                        className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                        title="Ignore all selected lines (no journal is created; restorable from Source Data)"
                      >
                        <EyeOff size={12} /> {massalBusy ? 'Ignoring…' : `Ignore selected (${idMassal.length})`}
                      </button>
                      <button
                        onClick={handleRuleMassal}
                        disabled={massalBusy}
                        className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                        title="Open the Auto rule form prefilled from the first selected line. The rule is keyword-based, so it applies to similar lines too."
                      >
                        <Wand2 size={12} /> Rule from first selected
                      </button>
                      <button onClick={() => setPilihMassal(new Set())} className="text-neutral-500 underline hover:text-neutral-900">Clear</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {unmatchedMutations.length === 0 ? (
              <p className="py-10 text-center text-xs text-neutral-500">No Source Data lines waiting.</p>
            ) : mutasiTampil.length === 0 ? (
              <p className="py-10 text-center text-xs text-neutral-500">No lines match “{cariMutasi}”.</p>
            ) : (
              <div className="scrollbar-thin max-h-[520px] divide-y divide-neutral-400 overflow-y-auto">
                {mutasiTampil.map((m) => {
                  const s = saran[m.id];
                  const auto = s?.auto_match ? s.candidates[0] : null;
                  const adjCand = !auto ? saranSelisih[m.id] ?? null : null;
                  const adjInfo = adjCand?.adjustment;
                  const adjKategori = kategoriSaran[m.id] ?? adjInfo?.suggested_category ?? 'bank_fee';
                  const adjKatInfo = adjInfo?.by_category?.[adjKategori];
                  const adjReady = adjKatInfo ? adjKatInfo.ready : !!adjInfo?.ready;
                  const adjAkun = adjKatInfo ? adjKatInfo.account : adjInfo?.account ?? null;
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
                      className={`group px-5 py-2.5 transition-colors ${isBusy ? 'cursor-wait opacity-60' : 'cursor-pointer'} ${selected ? 'bg-neutral-100 shadow-[inset_3px_0_0_#262626]' : 'hover:bg-neutral-50'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="checkbox"
                          checked={pilihMassal.has(m.id)}
                          onChange={() => togglePilih(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={isBusy || massalBusy}
                          aria-label="Select line"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-neutral-900">{m.description}</p>
                          <p className="text-[11px] text-neutral-500">
                            {m.date} · {m.bankAccount} · {m.credit ? 'In (Sales / other)' : 'Out (Purchase / other)'}
                          </p>
                          {m.confidence === 'low' && (
                            <p className="text-[11px] text-red-700" title={m.confidenceNotes.join('\n')}>
                              Needs review — the amount may be misread. Check it in the Source Data tab (skipped by auto-match).
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-neutral-900">
                            {rp(m.credit || m.debit)}
                          </span>
                          <span className={`${PILL} !py-0 ${m.credit ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-rose-300 bg-rose-100 text-rose-800'}`}>
                            {m.credit ? 'In' : 'Out'}
                          </span>
                        </div>
                      </div>
                      {!auto && !adjCand && aturanPerMutasi[m.id] && (
                        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-2.5 py-1.5 text-[11px] text-neutral-700">
                          <Wand2 size={12} className="shrink-0" />
                          <span className="truncate">
                            Auto rule “{aturanPerMutasi[m.id].rule_name}” → {aturanPerMutasi[m.id].account_code ? kodeAkun(aturanPerMutasi[m.id].account_code as string) : ''} {aturanPerMutasi[m.id].account_name} · {aturanPerMutasi[m.id].will_approve ? 'auto-approved' : 'saved as draft'}, {autoSetelahUpload ? 'recorded automatically after the next upload or invoice posting, or when you press Auto-match' : 'recorded when you press Auto-match'}
                          </span>
                        </div>
                      )}
                      {auto && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-2.5 py-1.5">
                          <span className="truncate text-[11px] text-neutral-700">Candidate: {namaKandidat(auto)} · {pihakKandidat(auto)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMatch(m.id, auto); }}
                            disabled={isBusy}
                            className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Link2 size={11} /> Match
                          </button>
                        </div>
                      )}
                      {(() => {
                        const menunggu = transferMenungguUntuk(m);
                        const pilihan = akunKasLain(m);
                        if (menunggu) {
                          return (
                            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-neutral-300 border-l-[3px] border-l-sky-600 bg-sky-50 px-2.5 py-1.5">
                              <span className="truncate text-[11px] text-neutral-700">
                                Transfer {m.credit ? 'from' : 'to'} {menunggu.from_account_code ? kodeAkun(menunggu.from_account_code) : ''} {menunggu.from_account_name ?? ''} · {menunggu.tx_number}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handlePasangkan(m.id, menunggu.transaction_id); }}
                                disabled={isBusy}
                                className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                                title="Pair this line with the transfer already recorded from the other account (no new journal)"
                              >
                                <Link2 size={11} /> Pair
                              </button>
                            </div>
                          );
                        }
                        if (auto || adjCand) return null;
                        if (pilihan.length === 0) {
                          if (!selected) return null;
                          return (
                            <p onClick={(e) => e.stopPropagation()} className="mt-2 text-[11px] text-neutral-500">
                              Transfer between accounts needs a second bank or cash account for this client (add it in Chart of Accounts).
                            </p>
                          );
                        }
                        return (
                          <div onClick={(e) => e.stopPropagation()} className={`mt-2 flex-wrap items-center gap-2 ${selected || akunTransfer[m.id] ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
                            <select
                              value={akunTransfer[m.id] ?? ''}
                              onChange={(e) => setAkunTransfer((prev) => ({ ...prev, [m.id]: e.target.value }))}
                              disabled={isBusy}
                              className={SELECT_CLS}
                              aria-label={m.credit ? 'Transfer from account' : 'Transfer to account'}
                            >
                              <option value="">{m.credit ? 'Transfer from…' : 'Transfer to…'}</option>
                              {pilihan.map((a) => <option key={a.id} value={a.id}>{kodeAkun(a.code)} · {a.name}</option>)}
                            </select>
                            <button
                              onClick={() => handleTransfer(m.id)}
                              disabled={isBusy || !akunTransfer[m.id]}
                              className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Record this line as a transfer between your own bank accounts (one journal; the other account’s line is paired automatically)"
                            >
                              <Link2 size={11} /> Transfer
                            </button>
                          </div>
                        );
                      })()}
                      {adjCand && adjInfo && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 space-y-1.5 rounded-lg border border-amber-300 border-l-[3px] border-l-amber-500 bg-amber-50 px-2.5 py-2"
                        >
                          <p className="truncate text-[11px] text-neutral-800">
                            Candidate: {namaKandidat(adjCand)} · {pihakKandidat(adjCand)}
                          </p>
                          <p className="text-[11px] font-medium text-amber-900">
                            Difference {rp(adjInfo.amount)} — add an adjustment?{' '}
                            <span className="font-normal text-neutral-700">
                              ({adjInfo.type === 'expense' ? 'booked as expense' : 'booked as income'}
                              {adjAkun ? ` to ${kodeAkun(adjAkun.code)} · ${adjAkun.name}` : ''})
                            </span>
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={adjKategori}
                              onChange={(e) => setKategoriSaran((prev) => ({ ...prev, [m.id]: e.target.value as AdjustmentCategory }))}
                              disabled={isBusy}
                              className={SELECT_CLS}
                              aria-label="Adjustment category"
                            >
                              {KATEGORI_PILIHAN.map((k) => <option key={k} value={k}>{ADJUSTMENT_CATEGORY_LABEL[k]}</option>)}
                            </select>
                            <button
                              onClick={() => handleMatch(m.id, adjCand, { category: adjKategori }, adjInfo.amount)}
                              disabled={isBusy || !adjReady}
                              className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              title={adjReady ? 'Match and book the difference as an adjustment' : 'Set the adjustment account in Settings first'}
                            >
                              <Link2 size={11} /> Match + adjustment
                            </button>
                          </div>
                          {!adjReady && (
                            <p className="text-[11px] font-medium text-red-700">
                              Set the bank adjustment {ADJUSTMENT_CATEGORY_LABEL[adjKategori]} or {adjInfo.type} account in{' '}
                              <Link href="/settings/account-mapping" className="underline">Settings › Account Mapping</Link> first.
                            </p>
                          )}
                        </div>
                      )}
                      <div className={`mt-1 items-center justify-end gap-3 ${selected ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
                        {!auto && !adjCand && !aturanPerMutasi[m.id] && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedMutation(m.id); setPermintaanAturan((n) => n + 1); }}
                            disabled={isBusy}
                            className="flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-900 disabled:opacity-50"
                            title="Create an auto rule from this line (e.g. a recurring bank admin fee)"
                          >
                            <Wand2 size={12} /> Rule
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleIgnore(m.id); }}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-900 disabled:opacity-50"
                          title="Ignore this line (e.g. a balance line / a transaction that should not be recorded)"
                        >
                          <EyeOff size={12} /> Ignore
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Kolom kanan — invoice posted dari Purchase (Cash Payment) & Sales (Cash Receipt), selalu tampil */}
          <div className="card-elevated-md overflow-hidden rounded-xl">
            <div className="border-b border-neutral-200 px-5 pt-5 pb-4">
              <SalesCardHeader
                neutral
                icon={FileText}
                title="Posted Invoices — Payables & Receivables"
                subtitle={sisiInvoice === 'payment'
                  ? 'Posted Purchase invoices (same as the Payables tab)'
                  : 'Posted Sales invoices (same as the Receivables tab)'}
              />
              <div className="flex items-start gap-2 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                <Info size={14} className="mt-px shrink-0 text-neutral-700" />
                <p className="leading-relaxed">
                  {mutasiTerpilih
                    ? `Selected line: ${rp(mutasiTerpilih.credit || mutasiTerpilih.debit)} (${mutasiTerpilih.credit ? 'in' : 'out'}). Click an invoice to match it.`
                    : 'Select a line on the left, then click an invoice here to match it.'}
                </p>
              </div>
              {mutasiTerpilih && batasAdj > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[11px] text-neutral-800">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={pakaiAdj} onChange={(e) => setPakaiAdj(e.target.checked)} />
                    Settle differences up to <span className="font-semibold tabular-nums">{rp(batasAdj)}</span> with an adjustment
                  </label>
                  {pakaiAdj && (
                    <label className="flex items-center gap-1.5">
                      Category
                      <select
                        value={kategoriManual ?? ''}
                        onChange={(e) => setKategoriManual((e.target.value || null) as AdjustmentCategory | null)}
                        className={SELECT_CLS}
                      >
                        <option value="">Auto (bank fee / rounding)</option>
                        {KATEGORI_PILIHAN.map((k) => <option key={k} value={k}>{ADJUSTMENT_CATEGORY_LABEL[k]}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              <div className="mt-3 flex w-fit items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-100 p-1">
                {([
                  ['payment', `Payables (${purchase.rows.filter((x) => x.outstanding > 0.005).length})`],
                  ['receipt', `Receivables (${sales.rows.filter((x) => x.outstanding > 0.005).length})`],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSisiInvoice(k)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      sisiInvoice === k ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={cariInvoice}
                    onChange={(e) => setCariInvoice(e.target.value)}
                    placeholder="Search invoice no., party, date or amount…"
                    className="w-full rounded-md border border-neutral-300 bg-white py-1.5 pl-8 pr-2 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-700">
                  <input type="checkbox" checked={tampilLunas} onChange={(e) => setTampilLunas(e.target.checked)} />
                  Show paid invoices
                </label>
              </div>
              {mutasiTerpilih && sisiBarisSesuai && (
                <p className="mt-2 text-[11px] text-neutral-500">Sorted by best match to the selected line (suggested, exact amount, invoice no. / party name in the description).</p>
              )}
            </div>
            {mutasiTerpilih && (
              <div className="space-y-3 border-b border-neutral-200 p-3">
                <BookMatchPanel
                  key={`book-${mutasiTerpilih.id}`}
                  clientId={activeClientId ? String(activeClientId) : null}
                  mutationId={mutasiTerpilih.id}
                  nominal={mutasiTerpilih.credit || mutasiTerpilih.debit}
                  busy={busy.has(mutasiTerpilih.id)}
                  onLink={(txId, txNo) => handleTautkan(mutasiTerpilih.id, txId, txNo)}
                />
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
              <p className="px-6 py-10 text-center text-xs text-red-700">{errorInvoice}</p>
            ) : loadingInvoice && daftarInvoice.length === 0 ? (
              <p className="py-10 text-center text-xs text-neutral-500">Loading invoices…</p>
            ) : daftarInvoice.length === 0 ? (
              <p className="px-6 py-10 text-center text-xs text-neutral-500">
                {sisiInvoice === 'payment'
                  ? 'No posted Purchase invoices for this company yet.'
                  : 'No posted Sales invoices for this company yet.'}
              </p>
            ) : invoiceTampil.length === 0 ? (
              <p className="px-6 py-10 text-center text-xs text-neutral-500">
                {cariInvoice.trim()
                  ? `No invoices match “${cariInvoice}”.`
                  : jumlahTerbuka === 0 ? 'All invoices on this side are paid. Tick “Show paid invoices” to see them.' : 'Nothing to show.'}
              </p>
            ) : (
              <div className="scrollbar-thin max-h-[520px] divide-y divide-neutral-400 overflow-y-auto">
                {invoiceTampil.map(({ r, info }) => {
                  const nominalTerpilih = mutasiTerpilih ? mutasiTerpilih.credit || mutasiTerpilih.debit : 0;
                  const sisiSesuai = mutasiTerpilih ? (mutasiTerpilih.credit ? 'receipt' : 'payment') === sisiInvoice : false;
                  const tersedia = Math.max(r.sisa - r.dalamProses, 0);
                  const cukup = tersedia + 0.5 >= nominalTerpilih;
                  // Selisih kecil (<= batas) antara sisa tagihan dan nominal mutasi, dua arah.
                  const selisihAdj = mutasiTerpilih && sisiSesuai ? Math.abs(nominalTerpilih - tersedia) : 0;
                  const kecil = pakaiAdj && batasAdj > 0 && tersedia > 0.005 && selisihAdj > 0.5 && selisihAdj <= batasAdj + 0.001;
                  const adjRow = kecil ? hitungAdjustment(sisiInvoice, tersedia, nominalTerpilih) : null;
                  const adjSiap = !!adjRow && (!!pengaturanAdjustment?.ready[adjRow.type]
                    || !!pengaturanAdjustment?.category_accounts?.[kategoriManual ?? kategoriBawaan(adjRow.type)]);
                  const lewatAdj = adjRow && adjSiap ? adjRow : null;
                  const bisa = !!mutasiTerpilih && sisiSesuai && (cukup || !!lewatAdj);
                  const isBusy = !!mutasiTerpilih && busy.has(mutasiTerpilih.id);
                  const alasan = !mutasiTerpilih
                    ? ''
                    : !sisiSesuai
                      ? mutasiTerpilih.credit ? 'Incoming line: pick an invoice in the Receivables tab' : 'Outgoing line: pick an invoice in the Payables tab'
                      : lewatAdj
                        ? `Click to match — the ${rp(lewatAdj.amount)} difference is booked as an adjustment`
                        : adjRow && !adjSiap
                          ? 'Set the bank adjustment account in Settings › Account Mapping to settle this small difference'
                          : !cukup
                            ? 'Invoice outstanding is smaller than the line amount'
                            : 'Click to match';
                  return (
                    <div
                      key={r.id}
                      title={alasan}
                      onClick={() => bisa && !isBusy && handleMatchInvoice(r, lewatAdj)}
                      className={`flex items-center justify-between gap-3 px-5 py-3 transition-colors ${
                        !mutasiTerpilih ? '' : bisa ? (isBusy ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-neutral-100') : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-blue-700">
                          <span className="truncate">{r.no || '—'}</span>
                          {info.saran && (
                            <span className={`${PILL} shrink-0 !py-0 border-emerald-300 bg-emerald-100 text-emerald-800`}><Sparkles size={10} /> Suggested</span>
                          )}
                          {!info.saran && info.pas && (
                            <span className={`${PILL} shrink-0 !py-0 border-sky-300 bg-sky-100 text-sky-800`}>Exact amount</span>
                          )}
                          {!info.saran && !info.pas && info.refHit && (
                            <span className={`${PILL} shrink-0 !py-0 border-neutral-300 bg-neutral-100 text-neutral-700`}>No. in description</span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-neutral-500">
                          {r.pihak || '—'} · {r.tanggal}
                          {r.jatuhTempo ? ` · due ${r.jatuhTempo}` : ''}
                          {r.overdue ? ' · overdue' : ''}
                        </p>
                      </div>
                      <div className="whitespace-nowrap text-right">
                        <p className="text-xs font-semibold tabular-nums text-neutral-900">{rp(r.total)}</p>
                        <p className={`text-[11px] font-medium ${r.sisa > 0.005 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {r.sisa > 0.005 ? `Outstanding ${rp(r.sisa)}` : 'Paid'}
                          {r.dalamProses > 0.005 ? ` · in process ${rp(r.dalamProses)}` : ''}
                        </p>
                        {lewatAdj && (
                          <p className="text-[11px] font-medium text-amber-800">
                            Difference {rp(lewatAdj.amount)} → {ADJUSTMENT_CATEGORY_LABEL[kategoriManual ?? kategoriBawaan(lewatAdj.type)]}
                          </p>
                        )}
                        {adjRow && !adjSiap && (
                          <p className="text-[11px] font-medium text-red-700">Adjustment account not set</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-border px-0 py-3">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Reconciled History</h3>
            <p className="mt-0.5 text-sm text-neutral-500">{matchedMutations.length} matched Source Data lines</p>
          </div>
          {matchedMutations.length === 0 ? (
            <p className="py-10 text-center text-xs text-neutral-500">No matched lines yet.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[1050px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    {['Date', 'Source Data Line', 'Matched With', 'Amount', 'Adjustment', 'Journal', 'Status', ''].map((h) => (
                      <th key={h || 'act'} className={`${TBL_TH} ${h === 'Amount' || h === 'Adjustment' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchedMutations.map((m) => {
                    const p = pembayaran[m.id];
                    const terposting = m.transaction?.status === 'posted';
                    const isBusy = busy.has(m.id);
                    return (
                      <tr key={m.id} className={TBL_ROW}>
                        <td className="whitespace-nowrap px-2 py-2 text-foreground">{m.date}</td>
                        <td className="max-w-[200px] truncate px-2 py-2 text-neutral-900">{m.description}</td>
                        <td className="max-w-[220px] truncate px-2 py-2 font-medium text-blue-700">
                          {!p && m.transaction
                            ? `${m.transaction.category || 'Transfer'}${m.transaction.counterparty ? ` · ${m.transaction.counterparty}` : ''}`
                            : p
                            ? p.nonInvoice
                              ? `No invoice · ${p.party || '—'}`
                              : `${p.invoices.join(', ') || '—'}${p.party ? ` · ${p.party}` : ''}`
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{rp(m.credit || m.debit)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                          {p?.adjustment ? (
                            <span
                              className="font-medium text-amber-800"
                              title={`${p.adjustment.category_label ?? 'Adjustment'} → ${kodeAkun(p.adjustment.account_code)} · ${p.adjustment.account_name} (${p.adjustment.type === 'expense' ? 'expense' : 'income'})`}
                            >
                              {rp(p.adjustment.amount)}
                              <span className="font-normal text-neutral-500"> · {p.adjustment.category_label ?? 'Adjustment'}</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-blue-700">
                          {p?.journalNo ? `${p.journalNo}${p.journalStatus ? ` (${p.journalStatus})` : ''}` : m.transaction?.tx_number ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <span className={`${PILL} ${terposting ? 'border-teal-300 bg-teal-100 text-teal-800' : 'border-blue-300 bg-blue-100 text-blue-800'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${terposting ? 'bg-teal-600' : 'bg-blue-600'}`} />
                            {m.transaction ? TX_STATUS_LABEL[m.transaction.status as TxStatus] : 'Reconciled'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          <button
                            onClick={() => handleUnmatch(m.id)}
                            disabled={isBusy || terposting}
                            className="rounded-lg border border-neutral-300 bg-card p-1.5 text-neutral-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            title={terposting ? 'Already posted — reverse the transaction from the Posted tab' : 'Remove match'}
                          >
                            <X size={13} />
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