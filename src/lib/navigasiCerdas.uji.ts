// navigasiCerdas.uji.ts — uji lapis AI navigasi tanpa memanggil AI sungguhan.
// Jalankan:  npx tsx src/lib/navigasiCerdas.uji.ts   (keluar kode 1 bila ada yang gagal)

import { kandidatUntukAI } from './navigasiSuara';
import {
  AMBANG_BUKA,
  daftarPelajaranNav,
  dipelajariNav,
  layakTanyaNavigasi,
  lupakanPelajaranNav,
  putuskanNav,
  resetPenanyaNav,
  tanyaMaksudNavigasi,
  type HasilMaksudNav,
} from './navigasiCerdas';

let gagal = 0;
let total = 0;
const cek = (nama: string, ok: boolean) => {
  total++;
  if (!ok) {
    gagal++;
    console.log('  GAGAL:', nama);
  }
};
const norm = (t: string) => t.toLowerCase().replace(/[.,!?;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
const NERACA = '/financial-statements/balance-sheet';
const LR = '/financial-statements/profit-loss';

async function main() {
  console.log('1) Kandidat: AI hanya dipanggil bila aturan lokal ragu DAN ada tujuan yang disebut');
  const k1 = kandidatUntukAI(norm('neraca dong'));
  cek('"neraca dong" -> kandidat Neraca', k1.length >= 1 && k1[0].path === NERACA);
  cek('"oke sekarang laba rugi" tanpa kata kerja -> kandidat Laba Rugi', kandidatUntukAI(norm('oke laba rugi nya')).some((k) => k.path === LR));
  cek('"buka neraca" (sudah jelas) -> tanpa AI', kandidatUntukAI(norm('buka neraca')).length === 0);
  cek('"apa itu neraca" (jelas pertanyaan) -> tanpa AI', kandidatUntukAI(norm('apa itu neraca')).length === 0);
  cek('"jangan buka neraca" (jelas batal) -> tanpa AI', kandidatUntukAI(norm('jangan buka neraca')).length === 0);
  cek('"tadi aku buka neraca" (cerita) -> tanpa AI', kandidatUntukAI(norm('tadi aku buka neraca')).length === 0);
  cek('obrolan tanpa nama halaman -> tanpa AI', kandidatUntukAI(norm('hari ini cuacanya panas banget')).length === 0);
  cek('maksimal 6 kandidat', kandidatUntukAI(norm('neraca laba rugi arus kas piutang utang aset pajak penjualan'), 6).length <= 6);
  const kMirip = kandidatUntukAI(norm('neraka dong'));
  cek('salah dengar "neraka dong" -> tetap ada kandidat Neraca', kMirip.some((k) => k.path === NERACA));
  cek('id kandidat = path (AI tidak bisa mengarang rute)', k1.every((k) => k.id === k.path && k.path.startsWith('/')));

  console.log('2) Gerbang');
  cek('tanpa kandidat -> tidak ditanyakan', !layakTanyaNavigasi('neraca dong', []));
  cek('pengisi tunggal -> tidak ditanyakan', !layakTanyaNavigasi('oke', k1));
  cek('kalimat sangat panjang -> tidak ditanyakan', !layakTanyaNavigasi(('neraca ' + 'bla '.repeat(30)).trim(), k1));
  cek('"neraca dong" layak', layakTanyaNavigasi('neraca dong', k1));

  console.log('3) Keputusan & ambang keyakinan');
  const h = (maksud: HasilMaksudNav['maksud'], tujuan: string, yakin: number): HasilMaksudNav => ({ maksud, tujuan, yakin });
  cek('buka yakin tinggi -> buka', putuskanNav(h('buka', NERACA, 0.9), k1)?.aksi === 'buka');
  cek('buka yakin rendah -> tidak pindah', putuskanNav(h('buka', NERACA, AMBANG_BUKA - 0.05), k1) === null);
  cek('buka dengan tujuan di luar kandidat -> tidak pindah', putuskanNav(h('buka', '/admin/hapus', 0.99), k1) === null);
  cek('bukan -> tidak pindah', putuskanNav(h('bukan', '', 0.99), k1) === null);
  cek('batal yakin -> batal', putuskanNav(h('batal', '', 0.9), k1)?.aksi === 'batal');
  cek('null -> tidak pindah', putuskanNav(null, k1) === null);

  console.log('4) Penanya: cache, batas, kegagalan');
  resetPenanyaNav();
  let panggilan = 0;
  const palsu = (hasil: HasilMaksudNav | null) => async () => {
    panggilan++;
    return hasil;
  };
  let r = await tanyaMaksudNavigasi('neraca dong', k1, '/', '', palsu(h('buka', NERACA, 0.95)));
  cek('AI dipanggil dan hasilnya dikembalikan', r?.maksud === 'buka' && panggilan === 1);
  r = await tanyaMaksudNavigasi('neraca dong', k1, '/', '', palsu(h('bukan', '', 0.9)));
  cek('ucapan yang sama dari cache (tidak memanggil lagi)', r?.maksud === 'buka' && panggilan === 1);
  resetPenanyaNav();
  r = await tanyaMaksudNavigasi('laba rugi aja', kandidatUntukAI(norm('laba rugi aja')), '/', '', async () => {
    throw new Error('jaringan putus');
  });
  cek('AI error -> null (tidak pindah)', r === null);
  resetPenanyaNav();
  r = await tanyaMaksudNavigasi('laba rugi aja', kandidatUntukAI(norm('laba rugi aja')), '/', '', palsu(null));
  cek('AI tidak menjawab -> null', r === null);
  resetPenanyaNav();
  panggilan = 0;
  await tanyaMaksudNavigasi('neraca dong', k1, '/', '', palsu(h('bukan', '', 0.9)));
  const r2 = await tanyaMaksudNavigasi('arus kas dong', kandidatUntukAI(norm('arus kas dong')), '/', '', palsu(h('bukan', '', 0.9)));
  cek('dua panggilan beruntun cepat: yang kedua ditahan (jeda)', r2 === null && panggilan === 1);

  console.log('5) Belajar');
  resetPenanyaNav();
  lupakanPelajaranNav();
  await tanyaMaksudNavigasi('neraca dong', k1, '/', '', palsu(h('buka', NERACA, 0.95)));
  cek('"buka" yang sangat yakin diingat', dipelajariNav('neraca dong', k1)?.path === NERACA);
  cek('diingat per kalimat (kalimat lain tidak ikut)', dipelajariNav('laba rugi dong', k1) === null);
  cek('kalimat sama dengan huruf besar / tanda baca tetap dikenali', dipelajariNav('Neraca, dong!', k1)?.path === NERACA);
  cek('tidak dikenali bila tujuannya tak lagi jadi kandidat', dipelajariNav('neraca dong', kandidatUntukAI(norm('laba rugi dong'))) === null);
  resetPenanyaNav();
  await tanyaMaksudNavigasi('arus kas ya', kandidatUntukAI(norm('arus kas ya')), '/', '', palsu(h('buka', '/financial-statements/cash-flow', 0.82)));
  cek('yakin sedang (0.82) TIDAK diingat', !daftarPelajaranNav().some(([u]) => u === 'arus kas ya'));
  resetPenanyaNav();
  await tanyaMaksudNavigasi('piutang aja', kandidatUntukAI(norm('piutang aja')), '/', '', palsu(h('bukan', '', 0.99)));
  cek('"bukan" tidak pernah diingat', !daftarPelajaranNav().some(([u]) => u === 'piutang aja'));
  lupakanPelajaranNav('neraca dong');
  cek('lupakan satu kalimat', dipelajariNav('neraca dong', k1) === null);

  console.log(`\n${total - gagal}/${total} lulus`);
  process.exit(gagal ? 1 : 0);
}

main();
