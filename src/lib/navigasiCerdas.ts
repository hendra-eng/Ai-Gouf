// navigasiCerdas.ts
// =================
// Lapisan "paham maksud" untuk pindah halaman/tab. Melengkapi navigasiSuara.ts + niatNavigasi.ts (aturan lokal).
//
//   Lapis 1  bacaNavigasi()          aturan lokal, instan, gratis; paham ratusan gaya bicara     (navigasiSuara.ts, niatNavigasi.ts)
//   Lapis 2  dipelajariNav()         kalimat yang dulu dinilai AI = "buka X" diingat di browser   (file ini)
//   Lapis 3  tanyaMaksudNavigasi()   AI memahami MAKSUD ucapan   (POST /api/voice/nav-intent)
//
// Lapis 3 hanya dipanggil bila: aturan lokal tidak memutuskan (niat "ragu"/"netral": "neraca dong", "oke sekarang
// laba rugi", "iya, yang itu aja") DAN ucapan menyebut/mirip halaman atau tab tertentu (kandidat). Jadi "buka neraca"
// tetap instan, dan obrolan biasa tidak pernah memanggil AI. AI hanya boleh memilih dari kandidat -> tidak bisa membuka
// rute yang bukan bagian aplikasi. Keputusan "buka" yang sangat yakin diingat (lapis 2): kalimat yang sama berikutnya
// langsung dikenali tanpa menunggu AI -- Neo makin cepat paham cara bicaramu.
//
// Pengaman: gerbang, cache, batas panggilan per menit, ambang keyakinan (lebih ketat daripada "berhenti", karena salah
// pindah lebih mengganggu daripada tidak pindah). Gagal apa pun -> tidak pindah (ucapan dijawab AI biasa seperti dulu).

import type { KandidatNav } from './navigasiSuara';

export type MaksudNav = 'buka' | 'bukan' | 'batal';

export type HasilMaksudNav = {
  maksud: MaksudNav;
  tujuan: string; // id kandidat (= path) bila maksud = buka
  yakin: number; // 0..1
};

/** Fungsi pemanggil API. Disuntikkan dari komponen (api.navIntent) supaya modul ini bisa diuji tanpa browser. */
export type PenanyaNav = (ucapan: string, kandidat: { id: string; nama: string }[], halamanSekarang: string, neoTerakhir: string) => Promise<HasilMaksudNav | null>;

// ---- Pengaturan ----
export const AMBANG_BUKA = 0.8; // keyakinan minimum untuk benar-benar pindah
export const AMBANG_BATAL = 0.8;
const AMBANG_PELAJARI = 0.9; // hanya yang sangat meyakinkan yang diingat
const MAKS_KATA = 20;
const MAKS_PANGGILAN_PER_MENIT = 8;
const JEDA_ANTAR_PANGGILAN_MS = 700;
const MAKS_CACHE = 80;
const MAKS_PELAJARAN = 150;
const MAKS_KATA_PELAJARAN = 8;
const KUNCI_PELAJARAN = 'neo-nav-belajar-v1';

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
// Memori belajar: ucapan -> path tujuan (localStorage; cadangan di memori kalau storage tidak ada / diblokir)
// ---------------------------------------------------------------------------------------------
let pelajaran: Map<string, string> | null = null;

function muatPelajaran(): Map<string, string> {
  if (pelajaran) return pelajaran;
  pelajaran = new Map();
  try {
    const mentah = typeof localStorage !== 'undefined' ? localStorage.getItem(KUNCI_PELAJARAN) : null;
    const data = mentah ? JSON.parse(mentah) : [];
    if (Array.isArray(data)) for (const e of data) if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && e[0] && e[1]) pelajaran.set(e[0], e[1]);
  } catch { /* storage kosong / rusak: mulai dari nol */ }
  return pelajaran;
}

function simpanPelajaran(): void {
  try {
    if (typeof localStorage !== 'undefined' && pelajaran) localStorage.setItem(KUNCI_PELAJARAN, JSON.stringify([...pelajaran.entries()]));
  } catch { /* abaikan */ }
}

/**
 * Kalau kalimat ini persis kalimat yang dulu dinilai AI sebagai "buka X" dan X masih termasuk kandidat sekarang,
 * kembalikan X. Kalau tidak: null.
 */
export function dipelajariNav(teks: string, kandidat: KandidatNav[]): KandidatNav | null {
  const t = rapikan(teks);
  if (!t) return null;
  const path = muatPelajaran().get(t);
  if (!path) return null;
  return kandidat.find((k) => k.path === path) ?? null;
}

/** Ingat: kalimat ini = buka tujuan ini (dipanggil otomatis dari tanyaMaksudNavigasi bila AI sangat yakin). */
export function pelajariNav(teks: string, path: string): void {
  const t = rapikan(teks);
  const n = t ? t.split(' ').length : 0;
  if (!t || !path || n < 1 || n > MAKS_KATA_PELAJARAN || /\?/.test(teks)) return; // kalimat panjang / tanya tidak diingat
  const peta = muatPelajaran();
  if (peta.get(t) === path) return;
  peta.delete(t);
  peta.set(t, path);
  if (peta.size > MAKS_PELAJARAN) peta.delete(peta.keys().next().value as string); // buang yang terlama
  simpanPelajaran();
}

/** Lupakan satu kalimat (kalau Neo salah menerka) atau semuanya. */
export function lupakanPelajaranNav(teks?: string): void {
  if (teks === undefined) pelajaran = new Map();
  else muatPelajaran().delete(rapikan(teks));
  simpanPelajaran();
}

/** Untuk uji / tampilan debug. */
export function daftarPelajaranNav(): [string, string][] {
  return [...muatPelajaran().entries()];
}

// ---------------------------------------------------------------------------------------------
// Gerbang
// ---------------------------------------------------------------------------------------------
export function layakTanyaNavigasi(teks: string, kandidat: KandidatNav[]): boolean {
  if (kandidat.length === 0) return false; // tidak ada tujuan yang disebut = tidak ada yang bisa dibuka
  const t = rapikan(teks);
  if (!t) return false;
  const kata = t.split(' ');
  if (kata.length > MAKS_KATA) return false;
  if (kata.length === 1 && (kata[0].length < 3 || PENGISI_TUNGGAL.has(kata[0]))) return false;
  if (kata.every((k) => PENGISI_TUNGGAL.has(k))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Penanya: cache + batas panggilan + satu permintaan dalam satu waktu
// ---------------------------------------------------------------------------------------------
const cache = new Map<string, HasilMaksudNav>();
let waktuPanggilan: number[] = [];
let sedangTanya = false;
let panggilanTerakhir = 0;

export function resetPenanyaNav(): void {
  cache.clear();
  waktuPanggilan = [];
  sedangTanya = false;
  panggilanTerakhir = 0;
}

export type KeputusanNav = { aksi: 'buka'; tujuan: KandidatNav } | { aksi: 'batal' } | null;

/** Terapkan ambang keyakinan + validasi ulang tujuan terhadap kandidat -> keputusan akhir yang aman. */
export function putuskanNav(h: HasilMaksudNav | null, kandidat: KandidatNav[]): KeputusanNav {
  if (!h) return null;
  if (h.maksud === 'buka' && h.yakin >= AMBANG_BUKA) {
    const tujuan = kandidat.find((k) => k.id === h.tujuan);
    return tujuan ? { aksi: 'buka', tujuan } : null;
  }
  if (h.maksud === 'batal' && h.yakin >= AMBANG_BATAL) return { aksi: 'batal' };
  return null;
}

/**
 * Tanyakan ke AI: apakah ucapan ini minta pindah ke salah satu kandidat? Mengembalikan null kalau tidak ditanyakan / gagal.
 * Panggil HANYA setelah bacaNavigasi() tidak memutuskan dan kandidatUntukAI() menghasilkan kandidat.
 */
export async function tanyaMaksudNavigasi(
  teks: string,
  kandidat: KandidatNav[],
  halamanSekarang: string,
  neoTerakhir: string,
  tanya: PenanyaNav
): Promise<HasilMaksudNav | null> {
  if (!layakTanyaNavigasi(teks, kandidat)) return null;
  const t = rapikan(teks);
  const kunci = `${t}|${kandidat.map((k) => k.id).join(',')}|${halamanSekarang.split('?')[0]}`;

  const tersimpan = cache.get(kunci);
  if (tersimpan) return tersimpan;

  const sekarang = Date.now();
  waktuPanggilan = waktuPanggilan.filter((w) => sekarang - w < 60000);
  if (sedangTanya || waktuPanggilan.length >= MAKS_PANGGILAN_PER_MENIT || sekarang - panggilanTerakhir < JEDA_ANTAR_PANGGILAN_MS) return null;

  sedangTanya = true;
  panggilanTerakhir = sekarang;
  waktuPanggilan.push(sekarang);
  try {
    const hasil = await tanya(teks, kandidat.map((k) => ({ id: k.id, nama: k.nama })), halamanSekarang, neoTerakhir);
    if (!hasil) return null;
    cache.set(kunci, hasil);
    if (cache.size > MAKS_CACHE) cache.delete(cache.keys().next().value as string);
    // Belajar: hanya "buka X" yang SANGAT meyakinkan dan tujuannya benar-benar salah satu kandidat.
    if (hasil.maksud === 'buka' && hasil.yakin >= AMBANG_PELAJARI && kandidat.some((k) => k.id === hasil.tujuan)) pelajariNav(teks, hasil.tujuan);
    return hasil;
  } catch {
    return null;
  } finally {
    sedangTanya = false;
  }
}
