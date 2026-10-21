// keamananSuara.ts — aturan keamanan & kenyamanan asisten suara Neo (fungsi MURNI: tanpa React, tanpa AI,
// instan dan mudah dites). Dipakai oleh src/components/VoiceAssistant.tsx.
//
// Isi:
//  1. bacaKonfirmasi   -> "ya" / "tidak" untuk pertanyaan "yakin?"
//  2. bacaBatalkan     -> "batalkan" / "undo" (membatalkan aksi suara terakhir)
//  3. bacaUlangi       -> "ulangi" / "repeat" (ucapkan lagi jawaban terakhir)
//  4. bacaLaju         -> "lebih pelan" / "lebih cepat" / "kecepatan normal"
//  5. bacaGantiBahasa  -> "bicara bahasa Inggris" / "speak Indonesian"
//  6. deteksiBahasa    -> bahasa ucapan (id / en) supaya jawaban AI mengikuti
//  7. aksiTerlarang    -> perintah yang mengubah/menghapus data TIDAK dijalankan lewat suara
//
// Semua teks masukan sudah dinormalisasi (huruf kecil, tanpa tanda baca) oleh VoiceAssistant.

export type Bahasa = 'id' | 'en';

const hitungKata = (t: string) => t.split(' ').filter(Boolean).length;

// ---------- 1. Konfirmasi ya / tidak ----------
const POLA_YA = /\b(?:ya|iya|iyah|yap|yup|yes|yeah|oke|ok|okay|okey|lanjut|lanjutkan|benar|betul|setuju|silakan|sip|boleh|confirm|konfirmasi|go ahead|proceed)\b/;
const POLA_TIDAK = /\b(?:tidak|nggak|ngga|gak|enggak|engga|jangan|batal|batalkan|bukan|salah|no|nope|cancel|stop|ga)\b/;

export function bacaKonfirmasi(teks: string): 'ya' | 'tidak' | null {
  const n = hitungKata(teks);
  if (n === 0 || n > 5) return null;
  if (POLA_TIDAK.test(teks)) return 'tidak'; // "tidak" menang bila ada keduanya ("oke jangan") -> aman
  if (POLA_YA.test(teks)) return 'ya';
  return null;
}

// ---------- 2. Batalkan ----------
const POLA_BATALKAN = /\b(?:batalkan|batal|undo|cancel|urungkan|kembalikan|cancel that|batalkan itu|salah)\b/;
export function bacaBatalkan(teks: string): boolean {
  return hitungKata(teks) <= 4 && POLA_BATALKAN.test(teks);
}

// ---------- 3. Ulangi ----------
const POLA_ULANGI = /\b(?:ulangi|ulangi lagi|ulang lagi|diulang|diulang lagi|repeat|repeat that|say again|say that again|bilang lagi|apa tadi|apa katamu tadi|sekali lagi)\b/;
export function bacaUlangi(teks: string): boolean {
  return hitungKata(teks) <= 5 && POLA_ULANGI.test(teks);
}

// ---------- 4. Kecepatan bicara ----------
const POLA_PELAN = /\b(?:pelan|pelan pelan|pelanin|lambat|lambatkan|slower|slow down|slow)\b/;
const POLA_CEPAT = /\b(?:cepat|cepatan|cepetan|percepat|faster|speed up|quicker)\b/;
const POLA_NORMAL = /\b(?:kecepatan normal|laju normal|normal speed|normal pace|kecepatan biasa)\b/;
// harus jelas bicara soal kecepatan suara: ada "lebih" / "bicara" / "suara" / "speak" / dst.
const POLA_KONTEKS_LAJU = /\b(?:lebih|bicara|bicaranya|suara|suaranya|ngomong|speak|talk|voice|slow down|speed up|slower|faster)\b/;
export function bacaLaju(teks: string): 'pelan' | 'cepat' | 'normal' | null {
  if (hitungKata(teks) > 6) return null;
  if (POLA_NORMAL.test(teks)) return 'normal';
  if (!POLA_KONTEKS_LAJU.test(teks)) return null;
  if (POLA_PELAN.test(teks)) return 'pelan';
  if (POLA_CEPAT.test(teks)) return 'cepat';
  return null;
}
export const LAJU_MIN = 0.7;
export const LAJU_MAKS = 1.5;
export const LAJU_LANGKAH = 0.15;
export const ubahLaju = (sekarang: number, arah: 'pelan' | 'cepat' | 'normal') =>
  arah === 'normal'
    ? 1
    : Math.min(LAJU_MAKS, Math.max(LAJU_MIN, +(sekarang + (arah === 'cepat' ? LAJU_LANGKAH : -LAJU_LANGKAH)).toFixed(2)));

// ---------- 5. Ganti bahasa bicara ----------
const POLA_KERJA_BAHASA = /\b(?:bicara|berbicara|ngomong|pakai|gunakan|jawab|jawabnya|speak|talk|reply|answer|switch to|change to|use)\b/;
const POLA_INGGRIS = /\b(?:inggris|english)\b/;
const POLA_INDONESIA = /\b(?:indonesia|indonesian|indo)\b/;
export function bacaGantiBahasa(teks: string): Bahasa | null {
  if (hitungKata(teks) > 7) return null;
  if (POLA_INGGRIS.test(teks) && (POLA_KERJA_BAHASA.test(teks) || /\bbahasa\b/.test(teks) || /^english\b/.test(teks))) return 'en';
  if (POLA_INDONESIA.test(teks) && (POLA_KERJA_BAHASA.test(teks) || /\bbahasa\b/.test(teks))) return 'id';
  return null;
}

// ---------- 6. Deteksi bahasa ucapan ----------
// Hanya kata fungsi yang jarang dipakai di nama halaman/tab (nama halaman memang sengaja bercampur Inggris).
const KATA_EN = new Set([
  'the', 'is', 'are', 'was', 'were', 'what', 'whats', 'how', 'many', 'much', 'show', 'tell', 'give', 'me', 'my', 'please',
  'can', 'could', 'would', 'should', 'you', 'your', 'this', 'that', 'these', 'those', 'which', 'why', 'when', 'where', 'who',
  'does', 'did', 'do', 'have', 'has', 'had', 'there', 'any', 'from', 'with', 'about', 'last', 'next', 'total', 'of', 'it', 'i', 'we',
]);
const KATA_ID = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'apa', 'berapa', 'tolong', 'saya', 'aku', 'ini', 'itu', 'tidak', 'bisa', 'ada',
  'dengan', 'kenapa', 'bagaimana', 'gimana', 'sudah', 'belum', 'lihat', 'tampilkan', 'buka', 'ganti', 'pindah', 'geser', 'lompat',
  'jelaskan', 'berikan', 'kasih', 'dong', 'ya', 'nih', 'mana', 'siapa', 'kapan', 'bulan', 'tahun', 'halaman', 'tab', 'kamu', 'dia',
]);
export function deteksiBahasa(teks: string, sebelumnya: Bahasa = 'id'): Bahasa {
  let en = 0;
  let id = 0;
  for (const k of teks.split(' ')) {
    if (KATA_EN.has(k)) en += 1;
    if (KATA_ID.has(k)) id += 1;
  }
  if (en >= 2 && en > id) return 'en';
  if (id >= 1 && id >= en) return 'id';
  return sebelumnya; // ucapan sangat pendek / nama halaman saja -> tetap pakai bahasa sebelumnya
}

// ---------- 7. Aksi yang TIDAK boleh lewat suara ----------
// Asisten suara hanya membaca data & berpindah halaman. Mengubah, menghapus, memposting, menyetujui, atau
// membayar lewat suara berisiko (salah dengar = salah jurnal). Perintah seperti itu ditolak dengan sopan,
// supaya AI juga tidak pernah "mengaku" sudah melakukannya.
const POLA_KERJA_RISIKO =
  /\b(?:hapus|hapuskan|menghapus|delete|remove|void|batalkan jurnal|posting|memposting|postingkan|post|approve|setujui|menyetujui|reverse|reversal|balik jurnal|bayar|bayarkan|membayar|transfer|kirim|kirimkan|ubah saldo|edit|ubah data|update data|tutup buku|close the books|lock|kunci|import|impor|upload)\b/;
const POLA_OBJEK_DATA =
  /\b(?:jurnal|journal|transaksi|transaction|invoice|faktur|bill|tagihan|akun|account|client|klien|saldo|balance|data|entry|entri|rekonsiliasi|reconciliation|payroll|gaji|periode|period|pembayaran|payment|receipt|penerimaan|piutang|utang|hutang|karyawan|employee|buku|books|dokumen|document|rekening|koran|statement|semua|all|ini|itu|this|it)\b/;
// kalimat tanya / minta penjelasan boleh diteruskan ke AI ("bagaimana cara menghapus jurnal?")
const POLA_TANYA = /^(?:berapa|apa|apakah|siapa|kapan|kenapa|mengapa|bagaimana|gimana|jelaskan|cara|tolong jelaskan|bisakah|how|what|why|when|can you explain|explain|is it|does)\b|\b(?:cara|how to|bagaimana cara)\b/;
// perintah navigasi ("buka tab posted") tidak boleh dikira aksi posting
const POLA_NAVIGASI = /\b(?:buka|pindah|ganti ke|geser|lompat|go to|open|switch to|ke tab|ke halaman)\b/;

export function aksiTerlarang(teks: string): boolean {
  if (hitungKata(teks) > 14) return false;
  if (POLA_TANYA.test(teks)) return false;
  if (!POLA_KERJA_RISIKO.test(teks)) return false;
  if (POLA_NAVIGASI.test(teks) && !/\b(?:hapus|delete|remove|void|approve|setujui)\b/.test(teks)) return false;
  return POLA_OBJEK_DATA.test(teks);
}

// [BARU] "ganti journal transaction" (tanpa kata tujuan seperti ke/tab/halaman/buka) membingungkan: pindah ke tab
// Journal Entry, atau mengubah jurnal yang ada di layar? Hanya kasus seperti ini yang ditanyakan balik.
// "ganti ke journal entry", "ganti tab jurnal", "buka jurnal" = jelas (ada kata tujuan) -> langsung dijalankan.
const POLA_GANTI_TANPA_TUJUAN = /\b(?:ganti|gantikan|change|switch)\b/;
const POLA_KATA_TUJUAN = /\b(?:ke|to|buka|bukakan|open|pindah|pindahkan|menuju|halaman|page|tab|menu|beralih|arahkan|bawa|go|navigate)\b/;
const POLA_OBJEK_AMBIGU = /\b(?:jurnal|journal|transaksi|transaction|transactions|entri|entry|invoice|faktur|bill|tagihan|akun|account|saldo|balance|receipt|penerimaan|pembayaran|payment|data)\b/;
export function ambiguGantiAtauPindah(teks: string): boolean {
  if (hitungKata(teks) > 8) return false;
  if (!POLA_GANTI_TANPA_TUJUAN.test(teks)) return false;
  if (POLA_KATA_TUJUAN.test(teks)) return false;
  return POLA_OBJEK_AMBIGU.test(teks);
}

export const PESAN_TERLARANG = {
  id: 'Maaf, aksi itu tidak bisa lewat suara demi keamanan. Silakan lakukan langsung di layar.',
  en: 'Sorry, that action is not allowed by voice for safety. Please do it on screen.',
} as const;

// ---------- Pengaturan yang bisa diubah ----------
export const KONFIRMASI_GANTI_CLIENT = false; // tidak dipakai lagi: ganti client langsung tanpa konfirmasi
export const KONFIRMASI_TIMEOUT_MS = 20000; // tak dijawab dalam waktu ini -> otomatis dibatalkan
export const UNDO_KEDALUWARSA_MS = 60000; // "batalkan" hanya berlaku untuk aksi dalam 1 menit terakhir
export const IDLE_MIC_MATI_MS = 10 * 60 * 1000; // mic dimatikan otomatis bila tak ada aktivitas selama ini
export const PTT_MAKS_TUNGGU_MS = 10000; // mode tekan-untuk-bicara: mic menutup bila tak ada suara selama ini