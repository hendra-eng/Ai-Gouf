// wajahLokal.ts — pengenalan wajah untuk menyapa Neo.
//
// Pembagian kerja:
//  - BROWSER: mendeteksi wajah dan mengubahnya jadi "embedding" (128 angka dari bentuk mata, hidung, rahang, dst) memakai
//    model face-api (public/models/face). Foto TIDAK PERNAH dikirim untuk proses ini dan TIDAK PERNAH disimpan.
//  - SERVER (database): menyimpan nama + embedding (terenkripsi) per pengguna, dan mencocokkan embedding baru dengan profil
//    milik pengguna yang sedang login (lihat backend/wajah_profil_route.py). Karena di database, profil yang sama dipakai
//    di semua browser dan perangkat.
//
// Usia / tanggal lahir sengaja tidak disimpan. PENTING: hanya untuk MENYAPA, jangan dipakai sebagai login / otorisasi.

import * as api from '@/app/agent-ai/lib/api';

const LOKASI_MODEL = '/models/face';
const MIN_SAMPEL = 3;

export type HasilKenali =
  | { dikenali: true; nama: string }
  | { dikenali: false; alasan: 'tidak-ada-wajah' | 'banyak-wajah' | 'tidak-cocok' | 'galat' };

let _faceapi: any = null;
let _siap: Promise<any> | null = null;

async function muat(): Promise<any> {
  if (_faceapi) return _faceapi;
  if (!_siap) {
    _siap = (async () => {
      const fa = await import('@vladmandic/face-api');
      await Promise.all([
        fa.nets.tinyFaceDetector.loadFromUri(LOKASI_MODEL),
        fa.nets.faceLandmark68Net.loadFromUri(LOKASI_MODEL),
        fa.nets.faceRecognitionNet.loadFromUri(LOKASI_MODEL),
      ]);
      _faceapi = fa;
      return fa;
    })().catch((e) => { _siap = null; throw e; });
  }
  return _siap;
}

/** Panaskan model lebih awal (dipanggil saat aplikasi dibuka) supaya pengenalan nanti cepat. */
export function panaskanModel(): void { void muat().catch(() => {}); }

/** Apakah pengguna yang login sudah punya profil wajah di database? Gagal/belum login -> null. */
export async function statusProfil(): Promise<{ ada: boolean; nama: string | null } | null> {
  return (await api.wajahStatus()) as { ada: boolean; nama: string | null } | null;
}

export async function hapusProfil(): Promise<boolean> {
  return await api.wajahHapus();
}

/** Satu wajah di gambar -> embedding. Nol atau banyak wajah -> alasan (supaya tidak salah mengenali orang di belakang). */
async function embeddingDari(sumber: HTMLCanvasElement): Promise<{ ok: true; emb: number[] } | { ok: false; alasan: 'tidak-ada-wajah' | 'banyak-wajah' }> {
  const fa = await muat();
  const hasil = await fa
    .detectAllFaces(sumber, new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (!hasil.length) return { ok: false, alasan: 'tidak-ada-wajah' };
  if (hasil.length > 1) {
    // Hanya terima kalau satu wajah jelas lebih besar (pengguna di depan, orang lain jauh di belakang).
    const luas = hasil.map((h: any) => h.detection.box.width * h.detection.box.height).sort((x: number, y: number) => y - x);
    if (luas[0] < luas[1] * 2.5) return { ok: false, alasan: 'banyak-wajah' };
    const terbesar = hasil.reduce((m: any, h: any) => (h.detection.box.width * h.detection.box.height > m.detection.box.width * m.detection.box.height ? h : m));
    return { ok: true, emb: Array.from(terbesar.descriptor as Float32Array) };
  }
  return { ok: true, emb: Array.from(hasil[0].descriptor as Float32Array) };
}

/** Daftarkan wajah dari beberapa frame ke database. Butuh minimal MIN_SAMPEL frame yang wajahnya terbaca. */
export async function daftarkanWajah(nama: string, frames: HTMLCanvasElement[]): Promise<{ ok: true; sampel: number } | { ok: false; pesan: string }> {
  try {
    const bersih = nama.trim().slice(0, 30);
    if (!bersih) return { ok: false, pesan: 'Nama kosong.' };
    const embeddings: number[][] = [];
    for (const f of frames) {
      const e = await embeddingDari(f);
      if (e.ok) embeddings.push(e.emb);
    }
    if (embeddings.length < MIN_SAMPEL) return { ok: false, pesan: 'Wajahmu kurang terbaca. Hadap kamera dengan cahaya cukup, hanya satu orang di depan kamera, lalu coba lagi.' };
    if (!(await api.wajahSimpan(bersih, embeddings))) return { ok: false, pesan: 'Gagal menyimpan ke database. Pastikan backend menyala dan kamu sudah login.' };
    return { ok: true, sampel: embeddings.length };
  } catch {
    return { ok: false, pesan: 'Model pengenal wajah gagal dimuat.' };
  }
}

/** Cocokkan wajah di gambar dengan profil milik pengguna yang login (dicocokkan di server). Tidak pernah melempar. */
export async function kenaliWajah(sumber: HTMLCanvasElement): Promise<HasilKenali> {
  try {
    const e = await embeddingDari(sumber);
    if (!e.ok) return { dikenali: false, alasan: e.alasan };
    const r = (await api.wajahCocokkan(e.emb)) as { dikenali: boolean; nama: string | null } | null;
    if (!r) return { dikenali: false, alasan: 'galat' };
    return r.dikenali && r.nama ? { dikenali: true, nama: r.nama } : { dikenali: false, alasan: 'tidak-cocok' };
  } catch {
    return { dikenali: false, alasan: 'galat' };
  }
}