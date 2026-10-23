// kameraLihat.ts — "mata" untuk Neo: ambil SATU foto dari kamera laptop saat pengguna memintanya.
//
// Prinsip privasi (sengaja ketat, karena dashboard ini memuat data keuangan client):
//  - Kamera TIDAK menyala terus. Dinyalakan hanya sepersekian detik untuk mengambil 1 frame, lalu semua track dimatikan.
//  - Hanya dijalankan kalau ucapan pengguna jelas meminta Neo melihat dirinya / lewat kamera (perluKamera).
//  - Browser tetap meminta izin kamera (sekali, lalu diingat oleh browser). Ditolak -> Neo bilang tidak bisa melihat.
//  - Foto tidak disimpan di sisi aplikasi: hanya dikirim ke backend -> Claude, lalu dibuang.
//
// Pakai dari VoiceAssistant.tsx:
//   if (perluKamera(ucapan)) { const h = await ambilFotoKamera(); if (h.ok) gambar = h.base64; else catatan = h.pesan; }

// Pola ucapan yang berarti "lihat aku / pakai kamera". Sengaja spesifik supaya kamera tidak menyala sembarangan.
const POLA_KAMERA = new RegExp(
  [
    'wajah ?(ku|saya|aku)\\b',
    // "deskripsikan aku" jelas; "jelaskan/ceritakan/sebutkan" hanya kalau objeknya diri/penampilan/wajah MILIK pengguna
    '(deskripsi|gambar)(kan)? (aku|saya|diriku)\\b',
    '(deskripsi|gambarkan|ceritakan|jelaskan|sebutkan)(kan)? (diriku|(penampilan|wajah|muka)(ku| saya| aku))\\b',
    // "lihat aku/saya" HANYA kalau kalimat berakhir di situ atau diikuti kata penutup ("lihat saya punya invoice" TIDAK memicu)
    '(lihat|liat|melihat|tengok|perhatikan)(kah|in)? (aku|saya)(?= ?(dong|deh|nih|ya|dulu|sekarang|lewat|pakai|pake)\\b| ?[.?!,]|\\s*$)',
    '(lihat|liat|melihat|tengok|perhatikan)(kah|in)? (diriku|(wajah|muka|penampilan)(ku| saya| aku)?)\\b',
    'kamu (bisa |dapat |sedang |lagi )?(lihat|liat|melihat) (diriku|wajahku|mukaku)\\b',
    'kamu (bisa |dapat |sedang |lagi )?(lihat|liat|melihat) (aku|saya)(?= ?(dong|deh|nih|ya|dulu|sekarang|lewat|pakai|pake)\\b| ?[.?!,]|\\s*$)',
    // "saya pakai apa" mudah salah picu di konteks akuntansi -> wajib "sedang/lagi", atau objek pakaian, atau penutup waktu
    '(aku|saya) (sedang |lagi )(pakai|memakai|pake|mengenakan) (apa|baju|kacamata|topi|masker)\\b',
    '(aku|saya) (pakai|memakai|pake|mengenakan) (baju|kacamata|topi|masker)\\b',
    '(aku|saya) (pakai|memakai|pake|mengenakan) apa(?= ?(sekarang|hari ini|nih|ya)\\b| ?[?!]|\\s*$)',
    '(baju|pakaian|kacamata|rambut|penampilan|ekspresi|muka|wajah)(ku| aku| saya)\\b',
    '(pakai|pake|gunakan|nyalakan|aktifkan|buka|lewat|dari) kamera',
    'kamera (laptop|depan|webcam|ku)',
    'apa yang (kamu|neo) (lihat|liat) (di|lewat|dari) (kamera|depan)',
    'ada apa di (depan|belakang)ku',
    'siapa (yang )?(di depan|ada di depan) (kamera|kamu)',
  ].join('|'),
  'i'
);

// Pertanyaan tentang DATA wajah ("apakah data wajahku sudah tersimpan di database?") dijawab lewat alat database, bukan kamera.
const POLA_TENTANG_DATA = /\b(database|basis data|tersimpan|disimpan|terdaftar|didaftarkan|profil)\b|\bdata (wajah|muka)/i;

export const perluKamera = (ucapan: string): boolean => {
  const u = ucapan || '';
  return !POLA_TENTANG_DATA.test(u) && POLA_KAMERA.test(u);
};

export type HasilKamera =
  | { ok: true; base64: string; lebar: number; tinggi: number; kanvas: HTMLCanvasElement; frames: HTMLCanvasElement[] }
  | { ok: false; pesan: string };

const SISI_MAKS_PX = 768; // cukup untuk mendeskripsikan wajah/ekspresi, ukuran kecil -> cepat & murah
const KUALITAS_JPEG = 0.8;
const JEDA_EXPOSURE_MS = 700; // beri waktu kamera menyesuaikan cahaya (frame pertama sering gelap)
const BATAS_IZIN_MS = 30000; // menunggu pengguna menekan "Izinkan" pada dialog izin browser (pertama kali bisa lama)
const BATAS_WAKTU_MS = 8000; // kamera yang sudah diizinkan tapi tidak mau nyala/tidak ada gambar jangan membuat Neo menggantung

function matikan(stream: MediaStream | null) {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* abaikan */ }
}

/**
 * Tunggu stream sampai `batasMs`. Kalau timeout lebih dulu, stream yang baru jadi SETELAH itu (mis. pengguna baru klik
 * "Izinkan") langsung dimatikan, supaya lampu kamera tidak menyala terus tanpa ada yang memakai.
 */
function tungguStream(janji: Promise<MediaStream>, batasMs: number, kodeTimeout: string): Promise<MediaStream> {
  return new Promise<MediaStream>((selesai, tolak) => {
    let kedaluwarsa = false;
    const timer = setTimeout(() => { kedaluwarsa = true; tolak(new Error(kodeTimeout)); }, batasMs);
    janji.then(
      (s) => { clearTimeout(timer); if (kedaluwarsa) matikan(s); else selesai(s); },
      (e) => { clearTimeout(timer); if (!kedaluwarsa) tolak(e); },
    );
  });
}

/**
 * Nyalakan kamera sebentar, ambil `jumlah` frame (default 1), lalu matikan kamera. Tidak pernah melempar.
 * Hasil: base64 JPEG (tanpa prefix data:) dari frame TERAKHIR + kanvasnya (untuk pengenalan wajah lokal) + semua frame.
 * `jedaMs` = jarak antar frame (dipakai saat pendaftaran wajah supaya sampelnya sedikit bervariasi).
 */
async function ambilFotoKameraInternal(jumlah: number, jedaMs: number): Promise<HasilKamera> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, pesan: 'Browser ini tidak bisa mengakses kamera. Kamera hanya jalan di HTTPS atau localhost.' };
  }
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  try {
    // Coba dengan preferensi resolusi dulu; kalau kamera menolak syarat itu (Overconstrained/TypeError/dst), ulangi TANPA syarat apa pun.
    const buka = async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e: any) {
        if (/NotAllowed|Permission|Security|NotReadable|TrackStart/i.test(String(e?.name || ''))) throw e; // izin/kamera terpakai: ulangi tidak menolong
        console.warn('[kamera] syarat resolusi ditolak, mencoba tanpa syarat:', e);
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    };
    stream = await tungguStream(buka(), BATAS_IZIN_MS, 'timeout-izin');
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await Promise.race([
      new Promise<void>((selesai, tolak) => {
        video!.onloadedmetadata = () => video!.play().then(() => selesai()).catch(tolak);
        video!.onerror = () => tolak(new Error('video-error'));
      }),
      new Promise<never>((_, tolak) => setTimeout(() => tolak(new Error('timeout-kamera')), BATAS_WAKTU_MS)),
    ]);
    await new Promise((r) => setTimeout(r, JEDA_EXPOSURE_MS));

    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < Math.max(1, jumlah); i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, jedaMs));
      const w0 = video.videoWidth;
      const h0 = video.videoHeight;
      if (!w0 || !h0) return { ok: false, pesan: 'Kamera menyala tapi belum ada gambar. Coba lagi sebentar.' };
      const skala = Math.min(1, SISI_MAKS_PX / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w0 * skala);
      canvas.height = Math.round(h0 * skala);
      const ctx = canvas.getContext('2d');
      if (!ctx) return { ok: false, pesan: 'Gagal memproses gambar kamera.' };
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas);
    }
    const kanvas = frames[frames.length - 1];
    const base64 = kanvas.toDataURL('image/jpeg', KUALITAS_JPEG).split(',')[1] || '';
    if (!base64) return { ok: false, pesan: 'Gagal memproses gambar kamera.' };
    return { ok: true, base64, lebar: kanvas.width, tinggi: kanvas.height, kanvas, frames };
  } catch (e: any) {
    const nama = `${e?.name || ''} ${e?.message || ''}`; // name saja ('Error') tidak memuat kode timeout-*, jadi gabungkan dengan message
    if (/NotAllowed|Permission|Security/i.test(nama)) return { ok: false, pesan: 'Izin kamera ditolak. Izinkan kamera di pengaturan situs browser, lalu minta lagi.' };
    if (/NotFound|DevicesNotFound/i.test(nama)) return { ok: false, pesan: 'Kamera tidak ditemukan di perangkat ini.' };
    if (/NotReadable|TrackStart|Abort/i.test(nama)) return { ok: false, pesan: 'Kamera sedang dipakai aplikasi lain.' };
    if (/timeout-izin/.test(nama)) return { ok: false, pesan: 'Izin kamera belum diberikan. Klik Izinkan pada dialog browser, lalu minta lagi.' };
    if (/timeout-kamera/.test(nama)) return { ok: false, pesan: 'Kamera terlalu lama menyala.' };
    console.error('[kamera] gagal:', e); // detail untuk diagnosis: buka DevTools (F12) > Console
    return { ok: false, pesan: `Kamera tidak bisa dibuka (${String(e?.name || e?.message || 'galat tidak dikenal').slice(0, 40)}).` };
  } finally {
    if (video) { video.pause(); video.srcObject = null; }
    matikan(stream); // kamera SELALU dimatikan lagi, apa pun hasilnya
  }
}

// Antrean: sapaan awal, "lihat aku", dan pendaftaran wajah bisa memanggil bersamaan. Dijalankan satu per satu supaya
// tidak pernah ada dua stream kamera terbuka sekaligus (panggilan kedua menunggu kamera dimatikan dulu).
let antrean: Promise<unknown> = Promise.resolve();
export function ambilFotoKamera(jumlah = 1, jedaMs = 500): Promise<HasilKamera> {
  const giliran = antrean.then(() => ambilFotoKameraInternal(jumlah, jedaMs));
  antrean = giliran.catch(() => { /* ambilFotoKameraInternal tidak melempar; jaga-jaga supaya antrean tidak macet */ });
  return giliran;
}

export type HasilIzin = 'diizinkan' | 'ditolak' | 'tidak-ada' | 'tidak-didukung' | 'gagal';

async function mintaIzinKameraInternal(): Promise<HasilIzin> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'tidak-didukung';
  try {
    // Kalau izin sudah diputuskan sebelumnya, tidak perlu menyalakan kamera (lampu tidak berkedip tanpa guna).
    const st = await (navigator as any).permissions?.query({ name: 'camera' });
    if (st?.state === 'granted') return 'diizinkan';
    if (st?.state === 'denied') return 'ditolak';
  } catch { /* browser tidak mendukung query izin kamera: lanjut meminta langsung */ }
  let stream: MediaStream | null = null;
  try {
    stream = await tungguStream(navigator.mediaDevices.getUserMedia({ video: true, audio: false }), BATAS_IZIN_MS, 'timeout-izin');
    return 'diizinkan';
  } catch (e: any) {
    const nama = `${e?.name || ''} ${e?.message || ''}`;
    if (/NotAllowed|Permission|Security/i.test(nama)) return 'ditolak';
    if (/NotFound|DevicesNotFound/i.test(nama)) return 'tidak-ada';
    return 'gagal';
  } finally {
    matikan(stream); // kamera langsung dimatikan lagi: ini hanya untuk memunculkan dialog izin
  }
}

/**
 * Minta IZIN kamera saja (tanpa mengambil foto). Dipanggil saat aplikasi dibuka, bersamaan dengan izin mikrofon, supaya semua
 * izin beres di awal. Masuk antrean yang sama dengan ambilFotoKamera, jadi tidak pernah ada dua stream kamera sekaligus. Tidak pernah melempar.
 */
export function mintaIzinKamera(): Promise<HasilIzin> {
  const giliran = antrean.then(() => mintaIzinKameraInternal());
  antrean = giliran.catch(() => { /* jaga-jaga supaya antrean tidak macet */ });
  return giliran;
}