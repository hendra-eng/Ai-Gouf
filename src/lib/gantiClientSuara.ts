// gantiClientSuara.ts — memahami perintah suara untuk mengganti client aktif, mis.
//   "ganti ke client sau", "pindah ke client nbm", "tolong ganti clientnya ke aadl", "switch to client sau".
// Client DIPANGGIL dengan KODE-nya (clientCode), bukan nama perusahaan. Kode itu otomatis dipetakan ke perusahaannya
// (SAU -> client SAU yang tampil di Topbar). Nama perusahaan TIDAK dipakai untuk mencocokkan.
//
// Fungsi di sini MURNI (tanpa React / tanpa AI): instan, gratis, dan hanya bisa memilih client yang
// benar-benar ada di daftar -> tidak mungkin "ngawur" pindah ke client yang tidak ada.
//
// Kenapa perlu pengenalan khusus? Speech-to-Text sering menulis kode huruf dengan cara yang berbeda:
//   "SAU"  -> "sau" / "s a u" / "es a u"
//   "NBM"  -> "nbm" / "n b m" / "en be em"
//   "A-01" -> "a 01" / "a nol satu"
// Semua variasi itu dinormalkan ke satu bentuk (huruf kecil, tanpa spasi/tanda baca) sebelum dicocokkan.

import { cariClientMirip, kandidatTeratas } from './salahDengarSuara';

export type KlienSuara = { id: string; companyName: string; clientCode: string };

export type HasilGantiClient =
  | { jenis: 'ganti'; client: KlienSuara; sudahAktif: boolean }
  | { jenis: 'tidak-ditemukan'; disebut: string }
  | { jenis: 'ambigu'; kandidat: KlienSuara[] }
  // [BARU] kode tidak persis, tapi MIRIP (salah dengar) -> Neo bertanya dulu, tidak langsung pindah
  | { jenis: 'mirip'; kandidat: KlienSuara[]; disebut: string };

// ---------- kata-kata ----------
// kata kerja "kuat": cukup jelas berarti ganti client, walau kata "client" tidak disebut ("ganti ke sau")
const KERJA_KUAT = ['ganti', 'gantikan', 'ganti ke', 'tukar', 'beralih', 'berpindah', 'ubah', 'switch', 'change', 'pilih', 'gunakan', 'pakai'];
// kata kerja "lemah": ambigu dengan navigasi halaman, jadi HANYA dianggap ganti-client bila ada kata "client"
const KERJA_LEMAH = ['pindah', 'pindahkan', 'buka', 'bukakan', 'masuk', 'menuju', 'go', 'open', 'aktifkan'];

const POLA_KERJA_KUAT = new RegExp(`\\b(?:${KERJA_KUAT.join('|')})\\b`);
const POLA_KERJA_LEMAH = new RegExp(`\\b(?:${KERJA_LEMAH.join('|')})\\b`);
// "client", "clientnya", "klien", "kliennya", "perusahaan", "company"
const POLA_KATA_CLIENT = /\b(?:client\w*|klien\w*|perusahaan\w*|company|companies|customer)\b/;

// kata yang dibuang sebelum mencari kode (sisanya = kode / nama yang disebut)
const KATA_BUANG = new Set([
  ...KERJA_KUAT.flatMap((k) => k.split(' ')),
  ...KERJA_LEMAH,
  'tolong', 'dong', 'deh', 'ya', 'yah', 'aja', 'saja', 'donk', 'lah', 'sekarang', 'langsung', 'sini', 'neo',
  'ke', 'kepada', 'jadi', 'menjadi', 'yang', 'itu', 'ini', 'nya', 'dengan', 'untuk', 'to', 'the', 'please', 'into', 'on',
  'halaman', 'page', 'menu', 'tab', 'daftar', 'list', 'semua', 'data', 'kode', 'code', 'nama', 'bernama', 'berkode', 'berkod', 'bernomor', 'nomor', 'dari', 'aktif', 'active', 'halo', 'hai', 'oke', 'ok', 'saya', 'aku', 'mau', 'ingin', 'pengen', 'minta',
]);

// nama huruf (cara orang mengeja) -> huruf. Dipakai bila STT menulis "en be em" untuk NBM.
const NAMA_HURUF: Record<string, string> = {
  a: 'a', be: 'b', bi: 'b', ce: 'c', se: 'c', si: 'c', de: 'd', di: 'd', e: 'e', ef: 'f', ge: 'g', ji: 'g', ha: 'h', ei: 'h', i: 'i', ai: 'i',
  je: 'j', jei: 'j', ka: 'k', kei: 'k', el: 'l', em: 'm', en: 'n', o: 'o', pe: 'p', pi: 'p', ki: 'q', kyu: 'q', er: 'r', ar: 'r', es: 's',
  te: 't', ti: 't', u: 'u', yu: 'u', ve: 'v', vi: 'v', fe: 'v', we: 'w', eks: 'x', ex: 'x', ye: 'y', wai: 'y', zet: 'z', zed: 'z',
};
const ANGKA: Record<string, string> = {
  nol: '0', kosong: '0', zero: '0', satu: '1', one: '1', dua: '2', two: '2', tiga: '3', three: '3', empat: '4', four: '4',
  lima: '5', five: '5', enam: '6', six: '6', tujuh: '7', seven: '7', delapan: '8', eight: '8', sembilan: '9', nine: '9',
};

// ---------- util ----------
const rapatkan = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

function normal(t: string): string {
  return t
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[-_/]/g, ' ') // "CLT-0001" -> "clt 0001"
    .replace(/[.,!?;:"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jarakEdit(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Bentuk-bentuk yang mungkin dimaksud dari token-token yang tersisa.
function buatKandidat(token: string[]): string[] {
  const hasil = new Set<string>();
  const tambah = (s: string) => { const r = rapatkan(s); if (r) hasil.add(r); };

  // 1) tiap token apa adanya ("sau"), dan semua token digabung ("n b m" -> "nbm", "a 01" -> "a01")
  token.forEach(tambah);
  tambah(token.join(''));

  // 2) ejaan huruf/angka: "en be em" -> "nbm", "a nol satu" -> "a01". Pecah di token yang BUKAN huruf/angka.
  const dieja = token.map((t) => (NAMA_HURUF[t] ?? ANGKA[t] ?? (t.length === 1 || /^\d+$/.test(t) ? t : null)));
  let seg: string[] = [];
  const tutup = () => { if (seg.length >= 2) tambah(seg.join('')); seg = []; };
  for (const d of dieja) { if (d === null) tutup(); else seg.push(d); }
  tutup();
  if (dieja.every((d) => d !== null)) tambah((dieja as string[]).join(''));

  // 3) angka dalam kata saja ("kode satu dua tiga" -> "123")
  const angka = token.map((t) => ANGKA[t] ?? (/^\d+$/.test(t) ? t : null));
  if (angka.length > 1 && angka.every((d) => d !== null)) tambah((angka as string[]).join(''));

  return [...hasil];
}

const hurufSaja = (s: string) => s.replace(/[^a-z]/g, '');

/**
 * Baca ucapan (boleh mentah) dan kembalikan hasil ganti-client, atau null bila ucapan ini BUKAN perintah
 * ganti client (diserahkan ke navigasi / AI seperti biasa).
 */
export function bacaGantiClient(
  ucapan: string,
  daftar: KlienSuara[],
  activeClientId: string | null
): HasilGantiClient | null {
  const teks = normal(ucapan);
  if (!teks) return null;
  const token = teks.split(' ');
  if (token.length > 12) return null; // perintah itu pendek; kalimat panjang = pertanyaan untuk AI

  const adaKataClient = POLA_KATA_CLIENT.test(teks);
  const kuat = POLA_KERJA_KUAT.test(teks);
  const lemah = POLA_KERJA_LEMAH.test(teks);

  // Pemicu: kata kerja kuat, ATAU kata kerja lemah + kata "client".
  if (!(kuat || (lemah && adaKataClient))) return null;

  // Sisa kata (selain kata kerja / pengisi / kata "client") = kode atau nama yang dimaksud.
  const sisa = token.filter((t) => !KATA_BUANG.has(t) && !POLA_KATA_CLIENT.test(t));
  if (sisa.length === 0) return null; // "buka halaman client" -> bukan ganti client

  // "ubah/pilih/pakai/ganti ..." tanpa kata "client" bisa jadi hal lain (mis. "ubah periode", "ganti bahasa").
  // Tanpa kata "client", HANYA lanjut kalau sisanya benar-benar cocok persis dengan kode / nama client.
  const aktifkan = (c: KlienSuara): HasilGantiClient => ({ jenis: 'ganti', client: c, sudahAktif: c.id === activeClientId });

  // Hanya client yang punya kode sungguhan ('-' = placeholder "belum ada kode").
  const berkode = daftar.filter((c) => rapatkan(c.clientCode).length > 0);
  // Kalimat multi-kata yang BUKAN ejaan ("lihat laporan client sau") jangan dicocokkan per kata, supaya
  // pertanyaan biasa tidak salah dikira perintah ganti client.
  const semuaEja = sisa.every((t) => t.length === 1 || /^\d+$/.test(t) || NAMA_HURUF[t] !== undefined || ANGKA[t] !== undefined);
  const bolehPerKata = sisa.length === 1 || semuaEja;
  const kandidat = bolehPerKata ? buatKandidat(sisa) : [rapatkan(sisa.join(''))];

  // 1) Cocok persis dengan KODE client
  const persis = berkode.filter((c) => kandidat.includes(rapatkan(c.clientCode)));
  if (persis.length === 1) return aktifkan(persis[0]);
  if (persis.length > 1) return { jenis: 'ambigu', kandidat: persis };

  // 2) Salah dengar (STT): kode tidak persis tapi MIRIP -> cari lewat tabel kata mirip + kunci fonetik
  //    (src/lib/salahDengarSuara.ts). Hasilnya TIDAK langsung dipakai: Neo bertanya dulu.
  //    Kalimat panjang bukan ejaan: hanya gabungan token ("e sau" -> "esau") yang dicoba, bukan per kata.
  const masukan = bolehPerKata ? sisa : [sisa.join('')];
  let mirip = kandidatTeratas(cariClientMirip(masukan, berkode));
  // tanpa kata "client": hanya kata dari tabel kata mirip yang dipercaya, dan hanya untuk ucapan sangat pendek
  if (!adaKataClient) mirip = sisa.length <= 2 ? mirip.filter((k) => k.alasan === 'tabel') : [];
  if (mirip.length > 0) return { jenis: 'mirip', kandidat: mirip.map((k) => k.client), disebut: sisa.join(' ') };

  // Tanpa kata "client": tidak cocok sama sekali = mungkin bukan perintah ganti client -> serahkan ke jalur lain.
  if (!adaKataClient) return null;
  if (!bolehPerKata) return null; // kalimat biasa, bukan kode -> serahkan ke AI
  return { jenis: 'tidak-ditemukan', disebut: sisa.join(' ') };
}

// ======================================================================================
// CADANGAN LLM (dipakai VoiceAssistant bila parser di atas mengembalikan null)
// ======================================================================================

// kalimat tanya diserahkan ke AI chat (bukan perintah pindah client)
const POLA_TANYA = /^(?:berapa|apa|apakah|siapa|kapan|kenapa|mengapa|bagaimana|gimana|jelaskan|hitung|hitungkan|total|tolong jelaskan|tolong hitung)\b/;

/**
 * Apakah ucapan ini PANTAS ditanyakan ke LLM? Murah (tanpa jaringan): hanya true bila ucapan menyebut KODE
 * client yang ADA di daftar, dan bukan kalimat tanya. Dengan begitu pertanyaan biasa tidak
 * tertunda panggilan LLM.
 */
export function perluTanyaLLM(ucapan: string, daftar: KlienSuara[]): boolean {
  const teks = normal(ucapan);
  if (!teks) return false;
  const token = teks.split(' ');
  if (token.length > 20 || POLA_TANYA.test(teks)) return false;
  const kode = new Set(daftar.map((c) => rapatkan(c.clientCode)).filter(Boolean));
  const kandidat = new Set([...token.map(rapatkan), ...buatKandidat(token.filter((t) => !KATA_BUANG.has(t)))]);
  for (const k of kandidat) {
    if (kode.has(k)) return true;
  }
  return false;
}

/** Ubah kode jawaban LLM menjadi hasil ganti-client, setelah DIVALIDASI ulang terhadap daftar lokal. */
export function hasilDariKode(kode: string, daftar: KlienSuara[], activeClientId: string | null): HasilGantiClient | null {
  const target = rapatkan(kode);
  if (!target) return null;
  const cocok = daftar.filter((c) => rapatkan(c.clientCode) === target);
  if (cocok.length !== 1) return null; // tidak ada / kembar -> jangan menebak
  return { jenis: 'ganti', client: cocok[0], sudahAktif: cocok[0].id === activeClientId };
}