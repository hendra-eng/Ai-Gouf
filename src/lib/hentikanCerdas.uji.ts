// hentikanCerdas.uji.ts — jalankan:  npx tsx src/lib/hentikanCerdas.uji.ts
// Menguji logika lapisan "paham maksud" TANPA memanggil AI sungguhan (penanya dipalsukan).
import {
  AMBANG_BERHENTI, daftarPelajaran, layakTanyaMaksud, lupakanPelajaran, pelajari, putuskan, resetPenanya, sudahDipelajari,
  tanyaMaksudBerhenti, type HasilMaksud, type PenanyaMaksud,
} from './hentikanCerdas';

declare const process: { exit(code?: number): never };
let total = 0;
let gagal = 0;
const cek = (nama: string, ok: boolean) => { total++; if (!ok) { gagal++; console.log('  GAGAL:', nama); } };
const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasil = (maksud: HasilMaksud['maksud'], yakin: number, sisa = ''): HasilMaksud => ({ maksud, yakin, sisa });

async function main() {
  console.log('1) Gerbang: kapan perlu menanyakan ke AI');
  for (const k of ['hmm iya iya aku udah ngerti kok', 'eh bentar saldo kas berapa', 'intinya aja', 'oke makasih neo', 'next']) cek(`layak: "${k}"`, layakTanyaMaksud(k));
  for (const k of ['', 'hmm', 'oke', 'ya', 'iya iya oke', 'eh', 'ok ya', 'a', 'kata '.repeat(41)]) cek(`tidak layak: "${k.slice(0, 20)}"`, !layakTanyaMaksud(k));

  console.log('2) Ambang keyakinan');
  cek('berhenti 0.9 -> berhenti', putuskan(hasil('berhenti', 0.9)).berhenti);
  cek('berhenti tepat di ambang -> berhenti', putuskan(hasil('berhenti', AMBANG_BERHENTI)).berhenti);
  cek('berhenti 0.5 -> TIDAK', !putuskan(hasil('berhenti', 0.5)).berhenti);
  cek('lanjut 0.99 -> TIDAK', !putuskan(hasil('lanjut', 0.99)).berhenti);
  cek('abaikan 0.99 -> TIDAK', !putuskan(hasil('abaikan', 0.99)).berhenti);
  cek('null -> TIDAK', !putuskan(null).berhenti);
  const bl = putuskan(hasil('berhenti_lalu_minta', 0.9, 'saldo kas berapa'));
  cek('berhenti_lalu_minta 0.9 -> berhenti + sisa', bl.berhenti && bl.sisa === 'saldo kas berapa');
  cek('berhenti_lalu_minta 0.72 -> TIDAK (lebih ketat)', !putuskan(hasil('berhenti_lalu_minta', 0.72, 'x')).berhenti);

  console.log('3) Belajar & ingatan');
  lupakanPelajaran(); resetPenanya();
  let panggilan = 0;
  const ya: PenanyaMaksud = async () => { panggilan++; return hasil('berhenti', 0.95); };
  const h1 = await tanyaMaksudBerhenti('hmm iya iya aku udah ngerti kok', 'konteks', ya);
  cek('AI dipanggil & hasil dikembalikan', panggilan === 1 && h1?.maksud === 'berhenti');
  cek('kalimat itu sekarang DIPELAJARI', sudahDipelajari('Hmm, iya iya aku udah ngerti kok!'));
  const h2 = await tanyaMaksudBerhenti('hmm iya iya aku udah ngerti kok', 'konteks', ya);
  cek('panggilan kedua dari cache (AI tidak dipanggil lagi)', panggilan === 1 && h2?.maksud === 'berhenti');
  cek('kalimat lain TIDAK ikut dipelajari', !sudahDipelajari('hmm iya iya aku udah ngerti kok neo'));

  lupakanPelajaran(); resetPenanya();
  await tanyaMaksudBerhenti('mungkin cukup segini dulu deh sepertinya', '', async () => hasil('berhenti', 0.75));
  cek('keyakinan 0.75 (< 0.85) tidak dipelajari', !sudahDipelajari('mungkin cukup segini dulu deh sepertinya'));
  resetPenanya(); await tidur(10);
  await tanyaMaksudBerhenti('terus gimana lanjutannya dong', '', async () => hasil('lanjut', 0.99));
  cek('maksud "lanjut" tidak pernah dipelajari', !sudahDipelajari('terus gimana lanjutannya dong'));
  resetPenanya();
  await tanyaMaksudBerhenti('eh bentar saldo kas berapa', '', async () => hasil('berhenti_lalu_minta', 0.99, 'saldo kas berapa'));
  cek('berhenti_lalu_minta tidak dipelajari (ada isi permintaan)', !sudahDipelajari('eh bentar saldo kas berapa'));
  pelajari('apakah sudah cukup?');
  cek('kalimat tanya tidak dipelajari', !sudahDipelajari('apakah sudah cukup?'));
  pelajari('kata '.repeat(9));
  cek('kalimat panjang (> 8 kata) tidak dipelajari', !sudahDipelajari('kata '.repeat(9)));
  lupakanPelajaran();
  cek('lupakanPelajaran() mengosongkan', daftarPelajaran().length === 0);

  console.log('4) Pengaman');
  resetPenanya();
  let n = 0;
  const lambat: PenanyaMaksud = async () => { n++; await tidur(60); return hasil('abaikan', 0.9); };
  const [a, b] = await Promise.all([tanyaMaksudBerhenti('ucapan pertama yang agak panjang', '', lambat), tanyaMaksudBerhenti('ucapan kedua yang lain lagi', '', lambat)]);
  cek('hanya satu permintaan dalam satu waktu', n === 1 && a !== null && b === null);

  resetPenanya();
  const rusak: PenanyaMaksud = async () => { throw new Error('jaringan putus'); };
  cek('penanya melempar error -> null (tidak crash)', (await tanyaMaksudBerhenti('ucapan apa saja deh ini', '', rusak)) === null);
  await tidur(720);
  cek('setelah error, penanya bisa dipakai lagi', (await tanyaMaksudBerhenti('ucapan lain lagi nih', '', async () => hasil('abaikan', 0.8))) !== null);

  resetPenanya();
  let dipanggil = false;
  await tanyaMaksudBerhenti('hmm', '', async () => { dipanggil = true; return null; });
  cek('gumaman tidak membuang panggilan AI', !dipanggil);

  resetPenanya();
  let jumlah = 0;
  const hitung: PenanyaMaksud = async () => { jumlah++; return hasil('abaikan', 0.9); };
  for (let i = 0; i < 12; i++) { await tanyaMaksudBerhenti(`ucapan unik nomor ${i} untuk uji batas`, '', hitung); await tidur(710); if (i === 8) break; }
  cek('maks 8 panggilan AI per menit', jumlah === 8);

  console.log(`\nTotal pengujian: ${total}, gagal: ${gagal}`);
  process.exit(gagal ? 1 : 0);
}
main();