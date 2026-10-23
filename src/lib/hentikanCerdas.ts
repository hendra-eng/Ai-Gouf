// hentikanCerdas.ts
// =================
// Lapisan "paham maksud" untuk berhenti menjelaskan. Melengkapi hentikanSuara.ts (regex).
//
//   Lapis 1  bacaBerhenti()        regex lokal, instan, gratis                       (hentikanSuara.ts)
//   Lapis 2  sudahDipelajari()     kalimat yang dulu dinilai AI = berhenti, diingat   (file ini)
//   Lapis 3  tanyaMaksudBerhenti() AI memahami MAKSUD ucapan (POST /api/voice/stop-intent)
//
// Lapis 3 hanya dipanggil saat Neo SEDANG bicara dan lapis 1-2 tidak mengenali ucapannya, jadi "stop" biasa
// tetap instan. Hasil AI "berhenti" yang meyakinkan diingat di browser (lapis 2): kalimat yang sama berikutnya
// langsung dikenali tanpa menunggu AI. Neo makin cepat paham cara bicaramu.
//
// Pengaman: gerbang (tidak menanyakan kata tunggal pengisi / kalimat terlalu panjang), cache, batas panggilan
// per menit, dan ambang keyakinan. Gagal apa pun -> tidak berhenti (perilaku lama).

export type Maksud = 'berhenti' | 'berhenti_lalu_minta' | 'lanjut' | 'abaikan';

export type HasilMaksud = {
  maksud: Maksud;
  sisa: string; // permintaan baru (apa adanya dari ucapan) bila maksud = berhenti_lalu_minta
  yakin: number; // 0..1
};

/** Fungsi pemanggil API. Disuntikkan dari komponen (api.stopIntent) supaya modul ini bisa diuji tanpa browser. */
export type PenanyaMaksud = (ucapan: string, neoTerakhir: string) => Promise<HasilMaksud | null>;

// ---- Pengaturan ----
export const AMBANG_BERHENTI = 0.7; // keyakinan minimum untuk memutuskan "berhenti"
export const AMBANG_BERHENTI_LALU_MINTA = 0.75; // sedikit lebih ketat: hasilnya juga mengirim permintaan baru ke AI
const AMBANG_PELAJARI = 0.85; // hanya yang sangat meyakinkan yang diingat
const MAKS_KATA = 40; // ucapan lebih panjang dari ini = hampir pasti obrolan, bukan ajakan berhenti
const MAKS_PANGGILAN_PER_MENIT = 8;
const JEDA_ANTAR_PANGGILAN_MS = 700;
const MAKS_CACHE = 80;
const MAKS_PELAJARAN = 150;
const MAKS_KATA_PELAJARAN = 8;
const KUNCI_PELAJARAN = 'neo-stop-belajar-v1';

// Gumaman / pengisi satu kata: tidak ada maksud yang bisa dinilai, tidak perlu memanggil AI.
const PENGISI_TUNGGAL = new Set([
  'ya', 'iya', 'yah', 'yaa', 'oke', 'ok', 'okay', 'hmm', 'hm', 'em', 'eh', 'ehh', 'ah', 'oh', 'uh', 'um', 'yes', 'yeah', 'no', 'nah', 'sip', 'wah',
  'hah', 'hmmm', 'lah', 'dong', 'deh', 'nih', 'tuh', 'kok', 'sih', 'dan', 'yang', 'itu', 'ini', 'di', 'ke', 'the', 'a',
]);

const rapikan = (t: string): string =>
  (t || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[.,!?;:"“”‘()\[\]{}…\-–—_/\\]/g, ' ')
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------------------------
// Memori belajar (localStorage; cadangan di memori kalau storage tidak ada / diblokir)
// ---------------------------------------------------------------------------------------------
let pelajaran: Set<string> | null = null;

function muatPelajaran(): Set<string> {
  if (pelajaran) return pelajaran;
  pelajaran = new Set();
  try {
    const mentah = typeof localStorage !== 'undefined' ? localStorage.getItem(KUNCI_PELAJARAN) : null;
    const daftar = mentah ? JSON.parse(mentah) : [];
    if (Array.isArray(daftar)) for (const k of daftar) if (typeof k === 'string' && k) pelajaran.add(k);
  } catch { /* storage kosong / rusak: mulai dari nol */ }
  return pelajaran;
}

function simpanPelajaran(): void {
  try {
    if (typeof localStorage !== 'undefined' && pelajaran) localStorage.setItem(KUNCI_PELAJARAN, JSON.stringify([...pelajaran]));
  } catch { /* abaikan */ }
}

/** True kalau seluruh ucapan ini persis kalimat yang dulu dinilai AI sebagai ajakan berhenti. */
export function sudahDipelajari(teks: string): boolean {
  const t = rapikan(teks);
  return !!t && muatPelajaran().has(t);
}

/** Ingat kalimat ini sebagai ajakan berhenti (dipanggil otomatis dari tanyaMaksudBerhenti bila AI sangat yakin). */
export function pelajari(teks: string): void {
  const t = rapikan(teks);
  const n = t ? t.split(' ').length : 0;
  if (!t || n < 1 || n > MAKS_KATA_PELAJARAN || /\?/.test(teks)) return; // kalimat panjang / tanya tidak diingat
  const set = muatPelajaran();
  if (set.has(t)) return;
  set.add(t);
  if (set.size > MAKS_PELAJARAN) set.delete(set.values().next().value as string); // buang yang terlama
  simpanPelajaran();
}

/** Hapus semua yang sudah dipelajari (kalau Neo terlalu mudah berhenti). */
export function lupakanPelajaran(): void {
  pelajaran = new Set();
  simpanPelajaran();
}

/** Untuk uji / tampilan debug. */
export function daftarPelajaran(): string[] {
  return [...muatPelajaran()];
}

// ---------------------------------------------------------------------------------------------
// Gerbang: perlukah menanyakan ucapan ini ke AI?
// ---------------------------------------------------------------------------------------------
export function layakTanyaMaksud(teks: string): boolean {
  const t = rapikan(teks);
  if (!t) return false;
  const kata = t.split(' ');
  if (kata.length > MAKS_KATA) return false;
  if (kata.length === 1 && (kata[0].length < 3 || PENGISI_TUNGGAL.has(kata[0]))) return false;
  if (kata.every((k) => PENGISI_TUNGGAL.has(k))) return false; // "iya iya oke" saja: tidak ada maksud lain
  return true;
}

// ---------------------------------------------------------------------------------------------
// Penanya: cache + batas panggilan + satu permintaan dalam satu waktu
// ---------------------------------------------------------------------------------------------
const cache = new Map<string, HasilMaksud>();
let waktuPanggilan: number[] = [];
let sedangTanya = false;
let panggilanTerakhir = 0;

export function resetPenanya(): void {
  cache.clear();
  waktuPanggilan = [];
  sedangTanya = false;
  panggilanTerakhir = 0;
}

/** Terapkan ambang keyakinan -> keputusan akhir yang aman. */
export function putuskan(h: HasilMaksud | null): { berhenti: boolean; sisa: string } {
  if (!h) return { berhenti: false, sisa: '' };
  if (h.maksud === 'berhenti' && h.yakin >= AMBANG_BERHENTI) return { berhenti: true, sisa: '' };
  if (h.maksud === 'berhenti_lalu_minta' && h.yakin >= AMBANG_BERHENTI_LALU_MINTA) return { berhenti: true, sisa: h.sisa || '' };
  return { berhenti: false, sisa: '' };
}

/**
 * Tanyakan ke AI: apakah ucapan ini minta Neo berhenti? Mengembalikan null kalau tidak ditanyakan / gagal.
 * Panggil HANYA saat Neo sedang bicara dan bacaBerhenti() tidak mengenali ucapannya.
 */
export async function tanyaMaksudBerhenti(teks: string, neoTerakhir: string, tanya: PenanyaMaksud): Promise<HasilMaksud | null> {
  if (!layakTanyaMaksud(teks)) return null;
  const t = rapikan(teks);

  const tersimpan = cache.get(t);
  if (tersimpan) return tersimpan;

  const sekarang = Date.now();
  waktuPanggilan = waktuPanggilan.filter((w) => sekarang - w < 60000);
  if (sedangTanya || waktuPanggilan.length >= MAKS_PANGGILAN_PER_MENIT || sekarang - panggilanTerakhir < JEDA_ANTAR_PANGGILAN_MS) return null;

  sedangTanya = true;
  panggilanTerakhir = sekarang;
  waktuPanggilan.push(sekarang);
  try {
    const hasil = await tanya(teks, neoTerakhir);
    if (!hasil) return null;
    cache.set(t, hasil);
    if (cache.size > MAKS_CACHE) cache.delete(cache.keys().next().value as string);
    // Belajar: hanya ajakan berhenti MURNI yang sangat meyakinkan.
    if (hasil.maksud === 'berhenti' && hasil.yakin >= AMBANG_PELAJARI) pelajari(teks);
    return hasil;
  } catch {
    return null;
  } finally {
    sedangTanya = false;
  }
}