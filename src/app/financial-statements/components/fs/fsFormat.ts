// Format angka & tautan drill-down bersama halaman Financial Statements
// berbasis mapping (Task Plan 16-20).

/** Format akuntansi: 1.234.567 ; negatif (1.234.567) ; nol "–". */
export function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (Math.abs(n) < 0.005) return '–';
  const s = Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

export function variance(cur: number, prev: number | null | undefined): { abs: number; pct: number | null } | null {
  if (prev === null || prev === undefined) return null;
  const abs = cur - prev;
  return { abs, pct: Math.abs(prev) >= 0.005 ? (abs / Math.abs(prev)) * 100 : null };
}

export function fmtPct(p: number | null): string {
  if (p === null) return '–';
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

/** Drill-down akun -> halaman General Ledger (auto-apply filter akun & tanggal). */
export function glHref(code: string, start: string, end: string): string {
  const p = new URLSearchParams({ account: code, start, end });
  return `/reports/general-ledger?${p}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Awal tahun dari tanggal ISO -- rentang GL untuk akun neraca per tanggal tertentu. */
export function startOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`;
}

export const SECTION_TONE: Record<string, string> = {
  current_assets: 'text-blue-700',
  non_current_assets: 'text-blue-700',
  current_liabilities: 'text-amber-700',
  non_current_liabilities: 'text-amber-700',
  equity: 'text-violet-700',
};
