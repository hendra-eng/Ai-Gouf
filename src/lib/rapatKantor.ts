// Rapat di halaman Agentic AI. Neo (asisten suara global) menangkap perintah suaranya; halaman Agentic AI hanya mendengar
// event-nya dan menggerakkan agen (Atlas, Zeno) ke meja rapat. Status disimpan di modul ini supaya tetap ada
// walau pengguna pindah halaman lalu kembali (sampai pengguna bilang "meeting selesai").

export const EVENT_RAPAT = 'kantor-rapat';

let rapatAktif = false;

export function rapatSedangBerlangsung(): boolean {
  return rapatAktif;
}

// Ubah status rapat sekarang juga. Event ke halaman Agentic AI (yang menggerakkan agen) bisa ditunda dengan tundaMs,
// atau tidak dikirim sama sekali (tanpaEvent) lalu dikirim belakangan lewat umumkanRapat(), mis. setelah Neo selesai bicara.
export function aturRapat(aksi: 'mulai' | 'selesai', opsi: { tundaMs?: number; tanpaEvent?: boolean } = {}): void {
  rapatAktif = aksi === 'mulai';
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