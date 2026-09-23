'use client';

// Data layer fitur "Financial Statements" (src/app/financial-statements/*),
// terhubung ke backend/modules/financial_statements/v1.py:
// GET /api/v1/financial-statements[/...] -- lihat file itu untuk daftar endpoint.
//
// Sumber data backend = transaksi POSTED dari fitur Transactions (Journal
// Entry, Sales, Purchase). client_id = id_user akun yang SEDANG LOGIN
// (`useAuth().user.id`), sama persis dengan filter tab-tab Transactions --
// BUKAN activeClientId (tabel clients lama).
//
// Semua nominal dari backend dalam RUPIAH penuh. Komponen financial
// statements menampilkan dalam JUTA (formatMoney(v * 1_000_000)), jadi
// konversi pakai `keJuta()` di sini.
//
// Satu request ringkasan (GET /api/v1/financial-statements) dipakai
// bersama oleh semua tab/halaman lewat cache modul, supaya pindah tab
// tidak fetch ulang. Cache otomatis dibuang begitu data Sales/Journal
// Entry/Purchase berubah (custom event yang sama dengan store masing-masing).

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const FS_BASE_URL = `${API_BASE_URL}/api/v1/financial-statements`;

const EVENT_SUMBER_BERUBAH = ['gouf-journal-entry-changed', 'gouf-sales-changed', 'gouf-purchase-changed'];

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

/** Rupiah -> juta (2 desimal), satuan yang dipakai komponen financial statements. */
export function keJuta(v: number | null | undefined): number {
  return Math.round(((v || 0) / 1_000_000) * 100) / 100;
}

// ============================================================
// Tipe response (lihat backend/modules/financial_statements/core.py)
// ============================================================

export interface FsPeriode {
  tahun: number;
  sampai_bulan: number;
  label: string;
  per_tanggal: string;
  ada_data: boolean;
  jumlah_jurnal: number;
  client_id: string;
}

export interface FsRincianItem { account_code: string; name: string; value: number; pct: number }

export interface FsLabaRugiAngka {
  revenue: number; cogs: number; gross_profit: number; operating_expenses: number;
  ebitda: number; da: number; ebit: number; interest_expense: number; ebt: number;
  income_tax: number; net_profit: number;
}

export interface FsProfitLoss {
  ringkasan: FsLabaRugiAngka;
  margin: { gross_margin: number; ebitda_margin: number; ebit_margin: number; net_margin: number; effective_tax_rate: number };
  bulanan: (FsLabaRugiAngka & { bulan: number; label: string })[];
  rincian: Record<'revenue' | 'cogs' | 'operating_expenses' | 'da' | 'interest_expense' | 'income_tax', FsRincianItem[]>;
}

export interface FsNeracaItem {
  name: string; grup: string; current: number; prev: number; href: string;
  akun: { account_code: string; account_name: string; current: number; prev: number }[];
}
export interface FsNeracaSeksi { label: string; items: FsNeracaItem[]; total: number; prev_total: number }

export interface FsBalanceSheet {
  per_tanggal: string;
  pembanding_tanggal: string;
  aset_lancar: FsNeracaSeksi;
  aset_tidak_lancar: FsNeracaSeksi;
  liabilitas_jangka_pendek: FsNeracaSeksi;
  liabilitas_jangka_panjang: FsNeracaSeksi;
  ekuitas: FsNeracaSeksi;
  total_aset: number; prev_total_aset: number;
  total_liabilitas: number; prev_total_liabilitas: number;
  total_ekuitas: number; prev_total_ekuitas: number;
  seimbang: boolean;
  selisih: number;
  tren_bulanan: { bulan: number; label: string; aset: number; liabilitas: number; ekuitas: number; aset_lancar: number; liabilitas_jangka_pendek: number }[];
}

export interface FsArusKasItem { account_code: string; name: string; inflow: number; outflow: number; href: string }

export interface FsCashFlow {
  ringkasan: Record<
    | 'beginning_cash' | 'customer_collections' | 'supplier_payments' | 'payroll_payments' | 'tax_payments'
    | 'operating_expenses_cf' | 'other_operating_cf' | 'asset_purchases' | 'asset_sales' | 'equipment_purchases'
    | 'investments' | 'other_investing_cf' | 'debt_proceeds' | 'debt_repayment' | 'capital_injection'
    | 'dividend_payments' | 'lease_payments' | 'other_financing_cf' | 'net_operating_cf' | 'net_investing_cf'
    | 'net_financing_cf' | 'net_change' | 'ending_cash',
    number
  >;
  bulanan: { bulan: number; label: string; begin_cash: number; operating_cf: number; investing_cf: number; financing_cf: number; net_change: number; end_cash: number }[];
  operating_items: FsArusKasItem[];
  investing_items: FsArusKasItem[];
  financing_items: FsArusKasItem[];
  recent_transactions: {
    id: string; tanggal: string; type: 'Receipt' | 'Payment'; description: string; account: string;
    cash_account: string; inflow: number; outflow: number; party: string; sumber: string; status: string;
  }[];
  metode_tidak_langsung: {
    operating: { items: { label: string; value: number }[]; total: number };
    investing: { items: { label: string; value: number }[]; total: number };
    financing: { items: { label: string; value: number }[]; total: number };
    beginning: number; ending: number; net_change: number; selisih_rekonsiliasi: number;
  };
}

export interface FsEkuitasKomponen {
  key: string; name: string;
  opening: number; capital: number; profit: number; dividends: number; adjustments: number; closing: number;
  akun: { account_code: string | null; account_name: string; opening: number; movement: number; closing: number }[];
}

export interface FsChangesInEquity {
  komponen: FsEkuitasKomponen[];
  total: Record<'opening' | 'capital' | 'profit' | 'dividends' | 'adjustments' | 'closing', number>;
  ringkasan: {
    opening_equity: number; capital_contributions: number; net_profit: number; dividends: number;
    other_adjustments: number; closing_equity: number; equity_growth_pct: number | null;
  };
  rekonsiliasi_laba_ditahan: { opening: number; net_profit: number; dividends: number; adjustments: number; closing: number };
  bulanan: { bulan: number; label: string; closing_equity: number; net_profit_ytd: number }[];
}

export interface FsCatatan {
  no: string; key: string; title: string; statement: string;
  tag: 'Policy Note' | 'Disclosed' | 'Supporting Schedule';
  narasi: string;
  rows: { account_code: string; account_name: string; current: number; prev: number }[];
  total: number | null;
  prev_total: number | null;
}

export interface FsNotes {
  per_tanggal: string;
  pembanding_tanggal: string;
  catatan: FsCatatan[];
  jumlah: { total: number; policy: number; disclosed: number; schedule: number };
}

export interface FsTrialBalance {
  akun: {
    account_code: string; account_name: string; kategori: string; grup: string; label_grup: string;
    lancar: boolean | null; saldo_normal: 'D' | 'K'; saldo_awal: number; mutasi_debit: number;
    mutasi_kredit: number; saldo_akhir: number; debit: number; kredit: number; per_bulan: number[];
  }[];
  laba_tahun_lalu_belum_ditutup: number;
  total_debit: number;
  total_kredit: number;
  seimbang: boolean;
}

export interface FinancialStatements {
  periode: FsPeriode;
  trial_balance: FsTrialBalance;
  profit_loss: FsProfitLoss;
  balance_sheet: FsBalanceSheet;
  cash_flow: FsCashFlow;
  changes_in_equity: FsChangesInEquity;
  notes: FsNotes;
}

export interface FsPeriodeTersedia {
  client_id: string;
  tahun: { tahun: number; bulan_terakhir: number; bulan_aktif: number[] }[];
  default_tahun: number;
}

// ============================================================
// Fetcher
// ============================================================

export interface FsQuery { clientId?: string | null; tahun?: number | null; sampaiBulan?: number | null }

export async function getFinancialStatements({ clientId, tahun, sampaiBulan }: FsQuery = {}): Promise<FinancialStatements> {
  const res = await fetch(`${FS_BASE_URL}${qs({ client_id: clientId, tahun, sampai_bulan: sampaiBulan })}`);
  return baca<FinancialStatements>(res);
}

export async function getFinancialStatementPeriods(clientId?: string | null): Promise<FsPeriodeTersedia> {
  const res = await fetch(`${FS_BASE_URL}/periods${qs({ client_id: clientId })}`);
  return baca<FsPeriodeTersedia>(res);
}

// ============================================================
// Cache bersama + hook
// ============================================================

const cache = new Map<string, { data?: FinancialStatements; promise?: Promise<FinancialStatements>; error?: string }>();
const pendengar = new Set<() => void>();
let versiCache = 0; // naik tiap invalidate -> hook fetch ulang

function kunciCache(q: FsQuery): string {
  return `${q.clientId || ''}|${q.tahun || ''}|${q.sampaiBulan || ''}`;
}

function kabariPendengar() {
  pendengar.forEach((fn) => fn());
}

/** Buang cache (mis. setelah posting transaksi) -- semua hook fetch ulang. */
export function invalidateFinancialStatements() {
  cache.clear();
  versiCache += 1;
  kabariPendengar();
}

if (typeof window !== 'undefined') {
  EVENT_SUMBER_BERUBAH.forEach((ev) => window.addEventListener(ev, invalidateFinancialStatements));
}

function muat(q: FsQuery): Promise<FinancialStatements> {
  const kunci = kunciCache(q);
  const entri = cache.get(kunci);
  if (entri?.promise) return entri.promise;
  const promise = getFinancialStatements(q)
    .then((data) => {
      cache.set(kunci, { data });
      kabariPendengar();
      return data;
    })
    .catch((err: Error) => {
      cache.set(kunci, { error: err.message });
      kabariPendengar();
      throw err;
    });
  cache.set(kunci, { ...entri, promise });
  return promise;
}

/**
 * Laporan keuangan lengkap untuk user yang login. `data` null selama
 * loading pertama / kalau request gagal (lihat `error`).
 */
export function useFinancialStatements(opts: { tahun?: number | null; sampaiBulan?: number | null } = {}): {
  data: FinancialStatements | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const q: FsQuery = { clientId: user?.id ?? null, tahun: opts.tahun, sampaiBulan: opts.sampaiBulan };
  const kunci = kunciCache(q);
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    pendengar.add(fn);
    return () => { pendengar.delete(fn); };
  }, []);

  useEffect(() => {
    if (authLoading || !q.clientId) return;
    const entri = cache.get(kunci);
    if (!entri?.data && !entri?.promise && !entri?.error) muat(q).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, authLoading, versiCache]);

  const refresh = useCallback(() => {
    cache.delete(kunci);
    muat(q).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci]);

  const entri = cache.get(kunci);
  return {
    data: entri?.data ?? null,
    loading: authLoading || (!!q.clientId && !entri?.data && !entri?.error),
    error: entri?.error ?? null,
    refresh,
  };
}
