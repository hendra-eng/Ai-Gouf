// sapaanAgen.contoh.ts
// Skenario sapaan pengguna di halaman Agentic AI, dari bahasa kaku sampai obrolan natural.
// Format: [ucapan, siapa yang menjawab, gaya, basa-basi]. Dipakai sapaanAgen.uji.ts.
// Ini CONTOH untuk menguji pemahaman, bukan daftar yang dihafal: parser menguraikan peran kata, jadi
// kalimat baru yang tersusun dari bagian yang sama ikut dipahami. Tambah kalimat yang belum dikenali di sini.

import type { AgenSuara, BasaBasi, Gaya } from './sapaanAgen';

export type ContohSapaan = [ucapan: string, kepada: AgenSuara[], gaya: Gaya, basa: BasaBasi];

const SEMUA: AgenSuara[] = ['neo', 'atlas', 'zeno'];

// ---------- Sapaan ke SEMUA (ketiga AI menjawab bergantian: Neo, Atlas, Zeno) ----------
export const CONTOH_SEMUA: Record<string, ContohSapaan[]> = {
  'kaku / formal': [
    ['Selamat pagi, semuanya', SEMUA, 'formal', null],
    ['Selamat siang kepada seluruh tim', SEMUA, 'formal', null],
    ['Selamat sore rekan-rekan sekalian', SEMUA, 'formal', null],
    ['Assalamualaikum semuanya', SEMUA, 'formal', null],
    ['Assalamualaikum warahmatullahi wabarakatuh teman-teman', SEMUA, 'formal', null],
    ['Selamat malam semua, bagaimana kabar kalian', SEMUA, 'formal', 'kabar'],
    ['Permisi semuanya', SEMUA, 'formal', null],
    ['Salam sejahtera untuk kalian bertiga', SEMUA, 'formal', null],
    ['Good morning everyone', SEMUA, 'formal', null],
    ['Good afternoon team, how are you', SEMUA, 'formal', 'kabar'],
  ],
  'netral / sehari-hari': [
    ['Halo semuanya', SEMUA, 'netral', null],
    ['Halo semua', SEMUA, 'netral', null],
    ['Hai kalian bertiga', SEMUA, 'netral', null],
    ['Halo tim, apa kabar', SEMUA, 'netral', 'kabar'],
    ['Hai semuanya apa kabar hari ini', SEMUA, 'netral', 'kabar'],
    ['Halo teman-teman, kalian sehat', SEMUA, 'netral', 'kabar'],
    ['Pagi semuanya', SEMUA, 'netral', null],
    ['Hello everyone', SEMUA, 'netral', null],
    ['Hi team, how are you doing', SEMUA, 'netral', 'kabar'],
    ['Halo semuanya lagi ngapain', SEMUA, 'santai', 'aktivitas'],
  ],
  'santai / gaul': [
    ['Woi semuanya', SEMUA, 'santai', null],
    ['Halo gaes', SEMUA, 'santai', null],
    ['Yo guys', SEMUA, 'santai', null],
    ['Halo guys, apa kabar nih', SEMUA, 'santai', 'kabar'],
    ['Hai semuanya, pada lagi ngapain nih', SEMUA, 'santai', 'aktivitas'],
    ['Haloooo semuanyaaa', SEMUA, 'netral', null],
    ['Hey guys what is up', SEMUA, 'santai', 'kabar'],
    ['Woy gimana kabarnya kalian', SEMUA, 'santai', 'kabar'],
    ['Halo semua udah pada makan belum', SEMUA, 'netral', 'makan'],
  ],
  'banyak ragam lain': [
    ['Hai semuanya', SEMUA, 'netral', null],
    ['Pagi semuanya', SEMUA, 'netral', null],
    ['Apa kabar semuanya', SEMUA, 'netral', 'kabar'],
    ['Siang semuanya', SEMUA, 'netral', null],
    ['Sore semuanya', SEMUA, 'netral', null],
    ['Malam semuanya', SEMUA, 'netral', null],
    ['Selamat pagi semuanya', SEMUA, 'formal', null],
    ['Selamat malam semuanya', SEMUA, 'formal', null],
    ['Hai semua apa kabar', SEMUA, 'netral', 'kabar'],
    ['Halo semuanya gimana kabarnya', SEMUA, 'netral', 'kabar'],
    ['Hai hai semuanya', SEMUA, 'netral', null],
    ['Hei semuanya', SEMUA, 'netral', null],
    ['Hei kalian apa kabar', SEMUA, 'netral', 'kabar'],
    ['Halo kalian semua', SEMUA, 'netral', null],
    ['Hai tim', SEMUA, 'netral', null],
    ['Apa kabar tim', SEMUA, 'netral', 'kabar'],
    ['Apa kabar kalian semua', SEMUA, 'netral', 'kabar'],
    ['Apa kabar teman-teman', SEMUA, 'netral', 'kabar'],
    ['Halo semuanya sehat', SEMUA, 'netral', 'kabar'],
    ['Yo semuanya', SEMUA, 'santai', null],
    ['Woi kalian', SEMUA, 'santai', null],
    ['Halo semuanya lagi sibuk apa', SEMUA, 'santai', 'aktivitas'],
    ['Hai semuanya sudah sarapan belum', SEMUA, 'netral', 'makan'],
    ['Hello all', SEMUA, 'netral', null],
    ['Hey everyone how are you', SEMUA, 'netral', 'kabar'],
    ['Good evening everyone', SEMUA, 'formal', null],
    ['Assalamualaikum kalian semua', SEMUA, 'formal', null],
    ['Selamat siang rekan-rekan', SEMUA, 'formal', null],
  ],
};

// ---------- Sapaan ke SATU agen (hanya agen itu yang menjawab) ----------
export const CONTOH_SATU: Record<string, ContohSapaan[]> = {
  Neo: [
    ['Halo Neo', ['neo'], 'netral', null],
    ['Halo Neo apa kabar', ['neo'], 'netral', 'kabar'],
    ['Selamat pagi Neo', ['neo'], 'formal', null],
    ['Selamat siang, Neo. Bagaimana kabar Anda', ['neo'], 'formal', 'kabar'],
    ['Assalamualaikum Neo', ['neo'], 'formal', null],
    ['Hai Neo lagi apa', ['neo'], 'santai', 'aktivitas'],
    ['Neo, halo', ['neo'], 'netral', null],
    ['Woi Neo', ['neo'], 'santai', null],
    ['Hello Neo how are you', ['neo'], 'netral', 'kabar'],
    ['Halo nio apa kabar', ['neo'], 'netral', 'kabar'], // salah dengar "Neo"
  ],
  Atlas: [
    ['Halo Atlas', ['atlas'], 'netral', null],
    ['Selamat sore Atlas, apa kabar', ['atlas'], 'formal', 'kabar'],
    ['Hai Atlas gimana kabarnya', ['atlas'], 'netral', 'kabar'],
    ['Atlas, selamat pagi', ['atlas'], 'formal', null],
    ['Yo Atlas', ['atlas'], 'santai', null],
    ['Halo atles apa kabar', ['atlas'], 'netral', 'kabar'], // salah dengar
  ],
  Zeno: [
    ['Halo Zeno', ['zeno'], 'netral', null],
    ['Selamat malam Zeno', ['zeno'], 'formal', null],
    ['Hai Zeno lagi ngapain nih', ['zeno'], 'santai', 'aktivitas'],
    ['Zeno, apa kabar', ['zeno'], 'netral', 'kabar'],
    ['Halo jeno apa kabar', ['zeno'], 'netral', 'kabar'], // salah dengar
    ['Halo xeno', ['zeno'], 'netral', null], // salah dengar
  ],
  'dua agen sekaligus': [
    ['Halo Neo dan Atlas', ['neo', 'atlas'], 'netral', null],
    ['Selamat pagi Atlas, Zeno', ['atlas', 'zeno'], 'formal', null],
    ['Hai Neo Zeno apa kabar', ['neo', 'zeno'], 'netral', 'kabar'],
  ],
};

// ---------- Hanya MEMANGGIL nama (agen menjawab "iya, ada yang bisa dibantu?") ----------
export const CONTOH_PANGGIL: [string, AgenSuara[]][] = [
  ['Neo', ['neo']],
  ['Atlas', ['atlas']],
  ['Zeno', ['zeno']],
  ['Neo?', ['neo']],
  ['Hei Zeno', ['zeno']].slice(0, 0) as never, // (hei + nama = sapaan, bukan panggil; ada di CONTOH_SATU)
  ['Neo dong', ['neo']],
  ['Atlas sini', ['atlas']],
  ['Eh Zeno', ['zeno']],
  ['Neo dan Atlas', ['neo', 'atlas']],
  ['Kalian', ['neo', 'atlas', 'zeno']],
  ['Guys', ['neo', 'atlas', 'zeno']],
  ['Nio', ['neo']], // salah dengar
  ['Atles', ['atlas']], // salah dengar
].filter((x) => (x as unknown[]).length === 2) as [string, AgenSuara[]][];

// ---------- Sapaan TANPA menyebut siapa (kepada = kosong -> penutur terakhir / Neo yang menjawab) ----------
export const CONTOH_TANPA_NAMA: ContohSapaan[] = [
  ['Halo', [], 'netral', null],
  ['Hai, apa kabar', [], 'netral', 'kabar'],
  ['Selamat pagi', [], 'formal', null],
  ['Pagi', [], 'netral', null],
  ['Assalamualaikum', [], 'formal', null],
  ['Hello, how are you', [], 'netral', 'kabar'],
];

// ---------- Cek kehadiran (jenis cek_hadir) ----------
export const CONTOH_CEK_HADIR: [string, AgenSuara[]][] = [
  ['Kalian dengar aku nggak', SEMUA],
  ['Atlas, apa kamu mendengarku', ['atlas']],
  ['Zeno kamu masih di sini', ['zeno']],
  ['Neo, are you there', ['neo']],
  ['Can you hear me everyone', SEMUA],
  ['Semuanya ada di sini', SEMUA],
];

// ---------- BUKAN sapaan murni: harus lewat alur lama (tugas / AI), jangan dibalas sapaan ----------
export const CONTOH_BUKAN_SAPAAN: string[] = [
  'Atlas cek halaman sales',
  'Halo Atlas tolong cek halaman sales',
  'Halo semuanya, kita meeting sekarang',
  'Neo buka laporan laba rugi',
  'Zeno cek halaman purchase',
  'Berapa total penjualan bulan ini',
  'Pagi ini laporan apa saja yang belum selesai',
  'Selamat ya, laporannya sudah beres',
  'Halo Neo, upload file penjualan klien SAU',
  'Ayo kita meeting',
  'Semuanya',
  'Semua',
  'Sales',
  'Iya semuanya',
  'Semua laporan sudah diposting',
  'Selamat datang di halaman sales, apa isinya',
  'Hari ini ada invoice yang ditahan nggak',
];
