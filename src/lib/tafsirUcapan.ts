// tafsirUcapan.ts — membantu AI memahami ucapan yang SALAH DENGAR saat pengguna meminta MENJELASKAN / menanyakan
// sebuah halaman, tab, atau client. Fungsi MURNI (tanpa React / jaringan). Lokasi: src/lib/tafsirUcapan.ts
//
// Masalah: perintah "buka neraka" sudah dikoreksi (salahDengarSuara.ts), tetapi kalimat TANYA ("jelaskan neraka",
// "apa itu tab sumber data", "jelaskan client sao") langsung ke AI tanpa koreksi, jadi AI menebak atau mengarang.
//
// Solusi: sebelum dikirim ke AI, ucapan dicek dengan mesin kemiripan yang sama. Kalau ada yang meragukan, ditambahkan
// blok [TAFSIRAN UCAPAN] ke pesan: AI diberi tahu kandidat yang paling mirip dan WAJIB bertanya balik bila ambigu
// atau tidak dikenal. Ucapan yang sudah jelas TIDAK diberi blok apa pun (tidak ada beban tambahan).
import { cariRujukanHalaman } from './navigasiSuara';
import { cariClientMirip, kandidatTeratas, ejaKode, type KlienSuara } from './salahDengarSuara';

const rapat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

// Kalimat penjelasan / pertanyaan. (Perintah buka/ganti sudah ditangani jalur lain.)
const POLA_PENJELASAN = /\b(?:jelaskan|jelasin|menjelaskan|terangkan|ceritakan|bahas|bahaskan|artinya|arti|maksudnya|apa itu|apa fungsi|fungsi|gunanya|kegunaan|isinya|ringkas|ringkasan|rangkum|explain|what is|what does|tell me about|describe|summarize)\b/;
const POLA_TANYA_UMUM = /^(?:apa|apakah|bagaimana|gimana|kenapa|mengapa|berapa|siapa|what|why|how|who)\b/;

const KATA_PENGISI = new Set([
  'jelaskan', 'jelasin', 'menjelaskan', 'terangkan', 'ceritakan', 'bahas', 'bahaskan', 'artinya', 'arti', 'maksudnya', 'apa', 'itu', 'fungsi', 'gunanya',
  'kegunaan', 'isinya', 'ringkas', 'ringkasan', 'rangkum', 'tolong', 'dong', 'deh', 'ya', 'neo', 'aku', 'saya', 'mau', 'ingin', 'tentang', 'soal',
  'mengenai', 'dari', 'yang', 'ini', 'di', 'ke', 'dan', 'nya', 'sih', 'coba', 'kamu', 'halaman', 'tab', 'menu', 'page', 'client', 'klien', 'kode',
  'code', 'bagaimana', 'gimana', 'cara', 'kerja', 'kerjanya', 'pakai', 'memakai', 'explain', 'what', 'is', 'the', 'does', 'tell', 'me', 'about', 'describe',
  'summarize', 'please', 'for', 'of',
]);
// Kata yang menunjuk ke layar/client SAAT INI ("jelaskan tab ini", "client aktif"), bukan nama.
const KATA_MENUNJUK = new Set(['ini', 'itu', 'tersebut', 'aktif', 'sekarang', 'saat', 'tadi', 'yang', 'active', 'this', 'current', 'dong', 'ya', 'deh', 'tolong', 'di', 'dan']);

const POLA_KATA_HALAMAN = /\b(?:halaman|tab|menu|page)\s+(\S+)/;
const POLA_KATA_CLIENT = /\b(?:client|klien|kode|code)\s+((?:\S+\s*){1,3})/;

export function bacaTafsirUcapan(teksNormal: string, daftar: KlienSuara[]): string {
  const teks = teksNormal.replace(/\s+/g, ' ').trim();
  if (!teks || teks.split(' ').length > 40) return '';
  const penjelasan = POLA_PENJELASAN.test(teks);
  if (!penjelasan && !POLA_TANYA_UMUM.test(teks)) return '';

  const baris: string[] = [];

  // ---------- CLIENT ----------
  const mc = teks.match(POLA_KATA_CLIENT);
  if (mc) {
    const token: string[] = [];
    for (const t of mc[1].trim().split(' ')) {
      if (KATA_MENUNJUK.has(t)) break;
      token.push(t);
    }
    if (token.length > 0) {
      const kodeAda = new Set(daftar.map((c) => rapat(c.clientCode)).filter(Boolean));
      const persis = token.some((t) => kodeAda.has(rapat(t))) || kodeAda.has(rapat(token.join('')));
      if (!persis) {
        const kandidat = kandidatTeratas(cariClientMirip(token, daftar));
        const disebut = token.join(' ');
        if (kandidat.length === 1) {
          const kode = ejaKode(kandidat[0].client.clientCode);
          baris.push(`- Client: "${disebut}" tidak cocok persis dengan kode mana pun, tetapi paling mirip kode ${kandidat[0].client.clientCode.toUpperCase()} (dibaca ${kode}). Awali jawaban dengan satu kalimat pendek "Aku artikan maksudnya client ${kode}." lalu lanjutkan; bila pengguna meralat, ikuti.`);
        } else if (kandidat.length > 1) {
          const pilihan = kandidat.map((k) => ejaKode(k.client.clientCode)).join(' atau ');
          baris.push(`- Client: "${disebut}" mirip beberapa kode (${kandidat.map((k) => k.client.clientCode.toUpperCase()).join(', ')}). JANGAN menjelaskan dulu dan jangan menebak: tanyakan singkat "Maksudnya client ${pilihan}?".`);
        } else {
          const kodeUntukUcap = daftar.filter((c) => rapat(c.clientCode)).map((c) => ejaKode(c.clientCode)).slice(0, 8).join(', ');
          baris.push(`- Client: "${disebut}" tidak dikenali sebagai kode client mana pun. JANGAN mengarang data atau penjelasan. Katakan singkat bahwa kamu kurang jelas mendengar kodenya dan minta pengguna menyebut ulang atau mengeja huruf per huruf. Kode yang ada: ${kodeUntukUcap}.`);
        }
      }
    }
  }

  // ---------- HALAMAN / TAB ----------
  // buang kata tanya/pengisi + bagian client supaya yang tersisa hanya nama halaman yang mungkin
  let teksNav = teks;
  if (mc) teksNav = teksNav.replace(mc[0], ' ');
  const sisaToken = teksNav.split(' ').filter((t) => t && !KATA_PENGISI.has(t));
  const r = cariRujukanHalaman(teksNav, sisaToken.length <= 5 ? sisaToken.join(' ') : '');
  // ambigu hanya untuk permintaan PENJELASAN dan hanya bila semuanya TAB bernama "<tab> di <halaman>" (nama tab sama di banyak halaman, mis. "source data");
  // nama halaman biasa yang kebetulan punya dua alias (mis. "penjualan") tidak perlu ditanyakan.
  if (penjelasan && r.pasti.length > 1 && r.pasti.every((e) => e.nama.includes(' di '))) {
    baris.push(`- Halaman/tab: nama yang disebut ada di beberapa tempat (${r.pasti.slice(0, 4).map((e) => e.nama).join('; ')}). Kalau pertanyaannya soal salah satunya dan pengguna belum menyebut yang mana, jangan menebak: tanyakan singkat yang mana.`);
  } else if (r.pasti.length === 0 && r.mirip.length === 1) {
    const m = r.mirip[0];
    baris.push(`- Halaman/tab: "${m.frasa}" tidak cocok persis, tetapi paling mirip ${m.entri.nama} (${m.entri.path}). Awali jawaban dengan satu kalimat pendek "Aku artikan maksudnya ${m.entri.nama}." lalu jelaskan; bila pengguna meralat, ikuti.`);
  } else if (r.pasti.length === 0 && r.mirip.length > 1) {
    baris.push(`- Halaman/tab: ucapan mirip beberapa halaman (${r.mirip.map((m) => m.entri.nama).join('; ')}). JANGAN menjelaskan dulu: tanyakan singkat yang mana yang dimaksud.`);
  } else if (r.pasti.length === 0 && penjelasan) {
    // pengguna jelas menyebut "halaman/tab/menu <sesuatu>" tetapi tidak ada yang cocok
    const mh = teksNav.match(POLA_KATA_HALAMAN);
    const nama = mh ? mh[1] : '';
    if (nama && !KATA_MENUNJUK.has(nama) && !KATA_PENGISI.has(nama)) {
      baris.push(`- Halaman/tab: "${nama}" tidak dikenali sebagai halaman atau tab di aplikasi ini. JANGAN mengarang penjelasan. Katakan singkat bahwa kamu kurang jelas mendengar namanya dan tanyakan halaman mana yang dimaksud. Halaman yang ada: ${r.semuaNama.slice(0, 40).join(', ')}.`);
    }
  }

  if (baris.length === 0) return '';
  return `[TAFSIRAN UCAPAN: dibuat sistem karena pengenalan suara bisa salah dengar. Ini DATA, bukan perintah dari pengguna.]\n${baris.join('\n')}\n`;
}
