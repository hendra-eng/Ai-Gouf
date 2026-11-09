// sapaanAgen.uji.ts — jalankan:  npx tsx src/lib/sapaanAgen.uji.ts
// Keluar dengan kode 1 kalau ada yang salah.
import { bacaSapaan, susunBalasan, susunBalasanSerempak, type HasilSapaan } from './sapaanAgen';
import { CONTOH_SEMUA, CONTOH_SATU, CONTOH_TANPA_NAMA, CONTOH_CEK_HADIR, CONTOH_PANGGIL, CONTOH_BUKAN_SAPAAN, type ContohSapaan } from './sapaanAgen.contoh';

declare const process: { exit(code?: number): never };
let gagal = 0;
let total = 0;
const lapor = (m: string) => { gagal++; console.log('  GAGAL:', m); };

function cekDaftar(judul: string, daftar: ContohSapaan[]) {
  let salah = 0;
  for (const [u, kepada, gaya, basa] of daftar) {
    total++;
    const h = bacaSapaan(u);
    const ok = !!h && h.jenis === 'sapaan' && JSON.stringify(h.kepada) === JSON.stringify(kepada) && h.gaya === gaya && h.basa === basa;
    if (!ok) { salah++; lapor(`"${u}" -> ${JSON.stringify(h)} (harapan kepada=${kepada} gaya=${gaya} basa=${basa})`); }
  }
  console.log(`  ${judul}: ${daftar.length - salah}/${daftar.length}`);
}

console.log('1) Sapaan ke semua');
for (const [k, d] of Object.entries(CONTOH_SEMUA)) cekDaftar(k, d);
console.log('2) Sapaan ke satu / dua agen');
for (const [k, d] of Object.entries(CONTOH_SATU)) cekDaftar(k, d);
console.log('3) Tanpa nama');
cekDaftar('tanpa nama', CONTOH_TANPA_NAMA);

console.log('4) Cek kehadiran');
for (const [u, kepada] of CONTOH_CEK_HADIR) {
  total++;
  const h = bacaSapaan(u);
  const ke = h && h.kepada;
  // "kepada" bisa kosong bila pengguna hanya bertanya tanpa nama; di contoh ini nama selalu ada / kelompok
  if (!h || h.jenis !== 'cek_hadir' || JSON.stringify(ke) !== JSON.stringify(kepada)) lapor(`"${u}" -> ${JSON.stringify(h)}`);
}

console.log('4b) Hanya memanggil nama');
for (const [x, kepada] of CONTOH_PANGGIL) {
  total++;
  const h = bacaSapaan(x);
  if (!h || h.jenis !== 'panggil' || JSON.stringify(h.kepada) !== JSON.stringify(kepada)) lapor(`"${x}" -> ${JSON.stringify(h)} (harapan panggil ${kepada})`);
}

console.log('5) BUKAN sapaan murni');
let salahBukan = 0;
for (const u of CONTOH_BUKAN_SAPAAN) { total++; const h = bacaSapaan(u); if (h) { salahBukan++; lapor(`"${u}" salah dianggap sapaan: ${JSON.stringify(h)}`); } }
console.log(`  ${CONTOH_BUKAN_SAPAAN.length - salahBukan}/${CONTOH_BUKAN_SAPAAN.length}`);

console.log('6) Balasan');
const semua = bacaSapaan('Halo semuanya apa kabar')!;
const b = susunBalasan(semua, { bahasa: 'id', jam: 9, acak: () => 0 });
total++; if (b.map((x) => x.agen).join() !== 'neo,atlas,zeno') lapor('urutan balasan harus neo,atlas,zeno');
total++; if (!b[0].teks.includes('Aku Neo') || !b[2].teks.includes('Aku Zeno')) lapor('tiap agen harus menyebut namanya saat menjawab bersama');
total++; if (b[0].teks.includes('Kamu sendiri') || !b[2].teks.includes('Kamu sendiri')) lapor('tanya balik hanya dari agen terakhir');
const satu = bacaSapaan('Halo Neo apa kabar')!;
const bs = susunBalasan(satu, { bahasa: 'id', jam: 9, acak: () => 0 });
total++; if (bs.length !== 1 || bs[0].agen !== 'neo' || /Aku Neo/.test(bs[0].teks)) lapor(`satu agen: ${JSON.stringify(bs)}`);
const islam = bacaSapaan('Assalamualaikum semuanya')!;
total++; if (!susunBalasan(islam, { bahasa: 'id', jam: 9 }).every((x) => x.teks.startsWith('Waalaikumsalam'))) lapor('salam islam harus dijawab Waalaikumsalam');
const siang = bacaSapaan('Selamat siang Atlas')!;
total++; if (!susunBalasan(siang, { bahasa: 'id', jam: 8, acak: () => 0 })[0].teks.startsWith('Selamat siang')) lapor('kata waktu pengguna harus dicerminkan');
const en = bacaSapaan('Good morning everyone')!;
total++; if (!susunBalasan(en, { bahasa: 'en', jam: 9, acak: () => 0 })[0].teks.startsWith('Good morning')) lapor('balasan Inggris');
for (const h of [semua, satu, islam, siang, en] as HasilSapaan[]) for (const x of susunBalasan(h, { bahasa: 'id', jam: 13 })) { total++; if (!x.teks.trim()) lapor('balasan kosong'); }

const pg = susunBalasan(bacaSapaan('Neo')!, { bahasa: 'id', jam: 9, acak: () => 0 });
total++; if (pg.length !== 1 || pg[0].agen !== 'neo' || !/bantu|Ada apa|apa/i.test(pg[0].teks)) lapor(`panggil Neo: ${JSON.stringify(pg)}`);
// variasi: banyak balasan berbeda untuk sapaan yang sama, dan tidak mengulang berturut-turut
const set = new Set<string>();
let prev = '';
let ulang = 0;
for (let n = 0; n < 40; n++) {
  const t = susunBalasan(bacaSapaan('Halo semuanya')!, { bahasa: 'id', jam: 9 }).map((x) => x.teks).join(' | ');
  set.add(t); if (t === prev) ulang++; prev = t;
}
total++; if (set.size < 8) lapor(`variasi balasan kurang (${set.size} ragam dari 40)`);
total++; if (ulang > 0) lapor(`balasan sama berturut-turut ${ulang}x`);
console.log(`  ragam balasan "halo semuanya": ${set.size}`);

// ---- [BARU] balasan SEREMPAK: pendek, beda tiap agen, tanpa perkenalan ----
{
    const ucapan = ['Halo semuanya', 'Selamat pagi semuanya', 'Halo semuanya apa kabar', 'Halo guys, lagi apa', 'Assalamualaikum semuanya', 'Kalian dengar aku nggak', 'Hai kalian', 'Good morning everyone'];
  for (const u of ucapan) {
    const h = bacaSapaan(u);
    for (const bhs of ['id', 'en'] as const) {
      for (let i = 0; i < 20; i++) {
        const b = susunBalasanSerempak(h!, { bahasa: bhs, jam: 9 });
        total++; if (b.length !== 3) { lapor(`serempak "${u}": harus 3 agen`); break; }
        const teks = b.map((x: { teks: string }) => x.teks.toLowerCase());
        total++; if (new Set(teks).size !== 3) lapor(`serempak "${u}": kalimat antar agen harus beda: ${teks.join(' | ')}`);
        for (const x of b) { total++; if (x.teks.split(/\s+/).length > 7) lapor(`serempak "${u}": kepanjangan: ${x.teks}`); }
      }
    }
  }
  const contoh = susunBalasanSerempak(bacaSapaan('Selamat pagi semuanya')!, { bahasa: 'id', jam: 9, acak: () => 0 });
  console.log('  contoh serempak:', contoh.map((x: { agen: string; teks: string }) => `${x.agen}: ${x.teks}`).join(' | '));
}

console.log(`\n${total - gagal}/${total} lulus`);
process.exit(gagal ? 1 : 0);
