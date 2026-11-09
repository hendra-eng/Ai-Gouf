// sapaanCerdas.ts
// ===============
// Lapis 2 untuk sapaan di halaman Agentic AI. Melengkapi sapaanAgen.ts (parser lokal).
//
//   Lapis 1  bacaSapaan()          parser lokal, instan, gratis                       (sapaanAgen.ts)
//   Lapis 2  tanyaMaksudSapaan()   AI memahami MAKSUD ucapan (POST /api/voice/sapaan-intent)  (file ini)
//
// Lapis 2 hanya dipanggil bila lapis 1 tidak mengenali ucapan DAN ucapannya pendek serta menyebut agen / kelompok /
// pembuka (layakTanyaSapaanAi). Pengaman: cache, batas panggilan per menit, ambang keyakinan, satu permintaan
// dalam satu waktu. Gagal apa pun -> null -> ucapan diproses alur lama (tidak ada yang berubah).

import { URUTAN_AGEN, type AgenSuara, type BasaBasi, type Gaya, type HasilSapaan, type Waktu } from './sapaanAgen';

/** Bentuk jawaban endpoint. kepada boleh berisi "semua". */
export type JawabanSapaanAi = {
  jenis: 'sapaan' | 'cek_hadir' | 'panggil' | 'bukan';
  kepada: string[];
  gaya: string;
  basa: string | null;
  waktu: string | null;
  islam: boolean;
  yakin: number;
};
export type PenanyaSapaan = (ucapan: string) => Promise<JawabanSapaanAi | null>;

export const AMBANG_SAPAAN = 0.7;
const MAKS_PANGGILAN_PER_MENIT = 10;
const JEDA_ANTAR_PANGGILAN_MS = 500;
const MAKS_CACHE = 80;

const rapikan = (t: string): string => (t || '').toLowerCase().replace(/[.,!?;:"'“”()]/g, ' ').replace(/\s+/g, ' ').trim();

const cache = new Map<string, JawabanSapaanAi>();
let waktuPanggilan: number[] = [];
let sedangTanya = false;
let panggilanTerakhir = 0;

export function resetPenanyaSapaan(): void {
  cache.clear();
  waktuPanggilan = [];
  sedangTanya = false;
  panggilanTerakhir = 0;
}

/** Terapkan ambang keyakinan dan validasi -> HasilSapaan yang aman dipakai, atau null (= alur lama). */
export function putuskanSapaan(j: JawabanSapaanAi | null): HasilSapaan | null {
  if (!j || j.jenis === 'bukan' || j.yakin < AMBANG_SAPAAN) return null;
  const kepada: AgenSuara[] = j.kepada.some((k) => String(k).toLowerCase() === 'semua')
    ? [...URUTAN_AGEN]
    : URUTAN_AGEN.filter((a) => j.kepada.map((k) => String(k).toLowerCase()).includes(a));
  const gaya: Gaya = j.gaya === 'formal' || j.gaya === 'santai' ? j.gaya : 'netral';
  const basa: BasaBasi = j.basa === 'kabar' || j.basa === 'aktivitas' || j.basa === 'makan' ? j.basa : null;
  const waktu: Waktu | null = j.waktu === 'pagi' || j.waktu === 'siang' || j.waktu === 'sore' || j.waktu === 'malam' ? j.waktu : null;
  return { jenis: j.jenis, kepada, gaya, basa, waktu, islam: !!j.islam, yakin: j.yakin };
}

/** Tanyakan ke AI. Mengembalikan null bila tidak ditanyakan / gagal / dibatasi. */
export async function tanyaMaksudSapaan(teks: string, tanya: PenanyaSapaan): Promise<JawabanSapaanAi | null> {
  const t = rapikan(teks);
  if (!t) return null;
  const tersimpan = cache.get(t);
  if (tersimpan) return tersimpan;

  const sekarang = Date.now();
  waktuPanggilan = waktuPanggilan.filter((w) => sekarang - w < 60000);
  if (sedangTanya || waktuPanggilan.length >= MAKS_PANGGILAN_PER_MENIT || sekarang - panggilanTerakhir < JEDA_ANTAR_PANGGILAN_MS) return null;

  sedangTanya = true;
  panggilanTerakhir = sekarang;
  waktuPanggilan.push(sekarang);
  try {
    const hasil = await tanya(teks);
    if (!hasil) return null;
    cache.set(t, hasil);
    if (cache.size > MAKS_CACHE) cache.delete(cache.keys().next().value as string);
    return hasil;
  } catch {
    return null;
  } finally {
    sedangTanya = false;
  }
}
