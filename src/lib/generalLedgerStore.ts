// Data layer report "General Ledger" (src/app/reports/general-ledger),
// terhubung ke backend/modules/financial_statements/general_ledger_v1.py:
// GET /api/v1/reports/general-ledger.
//
// Sumber backend = transaksi POSTED (Journal Entry termasuk Opening Balance &
// Cash & Bank, Sales, Purchase) -- sama dengan Financial Statements. Saldo
// dikirim BERTANDA (debit - kredit); komponen menampilkannya sebagai Dr/Cr.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const GL_URL = `${API_BASE_URL}/api/v1/reports/general-ledger`;

export type GlInclude = 'with_activity' | 'non_zero' | 'all' | 'selected';

export interface GlLine {
  date: string;
  source: string;
  number: string;
  description: string;
  party: string;
  debit: number;
  credit: number;
  /** Saldo berjalan bertanda (debit - kredit). */
  balance: number;
  /** Akun PNL: baris pertama tahun baru dalam periode -- saldo mulai lagi dari 0. */
  year_reset?: boolean;
}

/** Rekap per bulan akun posisi keuangan (kepala kode 1-3). */
export interface GlMonth {
  /** YYYY-MM */
  month: string;
  debit: number;
  credit: number;
  closing_balance: number;
}

export interface GlAccount {
  account_code: string;
  account_name: string;
  classification: string | null;
  normal_balance: 'DEBIT' | 'CREDIT';
  /** ytd = akun PNL (kepala 4-9), terakumulasi sejak `accumulated_from`;
   *  cumulative = akun posisi keuangan (kepala 1-3), dilaporkan per bulan. */
  balance_basis: 'ytd' | 'cumulative';
  accumulated_from: string | null;
  monthly: GlMonth[];
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  line_count: number;
  lines: GlLine[];
}

export interface GeneralLedger {
  accounts: GlAccount[];
  totals: { accounts: number; lines: number; debit: number; credit: number };
  filter: {
    start_date: string;
    end_date: string;
    include: GlInclude;
    account_codes: string[];
    management_client_id: string | null;
    client_id: string | null;
  };
}

export interface GlQuery {
  managementClientId: string;
  startDate: string;
  endDate: string;
  include: GlInclude;
  accountCodes?: string[];
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
}

export async function fetchGeneralLedger(q: GlQuery, signal?: AbortSignal): Promise<GeneralLedger> {
  const params = new URLSearchParams({
    management_client_id: q.managementClientId,
    start_date: q.startDate,
    end_date: q.endDate,
    include: q.include,
  });
  if (q.include === 'selected' && q.accountCodes?.length) params.set('account_codes', q.accountCodes.join(','));
  const res = await fetch(`${GL_URL}?${params}`, { signal, cache: 'no-store' });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<GeneralLedger> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as GeneralLedger;
}
