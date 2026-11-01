// niatNavigasi.ts
// ================
// Pemahaman NIAT untuk perintah pindah halaman/tab lewat suara (dipakai navigasiSuara.ts -> bacaNavigasi).
//
// Dulu: ada kata "buka/pindah/ke ..." + nama halaman = langsung pindah; ada kata "tidak/bukan/jangan" di mana pun = ditolak.
// Akibatnya "buka neraca bukan laba rugi" ditolak, sedangkan "gimana cara buka neraca" malah membuka Neraca.
// Sekarang ucapan dibaca seperti manusia mendengarnya. Urutan berpikirnya:
//   1. Buang pembuka santai ("oke neo", "eh", "nah") dan penyebut-diri.
//   2. KOREKSI : "buka neraca eh maksudku laba rugi"  -> yang berlaku bagian terakhir. "buka neraca eh nggak jadi" -> batal.
//   3. KLAUSA  : "tadi aku buka neraca, sekarang buka laba rugi" -> yang dinilai klausa terakhir ("sekarang ...").
//   4. NEGASI  : "jangan buka neraca" = batal.  "buka neraca bukan laba rugi" = neraca.  "bukan neraca, buka laba rugi" = laba rugi.
//   5. NIAT    : perintah | tanya | lampau (cerita) | orang_lain | ragu | batal | netral.
//      tanya      "apa itu neraca", "gimana cara buka neraca", "kenapa neraca tidak seimbang"  -> jawab, JANGAN pindah.
//                 pengecualian: permintaan sopan ("bisa buka neraca?", "gimana kalau kita lihat laba rugi") tetap perintah.
//      lampau     "tadi aku sudah buka neraca", "kemarin kita buka laba rugi"  -> cerita, bukan perintah.
//      orang_lain "dia buka neraca", "klien pindah ke tab aging" -> bukan perintah untuk Neo.
//      ragu       tidak ada kata kerja jelas ("neraca dong", "kalau aku buka neraca apa yang muncul") -> biarkan lapis AI menilai.
//      batal      "jangan buka neraca", "nggak usah pindah", "buka neraca eh ga jadi".
// Contoh kalimat (ratusan) + uji: navigasiSuara.contoh.ts dan navigasiSuara.uji.ts

export type Niat = 'perintah' | 'tanya' | 'batal' | 'lampau' | 'orang_lain' | 'ragu' | 'netral';
export type HasilNiat = {
  niat: Niat;
  teks: string; // bagian ucapan yang dipakai untuk mencocokkan nama halaman/tab (setelah koreksi/klausa/negasi)
  alasan: string; // untuk debug & uji
};

export const rapikanNiat = (t: string): string =>
  (t || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '') // dont, lets, i'd
    // normalisasi VoiceAssistant mengubah apostrof jadi spasi ("don t", "let s"): rapatkan lagi
    .replace(/\b(\w+)\s+(t|ll|re|ve)\b/g, '$1$2')
    .replace(/\b(let|what|that|it|there|here|who|how)\s+s\b/g, '$1s')
    // "cancel opening X", "stop going to X" -> bentuk dasar, supaya negasi + kata kerja terbaca
    .replace(/\b(cancel|stop|skip|avoid|dont|never)\s+(opening|going|switching|navigating|viewing|visiting|checking|showing)\b/g, (_m, a1: string, g: string) => a1 + ' ' + ({ opening: 'open', going: 'go', switching: 'switch', navigating: 'navigate', viewing: 'view', visiting: 'visit', checking: 'check', showing: 'show' } as Record<string, string>)[g])
    .replace(/[.,!?;:"“”‘()\[\]{}…\-–—_/\\]/g, ' ')
    .replace(/(.)\1{2,}/g, '$1') // "bukaaa" -> "buka"
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------------------------
// Kosakata
// ---------------------------------------------------------------------------------------------
// Kata kerja KUAT: jelas berarti pindah/tampilkan halaman, boleh di posisi mana pun dalam klausa.
const VERBA_KUAT = String.raw`(?:buka|bukakan|bukain|bukalah|membuka|dibuka|dibukakan|dibukain|pergi|pindah|pindahkan|pindahin|dipindah|dipindahkan|berpindah|beralih|alihkan|dialihkan|menuju|masuk|mampir|singgah|melipir|meluncur|arahkan|diarahkan|bawa|bawakan|bawain|dibawa|antar|anter|anterin|antarkan|navigasi|ganti|gantiin|gantikan|geser|menggeser|lompat|melompat|loncat|cabut|cus|cuss|capcus|gas|yuk|yok|ayo|ayok|hayuk|kuy|mari|lanjut|lanjutkan|next|tampilkan|tampilin|ditampilkan|ditampilin|munculkan|munculin|dimunculkan|dimunculin|perlihatkan|tunjukkan|tunjukin|kasih lihat|kasih liat|open|openlah|switch|navigate|jump|goto|go to|go over to|go into|take me|bring me|get me|pull up|bring up|head to|head over to|visit|launch|hop to|hop over to|pop over to|swing by|zip to|bounce to|change to|shift to|move to|kembali|balik|mundur|go back to)`;
// Kata kerja LEMAH: sering dipakai untuk hal lain ("lihat angkanya", "view looks off"); dihitung perintah hanya
// kalau muncul di awal ucapan (didahului kata pengantar sopan saja).
const VERBA_LEMAH = String.raw`(?:lihat|liat|lihatin|liatin|melihat|dilihat|cek|cekin|periksa|mengecek|intip|intipin|tengok|tengokin|show|show me|view|display|check|check out|see|load|move|go|head)`;

const RE_KUAT = new RegExp(String.raw`\b${VERBA_KUAT}\b`);
const RE_LEMAH = new RegExp(String.raw`\b${VERBA_LEMAH}\b`);
const RE_KUAT_G = new RegExp(String.raw`\b${VERBA_KUAT}\b`, 'g');

// Kata yang boleh berdiri SEBELUM kata kerja lemah ("tolong lihat", "aku mau cek", "can you show").
const PRA_VERBA = new Set(
  (
    'tolong please pls plis coba cobain dong deh ya yah dulu aja saja bisa bisakah boleh bolehkah mau pengen pingin pengin ingin kita aku saya gue gua kamu kau lu anda neo ' +
    'can could would will may you i we let lets me us mari langsung segera cepat quick quickly just now sekarang lanjut terus nah oke ok okay kalau sih tuh nih lagi juga ' +
    'sebentar bentar mohon harap silakan silahkan kiranya perlu harus mesti butuh need want wanna gonna to a the real kindly also then so and dan atau lalu habis abis ' +
    'gimana bagaimana kenapa mengapa mending sebaiknya baik lebih kayaknya sepertinya rasanya mungkin kok why how what about if hmm kalo jika bila'
  ).split(' ')
);

// Pembuka santai yang dibuang di awal ucapan
const PEMBUKA = new Set(
  (
    'oke ok okay nah ya iya yah eh ehh em emm hm hmm anu gini halo hai hei hey hallo permisi oi woy bro bang kak mas mbak pak bu sis bos dong deh sih nih tuh well so uh um ah oh neo nio neu ' +
    'hmmm yaudah yaudah ya udah udah oke deh sip siap noted baik baiklah right alright'
  ).split(' ')
);

// Penanda koreksi diri: yang berlaku adalah bagian SESUDAH penanda terakhir.
const RE_RALAT = new RegExp(
  String.raw`\b(?:eh|ehh|maksud(?:nya|ku| saya| gue)?|ralat|ups|oops|sori|sorry|salah|bukan itu|bukan yang itu|bukan yang itu maksud(?:nya|ku)?|ga jadi|gak jadi|nggak jadi|ngga jadi|tidak jadi|enggak jadi|engga jadi|i mean|no wait|wait no|actually|scratch that|hold on|wait|tunggu|bentar|sebentar|ralat ya|bukan bukan)\b`,
  'g'
);
// Bagian sesudah penanda koreksi yang isinya hanya pembatalan
const RE_BATAL_MURNI = /^(?:ga|gak|nggak|ngga|tidak|enggak|engga|no|not)?\s*(?:jadi|usah|perlu|mau|deh|dulu|ya|aja|saja|jadi deh|jadi ya|dulu deh|lagi|sih|kok|then|never ?mind|forget it)?$/;

// Negasi
const NEG_SRC = String.raw`(?:jangan|jgn|janganlah|ga usah|gak usah|nggak usah|ngga usah|tidak usah|enggak usah|engga usah|ga perlu|gak perlu|nggak perlu|tidak perlu|ga mau|gak mau|nggak mau|tidak mau|gamau|ga jadi|gak jadi|nggak jadi|tidak jadi|batal|batalkan|batalin|cancel|never ?mind|forget it|dont|do not|no need to|bukan|tanpa|not|instead of|jangan dulu|ga dulu|gak dulu|nggak dulu|belum dulu)`;
const RE_NEG = new RegExp(String.raw`\b${NEG_SRC}\b`);
const RE_NEG_G = new RegExp(String.raw`\b${NEG_SRC}\b`, 'g');

// Penanda batas klausa (urutan waktu / kontras): yang dinilai klausa terakhir
const RE_BATAS = /\b(?:hari ini|kali ini|saat ini|sekarang ini|this time|today|sekarang|lalu|terus|habis itu|abis itu|setelah itu|sesudah itu|kemudian|selanjutnya|berikutnya|tapi|namun|then|now|and then|after that|but|next up)\b/g;

// Pertanyaan: di awal klausa
const RE_TANYA_AWAL =
  /^(?:apa|apakah|apaan|kenapa|mengapa|bagaimana|gimana|berapa|kapan|siapa|dimana|di mana|mana|yang mana|cara|jelaskan|jelasin|terangkan|ceritakan|ceritain|artinya|maksudnya|definisi|what|whats|why|how|when|where|who|which|explain|define|describe|tell me|is|are|does|do|did|was|were)\b/;
const RE_TANYA_AKHIR = /\b(?:itu apa|apa itu|artinya apa|apa artinya|maksudnya apa|apa maksudnya|itu apaan|apaan|what is that|what does that mean|what is it|means what)$/;
const RE_META_CARA =
  /\b(?:cara|langkah|prosedur|tutorial|panduan|petunjuk|how to|steps to|way to|how do i|how can i|how do you)\s+(?:untuk\s+|buat\s+|agar\s+|supaya\s+)?(?:membuka|buka|pindah|berpindah|masuk|navigasi|menuju|ke|open|go to|switch|navigate|get to|find)\b/;
const RE_JELASKAN = /\b(?:jelaskan|jelasin|terangkan|ceritakan|ceritain|artikan|apa arti|maksud dari|definisi|explain|describe|define)\b/;
// Permintaan sopan / ajakan yang berbentuk pertanyaan -> tetap perintah
const RE_SOPAN = new RegExp(
  String.raw`^(?:(?:apakah|apa)\s+)?(?:bisa|bisakah|boleh|bolehkah|mau|maukah|mungkin|mungkinkah|sudikah|kiranya)\s+(?:\w+\s+){0,3}?(?:${VERBA_KUAT}|${VERBA_LEMAH}|ke)\b` +
    String.raw`|^(?:gimana|bagaimana|kenapa|mengapa|why|how|what)\s+(?:kalau|kalo|jika|bila|ga|gak|nggak|tidak|dont|about|if)\s+(?:\w+\s+){0,2}?(?:${VERBA_KUAT}|${VERBA_LEMAH}|ke|opening|going|looking|checking|viewing)\b` +
    String.raw`|^(?:can|could|would|will|may|shall)\s+(?:you|i|we|u)\s+(?:\w+\s+){0,2}?(?:${VERBA_KUAT}|${VERBA_LEMAH})\b` +
    String.raw`|^(?:is it possible to|any chance (?:you|we) can|do you mind)\b`
);

// Cerita masa lalu
const RE_LAMPAU =
  /\b(?:tadi|kemarin|barusan|baru aja|baru saja|semalam|tadi pagi|tadi siang|tadi malam|minggu lalu|bulan lalu|tahun lalu|dulu|pernah|sempat|earlier|yesterday|just now|already|last week|last month|last year|previously|before|i just|we just|sering|selalu|biasanya|biasa|jarang|kadang|kadang kadang|setiap|tiap|always|usually|often|sometimes|rarely|never|normally|typically)\b|\b(?:sudah|udah|telah|sdh)\s+(?:aku\s+|saya\s+|gue\s+|kita\s+|kami\s+|dia\s+)?(?:\w+\s+)?$|\b(?:pas|waktu|ketika|saat|sewaktu|when|while|once|after i|after we|setelah aku|setelah saya|setelah kita|sesudah aku)\s+(?:aku|saya|gue|kita|kami|i|we)\b|\b(?:i|we)\s+(?:opened|went|visited|switched|moved|looked|checked|viewed)\b|\b(?:aku|saya|gue|kita|kami)\s+(?:udah|sudah|telah|tadi|kemarin|barusan)\b/;
const RE_ULANG = /\b(?:lagi|sekali lagi|ulang|ulangi|again|once more|another time)\b/;

// Pelaku orang ketiga
const RE_ORANG_LAIN =
  /\b(?:dia|mereka|beliau|dia orang|si \w+|klien|client|pelanggan|vendor|supplier|auditor|manajer|manager|tim|orang|temen|teman|rekan|staf|staff|he|she|they|people|someone|somebody|everyone|the client|the user|the auditor|the team)\s+(?:yang\s+|itu\s+)?(?:sudah\s+|udah\s+|lagi\s+|sedang\s+|akan\s+|bakal\s+|mau\s+|suka\s+|biasanya\s+|selalu\s+|always\s+|usually\s+|will\s+|is\s+|was\s+|just\s+)?(?:\w+\s+)?$/;
const RE_ORANG_LAIN_SINGKAT = /\b(?:dia|mereka|beliau|klien|client|pelanggan|auditor|manajer|he|she|they|people|someone)\b/;

// Pengandaian
const RE_ANDAI = /^(?:kalau|kalo|jika|bila|andai|seandainya|misalnya|misal|umpama|umpamanya|bayangkan|coba bayangkan|if|suppose|what if|in case|imagine)\b/;
const RE_ANDAI_SOPAN = /^(?:kalau|kalo|jika|bila|if)\s+(?:bisa|boleh|tidak keberatan|ga keberatan|gak keberatan|nggak keberatan|memang|kamu bisa|you can|you could|possible|you dont mind)\b/;

// ---------------------------------------------------------------------------------------------
// Alat bantu
// ---------------------------------------------------------------------------------------------
const kata = (s: string): string[] => (s ? s.split(' ') : []);

function buangPembuka(t: string): string {
  const k = kata(t);
  let i = 0;
  while (i < k.length - 1 && PEMBUKA.has(k[i])) i++;
  return k.slice(i).join(' ');
}

/** Posisi (indeks karakter) kata kerja pertama dalam klausa. kuat/lemah. -1 = tidak ada. */
function cariVerba(s: string): { idx: number; len: number; kuat: boolean } | null {
  const m = RE_KUAT.exec(s);
  const l = RE_LEMAH.exec(s);
  if (m && (!l || m.index <= l.index)) return { idx: m.index, len: m[0].length, kuat: true };
  if (l) {
    // kata kerja lemah hanya dianggap kalau semua kata sebelumnya adalah kata pengantar sopan
    const sebelum = kata(s.slice(0, l.index).trim());
    if (sebelum.every((w) => PRA_VERBA.has(w) || PEMBUKA.has(w))) return { idx: l.index, len: l[0].length, kuat: false };
    if (m) return { idx: m.index, len: m[0].length, kuat: true };
    return null;
  }
  if (m) return { idx: m.index, len: m[0].length, kuat: true };
  return null;
}

const NEGTOK = new Set(
  'jangan jgn janganlah ga gak nggak ngga tidak enggak engga usah jadi batal batalkan batalin cancel dont not no need perlu mau dulu stop tunggu never mind forget it do'.split(' ')
);
/** "ke neraca dong" / "yuk ke laba rugi" / "jangan ke aset" -> indeks karakter kata "ke" di awal (setelah kata pengantar/negasi), -1 bila tidak ada. */
function idxKeAwal(s: string): number {
  const k = kata(s);
  let pos = 0;
  for (let i = 0; i < k.length; i++) {
    if (k[i] === 'ke' && i < k.length - 1) return pos;
    if (!(PRA_VERBA.has(k[i]) || PEMBUKA.has(k[i]) || NEGTOK.has(k[i]))) return -1;
    pos += k[i].length + 1;
  }
  return -1;
}
const adaKeAwal = (s: string): boolean => idxKeAwal(s) >= 0;

const sepertiKosong = (s: string) => kata(s).every((w) => PRA_VERBA.has(w) || PEMBUKA.has(w));

function terapkanRalat(t: string): { teks: string; batal: boolean; berubah: boolean } {
  let terakhir: { idx: number; len: number } | null = null;
  RE_RALAT.lastIndex = 0;
  for (let m = RE_RALAT.exec(t); m; m = RE_RALAT.exec(t)) {
    const kepala = t.slice(0, m.index).trim();
    if (kepala && !sepertiKosong(kepala)) terakhir = { idx: m.index, len: m[0].length };
  }
  if (!terakhir) return { teks: t, batal: false, berubah: false };
  const kepala = t.slice(0, terakhir.idx).trim();
  let ekor = t.slice(terakhir.idx + terakhir.len).trim();
  const penandaBatal = /\b(?:ga|gak|nggak|ngga|tidak|enggak|engga)\s+jadi$/.test(t.slice(0, terakhir.idx + terakhir.len));
  ekor = buangPembuka(ekor.replace(/^(?:bukan|not|no)\s+/, '').trim()) || '';
  if (!ekor || RE_BATAL_MURNI.test(ekor)) {
    // "buka neraca eh nggak jadi" -> batal (kalau kepala memang perintah)
    if (penandaBatal || ekor) return { teks: kepala, batal: !!cariVerba(kepala) || adaKeAwal(kepala), berubah: true };
    return { teks: kepala, batal: false, berubah: false };
  }
  // ekor tanpa kata kerja ("eh bukan, laba rugi aja") -> pinjam kata kerja dari kepala
  if (!cariVerba(ekor) && !adaKeAwal(ekor)) {
    const v = cariVerba(kepala);
    const pinjam = v ? kepala.slice(v.idx, v.idx + v.len) : adaKeAwal(kepala) ? 'ke' : '';
    return { teks: pinjam ? `${pinjam} ${ekor}` : ekor, batal: false, berubah: true };
  }
  return { teks: ekor, batal: false, berubah: true };
}

function klausaTerakhir(t: string): string {
  const bagian: string[] = [];
  let awal = 0;
  RE_BATAS.lastIndex = 0;
  for (let m = RE_BATAS.exec(t); m; m = RE_BATAS.exec(t)) {
    bagian.push(t.slice(awal, m.index).trim());
    awal = m.index + m[0].length;
  }
  bagian.push(t.slice(awal).trim());
  const isi = bagian.filter(Boolean);
  if (isi.length <= 1) return isi[0] ?? t;
  // kata kerja dilesapkan: "tadi aku buka neraca, sekarang laba rugi dong" -> klausa terakhir pendek + partikel ajakan = minta buka laba rugi
  const akhir = isi[isi.length - 1];
  if (!cariVerba(akhir) && !adaKeAwal(akhir) && kata(akhir).length <= 5 && /\b(?:dong|aja|saja|deh|nih|ya|yuk|ayo|please|pls)\b/.test(akhir)) {
    for (let i = isi.length - 2; i >= 0; i--) {
      const vv = cariVerba(isi[i]);
      if (vv && vv.kuat) return `${isi[i].slice(vv.idx, vv.idx + vv.len)} ${akhir}`;
    }
  }
  // klausa terakhir yang punya kata kerja; kalau tak ada, klausa terakhir yang berisi
  for (let i = isi.length - 1; i >= 0; i--) if (cariVerba(isi[i]) || adaKeAwal(isi[i])) return isi[i];
  return isi[isi.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Pintu utama
// ---------------------------------------------------------------------------------------------
export function bacaNiat(mentah: string): HasilNiat {
  const asli = rapikanNiat(mentah);
  if (!asli) return { niat: 'netral', teks: '', alasan: 'kosong' };

  let t = buangPembuka(asli);

  // 2. koreksi diri
  const ralat = terapkanRalat(t);
  if (ralat.batal) return { niat: 'batal', teks: ralat.teks, alasan: 'koreksi-batal' };
  t = ralat.teks;

  // 3. klausa terakhir
  let k = buangPembuka(klausaTerakhir(t)).replace(/^(?:kalau|kalo|jadi|ya|if)\s+(?:gitu|begitu|begini|so|that is the case)\s+/, '');
  if (!k) return { niat: 'netral', teks: '', alasan: 'kosong' };

  // 4. negasi
  // "kenapa nggak / why don't we open X" = ajakan, bukan larangan
  k = k.replace(/^(?:why|kenapa|mengapa)\s+(?:dont|do not|tidak|ga|gak|nggak|ngga|enggak|engga)\s+/, 'kita ');
  let v = cariVerba(k);
  let keAwal = !v && adaKeAwal(k);
  const negs: { idx: number; len: number }[] = [];
  RE_NEG_G.lastIndex = 0;
  for (let m = RE_NEG_G.exec(k); m; m = RE_NEG_G.exec(k)) negs.push({ idx: m.index, len: m[0].length });
  // "bukan aset, ke pajak": negasi di depan, lalu "ke" + tujuan baru
  if (negs.length && !v && !keAwal) {
    const mk = /\bke\s+\S/.exec(k);
    if (mk && negs[0].idx < mk.index) {
      k = k.slice(mk.index).trim();
      keAwal = adaKeAwal(k);
    }
  }
  const adaKata = !!v || keAwal;
  if (negs.length && adaKata) {
    const verbaIdx = v ? v.idx : idxKeAwal(k);
    const verbaLen = v ? v.len : 2;
    const sebelum = negs.filter((n) => n.idx < verbaIdx).pop(); // negasi terdekat sebelum kata kerja
    const sesudah = negs.find((n) => n.idx >= verbaIdx + verbaLen);
    if (sebelum) {
      const antara = k.slice(sebelum.idx + sebelum.len, verbaIdx).trim();
      if (!antara || sepertiKosong(antara)) {
        // "jangan buka neraca", "ga usah dulu pindah" -> negasi menempel pada kata kerja;
        // tapi kalau sesudahnya ada perintah baru ("jangan buka neraca buka laba rugi") -> pakai yang terakhir
        const sisa = k.slice(verbaIdx + verbaLen);
        const v2 = cariVerba(sisa);
        const keBaru = /\bke\s+\S/.exec(sisa);
        if (v2 && v2.kuat) {
          k = sisa.slice(v2.idx).trim();
          v = cariVerba(k);
        } else if (keBaru && !sepertiKosong(sisa.slice(0, keBaru.index).trim())) {
          // "nggak mau ke penjualan, aku mau ke pembelian" -> tujuan baru setelah penolakan
          k = sisa.slice(keBaru.index).trim();
          v = null;
          keAwal = adaKeAwal(k);
        } else {
          return { niat: 'batal', teks: k, alasan: 'negasi-kata-kerja' };
        }
      } else {
        // "bukan neraca, buka laba rugi" -> objek yang ditolak dulu, perintah sesudahnya
        k = k.slice(verbaIdx).trim();
        v = cariVerba(k);
      }
    } else if (sesudah) {
      const objek = k.slice(verbaIdx + verbaLen, sesudah.idx).trim();
      if (objek && !sepertiKosong(objek)) {
        // "buka neraca bukan laba rugi", "ke aging jangan ke posted" -> yang ditolak dibuang
        k = k.slice(0, sesudah.idx).trim();
      } else {
        return { niat: 'batal', teks: k, alasan: 'negasi-sesudah-kata-kerja' };
      }
    }
  } else if (negs.length && !adaKata) {
    return { niat: 'netral', teks: k, alasan: 'negasi-tanpa-kata-kerja' };
  }

  // 5. niat
  const sebelumVerba = v ? k.slice(0, v.idx).trim() : '';

  // pertanyaan / permintaan penjelasan
  const sopan = RE_SOPAN.test(k);
  if (!sopan) {
    if (RE_TANYA_AWAL.test(k) || RE_TANYA_AKHIR.test(k) || RE_META_CARA.test(k)) return { niat: 'tanya', teks: k, alasan: 'tanya' };
    if (RE_JELASKAN.test(k) && !(v && v.kuat && RE_KUAT.exec(k)!.index < (RE_JELASKAN.exec(k)?.index ?? 0))) return { niat: 'tanya', teks: k, alasan: 'minta-penjelasan' };
  }

  // pengandaian
  // "kalau kamu nggak sibuk tolong buka X" = permintaan sopan; "kalau aku buka X apa yang muncul" = pengandaian
  if (RE_ANDAI.test(k) && !RE_ANDAI_SOPAN.test(k) && !/\b(?:tolong|please|pls|mohon|silakan|silahkan|coba|dong|kindly|bantu)\b/.test(k)) return { niat: 'ragu', teks: k, alasan: 'pengandaian' };
  const kSopan = k.replace(RE_ANDAI_SOPAN, '').trim() || k;

  // cerita masa lalu / bukan Neo yang diminta
  if (v || keAwal) {
    if (RE_LAMPAU.test(sebelumVerba + ' ') && !RE_ULANG.test(k)) return { niat: 'lampau', teks: k, alasan: 'lampau' };
    const pasif = !!v && /^di/.test(k.slice(v.idx)); // "klien dibuka dong" = minta membuka Klien, bukan klien yang membuka
    if (!pasif && sebelumVerba && RE_ORANG_LAIN.test(sebelumVerba + ' ') && !/\b(?:tolong|please|coba|bisa|boleh|bantu|suruh)\b/.test(sebelumVerba)) {
      return { niat: 'orang_lain', teks: k, alasan: 'orang-ketiga' };
    }
    return { niat: 'perintah', teks: kSopan, alasan: keAwal ? 'ke-awal' : v!.kuat ? 'kata-kerja-kuat' : 'kata-kerja-lemah' };
  }

  // tidak ada kata kerja sama sekali: kalau pendek, mungkin cuma menyebut nama ("neraca dong") -> biar lapis AI menilai
  if (kata(k).length <= 8 && !RE_LEMAH.test(k)) {
    if (RE_ORANG_LAIN_SINGKAT.test(k)) return { niat: 'orang_lain', teks: k, alasan: 'orang-ketiga-tanpa-verba' };
    return { niat: 'ragu', teks: k, alasan: 'tanpa-kata-kerja' };
  }
  return { niat: 'netral', teks: k, alasan: 'tanpa-kata-kerja' };
}
