'use client';
// [BARU] Sumber data transaksi TUNGGAL untuk seluruh halaman Transaksi
// (halaman utama /transactions + 5 sub halaman: Sales, Expense, Cash
// Payment, Cash Receipt, Other). Sebelumnya tiap sub halaman punya data
// dummy sendiri-sendiri yang tidak nyambung ke tabel di halaman utama.
// Sekarang `transactions` di sini adalah satu-satunya sumber: kalau ada
// transaksi baru ditambahkan/diimpor/diedit/diposting di halaman utama,
// seluruh sub halaman otomatis ikut berubah karena semuanya membaca dari
// context yang sama (dan sebaliknya juga berlaku).
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Transaction, TransactionGroup, getTransactionGroup } from '../components/transactionData';
import {
  transactionsFromJurnalPosting,
  extractPostingId,
  buildUpdatePayloadFromPair,
  buildManualCreatePayload,
  type BackendJurnalRow,
} from '../lib/jurnalBridge';
// [BARU] Sumber data KHUSUS kelompok Cash Payment & Cash Receipt --
// menggantikan baris jurnal_posting yang dulu jatuh ke 2 kelompok ini lewat
// classifyJournalPairCategory (Tax/AP Payment/Financing dsb). Lihat
// bankCashBridge.ts untuk penjelasan lengkap & alasan prefix jeId "BC-".
import {
  transactionsFromBankCash,
  extractBankCashId,
  buildBankCashUpdatePayload,
  buildBankCashManualCreatePayload,
  type BackendBankCashRow,
} from '../lib/bankCashBridge';
// [BARU] Sumber data KHUSUS kelompok Other -- menggantikan baris jurnal_posting
// yang dulu jatuh ke kelompok ini lewat tebakan kategori/nama akun. Lihat
// otherBridge.ts untuk penjelasan lengkap & alasan prefix jeId "OTH-".
import {
  transactionsFromFinanceOther,
  extractOtherJeId,
  buildOtherUpdatePayload,
  buildOtherManualCreatePayload,
  type BackendFinanceOtherRow,
} from '../lib/otherBridge';
import { useActiveClient } from '@/lib/activeClient';
// [BARU] Dengarkan notifikasi "data client berubah" yang dikirim Agent AI
// begitu selesai upload & auto-posting file (lihat dataSync.ts) -- supaya
// tabel Transaksi otomatis refresh tanpa user harus ganti client atau
// reload halaman manual dulu.
import { listenClientDataChanged } from '@/lib/dataSync';
// [DIUBAH] Sumber transaksi REAL sepenuhnya: diambil dari backend
// GET /api/client/{id}/jurnal-posting (semua status) dan diterjemahkan lewat
// jurnalBridge.ts. TIDAK ADA fallback ke data contoh lagi — kalau Supabase
// kosong (atau fetch gagal), `transactions` untuk kelompok terkait memang
// kosong/tidak berubah; UI tidak lagi menyamarkan itu sebagai "data contoh".
import { daftarJurnalPosting, updateJurnalPosting, buatJurnalManual, postingMassalByIds, tolakPosting } from '@/app/agent-ai/lib/api';
// [BARU] Lihat catatan import bankCashBridge di atas.
import { daftarBankCash, updateBankCash, buatBankCashManual, postingMassalBankCashByIds, tolakBankCash } from '@/app/agent-ai/lib/api';
// [BARU] Lihat catatan import otherBridge di atas.
import { daftarFinanceOther, updateFinanceOther, buatFinanceOtherManual, postingMassalFinanceOtherByJeIds, tolakFinanceOther } from '@/app/agent-ai/lib/api';

interface TransactionsContextValue {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  unpostedCount: number;
  /** true selagi memuat data transaksi (jurnal) dari backend untuk client aktif. */
  loading: boolean;
  /** Pesan error terakhir dari fetch ke backend (null kalau tidak ada error). */
  error: string | null;
  /** true kalau client aktif memang belum punya data sama sekali (bukan berarti `transactions` diisi data contoh -- itu selalu data asli/kosong). */
  isSampleData: boolean;
  /** Muat ulang transaksi dari backend untuk client aktif. */
  refetch: () => void;
  /**
   * Timpa satu transaksi (dicocokkan lewat id) — dipakai TransactionEditModal.
   * [DIUBAH — persist ke backend] Kalau baris ini berasal dari jurnal_posting
   * backend asli (jeId berformat "JE-<id>"), perubahan dikirim PATCH ke
   * server dulu (lewat jurnalBridge.buildUpdatePayloadFromPair) sebelum
   * state lokal ikut berubah; kalau gagal, state lokal TIDAK diubah dan
   * toast error ditampilkan. Baris lokal murni (data contoh / hasil import
   * yang belum sempat direfetch) tetap hanya mengubah state lokal seperti
   * sebelumnya, dengan toast yang menjelaskan itu belum tersimpan permanen.
   *
   * [DIUBAH — sinkron otomatis kaki pasangan] `syncedSibling` opsional:
   * diisi TransactionEditModal kalau nominal `updated` berubah dan
   * pasangannya (jeId sama) ikut disesuaikan otomatis di modal supaya
   * jurnal tetap balance. Kalau diisi, PATCH ke backend memakai nominal
   * pasangan yang SUDAH disesuaikan itu (bukan versi lama di state), dan
   * state lokal kedua leg ikut diperbarui sekaligus.
   */
  saveEdit: (updated: Transaction, syncedSibling?: Transaction) => Promise<void>;
  /**
   * Ubah status seluruh transaksi Unposted jadi Posted sekaligus.
   * [DIUBAH — persist ke backend] Baris yang berasal dari backend asli
   * diposting lewat POST posting-massal-by-ids, lalu data di-refetch ulang
   * dari server supaya status yang tampil selalu sesuai database. Baris
   * lokal murni (tanpa padanan di backend) tetap diposting di state saja.
   */
  postAllUnposted: () => Promise<void>;
  /** Ganti seluruh tabel dengan hasil import rekening koran baru. */
  importTransactions: (rows: Transaction[]) => void;
  /** Ambil transaksi milik satu kelompok saja (Sales/Expense/dll), dipakai di 5 sub halaman. */
  getByGroup: (group: TransactionGroup) => Transaction[];
  // [BARU] Tambahkan baris hasil import TANPA menghapus transaksi yang sudah
  // ada — dipakai oleh panel aksi jurnal di 5 sub halaman (Sales, Expense,
  // Cash Payment, Cash Receipt, Other), supaya upload data pembelian/penjualan
  // dari sub halaman tidak menghapus data dari halaman lain (beda perilaku
  // dari importTransactions() di atas, yang memang mengganti total tabel dan
  // hanya dipakai di halaman Transaksi utama).
  addTransactions: (rows: Transaction[]) => void;
  // [BARU] Ganti transaksi milik SATU kelompok saja (mis. Expense) dengan
  // hasil import baru — transaksi kelompok lain (Sales, Cash Payment, dst)
  // tidak disentuh sama sekali. Dipakai saat sub halaman mengimpor file yang
  // dimaksudkan untuk MENGGANTIKAN daftar transaksi kelompok itu, bukan
  // ditambahkan (beda dari addTransactions di atas).
  replaceGroup: (group: TransactionGroup, rows: Transaction[]) => void;
  /**
   * Tambahkan satu jurnal baru (dipakai tombol "+ Jurnal Baru" di halaman
   * utama & 5 sub halaman). [DIUBAH — persist ke backend] Menerima SEPASANG
   * Transaction (leg debet + leg kredit, lihat TransactionEditModal mode
   * isNew) karena backend jurnal_posting selalu menyimpan kedua sisi
   * sekaligus dalam satu baris. Dikirim lewat POST jurnal-posting/manual,
   * lalu data di-refetch dari backend supaya jurnal baru punya id/jeId asli
   * (bukan id sementara "JE-MANUAL-...").
   */
  addTransaction: (txs: Transaction[]) => Promise<void>;
  /** Posting semua transaksi Unposted, tapi dibatasi pada satu kelompok saja (lihat catatan postAllUnposted). */
  postAllUnpostedInGroup: (group: TransactionGroup) => Promise<void>;
  /**
   * [FIX - audit #2] Hapus satu/beberapa transaksi (dicocokkan lewat id) —
   * dipakai tombol Hapus per-baris & bulk-action di halaman Transaksi utama.
   * Baris yang benar-benar berasal dari jurnal_posting backend TIDAK
   * dihapus permanen dari database (tidak ada endpoint DELETE untuk
   * jurnal_posting, dan menghapus baris ledger begitu saja bukan praktik
   * akuntansi yang benar) — sebagai gantinya baris tsb (beserta pasangan
   * leg-nya, jeId sama) ditandai TOLAK lewat endpoint /tolak yang memang
   * sudah ada (dbc.tolak_posting_jurnal), sehingga tidak lagi masuk ke
   * laporan keuangan, lalu disembunyikan dari tabel. Baris lokal murni
   * (data contoh / hasil import yang belum sempat direfetch) langsung
   * dibuang dari state.
   */
  deleteTransactions: (ids: string[]) => Promise<void>;
  /**
   * [FIX - audit #2] Arsipkan satu/beberapa transaksi — backend tidak
   * punya konsep "arsip" sama sekali untuk jurnal_posting, jadi ini murni
   * state lokal (field `archived`, lihat transactionData.ts): baris
   * ditandai & disembunyikan dari tabel Transaksi utama selama sesi ini
   * (lihat TransactionsContent.tsx), TIDAK dihapus dan TIDAK dikirim ke
   * server — beda sengaja dari deleteTransactions di atas.
   */
  archiveTransactions: (ids: string[]) => void;
  /**
   * [FIX - audit #7] Set/lepas tanda centang "Cek" (rekonsiliasi manual) —
   * field ini murni lokal, backend jurnal_posting tidak punya kolom
   * setara, jadi cukup diubah di state di sini (tidak ada PATCH ke server).
   */
  toggleCek: (id: string) => void;
}

const TransactionsContext = createContext<TransactionsContextValue | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const { activeClientId } = useActiveClient();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [DIUBAH] `isSampleData` sekarang HANYA sinyal "client aktif belum punya
  // data sama sekali" (dipakai halaman lain seperti Overview/Tax Compliance
  // untuk keputusan tampilan mereka sendiri) -- BUKAN lagi ditimpa jadi true
  // saat fetch gagal. `transactions` sendiri TIDAK PERNAH diisi data contoh;
  // kalau kosong di Supabase, ya kosong di sini juga.
  const [isSampleData, setIsSampleData] = useState(true);
  // Dipakai supaya respons fetch client LAMA yang telat datang (mis. user
  // pindah client dengan cepat) tidak menimpa data client yang sekarang aktif.
  const requestIdRef = useRef(0);

  const loadFromBackend = React.useCallback(() => {
    if (!activeClientId) {
      setTransactions([]);
      setIsSampleData(true);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    // [DIUBAH] Ambil dari 3 sumber sekaligus: jurnal_posting (Sales/Expense),
    // finance_transaction_bank_cash (Cash Payment/Cash Receipt -- lihat
    // bankCashBridge.ts), DAN finance_transaction_other (Other -- lihat
    // otherBridge.ts). '' -> semua status di ketiga endpoint.
    Promise.all([
      daftarJurnalPosting(activeClientId, ''),
      daftarBankCash(activeClientId, ''),
      daftarFinanceOther(activeClientId, ''),
    ])
      .then(([jurnalRes, bankCashRes, financeOtherRes]: [
        { jurnal: BackendJurnalRow[] },
        { bank_cash: BackendBankCashRow[] },
        { finance_other: BackendFinanceOtherRow[] },
      ]) => {
        if (requestIdRef.current !== requestId) return; // sudah usang, ada request client lain setelah ini
        const jurnalRows = jurnalRes?.jurnal || [];
        const bankCashRows = bankCashRes?.bank_cash || [];
        const financeOtherRows = financeOtherRes?.finance_other || [];
        // [DIUBAH] Tidak ada lagi cabang "semua kosong -> data contoh".
        // isSampleData sekadar MENCATAT kondisi itu (dipakai halaman lain
        // seperti Overview/Tax Compliance) -- `transactions` di bawah tetap
        // dibangun dari data asli (otomatis kosong kalau memang kosong).
        setIsSampleData(jurnalRows.length === 0 && bankCashRows.length === 0 && financeOtherRows.length === 0);
        {
          // [BARU] Baris jurnal_posting yang KEBETULAN terklasifikasi
          // cash_payment/cash_receipt/other (lewat classifyJournalPairCategory
          // di legFromRow, fallback lama berbasis nama akun) SENGAJA dibuang
          // di sini — finance_transaction_bank_cash & finance_transaction_
          // other sekarang SATU-SATUNYA sumber untuk 3 kelompok itu, supaya
          // tidak ada baris dobel/tertukar sumber di sub halaman terkait.
          // Kelompok lain (sales/purchase) tidak terpengaruh.
          //
          // [DIUBAH -- fix dobel hitung, susulan nomor 2/3] Filter
          // classifyJournalPairCategory/getTransactionGroup di atas cuma
          // menangkap baris yang KEBETULAN lolos tebakan kategori
          // (mis. "AP Payment"/"Tax" -> grup cash_payment) -- bukan
          // authoritative. Sejak daftarBankCash() digabung dengan
          // v_kas_bank_dari_jurnal (nomor 2), backend sudah tahu PERSIS
          // baris jurnal_posting mana saja yang benar-benar menyentuh akun
          // Kas & Bank (berdasar coa.sub_kategori='Kas', bukan tebakan nama
          // akun) -- baris itu ikut balik lewat bankCashRows dengan
          // sumber='jurnal_posting'. Kalau baris begini TIDAK ikut dibuang
          // dari jurnalTx (mis. "Beban Gaji dibayar tunai" -> category
          // 'Payroll' -> grup 'purchase', LOLOS dari filter kategori di
          // atas), dia akan muncul DUA KALI di array `transactions`: sekali
          // di sini (sebagai Purchase), sekali lagi di bankCashTx (sebagai
          // Cash Payment) -- KPI/total apa pun yang menjumlah seluruh
          // `transactions` tanpa dikelompokkan per tab (Overview, Tax
          // Reconciliation, Anomaly Detection, dst -- lihat komponen yang
          // konsumsi `transactions` langsung tanpa getByGroup) akan
          // menghitung nominalnya dua kali.
          //
          // Fix: buang juga dari jurnalTx SEMUA jeId yang backend sendiri
          // sudah tandai sumber='jurnal_posting' di bankCashRows -- ini
          // klasifikasi otoritatif (berbasis COA), jadi dipakai untuk
          // menggantikan/menang atas tebakan kategori yang lama, persis
          // sesuai niat komentar di atas ("SATU-SATUNYA sumber").
          const kasBankJeIdsDariJurnal = new Set(
            bankCashRows.filter((r) => r.sumber === 'jurnal_posting').map((r) => `JE-${r.id}`)
          );
          const jurnalTx = transactionsFromJurnalPosting(jurnalRows).filter((tx) => {
            const grup = getTransactionGroup(tx);
            if (grup === 'cash_payment' || grup === 'cash_receipt' || grup === 'other') return false;
            if (tx.jeId && kasBankJeIdsDariJurnal.has(tx.jeId)) return false;
            return true;
          });
          const bankCashTx = transactionsFromBankCash(bankCashRows);
          const otherTx = transactionsFromFinanceOther(financeOtherRows);
          setTransactions([...jurnalTx, ...bankCashTx, ...otherTx]);
        }
      })
      .catch((err: Error) => {
        if (requestIdRef.current !== requestId) return;
        console.error('Gagal memuat transaksi dari backend:', err);
        // [DIUBAH] Tidak lagi diam-diam diganti data contoh & tidak lagi
        // menandai isSampleData=true saat gagal -- itu dulu membuat error
        // asli tertutupi seolah "cuma data contoh". Data yang sebelumnya
        // sudah termuat dibiarkan apa adanya; `error` diisi supaya halaman
        // bisa menampilkan pesan gagal-muat yang sebenarnya (lihat
        // penggunaan `error` di TransactionsContent.tsx & CashBankTabContent.tsx).
        setError(err?.message || 'Gagal memuat transaksi dari server.');
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [activeClientId]);

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  // [BARU] Begitu Agent AI selesai upload & auto-posting untuk CLIENT YANG
  // SAMA dengan yang sedang aktif di sini, muat ulang jurnal dari backend --
  // supaya baris transaksi baru langsung muncul di tabel tanpa perlu ganti
  // client atau reload halaman manual. Kalau notifikasi datang untuk client
  // LAIN (bukan yang lagi aktif di layar ini), diabaikan -- nanti otomatis
  // ke-fetch sendiri begitu user pindah ke client itu (efek activeClientId
  // di atas).
  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) {
        loadFromBackend();
      }
    });
  }, [activeClientId, loadFromBackend]);

  const unpostedCount = useMemo(
    () => transactions.filter((tx) => tx.status === 'Unposted').length,
    [transactions]
  );

  // [DIUBAH — persist ke backend] Kirim PATCH ke server dulu untuk baris
  // yang benar-benar berasal dari jurnal_posting backend (jeId "JE-<id>");
  // baris lokal murni (data contoh / import belum direfetch / jurnal manual
  // yang gagal tersimpan) tetap diedit di state saja seperti sebelumnya.
  const saveEdit = async (updated: Transaction, syncedSibling?: Transaction) => {
    // [DIUBAH] Baris bisa berasal dari jurnal_posting (jeId "JE-<id>"),
    // finance_transaction_bank_cash (jeId "BC-<id>", lihat bankCashBridge.ts),
    // ATAU finance_transaction_other (jeId "OTH-<suffix>", lihat
    // otherBridge.ts) -- tentukan dulu sumbernya sebelum kirim PATCH, supaya
    // baris Cash Payment/Cash Receipt/Other tersimpan ke tabel yang benar.
    const postingId = extractPostingId(updated.jeId);
    const bankCashId = extractBankCashId(updated.jeId);
    const otherJeId = extractOtherJeId(updated.jeId);
    if ((postingId === null && bankCashId === null && otherJeId === null) || !activeClientId) {
      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.id === updated.id) return updated;
          if (syncedSibling && tx.id === syncedSibling.id) return syncedSibling;
          return tx;
        })
      );
      toast.success('Perubahan disimpan (lokal)', {
        description: `${updated.txId} diperbarui — data ini belum tersinkron ke server, akan hilang saat refresh.`,
      });
      return;
    }
    // [DIUBAH — sinkron otomatis kaki pasangan] Kalau modal sudah mengirim
    // pasangan yang nominalnya disesuaikan (syncedSibling), pakai itu
    // sebagai sibling utk payload PATCH -- BUKAN versi lama di `transactions`
    // -- supaya backend menerima kedua sisi jurnal yang sudah balance,
    // bukan nominal sibling yang belum diubah.
    const sibling = syncedSibling ?? transactions.find((tx) => tx.jeId === updated.jeId && tx.id !== updated.id) ?? null;
    try {
      if (postingId !== null) {
        const payload = buildUpdatePayloadFromPair(updated, sibling);
        await updateJurnalPosting(activeClientId, postingId, payload);
      } else if (bankCashId !== null) {
        const payload = buildBankCashUpdatePayload(updated, sibling);
        await updateBankCash(activeClientId, bankCashId, payload);
      } else {
        const payload = buildOtherUpdatePayload(updated, sibling);
        await updateFinanceOther(activeClientId, otherJeId as string, payload);
      }
      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.id === updated.id) return updated;
          if (syncedSibling && tx.id === syncedSibling.id) return syncedSibling;
          return tx;
        })
      );
      toast.success('Perubahan disimpan', {
        description: syncedSibling
          ? `${updated.txId} berhasil diperbarui di server — pasangan jurnalnya ikut disesuaikan supaya tetap balance`
          : `${updated.txId} berhasil diperbarui di server`,
      });
    } catch (err) {
      console.error('Gagal menyimpan edit ke backend:', err);
      toast.error('Gagal menyimpan perubahan', {
        description: (err as Error)?.message || 'Server menolak perubahan, coba lagi.',
      });
    }
  };

  // [DIUBAH — persist ke backend] Pisahkan baris yang punya padanan asli di
  // backend (diposting lewat postingMassalByIds lalu di-refetch supaya
  // status yang tampil = sumber kebenaran database) dari baris lokal murni
  // (tetap diposting di state saja, sama seperti perilaku lama).
  const postAllUnposted = async () => {
    const unposted = transactions.filter((tx) => tx.status === 'Unposted');
    if (unposted.length === 0) return;
    // [DIUBAH] Pisahkan id per sumber (jurnal_posting vs finance_transaction_
    // bank_cash vs finance_transaction_other) -- lihat catatan saveEdit di
    // atas soal prefix jeId "JE-"/"BC-"/"OTH-".
    const jurnalIds = Array.from(
      new Set(unposted.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const bankCashIds = Array.from(
      new Set(unposted.map((tx) => extractBankCashId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const otherJeIds = Array.from(
      new Set(unposted.map((tx) => extractOtherJeId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const adaBarisLokal = unposted.some(
      (tx) => extractPostingId(tx.jeId) === null && extractBankCashId(tx.jeId) === null && extractOtherJeId(tx.jeId) === null
    );

    if ((jurnalIds.length > 0 || bankCashIds.length > 0 || otherJeIds.length > 0) && activeClientId) {
      try {
        const [hasilJurnal, hasilBankCash, hasilOther] = await Promise.all([
          jurnalIds.length > 0 ? postingMassalByIds(activeClientId, jurnalIds) : Promise.resolve(null),
          bankCashIds.length > 0 ? postingMassalBankCashByIds(activeClientId, bankCashIds) : Promise.resolve(null),
          otherJeIds.length > 0 ? postingMassalFinanceOtherByJeIds(activeClientId, otherJeIds) : Promise.resolve(null),
        ]);
        const totalDiposting = (hasilJurnal?.diposting || 0) + (hasilBankCash?.diposting || 0) + (hasilOther?.diposting || 0);
        const totalDilewati = (hasilJurnal?.dilewati_placeholder || 0) + (hasilBankCash?.dilewati_placeholder || 0) + (hasilOther?.dilewati_placeholder || 0);
        toast.success('Transaksi berhasil diposting', {
          description: `${totalDiposting} transaksi Unposted kini berstatus Posted${
            totalDilewati ? `, ${totalDilewati} dilewati (akun placeholder)` : ''
          }`,
        });
        loadFromBackend(); // sinkronkan ulang status dari server
      } catch (err) {
        console.error('Gagal posting ke backend:', err);
        toast.error('Gagal posting transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan posting.',
        });
        return;
      }
    }

    if (adaBarisLokal) {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === 'Unposted' && extractPostingId(tx.jeId) === null && extractBankCashId(tx.jeId) === null && extractOtherJeId(tx.jeId) === null
            ? { ...tx, status: 'Posted' }
            : tx
        )
      );
      if (jurnalIds.length === 0 && bankCashIds.length === 0 && otherJeIds.length === 0) {
        toast.success('Transaksi berhasil diposting (lokal)', {
          description: 'Baris ini belum tersinkron ke server — status akan kembali saat refresh.',
        });
      }
    }
  };

  // [DIUBAH KEMBALI — sesuai keputusan user] Sempat diubah supaya
  // memuat ulang SEMUA transaksi dari backend setiap kali ada import (biar
  // "sumber kebenaran" selalu database) -- tapi itu bikin tabel Transaksi
  // selalu menggabung seluruh histori (mis. 20.630 lama + 4.000 baru jadi
  // 24.630 tampil sekaligus), padahal yang diinginkan user: tabel di LAYAR
  // hanya menampilkan batch yang BARU SAJA diimpor (reset tampilan), sambil
  // data lama tetap 100% aman di database (backend memang selalu INSERT,
  // tidak pernah menghapus apa pun saat upload -- lihat POST /api/proses-file
  // di ImportRekeningKoranModal.tsx). Jadi cukup ganti state lokal dengan
  // `rows` batch ini saja, TANPA fetch ulang ke server.
  //
  // CATATAN dedup: sama seperti sebelumnya, guard anti-duplikat
  // (pisahkanTransaksiDuplikat) murni di frontend dan backend belum
  // men-dedup baris yang masuk -- baris yang dilewati user di step
  // "konfirmasi duplikat" tetap sudah tersimpan di server sejak upload,
  // tapi karena sekarang TIDAK ada refetch otomatis, baris itu juga tidak
  // akan tiba-tiba muncul lagi di tabel ini (beda dari sebelumnya).
  const importTransactions = (rows: Transaction[]) => {
    setTransactions(rows);
  };

  const getByGroup = (group: TransactionGroup) => transactions.filter((tx) => getTransactionGroup(tx) === group);

  // [BARU] Menambahkan (bukan mengganti) — dipakai saat import rekening koran
  // atau upload data pembelian/penjualan dilakukan dari salah satu dari 5 sub
  // halaman Transaksi, supaya data yang sudah ada di kelompok lain tetap aman.
  const addTransactions = (rows: Transaction[]) => {
    if (rows.length === 0) return;
    setTransactions((prev) => [...rows, ...prev]);
  };

  // [DIUBAH KEMBALI — sesuai keputusan user, sama seperti importTransactions()
  // di atas] Cukup buang baris grup ini dari state lokal lalu ganti dengan
  // `rows` batch baru -- TANPA fetch ulang ke backend. Grup lain tidak
  // disentuh. Data grup ini yang tidak ikut ke-parse di batch ini tetap aman
  // di database (backend selalu INSERT, tidak pernah menghapus), hanya
  // sengaja tidak ditampilkan lagi di layar sampai user reload/pindah client.
  const replaceGroup = (group: TransactionGroup, rows: Transaction[]) => {
    setTransactions((prev) => [...rows, ...prev.filter((tx) => getTransactionGroup(tx) !== group)]);
  };

  // [DIUBAH — persist ke backend] Selalu menerima sepasang leg (debet +
  // kredit) — lihat TransactionEditModal mode isNew. Dikirim lewat POST
  // jurnal-posting/manual, lalu di-refetch supaya baris baru langsung punya
  // id/jeId asli dari backend (bukan id sementara "JE-MANUAL-..."). Kalau
  // belum ada client aktif, tidak mungkin tersimpan permanen — jatuh ke
  // penambahan state lokal saja (sama seperti perilaku lama).
  const addTransaction = async (txs: Transaction[]) => {
    if (txs.length < 2) return;
    const [a, b] = txs;
    const debetLeg = a.type === 'credit' ? b : a;
    const kreditLeg = a.type === 'credit' ? a : b;
    // [BARU] Jurnal baru dari sub halaman Cash Payment/Cash Receipt (dilihat
    // dari `category` yang sudah dipilihkan blankTransaction() di
    // TransactionsGroupPanel.tsx) disimpan ke finance_transaction_bank_cash,
    // dan dari sub halaman Other disimpan ke finance_transaction_other --
    // bukan jurnal_posting -- konsisten dengan sumber baca 3 kelompok itu.
    const grup = getTransactionGroup(debetLeg);
    const grupBankCash = grup === 'cash_payment' || grup === 'cash_receipt';
    const grupOther = grup === 'other';

    if (!activeClientId) {
      setTransactions((prev) => [...txs, ...prev]);
      toast.success('Jurnal baru ditambahkan (lokal)', {
        description: `${debetLeg.txId} dibuat — pilih client aktif dulu supaya tersimpan permanen ke server.`,
      });
      return;
    }

    try {
      if (grupBankCash) {
        const jenisDokumen = grup === 'cash_receipt' ? 'cash_receipt' : 'cash_payment';
        const payload = buildBankCashManualCreatePayload(debetLeg, kreditLeg, jenisDokumen);
        await buatBankCashManual(activeClientId, payload);
      } else if (grupOther) {
        const payload = buildOtherManualCreatePayload(debetLeg, kreditLeg);
        await buatFinanceOtherManual(activeClientId, payload);
      } else {
        const payload = buildManualCreatePayload(debetLeg, kreditLeg);
        await buatJurnalManual(activeClientId, payload);
      }
      toast.success('Jurnal baru ditambahkan', { description: `${debetLeg.txId} berhasil disimpan ke server` });
      loadFromBackend();
    } catch (err) {
      console.error('Gagal menyimpan jurnal baru ke backend:', err);
      toast.error('Gagal menyimpan jurnal baru', {
        description: (err as Error)?.message || 'Server menolak permintaan.',
      });
    }
  };

  const postAllUnpostedInGroup = async (group: TransactionGroup) => {
    const unposted = transactions.filter((tx) => tx.status === 'Unposted' && getTransactionGroup(tx) === group);
    if (unposted.length === 0) return;
    // [DIUBAH] Sama seperti postAllUnposted() -- pisahkan id per sumber.
    // Untuk group cash_payment/cash_receipt, seluruh baris seharusnya
    // memang dari bank_cash; untuk group other, dari finance_transaction_
    // other (otherJeIds); untuk group lain, dari jurnal_posting. Tetap
    // ditangani ketiganya di sini supaya aman walau ada baris "sisa" dari
    // sumber lama.
    const jurnalIds = Array.from(
      new Set(unposted.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const bankCashIds = Array.from(
      new Set(unposted.map((tx) => extractBankCashId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const otherJeIds = Array.from(
      new Set(unposted.map((tx) => extractOtherJeId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const adaBarisLokal = unposted.some(
      (tx) => extractPostingId(tx.jeId) === null && extractBankCashId(tx.jeId) === null && extractOtherJeId(tx.jeId) === null
    );

    if ((jurnalIds.length > 0 || bankCashIds.length > 0 || otherJeIds.length > 0) && activeClientId) {
      try {
        const [hasilJurnal, hasilBankCash, hasilOther] = await Promise.all([
          jurnalIds.length > 0 ? postingMassalByIds(activeClientId, jurnalIds) : Promise.resolve(null),
          bankCashIds.length > 0 ? postingMassalBankCashByIds(activeClientId, bankCashIds) : Promise.resolve(null),
          otherJeIds.length > 0 ? postingMassalFinanceOtherByJeIds(activeClientId, otherJeIds) : Promise.resolve(null),
        ]);
        const totalDiposting = (hasilJurnal?.diposting || 0) + (hasilBankCash?.diposting || 0) + (hasilOther?.diposting || 0);
        const totalDilewati = (hasilJurnal?.dilewati_placeholder || 0) + (hasilBankCash?.dilewati_placeholder || 0) + (hasilOther?.dilewati_placeholder || 0);
        toast.success('Transaksi berhasil diposting', {
          description: `${totalDiposting} transaksi Unposted kini berstatus Posted${
            totalDilewati ? `, ${totalDilewati} dilewati (akun placeholder)` : ''
          }`,
        });
        loadFromBackend();
      } catch (err) {
        console.error('Gagal posting ke backend:', err);
        toast.error('Gagal posting transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan posting.',
        });
        return;
      }
    }

    if (adaBarisLokal) {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.status === 'Unposted' && getTransactionGroup(tx) === group &&
          extractPostingId(tx.jeId) === null && extractBankCashId(tx.jeId) === null && extractOtherJeId(tx.jeId) === null
            ? { ...tx, status: 'Posted' }
            : tx
        )
      );
      if (jurnalIds.length === 0 && bankCashIds.length === 0 && otherJeIds.length === 0) {
        toast.success('Transaksi berhasil diposting (lokal)', {
          description: 'Baris ini belum tersinkron ke server — status akan kembali saat refresh.',
        });
      }
    }
  };

  // [FIX - audit #2] Lihat komentar deleteTransactions di interface di atas.
  const deleteTransactions = async (ids: string[]) => {
    const targets = transactions.filter((tx) => ids.includes(tx.id));
    if (targets.length === 0) return;
    // [DIUBAH] Pisahkan target per sumber (jurnal_posting vs
    // finance_transaction_bank_cash vs finance_transaction_other) supaya
    // "tolak" dikirim ke endpoint yang benar-benar menyimpan baris itu.
    const backendPostingIds = Array.from(
      new Set(targets.map((tx) => extractPostingId(tx.jeId)).filter((id): id is number => id !== null))
    );
    const backendBankCashIds = Array.from(
      new Set(targets.map((tx) => extractBankCashId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const backendOtherJeIds = Array.from(
      new Set(targets.map((tx) => extractOtherJeId(tx.jeId)).filter((id): id is string => id !== null))
    );
    const jeIdsBackend = new Set(
      targets
        .filter((tx) => extractPostingId(tx.jeId) !== null || extractBankCashId(tx.jeId) !== null || extractOtherJeId(tx.jeId) !== null)
        .map((tx) => tx.jeId)
    );
    const localIds = new Set(
      targets
        .filter((tx) => extractPostingId(tx.jeId) === null && extractBankCashId(tx.jeId) === null && extractOtherJeId(tx.jeId) === null)
        .map((tx) => tx.id)
    );

    if ((backendPostingIds.length > 0 || backendBankCashIds.length > 0 || backendOtherJeIds.length > 0) && activeClientId) {
      try {
        await Promise.all([
          ...backendPostingIds.map((postingId) =>
            tolakPosting(activeClientId, postingId, 'Dihapus dari halaman Transaksi')
          ),
          ...backendBankCashIds.map((bankCashId) =>
            tolakBankCash(activeClientId, bankCashId, 'Dihapus dari halaman Transaksi')
          ),
          ...backendOtherJeIds.map((jeId) =>
            tolakFinanceOther(activeClientId, jeId, 'Dihapus dari halaman Transaksi')
          ),
        ]);
      } catch (err) {
        console.error('Gagal menghapus transaksi di backend:', err);
        toast.error('Gagal menghapus transaksi', {
          description: (err as Error)?.message || 'Server menolak permintaan, coba lagi.',
        });
        return;
      }
    }

    // Baris backend yang berhasil ditolak: buang KEDUA leg (jeId sama) dari
    // tampilan. Baris lokal murni: buang langsung lewat id.
    setTransactions((prev) => prev.filter((tx) => !localIds.has(tx.id) && !jeIdsBackend.has(tx.jeId)));

    toast.success(`${targets.length} transaksi dihapus`, {
      description: (backendPostingIds.length > 0 || backendBankCashIds.length > 0 || backendOtherJeIds.length > 0)
        ? 'Jurnal yang tersinkron ke server ditandai ditolak (tidak lagi masuk laporan keuangan) — jurnal ledger tidak dihapus permanen dari database, sesuai praktik akuntansi.'
        : undefined,
    });
  };

  // [FIX - audit #2] Lihat komentar archiveTransactions di interface di atas.
  const archiveTransactions = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setTransactions((prev) => prev.map((tx) => (idSet.has(tx.id) ? { ...tx, archived: true } : tx)));
    toast.success(`${ids.length} transaksi diarsipkan`, {
      description: 'Disembunyikan dari tabel Transaksi selama sesi ini (belum ada penyimpanan arsip permanen di server).',
    });
  };

  // [FIX - audit #7] Lihat komentar toggleCek di interface di atas.
  const toggleCek = (id: string) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, cek: !tx.cek } : tx)));
  };

  const value: TransactionsContextValue = {
    transactions,
    setTransactions,
    unpostedCount,
    loading,
    error,
    isSampleData,
    refetch: loadFromBackend,
    saveEdit,
    postAllUnposted,
    importTransactions,
    getByGroup,
    addTransactions,
    replaceGroup,
    addTransaction,
    postAllUnpostedInGroup,
    deleteTransactions,
    archiveTransactions,
    toggleCek,
  };

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
}

export function useTransactions() {
  const ctx = useContext(TransactionsContext);
  if (!ctx) throw new Error('useTransactions harus dipakai di dalam TransactionsProvider (lihat src/app/transactions/layout.tsx)');
  return ctx;
}