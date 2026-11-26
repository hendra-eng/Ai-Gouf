/**
 * Transaksi TANPA tanggal ditaruh paling atas daftar (tanggalnya tampil "-"), sisanya tetap urutan semula.
 * Dipakai di Purchase (Source Data, Preview) dan Sales (Source Data). Urutan relatif antar baris tidak berubah
 * (stable partition), jadi nomor baris / urutan file tetap terbaca seperti aslinya.
 */
export function undatedFirst<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  const tanpaTanggal: T[] = [];
  const bertanggal: T[] = [];
  for (const item of items) {
    ((getDate(item) || '').trim() ? bertanggal : tanpaTanggal).push(item);
  }
  return tanpaTanggal.length > 0 ? [...tanpaTanggal, ...bertanggal] : items;
}
