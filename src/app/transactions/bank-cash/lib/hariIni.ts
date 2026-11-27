// Tanggal "hari ini" menurut jam perangkat pengguna, format YYYY-MM-DD.
// JANGAN pakai new Date().toISOString().slice(0, 10): itu tanggal UTC, jadi di Indonesia (UTC+7/+8)
// antara pukul 00:00 s.d. 07:00/08:00 hasilnya masih tanggal kemarin.
// Dipakai sebagai cadangan kalau backend belum mengirim is_overdue (status overdue dihitung backend).
export function hariIniLokal(): string {
  const d = new Date();
  const dua = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}
