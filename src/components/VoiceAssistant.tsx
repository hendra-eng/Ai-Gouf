'use client';
// VoiceAssistant — asisten suara global "Neo" (gratis, tanpa tombol).
// Aplikasi dibuka -> Neo langsung memperkenalkan diri (sekali) + sapaan hangat -> ucapkan pertanyaan -> dijawab dengan suara.
// TIDAK ada kata panggil: pengguna tidak perlu mengucapkan "halo neo" (menyebutnya tetap tidak masalah).
// Saat AI sedang bicara/berpikir, kamu bisa MENYELA kapan saja: AI langsung diam dan mendengarkan.
// [DIUBAH] Saat Neo bicara, yang menyela hanyalah ajakan berhenti ("stop", "cukup neo", "kepanjangan", ...): src/lib/hentikanSuara.ts.
// Pakai: Web Speech API SpeechRecognition untuk MENDENGAR (Chrome/Edge). Suara utama dari server (/api/tts: Gemini TTS -> Edge TTS);
// speechSynthesis browser hanya cadangan.
// Otak AI: api.chatStream (POST /api/chat/stream, mode_suara = jalur cepat) -> Claude (utama), Groq lalu DeepSeek (cadangan).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { bacaNavigasi, bacaNavigasiMirip, bacaKlarifikasiTab, pilihKandidatTab, type KandidatTab } from '@/lib/navigasiSuara';
import { ejaKode, susunPilihanClient, PESAN_TIDAK_DIKENAL } from '@/lib/salahDengarSuara';
import { bacaTafsirUcapan } from '@/lib/tafsirUcapan'; // [BARU] koreksi salah dengar untuk pertanyaan/penjelasan soal halaman, tab, client
import { bacaGantiClient, hasilDariKode, perluTanyaLLM, type HasilGantiClient } from '@/lib/gantiClientSuara';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { ambilSnapshotLayar, mulaiLacakKursor, perluLayar } from '@/lib/snapshotLayar';
import { ambilFotoKamera, mintaIzinKamera, perluKamera } from '@/lib/kameraLihat'; // [BARU] mata Neo: 1 foto kamera saat diminta
import { daftarkanWajah, hapusProfil, kenaliWajah, panaskanModel, statusProfil } from '@/lib/wajahLokal'; // [BARU] kenali wajah untuk sapaan (profil di database)
import NeoRobot, { type NeoMode, type NeoGerak } from './NeoRobot';
import AnginRobot from './AnginRobot';
// [BARU] Aturan keamanan & kenyamanan: konfirmasi, batalkan, ulangi, kecepatan, bahasa, blokir aksi berisiko.
import {
  type Bahasa,
  KONFIRMASI_TIMEOUT_MS,
  PESAN_TERLARANG,
  UNDO_KEDALUWARSA_MS,
  aksiTerlarang,
  ambiguGantiAtauPindah,
  bacaBatalkan,
  bacaGantiBahasa,
  bacaKonfirmasi,
  bacaLaju,
  bacaUlangi,
  deteksiBahasa,
  ubahLaju,
} from '@/lib/keamananSuara';
// [BARU] Pemutar audio Gemini streaming (PCM bertahap + buffer awal adaptif supaya tidak terbata-bata)
import { AliranPcm, PemutarPcm, dukungPcmStream } from '@/lib/pemutarPcm';
// [BARU] Pengenal ajakan "berhenti menjelaskan" yang luas (stop, "oke udah itu aja cukup", "kepanjangan", "aku sudah paham", dst.)
import { bacaBerhenti } from '@/lib/hentikanSuara';
// [BARU] Lapisan "paham maksud": kalau regex tidak mengenali, AI menilai apakah ucapan itu minta Neo berhenti; hasilnya dipelajari.
import { putuskan, sudahDipelajari, tanyaMaksudBerhenti } from '@/lib/hentikanCerdas';
// @ts-ignore — api.js adalah file JS
import * as api from '@/app/agent-ai/lib/api';

// ====== Pengaturan (ubah di sini) ======
// [DIUBAH] Nama yang disebut Neo saat menyapa kini diambil dari user yang sedang login (bukan nama tetap).
// Pakai kata pertama dari nama; kalau nama kosong, pakai username (kecuali berbentuk email). Tidak ada nama -> sapaan tanpa nama.
function namaSapaan(u: { nama?: string | null; username?: string | null } | null | undefined): string {
  const mentah = (u?.nama || '').trim() || (u?.username && !/[@\s]/.test(u.username) ? u.username.trim() : '');
  const depan = (mentah.split(/\s+/)[0] || '').replace(/[^A-Za-z0-9\u00C0-\u024F'.-]/g, '').slice(0, 20);
  return depan ? depan.charAt(0).toUpperCase() + depan.slice(1) : '';
}

// Sapaan hangat + sedikit lelucon sesuai jam (dipilih acak supaya tidak monoton). TANPA nama dan TANPA kalimat "ada yang bisa dibantu":
// nama (kalau wajah dikenali) dan kalimat penutup diucapkan terpisah SETELAH ini (lihat sapa() di bagian sapaan otomatis).
function buatSapaanHangat(): string {
  const jam = new Date().getHours();
  let daftar: string[];
  if (jam >= 4 && jam < 11) {
    daftar = [
      'Selamat pagi! Semangat banget pagi ini, sudah ngopi belum?',
      'Selamat pagi! Pagi-pagi sudah buka dashboard, rajin sekali.',
    ];
  } else if (jam >= 11 && jam < 15) {
    daftar = [
      'Selamat siang! Sudah makan siang belum? Jangan sampai laporan kenyang tapi kamu kelaparan.',
      'Selamat siang! Panas-panas begini, semoga angka-angkanya tetap adem.',
    ];
  } else if (jam >= 15 && jam < 18) {
    daftar = [
      'Selamat sore! Sebentar lagi waktunya pulang nih.',
      'Selamat sore! Masih semangat? Semoga hari ini lancar.',
    ];
  } else if (jam >= 18 && jam < 24) {
    daftar = [
      'Ini sudah malam, apa yang kamu lakukan? Lembur lagi ya?',
      'Selamat malam! Jam segini masih buka dashboard, pembukuan memang tidak kenal waktu ya.',
    ];
  } else {
    daftar = [
      'Ini sudah lewat tengah malam lho. Jurnalnya bisa menunggu besok.',
      'Jam segini belum tidur? Aku temani deh.',
    ];
  }
  return daftar[Math.floor(Math.random() * daftar.length)];
}

// [BARU] PERKENALAN hanya SATU kali, saat aplikasi baru dibuka (bersama sapaan hangat + candaan di atas).
// Sesudah itu Neo tidak memperkenalkan diri lagi di awal jawaban; nama baru disebut kalau pengguna menanyakannya
// (aturan itu juga ada di prompt backend: akuntansi_ai.py). Penanda disimpan per tab, jadi refresh tidak mengulang perkenalan.
const KUNCI_SUDAH_KENALAN = 'neo-sudah-kenalan';
const PERKENALAN = [
  'Hai, aku Neo, asisten suara dari Gouf Consulting. Aku bisa bantu urusan pembukuan, laporan keuangan, dan data klienmu.',
  'Halo, kenalkan, aku Neo dari Gouf Consulting. Tugasku membantu pembukuan, laporan keuangan, dan data klien di dashboard ini.',
  'Hai, aku Neo, asisten suara Gouf Consulting. Aku siap bantu cek data klien, jurnal, dan laporan keuanganmu.',
];
const KUNCI_WAJAH_AKTIF = 'neo-wajah-aktif'; // [BARU] petunjuk cepat di browser ini: profil wajah ada di database (isinya hanya '1', bukan data wajah)
// Perintah mendaftarkan wajah: "aku mau kamu mengenali wajahku" (juga "kenali wajahku", "tolong kenali wajahku").
// Pertanyaan seperti "kamu bisa mengenali wajahku?" sengaja TIDAK memicu pendaftaran. Teks sudah dinormalisasi (huruf kecil, tanpa tanda baca).
const POLA_DAFTAR_WAJAH = /\b(?:mau|ingin|pengen|pingin|minta)\s+(?:kamu|kau|neo)\s+(?:mengenali|mengenal|kenali|kenalin)\s+(?:wajah|muka)(?:ku|\s+(?:saya|aku))\b|^(?:(?:tolong|coba|ayo|yuk|neo)\s+)*(?:mengenali|mengenal|kenali|kenalin)\s+(?:wajah|muka)(?:ku|\s+(?:saya|aku))\b/;
const POLA_HAPUS_WAJAH = /\b(?:hapus|hapuskan|lupakan|buang)(?:kan)? (?:data )?(?:wajah|muka)(?:ku| saya| aku)?\b/;
// Sapaan awal = DUA bagian terpisah: perkenalan (hanya sekali per tab; kosong kalau sudah kenalan) + sapaan hangat/lelucon.
// Penutup ("Ada yang bisa aku bantu, <nama>?") dibuat di sapa(), karena bergantung pada hasil pengenalan wajah.
function buatSapaanAwal(): { perkenalan: string; hangat: string } {
  let sudah = false;
  try { sudah = sessionStorage.getItem(KUNCI_SUDAH_KENALAN) === '1'; } catch { /* abaikan */ }
  const hangat = buatSapaanHangat();
  if (sudah) return { perkenalan: '', hangat }; // sudah pernah kenalan di tab ini -> sapaan saja
  try { sessionStorage.setItem(KUNCI_SUDAH_KENALAN, '1'); } catch { /* abaikan */ }
  return { perkenalan: PERKENALAN[Math.floor(Math.random() * PERKENALAN.length)], hangat };
}

// [BARU] Catatan audit aksi suara (navigasi, ganti client, konfirmasi, batalkan, blokir). Hanya di sessionStorage
// browser ini (hilang saat tab ditutup), hanya jenis aksi + tujuan, TIDAK menyimpan isi ucapan lengkap.
function catatAudit(jenis: string, detail = '') {
  try {
    const kunci = 'neo_audit';
    const daftar = JSON.parse(sessionStorage.getItem(kunci) || '[]');
    daftar.push({ t: new Date().toISOString(), jenis, detail: String(detail).slice(0, 100) });
    sessionStorage.setItem(kunci, JSON.stringify(daftar.slice(-50)));
  } catch { /* abaikan */ }
}

const WAKTU_MENUNGGU_PERINTAH_MS = 12000; // setelah disapa, AI menunggu perintah sebanyak ini
const WAKTU_PERCAKAPAN_MS = 30000; // setelah AI selesai menjawab, mic tetap 'terbuka' selama ini (mode ngobrol terus)
// [DIUBAH] Dulu: diam 1 detik -> langsung dikirim, sehingga penjelasan panjang terpotong saat kamu berpikir.
// Sekarang ucapan DIKUMPULKAN dulu; baru dikirim setelah kamu diam cukup lama. Makin panjang kamu bicara,
// makin sabar Neo menunggu. Kalimat menggantung (berakhir "dan", "karena", "eh"...) menunggu lebih lama lagi.
// Mau cepat? kecilkan angka. Mau lebih sabar? besarkan. Atau akhiri dengan "itu saja" / "silakan jawab" -> langsung dikirim.
const JEDA_PENDEK_MS = 1200; // ucapan pendek (<= 4 kata), mis. "ya", "buka laba rugi"
const JEDA_NORMAL_MS = 2000;
const JEDA_PANJANG_MS = 3200; // ucapan panjang (>= 15 kata): kamu sedang menjelaskan
const JEDA_TAMBAHAN_MS = 1800; // tambahan kalau kalimat terasa menggantung
const JEDA_MAKS_MS = 6000;
const JEDA_COBA_LAGI_TTS_MS = 45000; // suara server (/api/tts) gagal -> pakai suara browser hanya sementara, setelah ini dicoba lagi
const GEMA_JENDELA_MS = 3500; // setelah AI selesai bicara, suara yang mirip ucapannya sendiri (gema speaker) diabaikan selama ini
const MAKS_RIWAYAT = 40; // [DIUBAH dari 6] jumlah pesan terakhir (6 giliran) yang dikirim sebagai konteks; yang lebih lama dicari backend lewat recall memori
const INSTRUKSI_SINGKAT =
  '[MODE SUARA: jawab dalam bahasa Indonesia santai, maksimal 3 kalimat pendek, ' +
  'tanpa tabel, tanpa markdown, tanpa simbol, tanpa daftar. Angka ditulis agar enak dibaca.]';
// [BARU] Pertanyaan panjang/rumit -> jawaban lengkap (bukan dipotong 3 kalimat).
const INSTRUKSI_LENGKAP =
  '[MODE SUARA: pengguna menjelaskan atau menanyakan hal yang panjang. Jawab dalam bahasa Indonesia santai, ' +
  'jelas, tepat, dan LENGKAP: bahas SETIAP bagian yang dia sebutkan, jangan ada yang terlewat. ' +
  'Boleh sampai sekitar 10 kalimat. Urutkan dengan kata seperti \"pertama\", \"kedua\", \"terakhir\". ' +
  'Kalau ada bagian yang kurang jelas atau datanya belum ada, bilang jujur lalu tanyakan satu pertanyaan penjelasan di akhir. ' +
  'Tanpa tabel, tanpa markdown, tanpa simbol, tanpa daftar. Angka ditulis agar enak dibaca.]';
const POLA_BUTUH_LENGKAP = /\b(?:jelaskan|menjelaskan|bagaimana|kenapa|mengapa|analisis|analisa|bandingkan|perbandingan|langkah|rincian|rinci|detail|lengkap|simulasi|rekomendasi)\b/;
// [BARU] Batas kemampuan: suara hanya MEMBACA data. Supaya AI tidak pernah mengaku sudah menghapus/memposting sesuatu.
const LARANGAN_UBAH =
  ' [BATAS: kamu HANYA bisa membaca data dan membantu berpindah halaman. Kamu TIDAK bisa mengubah, menghapus, memposting, ' +
  'menyetujui, atau membayar apa pun lewat suara; jangan pernah mengaku sudah melakukannya. Kalau diminta, arahkan pengguna melakukannya di layar.]';
// [BARU] Versi bahasa Inggris (dipakai saat kamu berbicara bahasa Inggris)
const INSTRUKSI_SINGKAT_EN =
  '[VOICE MODE: answer in casual English, at most 3 short sentences, no tables, no markdown, no symbols, no lists. Write numbers so they are easy to read aloud.]' +
  ' [LIMIT: you can ONLY read data and help navigate pages. You can NOT change, delete, post, approve, or pay anything by voice; never claim you did. If asked, tell the user to do it on screen.]';
const INSTRUKSI_LENGKAP_EN =
  '[VOICE MODE: the user is explaining or asking something long. Answer in casual English, clear, accurate and COMPLETE: cover EVERY part they mention. ' +
  'Up to about 10 sentences. Order with words like first, second, finally. If something is unclear or data is missing, say so honestly and ask one clarifying question at the end. ' +
  'No tables, no markdown, no symbols, no lists. Write numbers so they are easy to read aloud.]' +
  ' [LIMIT: you can ONLY read data and help navigate pages. You can NOT change, delete, post, approve, or pay anything by voice; never claim you did.]';
const POLA_BUTUH_LENGKAP_EN = /\b(?:explain|analyze|analyse|compare|comparison|steps|detail|details|detailed|why|how)\b/;
const pilihInstruksi = (perintah: string, bahasa: Bahasa = 'id') => {
  const panjang = perintah.split(' ').filter(Boolean).length >= 25;
  if (bahasa === 'en') return panjang || POLA_BUTUH_LENGKAP_EN.test(perintah.toLowerCase()) ? INSTRUKSI_LENGKAP_EN : INSTRUKSI_SINGKAT_EN;
  return (panjang || POLA_BUTUH_LENGKAP.test(perintah.toLowerCase()) ? INSTRUKSI_LENGKAP : INSTRUKSI_SINGKAT) + LARANGAN_UBAH;
};

// STT bisa menulis "halo neo" sebagai "halo nio" / "halo ne o". Regex ini menerima beberapa variasi ejaan.
const POLA_NAMA = /\b(?:neo|nio|neu|ne o|ni o|neon)\b/;
// Versi tanpa spasi: STT kadang menulis "haloneo" tanpa spasi
const POLA_NAMA_RAPAT = /(?:halo|hallo|hello|hai|hei|hey)(?:neo|nio|neu)/;
const POLA_SAPAAN = /\b(?:halo|hai|hei|hallo|hello|hey|oke|ok)\b/;
// [DIUBAH] POLA_STOP (20 kata tunggal) diganti src/lib/hentikanSuara.ts -> bacaBerhenti(): ratusan bentuk ajakan berhenti.
// [BARU] Kalimat berakhir di kata ini = kemungkinan besar belum selesai -> tunggu lebih lama
const POLA_MENGGANTUNG = /\b(?:dan|atau|tapi|tetapi|karena|soalnya|yang|jadi|terus|lalu|kemudian|dengan|untuk|ke|di|dari|pada|dalam|kalau|jika|bahwa|seperti|misalnya|sama|eh|em|emm|hmm|anu|apa ya|gimana ya)$/;
// [BARU] Kata penutup yang langsung mengirim ucapan (tanpa menunggu jeda diam)
const POLA_KIRIM = /\b(?:itu saja|sudah itu|itu dulu|itu pertanyaannya|silakan jawab|tolong jawab|jawab sekarang|jawab ya)$/;
// ucapan penutup -> Neo berpamitan singkat (mic tetap siap, tanpa kata panggil)
const POLA_SELESAI = /\b(?:terima kasih|makasih|sudah cukup|udah cukup|selesai|sampai jumpa|dadah)\b/;

// [BARU] HP/tablet: Chrome Android hanya mengizinkan SATU pemakai mikrofon/audio-focus. Stream mic
// yang dibuka terus (getUserMedia) + audio sunyi yang diputar loop membuat SpeechRecognition
// tidak menerima suara sama sekali (status tetap "Neo mendengarkan" tapi tidak ada yang terdengar).
// Di perangkat mobile kedua trik "anti-dibekukan" itu dimatikan; wake lock layar tetap dipakai.
const ADALAH_MOBILE =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// [BARU] Saat Neo sedang bicara, HANYA ajakan berhenti (bacaBerhenti) yang boleh menyela. Ucapan lain dianggap gema/derau dan diabaikan.
// Tambah kalimat baru di src/lib/hentikanSuara.contoh.ts lalu jalankan hentikanSuara.uji.ts.
// Warna garis balon (abu-abu sedang, tipis tapi tetap terlihat di latar putih). Mau lebih tegas? naikkan angka 60%.
const GARIS_BALON = 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)';
// [BARU] Apakah satu kata yang terdengar cocok dengan kata dari ucapan Neo? Toleran salah dengar:
// kata sama persis, ATAU 4 huruf awalnya sama dan panjangnya mirip ("laporan" ~ "laporannya").
function kataCocokGema(k: string, acuan: string[], set: Set<string>): boolean {
  if (set.has(k)) return true;
  if (k.length < 4) return false;
  return acuan.some((w) => w.length >= 4 && Math.abs(w.length - k.length) <= 3 && w.slice(0, 4) === k.slice(0, 4));
}

type Status = 'tidak-didukung' | 'mati' | 'mendengar' | 'menunggu' | 'berpikir' | 'bicara' | 'izin-ditolak';

const normalisasi = (t: string) =>
  t.toLowerCase().replace(/[.,!?;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();

// [BARU] Perintah suara untuk menyalakan/mematikan sistem (pengganti tombol Nyalakan/Matikan).
// Hanya ucapan pendek (<= 6 kata) yang dianggap perintah, supaya kalimat biasa yang kebetulan memuat kata
// "matikan sistem" (mis. pertanyaan akuntansi) tidak mematikan Neo.
const POLA_SISTEM_NYALA = /\b(?:(?:nyalakan|nyalain|hidupkan|hidupin|aktifkan|aktifin)\s+(?:neo\s+)?(?:sistem|system)|(?:turn|switch|power)\s+on\s+(?:the\s+)?system)\b/;
const POLA_SISTEM_MATI = /\b(?:(?:matikan|matiin|nonaktifkan|nonaktifin)\s+(?:neo\s+)?(?:sistem|system)|(?:turn|switch|power)\s+off\s+(?:the\s+)?system)\b/;
function bacaPerintahSistem(teks: string): { aksi: 'nyala' | 'mati'; bahasa: Bahasa } | null {
  if (teks.split(' ').filter(Boolean).length > 6) return null;
  const inggris = /\b(?:turn|switch|power)\b/.test(teks);
  if (POLA_SISTEM_MATI.test(teks)) return { aksi: 'mati', bahasa: inggris ? 'en' : 'id' };
  if (POLA_SISTEM_NYALA.test(teks)) return { aksi: 'nyala', bahasa: inggris ? 'en' : 'id' };
  return null;
}

const gabungUcapan = (a: string, b: string) => `${a} ${b}`.replace(/\s+/g, ' ').trim();
const hitungJeda = (teks: string) => {
  const n = teks.split(' ').filter(Boolean).length;
  let jeda = n <= 4 ? JEDA_PENDEK_MS : n >= 15 ? JEDA_PANJANG_MS : JEDA_NORMAL_MS;
  if (POLA_MENGGANTUNG.test(teks)) jeda += JEDA_TAMBAHAN_MS;
  return Math.min(jeda, JEDA_MAKS_MS);
};


// Bersihkan teks agar enak dibacakan
const bersihkanUntukSuara = (t: string) =>
  t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

// [BARU] Teks panjang TIDAK dipotong diam-diam lagi. Dipecah jadi potongan <= MAKS_POTONGAN_SUARA karakter; tiap potongan
// diminta ke /api/tts sendiri-sendiri (paralel) dan diputar berurutan. Batasnya jauh di bawah batas server
// (MAKS_KARAKTER di tts_route.py) supaya Gemini sempat selesai dalam batas waktunya, dan supaya suara browser
// (yang sering berhenti di tengah ujaran panjang) tetap aman.
const MAKS_POTONGAN_SUARA = 300;

// Titik potong terbaik di awal `teks` (jumlah karakter yang dipakai): akhir kalimat > koma/titik koma/titik dua > spasi > potong paksa.
function titikPotong(teks: string, maks: number): number {
  if (teks.length <= maks) return teks.length;
  const jendela = teks.slice(0, maks + 1); // +1 supaya spasi tepat di posisi `maks` ikut terlihat
  const minimal = Math.floor(maks * 0.4); // hindari potongan yang terlalu pendek
  for (const re of [/[.!?\u2026]["')\]]*\s/g, /[,;:]\s/g, /\s/g]) {
    let akhir = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(jendela)) !== null) akhir = m.index + m[0].length;
    if (akhir >= minimal) return akhir;
  }
  return maks; // tak ada spasi/tanda baca sama sekali: potong paksa
}

function pecahTeksPanjang(teks: string, maks: number = MAKS_POTONGAN_SUARA): string[] {
  // [DIUBAH] Pecah PER KALIMAT supaya potongan pertama pendek -> suara cepat mulai.
  // Kalimat pertama dipakai apa adanya; kalimat berikutnya yang terlalu pendek (< 50 karakter) digabung ke tetangganya.
  const kalimat = teks.trim().split(/(?<=[.!?\u2026][\"')\]]*)\s+/).map((k) => k.trim()).filter(Boolean);
  const gabung: string[] = [];
  for (const k of kalimat) {
    const akhir = gabung.length;
    if (akhir > 1 && gabung[akhir - 1].length < 50 && gabung[akhir - 1].length + 1 + k.length <= maks) {
      gabung[akhir - 1] += ' ' + k;
    } else {
      gabung.push(k);
    }
  }
  const hasil: string[] = [];
  for (const g of gabung) {
    let sisa = g;
    while (sisa.length > 0) {
      const n = titikPotong(sisa, maks);
      const potongan = sisa.slice(0, n).trim();
      if (potongan) hasil.push(potongan);
      sisa = sisa.slice(n).trim();
    }
  }
  return hasil;
}

// [BARU] Batas permintaan TTS yang berjalan bersamaan (sampai audio pertama datang). Dulu semua potongan diminta sekaligus
// -> lonjakan request -> 429 -> kunci diistirahatkan -> delay. Sekarang maksimal MAKS_TTS_PARALEL; sisanya antre.
const MAKS_TTS_PARALEL = 2;
let ttsAktif = 0;
const ttsAntre: Array<() => void> = [];
function ambilSlotTts(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const mulai = () => { ttsAktif += 1; resolve(true); };
    if (ttsAktif < MAKS_TTS_PARALEL) return mulai();
    const masuk = () => { signal.removeEventListener('abort', batal); mulai(); };
    const batal = () => { const i = ttsAntre.indexOf(masuk); if (i >= 0) ttsAntre.splice(i, 1); resolve(false); };
    signal.addEventListener('abort', batal, { once: true });
    ttsAntre.push(masuk);
  });
}
function lepasSlotTts() {
  ttsAktif = Math.max(0, ttsAktif - 1);
  const berikut = ttsAntre.shift();
  if (berikut) berikut();
}

export default function VoiceAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  // [DIUBAH] Nama sapaan dari user login. Disimpan di ref karena efek sapaan hanya berjalan sekali; sapaan menunggu sampai sesi selesai dimuat.
  const { user: userLogin, loading: authMemuat } = useAuth();
  const namaSapaRef = useRef('');
  const authMemuatRef = useRef(true);
  useEffect(() => { namaSapaRef.current = namaSapaan(userLogin); authMemuatRef.current = authMemuat; }, [userLogin, authMemuat]);
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  // [BARU] Client aktif global (sama dengan dropdown "Switch Company" di Topbar). VoiceAssistant dirender di
  // dalam ActiveClientProvider (lihat AppLayout), jadi hook ini aman. Disimpan di ref supaya callback suara
  // yang berumur panjang selalu membaca daftar client & client aktif TERBARU (bukan versi basi).
  const { clients: daftarClient, activeClientId, setActiveClient, loading: clientLoading } = useActiveClient();
  const clientsRef = useRef(daftarClient);
  const activeClientIdRef = useRef(activeClientId);
  const setActiveClientRef = useRef(setActiveClient);
  const clientLoadingRef = useRef(clientLoading);
  useEffect(() => {
    clientsRef.current = daftarClient;
    activeClientIdRef.current = activeClientId;
    setActiveClientRef.current = setActiveClient;
    clientLoadingRef.current = clientLoading;
  }, [daftarClient, activeClientId, setActiveClient, clientLoading]);
  const [status, setStatus] = useState<Status>('mati');
  const [sistemMati, setSistemMati] = useState(false); // [BARU] true = sistem dimatikan lewat suara (mic tetap mendengar HANYA untuk "nyalakan sistem")
  // [BARU] Robot bisa diseret ke mana saja (mouse/sentuh). null = posisi bawaan (kiri bawah). Posisi diingat di localStorage.
  const [posRobot, setPosRobot] = useState<{ x: number; y: number } | null>(null);
  const [menyeret, setMenyeret] = useState(false);
  const robotRef = useRef<HTMLDivElement>(null);
  const seretRef = useRef<{ dx: number; dy: number } | null>(null);
  const gerakRef = useRef<NeoGerak>({ vx: 0, vy: 0, t: 0 }); // kecepatan tarikan untuk animasi Neo + efek angin
  const lastPosRef = useRef({ x: 0, y: 0 });
  const jepitPosisi = (x: number, y: number) => {
    const el = robotRef.current;
    const w = el?.offsetWidth ?? 112;
    const h = el?.offsetHeight ?? 96;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(64, y), Math.max(64, window.innerHeight - h)), // sisakan ruang di atas untuk balon
    };
  };
  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem('neo_posisi') || 'null');
      if (t && typeof t.x === 'number' && typeof t.y === 'number') setPosRobot(jepitPosisi(t.x, t.y));
    } catch { /* abaikan */ }
    const saatResize = () => setPosRobot((p) => (p ? jepitPosisi(p.x, p.y) : p));
    window.addEventListener('resize', saatResize);
    return () => window.removeEventListener('resize', saatResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mulaiSeret = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    const r = robotRef.current?.getBoundingClientRect();
    if (!r) return;
    seretRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    lastPosRef.current = { x: r.left, y: r.top };
    gerakRef.current = { vx: 0, vy: 0, t: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setMenyeret(true);
    e.preventDefault();
  };
  const geserSeret = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = seretRef.current;
    if (!d) return;
    const n = jepitPosisi(e.clientX - d.dx, e.clientY - d.dy);
    const g = gerakRef.current;
    g.vx = g.vx * 0.6 + (n.x - lastPosRef.current.x) * 0.4;
    g.vy = g.vy * 0.6 + (n.y - lastPosRef.current.y) * 0.4;
    g.t = performance.now();
    lastPosRef.current = n;
    setPosRobot(n);
  };
  const selesaiSeret = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seretRef.current) return;
    seretRef.current = null;
    setMenyeret(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* abaikan */ }
    setPosRobot((p) => {
      if (p) { try { localStorage.setItem('neo_posisi', JSON.stringify(p)); } catch { /* abaikan */ } }
      return p;
    });
  };
  const resetPosisi = () => {
    setPosRobot(null);
    try { localStorage.removeItem('neo_posisi'); } catch { /* abaikan */ }
  };
  const [teksTerakhir, setTeksTerakhir] = useState('');
  const [galat, setGalat] = useState('');
  const [kameraAktif, setKameraAktif] = useState(false); // [BARU] indikator saat kamera sedang mengambil gambar
  // [BARU] Pengenalan wajah awal: hasil (nama) dipakai sapaan; analisis wajah dikerjakan di latar belakang, disimpan di memori tab ini saja.
  const profilWajahRef = useRef<Promise<{ ada: boolean; nama: string | null } | null> | null>(null); // status profil wajah di database (ditanya di latar belakang saat dibuka)
  const pengenalanWajahRef = useRef<() => Promise<{ nama: string } | null>>(async () => null); // dijalankan saat Neo MULAI menyapa (lihat sapa())
  const analisaWajahRef = useRef<{ teks: string; waktu: number } | null>(null);
  const daftarWajahRef = useRef<() => Promise<void>>(async () => {});
  const hapusWajahRef = useRef<() => Promise<void>>(async () => {});
  // [BARU] Diagnostik di layar: buka dashboard dengan ?vdebug=1 untuk melihat kejadian mikrofon terakhir.
  const [dbg, setDbg] = useState('');
  const dbgAktif = typeof window !== 'undefined' && /[?&]vdebug\b/.test(window.location.search);
  const dbgLogRef = useRef<string[]>([]);
  const catatDbg = (t: string) => {
    if (!dbgAktif) return;
    const d = new Date();
    const jam = `${d.getMinutes()}:${String(d.getSeconds()).padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`;
    dbgLogRef.current = [...dbgLogRef.current, `${jam} ${t}`].slice(-5);
    setDbg(dbgLogRef.current.join(' | '));
  };
  // [BARU] true = abort() berikutnya disengaja (mute/komit); selain itu dihitung error supaya ada jeda (backoff).
  const abortSengajaRef = useRef(false);

  const recRef = useRef<any>(null);
  const statusRef = useRef<Status>('mati');
  const muteRef = useRef(false); // tidak dipakai lagi (tombol Matikan dihapus); selalu false
  const sistemMatiRef = useRef(false);
  const akanMatiRef = useRef(false); // sedang mengucapkan "sistem telah dimatikan", baru mati setelah selesai
  const timerMatiRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selesaikanMatiRef = useRef<() => void>(() => {});
  const matikanSistemRef = useRef<() => void>(() => {});
  const nyalakanSistemRef = useRef<() => void>(() => {});
  const aktifRef = useRef(true); // SELALU true: tidak perlu kata panggil, Neo menjawab semua ucapan
  const timerAktifRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bicaraRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const riwayatRef = useRef<{ role: string; content: string }[]>([]);
  const pathRef = useRef(pathname);
  const suaraRef = useRef<SpeechSynthesisVoice | null>(null);
  const antrianSuaraRef = useRef(0); // jumlah kalimat yang masih diputar/antri
  const sedangMemprosesRef = useRef(false);
  const errorBeruntunRef = useRef(0);
  // [BARU] Suara neural dari server (backend /api/tts: Gemini TTS lalu Edge TTS). Kalau server menolak (503/401/403) -> sementara pakai suara browser.
  // Catatan: nama azureMatiRef sisa dari versi Azure; artinya sekarang "suara server sedang dimatikan sementara".
  const azureMatiRef = useRef(false);
  const streamMatiRef = useRef(false); // [BARU] true = backend belum punya /api/tts/stream (404/405) -> pakai /api/tts biasa (non-streaming)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hentikanAudioRef = useRef<(() => void) | null>(null);
  const rantaiSuaraRef = useRef<Promise<void>>(Promise.resolve());
  const ttsCtrlRef = useRef<Set<AbortController>>(new Set());
  const audioSedangRef = useRef(false);
  const bolehMulaiRef = useRef(0); // [BARU] waktu paling cepat start() boleh dipanggil lagi (backoff berlaku utk SEMUA pemanggil, termasuk watchdog)
  const mulaiSejakRef = useRef(0); // [BARU] kapan sesi mic terakhir mulai (utk mengukur berapa lama sebelum 'aborted')
  const recAktifRef = useRef(false); // true = SpeechRecognition benar-benar sedang berjalan
  const utteranceRef = useRef<SpeechSynthesisUtterance[]>([]); // WAJIB disimpan: Chrome bisa membuang utterance (onend tak pernah terpanggil)
  const bicaraSejakRef = useRef(0);
  const reqIdRef = useRef(0); // nomor permintaan AI; permintaan lama yang sudah disela diabaikan
  const genSuaraRef = useRef(0); // generasi suara; event suara lama (sudah dibatalkan) diabaikan
  const batalSejakRef = useRef(0);
  const teksDiucapkanRef = useRef(''); // apa yang baru saja diucapkan AI (untuk mengenali gema)
  const selesaiBicaraSejakRef = useRef(0);
  const komitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const komitWaktuRef = useRef(0);
  const bufUcapanRef = useRef(''); // [BARU] potongan ucapan FINAL yang dikumpulkan sampai kamu benar-benar selesai
  const sementaraUcapanRef = useRef(''); // [BARU] potongan yang masih diketik Chrome (interim)
  const hasilRef = useRef<(e: any) => void>(() => {});
  const sesiIdRef = useRef(''); // id sesi suara (dikirim ke backend untuk memori AI)
  // ===== [BARU] Keamanan & kenyamanan =====
  const suaraEnRef = useRef<SpeechSynthesisVoice | null>(null); // suara browser bahasa Inggris (cadangan)
  const bahasaRef = useRef<Bahasa>('id'); // bahasa jawaban & suara saat ini
  const bahasaPilihanRef = useRef<'auto' | Bahasa>('auto'); // 'auto' = ikut bahasa ucapan; id/en = dipilih manual
  const [bahasaTampil, setBahasaTampil] = useState<Bahasa>('id');
  const lajuRef = useRef(1); // faktor kecepatan bicara (1 = normal)
  const jawabanTerakhirRef = useRef(''); // untuk perintah "ulangi"
  const konfirmasiRef = useRef<{ tanya: string; ya: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const undoRef = useRef<{ nama: string; jalankan: () => void; kedaluwarsa: number } | null>(null);
  const aktivitasTerakhirRef = useRef(Date.now()); // untuk mematikan mic otomatis kalau lama tidak dipakai
  const pttRef = useRef(false);
  const pttAktifRef = useRef(false);
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bukaPttRef = useRef<() => void>(() => {}); // membuka jendela mic tekan-untuk-bicara (diisi tiap render)
  // teks 2 bahasa: tx('indonesia', 'english') mengikuti bahasa jawaban saat ini
  const tx = useCallback((id: string, en: string) => (bahasaRef.current === 'en' ? en : id), []);

  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  // [BARU] lacak posisi kursor mouse supaya "angka ini" bisa dipetakan ke elemen yang ditunjuk
  useEffect(() => mulaiLacakKursor(), []);

  const ubahStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ---------- Suara (TTS bawaan browser) ----------
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const pilihSuara = () => {
      const semua = window.speechSynthesis.getVoices();
      suaraRef.current =
        semua.find((v) => v.lang === 'id-ID' && /google|online|natural/i.test(v.name)) ||
        semua.find((v) => v.lang === 'id-ID') ||
        semua.find((v) => v.lang.startsWith('id')) ||
        null;
      suaraEnRef.current =
        semua.find((v) => v.lang === 'en-US' && /google|online|natural/i.test(v.name)) ||
        semua.find((v) => v.lang.startsWith('en')) ||
        null;
    };
    pilihSuara();
    window.speechSynthesis.onvoiceschanged = pilihSuara;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Mic SELALU menyala (kecuali dimatikan) — termasuk saat AI bicara, supaya bisa disela.
  const mulaiDengar = useCallback(() => {
    const rec = recRef.current;
    if (!rec || muteRef.current || recAktifRef.current || rec.__berhenti) return;
    if (pttRef.current && !pttAktifRef.current) return; // [BARU] mode tekan-untuk-bicara: mic hanya menyala setelah tombol Bicara ditekan
    // [BARU] Chrome hanya mengizinkan satu pengenalan suara aktif per browser. Kalau situs ini terbuka di
    // beberapa tab/jendela, tab latar ikut menyalakan mic dan saling membatalkan (aborted tiap 0,3 dtk).
    // Jadi hanya tab yang sedang terlihat yang boleh mendengar.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (Date.now() < bolehMulaiRef.current) return; // [BARU] sedang masa tunggu setelah error beruntun
    try { rec.start(); } catch { /* sudah berjalan */ }
  }, []);

  const hentikanDengar = useCallback(() => {
    abortSengajaRef.current = true;
    try { recRef.current?.abort(); } catch { /* abaikan */ }
  }, []);

  const setelahBicaraSelesai = useCallback(() => {
    bicaraRef.current = false;
    if (sedangMemprosesRef.current) { ubahStatus('berpikir'); return; }
    ubahStatus(aktifRef.current ? 'menunggu' : 'mendengar');
    setTimeout(mulaiDengar, 350);
  }, [mulaiDengar, ubahStatus]);

  const bukaJendelaPerintah = useCallback((ms: number = WAKTU_MENUNGGU_PERINTAH_MS) => {
    aktifRef.current = true;
    if (timerAktifRef.current) clearTimeout(timerAktifRef.current);
    timerAktifRef.current = setTimeout(() => {
      // tetap aktif (tanpa kata panggil); hanya status tampilan yang kembali ke siaga
      if (statusRef.current === 'menunggu') ubahStatus('mendengar');
    }, ms);
  }, [ubahStatus]);

  // Batalkan semua suara yang sedang/antri diputar (tanpa memicu "selesai bicara")
  const batalkanSuara = useCallback(() => {
    genSuaraRef.current += 1;
    antrianSuaraRef.current = 0;
    utteranceRef.current = [];
    batalSejakRef.current = Date.now();
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* abaikan */ }
    // [BARU] hentikan audio server (/api/tts) yang sedang diputar + batalkan permintaan TTS yang belum selesai
    try { hentikanAudioRef.current?.(); } catch { /* abaikan */ }
    ttsCtrlRef.current.forEach((c) => { try { c.abort(); } catch { /* abaikan */ } });
    ttsCtrlRef.current.clear();
    rantaiSuaraRef.current = Promise.resolve();
  }, []);

  const akhiriBicara = useCallback(() => {
    antrianSuaraRef.current = 0;
    utteranceRef.current = [];
    selesaiBicaraSejakRef.current = Date.now();
    // [BARU] Habis menanyakan konfirmasi di mode tekan-untuk-bicara: buka mic otomatis supaya cukup bilang "ya"/"tidak"
    if (konfirmasiRef.current && pttRef.current && !muteRef.current) bukaPttRef.current();
    if (aktifRef.current) bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS); // mode ngobrol: tunggu pertanyaan lanjutan
    setelahBicaraSelesai();
    if (akanMatiRef.current) selesaikanMatiRef.current(); // [BARU] "sistem telah dimatikan" sudah terucap -> sekarang benar-benar mati
  }, [bukaJendelaPerintah, setelahBicaraSelesai]);

  // [BARU] Putar satu potongan audio (MP3 dari Edge / WAV dari Gemini); selesai saat audio habis / dibatalkan / gagal.
  const mainkanBlob = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = lajuRef.current; // [BARU] kecepatan bicara ('lebih pelan' / 'lebih cepat')
    audioRef.current = audio;
    audioSedangRef.current = true;
    return new Promise<void>((resolve) => {
      let sudah = false;
      const beres = () => {
        if (sudah) return;
        sudah = true;
        audioSedangRef.current = false;
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        hentikanAudioRef.current = null;
        resolve();
      };
      hentikanAudioRef.current = () => { try { audio.pause(); } catch { /* abaikan */ } beres(); };
      audio.onended = beres;
      audio.onerror = beres;
      audio.play().then(() => {
        // [BARU] audio benar-benar mulai terdengar -> baru tampil "Sedang menjawab…" (sebelumnya sudah tampil saat masih menunggu Gemini)
        if (!sudah) ubahStatus('bicara');
      }).catch((e: any) => {
        if (e?.name === 'NotAllowedError') setGalat('Suara diblokir browser — klik halaman ini sekali lalu coba lagi.');
        beres();
      });
    });
  }, [ubahStatus]);

  // [BARU] Siapkan audio potongan pertama SEBELUM dibutuhkan (dipakai untuk sapaan awal). Stream dibuka dan dibaca ke memori
  // sejak sekarang; saat ucapkan() dipanggil dengan teks yang sama, audionya sudah ada -> suara langsung bunyi.
  const prefetchSuaraRef = useRef<Map<string, Promise<AliranPcm | null>>>(new Map());
  const siapkanSuara = useCallback((teks: string) => {
    if (azureMatiRef.current || streamMatiRef.current || !dukungPcmStream()) return;
    const pertama = pecahTeksPanjang(bersihkanUntukSuara(teks))[0];
    if (!pertama || prefetchSuaraRef.current.has(pertama)) return;
    const ctrl = new AbortController();
    const batas = setTimeout(() => ctrl.abort(), 15000);
    const p = (async (): Promise<AliranPcm | null> => {
      if (!(await ambilSlotTts(ctrl.signal))) return null;
      try {
        const reader = await (api as any).ttsStream(pertama, ctrl.signal, bahasaRef.current);
        return new AliranPcm(reader);
      } catch {
        return null; // gagal: ucapkan() nanti meminta sendiri seperti biasa
      } finally {
        clearTimeout(batas);
        lepasSlotTts();
      }
    })();
    prefetchSuaraRef.current.set(pertama, p);
  }, []);

  // [DIUBAH] ucapkanSatu = membacakan SATU potongan yang sudah bersih (<= MAKS_POTONGAN_SUARA). Isinya sama seperti ucapkan lama.
  const ucapkanSatu = useCallback(
    (bersih: string) => {
      if (!bersih || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      bicaraRef.current = true;
      bicaraSejakRef.current = Date.now();
      // [DIUBAH] bicaraRef tetap true sejak sekarang (mic tidak menangkap gema), tapi TAMPILAN status baru "bicara"
      // saat audio mulai diputar (lihat mainkanBlob). Selama menunggu audio dari server -> "Memikirkan jawaban…".
      // Kalau audio kalimat sebelumnya sedang terdengar, status dibiarkan "bicara".
      ubahStatus(azureMatiRef.current || statusRef.current === 'bicara' ? 'bicara' : 'berpikir');
      teksDiucapkanRef.current = (teksDiucapkanRef.current + ' ' + bersih).slice(-1500);

      // [BARU] Jalur utama: suara neural server (/api/tts). Tiap kalimat diminta ke server LANGSUNG (paralel),
      // tapi diputar berurutan lewat rantai promise. Gagal -> kalimat itu dibacakan suara browser.
      if (!azureMatiRef.current) {
        const genA = genSuaraRef.current;
        antrianSuaraRef.current += 1;
        const ctrl = new AbortController();
        ttsCtrlRef.current.add(ctrl);
        const batas = setTimeout(() => ctrl.abort(), 60000); // [DIUBAH] batas TOTAL semua percobaan (dulu 15 dtk)
        // [DIUBAH] Suara HANYA dari server (Gemini). Gagal -> coba ulang beberapa kali dengan jeda makin panjang
        // (memberi waktu limit per-menit Gemini pulih / kunci berikutnya dipakai). Tetap gagal -> kalimat itu DILEWATI
        // tanpa suara. TIDAK ADA lagi suara browser, supaya suara AI selalu satu (Sulafat).
        const bahasaTts = bahasaRef.current;
        const JEDA_ULANG_MS = [1000, 3000, 6000, 10000];
        // [DIUBAH] Hasil bisa berupa aliran streaming (Gemini streaming: mulai bunyi sebelum kalimat selesai dibuat)
        // atau blob utuh (cadangan kalau backend belum punya /api/tts/stream).
        type HasilSuara = { aliran?: AliranPcm; blob?: Blob };
        const audioP: Promise<HasilSuara | null> = (async (): Promise<HasilSuara | null> => {
          for (let percobaan = 0; percobaan <= JEDA_ULANG_MS.length; percobaan++) {
            // [BARU] Audio yang sudah disiapkan lebih awal (mis. sapaan): langsung dipakai, tanpa menunggu Gemini lagi
            const siap = prefetchSuaraRef.current.get(bersih);
            if (siap) {
              prefetchSuaraRef.current.delete(bersih);
              const aliranSiap = await siap;
              if (aliranSiap) return { aliran: aliranSiap };
            }
            if (!(await ambilSlotTts(ctrl.signal))) return null; // disela saat antre
            let slotDilepas = false;
            try {
              if (streamMatiRef.current || !dukungPcmStream()) {
                return { blob: (await (api as any).ttsAudio(bersih, ctrl.signal, bahasaTts)) as Blob };
              }
              const reader = await (api as any).ttsStream(bersih, ctrl.signal, bahasaTts);
              return { aliran: new AliranPcm(reader) };
            } catch (e: any) {
              if (ctrl.signal.aborted || e?.name === 'AbortError') return null; // disela / terlalu lama
              // Backend belum punya endpoint streaming -> pindah ke /api/tts biasa (tidak dihitung sebagai percobaan gagal)
              if ((e?.status === 404 || e?.status === 405) && !streamMatiRef.current) {
                streamMatiRef.current = true;
                percobaan -= 1;
                continue;
              }
              // 413 (teks terlalu panjang), 401/403 (belum login / ditolak): diulang pun tidak menolong
              if (e?.status === 413 || e?.status === 401 || e?.status === 403 || /\((401|403)\)/.test(String(e?.message || ''))) {
                console.warn('[VoiceAssistant] Suara server ditolak, kalimat dilewati:', e?.status || '', e?.message || e);
                return null;
              }
              // [BARU] Gemini habis / tidak tersedia (502/503/504 dari /api/tts/stream): LANGSUNG minta /api/tts biasa, tanpa menunggu retry.
              // Di sana backend memakai Edge TTS kalau semua kunci Gemini masih istirahat, atau Gemini kalau sudah ada kunci yang pulih.
              // Kalimat berikutnya tetap mencoba Gemini (streaming) dulu, jadi begitu kunci pulih suara otomatis kembali ke Gemini.
              if (e?.status === 502 || e?.status === 503 || e?.status === 504) {
                try {
                  return { blob: (await (api as any).ttsAudio(bersih, ctrl.signal, bahasaTts)) as Blob };
                } catch (e2: any) {
                  if (ctrl.signal.aborted || e2?.name === 'AbortError') return null;
                  // Edge juga gagal -> lanjut ke coba-ulang biasa di bawah
                }
              }
              if (percobaan === JEDA_ULANG_MS.length) {
                console.warn('[VoiceAssistant] Suara server (/api/tts) gagal, kalimat dilewati:', e?.status || '', e?.message || e);
                return null;
              }
              lepasSlotTts(); slotDilepas = true; // jangan menahan slot selama menunggu retry
              await new Promise((r) => setTimeout(r, JEDA_ULANG_MS[percobaan]));
              if (ctrl.signal.aborted) return null;
            } finally {
              if (!slotDilepas) lepasSlotTts();
            }
          }
          return null;
        })().finally(() => clearTimeout(batas)); // [DIUBAH] ctrl TETAP terdaftar sampai kalimat selesai diputar, supaya aliran bisa dibatalkan saat disela
        rantaiSuaraRef.current = rantaiSuaraRef.current.then(async () => {
          if (genA !== genSuaraRef.current) return;
          const hasil = await audioP;
          if (genA !== genSuaraRef.current) return;
          bicaraSejakRef.current = Date.now();
          try {
            if (hasil?.aliran) {
              // [BARU] Streaming: status "Sedang menjawab…" baru tampil saat suara pertama benar-benar terdengar (saatMulai).
              const pemutar = new PemutarPcm({ laju: () => lajuRef.current, saatMulai: () => { if (genA === genSuaraRef.current) ubahStatus('bicara'); } });
              const hentikan = () => pemutar.hentikan();
              hentikanAudioRef.current = hentikan;
              audioSedangRef.current = true;
              try {
                await pemutar.putar(hasil.aliran);
              } finally {
                audioSedangRef.current = false;
                if (hentikanAudioRef.current === hentikan) hentikanAudioRef.current = null;
              }
            } else if (hasil?.blob) {
              await mainkanBlob(hasil.blob);
            } else {
              setGalat('Suara AI sedang tidak tersedia (kuota Gemini habis atau server suara bermasalah). Teks jawaban tetap tampil.'); // diam, tanpa suara browser
            }
          } finally {
            ttsCtrlRef.current.delete(ctrl);
          }
          if (genA !== genSuaraRef.current) return;
          antrianSuaraRef.current = Math.max(0, antrianSuaraRef.current - 1);
          if (antrianSuaraRef.current === 0) akhiriBicara();
        });
        return;
      }

      const u = new SpeechSynthesisUtterance(bersih);
      const suaraPakai = bahasaRef.current === 'en' ? suaraEnRef.current : suaraRef.current;
      u.lang = bahasaRef.current === 'en' ? 'en-US' : 'id-ID';
      if (suaraPakai) u.voice = suaraPakai;
      u.rate = 1.05 * lajuRef.current;
      const gen = genSuaraRef.current;
      antrianSuaraRef.current += 1;
      utteranceRef.current.push(u);
      let sudah = false;
      const selesai = (ev?: any) => {
        if (sudah) return;
        sudah = true;
        if (gen !== genSuaraRef.current) return; // sudah dibatalkan/disela -> abaikan
        if (ev?.error === 'not-allowed') setGalat('Suara diblokir browser — klik halaman ini sekali lalu coba lagi.');
        utteranceRef.current = utteranceRef.current.filter((x) => x !== u);
        antrianSuaraRef.current = Math.max(0, antrianSuaraRef.current - 1);
        if (antrianSuaraRef.current === 0) akhiriBicara();
      };
      u.onend = selesai;
      u.onerror = selesai;
      const putar = () => {
        if (gen !== genSuaraRef.current) return;
        bicaraSejakRef.current = Date.now();
        window.speechSynthesis.speak(u);
      };
      // Chrome kadang menelan speak() yang dipanggil tepat setelah cancel(); beri jeda singkat
      const tunggu = Math.max(0, 120 - (Date.now() - batalSejakRef.current));
      if (tunggu > 0) setTimeout(putar, tunggu); else putar();
    },
    [akhiriBicara, mainkanBlob, ubahStatus]
  );

  // [BARU] Pintu masuk bicara: teks panjang dipecah per kalimat/klausa, tidak ada bagian yang terpotong diam-diam.
  const ucapkan = useCallback(
    (teks: string) => {
      const bersih = bersihkanUntukSuara(teks);
      if (!bersih) return;
      for (const potongan of pecahTeksPanjang(bersih)) ucapkanSatu(potongan);
    },
    [ucapkanSatu]
  );

  // [BARU] Riwayat percakapan LENGKAP: giliran yang ditangani kode lokal (buka halaman, ganti client, konfirmasi, klarifikasi)
  // juga dicatat ke riwayatRef, supaya AI tahu apa yang barusan Neo ucapkan/tanyakan dan apa yang pengguna jawab.
  const perintahRef = useRef('');
  const lokalEntriRef = useRef<{ role: string; content: string } | null>(null);
  const klarifikasiRef = useRef<{ kandidat: KandidatTab[]; sampai: number } | null>(null);
  const catatLokal = useCallback((teks: string) => {
    const t = (teks || '').trim();
    const p = perintahRef.current;
    if (!t || !p) return;
    if (lokalEntriRef.current) {
      lokalEntriRef.current.content += ' ' + t;
      return;
    }
    const entri = { role: 'assistant', content: t };
    riwayatRef.current.push({ role: 'user', content: p }, entri);
    riwayatRef.current = riwayatRef.current.slice(-MAKS_RIWAYAT * 2);
    lokalEntriRef.current = entri;
  }, []);
  const ucapkanLokal = useCallback((teks: string) => { catatLokal(teks); ucapkan(teks); }, [catatLokal, ucapkan]);

  // ---------- Konfirmasi "yakin?" (HANYA untuk ucapan yang benar-benar membingungkan) ----------
  // Ganti halaman/tab/client yang jelas atau salah dengar 1-2 kata TIDAK ditanyakan lagi. Konfirmasi hanya dipakai
  // untuk kasus ambigu (mis. "ganti journal transaction": pindah tab atau ubah data?). Menunggu "ya" / "tidak";
  // tak dijawab dalam KONFIRMASI_TIMEOUT_MS -> otomatis batal. Ucapan lain = batal juga.
  const mintaKonfirmasi = useCallback(
    (tanya: string, ya: () => void) => {
      if (konfirmasiRef.current) clearTimeout(konfirmasiRef.current.timer);
      const timer = setTimeout(() => {
        if (!konfirmasiRef.current) return;
        konfirmasiRef.current = null;
        catatAudit('konfirmasi-kedaluwarsa', tanya);
        ucapkanLokal(tx('Tidak ada jawaban, aku batalkan.', 'No answer, so I cancelled it.'));
      }, KONFIRMASI_TIMEOUT_MS);
      konfirmasiRef.current = { tanya, ya, timer };
      catatAudit('konfirmasi-tanya', tanya);
      ucapkanLokal(tanya);
    },
    [tx, ucapkanLokal]
  );

  const stopSemua = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current += 1;
    sedangMemprosesRef.current = false;
    batalkanSuara();
    setelahBicaraSelesai();
  }, [batalkanSuara, setelahBicaraSelesai]);

  // ---------- SELA: pengguna bicara saat AI sedang menjawab/berpikir ----------
  const potongAI = useCallback(() => {
    abortRef.current?.abort(); // hentikan aliran jawaban dari server
    reqIdRef.current += 1; // jawaban lama tidak boleh bicara lagi
    sedangMemprosesRef.current = false;
    batalkanSuara();
    bicaraRef.current = false;
    selesaiBicaraSejakRef.current = Date.now();
    bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS); // tetap mode ngobrol: lanjut bertanya tanpa kata panggil
    ubahStatus('menunggu');
  }, [batalkanSuara, bukaJendelaPerintah, ubahStatus]);

  // Apakah ucapan ini sebenarnya gema suara AI sendiri (speaker -> mic)?
  const adalahGema = useCallback((teks: string) => {
    // [BARU] Jawaban singkat "ya"/"tidak" atas pertanyaan konfirmasi jangan dianggap gema (kata 1-2 huruf biasanya dibuang)
    if (konfirmasiRef.current && !bicaraRef.current && Date.now() - selesaiBicaraSejakRef.current > 500 && bacaKonfirmasi(normalisasi(teks))) return false;
    // [BARU] Jawaban atas pertanyaan klarifikasi tab ("penjualan") memuat kata yang Neo sendiri ucapkan -> jangan dianggap gema
    const kl = klarifikasiRef.current;
    if (kl && Date.now() <= kl.sampai && !bicaraRef.current && Date.now() - selesaiBicaraSejakRef.current > 500 && pilihKandidatTab(normalisasi(teks), kl.kandidat)) return false;
    const lagiBicara = bicaraRef.current;
    const pascaBicara = Date.now() - selesaiBicaraSejakRef.current < GEMA_JENDELA_MS;
    if (!lagiBicara && !pascaBicara) return false; // tidak ada suara AI -> pasti suara pengguna
    const t = normalisasi(teks);
    const acuanKata = normalisasi(teksDiucapkanRef.current).split(' ');
    const acuan = new Set(acuanKata);
    // [DIUBAH] ajakan berhenti ("stop", "oke udah itu aja cukup", "kepanjangan", ...) = pengguna sungguhan, bukan gema.
    // Dulu hanya KATA PERTAMA yang dicek, jadi "sudah, stop" ditolak kalau Neo baru mengucapkan "sudah".
    if (lagiBicara && (bacaBerhenti(t, teksDiucapkanRef.current).berhenti || sudahDipelajari(t))) return false;
    // [BARU] angka ("2.000.000") diabaikan: Neo mengucapkannya sebagai kata ("dua juta"), jadi tidak bisa dicocokkan
    const kata = t.split(' ').filter((k) => k.length > 2 && !/\d/.test(k));
    if (kata.length === 0) return true; // pecahan 1-2 huruf / angka saja: anggap derau/gema
    const cocok = kata.filter((k) => kataCocokGema(k, acuanKata, acuan)).length;
    return cocok / kata.length >= (lagiBicara ? 0.5 : 0.6);
  }, []);

  // [BARU] Saat Neo SEDANG bicara, hanya perintah berhenti (stop, hentikan, berhenti, tunggu, cukup, dst.) yang boleh menyela;
  // ucapan lain diabaikan supaya gema suara Neo sendiri tidak membuatnya berhenti.
  // Saat Neo hanya berpikir (belum bersuara) tidak ada gema, jadi menyela tetap langsung.
  const layakMenyela = useCallback((teks: string) => {
    if (!bicaraRef.current) return true;
    if (Date.now() - bicaraSejakRef.current < 500) return false;
    // [DIUBAH] ratusan bentuk ajakan berhenti + penjaga gema + kalimat yang dulu dinilai AI sebagai ajakan berhenti
    return bacaBerhenti(teks, teksDiucapkanRef.current).berhenti || sudahDipelajari(teks);
  }, []);

  // ---------- Navigasi suara: "buka laba rugi", "pergi ke pembelian", "kembali" ----------
  // Dicek SEBELUM memanggil AI: instan, tanpa kuota, dan hanya bisa membuka halaman yang terdaftar
  // di src/lib/navigasiSuara.ts. Return true = perintah sudah ditangani (tak perlu tanya AI).
  // [DIUBAH] TANPA konfirmasi: nama halaman/tab yang jelas ATAU salah dengar 1-2 kata (hanya satu halaman yang mirip)
  // langsung dibuka. Neo hanya bertanya bila memang membingungkan: (a) beberapa halaman sama miripnya,
  // (b) "ganti journal transaction" tanpa tujuan -> pindah tab atau mengubah data di layar?
  const jalankanNavigasi = useCallback(
    (teks: string): boolean => {
      const hentikanDulu = () => {
        abortRef.current?.abort();
        reqIdRef.current += 1;
        sedangMemprosesRef.current = false;
        batalkanSuara();
        aktifRef.current = true; // tetap mode ngobrol: tanpa kata panggil
        setGalat('');
      };
      const bukaHalaman = (path: string, nama: string, tabQuery?: string, belumTersedia?: boolean) => {
        routerRef.current.push(path);
        catatAudit('navigasi', path);
        undoRef.current = { nama: tx(`buka ${nama}`, `open ${nama}`), jalankan: () => routerRef.current.back(), kedaluwarsa: Date.now() + UNDO_KEDALUWARSA_MS };
        // tab berbasis state di halaman yang SAMA tidak remount -> beri tahu lewat event (halaman baru membaca ?tab= saat dibuka)
        if (tabQuery) window.dispatchEvent(new CustomEvent('neo-tab', { detail: { tab: tabQuery } }));
        // [BARU] kartu laporan "Coming Soon" di halaman Laporan: tab-nya dibuka, tapi Neo jujur bahwa laporannya belum ada
        if (belumTersedia) ucapkanLokal(tx(`Laporan ${nama} belum tersedia, masih Coming Soon. Aku bukakan halaman Laporan.`, `The ${nama} report is not available yet, it's still Coming Soon. Opening the Reports page.`));
        else ucapkanLokal(tx(`Membuka ${nama}.`, `Opening ${nama}.`));
      };
      // [BARU] Jawaban atas pertanyaan klarifikasi tab sebelumnya ("Data Sumber di Penjualan, Pembelian, atau Entri Jurnal?")
      const kl = klarifikasiRef.current;
      if (kl) {
        klarifikasiRef.current = null;
        if (Date.now() <= kl.sampai) {
          const pilih = pilihKandidatTab(normalisasi(teks), kl.kandidat);
          if (pilih) {
            hentikanDulu();
            bukaHalaman(pilih.path, pilih.nama, pilih.tabQuery);
            return true;
          }
        }
      }
      const n = bacaNavigasi(teks, pathRef.current);
      if (!n) {
        // [BARU] nama tab disebut tanpa halaman dan ada di beberapa halaman -> tanya dulu, ingat pilihannya
        const kt = bacaKlarifikasiTab(teks);
        if (kt) {
          hentikanDulu();
          const nama = Array.from(new Set(kt.kandidat.map((k) => k.halaman)));
          const tampil = nama.slice(0, 4);
          const daftar = tampil.join(', ').replace(/, ([^,]*)$/, tx(' atau $1', ' or $1')) + (nama.length > tampil.length ? tx(', atau yang lain', ', or others') : '');
          klarifikasiRef.current = { kandidat: kt.kandidat, sampai: Date.now() + 45000 };
          ucapkanLokal(tx(`Tab ${kt.nama} ada di ${daftar}. Yang mana?`, `The ${kt.nama} tab is in ${daftar}. Which one?`));
          return true;
        }
        // salah dengar nama halaman ("buka neraka" -> Neraca): satu kandidat = langsung dibuka, tanpa konfirmasi
        const mirip = bacaNavigasiMirip(normalisasi(teks));
        if (mirip.length === 0) return false;
        hentikanDulu();
        // beberapa kandidat yang sebenarnya halaman yang sama ("Pembelian" vs "Pembelian di Laporan") -> pilih yang utama
        const urut = [...mirip].sort((a, b) => a.entri.nama.length - b.entri.nama.length);
        const utama = urut.every((x) => x.entri.nama.startsWith(urut[0].entri.nama)) ? urut[0] : null;
        if (utama) {
          bukaHalaman(utama.entri.path, utama.entri.nama, utama.entri.tabQuery);
        } else {
          const nama = mirip.map((m) => m.entri.nama).join(tx(' atau ', ' or '));
          ucapkanLokal(tx(`Maksudnya ${nama}? Sebutkan nama halamannya lebih jelas.`, `Do you mean ${nama}? Please say the page name more clearly.`));
        }
        return true;
      }
      hentikanDulu();
      if (n.jenis === 'kembali') {
        routerRef.current.back();
        catatAudit('navigasi', 'kembali');
        ucapkanLokal(tx('Kembali ke halaman sebelumnya.', 'Going back to the previous page.'));
      } else if (ambiguGantiAtauPindah(normalisasi(teks))) {
        // "ganti journal transaction" tanpa tujuan: pindah tab atau ubah data di layar? -> HANYA kasus ini yang ditanyakan
        mintaKonfirmasi(
          tx(
            `Maksudnya pindah ke ${n.nama}, atau mengubah data yang ada di layar? Kalau pindah halaman, katakan ya. Mengubah data tidak bisa lewat suara.`,
            `Do you mean switching to ${n.nama}, or changing the data on screen? If switching, say yes. Changing data is not possible by voice.`
          ),
          () => bukaHalaman(n.path, n.nama, n.tabQuery, n.belumTersedia)
        );
      } else {
        bukaHalaman(n.path, n.nama, n.tabQuery, n.belumTersedia);
      }
      return true;
    },
    [batalkanSuara, mintaKonfirmasi, tx, ucapkanLokal]
  );

  // ---------- Ganti client lewat suara: "ganti ke client sau", "pindah ke client nbm" ----------
  // Dicek SEBELUM navigasi (kata "pindah" + "client" kalau tidak akan membuka halaman /clients) dan SEBELUM AI.
  // Cukup menyebut KODE client; hanya bisa memilih client yang ada di daftar.
  // terapkanHasilClient = pelaksana bersama untuk jalur lokal (parser) DAN jalur cadangan LLM.
  const terapkanHasilClient = useCallback(
    (h: HasilGantiClient) => {
      abortRef.current?.abort();
      reqIdRef.current += 1;
      sedangMemprosesRef.current = false;
      batalkanSuara();
      aktifRef.current = true; // tetap mode ngobrol
      setGalat('');
      if (clientLoadingRef.current && clientsRef.current.length === 0) {
        ucapkanLokal(tx('Daftar client belum selesai dimuat. Coba lagi sebentar.', 'The client list is still loading. Please try again in a moment.'));
        return;
      }
      // Client SELALU disebut dengan KODE-nya (dieja per huruf agar jelas di suara), bukan nama perusahaan.
      // Kode otomatis dipetakan ke perusahaannya: setActiveClient memakai id + nama dari daftar, sama seperti dropdown Topbar.
      // [DIUBAH] TANPA konfirmasi: kode yang jelas ATAU salah dengar (hanya satu client yang mirip) langsung diganti.
      // Neo hanya bertanya bila beberapa client sama miripnya (lihat 'ambigu' / 'mirip' banyak kandidat di bawah).
      const pindahKe = (tujuan: { id: string; companyName: string; clientCode: string }) => {
        const sebelum = clientsRef.current.find((c) => c.id === activeClientIdRef.current);
        setActiveClientRef.current(tujuan.id, tujuan.companyName); // sama persis dengan klik di dropdown Topbar
        catatAudit('ganti-client', tujuan.clientCode);
        if (sebelum) {
          undoRef.current = {
            nama: tx(`pindah ke client ${ejaKode(tujuan.clientCode)}`, `switch to client ${ejaKode(tujuan.clientCode)}`),
            jalankan: () => setActiveClientRef.current(sebelum.id, sebelum.companyName),
            kedaluwarsa: Date.now() + UNDO_KEDALUWARSA_MS,
          };
        }
        ucapkanLokal(tx(`Baik, pindah ke client ${ejaKode(tujuan.clientCode)}.`, `Okay, switching to client ${ejaKode(tujuan.clientCode)}.`));
      };

      if (h.jenis === 'tidak-ditemukan') {
        ucapkanLokal(PESAN_TIDAK_DIKENAL[bahasaRef.current](h.disebut, clientsRef.current));
      } else if (h.jenis === 'ambigu') {
        ucapkanLokal(susunPilihanClient(h.kandidat.slice(0, 3), bahasaRef.current));
      } else if (h.jenis === 'mirip') {
        // salah dengar: satu kandidat -> langsung pindah; beberapa kandidat -> minta sebut kodenya
        if (h.kandidat.length === 1 && h.kandidat[0].id !== activeClientIdRef.current) {
          pindahKe(h.kandidat[0]);
        } else if (h.kandidat.length === 1) {
          ucapkanLokal(tx(`Client ${ejaKode(h.kandidat[0].clientCode)} sudah aktif.`, `Client ${ejaKode(h.kandidat[0].clientCode)} is already active.`));
        } else {
          ucapkanLokal(susunPilihanClient(h.kandidat.slice(0, 3), bahasaRef.current));
        }
      } else if (h.sudahAktif) {
        ucapkanLokal(tx(`Client ${ejaKode(h.client.clientCode)} sudah aktif.`, `Client ${ejaKode(h.client.clientCode)} is already active.`));
      } else {
        pindahKe(h.client);
      }
    },
    [batalkanSuara, tx, ucapkanLokal]
  );

  // Jalur 1 (instan, tanpa jaringan): parser lokal. Return true = sudah ditangani.
  const jalankanGantiClient = useCallback(
    (teks: string): boolean => {
      const h = bacaGantiClient(normalisasi(teks), clientsRef.current, activeClientIdRef.current);
      if (!h) return false;
      terapkanHasilClient(h);
      return true;
    },
    [terapkanHasilClient]
  );

  // ---------- Kirim perintah ke AI, bacakan per kalimat saat streaming ----------
  const tanyaAI = useCallback(
    async (perintah: string) => {
      if (perintahRef.current !== perintah) { perintahRef.current = perintah; lokalEntriRef.current = null; }
      if (POLA_DAFTAR_WAJAH.test(normalisasi(perintah))) { void daftarWajahRef.current(); return; } // [BARU] "aku mau kamu mengenali wajahku" -> daftarkan wajah (dengan persetujuan)
      if (POLA_HAPUS_WAJAH.test(normalisasi(perintah))) { void hapusWajahRef.current(); return; } // [BARU] hapus data wajah
      if (jalankanGantiClient(perintah)) return; // perintah ganti client -> tidak perlu AI (harus SEBELUM navigasi)
      // [BARU] Aksi yang mengubah/menghapus/memposting data TIDAK dijalankan lewat suara (salah dengar = salah jurnal).
      if (aksiTerlarang(normalisasi(perintah))) {
        abortRef.current?.abort();
        reqIdRef.current += 1;
        sedangMemprosesRef.current = false;
        batalkanSuara();
        catatAudit('diblokir', 'aksi ubah data lewat suara');
        setGalat('');
        ucapkanLokal(PESAN_TERLARANG[bahasaRef.current]);
        return;
      }
      // Jalur 2 (cadangan LLM): ucapan menyebut kode/nama client yang ada tapi bentuknya bebas
      // ("tolong lihat dulu datanya si SAU"). Navigasi ditunda sampai LLM menjawab, supaya kata "client"
      // + "pindah/buka" tidak keburu membuka halaman /clients.
      const cobaLLM = perluTanyaLLM(normalisasi(perintah), clientsRef.current);
      if (!cobaLLM && jalankanNavigasi(perintah)) return; // perintah buka halaman -> tidak perlu AI
      abortRef.current?.abort();
      const id = ++reqIdRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      sedangMemprosesRef.current = true;
      batalkanSuara(); // hentikan sisa suara jawaban sebelumnya
      bicaraRef.current = false;
      // jangan sampai timer jendela lama menutup mode ngobrol saat AI masih mikir/bicara
      if (timerAktifRef.current) clearTimeout(timerAktifRef.current);
      ubahStatus('berpikir');

      if (!sesiIdRef.current) {
        sesiIdRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `sesi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      // [BARU] Pertanyaan/penjelasan soal halaman, tab, atau client: bila namanya meragukan (salah dengar), AI diberi kandidat
      // terdekat dan diminta bertanya balik kalau ambigu/tidak dikenal. Ucapan yang sudah jelas -> string kosong.
      const tafsir = bacaTafsirUcapan(normalisasi(perintah), clientsRef.current);
      if (tafsir) catatAudit('tafsir-ucapan', tafsir.slice(0, 200));
      const pesan = `${pilihInstruksi(perintah, bahasaRef.current)}\n[Halaman yang sedang dibuka: ${pathRef.current}]\n${tafsir}${perintah}`;
      // [BARU] Kamera: HANYA kalau ucapan jelas meminta Neo melihat pengguna. Kamera menyala sebentar (1 frame) lalu dimatikan.
      let gambarKamera = '';
      let catatanKamera = '';
      let analisaCache = '';
      const cacheWajah = analisaWajahRef.current;
      if (perluKamera(perintah) && cacheWajah && Date.now() - cacheWajah.waktu < 60000) analisaCache = cacheWajah.teks; // analisis dari sapaan masih segar (<60 dtk): tidak perlu menyalakan kamera lagi
      else if (perluKamera(perintah)) {
        setKameraAktif(true);
        const hk = await ambilFotoKamera();
        setKameraAktif(false);
        if (id !== reqIdRef.current) return; // disela saat kamera menyala
        if (hk.ok) gambarKamera = hk.base64;
        else {
          catatAudit('kamera-gagal', hk.pesan);
          catatanKamera = `\n[KAMERA GAGAL: ${hk.pesan} Beri tahu pengguna dengan satu kalimat singkat bahwa kamu belum bisa melihat dan sebabnya; JANGAN mengarang deskripsi.]`;
        }
      }
      // [BARU] "Berbagi layar" versi teks: hanya diambil kalau pertanyaan menyangkut isi layar (dilewati kalau yang diminta kamera)
      const konteksLayar = !gambarKamera && !analisaCache && perluLayar(perintah) ? ambilSnapshotLayar() : '';
      let lengkap = '';
      let buffer = '';
      let pertama = true;
      let kelamaan = false;
      setGalat('');
      const timerKelamaan = setTimeout(() => { kelamaan = true; ctrl.abort(); }, 60000);
      try {
        if (cobaLLM) {
          const daftarKode = clientsRef.current
            .filter((c) => c.clientCode && c.clientCode !== '-')
            .map((c) => ({ kode: c.clientCode, nama: c.companyName }));
          const aktifKode = clientsRef.current.find((c) => c.id === activeClientIdRef.current)?.clientCode ?? null;
          const r = await (api as any).tentukanClientSuara(normalisasi(perintah), daftarKode, aktifKode, ctrl.signal);
          if (id !== reqIdRef.current) return; // disela saat LLM berpikir
          if (r?.intent === 'ganti_client') {
            // validasi ULANG di sisi klien: kode harus benar-benar ada di daftar
            const h = hasilDariKode(r.kode, clientsRef.current, activeClientIdRef.current);
            if (h) { terapkanHasilClient(h); return; }
          }
          if (jalankanNavigasi(perintah)) return; // bukan ganti client -> barulah coba navigasi halaman
        }
        // [BARU] Giliran ini dicatat ke riwayat SEJAK AWAL dan diisi bertahap, jadi tetap tersimpan walau disela/terputus.
        const riwayatKirim = riwayatRef.current.slice(-MAKS_RIWAYAT);
        const entriAI = { role: 'assistant', content: '' };
        riwayatRef.current.push({ role: 'user', content: perintah }, entriAI);
        riwayatRef.current = riwayatRef.current.slice(-MAKS_RIWAYAT * 2);
        for await (const evt of api.chatStream(
          pesan + catatanKamera,
          riwayatKirim,
          [],
          null,
          null, // tidak disimpan ke riwayat percakapan Agent AI
          ctrl.signal,
          { modeSuara: true, pesanAsli: perintah, sesiId: sesiIdRef.current, konteksLayar, gambarKamera, analisaWajah: analisaCache } // jalur cepat + memori AI
        )) {
          if (id !== reqIdRef.current) return; // sudah disela / diganti pertanyaan baru
          if (evt.type !== 'delta') continue;
          lengkap += evt.text;
          entriAI.content = lengkap;
          buffer += evt.text;
          // ucapkan setiap kalimat lengkap; potongan PERTAMA boleh berhenti di koma supaya suara mulai lebih cepat
          for (;;) {
            let m = buffer.match(/^([\s\S]*?[.!?\n])\s/);
            if (!m && pertama) m = buffer.match(/^([\s\S]{20,}?[,;:])\s/);
            // [BARU] Belum ada tanda baca tapi sudah panjang: jangan menunggu sampai akhir jawaban, ucapkan potongan pertama sekarang.
            if (!m && buffer.length > MAKS_POTONGAN_SUARA * 1.5) {
              const n = titikPotong(buffer, MAKS_POTONGAN_SUARA);
              m = [buffer.slice(0, n), buffer.slice(0, n)] as unknown as RegExpMatchArray;
            }
            if (!m) break;
            ucapkan(m[1]);
            pertama = false;
            buffer = buffer.slice(m[0].length);
          }
        }
        if (id !== reqIdRef.current) return;
        if (buffer.trim()) ucapkan(buffer);
        jawabanTerakhirRef.current = lengkap; // [BARU] untuk perintah "ulangi"
      } catch (e: any) {
        if (id !== reqIdRef.current) return;
        if (lengkap.trim() && (kelamaan || e?.name !== 'AbortError')) {
          // [BARU] Jawaban putus di TENGAH (sebagian sudah diucapkan). Jangan pakai pesan "tidak bisa menjawab" yang menyesatkan:
          // beri tahu jawabannya terpotong dan minta ulangi. Sisa kalimat yang belum utuh sengaja tidak dibacakan.
          console.error('[VoiceAssistant] jawaban AI terputus di tengah:', e);
          setGalat('Jawaban terputus di tengah.');
          ucapkan(tx('Maaf, koneksi ke AI terputus di tengah jawaban. Coba ulangi pertanyaannya.', 'Sorry, the connection to the AI dropped mid-answer. Please ask again.'));
        } else if (kelamaan) {
          setGalat('Server AI terlalu lama menjawab.');
          ucapkan(tx('Maaf, server AI terlalu lama menjawab. Coba lagi sebentar.', 'Sorry, the AI server took too long. Please try again shortly.'));
        } else if (e?.name !== 'AbortError') {
          console.error('[VoiceAssistant] gagal memanggil AI:', e);
          const pesanErr = String(e?.message || e);
          if (/429|rate.?limit/i.test(pesanErr)) {
            const m = pesanErr.match(/try again in ([0-9hms.]+)/i);
            setGalat('Kuota AI sedang habis' + (m ? ` (coba lagi sekitar ${m[1].replace(/\.\d+s/, 's')})` : '') + '.');
            ucapkan(tx('Maaf, kuota AI sedang habis. Coba lagi beberapa menit lagi.', 'Sorry, the AI quota is used up. Please try again in a few minutes.'));
          } else {
            setGalat(pesanErr);
            ucapkan(tx('Maaf, saya sedang tidak bisa menjawab. Coba lagi sebentar.', 'Sorry, I cannot answer right now. Please try again shortly.'));
          }
        }
      } finally {
        clearTimeout(timerKelamaan);
        if (id === reqIdRef.current) {
          sedangMemprosesRef.current = false;
          if (antrianSuaraRef.current === 0) akhiriBicara();
        }
      }
    },
    [akhiriBicara, batalkanSuara, jalankanGantiClient, jalankanNavigasi, terapkanHasilClient, tx, ubahStatus, ucapkan]
  );

  // ---------- [BARU] Perintah keamanan & kenyamanan ----------
  const hentikanJawaban = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current += 1;
    sedangMemprosesRef.current = false;
    batalkanSuara();
  }, [batalkanSuara]);

  // "batalkan" / "undo": urungkan aksi suara terakhir (pindah halaman / ganti client) bila masih dalam 1 menit
  const jalankanBatalkan = useCallback(() => {
    hentikanJawaban();
    const u = undoRef.current;
    undoRef.current = null;
    if (!u || Date.now() > u.kedaluwarsa) {
      ucapkan(tx('Tidak ada yang bisa dibatalkan.', 'There is nothing to undo.'));
      return;
    }
    catatAudit('batalkan', u.nama);
    u.jalankan();
    ucapkan(tx(`Dibatalkan: ${u.nama}.`, `Undone: ${u.nama}.`));
  }, [hentikanJawaban, tx, ucapkan]);

  // "ulangi" / "repeat": ucapkan lagi jawaban terakhir
  const jalankanUlangi = useCallback(() => {
    hentikanJawaban();
    const jawab = jawabanTerakhirRef.current;
    if (!jawab) {
      ucapkan(tx('Belum ada jawaban yang bisa diulang.', 'There is no answer to repeat yet.'));
      return;
    }
    catatAudit('ulangi');
    (jawab.match(/[^.!?\n]+[.!?]?/g) || [jawab]).forEach((k) => ucapkan(k));
  }, [hentikanJawaban, tx, ucapkan]);

  // "lebih pelan" / "lebih cepat" / "kecepatan normal"
  const jalankanLaju = useCallback(
    (arah: 'pelan' | 'cepat' | 'normal') => {
      hentikanJawaban();
      lajuRef.current = ubahLaju(lajuRef.current, arah);
      try { localStorage.setItem('neo_laju', String(lajuRef.current)); } catch { /* abaikan */ }
      catatAudit('laju', String(lajuRef.current));
      ucapkan(
        arah === 'normal'
          ? tx('Kecepatan bicara kembali normal.', 'Speaking speed is back to normal.')
          : arah === 'pelan'
          ? tx('Baik, aku bicara lebih pelan.', 'Okay, I will speak slower.')
          : tx('Baik, aku bicara lebih cepat.', 'Okay, I will speak faster.')
      );
    },
    [hentikanJawaban, tx, ucapkan]
  );

  // "bicara bahasa Inggris" (perintah suara): ganti bahasa pengenalan suara DAN bahasa jawaban
  const ubahBahasa = useCallback(
    (b: Bahasa) => {
      hentikanJawaban();
      bahasaPilihanRef.current = b;
      bahasaRef.current = b;
      setBahasaTampil(b);
      try { if (recRef.current) recRef.current.lang = b === 'en' ? 'en-US' : 'id-ID'; } catch { /* abaikan */ }
      catatAudit('bahasa', b);
      hentikanDengar(); // onend otomatis menyalakan ulang dengan bahasa baru
      ucapkan(b === 'en' ? 'Okay, I will speak English.' : 'Baik, aku bicara bahasa Indonesia.');
    },
    [hentikanDengar, hentikanJawaban, ucapkan]
  );

  // ---------- Proses ucapan pengguna (sudah final / sudah dianggap selesai) ----------
  const tanganiUcapan = useCallback(
    (mentah: string) => {
      const teks = normalisasi(mentah);
      if (!teks) return;
      perintahRef.current = teks; // [BARU] giliran baru: catatan lokal ke riwayat mulai dari sini
      lokalEntriRef.current = null;
      setTeksTerakhir(teks);
      aktivitasTerakhirRef.current = Date.now();

      // [BARU] Bahasa jawaban ikut bahasa ucapan (kecuali pengguna meminta "bicara bahasa Inggris/Indonesia" -> bahasa dikunci sampai diminta ganti lagi)
      if (bahasaPilihanRef.current === 'auto') {
        const b = deteksiBahasa(teks, bahasaRef.current);
        if (b !== bahasaRef.current) { bahasaRef.current = b; setBahasaTampil(b); }
      }

      // [BARU] 1) Jawaban atas pertanyaan "yakin?": ya = jalankan; tidak = batal; ucapan lain = konfirmasi gugur (batal)
      const tunggu = konfirmasiRef.current;
      if (tunggu) {
        clearTimeout(tunggu.timer);
        konfirmasiRef.current = null;
        const jawab = bacaKonfirmasi(teks);
        if (jawab === 'ya') { catatAudit('konfirmasi-ya', tunggu.tanya); tunggu.ya(); return; }
        if (jawab === 'tidak') { catatAudit('konfirmasi-tidak', tunggu.tanya); ucapkanLokal(tx('Baik, dibatalkan.', 'Okay, cancelled.')); return; }
        catatAudit('konfirmasi-gugur', tunggu.tanya);
      }
      // [BARU] Ajakan berhenti MURNI ("stop", "oke udah itu aja cukup", "kamu menjelaskannya kepanjangan", ...):
      // hentikan Neo dan JANGAN kirim ke AI. Dulu kalimat yang lebih dari 3 kata lolos ke AI sebagai pertanyaan baru,
      // sehingga Neo malah mulai menjelaskan lagi. Kalau ada permintaan baru di dalamnya ("stop, sekarang buka neraca"), tetap diproses.
      const bh = bacaBerhenti(teks);
      if (bh.berhenti && bh.murni) { potongAI(); return; }
      if (sudahDipelajari(teks)) { potongAI(); return; } // [BARU] kalimat yang sudah pernah dinilai AI = berhenti: tidak dikirim ke AI sebagai pertanyaan
      // [BARU] 2) Perintah kenyamanan: batalkan, ulangi, kecepatan, bahasa
      if (bacaBatalkan(teks)) { jalankanBatalkan(); return; }
      if (bacaUlangi(teks)) { jalankanUlangi(); return; }
      const laju = bacaLaju(teks);
      if (laju) { jalankanLaju(laju); return; }
      const bahasaBaru = bacaGantiBahasa(teks);
      if (bahasaBaru) { ubahBahasa(bahasaBaru); return; }

      // posisi nama di dalam ucapan (dan panjangnya); -1 = tidak ada
      let namaIdx = -1;
      let namaLen = 0;
      const cocok = teks.match(POLA_NAMA);
      if (cocok && cocok.index !== undefined) {
        namaIdx = cocok.index;
        namaLen = cocok[0].length;
      } else if (POLA_NAMA_RAPAT.test(teks.replace(/ /g, ''))) {
        namaIdx = teks.length; // nama menempel ("haloneo") -> tak ada perintah menyertai
      }
      console.log('[VoiceAssistant] terdengar:', teks, '| nama cocok:', namaIdx >= 0, '| mode ngobrol:', aktifRef.current);
      if (namaIdx >= 0) {
        // ucapan setelah nama dianggap perintah ("halo neo, buka cash bank")
        const sesudahNama = teks.slice(namaIdx + namaLen).replace(POLA_SAPAAN, '').trim();
        // kata panggil tidak wajib; kalau terucap, cukup dibuang dari perintah dan TIDAK ada sapaan/perkenalan ulang
        if (sesudahNama.length > 2) {
          aktifRef.current = true;
          tanyaAI(sesudahNama);
        } else {
          bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS); // hanya "neo": diam saja, mic tetap siap
        }
        return;
      }

      // sedang dalam mode ngobrol
      if (aktifRef.current) {
        if (timerAktifRef.current) clearTimeout(timerAktifRef.current);
        // [DIUBAH] ajakan berhenti murni sudah ditangani di atas (bacaBerhenti); blok lama yang membuang ucapan <= 3 kata berisi
        // "sudah"/"cukup"/"tunggu" (mis. "sudah berapa") dihapus.
        if (POLA_SELESAI.test(teks)) {
          ucapkan(tx('Siap, sama-sama. Kalau perlu apa-apa, bilang saja ya.', "You're welcome. Just say the word if you need anything."));
          return;
        }
        tanyaAI(teks); // aktifRef tetap true -> mic tetap siap setelah jawaban selesai
      }
      // selain itu: diabaikan (bukan untuk AI)
    },
    [bukaJendelaPerintah, jalankanBatalkan, jalankanLaju, jalankanUlangi, potongAI, tanyaAI, tx, ubahBahasa, ucapkan]
  );

  // Pintu masuk semua ucapan pengguna: saring gema, lalu sela AI bila perlu.
  const prosesUcapan = useCallback(
    (mentah: string) => {
      const teks = normalisasi(mentah);
      if (!teks) return;
      if (adalahGema(teks)) return; // suara AI sendiri
      // [BARU] Nyalakan/matikan sistem lewat suara. Saat sistem mati, HANYA "nyalakan sistem" yang ditanggapi.
      if (akanMatiRef.current) return; // sedang mengucapkan "sistem telah dimatikan": jangan diselaku
      const sis = bacaPerintahSistem(teks);
      if (sis && bahasaPilihanRef.current === 'auto' && sis.bahasa !== bahasaRef.current) { bahasaRef.current = sis.bahasa; setBahasaTampil(sis.bahasa); }
      if (sistemMatiRef.current) {
        if (sis?.aksi === 'nyala') nyalakanSistemRef.current();
        return;
      }
      if (sis?.aksi === 'mati') { matikanSistemRef.current(); return; }
      if (sis?.aksi === 'nyala') { ucapkan(tx('Sistem sudah menyala.', 'The system is already on.')); return; }
      const sibuk = bicaraRef.current || sedangMemprosesRef.current;
      if (sibuk) {
        if (aktifRef.current) { if (!layakMenyela(teks)) return; potongAI(); } // SELA (dengan penjaga gema)
        else return; // bukan mode ngobrol & bukan memanggil AI -> abaikan
      }
      tanganiUcapan(mentah);
    },
    [adalahGema, layakMenyela, potongAI, tanganiUcapan, tx, ucapkan]
  );

  // [BARU] PAHAM MAKSUD. Regex hanya mengenali bentuk kalimat yang sudah didaftarkan. Kalau Neo sedang bicara dan ucapan
  // pengguna TIDAK dikenali regex ("hmm iya iya aku udah ngerti kok", "eh bentar, aku mau tanya hal lain", "intinya aja"),
  // tanyakan ke AI (POST /api/voice/stop-intent) apakah maksudnya minta Neo berhenti. Jalan di latar: Neo tetap bicara
  // sampai AI yakin. Hasil yang terlambat (Neo sudah selesai / pertanyaan lain sudah berjalan) dibuang supaya tidak
  // memotong jawaban yang salah.
  const nilaiMaksudBerhenti = useCallback(
    (ucapan: string) => {
      const idReq = reqIdRef.current;
      const gen = genSuaraRef.current;
      const neoTerakhir = teksDiucapkanRef.current.slice(-300);
      void tanyaMaksudBerhenti(ucapan, neoTerakhir, api.stopIntent).then((h) => {
        if (!(bicaraRef.current || sedangMemprosesRef.current)) return; // Neo sudah diam sendiri
        if (reqIdRef.current !== idReq || genSuaraRef.current !== gen) return; // jawaban/giliran sudah berganti
        const k = putuskan(h);
        if (!k.berhenti) return;
        // ucapan ini milik ajakan berhenti: jangan sampai ikut terkirim ke AI sebagai pertanyaan
        if (komitTimerRef.current) { clearTimeout(komitTimerRef.current); komitTimerRef.current = null; }
        bufUcapanRef.current = '';
        sementaraUcapanRef.current = '';
        potongAI();
        if (k.sisa) tanganiUcapan(k.sisa); // "eh bentar, berapa total PPN-nya?" -> Neo diam lalu menjawab pertanyaan barunya
      });
    },
    [potongAI, tanganiUcapan]
  );

  // [BARU] Kirim semua ucapan yang sudah dikumpulkan sebagai SATU pertanyaan utuh.
  const kirimKumpulan = () => {
    komitTimerRef.current = null;
    const teks = gabungUcapan(bufUcapanRef.current, sementaraUcapanRef.current).replace(POLA_KIRIM, '').trim();
    bufUcapanRef.current = '';
    sementaraUcapanRef.current = '';
    if (!teks) return;
    komitWaktuRef.current = Date.now();
    abortSengajaRef.current = true;
    try { recRef.current?.abort(); } catch { /* abaikan */ }
    prosesUcapan(teks);
  };

  // Dipanggil dari SpeechRecognition (lewat ref supaya selalu memakai versi terbaru)
  // [DIUBAH] Potongan final TIDAK lagi langsung dikirim ke AI. Semua potongan dikumpulkan; pengiriman
  // ditunda sampai kamu diam cukup lama (lihat hitungJeda) -> penjelasan panjang dengan jeda berpikir tidak terpotong.
  hasilRef.current = (e: any) => {
    errorBeruntunRef.current = 0;
    let sementara = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const hasil = e.results[i];
      if (hasil.isFinal) {
        // [DIUBAH] ucapan yang datang <2,5 dtk setelah kirim dibuang (duplikat), KECUALI ajakan berhenti saat Neo sibuk
        const neoSibuk = bicaraRef.current || sedangMemprosesRef.current;
        if (Date.now() - komitWaktuRef.current < 2500 && !(neoSibuk && bacaBerhenti(hasil[0]?.transcript || '', teksDiucapkanRef.current).berhenti)) continue; // sudah dikirim barusan
        // cek semua alternatif — mikrofon sering menaruh tebakan yang benar di alternatif ke-2/3
        const alternatif: string[] = [];
        for (let k = 0; k < hasil.length; k++) alternatif.push(hasil[k].transcript);
        // [BARU] urutan: (1) alternatif yang cocok PERSIS dengan kode client, (2) alternatif pertama.
        const cocokClient = alternatif.find((a) => {
          const r = bacaGantiClient(normalisasi(a), clientsRef.current, activeClientIdRef.current);
          return r?.jenis === 'ganti';
        });
        // [BARU] saat Neo sibuk, pilih alternatif yang berisi ajakan berhenti (mikrofon sering menaruh "stop" di tebakan ke-2/3)
        const altBerhenti = neoSibuk ? alternatif.find((a) => bacaBerhenti(a, teksDiucapkanRef.current).berhenti) : undefined;
        const dipakai = normalisasi(cocokClient || altBerhenti || alternatif[0] || '');
        if (!dipakai || adalahGema(dipakai)) continue;
        bufUcapanRef.current = gabungUcapan(bufUcapanRef.current, dipakai);
        // [BARU] Neo sedang bicara & regex tidak mengenali ucapan ini -> biarkan AI memahami maksudnya (di latar)
        if (bicaraRef.current && aktifRef.current && !akanMatiRef.current && !sistemMatiRef.current && !layakMenyela(dipakai)) nilaiMaksudBerhenti(dipakai);
      } else {
        sementara += hasil[0].transcript + ' ';
      }
    }
    const teksS = normalisasi(sementara);
    sementaraUcapanRef.current = teksS && !adalahGema(teksS) ? teksS : '';
    const semua = gabungUcapan(bufUcapanRef.current, sementaraUcapanRef.current);
    if (!semua) return;
    setTeksTerakhir(semua);
    aktivitasTerakhirRef.current = Date.now();
    if (pttTimerRef.current) { clearTimeout(pttTimerRef.current); pttTimerRef.current = null; } // [BARU] sudah ada suara: jangan tutup mic karena 'sepi'

    // SELA CEPAT: baru terdengar sebagian kata saja AI sudah langsung diam
    if ((bicaraRef.current || sedangMemprosesRef.current) && aktifRef.current && !akanMatiRef.current && !sistemMatiRef.current && layakMenyela(semua)) {
      potongAI();
    }

    // Kamu masih bicara -> jadwal kirim diulang dari awal; kirim hanya setelah diam cukup lama
    if (komitTimerRef.current) { clearTimeout(komitTimerRef.current); komitTimerRef.current = null; }
    komitTimerRef.current = setTimeout(kirimKumpulan, POLA_KIRIM.test(semua) ? 300 : hitungJeda(semua));
  };

  // ---------- Pengaturan tersimpan: hanya kecepatan bicara ----------
  // Mic SELALU otomatis (tidak ada mode tekan-untuk-bicara). Bahasa selalu mulai 'auto' tiap sesi;
  // sisa pengaturan lama (neo_ptt / neo_bahasa) dibersihkan.
  useEffect(() => {
    try {
      localStorage.removeItem('neo_ptt');
      localStorage.removeItem('neo_bahasa');
      const l = parseFloat(localStorage.getItem('neo_laju') || '');
      if (l >= 0.7 && l <= 1.5) lajuRef.current = l;
    } catch { /* abaikan */ }
    pttRef.current = false;
  }, []);

  // [BARU] Sentuhan/ketikan apa pun dianggap aktivitas (untuk timer "mic mati otomatis")
  useEffect(() => {
    const tandai = () => { aktivitasTerakhirRef.current = Date.now(); };
    window.addEventListener('pointerdown', tandai);
    window.addEventListener('keydown', tandai);
    return () => {
      window.removeEventListener('pointerdown', tandai);
      window.removeEventListener('keydown', tandai);
    };
  }, []);

  // ---------- Inisialisasi SpeechRecognition ----------
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { ubahStatus('tidak-didukung'); return; }

    // [BARU] Hanya SATU instance asisten suara boleh memegang mikrofon. Chrome cuma mengizinkan satu
    // SpeechRecognition aktif; kalau komponen ini ter-mount dobel (mis. AppLayout bersarang di layout
    // + halaman), keduanya saling merebut mikrofon: start -> aborted -> start -> aborted tanpa henti.
    const w = window as any;
    const tokenInstance = {};
    if (w.__voiceAssistantPemilik) {
      console.warn('[VoiceAssistant] instance kedua terdeteksi -> dinonaktifkan');
      catatDbg('instance dobel: dimatikan');
      ubahStatus('tidak-didukung'); // kotak instance dobel disembunyikan
      return;
    }
    w.__voiceAssistantPemilik = tokenInstance;

    const rec = new SR();
    rec.lang = bahasaRef.current === 'en' ? 'en-US' : 'id-ID';
    rec.continuous = !ADALAH_MOBILE; // Chrome Android: mode continuous sering diam/dobel; onend sudah menyalakan ulang otomatis
    rec.interimResults = true; // perlu untuk menyela cepat & komit dini
    rec.maxAlternatives = 3;

    rec.onresult = (e: any) => { catatDbg(`hasil: ${e.results[e.results.length - 1]?.[0]?.transcript || ''}`); hasilRef.current(e); };

    rec.onerror = (e: any) => {
      console.warn('[VoiceAssistant] error mic:', e.error);
      catatDbg(`error: ${e.error}`);
      if (e.error === 'network') setGalat('Pengenalan suara butuh internet (Chrome memakai server Google).');
      else if (e.error === 'audio-capture') setGalat('Mikrofon tidak ditemukan.');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        ubahStatus('izin-ditolak');
        rec.__berhenti = true;
      } else if (e.error === 'aborted') {
        // abort yang BUKAN dari kita (mis. sesi lain merebut mikrofon) = error beruntun -> restart diberi jeda,
        // supaya tidak terjadi loop start/abort tiap 300 ms yang membuat mic tidak pernah sempat mendengar.
        if (abortSengajaRef.current) abortSengajaRef.current = false;
        else {
          errorBeruntunRef.current += 1;
          const lama = Date.now() - mulaiSejakRef.current;
          catatDbg(`aborted ${lama}ms setelah mulai | tab=${document.visibilityState} fokus=${document.hasFocus()} beruntun=${errorBeruntunRef.current}`);
          // [BARU] Dibatalkan dari luar berkali-kali: berhenti memaksa (tiap 0,8 dtk watchdog merebut ulang -> ratusan error).
          // Jeda panjang 30 dtk + pesan jelas. Bicara berhasil akan mengulang dari nol.
          if (errorBeruntunRef.current >= 6) {
            bolehMulaiRef.current = Date.now() + 30000;
            setGalat('Mikrofon terus direbut tab/ekstensi/aplikasi lain. Tutup tab lain & ekstensi pemakai mic, lalu ucapkan "matikan sistem" lalu "nyalakan sistem".');
          }
        }
      } else if (e.error !== 'no-speech') {
        errorBeruntunRef.current += 1;
      }
    };

    rec.onend = () => {
      catatDbg('berakhir');
      recAktifRef.current = false;
      if (rec.__berhenti || muteRef.current || (pttRef.current && !pttAktifRef.current)) return;
      // mulai lagi (Chrome menutup sesi otomatis tiap beberapa menit); beri jeda jika error beruntun
      const jeda = Math.min(5000, 300 + errorBeruntunRef.current * 700);
      bolehMulaiRef.current = Math.max(bolehMulaiRef.current, Date.now() + jeda);
      setTimeout(() => {
        if (document.visibilityState !== 'visible') return; // tab latar tidak boleh merebut mic
        if (!rec.__berhenti && !muteRef.current && !recAktifRef.current && !(pttRef.current && !pttAktifRef.current)) { try { rec.start(); } catch { /* abaikan */ } }
      }, jeda);
    };

    rec.onaudiostart = () => catatDbg('audio masuk');
    rec.onspeechstart = () => { errorBeruntunRef.current = 0; setGalat(''); catatDbg('suara terdeteksi'); };
    rec.onstart = () => {
      catatDbg('mulai');
      mulaiSejakRef.current = Date.now();
      recAktifRef.current = true;
      if (!bicaraRef.current && !sedangMemprosesRef.current) {
        ubahStatus(aktifRef.current ? 'menunggu' : 'mendengar');
      }
    };

    recRef.current = rec;
    if (!muteRef.current && !pttRef.current) { try { rec.start(); } catch { /* abaikan */ } }
    // [BARU] Izin kamera diminta SEKARANG, bersamaan dengan munculnya izin mikrofon (rec.start di atas), supaya semua izin beres
    // di awal dan tidak ada dialog izin mendadak di tengah percakapan. Ditolak / tidak ada kamera -> Neo tetap jalan tanpa mengenali wajah.
    void mintaIzinKamera();

    return () => {
      if (w.__voiceAssistantPemilik === tokenInstance) w.__voiceAssistantPemilik = null;
      rec.__berhenti = true;
      try { rec.abort(); } catch { /* abaikan */ }
      abortRef.current?.abort();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (timerAktifRef.current) clearTimeout(timerAktifRef.current);
      if (komitTimerRef.current) clearTimeout(komitTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Penjaga (watchdog) ----------
  // Chrome kadang tidak memanggil onend setelah TTS, atau SpeechRecognition mati diam-diam.
  // [DIUBAH] Detak penjaga sekarang dari Web Worker, BUKAN setInterval di halaman: tab yang
  // di latar belakang di-throttle Chrome jadi ~1x/menit, sehingga antrean suara bisa macet
  // saat kamu pindah tab/aplikasi. Timer di dalam Worker tidak ikut di-throttle.
  useEffect(() => {
    const tick = () => {
      if (muteRef.current || recRef.current?.__berhenti) return;
      const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
      if (bicaraRef.current) {
        // browser kadang menjeda TTS sendiri saat halaman disembunyikan -> lanjutkan
        if (synth?.paused) { try { synth.resume(); } catch { /* abaikan */ } }
        const azureJalan = !azureMatiRef.current && (audioSedangRef.current || antrianSuaraRef.current > 0); // [BARU] audio server (/api/tts), bukan speechSynthesis
        const diam = !azureJalan && (synth ? !synth.speaking && !synth.pending : true);
        if (diam && Date.now() - bicaraSejakRef.current > 1500) akhiriBicara();
      }
      if (!recAktifRef.current) mulaiDengar(); // mic harus selalu menyala
    };

    let worker: Worker | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    try {
      const blob = new Blob(['setInterval(function(){postMessage(0)},800)'], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      worker.onmessage = tick;
      URL.revokeObjectURL(url);
    } catch {
      fallback = setInterval(tick, 800); // browser tanpa Worker: pakai cara lama
    }

    const saatTampil = () => {
      if (document.visibilityState === 'visible') { tick(); return; }
      // tab disembunyikan -> lepaskan mikrofon supaya tab lain (yang terlihat) bisa memakainya
      abortSengajaRef.current = true;
      try { recRef.current?.abort(); } catch { /* abaikan */ }
    };
    document.addEventListener('visibilitychange', saatTampil);
    window.addEventListener('focus', saatTampil);
    return () => {
      worker?.terminate();
      if (fallback) clearInterval(fallback);
      document.removeEventListener('visibilitychange', saatTampil);
      window.removeEventListener('focus', saatTampil);
    };
  }, [akhiriBicara, mulaiDengar]);

  // [DIHAPUS] Fitur "tahan hidup di latar belakang" (audio sunyi + stream mikrofon terbuka + wake lock)
  // dibuang karena merebut mikrofon dari SpeechRecognition. Asisten suara kini hanya mendengar di tab yang terlihat.

  // Browser (Chrome) memblokir suara otomatis sebelum ada interaksi apa pun dengan halaman.
  // Satu klik/tombol pertama "membuka kunci" suara supaya jawaban AI bisa terdengar.
  useEffect(() => {
    const buka = () => {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch { /* abaikan */ }
      window.removeEventListener('pointerdown', buka);
      window.removeEventListener('keydown', buka);
    };
    window.addEventListener('pointerdown', buka);
    window.addEventListener('keydown', buka);
    return () => {
      window.removeEventListener('pointerdown', buka);
      window.removeEventListener('keydown', buka);
    };
  }, []);

  // ---------- [DIUBAH] Pengenalan wajah awal + analisis latar belakang ----------
  // Alur sapaan: (1) Neo memperkenalkan diri, (2) sapaan hangat/lelucon: SELAGI itu kamera mengambil 1 foto di belakang,
  // (3) penutup "Ada yang bisa aku bantu, <nama>?" kalau wajah dikenali, atau "Ada yang bisa aku bantu?" kalau tidak.
  // Izin kamera diminta di awal bersamaan dengan izin mikrofon (mintaIzinKamera di init SpeechRecognition).
  // Foto HANYA diambil kalau akun ini sudah punya profil wajah di database (tanpa profil tidak ada yang dicocokkan, kamera tidak menyala).
  // Foto yang sama dikirim ke Claude untuk analisis penampilan hanya kalau wajah DIKENALI; yang tidak dikenali tidak dikirim ke mana pun.
  // Mendaftarkan wajah hanya lewat ucapan "aku mau kamu mengenali wajahku".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    profilWajahRef.current = (async () => {
      const st = await statusProfil(); // tanya database dulu; kamera TIDAK menyala kalau belum ada profil wajah
      try { if (st?.ada) localStorage.setItem(KUNCI_WAJAH_AKTIF, '1'); else localStorage.removeItem(KUNCI_WAJAH_AKTIF); } catch { /* abaikan */ }
      if (st?.ada) panaskanModel(); // muat model selagi menunggu izin & sapaan, supaya pengenalan nanti cepat
      return st;
    })().catch(() => null);
  }, []);
  pengenalanWajahRef.current = async () => {
    try {
      let st = await profilWajahRef.current;
      if (!st) st = await statusProfil(); // pertanyaan awal gagal (mis. login belum siap): tanya lagi sekarang
      if (!st?.ada) return null;
      panaskanModel();
      setKameraAktif(true);
      const hk = await ambilFotoKamera(1);
      setKameraAktif(false);
      if (!hk.ok) return null;
      const r = await kenaliWajah(hk.kanvas);
      if (!r.dikenali) return null;
      const waktuFoto = Date.now();
      void api.analisaWajah(hk.base64).then((t: string) => { if (t) analisaWajahRef.current = { teks: t, waktu: waktuFoto }; }); // latar belakang
      return { nama: r.nama };
    } catch {
      setKameraAktif(false);
      return null;
    }
  };
  daftarWajahRef.current = async () => {
    const setuju = window.confirm(
      'Daftarkan wajahmu supaya Neo bisa menyapa dengan nama?\n\n'
      + '• Yang disimpan di DATABASE hanya nama + angka ciri wajah (terenkripsi, BUKAN foto), khusus untuk akunmu. Berlaku di semua browser/perangkat tempat kamu login.\n'
      + '• Saat Neo menyapa, foto sesaat dikirim ke Claude untuk analisis penampilan, lalu dibuang (tidak disimpan).\n'
      + '• Hanya untuk menyapa, BUKAN untuk login.\n'
      + '• Hapus kapan saja dengan perintah "hapus data wajahku".'
    );
    if (!setuju) { ucapkanLokal(tx('Oke, wajahmu tidak jadi didaftarkan.', 'Okay, I will not register your face.')); return; }
    const nama = (window.prompt('Nama yang mau disebut Neo saat menyapa:', namaSapaRef.current || '') || '').trim();
    if (!nama) { ucapkanLokal(tx('Oke, dibatalkan karena namanya kosong.', 'Cancelled: the name was empty.')); return; }
    ucapkanLokal(tx('Hadap kamera dan diam sebentar ya.', 'Face the camera and hold still for a moment.'));
    setKameraAktif(true);
    const hk = await ambilFotoKamera(6, 450);
    setKameraAktif(false);
    if (!hk.ok) { ucapkanLokal(hk.pesan); return; }
    const h = await daftarkanWajah(nama, hk.frames);
    if (!h.ok) { ucapkanLokal(h.pesan); return; }
    try { localStorage.setItem(KUNCI_WAJAH_AKTIF, '1'); } catch { /* abaikan */ }
    catatAudit('wajah-didaftarkan', '');
    ucapkanLokal(tx(`Selesai. Mulai sekarang aku akan menyapamu, ${nama}.`, `Done. From now on I will greet you, ${nama}.`));
  };
  hapusWajahRef.current = async () => {
    const ok = await hapusProfil();
    if (!ok) { ucapkanLokal(tx('Maaf, data wajah gagal dihapus. Coba lagi sebentar.', 'Sorry, the face data could not be deleted. Please try again.')); return; }
    try { localStorage.removeItem(KUNCI_WAJAH_AKTIF); } catch { /* abaikan */ }
    analisaWajahRef.current = null;
    catatAudit('wajah-dihapus', '');
    ucapkanLokal(tx('Data wajahmu sudah dihapus dari database.', 'Your face data has been deleted from the database.'));
  };

  // ---------- Sapaan otomatis saat aplikasi dibuka ----------
  // Neo langsung memperkenalkan diri (sekali) + menyapa hangat, lalu mikrofon langsung siap menerima jawaban. Tanpa kata panggil.
  // Catatan browser: suara otomatis baru boleh diputar setelah ada satu klik/ketukan di halaman ini
  // (aturan Chrome). Habis login sudah ada klik, jadi langsung bicara; kalau halaman di-refresh,
  // sapaan menunggu klik/tombol pertama.
  const sudahSapaRef = useRef(false);
  const sapaanAwalRef = useRef<{ perkenalan: string; hangat: string } | null>(null);
  // [BARU] Begitu nama user selesai dimuat, teks sapaan dibuat dan audio kalimat pertamanya langsung diminta ke Gemini,
  // jadi saat sapaan benar-benar diucapkan (menunggu mic/klik) audionya sudah siap.
  useEffect(() => {
    if (authMemuat || sudahSapaRef.current || sapaanAwalRef.current || pttRef.current) return;
    if (typeof window === 'undefined') return;
    sapaanAwalRef.current = buatSapaanAwal();
    // Perkenalan & sapaan tidak bergantung pada wajah (nama baru disebut di penutup), jadi audio kalimat pertamanya aman disiapkan sekarang.
    siapkanSuara(sapaanAwalRef.current.perkenalan || sapaanAwalRef.current.hangat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMemuat]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const sapa = () => {
      if (sudahSapaRef.current) return;
      if (authMemuatRef.current) return; // [BARU] tunggu nama user selesai dimuat (dicoba lagi oleh interval di bawah)
      if (pttRef.current) { sudahSapaRef.current = true; return; } // [BARU] mode tekan-untuk-bicara: tidak menyapa otomatis
      if (!recRef.current || muteRef.current || document.visibilityState !== 'visible') return;
      sudahSapaRef.current = true;
      aktifRef.current = true; // langsung mode ngobrol: tanpa kata panggil
      bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS);
      const awal = sapaanAwalRef.current || buatSapaanAwal();
      const gen = genSuaraRef.current;
      // Kamera + pengenalan wajah jalan di LATAR BELAKANG selagi Neo memperkenalkan diri lalu menyapa hangat.
      const pengenal = pengenalanWajahRef.current();
      if (awal.perkenalan) ucapkan(awal.perkenalan);
      ucapkan(awal.hangat);
      // Penutup diucapkan setelah dua bagian di atas (antrean suara berurutan): wajah dikenali -> sebut nama; tidak -> tanpa nama.
      // Hasil pengenalan ditunggu maksimal 8 dtk; kalau pengguna sudah menyela (gen berubah), penutup dibatalkan.
      void Promise.race([pengenal, new Promise<null>((r) => setTimeout(() => r(null), 8000))]).then((h) => {
        if (gen !== genSuaraRef.current) return;
        ucapkan(h?.nama ? `Ada yang bisa aku bantu, ${h.nama}?` : 'Ada yang bisa aku bantu?');
      });
    };
    let tunggu: ReturnType<typeof setTimeout> | null = null;
    let pasangKlik = false;
    const bersihkan = () => {
      window.removeEventListener('pointerdown', saatInteraksi);
      window.removeEventListener('keydown', saatInteraksi);
    };
    function saatInteraksi() { bersihkan(); tunggu = setTimeout(sapa, 400); }
    // Tunggu sampai mikrofon benar-benar menyala (artinya izin sudah diberikan), baru Neo menyapa sendiri.
    const mulaiCek = Date.now();
    const cek = setInterval(() => {
      if (sudahSapaRef.current || Date.now() - mulaiCek > 60000) { clearInterval(cek); return; } // menyerah setelah 60 detik
      if (statusRef.current === 'izin-ditolak' || statusRef.current === 'tidak-didukung') { clearInterval(cek); return; }
      if (!recAktifRef.current) return; // izin mic belum diberikan / mic belum jalan
      if ((navigator as any).userActivation?.hasBeenActive) { sapa(); return; } // belum bisa (mis. tab tersembunyi / mic dibisukan) -> dicoba lagi
      // Aturan Chrome: suara otomatis baru boleh setelah ada satu klik/ketukan di halaman -> sapaan menunggu itu.
      if (!pasangKlik) {
        pasangKlik = true;
        window.addEventListener('pointerdown', saatInteraksi);
        window.addEventListener('keydown', saatInteraksi);
      }
    }, 500);
    return () => { clearInterval(cek); if (tunggu) clearTimeout(tunggu); bersihkan(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Nyalakan / matikan sistem LEWAT SUARA (tombolnya sudah dihapus) ----------
  // "matikan sistem": Neo berkata "sistem telah dimatikan" dulu, baru berhenti menjawab. Mic tetap mendengar,
  // tapi hanya untuk perintah "nyalakan sistem". "nyalakan sistem": menyala lagi + "sistem telah dinyalakan".
  selesaikanMatiRef.current = () => {
    if (!akanMatiRef.current) return;
    akanMatiRef.current = false;
    if (timerMatiRef.current) { clearTimeout(timerMatiRef.current); timerMatiRef.current = null; }
    sistemMatiRef.current = true;
    setSistemMati(true);
    hentikanJawaban();
    bufUcapanRef.current = '';
    sementaraUcapanRef.current = '';
    ubahStatus('mati');
  };
  matikanSistemRef.current = () => {
    catatAudit('sistem', 'mati');
    hentikanJawaban();
    if (komitTimerRef.current) { clearTimeout(komitTimerRef.current); komitTimerRef.current = null; }
    bufUcapanRef.current = '';
    sementaraUcapanRef.current = '';
    if (konfirmasiRef.current) { clearTimeout(konfirmasiRef.current.timer); konfirmasiRef.current = null; }
    akanMatiRef.current = true;
    ucapkan(tx('Sistem telah dimatikan.', 'The system has been turned off.'));
    // cadangan: kalau suara gagal diputar, tetap mati
    if (timerMatiRef.current) clearTimeout(timerMatiRef.current);
    timerMatiRef.current = setTimeout(() => selesaikanMatiRef.current(), 8000);
  };
  nyalakanSistemRef.current = () => {
    catatAudit('sistem', 'nyala');
    sistemMatiRef.current = false;
    setSistemMati(false);
    errorBeruntunRef.current = 0;
    bolehMulaiRef.current = 0;
    aktivitasTerakhirRef.current = Date.now();
    setGalat('');
    bufUcapanRef.current = '';
    sementaraUcapanRef.current = '';
    aktifRef.current = true;
    bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS);
    ubahStatus('mendengar');
    mulaiDengar();
    ucapkan(tx('Sistem telah dinyalakan.', 'The system has been turned on.'));
  };

  if (status === 'tidak-didukung') return null;

  const label: Record<Status, string> = {
    'tidak-didukung': '',
    mati: 'Suara dimatikan',
    mendengar: 'Neo mendengarkan…',
    menunggu: 'Silakan bicara…',
    berpikir: 'Memikirkan jawaban…',
    bicara: 'Sedang menjawab…',
    'izin-ditolak': 'Izin mikrofon belum nyala',
  };

  const L = (id: string, en: string) => (bahasaTampil === 'en' ? en : id);
  // [BARU] Garis tengah layar (tak terlihat, hanya batas logika): robot di sisi kanan -> balon pindah ke kiri atas robot (cermin); sisi kiri -> kanan atas.
  const diKanan = !!posRobot && typeof window !== 'undefined' && posRobot.x + 56 > window.innerWidth / 2;
  const modeRobot: NeoMode =
    sistemMati || status === 'mati' || status === 'izin-ditolak'
      ? 'off'
      : status === 'berpikir'
      ? 'think'
      : status === 'bicara'
      ? 'speak'
      : 'listen';

  // Balon ucapan: di kanan atas robot, hanya ekornya yang runcing (ala komik) dan menunjuk ke kepala robot.
  return (
    <>
    <AnginRobot gerak={gerakRef} robotRef={robotRef} aktif={menyeret} />
    <div
      data-voice-ignore
      ref={robotRef}
      className={`fixed z-50 max-w-[calc(100vw-2rem)] select-none ${posRobot ? '' : 'bottom-4 left-4'}`}
      style={{
        ...(posRobot ? { left: posRobot.x, top: posRobot.y } : {}),
        touchAction: 'none',
        cursor: menyeret ? 'grabbing' : 'grab',
      }}
      onPointerDown={mulaiSeret}
      onPointerMove={geserSeret}
      onPointerUp={selesaiSeret}
      onPointerCancel={selesaiSeret}
      onDoubleClick={resetPosisi}
      title={L('Tarik untuk memindahkan · klik dua kali untuk kembali', 'Drag to move · double-click to reset')}
    >
      <div className="relative">
        <NeoRobot mode={modeRobot} gerak={gerakRef} menyeret={menyeret} className="pointer-events-none h-24 w-28 shrink-0 drop-shadow-md" />
        <div
          className={`absolute bottom-[84px] ${diKanan ? 'right-[76px]' : 'left-[76px]'} w-max max-w-[min(260px,calc(100vw-8rem))] rounded-3xl bg-card px-4 py-2 text-sm shadow-md`}
          style={{ border: `1.5px solid ${GARIS_BALON}` }}
          aria-live="polite"
        >
          <span className="block text-foreground">
            {sistemMati ? L('Sistem sedang mati…', 'System is off…') : kameraAktif ? L('Kamera aktif, melihat sebentar…', 'Camera on, taking a look…') : label[status]}
          </span>
          {!sistemMati && teksTerakhir && !galat && (
            <span className="block truncate text-xs text-muted-foreground" title={teksTerakhir}>Terdengar: {teksTerakhir}</span>
          )}
          {galat && <span className="block truncate text-xs text-red-500" title={galat}>{galat}</span>}
          {dbgAktif && dbg && <span className="block truncate text-[10px] text-muted-foreground" title={dbg}>mic: {dbg}</span>}
          {/* ekor runcing: ujungnya menunjuk ke kepala robot */}
          <svg
            width="26"
            height="20"
            viewBox="0 -1.5 26 21.5"
            className={`pointer-events-none absolute top-[calc(100%-1.5px)] ${diKanan ? 'right-[18px]' : 'left-[18px]'}`}
            style={diKanan ? { transform: 'scaleX(-1)' } : undefined}
            aria-hidden="true"
          >
            <polygon points="8,-1.5 24,-1.5 0,20" style={{ fill: 'var(--card)' }} />
            <polyline points="8,-1.5 0,20 24,-1.5" fill="none" strokeWidth="1.5" strokeLinejoin="miter" style={{ stroke: GARIS_BALON }} />
          </svg>
        </div>
      </div>
    </div>
    </>
  );
}