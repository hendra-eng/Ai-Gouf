// Helper tampilan nama perusahaan.
//
// Aturan: nama client di database boleh diawali "PT" atau "CV" (mis. "PT Nusa Penida
// Investments", "CV Sumber Alodie Utama"). Di aplikasi, nama yang TAMPIL hanya nama
// perusahaannya saja ("Nusa Penida Investments"), sedangkan bentuk badan usahanya
// ("PT" / "CV") ditampilkan terpisah (mis. di lingkaran hijau pada Switch Company).
//
// Nama tanpa awalan dianggap "PT" (hampir semua client berbentuk PT; yang CV tertulis
// "CV ..." di nama, jadi awalan itulah yang menentukan).
//
// Hanya untuk TAMPILAN. Jangan dipakai untuk ekspor / laporan resmi / pencarian -- di sana
// nama lengkap dari database tetap dipakai apa adanya.

export type BadanUsaha = 'PT' | 'CV';

// "PT Nusa", "pt nusa", "PT. Nusa", "PT.Nusa" -> cocok. "PTI Group" / "CVX" -> tidak cocok
// (harus diikuti titik atau spasi, lalu ada isi nama).
const AWALAN_BADAN_USAHA = /^\s*(PT|CV)(?:\s*\.\s*|\s+)(?=\S)/i;

export function pisahBadanUsaha(namaLengkap: string | null | undefined): { badan: BadanUsaha; nama: string } {
  const teks = (namaLengkap ?? '').trim();
  const m = teks.match(AWALAN_BADAN_USAHA);
  if (!m) return { badan: 'PT', nama: teks };
  return { badan: m[1].toUpperCase() as BadanUsaha, nama: teks.slice(m[0].length).trim() };
}

/** Nama perusahaan tanpa awalan PT/CV (untuk ditampilkan). */
export function namaTanpaBadanUsaha(namaLengkap: string | null | undefined): string {
  return pisahBadanUsaha(namaLengkap).nama;
}