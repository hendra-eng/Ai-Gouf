import type { AccountClassification, NormalBalance } from '@/lib/coaStore';

// Warna per klasifikasi -- dipakai badge tabel, chip filter, & preview form.
// `dot` = titik warna kecil, `badge` = pill (bg lembut + teks), `ring` = garis
// tepi saat chip terpilih.
export const CLASSIFICATION_THEME: Record<string, { dot: string; badge: string; ring: string }> = {
  ASSET: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 ring-blue-600/15', ring: 'ring-blue-500/40 bg-blue-50/60' },
  LIABILITY: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 ring-amber-600/15', ring: 'ring-amber-500/40 bg-amber-50/60' },
  EQUITY: { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 ring-violet-600/15', ring: 'ring-violet-500/40 bg-violet-50/60' },
  REVENUE: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', ring: 'ring-emerald-500/40 bg-emerald-50/60' },
  'COST OF SALES': { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 ring-orange-600/15', ring: 'ring-orange-500/40 bg-orange-50/60' },
  EXPENSE: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 ring-red-600/15', ring: 'ring-red-500/40 bg-red-50/60' },
  'OTHER INCOME': { dot: 'bg-teal-500', badge: 'bg-teal-50 text-teal-700 ring-teal-600/15', ring: 'ring-teal-500/40 bg-teal-50/60' },
  'OTHER EXPENSE': { dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 ring-rose-600/15', ring: 'ring-rose-500/40 bg-rose-50/60' },
  'INCOME TAX': { dot: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700 ring-slate-600/15', ring: 'ring-slate-500/40 bg-slate-100/60' },
};

export const FALLBACK_THEME = { dot: 'bg-slate-400', badge: 'bg-muted text-muted-foreground ring-border', ring: 'ring-border bg-slate-50' };

export function themeOf(classification: string | null | undefined) {
  return (classification && CLASSIFICATION_THEME[classification]) || FALLBACK_THEME;
}

// Saldo normal default per klasifikasi -- sama dengan aturan di
// backend/migrations/generate_seed_coa.py::normal_balance() (tanpa akun kontra;
// untuk akun kontra user tinggal ganti manual).
export const DEFAULT_NORMAL_BALANCE: Record<AccountClassification, NormalBalance> = {
  ASSET: 'DEBIT',
  'COST OF SALES': 'DEBIT',
  EXPENSE: 'DEBIT',
  'OTHER EXPENSE': 'DEBIT',
  'INCOME TAX': 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  'OTHER INCOME': 'CREDIT',
};

/** Judul kapital (ASSET -> Asset, COST OF SALES -> Cost of Sales) untuk label UI. */
export function labelClassification(c: string): string {
  return c.toLowerCase().replace(/\b\w/g, m => m.toUpperCase()).replace(/\bOf\b/g, 'of');
}
