// tugasKantor.uji.ts — uji ATURAN MUTLAK: upload file Sales selalu dikerjakan Atlas (Neo/Zeno/tanpa nama menyerahkan, bukan menolak).
// Jalankan:  npx tsx src/lib/tugasKantor.uji.ts
// Keluar dengan kode 1 kalau ada yang salah.

import { bacaPerintahProsesFile, bacaPerintahProsesFileTanpaHalaman, pelaksanaUpload } from './tugasKantor';

const norm = (t: string) => t.toLowerCase().replace(/[.,!?;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
let total = 0;
const gagal: string[] = [];
function sama(nama: string, dapat: unknown, harapan: unknown) {
  total++;
  if (JSON.stringify(dapat) !== JSON.stringify(harapan)) gagal.push(`${nama}\n   harapan: ${JSON.stringify(harapan)}\n   dapat  : ${JSON.stringify(dapat)}`);
}

// ---- siapa yang akhirnya mengerjakan
sama('Sales + Neo -> Atlas', pelaksanaUpload('Neo', 0), 'Atlas');
sama('Sales + Zeno -> Atlas', pelaksanaUpload('Zeno', 0), 'Atlas');
sama('Sales + Atlas -> Atlas', pelaksanaUpload('Atlas', 0), 'Atlas');
sama('Purchase + Neo tetap Neo', pelaksanaUpload('Neo', 1), 'Neo');
sama('Other + Zeno tetap Zeno', pelaksanaUpload('Zeno', 4), 'Zeno');

// ---- perintah lengkap (halaman disebut)
const pf = (u: string) => bacaPerintahProsesFile(norm(u));
sama('Atlas upload ke halaman sales', pf('Atlas, upload file ke halaman sales untuk klien SAU'), { agen: 'Atlas', meja: 0 });
sama('Neo upload ke halaman sales', pf('Neo, upload file ke halaman sales untuk klien SAU'), { agen: 'Neo', meja: 0 });
sama('Zeno upload ke sales', pf('Zeno tolong upload file ke halaman sales'), { agen: 'Zeno', meja: 0 });
sama('tanpa nama agen -> Neo (yang diajak bicara)', pf('upload file ke halaman sales untuk klien SAU'), { agen: 'Neo', meja: 0 });
sama('tanpa nama, di sales', pf('tolong unggah file ini di sales'), { agen: 'Neo', meja: 0 });
sama('tanpa nama, purchase', pf('upload file ke halaman purchase'), { agen: 'Neo', meja: 1 });

// ---- BUKAN perintah proses file
sama('posting jurnal biasa (tanpa kata file)', pf('posting jurnal ke halaman sales'), null);
sama('pertanyaan makna', pf('apa itu upload file'), null);
sama('dibatalkan', pf('jangan upload file ke sales'), null);
sama('nama halaman di nama file saja', pf('upload file penjualan oktober'), null);

// ---- upload tanpa halaman -> Neo bertanya halaman (bukan menolak)
const th = (u: string) => bacaPerintahProsesFileTanpaHalaman(norm(u));
sama('upload file dong', th('upload file dong'), { agen: 'Neo' });
sama('Atlas upload file yang barusan', th('Atlas tolong upload file yang barusan'), { agen: 'Atlas' });
sama('halaman sudah disebut -> bukan kasus ini', th('upload file ke halaman sales'), null);
sama('tanpa kata file', th('upload dong'), null);
sama('batal', th('jangan upload file'), null);

if (gagal.length) {
  console.error(`GAGAL ${gagal.length}/${total}:\n` + gagal.join('\n'));
  process.exit(1);
}
console.log(`SEMUA LULUS (${total} uji)`);