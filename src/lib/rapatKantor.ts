// Rapat di halaman Agentic AI. Neo (asisten suara global) menangkap perintah suaranya; halaman Agentic AI hanya mendengar
// event-nya dan menggerakkan agen (Atlas, Zeno) ke meja rapat.
//
// [ATURAN MUTLAK] Status rapat disimpan di DATABASE (tabel ai_rapat_kantor, lewat /api/kantor-rapat), bukan hanya di modul ini.
// Begitu pengguna mengadakan meeting, semua karakter 3D tetap di meja rapat -- walau aplikasi ditutup, tab dihapus, halaman
// di-reload, atau dibuka dari perangkat lain -- SAMPAI pengguna membubarkannya ("Neo, meeting selesai"). Tidak ada batas waktu.
// Variabel di modul ini hanya salinan kerja; localStorage hanya cadangan kalau server tidak terjangkau saat aplikasi dibuka.

import { kantorRapatAtur, kantorRapatBaca } from '@/app/zafeb-ai/lib/api';

export const EVENT_RAPAT = 'kantor-rapat';
const KUNCI_CADANGAN = 'kantor-rapat-aktif-v1';
// Sesudah pengguna mengubah status dari sini, pembacaan server diabaikan sebentar supaya tidak menimpa perubahan yang baru dibuat.
const JEDA_ABAIKAN_SERVER_MS = 4000;

let rapatAktif = false;
let terakhirLokalMs = 0; // kapan status terakhir diubah dari sini
let tertunda = false; // perubahan lokal belum sampai ke server -> dikirim ulang, JANGAN ditimpa data server yang lama
let sedangMenulis = 0;
let urutanTulis = 0;
let sudahMuat = false;

function simpanCadangan(aktif: boolean): void {
  try { window.localStorage.setItem(KUNCI_CADANGAN, aktif ? '1' : '0'); } catch { /* abaikan */ }
}
function bacaCadangan(): boolean | null {
  try {
    const v = window.localStorage.getItem(KUNCI_CADANGAN);
    return v === null ? null : v === '1';
  } catch { return null; }
}
function kirimKeServer(aktif: boolean): void {
  const nomor = ++urutanTulis;
  sedangMenulis++;
  void kantorRapatAtur(aktif)
    .then((ok) => { if (nomor === urutanTulis) tertunda = !ok; })
    .catch(() => { if (nomor === urutanTulis) tertunda = true; })
    .finally(() => { sedangMenulis--; });
}
const barusanDiubahLokal = () => sedangMenulis > 0 || Date.now() - terakhirLokalMs < JEDA_ABAIKAN_SERVER_MS;

export function rapatSedangBerlangsung(): boolean {
  return rapatAktif;
}

// Ambil status rapat dari server (sumber kebenaran) dan samakan modul ini. Dipanggil saat aplikasi dibuka dan berkala,
// jadi reload / tab baru / perangkat lain langsung melihat status yang sama. Kalau berubah, event dikirim ke halaman Agentic AI.
// Server tidak terjangkau: pembukaan pertama memakai cadangan localStorage, sesudahnya status dibiarkan apa adanya.
export async function muatRapatDariServer(): Promise<boolean> {
  if (typeof window === 'undefined') return rapatAktif;
  if (barusanDiubahLokal()) return rapatAktif;
  if (tertunda) { kirimKeServer(rapatAktif); return rapatAktif; }
  const server = await kantorRapatBaca();
  if (barusanDiubahLokal()) return rapatAktif; // pengguna mengubahnya selagi menunggu jawaban server
  let nilai = server;
  if (nilai === null) {
    const cadangan = bacaCadangan();
    if (sudahMuat || cadangan === null) return rapatAktif;
    nilai = cadangan;
  }
  sudahMuat = true;
  simpanCadangan(nilai);
  if (nilai !== rapatAktif) {
    rapatAktif = nilai;
    umumkanRapat();
  }
  return rapatAktif;
}

// Ubah status rapat sekarang juga. Event ke halaman Agentic AI (yang menggerakkan agen) bisa ditunda dengan tundaMs,
// atau tidak dikirim sama sekali (tanpaEvent) lalu dikirim belakangan lewat umumkanRapat(), mis. setelah Neo selesai bicara.
export function aturRapat(aksi: 'mulai' | 'selesai', opsi: { tundaMs?: number; tanpaEvent?: boolean } = {}): void {
  rapatAktif = aksi === 'mulai';
  terakhirLokalMs = Date.now();
  sudahMuat = true;
  simpanCadangan(rapatAktif);
  tertunda = true; // dianggap belum sampai sampai server menjawab OK
  kirimKeServer(rapatAktif);
  if (opsi.tanpaEvent) return;
  if (opsi.tundaMs && opsi.tundaMs > 0) setTimeout(umumkanRapat, opsi.tundaMs);
  else umumkanRapat();
}

// Kirim status rapat saat ini ke halaman Agentic AI (agen berjalan ke meja rapat atau kembali bekerja).
export function umumkanRapat(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_RAPAT, { detail: { aktif: rapatAktif } }));
}

// Perintah rapat: "ayo kita meeting" -> mulai; "meeting selesai" -> selesai.
// Perintah selesai dicek PERTAMA karena kalimatnya juga memuat kata "meeting".
const POLA_SELESAI: RegExp[] = [
  /\b(?:meeting|rapat)\s+(?:nya\s+)?(?:sudah\s+|udah\s+|kita\s+)?(?:selesai|usai|bubar|berakhir|kelar|ditutup)\b/,
  /\b(?:selesai|sudahi|akhiri|tutup|bubarkan)(?:kan)?\s+(?:meeting|rapat)\b/,
  /\b(?:silakan|silahkan|ayo|yuk)\s+(?:kembali|balik)\s+(?:ke\s+)?(?:meja|kerja|rutinitas)/,
  /\b(?:silakan|silahkan)\s+(?:kalian\s+)?(?:kerjakan|mulai\s+kerja|bekerja)/,
];
const POLA_MULAI: RegExp[] = [
  /\b(?:ayo|yuk|ayuk|mari|saatnya|waktunya)\b.*\b(?:meeting|rapat|kumpul|ngumpul|berkumpul)\b/,
  /\b(?:kita|kalian|semua|semuanya)\s+(?:harus\s+|mau\s+|akan\s+|perlu\s+)?(?:meeting|rapat)\b/,
  /\b(?:mulai|adakan|buka|ada)\s+(?:meeting|rapat)\b/,
  /\b(?:meeting|rapat)\s+(?:sekarang|dulu|yuk|ya)\b/,
  /\b(?:kumpul|berkumpul|pindah|duduk|ke)\s+(?:di\s+|ke\s+)?meja\s+rapat\b/,
];

export function bacaPerintahRapat(teks: string): 'mulai' | 'selesai' | null {
  const t = (teks || '').toLowerCase().replace(/[.,!?;:"“”()…\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (POLA_SELESAI.some((r) => r.test(t))) return 'selesai';
  if (POLA_MULAI.some((r) => r.test(t))) return 'mulai';
  return null;
}