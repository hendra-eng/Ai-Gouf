// hentikanSuara.ts
// =================
// [BARU] Pengenal perintah "berhenti bicara" untuk Neo (VoiceAssistant.tsx).
//
// Dulu hanya ~20 kata tunggal (POLA_STOP). Kalimat seperti "oke udah itu aja cukup", "kamu menjelaskannya
// kepanjangan", "stop disana" tidak dikenali, atau malah dikirim ke AI sebagai pertanyaan baru sehingga Neo
// menjawab lagi. Sekarang ada beberapa lapis:
//   1. JANGAN LANJUT : "jangan dilanjutkan", "tidak usah dijelasin", "lanjutkan nanti aja" -> berhenti.
//   2. PENJAGA       : "jangan berhenti", "belum paham", "lanjutkan", "ulangi" -> BUKAN berhenti.
//   3. POLA KUAT     : kata/frasa yang jelas berarti berhenti (stop, berhenti, "sudah cukup", "kepanjangan",
//                      "aku sudah paham", "nggak jadi", "hold on", ...). Kalimat TANYA ("berapa total sampai
//                      sini") tidak dihitung, kecuali memuat kata perintah eksplisit (stop/berhenti/diam/...).
//   4. POLA LEMAH    : kata ambigu (sudah, cukup, tunggu, sebentar) hanya dihitung kalau SELURUH ucapan pendek
//                      dan isinya cuma kata ajakan berhenti + kata pengisi ("oke udah itu aja cukup neo").
// Penjaga gema: ucapan yang cuma mengulang kata-kata Neo sendiri tidak dihitung, KECUALI menyebut "neo"
// atau berisi kata perintah kuat yang baru saja tidak diucapkan Neo (stop/berhenti/hentikan/diam).
//
// Contoh kalimat (ratusan) + uji: hentikanSuara.contoh.ts dan hentikanSuara.uji.ts

export type HasilBerhenti = {
  berhenti: boolean; // true = ucapan ini adalah ajakan agar Neo berhenti menjelaskan
  murni: boolean; // true = isinya HANYA ajakan berhenti (tidak perlu dikirim ke AI sebagai pertanyaan)
};

const rapikan = (t: string): string =>
  (t || '')
    .toLowerCase()
    .replace(/['’`]/g, '') // that's -> thats, don't -> dont
    .replace(/[.,!?;:"“”‘()\[\]{}…\-–—_/\\]/g, ' ')
    .replace(/\bs{3,}t*\b/g, 'sst') // "ssssst" (minta diam)
    .replace(/(.)\1{2,}/g, '$1') // "stooop" -> "stop", "sudaaah" -> "sudah", "cukuuup" -> "cukup"
    .replace(/\s+/g, ' ')
    .trim();

const NEG = String.raw`(?:jangan|jgn|janganlah|ga|gak|nggak|ngga|enggak|engga|tidak|tak)`;
// kata penutup yang boleh menempel di akhir ucapan ("udah paham kok neo", "sudah jelas terima kasih")
const AKHIR = String.raw`(?:\s+(?:kok|deh|nih|lah|dong|neo|nio|neu|ya|yah|banget|bgt|sih|aja|saja|tadi|kan|juga|dulu|sekarang|please|pls|plis|thanks|thank you|already|now|terima kasih|makasih|trims|thx|ok|oke))*$`;

// ---------- 1. JANGAN LANJUT (dicek PERTAMA, sebelum penjaga "lanjut") ----------
const POLA_JANGAN_LANJUT: RegExp[] = [
  new RegExp(
    String.raw`\b${NEG}(?:\s+(?:usah|perlu|lagi|mau|harus|pake|pakai|butuh|sampai|terlalu))*\s+(?:di)?(?:lanjut\w*|teruskan|terusin\w*|diteruskan|terusan|jelasin\w*|jelaskan\w*|menjelaskan|diterangkan|terangin\w*|menerangkan|penjelasan\w*|bicara\w*|ngomong\w*|berbicara|bercerita|cerita\w*|ceritain\w*|bahas\w*|membahas|ulang\w*|baca\w*|membaca|bacain\w*|sebut\w*|menyebut\w*|ucap\w*|panjang(?:\s+panjang)?|detail\w*|rinci\w*|banyak\s+(?:bicara|ngomong|omong|cerita))\b`
  ),
  // "lanjutkan nanti / besok" = tunda = berhenti sekarang
  /\b(?:di)?(?:lanjut\w*|teruskan|terusin\w*|sambung\w*)\s+(?:nanti|ntar|besok|lain kali|kapan kapan|belakangan|lagi nanti|next time|later)\b/,
  /\b(?:nanti|ntar|besok|lain kali|kapan kapan|next time|later)\s+(?:aja|saja|dulu|ya|deh|lagi|dong)\b/,
  /\b(?:dont|do not|no need to|no more)\s+(?:continue|go on|keep going|carry on|explain\w*|talk\w*|say\w*|speak\w*|read\w*)\b/,
];

// ---------- 2. PENJAGA: ini BUKAN ajakan berhenti ----------
const POLA_BUKAN: RegExp[] = [
  // "jangan berhenti", "tidak usah stop", "tidak cukup", "belum cukup"
  new RegExp(String.raw`\b(?:${NEG}|belum)\s+(?:usah\s+)?(?:berhenti|brenti|stop|setop|diam|henti\w*|cukup|selesai)`),
  // belum paham / kurang jelas / tidak mengerti -> justru butuh penjelasan
  /\b(?:belum|kurang|tidak|gak|ga|nggak|ngga|enggak|bukan|masih\s+belum|belum\s+terlalu)\s+(?:terlalu\s+|begitu\s+|banget\s+)?(?:paham|faham|ngerti|mengerti|ngeh|jelas|clear|tau|tahu|dapet|dapat|nangkep|ketangkep)\b/,
  /\b(?:dont|do\s+not|didnt|cant|cannot)\s+(?:get|understand|follow|know)\b/,
  /\bnot\s+(?:clear|sure)\b/,
  // minta lanjut / ulang
  /\b(?:lanjut\w*|terusin\w*|teruskan|terus\s+(?:aja|saja|dong|ya)|go\s+on|continue|keep\s+going|carry\s+on|ulangi|ulang\s+lagi|repeat|jelaskan\s+lagi|jelasin\s+lagi|sekali\s+lagi|lagi\s+dong|again|please\s+continue)\b/,
];

// ---------- 3. POLA KUAT ----------
// 3a. Kata perintah eksplisit + keluhan: berlaku walau kalimatnya mirip pertanyaan
const POLA_PERINTAH: RegExp[] = [
  /\b(?:s+t+o+p+|setop+|stap|stup|stob|estop|istop|stopin|stopkan)\b/,
  /\b(?:berhenti(?:lah|kan)?|brenti(?:lah)?|berenti(?:lah)?|bhenti|henti|hentikan(?:lah)?|hentiin|menghentikan|diam(?:lah|kan)?|diem(?:lah)?|tutup\s+mulut(?:mu|nya)?|sst+|shh+|shush|quiet|silence|shut\s?up|be\s?quiet|quit|cut\s+it\s+out|knock\s+it\s+off|enough\s+already|pause)\b/,
  /\b(?:sudahi|sudahin|udahi|udahin|akhiri|akhirin|diakhiri)\b/,
  // keluhan terlalu panjang / bertele-tele
  /\b(?:kepanjangan|kepanjangn|kepanjang|terlalu\s+panjang|panjang\s+(?:banget|bgt|amat|bener|sekali|kali)|kelamaan|terlalu\s+lama|lama\s+(?:banget|bgt|amat|bener|sekali|kali)|bertele\s?tele|berbelit(?:\s?belit)?|muter\s?muter|ngelantur|melantur|ngalor\s?ngidul|kebanyakan\s+(?:ngomong|bicara|cerita|omong|ngoceh|penjelasan)|terlalu\s+banyak\s+(?:bicara|ngomong|cerita|omong|penjelasan)|banyak\s+(?:bicara|omong|ngomong)|cerewet|bawel|berisik|ngoceh|nyerocos|ceramah\w*|gak\s+kelar|ga\s+kelar|nggak\s+kelar|ngga\s+kelar|kelar\s+kelar|too\s+long|too\s+much|too\s+wordy|wordy|long\s?winded|talk\w*\s+too\s+(?:much|long)|you\s+talk\s+too\s+much)\b/,
  // matikan suara / jangan bersuara
  /\b(?:matikan|matiin|mute|bungkam|kecilkan|kecilin)\s+(?:suara\w*|volume\w*|mulut\w*|speaker\w*|bicara\w*|ngomong\w*)\b/,
  /\bmute\b/,
];

// 3b. Frasa kuat lainnya (kalimat TANYA yang panjang tidak dihitung, mis. "berapa total sampai sini")
const POLA_KUAT: RegExp[] = [
  // "sudah cukup", "udah udah", "cukup cukup", "cukup neo", "cukup sampai sini", "cukup segitu"
  /\b(?:cukup|udah|sudah|dah|uda|wes)(?:lah)?\s+(?:cukup|udah|sudah|dah|uda)(?:lah)?\b/,
  /\bcukup(?:lah)?\s+(?:neo|nio|neu|sampai|sampe|segitu|segini|itu|sini|situ|disini|disitu|dulu|ya|yah|deh|dong|aja|saja|sekian|penjelasan\w*|jelas\w*|menjelaskan\w*|cerita\w*|ngomong\w*|bicara\w*|ceramah\w*)\b/,
  /\bcukup(?:lah)?\s+(?:untuk\s+)?(?:sekarang|hari\s+ini|saat\s+ini|kali\s+ini)\b/,
  /\b(?:udah|sudah|dah|yaudah|yasudah|ya\s+udah|ya\s+sudah)(?:lah)?\s+(?:deh|lah|dong|aja|saja|itu|segitu|sekian|cukup|neo|nio|neu|stop|ya)\b/,
  /\b(?:yaudah|yasudah|sudahlah|udahlah|dahlah|cukuplah|sekian)\b/,
  /\b(?:itu|segitu|segini|begitu|sekian|ini)\s+(?:aja|saja|dulu)\b/,
  new RegExp(String.raw`\b(?:itu|segitu|segini|begitu|sekian|ini)\s+(?:cukup|sudah|udah|dah)${AKHIR}`),
  /\b(?:sampai|sampe)\s+(?:di\s+)?(?:sini|situ|sana|disini|disitu|disana|segitu|segini|sekian)\b/,
  // sela / tahan
  /\b(?:tunggu|sebentar|bentar|wait|hold\s+on|hold\s+up|hang\s+on|tahan)\s+(?:tunggu|sebentar|bentar|wait|dulu|neo|nio|neu|deh|dong|ya)\b/,
  /\b(?:tunggu|sebentar|bentar|wait)\s+(?:tunggu|sebentar|bentar|wait)\b/,
  /\b(?:hold\s+on|hold\s+up|hang\s+on|one\s+sec(?:ond)?|just\s+a\s+(?:sec|second|moment|minute)|wait\s+a\s+(?:sec|second|moment|minute)|time\s?out|jeda(?:\s+dulu)?|tahan\s+dulu)\b/,
  // batalkan permintaan / lupakan
  /\b(?:gak|ga|nggak|ngga|enggak|tidak)\s+jadi\b/,
  /\b(?:lupakan|lupain|abaikan|forget\s+it|never\s?mind|ignore\s+that|skip\s+(?:it|this|that|ini|itu|aja|saja|dulu)|lewati(?:\s+(?:itu|ini|aja|saja))?|lewatin|lewatkan)\b/,
  // berbahasa Inggris
  /\b(?:thats|that\s+is|its|it\s+is)\s+(?:enough|all|it)\b/,
  /\b(?:enough|thats\s+all|thats\s+it|no\s+more|please\s+stop)\b/,

  // ---------- [BARU] keluarga ucapan yang TIDAK memakai kata "stop" tapi jelas berarti berhenti ----------
  // CATATAN: "makasih" / "terima kasih" SENGAJA tidak ada di sini. Saat Neo bicara itu sering cuma anggukan sopan
  // (backchannel), bukan minta berhenti. Maknanya bergantung konteks -> diserahkan ke penilai AI (hentikanCerdas.ts).
  // sudah tahu / sudah dapat gambarannya / dicatat: "aku udah tau itu", "udah kebayang", "gambarannya udah dapet", "oke noted"
  new RegExp(String.raw`\b(?:sudah|udah|dah|uda)\s+(?:tau|tahu|kebayang|dapet|dapat|ketangkep)(?:\s+(?:itu|hal\s+itu|gambarannya|gambaran|intinya|poinnya|maksudnya|kok|deh))?${AKHIR}`),
  /\b(?:gambaran\w*|inti\w*|poin\w*|maksud\w*)\s+(?:udah|sudah)\s+(?:dapet|dapat|jelas|ketangkep|kebayang|ngerti|paham)\b/,
  new RegExp(String.raw`^(?:oke|ok|okay|iya|ya|sip|siap)?\s*(?:noted|gotcha|dicatat|catat|copy|roger|understood)${AKHIR}`),
  new RegExp(String.raw`^(?:oke|ok|okay|iya|ya|sip|siap|nah|baik|hmm)?\s*(?:udah\s+|sudah\s+)?jelas${AKHIR}`),
  // mengambil giliran bicara: "neo neo", "dengerin aku dulu", "aku mau ngomong dulu", "biar aku bicara", "giliranku", "maaf aku potong"
  /\b(?:neo|nio|neu)\s+(?:neo|nio|neu)\b/,
  /\b(?:dengerin|dengarkan|dengarin)\s+(?:aku|saya|gue|gw|dulu)\b/,
  /\b(?:aku|saya|gue|gw)\s+(?:mau|pengen|ingin|pingin|boleh|izin)\s+(?:ngomong|bicara|berbicara|bilang|nanya|tanya|menyela|motong|memotong)(?:\s+(?:dulu|sebentar|bentar|nih|deh|ya|dong|neo))*$/,
  /\b(?:giliranku|giliran\s+(?:aku|saya|gue|gw))\b/,
  /\bbiar(?:in)?\s+(?:aku|saya|gue|gw)\s+(?:yang\s+)?(?:bicara|ngomong|tanya|nanya|jelasin|jelaskan)\b/,
  /\b(?:aku\s+)?(?:potong|motong|memotong|menyela|nyela|interupsi)\b/,
  /^(?:permisi|maaf|excuse\s+me|sorry|pardon)(?:\s+(?:neo|nio|neu|ya|dong|dulu|sebentar|bentar))*$/,
  // jeda lain & "gitu aja"
  /\b(?:break|istirahat)\s+dulu\b/,
  /\b(?:gitu|gini|gt)\s+(?:aja|saja|dulu|cukup|udah|sudah)\b/,
  // "tidak perlu lagi" (seluruh ucapan)
  /\b(?:udah|sudah|dah)?\s*(?:gak|ga|nggak|ngga|enggak|tidak|tak)\s+(?:usah|perlu|butuh)(?:\s+(?:lagi|neo|nio|ya|deh|dong|kok|lanjut|dilanjut\w*|dijelasin|dijelaskan))*$/,
  // keluhan jenuh mendengar
  /\b(?:bosen|bosan|ngantuk|mengantuk|capek|cape|lelah|jenuh|eneg|enek|pusing|pening)\s+(?:dengerin\w*|dengernya|dengar\w*|denger|nih|banget)\b/,
];

// 3c. "Sudah paham" -> tidak perlu dijelaskan lagi (tidak berlaku untuk kalimat tanya "sudah paham belum?")
const POLA_PAHAM: RegExp[] = [
  new RegExp(String.raw`\b(?:sudah|udah|dah|uda|wes)\s+(?:paham|faham|ngerti|mengerti|ngeh|jelas|clear|tau|tahu|dapet|dapat|nangkep|ketangkep)${AKHIR}`),
  new RegExp(String.raw`\b(?:aku|saya|gue|gw|gua|kami|kita|w)\s+(?:paham|faham|ngerti|mengerti|ngeh|tau|tahu|dapet|dapat|nangkep)${AKHIR}`),
  new RegExp(String.raw`\b(?:oke|ok|okay|okey|iya|ya|yap|yoi|nah|sip|siap|baik|oh|eh|hmm)?\s*(?:paham|faham|ngerti|mengerti|ngeh)(?:\s+(?:paham|ngerti|mengerti))?${AKHIR}`),
  new RegExp(String.raw`\b(?:cukup|sangat|sudah\s+sangat|udah\s+sangat)\s+jelas${AKHIR}`),
  /\b(?:iya|ya|oke|ok|yoi|yap|okay)\s+(?:iya|ya|oke|ok|yoi|yap|okay)\s+(?:iya|ya|oke|ok|paham|ngerti|udah|sudah|tau|tahu|jelas|cukup)\b/,
  /\b(?:ya\s+ya|iya\s+iya|oke\s+oke|ok\s+ok|okay\s+okay|siap\s+siap|yoi\s+yoi)$/,
  /\bi\s+(?:get|got|understand|understood|know)(?:\s+(?:it|that))?(?:\s+(?:already|now|thanks|thank\s+you|neo))*$/,
  /^(?:(?:ok|okay|yes|yeah|alright)\s+)?(?:got\s+it|understood)(?:\s+(?:already|now|thanks|thank\s+you|neo))*$/,
];

const KATA_TANYA = new Set(['apa', 'apakah', 'berapa', 'kenapa', 'mengapa', 'bagaimana', 'gimana', 'kapan', 'siapa', 'mana', 'dimana', 'kemana', 'what', 'why', 'how', 'when', 'who', 'where', 'which']);

// ---------- 4. POLA LEMAH (bag-of-words) ----------
const KATA_LEMAH = new Set([
  'sudah', 'udah', 'dah', 'uda', 'wes', 'cukup', 'cukuplah', 'tunggu', 'tungguin', 'sebentar', 'bentar', 'wait', 'enough', 'jeda', 'tahan',
  'pause', 'yaudah', 'yasudah', 'sudahlah', 'udahlah', 'dahlah', 'sekian', 'kebanyakan',
]);
const KATA_PENGISI = new Set([
  'oke', 'ok', 'okay', 'okey', 'okelah', 'baik', 'baiklah', 'sip', 'siap', 'nah', 'eh', 'ehh', 'ah', 'hmm', 'hm', 'em', 'ya', 'yah', 'iya', 'yaa',
  'dong', 'deh', 'lah', 'sih', 'nih', 'tuh', 'kok', 'dulu', 'aja', 'saja', 'please', 'pls', 'plis', 'tolong', 'mohon', 'kamu', 'kau', 'anda',
  'lu', 'lo', 'you', 'neo', 'nio', 'neu', 'hey', 'hei', 'hai', 'halo', 'bro', 'kak', 'mas', 'mbak', 'pak', 'bu', 'itu', 'ini', 'sini', 'situ',
  'sana', 'disini', 'disitu', 'disana', 'di', 'ke', 'sampai', 'sampe', 'segitu', 'segini', 'cuma', 'hanya', 'tadi', 'sekarang', 'banget', 'bgt',
  'lagi', 'ayo', 'yuk', 'dan', 'terus', 'makasih', 'terima', 'kasih', 'thanks', 'thank', 'tks', 'trims', 'penjelasannya', 'penjelasan',
  'jelasnya', 'menjelaskannya', 'menjelaskan', 'jelasin', 'jelaskan', 'ngomongnya', 'bicaranya', 'bicara', 'ngomong', 'ceritanya', 'cerita',
  'bercerita', 'kali', 'nya', 'untuk', 'a', 'the', 'now', 'right', 'it', 'that', 'thats', 'is',
]);
const KATA_NEO = new Set(['neo', 'nio', 'neu']);
const KATA_KUAT_TUNGGAL = new Set(['stop', 'setop', 'stap', 'stup', 'stob', 'berhenti', 'brenti', 'berenti', 'hentikan', 'henti', 'diam', 'diem', 'quiet', 'silence', 'quit']);

// Apakah ucapan ini cuma pantulan (gema) kata-kata Neo sendiri?
function gemaNeo(t: string, teksNeo: string): boolean {
  if (!teksNeo) return false;
  const kata = t.split(' ').filter(Boolean);
  if (kata.length === 0) return true;
  if (kata.some((k) => KATA_NEO.has(k))) return false; // menyebut "neo" = jelas bicara ke Neo, bukan gema
  const neo = ` ${rapikan(teksNeo)} `;
  if (kata.length === 1) {
    if (KATA_KUAT_TUNGGAL.has(kata[0])) return neo.slice(-300).includes(` ${kata[0]} `); // hanya bila baru saja diucapkan Neo
    return neo.includes(` ${kata[0]} `);
  }
  return neo.includes(` ${t} `); // seluruh kalimat identik dengan potongan ucapan Neo
}

export function bacaBerhenti(teks: string, teksNeo = ''): HasilBerhenti {
  const t = rapikan(teks);
  const tidak: HasilBerhenti = { berhenti: false, murni: false };
  if (!t) return tidak;
  const kata = t.split(' ');
  const n = kata.length;
  if (gemaNeo(t, teksNeo)) return tidak;

  const dalamBatas = (m: RegExpMatchArray) => {
    // ucapan panjang (> 10 kata) hanya dihitung bila ajakan berhenti ada di awal / akhir kalimat
    const mulai = t.slice(0, m.index ?? 0).split(' ').filter(Boolean).length;
    const akhir = mulai + m[0].split(' ').filter(Boolean).length;
    return n <= 10 || mulai < 4 || n - akhir < 4;
  };
  const cari = (pola: RegExp[]) => pola.map((p) => t.match(p)).filter((m): m is RegExpMatchArray => !!m && dalamBatas(m));
  const hitungMurni = (cocok: RegExpMatchArray[]) => {
    let sisa = t;
    for (const m of cocok) sisa = sisa.replace(m[0], ' ');
    return sisa.split(' ').filter((k) => k && !KATA_PENGISI.has(k) && !KATA_LEMAH.has(k)).length <= 1;
  };
  const ya = (cocok: RegExpMatchArray[]): HasilBerhenti => ({ berhenti: true, murni: hitungMurni(cocok) });

  // 1) "jangan dilanjutkan", "lanjutkan nanti" -> berhenti
  const jl = cari(POLA_JANGAN_LANJUT);
  if (jl.length) return ya(jl);

  // 2) penjaga: "jangan berhenti", "belum paham", "lanjutkan", "ulangi" -> BUKAN berhenti
  if (POLA_BUKAN.some((p) => p.test(t))) return tidak;

  // 3a) kata perintah eksplisit / keluhan
  const perintah = cari(POLA_PERINTAH);
  if (perintah.length) return ya(perintah);

  // 3b/3c) frasa kuat: bukan untuk kalimat tanya yang panjang
  const tanya = kata.some((k) => KATA_TANYA.has(k)) || /\?/.test(teks || '');
  if (!(tanya && n > 3)) {
    const kuat = cari([...POLA_KUAT, ...POLA_PAHAM]);
    if (kuat.length) return ya(kuat);
  }

  // 4) pola lemah: seluruh ucapan pendek dan hanya berisi kata ajakan berhenti + pengisi
  if (n <= 8 && kata.some((k) => KATA_LEMAH.has(k)) && kata.every((k) => KATA_LEMAH.has(k) || KATA_PENGISI.has(k))) {
    return { berhenti: true, murni: true };
  }
  return tidak;
}