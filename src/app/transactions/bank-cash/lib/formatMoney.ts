// Format nominal untuk modul Cash & Bank: SELALU lengkap dengan koma desimal, mis. Rp 444.050,00.
// (Kas & bank dicocokkan sampai sen/rupiah, jadi nominal tidak boleh dipendekkan atau dibulatkan.)
//
// Format ringkas (Rb / Jt / M / T) hanya dipakai untuk sumbu & label GRAFIK lewat `formatIDRChart`.

import { formatIDR as formatIDRRingkas } from '../../lib/groupAnalytics';

const FORMAT_PENUH = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Rp 1.234.567,89. Parameter kedua (compact) sengaja diabaikan supaya pemanggil lama tetap kompatibel. */
export function formatIDR(amount: number, _compact?: boolean): string {
  if (!Number.isFinite(amount)) return '—';
  return FORMAT_PENUH.format(amount);
}

/** Hanya untuk sumbu/label grafik: boleh ringkas (Rb, Jt, M, T). */
export const formatIDRChart = (amount: number): string => formatIDRRingkas(amount, true);

/** Angka tanpa awalan Rp, 2 desimal: 1.234.567,89 (untuk pesan/teks biasa). */
export const formatAngka = (amount: number): string =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
