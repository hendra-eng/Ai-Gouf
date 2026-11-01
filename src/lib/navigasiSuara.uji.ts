// navigasiSuara.uji.ts — uji pemahaman perintah pindah halaman/tab lewat suara.
// Jalankan:  npx tsx src/lib/navigasiSuara.uji.ts   (atau: node --experimental-strip-types src/lib/navigasiSuara.uji.ts, ubah import jadi ".ts")
// Keluar dengan kode 1 kalau ada kalimat yang salah dipahami.

import { bacaNavigasi } from './navigasiSuara';
import { CONTOH_TERTULIS, GAYA_BATAL, GAYA_BUKAN_PERINTAH, GAYA_PERINTAH, TUJUAN } from './navigasiSuara.contoh';

// sama seperti normalisasi() di VoiceAssistant.tsx: huruf kecil, tanpa tanda baca
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Gagal = { kelompok: string; u: string; harapan: string; dapat: string };
const gagal: Gagal[] = [];
let total = 0;

function hasilSingkat(u: string): string {
  const r = bacaNavigasi(norm(u), '/');
  if (!r) return 'null';
  if (r.jenis === 'buka') return r.path;
  return r.jenis;
}

function uji(kelompok: string, u: string, harapan: string | null) {
  total++;
  const dapat = hasilSingkat(u);
  const h = harapan === null ? 'null' : harapan;
  // "null" = Neo tidak boleh pindah: 'null' atau 'batal' sama-sama aman
  const ok = harapan === null ? dapat === 'null' || dapat === 'batal' : dapat === h;
  if (!ok) gagal.push({ kelompok, u, harapan: h, dapat });
}

// 1) templat perintah x tujuan
for (const [gaya, daftar] of Object.entries(GAYA_PERINTAH)) {
  for (const t of daftar) for (const [x, path] of TUJUAN) uji(`perintah/${gaya}`, t.replace('{x}', x), path);
}
// 2) templat BUKAN perintah x tujuan
for (const [gaya, daftar] of Object.entries(GAYA_BUKAN_PERINTAH)) {
  for (const t of daftar) for (const [x] of TUJUAN) uji(`bukan-perintah/${gaya}`, t.replace('{x}', x), null);
}
// 3) pembatalan x tujuan: harus 'batal'
for (const t of GAYA_BATAL) for (const [x] of TUJUAN) uji('batal', t.replace('{x}', x), 'batal');
// 4) kalimat tertulis
for (const c of CONTOH_TERTULIS) uji('tertulis', c.u, c.ke);

const jumlahTemplat =
  Object.values(GAYA_PERINTAH).reduce((a, b) => a + b.length, 0) +
  Object.values(GAYA_BUKAN_PERINTAH).reduce((a, b) => a + b.length, 0) +
  GAYA_BATAL.length;
console.log(`templat: ${jumlahTemplat}, tujuan: ${TUJUAN.length}, kalimat tertulis: ${CONTOH_TERTULIS.length}`);
console.log(`diuji: ${total} ucapan | benar: ${total - gagal.length} | salah: ${gagal.length}`);

// ringkasan per kelompok
const per: Record<string, { n: number; salah: number }> = {};
void per;
if (gagal.length) {
  const kelompok = new Map<string, Gagal[]>();
  for (const g of gagal) kelompok.set(g.kelompok, [...(kelompok.get(g.kelompok) ?? []), g]);
  for (const [k, arr] of kelompok) {
    console.log(`\n[${k}] ${arr.length} salah`);
    for (const g of arr.slice(0, 6)) console.log(`  "${g.u}"  harapan=${g.harapan}  dapat=${g.dapat}`);
    if (arr.length > 6) console.log(`  ... +${arr.length - 6} lagi`);
  }
  process.exit(1);
}
