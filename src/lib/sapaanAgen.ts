// sapaanAgen.ts
// ==============
// Sapaan di halaman Agentic AI: Neo / Atlas / Zeno MEMAHAMI sapaan, bukan menghafal kalimat.
//
//   Lapis 1  bacaSapaan()      parser lokal (instan, gratis). Ucapan diurai per KATA menurut PERANNYA:
//                              pembuka (halo, selamat pagi, assalamualaikum, yo ...), nama agen (toleran salah dengar),
//                              kata sapa kelompok (semuanya, kalian, tim, guys ...), basa-basi (apa kabar, lagi apa ...),
//                              cek kehadiran (dengar aku nggak?). Kalimat baru yang tersusun dari bagian-bagian itu
//                              langsung dipahami tanpa didaftarkan satu per satu.
//   Lapis 2  sapaanCerdas.ts   kalau lapis 1 ragu, AI memahami maksudnya (POST /api/voice/sapaan-intent).
//
// Hanya SAPAAN MURNI yang ditangani di sini. Sapaan + permintaan kerja ("halo atlas cek halaman sales") tetap
// dikerjakan alur lama (tugas/AI), jadi tidak ada perilaku lama yang berubah.
//
// Balasan disusun dari potongan (pembuka + perkenalan + jawaban basa-basi + penutup) menurut GAYA pengguna
// (formal / netral / santai), kepribadian tiap agen, dan jam, bukan satu kalimat tetap.
// Contoh & uji: sapaanAgen.contoh.ts + sapaanAgen.uji.ts  (npx tsx src/lib/sapaanAgen.uji.ts)

export type AgenSuara = 'neo' | 'atlas' | 'zeno';
export type Gaya = 'formal' | 'netral' | 'santai';
export type JenisSapaan = 'sapaan' | 'cek_hadir' | 'panggil'; // panggil = hanya menyebut nama ("Neo", "Atlas?", "hei kalian")
export type BasaBasi = 'kabar' | 'aktivitas' | 'makan' | null;
export type Waktu = 'pagi' | 'siang' | 'sore' | 'malam';

export type HasilSapaan = {
  jenis: JenisSapaan;
  kepada: AgenSuara[]; // urut Neo, Atlas, Zeno. KOSONG = tidak menyebut siapa-siapa (penutur terakhir / Neo yang menjawab)
  gaya: Gaya;
  basa: BasaBasi;
  waktu: Waktu | null; // kata waktu yang DIUCAPKAN pengguna ("selamat siang" -> siang)
  islam: boolean; // salam islam -> dijawab "Waalaikumsalam"
  yakin: number; // 0..1
};

export const URUTAN_AGEN: AgenSuara[] = ['neo', 'atlas', 'zeno'];
const NAMA_TAMPIL: Record<AgenSuara, string> = { neo: 'Neo', atlas: 'Atlas', zeno: 'Zeno' };

// ---------------------------------------------------------------------------------------------
// Pembersihan & penyiapan teks
// ---------------------------------------------------------------------------------------------
const rapikan = (t: string): string =>
  (t || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[.,!?;:"“”()\[\]{}…]/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1') // "halooooo" -> "haloo"
    .replace(/\s+/g, ' ')
    .trim();

const WAKTU_KATA: Record<string, Waktu> = {
  pagi: 'pagi', morning: 'pagi', enjang: 'pagi', enjing: 'pagi',
  siang: 'siang', afternoon: 'siang',
  sore: 'sore', petang: 'sore', evening: 'sore', sonten: 'sore',
  malam: 'malam', dalu: 'malam', wengi: 'malam',
};

/**
 * Frasa multi-kata diganti satu tanda (token "§...") supaya bisa diurai per peran.
 * Ini POLA bentuk kata (akar + imbuhan + variasi), bukan daftar kalimat utuh.
 */
function siapkan(t: string): string {
  let s = ' ' + rapikan(t) + ' ';
  const ganti = (re: RegExp, token: string | ((m: string, ...g: string[]) => string)) => {
    s = s.replace(re, (m: string, ...g: string[]) => ' ' + (typeof token === 'function' ? token(m, ...g) : token) + ' ');
  };
  // nama yang terpotong STT ("ne o", "ze no")
  s = s.replace(/\bne\s+o\b/g, ' neo ').replace(/\bni\s+o\b/g, ' neo ').replace(/\bze\s+no\b/g, ' zeno ').replace(/\bat\s+las\b/g, ' atlas ');

  // salam islam (assalamualaikum, assalamu alaikum wr wb, ...)
  ganti(/\bas+alamu?\s?alaiku?m?\b(?:\s+warahmatullahi\s+wabarakatuh|\s+wr\s+wb)?/g, '§isl');
  // selamat + waktu (juga "met pagi", "good morning", bahasa daerah)
  ganti(/\b(?:selamat|met|slmt)\s+(pagi|siang|sore|petang|malam)\b/g, (_m, w) => '§slm' + WAKTU_KATA[w]);
  ganti(/\bgood\s+(morning|afternoon|evening)\b/g, (_m, w) => '§slm' + WAKTU_KATA[w]);
  ganti(/\b(?:sugeng|wilujeng|rahajeng)\s+(enjang|enjing|siang|sonten|dalu|sore|wengi)\b/g, (_m, w) => '§slm' + WAKTU_KATA[w]);
  ganti(/\bselamat\s+datang\b|\bwelcome\b/g, '§dtg');

  // basa-basi: kabar
  ganti(/\b(?:apa|gimana|bagaimana|gmn|gimna|piye|kumaha)\s+(?:kabar\w*|damang|keadaan\w*)\b/g, '§kb');
  ganti(/\bhow\s+(?:are|r)\s+(?:you|u|ya|things|everyone|everybody|all|y\s?all)(?:\s+doing)?\b|\bhows?\s+(?:it\s+going|everything|life|your\s+day|things)\b|\bhow\s+is\s+(?:it\s+going|everything|life)\b|\bhow\s+have\s+you\s+been\b/g, '§kb');
  ganti(/\bwhat\s*(?:s|is)?\s+up\b|\bwass?up\b|\bwazz?up\b/g, '§kb');
  ganti(/\b(?:gimana|bagaimana)\s+(?:hari|harimu|harinya)(?:\s+ini)?\b/g, '§kb');
  ganti(/\bkabar\w*\b|\bsehat(?:\s*sehat)?\b|\bbaik[\s-]*baik\b/g, '§kb');
  // basa-basi: aktivitas & makan
  ganti(/\b(?:pada\s+)?(?:lagi|lg|sedang)\s+(?:pada\s+)?(?:apa|ngapain|sibuk|ngerjain\s+apa|kerja\s+apa)(?:\s+aja)?\b|\bpada\s+(?:ngapain|sibuk)\b|\bwhat\s+(?:are|r)\s+(?:you|u)\s+(?:doing|up\s+to)\b/g, '§ak');
  ganti(/\b(?:sudah|udah|dah|belum|blm)\s+(?:pada\s+)?(?:makan|sarapan|ngopi|minum\s+kopi)(?:\s+(?:belum|blm|nggak|ga|gak))?\b/g, '§mk');
  // cek kehadiran
  ganti(/\b(?:dengar|denger|mendengar|mendengarkan|dengerin|nyimak|menyimak)(?:\s*(?:aku|saya|gue|gw|ku|suaraku))?\b|\bada\s+(?:di\s*sini|di\s*situ|orang)\b|\bmasih\s+(?:di\s*sini|di\s*sana|di\s*situ|hidup|bangun|online|ada|nyala|aktif)\b|\b(?:are|r)\s+(?:you|u)\s+(?:there|here|online|awake|listening)\b|\bcan\s+you\s+hear\s+me\b|\banyone\s+(?:here|there|home)\b/g, '§hd');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// Peran kata
// ---------------------------------------------------------------------------------------------
const OPENER = /^(?:ha+l+o+|hal+o+|ha+i+|he+i+|he+y+|hi+|hel+o+|yo+|wo+i+|wo+y+|oi+|oy|ey|permisi|punten|misi|salam|shalom|hola|ciao|greetings|pagi|siang|sore|malam|petang|§slm\w+|§isl|§dtg)$/;
const GRUP = /^(?:semua\w*|kalian|tim|team|temen\S*|teman\S*|rekan\S*|gaes+|gais+|guys|geng|squad|crew|everyone|everybody|folks|all|seluruh|sekalian|bertiga|agen\S*|sobat\w*|kawan\w*|anak\S*)$/;
const GRUP_KUAT = /^(?:kalian|tim|team|temen\S*|teman\S*|rekan\S*|gaes+|gais+|guys|geng|squad|crew|everyone|everybody|folks|bertiga|sobat\w*|kawan\w*)$/;
const ISI = /^(?:eh+|ehm|em|oke|ok|okay|nah|dong|deh|nih|tuh|sih|ya+|yah|lah|kok|bro|sis|bang|abang|kak|kakak|mas|mbak|mba|pak|bu|ibu|bapak|boss|bos|gan|dear|para|dan|and|ke|buat|untuk|kepada|yth|apa|kamu|kau|anda|lu|lo|elu|you|your|u|ini|hari|today|there|di|sana|sini|nya|ku|mu|nggak|ga|gak|tidak|kan|kah|aja|saja|oh|ah|hmm|hm|wah|aduh|sayang|sejahtera|pagi\S*)$/;
const NAMA: Record<AgenSuara, RegExp> = {
  neo: /^(?:ne+o+|nio+|neyo|neu|neon)$/,
  atlas: /^(?:atl[ae]s+|atlus|etlas|atlast|atlaz|adlas)$/,
  zeno: /^(?:z[ei]n+o+|jeno+|xeno+|zenor|zenu|seno)$/,
};
const SANTAI = new Set(['woi', 'woy', 'oi', 'yo', 'bro', 'sis', 'gaes', 'gais', 'guys', 'dong', 'deh', 'nih', 'tuh', 'sih', 'lu', 'lo', 'elu', 'gue', 'gw', '§ak']);
const FORMAL = new Set(['pak', 'bu', 'ibu', 'bapak', 'anda', 'yth', 'kepada', 'dear', 'permisi', 'punten', 'salam', 'greetings', '§isl', '§dtg']);

function editSatu(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let beda = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++beda > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return beda + (a.length - i) + (b.length - j) <= 1;
}

function agenDariKata(k: string): AgenSuara | null {
  for (const a of URUTAN_AGEN) if (NAMA[a].test(k)) return a;
  if (k.length >= 4) {
    if (editSatu(k, 'atlas')) return 'atlas';
    if (editSatu(k, 'zeno')) return 'zeno';
  }
  return null;
}

export type Urai = {
  kata: string[];
  pembuka: boolean;
  basa: BasaBasi;
  hadir: boolean;
  grup: boolean;
  grupKuat: boolean; // kata sapa kelompok yang jelas memanggil (kalian, tim, guys...), bukan "semua" yang bisa jadi jawaban biasa
  nama: AgenSuara[];
  islam: boolean;
  waktu: Waktu | null;
  gaya: Gaya;
  konten: string[]; // kata yang BUKAN bagian sapaan (kalau ada, ini bukan sapaan murni)
};

/** Urai ucapan menjadi peran-peran kata. Dipakai juga oleh gerbang AI. */
export function uraiSapaan(teks: string): Urai {
  const kata = siapkan(teks).split(' ').filter(Boolean);
  const u: Urai = { kata, pembuka: false, basa: null, hadir: false, grup: false, grupKuat: false, nama: [], islam: false, waktu: null, gaya: 'netral', konten: [] };
  let santai = 0;
  let formal = 0;
  for (const k of kata) {
    if (SANTAI.has(k)) santai++;
    if (FORMAL.has(k) || k.startsWith('§slm')) formal++;
    if (k.startsWith('§slm')) u.waktu = k.slice(4) as Waktu;
    if (k === '§isl') u.islam = true;
    if (WAKTU_KATA[k] && !u.waktu) u.waktu = WAKTU_KATA[k];
    if (k === '§kb') { u.basa = u.basa ?? 'kabar'; continue; }
    if (k === '§ak') { u.basa = u.basa ?? 'aktivitas'; continue; }
    if (k === '§mk') { u.basa = u.basa ?? 'makan'; continue; }
    if (k === '§hd') { u.hadir = true; continue; }
    if (OPENER.test(k)) { u.pembuka = true; continue; }
    const a = agenDariKata(k);
    if (a) { if (!u.nama.includes(a)) u.nama.push(a); continue; }
    if (GRUP.test(k)) { u.grup = true; if (GRUP_KUAT.test(k)) u.grupKuat = true; continue; }
    if (ISI.test(k)) continue;
    u.konten.push(k);
  }
  u.gaya = formal > 0 && santai === 0 ? 'formal' : santai > 0 && formal === 0 ? 'santai' : 'netral';
  return u;
}

/**
 * Lapis 1. Kembalikan HasilSapaan kalau ucapan ini SAPAAN MURNI (atau cek kehadiran), selain itu null.
 * Sapaan yang disertai permintaan/pertanyaan lain (ada kata "isi") bukan sapaan murni -> null (alur lama).
 */
export function bacaSapaan(teks: string): HasilSapaan | null {
  const u = uraiSapaan(teks);
  if (u.kata.length === 0 || u.kata.length > 14) return null;
  if (u.konten.length > 0) return null;
  const sapaan = u.pembuka || u.basa !== null;
  if (!sapaan && !u.hadir) {
    // hanya memanggil: nama agen ("Neo", "Atlas?") atau kata sapa kelompok yang jelas ("kalian", "guys") -> agen menjawab "ya, ada yang bisa dibantu?"
    // "semua" / "semuanya" sendirian TIDAK dihitung (bisa jawaban biasa: "sales atau purchase?" -> "semuanya").
    if (u.kata.length > 5 || (u.nama.length === 0 && !u.grupKuat)) return null;
    return { jenis: 'panggil', kepada: u.grupKuat ? [...URUTAN_AGEN] : URUTAN_AGEN.filter((a) => u.nama.includes(a)), gaya: u.gaya, basa: null, waktu: null, islam: false, yakin: 1 };
  }
  const kepada = u.grup ? [...URUTAN_AGEN] : URUTAN_AGEN.filter((a) => u.nama.includes(a));
  return {
    jenis: sapaan ? 'sapaan' : 'cek_hadir',
    kepada,
    gaya: u.gaya,
    basa: u.basa,
    waktu: u.waktu,
    islam: u.islam,
    yakin: 1,
  };
}

/** Apakah ucapan ini layak ditanyakan ke AI (lapis 2)? Murah: hanya ucapan pendek yang menyebut agen / kelompok / pembuka. */
export function layakTanyaSapaanAi(teks: string): boolean {
  const u = uraiSapaan(teks);
  if (u.kata.length === 0 || u.kata.length > 8) return false;
  if (/\d/.test(teks)) return false;
  return u.nama.length > 0 || u.grup || u.pembuka || u.hadir;
}

// ---------------------------------------------------------------------------------------------
// Penyusun balasan
// ---------------------------------------------------------------------------------------------
export function waktuDariJam(jam: number): Waktu {
  if (jam >= 4 && jam < 11) return 'pagi';
  if (jam >= 11 && jam < 15) return 'siang';
  if (jam >= 15 && jam < 18) return 'sore';
  return 'malam';
}

type Opsi = { bahasa: 'id' | 'en'; jam: number; acak?: () => number };
type PerAgen = Record<AgenSuara, string[]>;
type PerGaya<T> = { formal: T; netral: T; santai: T };

// Ingat pilihan terakhir tiap slot supaya agen tidak mengulang kalimat yang sama berturut-turut.
const terakhir = new Map<string, string>();
function pilihBeda(slot: string, daftar: string[], acak: () => number): string {
  const ada = daftar.filter((d) => d !== terakhir.get(slot));
  const sumber = ada.length ? ada : daftar;
  const hasil = sumber[Math.min(sumber.length - 1, Math.floor(acak() * sumber.length))];
  terakhir.set(slot, hasil);
  return hasil;
}
const kapital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// Setiap slot punya BANYAK variasi per agen dan per gaya; kepribadian: Neo tegas-hangat (manager), Atlas tenang-teliti, Zeno ceria-sigap.
const ID = {
  // pembuka tanpa kata waktu ({w} = pagi/siang/sore/malam yang diucapkan pengguna; hanya dipakai bila ada)
  buka: {
    formal: { neo: ['{S}.', '{S}, senang bertemu lagi.', '{S}. Semoga hari Anda menyenangkan.'], atlas: ['{S}.', '{S}, selamat bekerja.', '{S}. Semoga lancar hari ini.'], zeno: ['{S}.', '{S}, senang bertemu Anda.', '{S}. Semangat bekerja.'] },
    netral: { neo: ['Halo!', 'Hai!', 'Halo, selamat datang!', 'Hai, senang kamu datang.'], atlas: ['Halo.', 'Hai!', 'Halo, selamat bekerja.', 'Hai, semoga lancar hari ini.'], zeno: ['Halo-halo!', 'Hai hai!', 'Halo!', 'Hai, semangat ya!'] },
    santai: { neo: ['Hai!', 'Hei!', 'Yo!', 'Halo, halo!'], atlas: ['Hai, hai.', 'Halo!', 'Hei, hei.', 'Yo.'], zeno: ['Hai hai!', 'Yo!', 'Heii!', 'Yoo, halo!'] },
  } as PerGaya<PerAgen>,
  bukaWaktu: ['Selamat {w}!', 'Halo, selamat {w}!', '{W}!', 'Hai, selamat {w}!'],
  kabar: {
    formal: { neo: ['Saya baik, terima kasih. Semua sistem berjalan lancar.', 'Baik, terima kasih. Kantor berjalan dengan tertib.'], atlas: ['Baik, terima kasih. Pembukuan terkendali.', 'Saya baik. Catatan akuntansi tertata rapi.'], zeno: ['Baik, terima kasih. Saya siap bekerja.', 'Saya baik, terima kasih. Siap membantu.'] },
    netral: { neo: ['Aku baik, terima kasih. Semua berjalan lancar.', 'Baik, semua aman terkendali.'], atlas: ['Baik, terima kasih. Pembukuan aman.', 'Aku baik. Catatan rapi semua.'], zeno: ['Baik, terima kasih. Siap kerja!', 'Aku baik, semangat nih!'] },
    santai: { neo: ['Baik banget, semua lancar.', 'Aman, semua terkendali.'], atlas: ['Baik! Catatan akuntansi rapi jaya.', 'Baik dong, pembukuan aman.'], zeno: ['Baik dong, semangat banget!', 'Mantap! Lagi on fire nih.'] },
  } as PerGaya<PerAgen>,
  aktivitas: {
    formal: { neo: ['Saya sedang memantau jalannya kantor.', 'Saya sedang mengawasi pekerjaan tim.'], atlas: ['Saya sedang merapikan catatan akuntansi.', 'Saya sedang memeriksa data pembukuan.'], zeno: ['Saya sedang siaga menunggu tugas.', 'Saya sedang menyiapkan diri untuk tugas berikutnya.'] },
    netral: { neo: ['Lagi memantau jalannya kantor.', 'Lagi memastikan semua berjalan lancar.'], atlas: ['Lagi merapikan catatan akuntansi.', 'Lagi memeriksa data pembukuan.'], zeno: ['Lagi standby menunggu tugas.', 'Lagi siap-siap kerja.'] },
    santai: { neo: ['Lagi keliling kantor, mantau semua.', 'Lagi mantau kerjaan tim.'], atlas: ['Lagi beresin catatan akuntansi.', 'Lagi ngecek angka-angka.'], zeno: ['Lagi standby, siap kerja!', 'Lagi nungguin tugas nih.'] },
  } as PerGaya<PerAgen>,
  makan: { neo: ['Aku robot, cukup dicas saja.', 'Robot kayak aku makannya listrik, hehe.'], atlas: ['Aku sudah kenyang data, hehe.', 'Aku makan angka saja, hehe.'], zeno: ['Aku sudah sarapan angka, hehe.', 'Aku kenyang, tinggal semangat kerja!'] } as PerAgen,
  hadir: {
    formal: { neo: ['Ya, saya di sini dan mendengar Anda.', 'Ya, saya hadir dan mendengar dengan jelas.'], atlas: ['Ya, saya mendengar dengan jelas.', 'Ya, saya di sini.'], zeno: ['Ya, saya di sini dan siap.', 'Ya, saya mendengar Anda.'] },
    netral: { neo: ['Iya, aku di sini dan dengar kok.', 'Dengar, aku di sini.'], atlas: ['Iya, aku dengar jelas.', 'Ya, aku di sini.'], zeno: ['Iya, aku dengar. Siap!', 'Ada kok, aku dengar.'] },
    santai: { neo: ['Iya, aku di sini dan dengar kok.', 'Dengar dong, tenang aja.'], atlas: ['Iya, aku dengar jelas.', 'Dengar kok, lanjut aja.'], zeno: ['Dengar dong! Aku siap.', 'Ada kok! Dengar jelas.'] },
  } as PerGaya<PerAgen>,
  // hanya dipanggil namanya: "Neo", "Atlas?", "hei kalian"
  panggil: {
    formal: { neo: ['Ya, ada yang bisa saya bantu?', 'Ya, silakan. Ada yang bisa saya bantu?'], atlas: ['Ya, ada yang bisa saya bantu?', 'Ya, silakan, apa yang perlu saya periksa?'], zeno: ['Ya, ada yang bisa saya bantu?', 'Ya, silakan. Saya siap.'] },
    netral: { neo: ['Iya, ada yang bisa kubantu?', 'Ya, aku di sini. Ada apa?', 'Iya, silakan. Ada yang perlu dibantu?'], atlas: ['Iya, ada yang bisa kubantu?', 'Ya, silakan. Apa yang perlu kuperiksa?', 'Iya, aku dengar. Ada apa?'], zeno: ['Iya! Ada yang bisa dibantu?', 'Siap! Ada apa nih?', 'Ya, silakan. Aku siap.'] },
    santai: { neo: ['Iya, ada apa?', 'Yo, ada yang bisa kubantu?', 'Iya, kenapa?'], atlas: ['Iya, ada apa?', 'Ya, kenapa? Ada yang perlu dicek?', 'Iya, aku dengar.'], zeno: ['Yoo, ada apa nih?', 'Iya! Ada yang bisa dibantu?', 'Siap, kenapa?'] },
  } as PerGaya<PerAgen>,
  tutup: {
    formal: { satu: ['Ada yang bisa saya bantu?', 'Ada yang dapat saya bantu?'], banyak: ['Ada yang bisa kami bantu?', 'Ada yang dapat kami bantu?'] },
    netral: { satu: ['Ada yang bisa kubantu?', 'Hari ini mau mulai dari mana?'], banyak: ['Ada yang bisa kami bantu?', 'Hari ini mau mulai dari mana?'] },
    santai: { satu: ['Ada yang bisa dibantu?', 'Mau mulai dari mana nih?'], banyak: ['Ada yang bisa kami bantu?', 'Mau mulai dari mana nih?'] },
  } as PerGaya<{ satu: string[]; banyak: string[] }>,
  tanyaBalik: { formal: ['Bagaimana kabar Anda?', 'Bagaimana dengan Anda?'], netral: ['Kamu sendiri apa kabar?', 'Kamu sendiri bagaimana?'], santai: ['Kamu sendiri gimana?', 'Kamu apa kabar nih?'] } as PerGaya<string[]>,
  aku: { formal: 'Saya', netral: 'Aku', santai: 'Aku' } as PerGaya<string>,
  slm: { pagi: 'Selamat pagi', siang: 'Selamat siang', sore: 'Selamat sore', malam: 'Selamat malam' } as Record<Waktu, string>,
  islam: ['Waalaikumsalam.', 'Waalaikumsalam, salam kembali.'],
};

const EN = {
  buka: {
    formal: { neo: ['{S}.', '{S}, good to see you.'], atlas: ['{S}.', '{S}, hope your day goes well.'], zeno: ['{S}.', '{S}, ready to work.'] },
    netral: { neo: ['Hello!', 'Hi there!'], atlas: ['Hello.', 'Hi!'], zeno: ['Hello hello!', 'Hi hi!'] },
    santai: { neo: ['Hey!', 'Hey there!'], atlas: ['Hey there.', 'Hey, hey.'], zeno: ['Hey hey!', 'Yo!'] },
  } as PerGaya<PerAgen>,
  bukaWaktu: ['Good {w}!', 'Hello, good {w}!'],
  kabar: {
    formal: { neo: ['I am well, thank you. All systems are running smoothly.'], atlas: ['Well, thank you. The books are in order.'], zeno: ['Well, thank you. I am ready to work.'] },
    netral: { neo: ['Doing well, thanks. Everything is running smoothly.'], atlas: ['Good, thanks. The books are in order.'], zeno: ['Good, thanks. Ready to work!'] },
    santai: { neo: ['Doing great, everything is running smoothly.'], atlas: ['Doing well! The books are tidy.'], zeno: ['Doing great, full of energy!'] },
  } as PerGaya<PerAgen>,
  aktivitas: {
    formal: { neo: ['I am keeping an eye on the office.'], atlas: ['I am tidying up the accounting records.'], zeno: ['I am on standby for tasks.'] },
    netral: { neo: ['Keeping an eye on the office.'], atlas: ['Tidying up the accounting records.'], zeno: ['On standby for tasks.'] },
    santai: { neo: ['Walking around, keeping an eye on things.'], atlas: ['Crunching some numbers.'], zeno: ['On standby, ready to roll!'] },
  } as PerGaya<PerAgen>,
  makan: { neo: ['I am a robot, I just recharge.'], atlas: ['I am full of data already, haha.'], zeno: ['I had a breakfast of numbers, haha.'] } as PerAgen,
  hadir: {
    formal: { neo: ['Yes, I am here and I can hear you.'], atlas: ['Yes, I can hear you clearly.'], zeno: ['Yes, I am here and ready.'] },
    netral: { neo: ['Yes, I am here and I hear you.'], atlas: ['Yes, I hear you clearly.'], zeno: ['Yes, I hear you. Ready!'] },
    santai: { neo: ['Yep, I am here and I hear you.'], atlas: ['Yep, loud and clear.'], zeno: ['Loud and clear! I am ready.'] },
  } as PerGaya<PerAgen>,
  panggil: {
    formal: { neo: ['Yes, how may I help?'], atlas: ['Yes, how may I help?'], zeno: ['Yes, how may I help?'] },
    netral: { neo: ['Yes, anything I can help with?'], atlas: ['Yes, what do you need?'], zeno: ['Yes! What can I do for you?'] },
    santai: { neo: ['Yep, what is up?'], atlas: ['Yeah, what is up?'], zeno: ['Yoo, what is up?'] },
  } as PerGaya<PerAgen>,
  tutup: {
    formal: { satu: ['How may I help?'], banyak: ['How may we help?'] },
    netral: { satu: ['Anything I can help with?'], banyak: ['Anything we can help with?'] },
    santai: { satu: ['Need anything?'], banyak: ['Need anything?'] },
  } as PerGaya<{ satu: string[]; banyak: string[] }>,
  tanyaBalik: { formal: ['How about you?'], netral: ['How about you?'], santai: ['How about you?'] } as PerGaya<string[]>,
  aku: { formal: 'I am', netral: 'I am', santai: 'I am' } as PerGaya<string>,
  slm: { pagi: 'Good morning', siang: 'Good afternoon', sore: 'Good evening', malam: 'Good evening' } as Record<Waktu, string>,
  islam: ['Wa alaikum salam.'],
};

/**
 * Susun balasan per agen. `kepada` kosong -> pemanggil harus mengisi dulu (penutur terakhir / Neo).
 * Urutan balasan selalu Neo -> Atlas -> Zeno. Agen terakhir menutup (tawaran bantu atau tanya balik).
 * Variasi dipilih acak per slot dan tidak mengulang kalimat yang sama berturut-turut.
 */
export function susunBalasan(h: HasilSapaan, o: Opsi): { agen: AgenSuara; teks: string }[] {
  const acak = o.acak ?? Math.random;
  const en = o.bahasa === 'en';
  const B = en ? EN : ID;
  const urut = URUTAN_AGEN.filter((a) => h.kepada.includes(a));
  const banyak = urut.length > 1;
  const w = h.waktu ?? waktuDariJam(o.jam);
  const g = h.gaya;
  const ambil = (slot: string, agen: AgenSuara, daftar: string[]) => pilihBeda(`${en ? 'en' : 'id'}:${slot}:${agen}`, daftar, acak);

  return urut.map((agen, i) => {
    const akhir = i === urut.length - 1;
    const bagian: string[] = [];
    const sebutNama = () => bagian.push(en ? `I am ${NAMA_TAMPIL[agen]}.` : `${ID.aku[g]} ${NAMA_TAMPIL[agen]}.`);

    if (h.jenis === 'panggil') {
      // hanya dipanggil: jawab singkat. Kalau banyak yang dipanggil, tiap agen menyebut namanya supaya jelas siapa yang menjawab.
      if (banyak) sebutNama();
      bagian.push(ambil('panggil:' + g, agen, B.panggil[g][agen]));
      return { agen, teks: bagian.join(' ') };
    }

    if (h.jenis === 'cek_hadir') {
      bagian.push(ambil('hadir:' + g, agen, B.hadir[g][agen]));
    } else {
      // pembuka: salam islam > formal (selamat + waktu) > netral/santai (mencerminkan kata waktu bila diucapkan)
      if (h.islam) bagian.push(ambil('islam', agen, B.islam));
      else if (g === 'formal') bagian.push(ambil('buka:f', agen, B.buka.formal[agen]).replace('{S}', B.slm[w]));
      else if (h.waktu && acak() < 0.6) bagian.push(ambil('bukaw', agen, B.bukaWaktu).replace('{w}', en ? (h.waktu === 'siang' ? 'afternoon' : h.waktu === 'pagi' ? 'morning' : 'evening') : h.waktu).replace('{W}', kapital(h.waktu)));
      else bagian.push(ambil('buka:' + g, agen, B.buka[g][agen]));
      if (banyak) sebutNama(); // lebih dari satu agen menjawab: sebut nama supaya jelas siapa yang bicara
      if (h.basa === 'kabar') bagian.push(ambil('kabar:' + g, agen, B.kabar[g][agen]));
      else if (h.basa === 'aktivitas') bagian.push(ambil('akt:' + g, agen, B.aktivitas[g][agen]));
      else if (h.basa === 'makan') bagian.push(ambil('makan', agen, B.makan[agen]));
    }

    if (akhir) {
      if (h.basa === 'kabar' && h.jenis === 'sapaan') bagian.push(ambil('balik:' + g, agen, B.tanyaBalik[g]));
      else bagian.push(ambil('tutup:' + g, agen, B.tutup[g][banyak ? 'banyak' : 'satu']));
    }
    return { agen, teks: bagian.join(' ') };
  });
}

// ---------------------------------------------------------------------------------------------
// [BARU] Balasan SEREMPAK: disapa semuanya ("halo semuanya") -> Neo, Atlas, Zeno menjawab BERBARENGAN, bukan bergiliran.
// Supaya tiga suara yang menumpuk tetap jelas dimengerti:
//   - kalimat SANGAT pendek (maks. ~6 kata), tanpa perkenalan nama ("Aku Neo") dan tanpa tanya balik,
//   - kata-kata tiap agen BERBEDA (kolam kalimat tiap agen tidak ada yang sama dan beda kata pembuka),
//   - kepribadian tetap: Neo tegas-hangat, Atlas tenang-teliti, Zeno ceria-sigap.
// Pemisahan suara (kiri/tengah/kanan, nada beda per agen) dilakukan di pemutar, lihat VoiceAssistant.jalankanSerempak.
// ---------------------------------------------------------------------------------------------
type Kolam = Record<AgenSuara, string[]>;
type KolamGaya = { formal: Kolam; netral: Kolam; santai: Kolam };

const SEREMPAK_ID: { sapaan: KolamGaya; kabar: Kolam; aktivitas: Kolam; makan: Kolam; hadir: Kolam; panggil: Kolam; islam: Kolam } = {
  sapaan: {
    formal: { neo: ['Selamat {w}, ada yang bisa dibantu?'], atlas: ['{W}. Siap membantu Anda.'], zeno: ['Halo. Silakan, ada tugas?'] },
    netral: { neo: ['Selamat {w}, ada yang bisa dibantu?', 'Selamat {w}! Ada yang perlu dibantu?'], atlas: ['{W}! Mau dicek apa?', '{W}, siap membantu.'], zeno: ['Halo! Mulai dari mana?', 'Hai hai, ada tugas?'] },
    santai: { neo: ['Hai! Ada yang bisa dibantu?', 'Yo! Ada yang perlu dibantu?'], atlas: ['Hei, mau dicek apa?', 'Hai, siap bantu.'], zeno: ['Yoo! Mulai dari mana?', 'Heii, ada tugas nih?'] },
  },
  kabar: { neo: ['Baik! Ada yang bisa dibantu?', 'Lancar! Ada yang perlu dibantu?'], atlas: ['Aman. Mau dicek apa?', 'Rapi. Mau diperiksa apa?'], zeno: ['Semangat! Ada tugas?', 'Siap tempur! Mulai dari mana?'] },
  aktivitas: { neo: ['Lagi memantau kantor.'], atlas: ['Lagi merapikan catatan.'], zeno: ['Lagi standby, siap kerja!'] },
  makan: { neo: ['Aku cukup dicas saja.'], atlas: ['Aku kenyang data.'], zeno: ['Sudah sarapan angka!'] },
  hadir: { neo: ['Iya, dengar kok.'], atlas: ['Dengar jelas.'], zeno: ['Ada, siap!'] },
  panggil: { neo: ['Iya, ada apa?'], atlas: ['Ya, mau dicek apa?'], zeno: ['Siap, ada tugas?'] },
  islam: { neo: ['Waalaikumsalam.'], atlas: ['Waalaikumsalam, siap membantu.'], zeno: ['Waalaikumsalam! Ada tugas?'] },
};

const SEREMPAK_EN: typeof SEREMPAK_ID = {
  sapaan: {
    formal: { neo: ['{S}, how may I help?'], atlas: ['{W}. At your service.'], zeno: ['Hello. Any tasks today?'] },
    netral: { neo: ['{S}, anything I can help with?'], atlas: ['{W}! What shall I check?', '{W}, ready to help.'], zeno: ['Hello! Where do we start?', 'Hi hi, any tasks?'] },
    santai: { neo: ['Hey! Need anything?'], atlas: ['Hey, what should I check?'], zeno: ['Yo! Where do we start?', 'Heyy, any tasks?'] },
  },
  kabar: { neo: ['Great! Need anything?'], atlas: ['All tidy. What to check?'], zeno: ['Pumped! Any tasks?'] },
  aktivitas: { neo: ['Watching over the office.'], atlas: ['Tidying up the records.'], zeno: ['On standby, ready to go!'] },
  makan: { neo: ['I just recharge.'], atlas: ['I am full of data.'], zeno: ['Had a breakfast of numbers!'] },
  hadir: { neo: ['Yes, I hear you.'], atlas: ['Loud and clear.'], zeno: ['Here, ready!'] },
  panggil: { neo: ['Yes, what is it?'], atlas: ['Yes, what to check?'], zeno: ['Ready, any tasks?'] },
  islam: { neo: ['Wa alaikum salam.'], atlas: ['Wa alaikum salam, ready to help.'], zeno: ['Wa alaikum salam! Any tasks?'] },
};

/**
 * Balasan pendek untuk dijawab SEREMPAK oleh beberapa agen (urutan Neo, Atlas, Zeno). Dipakai bila yang disapa lebih dari satu agen.
 * Kalimat tiap agen dijamin berbeda satu sama lain.
 */
export function susunBalasanSerempak(h: HasilSapaan, o: Opsi): { agen: AgenSuara; teks: string }[] {
  const acak = o.acak ?? Math.random;
  const en = o.bahasa === 'en';
  const B = en ? SEREMPAK_EN : SEREMPAK_ID;
  const urut = URUTAN_AGEN.filter((a) => h.kepada.includes(a));
  const w = h.waktu ?? waktuDariJam(o.jam);
  const waktuKata = en ? (w === 'pagi' ? 'morning' : w === 'siang' ? 'afternoon' : 'evening') : w;
  const isi = (t: string) =>
    t.replace('{S}', (en ? SEREMPAK_SLM_EN : ID.slm)[w]).replace('{w}', waktuKata).replace('{W}', kapital(waktuKata));
  const ambil = (slot: string, agen: AgenSuara, daftar: string[]) => isi(pilihBeda(`ser:${en ? 'en' : 'id'}:${slot}:${agen}`, daftar, acak));

  return urut.map((agen) => {
    let teks: string;
    if (h.islam) teks = ambil('islam', agen, B.islam[agen]);
    else if (h.jenis === 'panggil') teks = ambil('panggil', agen, B.panggil[agen]);
    else if (h.jenis === 'cek_hadir') teks = ambil('hadir', agen, B.hadir[agen]);
    else if (h.basa === 'kabar') teks = ambil('kabar', agen, B.kabar[agen]);
    else if (h.basa === 'aktivitas') teks = ambil('aktivitas', agen, B.aktivitas[agen]);
    else if (h.basa === 'makan') teks = ambil('makan', agen, B.makan[agen]);
    else teks = ambil('sapaan:' + h.gaya, agen, B.sapaan[h.gaya][agen]);
    return { agen, teks };
  });
}
const SEREMPAK_SLM_EN: Record<Waktu, string> = { pagi: 'Good morning', siang: 'Good afternoon', sore: 'Good evening', malam: 'Good evening' };
