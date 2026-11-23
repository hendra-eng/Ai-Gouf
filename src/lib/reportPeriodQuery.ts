// Periode report lewat alamat halaman: Tahun + "Sampai bulan" (kumulatif sejak 1 Januari).
// Dipakai halaman Reports (kartu -> "Open Report") dan halaman laporan yang membacanya.
//
//   /reports/trial-balance?year=2026&month=10
//   /reports/adjustment?year=2026&month=10
//   /reports/general-ledger?start=2026-01-01&end=2026-10-31   (GL & Journal Report memakai rentang tanggal)

export interface ReportPeriodParams {
  year: number;
  /** 1-12: periode = 1 Januari `year` s.d. akhir bulan ini. */
  month: number;
}

/** Baca ?year=&month= dari query string. Tidak valid / tidak lengkap -> null. */
export function readReportPeriodParams(search: string): ReportPeriodParams | null {
  const p = new URLSearchParams(search);
  const y = Number(p.get('year'));
  const m = Number(p.get('month'));
  if (!Number.isInteger(y) || y < 1900 || y > 9999) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

const dua = (n: number) => String(n).padStart(2, '0');

/** 1 Januari s.d. akhir bulan, format yyyy-mm-dd. */
export function reportPeriodRange(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-01-01`, end: `${year}-${dua(month)}-${dua(lastDay)}` };
}

/** Tambahkan periode ke href report. Href lain (bukan 3 report di bawah) dibiarkan. */
export function withReportPeriod(href: string, year: number, month: number): string {
  if (href === '/reports/trial-balance' || href === '/reports/adjustment') {
    return `${href}?year=${year}&month=${month}`;
  }
  if (href === '/reports/general-ledger' || href === '/reports/journal-report') {
    const { start, end } = reportPeriodRange(year, month);
    return `${href}?start=${start}&end=${end}`;
  }
  return href;
}
