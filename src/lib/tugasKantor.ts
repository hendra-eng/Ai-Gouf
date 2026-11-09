// Tugas agen di halaman Agentic AI. Pengguna (lewat Neo, asisten suara global) menyuruh Neo / Atlas / Zeno mengecek satu
// halaman Transactions; agen yang ditugaskan berjalan ke MEJA yang terhubung dengan halaman itu, bekerja di sana, lalu
// kembali ke meja rapat. Halaman Agentic AI hanya mendengar event-nya dan menggerakkan agen di scene
// (OfficeScene.tsx). Pola yang sama dengan rapatKantor.ts.

import { kantorTugasDaftar, kantorTugasMulai, kantorTugasSelesai } from '@/app/zafeb-ai/lib/api';

export type AgenKantor = 'Neo' | 'Atlas' | 'Zeno';
export const SEMUA_AGEN: AgenKantor[] = ['Neo', 'Atlas', 'Zeno'];

// URUTAN = nomor meja di OfficeScene (DESKS[0..4]): meja 1 = Sales, ..., meja 5 = Other.
// Meja 1-3 baris belakang (kiri -> kanan), meja 4-5 baris depan (kiri -> kanan).
export const HALAMAN_MEJA: { id: string; nama: string; href: string }[] = [
  { id: 'sales', nama: 'Sales', href: '/transactions/sales' },
  { id: 'purchase', nama: 'Purchase', href: '/transactions/purchase' },
  { id: 'journal-entry', nama: 'Journal Entry', href: '/transactions/journal-entry' },
  { id: 'bank-cash', nama: 'Cash & Bank', href: '/transactions/bank-cash' },
  { id: 'other', nama: 'Other', href: '/transactions/other' },
];

export const EVENT_TUGAS = 'kantor-tugas';

// Berapa lama (maksimal) agen bekerja di mejanya sebelum otomatis kembali ke meja rapat. Tugas disimpan dengan waktu
// berakhir ABSOLUT, jadi tetap berlaku walau halaman di-refresh / pengguna keluar lalu masuk lagi. Kalau waktunya lewat,
// tugas otomatis dianggap selesai (tidak ada "tugas hantu" yang membuat komputer menyala terus).
export const DURASI_KERJA_MS = 120000;
const KUNCI_SIMPAN = 'kantor-tugas-v1';

type Rekam = { meja: number; mulai: number; berakhir: number };
const tugas: Record<AgenKantor, Rekam | null> = { Neo: null, Atlas: null, Zeno: null };
const timerKerja: Partial<Record<AgenKantor, ReturnType<typeof setTimeout>>> = {};
// Agen yang tulisannya ke server masih berjalan: jangan ditimpa oleh sinkron dari server (hindari balapan).
const sedangTulis: Partial<Record<AgenKantor, number>> = {};
let sudahMuat = false;
let sudahDengar = false;

const adaWindow = () => typeof window !== 'undefined';

function simpan(): void {
  if (!adaWindow()) return;
  try {
    window.localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(tugas));
  } catch {
    /* penyimpanan penuh / diblokir: state tetap jalan di memori */
  }
}

function umumkan(): void {
  if (!adaWindow()) return;
  window.dispatchEvent(new CustomEvent(EVENT_TUGAS));
}

// Buang tugas yang sudah lewat waktu. Return true kalau ada yang dibuang.
function bersihkanKadaluarsa(): boolean {
  const kini = Date.now();
  let berubah = false;
  for (const a of SEMUA_AGEN) {
    const r = tugas[a];
    if (r && (r.berakhir <= kini || !Number.isFinite(r.berakhir) || HALAMAN_MEJA[r.meja] === undefined)) {
      tugas[a] = null;
      clearTimeout(timerKerja[a]);
      berubah = true;
    }
  }
  return berubah;
}

function pasangTimer(agen: AgenKantor): void {
  clearTimeout(timerKerja[agen]);
  const r = tugas[agen];
  if (!r) return;
  timerKerja[agen] = setTimeout(() => selesaiTugas(agen), Math.max(0, r.berakhir - Date.now()));
}

// Baca tugas tersimpan (sekali per sesi halaman) + sinkron antar-tab.
function pastikanMuat(): void {
  if (sudahMuat || !adaWindow()) return;
  sudahMuat = true;
  try {
    const mentah = window.localStorage.getItem(KUNCI_SIMPAN);
    if (mentah) {
      const data = JSON.parse(mentah) as Partial<Record<AgenKantor, Rekam | null>>;
      for (const a of SEMUA_AGEN) {
        const r = data[a];
        tugas[a] = r && typeof r.meja === 'number' && typeof r.berakhir === 'number' ? r : null;
      }
    }
  } catch {
    /* data rusak -> abaikan */
  }
  if (bersihkanKadaluarsa()) simpan();
  SEMUA_AGEN.forEach(pasangTimer);
  if (!sudahDengar) {
    sudahDengar = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== KUNCI_SIMPAN) return;
      sudahMuat = false;
      SEMUA_AGEN.forEach((a) => { tugas[a] = null; });
      pastikanMuat();
      umumkan();
    });
  }
}

// meja yang sedang dikerjakan tiap agen (null = tidak ada tugas). Sumber kebenarannya localStorage (lihat atas).
export function tugasSaatIni(): Record<AgenKantor, number | null> {
  pastikanMuat();
  if (bersihkanKadaluarsa()) { simpan(); umumkan(); }
  return { Neo: tugas.Neo?.meja ?? null, Atlas: tugas.Atlas?.meja ?? null, Zeno: tugas.Zeno?.meja ?? null };
}

// Beri tugas: agen pergi ke meja nomor `meja` (0..4). Satu meja hanya boleh dipakai satu agen.
export function berikanTugas(agen: AgenKantor, meja: number): { ok: true } | { ok: false; pemakai: AgenKantor } {
  pastikanMuat();
  bersihkanKadaluarsa();
  for (const a of SEMUA_AGEN) {
    if (a !== agen && tugas[a]?.meja === meja) return { ok: false, pemakai: a };
  }
  const kini = Date.now();
  const baru = tugas[agen]?.meja !== meja;
  tugas[agen] = { meja, mulai: baru ? kini : tugas[agen]!.mulai, berakhir: kini + DURASI_KERJA_MS };
  simpan();
  pasangTimer(agen);
  if (baru) umumkan();
  // Simpan ke DATABASE (sumber kebenaran lintas refresh / perangkat). Kalau server menolak (meja dipakai agen lain), batalkan.
  sedangTulis[agen] = (sedangTulis[agen] ?? 0) + 1;
  void kantorTugasMulai(agen, HALAMAN_MEJA[meja].id)
    .then((hasil) => {
      if (typeof hasil === 'object' && tugas[agen]?.meja === meja) {
        tugas[agen] = null;
        clearTimeout(timerKerja[agen]);
        simpan();
        umumkan();
      }
    })
    .finally(() => { sedangTulis[agen] = Math.max(0, (sedangTulis[agen] ?? 1) - 1); });
  return { ok: true };
}

// Tugas selesai (atau dibatalkan): agen kembali ke meja rapat.
export function selesaiTugas(agen: AgenKantor): void {
  pastikanMuat();
  clearTimeout(timerKerja[agen]);
  if (tugas[agen] === null) return;
  tugas[agen] = null;
  simpan();
  umumkan();
  sedangTulis[agen] = (sedangTulis[agen] ?? 0) + 1;
  void kantorTugasSelesai(agen).finally(() => { sedangTulis[agen] = Math.max(0, (sedangTulis[agen] ?? 1) - 1); });
}

// Samakan state dengan DATABASE (sumber kebenaran). Dipanggil saat halaman Agentic AI dibuka & berkala.
// Return true kalau server terjangkau. Kalau server tidak terjangkau, tetap pakai cadangan localStorage.
export async function sinkronTugasServer(): Promise<boolean> {
  pastikanMuat();
  const dariServer = await kantorTugasDaftar();
  if (!dariServer) return false;
  const kini = Date.now();
  let berubah = false;
  for (const a of SEMUA_AGEN) {
    if (sedangTulis[a]) continue;
    const s = dariServer[a];
    const meja = s ? HALAMAN_MEJA.findIndex((h) => h.id === s.halaman) : -1;
    const baru: Rekam | null = s && meja >= 0 ? { meja, mulai: kini - s.mulai_ms_lalu, berakhir: kini + s.sisa_ms } : null;
    const lama = tugas[a];
    if ((lama?.meja ?? null) !== (baru?.meja ?? null)) berubah = true;
    tugas[a] = baru;
    pasangTimer(a);
  }
  simpan();
  if (berubah) umumkan();
  return true;
}

// ---- Membaca perintah suara ----------------------------------------------------------------------------------------

// Pemahaman berbasis KATA KUNCI, bukan hafalan kalimat: di halaman Agentic AI, kalimat apa pun yang memuat
//   (1) nama salah satu agen  +  (2) nama / sebutan sebuah halaman  +  (3) tanda "menyuruh" (kata kerja ATAU penunjuk tempat)
// dianggap tugas untuk agen itu. "buka / pindah / masuk ke ..." di halaman ini BUKAN navigasi: artinya agen yang
// disuruh mengecek halaman itu (agen berjalan ke mejanya). Nada bicara bebas: sopan, santai, singkat, bahasa Inggris.
// Menambah gaya baru = cukup menambah kata di daftar di bawah; tidak perlu menulis kalimat lengkap.

// Nama agen + salah dengar yang umum dari mikrofon.
const POLA_AGEN: { agen: AgenKantor; re: RegExp }[] = [
  { agen: 'Atlas', re: /\b(?:atlas|atlass|atles|atlus|etlas|atlast)\b/ },
  { agen: 'Zeno', re: /\b(?:zeno|zenno|jeno|zino|xeno|zenor)\b/ },
  { agen: 'Neo', re: /\b(?:neo|nio|neyo)\b/ },
];

// Nomor meja bisa disebut langsung: "meja 3", "meja nomor tiga", "desk two", "meja kelima".
const mejaNo = (angka: string) =>
  `(?:meja|desk)\\s*(?:nomor\\s*|no\\s*|ke\\s*|number\\s*)?(?:${angka})`;

const POLA_HALAMAN: RegExp[] = [
  // 0 Sales
  new RegExp(
    '\\b(?:sales|sale|sels|seles|seils|sayles|selling|penjualan|jualan|jual|omzet|omset|revenue|pendapatan|faktur\\s+jual|invoice\\s+jual|nota\\s+jual|' +
      mejaNo('1|satu|pertama|one|first') + ')\\b'
  ),
  // 1 Purchase
  new RegExp(
    '\\b(?:purchase|purchases|purchasing|purcase|perchase|pembelian|pembelanjaan|belanja|beli|buying|tagihan\\s+supplier|faktur\\s+beli|invoice\\s+beli|nota\\s+beli|' +
      mejaNo('2|dua|kedua|two|second') + ')\\b'
  ),
  // 2 Journal Entry
  new RegExp(
    '\\b(?:journal|journals|jurnal|jurnel|jernal|jurnal\\s+umum|general\\s+ledger|memorial|' +
      mejaNo('3|tiga|ketiga|three|third') + ')\\b'
  ),
  // 3 Cash & Bank
  new RegExp(
    '\\b(?:cash\\s*(?:and|dan|n)?\\s*bank|cashbank|kas\\s*(?:dan\\s*)?bank|bank\\s*cash|bank\\s*feed|source\\s*data|bank\\s*statement|rekening\\s*koran|mutasi(?:\\s+(?:bank|rekening))?|buku\\s+(?:kas|bank)|kas|bank|cash|' +
      mejaNo('4|empat|keempat|four|fourth') + ')\\b'
  ),
  // 4 Other
  new RegExp(
    '\\b(?:other|others|lainnya|lain\\s*lain|lain\\s*nya|transaksi\\s+lain|miscellaneous|misc|serba\\s*serbi|' +
      mejaNo('5|lima|kelima|five|fifth') + ')\\b'
  ),
];

// Kata kerja menyuruh / meminta agen datang ke sebuah halaman. SENGAJA termasuk "buka / pindah / masuk / ke":
// di halaman Agentic AI semuanya berarti "agen, pergi ke meja itu", bukan pindah halaman.
const POLA_KERJA = new RegExp(
  '\\b(?:' +
    // mengecek / meninjau
    'cek|cekin|cekkin|ngecek|mengecek|periksa|periksain|memeriksa|check|verify|verifikasi|validasi|inspect|review|tinjau|meninjau|telusuri|menelusuri|teliti|meneliti|analisa|analisis|menganalisis|audit|pantau|memantau|monitor|awasi|mengawasi|jaga|menjaga|intip|tengok|menengok|' +
    // melihat / membuka / pergi
    'lihat|lihatin|melihat|liat|liatin|tampilkan|buka|bukain|membuka|open|masuk|masuki|memasuki|datangi|mendatangi|kunjungi|mengunjungi|visit|go|goes|head|swing|pergi|berangkat|menuju|tuju|pindah|pindahkan|geser|menyingkir|' +
    // mengerjakan / mengurus
    'kerjakan|kerjain|ngerjain|mengerjakan|bekerja|kerja|garap|menggarap|tangani|menangani|handle|urus|urusin|mengurus|beresin|bereskan|rapikan|rapihin|selesaikan|menyelesaikan|proses|memproses|process|work|take|look|see|' +
    // ajakan / tugas
    'tugas|tugasin|menugaskan|ditugaskan|jaga|standby|siaga|tolong|mohon|minta|silakan|silahkan|ayo|yuk|mari|gas|bantu|bantuin|membantu|help' +
  ')\\b'
);

// Penunjuk tempat: "Zeno di sales", "Atlas ke purchase", "Neo halaman jurnal", "Atlas meja bank". Cukup sebagai tanda menyuruh
// walau tanpa kata kerja ("Atlas ke sales dong").
const POLA_LOKASI = /\b(?:di|ke|pada|untuk|halaman|laman|page|meja|desk|tab|menu|bagian)\b/;

// Pertanyaan tentang ARTI / penjelasan (bukan perintah): "Atlas, sales itu apa?" jangan dianggap tugas hanya karena ada penunjuk tempat.
const POLA_TANYA_MAKNA = /\b(?:apa|kenapa|mengapa|berapa|gimana|bagaimana|kapan|siapa|artinya|jelaskan|menjelaskan|definisi|why|what|how|when|explain)\b/;

// Ucapan yang berarti BERHENTI / sudah / jangan: bukan perintah memulai tugas ("Atlas udah selesai di sales", "jangan cek purchase").
const POLA_HENTI = /\b(?:kembali|balik|pulang|selesai|sudah|udah|cukup|berhenti|stop|batal|batalkan|istirahat|jangan|jgn|tidak\s+usah|gak\s+usah|nggak\s+usah|ga\s+usah|no\s+need|never\s+mind|cancel)\b/;

// Layak dianggap tugas: ada kata kerja menyuruh, ATAU penunjuk tempat (bukan pertanyaan arti), ATAU panggilan singkat ("Atlas sales!").
function layakTugas(t: string): boolean {
  if (!t || POLA_HENTI.test(t)) return false;
  if (POLA_KERJA.test(t)) return true;
  if (POLA_TANYA_MAKNA.test(t)) return false;
  return POLA_LOKASI.test(t) || t.split(' ').length <= 4;
}

const POLA_PULANG = /\b(?:kembali|balik|pulang)\b.*\b(?:meja\s+)?(?:rapat|meeting)\b|\b(?:rapat|meeting)\b.*\b(?:kembali|balik)\b/;

const bersihkan = (teks: string) =>
  (teks || '').toLowerCase().replace(/[.,!?;:"“”()…\-&]/g, ' ').replace(/\s+/g, ' ').trim();

function cariAgen(t: string): AgenKantor | null {
  const ada = POLA_AGEN.filter((p) => p.re.test(t)).map((p) => p.agen);
  if (!ada.length) return null;
  // Neo juga yang diajak bicara; kalau nama lain disebut, tugasnya untuk agen itu.
  return ada.find((a) => a !== 'Neo') ?? 'Neo';
}

// "Atlas cek data di halaman sales" / "Atlas buka sales dong" -> { agen: 'Atlas', meja: 0 }. Butuh: nama agen + halaman + tanda menyuruh (lihat layakTugas).
export function bacaPerintahTugas(teks: string): { agen: AgenKantor; meja: number } | null {
  const t = bersihkan(teks);
  if (!layakTugas(t)) return null;
  const agen = cariAgen(t);
  if (!agen) return null;
  let meja = -1;
  let posisi = Infinity;
  POLA_HALAMAN.forEach((re, i) => {
    const m = t.match(re);
    if (m && m.index !== undefined && m.index < posisi) {
      posisi = m.index;
      meja = i;
    }
  });
  return meja >= 0 ? { agen, meja } : null;
}

// [BARU] Halaman (indeks meja) yang disebut paling awal dalam potongan teks; -1 kalau tidak ada.
function halamanPertama(t: string): number {
  let meja = -1;
  let posisi = Infinity;
  POLA_HALAMAN.forEach((re, i) => {
    const m = t.match(re);
    if (m && m.index !== undefined && m.index < posisi) {
      posisi = m.index;
      meja = i;
    }
  });
  return meja;
}

// [BARU] Banyak tugas sekaligus dalam satu kalimat: "Neo di sales, Zeno di purchase, Atlas di cash bank".
// Teks dipotong per nama agen; halaman yang disebut setelah nama = tugas agen itu. Butuh >= 2 agen berbeda dengan halaman
// berbeda (satu meja = satu agen); kalau kurang dari itu, kembalikan [] dan biarkan bacaPerintahTugas yang menangani.
export function bacaPerintahTugasBanyak(teks: string): { agen: AgenKantor; meja: number }[] {
  const t = bersihkan(teks);
  if (!layakTugas(t)) return [];
  const sebut: { agen: AgenKantor; idx: number }[] = [];
  for (const p of POLA_AGEN) {
    const re = new RegExp(p.re.source, 'g');
    for (const m of t.matchAll(re)) if (m.index !== undefined) sebut.push({ agen: p.agen, idx: m.index });
  }
  if (sebut.length < 2) return [];
  sebut.sort((a, b) => a.idx - b.idx);
  const hasil: { agen: AgenKantor; meja: number }[] = [];
  sebut.forEach((h, i) => {
    const meja = halamanPertama(t.slice(h.idx, sebut[i + 1]?.idx ?? t.length));
    if (meja < 0) return;
    if (hasil.some((x) => x.agen === h.agen || x.meja === meja)) return;
    hasil.push({ agen: h.agen, meja });
  });
  return hasil.length >= 2 ? hasil : [];
}

// [BARU] Apakah perintah ini MENGUBAH keadaan sekarang? (agen belum bekerja di meja itu). Dipakai untuk membedakan perintah
// pengguna yang asli dari gema konfirmasi Neo sendiri ("Baik, Atlas, tolong cek halaman Other"), yang selalu sama dengan
// keadaan yang baru saja diset.
export function perintahTugasBaru(teks: string): boolean {
  const sekarang = tugasSaatIni();
  const banyak = bacaPerintahTugasBanyak(teks);
  if (banyak.length) return banyak.some((x) => sekarang[x.agen] !== x.meja);
  const satu = bacaPerintahTugas(teks);
  return !!satu && sekarang[satu.agen] !== satu.meja;
}

// "Atlas kembali ke meja rapat" -> agen berhenti bekerja dan pulang.
export function bacaPerintahPulang(teks: string): AgenKantor | null {
  const t = bersihkan(teks);
  if (!t || !POLA_PULANG.test(t)) return null;
  return cariAgen(t);
}

// ---- [BARU] Perintah "proses file WhatsApp sampai Post" -------------------------------------------------------------
// "Atlas, aku baru kirim file data penjualan untuk klien SAU, tolong upload sampai posting"
//   -> agen Atlas + halaman Sales (meja 0) + kata kerja proses file. Dicek SEBELUM bacaPerintahTugas (yang hanya menggerakkan
//   agen secara visual 120 detik). Kata kerja KUAT (upload/unggah/posting) cukup sendirian; "proses"/"input" harus disertai kata file/data,
//   supaya "Atlas proses halaman sales" tetap dianggap tugas cek biasa.
const POLA_PROSES_KUAT = /\b(?:upload|uploadkan|uploud|unggah|unggahkan|ungah|posting|postingkan|memposting|post|diposting)\b/;
const POLA_PROSES_LEMAH = /\b(?:proses|prosesin|prosesnya|memproses|process|input|inputkan|masukkan|masukin)\b/;
const POLA_KATA_FILE = /\b(?:file|berkas|dokumen|document|data|kiriman|csv|excel|xlsx|whatsapp|wa)\b/;
const POLA_BATAL_PROSES = /\b(?:jangan|jgn|batal|batalkan|cancel|stop|berhenti|tidak\s+usah|gak\s+usah|nggak\s+usah)\b/;

// [BARU] Upload file di halaman Sales HANYA oleh Atlas (master expert accounting: memeriksa kejanggalan sebelum Approve/Post).
// Aturan yang sama dijaga di backend (neo_wa_pipeline.mulai), jadi ini hanya supaya Neo menolak dengan ramah sebelum memanggil API.
export const AGEN_UPLOAD_SALES: AgenKantor = 'Atlas';

// [ATURAN MUTLAK] Upload file di halaman Sales SELALU dikerjakan Atlas, siapa pun yang diminta pengguna (Neo, Zeno, atau tanpa
// nama). Agen yang diminta TIDAK menolak: ia mengonfirmasi klien + halaman, lalu MENYERAHKAN pekerjaan ke Atlas.
// Halaman lain: dikerjakan agen yang diminta, seperti sebelumnya. Backend menjaga aturan yang sama (neo_wa_pipeline.mulai).
export function pelaksanaUpload(agen: AgenKantor, meja: number): AgenKantor {
  return meja === 0 ? AGEN_UPLOAD_SALES : agen; // meja 0 = Sales
}

// "Atlas, upload file ke halaman sales untuk klien SAU" / "Neo, upload file ke sales" / "upload file ke halaman sales" (tanpa nama).
// Tanpa nama agen, ucapan harus jelas soal FILE dan menyebut halaman dengan penanda ("ke halaman sales"), supaya "posting jurnal"
// biasa tidak dikira perintah memproses file. Tanpa nama agen = yang diajak bicara, yaitu Neo.
// [DIUBAH] adaKlien = ucapan yang sama sudah menyebut kode klien yang valid. Kalau halaman (dengan penanda "ke halaman ...") DAN klien sama-sama
// jelas, kata "file" tidak wajib lagi ("upload ke halaman purchase untuk klien AADL"), jadi Neo langsung bertanya "Lanjut?", tidak bertanya ulang.
export function bacaPerintahProsesFile(teks: string, adaKlien = false): { agen: AgenKantor; meja: number } | null {
  const t = bersihkan(teks);
  if (!t || POLA_BATAL_PROSES.test(t) || POLA_TANYA_MAKNA.test(t)) return null; // pertanyaan ("apa itu posting?") bukan perintah
  const kuat = POLA_PROSES_KUAT.test(t);
  if (!kuat && !(POLA_PROSES_LEMAH.test(t) && POLA_KATA_FILE.test(t))) return null;
  const disebut = cariAgen(t);
  if (disebut) {
    const meja = halamanPertama(t);
    return meja >= 0 ? { agen: disebut, meja } : null;
  }
  if (!POLA_KATA_FILE.test(t) && !(adaKlien && kuat)) return null;
  const meja = halamanTujuan(teks);
  return meja >= 0 ? { agen: 'Neo', meja } : null;
}

// "upload file dong" / "Atlas, tolong upload file yang barusan": jelas minta upload file tapi halamannya belum disebut.
// Neo menanyakan halamannya (bukan menolak). Sengaja sempit: hanya kata kerja upload/unggah + kata file/berkas/WhatsApp.
const POLA_UNGGAH = /\b(?:upload|uploadkan|uploud|unggah|unggahkan|ungah)\b/;
const POLA_KATA_FILE_KETAT = /\b(?:file|berkas|dokumen|document|kiriman|csv|excel|xlsx|whatsapp|wa)\b/;
export function bacaPerintahProsesFileTanpaHalaman(teks: string): { agen: AgenKantor } | null {
  const t = bersihkan(teks);
  if (!t || t.split(' ').length > 20 || POLA_BATAL_PROSES.test(t) || POLA_TANYA_MAKNA.test(t)) return null;
  if (!POLA_UNGGAH.test(t) || !POLA_KATA_FILE_KETAT.test(t)) return null;
  if (halamanPertama(t) >= 0 || halamanTujuan(teks) >= 0) return null;
  return { agen: cariAgen(t) ?? 'Neo' };
}

// Cari klien yang disebut dalam ucapan: kode persis ("sau") atau huruf-huruf terpisah yang membentuk kode ("s a u").
// Hanya cocok kalau TEPAT SATU klien; ragu = null (Neo bertanya, tidak menebak).
export function cariKlienDalamUcapan<T extends { clientCode: string }>(teks: string, daftar: T[]): T | null {
  const t = bersihkan(teks);
  if (!t) return null;
  const token = t.split(' ');
  const cocok = new Map<string, T>();
  for (const c of daftar) {
    const kode = (c.clientCode || '').toLowerCase();
    if (kode.length < 2 || kode === '-') continue;
    if (token.includes(kode)) { cocok.set(kode, c); continue; }
    // huruf kode terpisah berturut-turut: "s a u"
    for (let i = 0; i + kode.length <= token.length; i++) {
      if (token.slice(i, i + kode.length).join('') === kode && token.slice(i, i + kode.length).every((k) => k.length === 1)) { cocok.set(kode, c); break; }
    }
  }
  return cocok.size === 1 ? [...cocok.values()][0] : null;
}

// ---- [BARU] File LAMA: "file apa yang kamu pegang tapi belum diupload?" -> pilih salah satu -> "upload ke halaman ..." ---------
// Alurnya: (1) pengguna bertanya -> Neo membacakan daftar bernomor (dari server); (2) pengguna menyebut file (nama atau nomor),
// halaman, dan kode klien, boleh dicicil dalam beberapa ucapan; (3) Neo membacakan konfirmasi, pengguna bilang "ya".
export type FileLama = { nama: string; lisan: string; menit_lalu: number; status?: string };

const POLA_FILE_KATA = /\b(?:file|berkas|dokumen|kiriman|lampiran)\b/;
const POLA_BELUM = /\b(?:belum|blm)\b/;
const POLA_AKSI_UPLOAD = /\b(?:upload|uploud|uploadkan|diupload|unggah|diunggah|proses|diproses|posting|diposting|dikerjakan|dimasukkan|dimasukin|diinput)\b/;
const POLA_MINTA_DAFTAR = /\b(?:apa|mana|berapa|sebut|sebutkan|daftar|list|ada|kasih\s+tahu|beritahu|kabari)\b/;

// "file apa yang kamu pegang tapi belum diupload?" / "ada file yang belum diproses?" / "sebutkan file yang belum kamu upload"
export function bacaTanyaFileBelumUpload(teks: string): boolean {
  const t = bersihkan(teks);
  if (!t || t.split(' ').length > 25 || POLA_BATAL_PROSES.test(t)) return false;
  return POLA_FILE_KATA.test(t) && POLA_BELUM.test(t) && POLA_AKSI_UPLOAD.test(t) && POLA_MINTA_DAFTAR.test(t);
}

// Halaman yang disebut dengan penanda ("ke halaman sales", "di purchase", "meja 3"). SENGAJA tidak mengambil kata halaman
// sembarang: nama file seperti "penjualan oktober" memuat kata "penjualan", yang bukan halaman tujuan.
const POLA_PENANDA_HALAMAN = /\b(?:halaman|laman|page|tab|meja|desk|ke|di)\s+/g;
export function halamanTujuan(teks: string): number {
  const t = bersihkan(teks);
  let terbaik = -1;
  let posisi = Infinity;
  const coba = (potong: string, awal: number) => {
    POLA_HALAMAN.forEach((re, i) => {
      if (awal < posisi && new RegExp('^(?:' + re.source + ')').test(potong)) { posisi = awal; terbaik = i; }
    });
  };
  for (const m of t.matchAll(POLA_PENANDA_HALAMAN)) {
    const awal = (m.index ?? 0) + m[0].length;
    coba(t.slice(awal, awal + 40), awal);
  }
  // "meja 3" / "meja nomor tiga": kata "meja" sendiri bagian dari pola halaman
  for (const m of t.matchAll(/\b(?:meja|desk)\b/g)) coba(t.slice(m.index ?? 0, (m.index ?? 0) + 40), m.index ?? 0);
  return terbaik;
}
// Jawaban pendek yang hanya berisi nama halaman ("sales", "journal entry"): dipakai saat Neo menanyakan halamannya.
export const halamanDalamUcapan = (teks: string): number => halamanPertama(bersihkan(teks));

const ORDINAL: Record<string, number> = {
  pertama: 0, satu: 0, '1': 0, kedua: 1, dua: 1, '2': 1, ketiga: 2, tiga: 2, '3': 2, keempat: 3, empat: 3, '4': 3, kelima: 4, lima: 4, '5': 4,
  keenam: 5, enam: 5, '6': 5, ketujuh: 6, tujuh: 6, '7': 6, kedelapan: 7, delapan: 7, '8': 7, kesembilan: 8, sembilan: 8, '9': 8, kesepuluh: 9, sepuluh: 9, '10': 9,
};
// kata yang ada di hampir semua nama file: tidak membedakan satu file dari file lain
const KATA_UMUM_NAMA = new Set(['file', 'data', 'laporan', 'report', 'berkas', 'dokumen', 'whatsapp', 'img', 'image', 'scan', 'copy', 'final', 'new', 'xlsx', 'xls', 'csv', 'pdf']);

function tokenNama(s: string): string[] {
  return bersihkan((s || '').replace(/[_.]+/g, ' ')).split(' ').filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !KATA_UMUM_NAMA.has(w));
}

// Pilih file dari ucapan: nomor urut ("yang kedua", "file nomor 3", "terakhir"), nama ("yang penjualan oktober"), atau "file itu" bila hanya satu.
// file = pasti satu; ambigu = beberapa cocok (Neo bertanya); diluar = nomor yang disebut tidak ada di daftar.
export function pilihFileDariUcapan(teks: string, daftar: FileLama[]): { file: FileLama | null; ambigu: FileLama[]; diluar: boolean } {
  const kosong = { file: null, ambigu: [] as FileLama[], diluar: false };
  if (!daftar.length) return kosong;
  let t = bersihkan(teks);
  // buang sebutan halaman, meja, dan klien supaya tidak dikira nama/nomor file
  t = t.replace(/\b(?:meja|desk)\s*(?:nomor\s*|no\s*|ke\s*|number\s*)?\S+/g, ' ');
  t = t.replace(/\b(?:halaman|laman|page|tab)\s+\S+(?:\s+(?:and|dan|n)\s+\S+)?/g, ' ');
  t = t.replace(/\b(?:klien|client)\s+(?:\S\s+){0,3}\S+/g, ' ');
  const mo = t.match(/\b(?:file|berkas|yang|nomor|no|number)\s+(?:nomor\s+|no\s+|ke\s*)?(pertama|kedua|ketiga|keempat|kelima|keenam|ketujuh|kedelapan|kesembilan|kesepuluh|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|10|1|2|3|4|5|6|7|8|9)\b/);
  if (mo) {
    const i = ORDINAL[mo[1]];
    return i < daftar.length ? { ...kosong, file: daftar[i] } : { ...kosong, diluar: true };
  }
  if (/\b(?:terakhir|terlama|paling\s+lama)\b/.test(t)) return { ...kosong, file: daftar[daftar.length - 1] };
  if (/\b(?:terbaru|paling\s+baru)\b/.test(t)) return { ...kosong, file: daftar[0] };
  const kata = new Set(t.split(' '));
  let maks = 0;
  let terbaik: FileLama[] = [];
  for (const f of daftar) {
    const skor = [...new Set(tokenNama(f.lisan))].filter((w) => kata.has(w)).length;
    if (skor > maks) { maks = skor; terbaik = [f]; } else if (skor === maks && skor > 0) terbaik.push(f);
  }
  if (maks > 0) return terbaik.length === 1 ? { ...kosong, file: terbaik[0] } : { ...kosong, ambigu: terbaik };
  if (daftar.length === 1 && /\b(?:itu|tersebut|tadi|ini)\b/.test(t)) return { ...kosong, file: daftar[0] };
  return kosong;
}

// "Atlas, upload file penjualan oktober ke halaman sales untuk klien SAU" / "upload yang kedua ke purchase".
// HANYA berlaku bila daftar file lama sedang aktif (Neo baru membacakannya) DAN ucapan menunjuk file tertentu.
// Tanpa nama agen -> Atlas. Halaman boleh kosong (meja = null): Neo menanyakannya.
export function bacaPerintahUploadLama(teks: string, daftar: FileLama[]): { agen: AgenKantor; meja: number | null; pilih: ReturnType<typeof pilihFileDariUcapan> } | null {
  const t = bersihkan(teks);
  if (!t || !daftar.length || POLA_BATAL_PROSES.test(t) || POLA_TANYA_MAKNA.test(t)) return null;
  if (!POLA_PROSES_KUAT.test(t) && !(POLA_PROSES_LEMAH.test(t) && POLA_KATA_FILE.test(t))) return null;
  const pilih = pilihFileDariUcapan(teks, daftar);
  if (!pilih.file && !pilih.ambigu.length && !pilih.diluar) return null;
  const meja = halamanTujuan(teks);
  return { agen: cariAgen(t) ?? 'Atlas', meja: meja >= 0 ? meja : null, pilih };
}