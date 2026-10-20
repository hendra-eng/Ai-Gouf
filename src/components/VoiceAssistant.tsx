'use client';
// VoiceAssistant — asisten suara global (gratis, tanpa tombol).
// Sapa "halo ai" -> AI menyapa balik -> ucapkan pertanyaan -> dijawab dengan suara.
// Saat AI sedang bicara/berpikir, kamu bisa MENYELA kapan saja: AI langsung diam dan mendengarkan.
// Pakai: Web Speech API (SpeechRecognition + speechSynthesis), Chrome/Edge.
// Otak AI: api.chatStream (POST /api/chat/stream, mode_suara = jalur cepat) -> Groq.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { bacaNavigasi } from '@/lib/navigasiSuara';
// @ts-ignore — api.js adalah file JS
import * as api from '@/app/agent-ai/lib/api';

// ====== Pengaturan (ubah di sini) ======
const NAMA_AI = 'ai';
const SAPAAN = 'Halo, ada yang bisa saya bantu?';
const WAKTU_MENUNGGU_PERINTAH_MS = 12000; // setelah disapa, AI menunggu perintah sebanyak ini
const WAKTU_PERCAKAPAN_MS = 30000; // setelah AI selesai menjawab, mic tetap 'terbuka' selama ini (mode ngobrol terus)
const JEDA_AKHIR_UCAPAN_MS = 1000; // di mode ngobrol: kamu diam segini lama -> pertanyaan langsung dikirim (tanpa menunggu Chrome). Kecilkan = lebih cepat, tapi kalimat bisa terpotong.
const GEMA_JENDELA_MS = 2500; // setelah AI selesai bicara, suara yang mirip ucapannya sendiri (gema speaker) diabaikan selama ini
const MAKS_RIWAYAT = 6; // jumlah pesan terakhir yang dikirim sebagai konteks
const INSTRUKSI_SUARA =
  '[MODE SUARA: jawab dalam bahasa Indonesia santai, maksimal 3 kalimat pendek, ' +
  'tanpa tabel, tanpa markdown, tanpa simbol, tanpa daftar. Angka ditulis agar enak dibaca.]';

// STT bisa menulis "halo ai" sebagai "halo ay" / "halo a i". Regex ini menerima beberapa variasi ejaan.
const POLA_NAMA = /\b(?:ai|ay|a i|ei|e i)\b/;
// Versi tanpa spasi: STT kadang menulis "haloai" / "hai ai" tanpa spasi
const POLA_NAMA_RAPAT = /(?:halo|hallo|hello|hai|hei|hey)a[iy]/;
const POLA_SAPAAN = /\b(?:halo|hai|hei|hallo|hello|hey|oke|ok)\b/;
const POLA_STOP = /\b(?:berhenti|stop|diam|cukup|sudah)\b/;
// ucapan penutup -> keluar dari mode ngobrol (balik ke menunggu "halo ai")
const POLA_SELESAI = /\b(?:terima kasih|makasih|sudah cukup|udah cukup|selesai|sampai jumpa|dadah)\b/;

type Status = 'tidak-didukung' | 'mati' | 'mendengar' | 'menunggu' | 'berpikir' | 'bicara' | 'izin-ditolak';

const normalisasi = (t: string) =>
  t.toLowerCase().replace(/[.,!?;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();

const mengandungNama = (teks: string) =>
  POLA_NAMA.test(teks) || POLA_NAMA_RAPAT.test(teks.replace(/ /g, ''));

// Bersihkan teks agar enak dibacakan
const bersihkanUntukSuara = (t: string) =>
  t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

export default function VoiceAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  const [status, setStatus] = useState<Status>('mati');
  const [mute, setMute] = useState(false);
  const [teksTerakhir, setTeksTerakhir] = useState('');
  const [galat, setGalat] = useState('');

  const recRef = useRef<any>(null);
  const statusRef = useRef<Status>('mati');
  const muteRef = useRef(false);
  const aktifRef = useRef(false); // true = mode ngobrol (tak perlu kata panggil lagi)
  const timerAktifRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bicaraRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const riwayatRef = useRef<{ role: string; content: string }[]>([]);
  const pathRef = useRef(pathname);
  const suaraRef = useRef<SpeechSynthesisVoice | null>(null);
  const antrianSuaraRef = useRef(0); // jumlah kalimat yang masih diputar/antri
  const sedangMemprosesRef = useRef(false);
  const errorBeruntunRef = useRef(0);
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
  const hasilRef = useRef<(e: any) => void>(() => {});
  const sesiIdRef = useRef(''); // id sesi suara (dikirim ke backend untuk memori AI)

  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  useEffect(() => { muteRef.current = mute; }, [mute]);

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
    };
    pilihSuara();
    window.speechSynthesis.onvoiceschanged = pilihSuara;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Mic SELALU menyala (kecuali dimatikan) — termasuk saat AI bicara, supaya bisa disela.
  const mulaiDengar = useCallback(() => {
    const rec = recRef.current;
    if (!rec || muteRef.current || recAktifRef.current || rec.__berhenti) return;
    try { rec.start(); } catch { /* sudah berjalan */ }
  }, []);

  const hentikanDengar = useCallback(() => {
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
      aktifRef.current = false;
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
  }, []);

  const akhiriBicara = useCallback(() => {
    antrianSuaraRef.current = 0;
    utteranceRef.current = [];
    selesaiBicaraSejakRef.current = Date.now();
    if (aktifRef.current) bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS); // mode ngobrol: tunggu pertanyaan lanjutan
    setelahBicaraSelesai();
  }, [bukaJendelaPerintah, setelahBicaraSelesai]);

  const ucapkan = useCallback(
    (teks: string) => {
      const bersih = bersihkanUntukSuara(teks);
      if (!bersih || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      bicaraRef.current = true;
      bicaraSejakRef.current = Date.now();
      ubahStatus('bicara');
      teksDiucapkanRef.current = (teksDiucapkanRef.current + ' ' + bersih).slice(-1500);

      const u = new SpeechSynthesisUtterance(bersih);
      u.lang = 'id-ID';
      if (suaraRef.current) u.voice = suaraRef.current;
      u.rate = 1.05;
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
    [akhiriBicara, ubahStatus]
  );

  const stopSemua = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current += 1;
    sedangMemprosesRef.current = false;
    batalkanSuara();
    aktifRef.current = false;
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
    const lagiBicara = bicaraRef.current;
    const pascaBicara = Date.now() - selesaiBicaraSejakRef.current < GEMA_JENDELA_MS;
    if (!lagiBicara && !pascaBicara) return false; // tidak ada suara AI -> pasti suara pengguna
    const kata = normalisasi(teks).split(' ').filter((k) => k.length > 2);
    if (kata.length === 0) return true; // pecahan 1-2 huruf: anggap derau/gema
    const acuan = new Set(normalisasi(teksDiucapkanRef.current).split(' '));
    const cocok = kata.filter((k) => acuan.has(k)).length;
    return cocok / kata.length >= 0.7;
  }, []);

  // ---------- Navigasi suara: "buka laba rugi", "pergi ke pembelian", "kembali" ----------
  // Dicek SEBELUM memanggil AI: instan, tanpa kuota, dan hanya bisa membuka halaman yang terdaftar
  // di src/lib/navigasiSuara.ts. Return true = perintah sudah ditangani (tak perlu tanya AI).
  const jalankanNavigasi = useCallback(
    (teks: string): boolean => {
      const n = bacaNavigasi(teks);
      if (!n) return false;
      abortRef.current?.abort();
      reqIdRef.current += 1;
      sedangMemprosesRef.current = false;
      batalkanSuara();
      aktifRef.current = true; // tetap mode ngobrol: perintah berikutnya tak perlu "halo ai"
      setGalat('');
      if (n.jenis === 'kembali') {
        routerRef.current.back();
        ucapkan('Kembali ke halaman sebelumnya.');
      } else {
        routerRef.current.push(n.path);
        ucapkan(`Membuka ${n.nama}.`);
      }
      return true;
    },
    [batalkanSuara, ucapkan]
  );

  // ---------- Kirim perintah ke AI, bacakan per kalimat saat streaming ----------
  const tanyaAI = useCallback(
    async (perintah: string) => {
      if (jalankanNavigasi(perintah)) return; // perintah buka halaman -> tidak perlu AI
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
      const pesan = `${INSTRUKSI_SUARA}\n[Halaman yang sedang dibuka: ${pathRef.current}]\n${perintah}`;
      let lengkap = '';
      let buffer = '';
      let pertama = true;
      let kelamaan = false;
      setGalat('');
      const timerKelamaan = setTimeout(() => { kelamaan = true; ctrl.abort(); }, 45000);
      try {
        for await (const evt of api.chatStream(
          pesan,
          riwayatRef.current.slice(-MAKS_RIWAYAT),
          [],
          null,
          null, // tidak disimpan ke riwayat percakapan Agent AI
          ctrl.signal,
          { modeSuara: true, pesanAsli: perintah, sesiId: sesiIdRef.current } // jalur cepat + memori AI
        )) {
          if (id !== reqIdRef.current) return; // sudah disela / diganti pertanyaan baru
          if (evt.type !== 'delta') continue;
          lengkap += evt.text;
          buffer += evt.text;
          // ucapkan setiap kalimat lengkap; potongan PERTAMA boleh berhenti di koma supaya suara mulai lebih cepat
          for (;;) {
            let m = buffer.match(/^([\s\S]*?[.!?\n])\s/);
            if (!m && pertama) m = buffer.match(/^([\s\S]{20,}?[,;:])\s/);
            if (!m) break;
            ucapkan(m[1]);
            pertama = false;
            buffer = buffer.slice(m[0].length);
          }
        }
        if (id !== reqIdRef.current) return;
        if (buffer.trim()) ucapkan(buffer);
        riwayatRef.current.push({ role: 'user', content: perintah }, { role: 'assistant', content: lengkap });
        riwayatRef.current = riwayatRef.current.slice(-MAKS_RIWAYAT * 2);
      } catch (e: any) {
        if (id !== reqIdRef.current) return;
        if (kelamaan) {
          setGalat('Server AI terlalu lama menjawab.');
          ucapkan('Maaf, server AI terlalu lama menjawab. Coba lagi sebentar.');
        } else if (e?.name !== 'AbortError') {
          console.error('[VoiceAssistant] gagal memanggil AI:', e);
          setGalat(String(e?.message || e));
          ucapkan('Maaf, saya sedang tidak bisa menjawab. Coba lagi sebentar.');
        }
      } finally {
        clearTimeout(timerKelamaan);
        if (id === reqIdRef.current) {
          sedangMemprosesRef.current = false;
          if (antrianSuaraRef.current === 0) akhiriBicara();
        }
      }
    },
    [akhiriBicara, batalkanSuara, jalankanNavigasi, ubahStatus, ucapkan]
  );

  // ---------- Proses ucapan pengguna (sudah final / sudah dianggap selesai) ----------
  const tanganiUcapan = useCallback(
    (mentah: string) => {
      const teks = normalisasi(mentah);
      if (!teks) return;
      setTeksTerakhir(teks);

      // posisi nama di dalam ucapan (dan panjangnya); -1 = tidak ada
      let namaIdx = -1;
      let namaLen = 0;
      const cocok = teks.match(POLA_NAMA);
      if (cocok && cocok.index !== undefined) {
        namaIdx = cocok.index;
        namaLen = cocok[0].length;
      } else if (POLA_NAMA_RAPAT.test(teks.replace(/ /g, ''))) {
        namaIdx = teks.length; // nama menempel ("haloai") -> tak ada perintah menyertai
      }
      console.log('[VoiceAssistant] terdengar:', teks, '| nama cocok:', namaIdx >= 0, '| mode ngobrol:', aktifRef.current);
      if (namaIdx >= 0) {
        // ucapan setelah nama dianggap perintah ("halo ai, buka cash bank")
        const sesudahNama = teks.slice(namaIdx + namaLen).replace(POLA_SAPAAN, '').trim();
        if (sesudahNama.length > 2) {
          aktifRef.current = true; // masuk mode ngobrol: pertanyaan berikutnya tak perlu "halo ai" lagi
          tanyaAI(sesudahNama);
        } else {
          bukaJendelaPerintah();
          ucapkan(SAPAAN);
        }
        return;
      }

      // sedang dalam mode ngobrol
      if (aktifRef.current) {
        if (timerAktifRef.current) clearTimeout(timerAktifRef.current);
        // "stop"/"berhenti" pendek = menyela saja; AI sudah diam, tunggu pertanyaan berikutnya
        if (POLA_STOP.test(teks) && teks.split(' ').length <= 3) {
          bukaJendelaPerintah(WAKTU_PERCAKAPAN_MS);
          return;
        }
        if (POLA_SELESAI.test(teks)) {
          aktifRef.current = false; // akhiri mode ngobrol
          ucapkan('Siap, sama-sama. Panggil saya lagi kalau perlu.');
          return;
        }
        tanyaAI(teks); // aktifRef tetap true -> mic tetap siap setelah jawaban selesai
      }
      // selain itu: diabaikan (bukan untuk AI)
    },
    [bukaJendelaPerintah, tanyaAI, ucapkan]
  );

  // Pintu masuk semua ucapan pengguna: saring gema, lalu sela AI bila perlu.
  const prosesUcapan = useCallback(
    (mentah: string) => {
      const teks = normalisasi(mentah);
      if (!teks) return;
      if (adalahGema(teks)) return; // suara AI sendiri
      const sibuk = bicaraRef.current || sedangMemprosesRef.current;
      if (sibuk) {
        if (aktifRef.current || mengandungNama(teks)) potongAI(); // SELA
        else return; // bukan mode ngobrol & bukan memanggil AI -> abaikan
      }
      tanganiUcapan(mentah);
    },
    [adalahGema, potongAI, tanganiUcapan]
  );

  // Dipanggil dari SpeechRecognition (lewat ref supaya selalu memakai versi terbaru)
  hasilRef.current = (e: any) => {
    errorBeruntunRef.current = 0;
    let sementara = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const hasil = e.results[i];
      if (hasil.isFinal) {
        if (komitTimerRef.current) { clearTimeout(komitTimerRef.current); komitTimerRef.current = null; }
        if (Date.now() - komitWaktuRef.current < 2500) continue; // sudah diproses lewat "komit dini"
        // cek semua alternatif — kata panggil sering salah dengar di alternatif pertama
        const alternatif: string[] = [];
        for (let k = 0; k < hasil.length; k++) alternatif.push(hasil[k].transcript);
        const dipakai = alternatif.find((a) => mengandungNama(normalisasi(a))) || alternatif[0];
        prosesUcapan(dipakai);
      } else {
        sementara += hasil[0].transcript + ' ';
      }
    }
    sementara = sementara.trim();
    if (!sementara) return;
    const teksS = normalisasi(sementara);
    if (!teksS || adalahGema(teksS)) return;

    // SELA CEPAT: baru terdengar sebagian kata saja AI sudah langsung diam
    if ((bicaraRef.current || sedangMemprosesRef.current) && (aktifRef.current || mengandungNama(teksS))) {
      potongAI();
    }

    // KOMIT DINI (mode ngobrol): kamu berhenti bicara sebentar -> langsung kirim, tak perlu menunggu Chrome memfinalkan
    if (komitTimerRef.current) { clearTimeout(komitTimerRef.current); komitTimerRef.current = null; }
    if (aktifRef.current && teksS.split(' ').length >= 2) {
      komitTimerRef.current = setTimeout(() => {
        komitTimerRef.current = null;
        komitWaktuRef.current = Date.now();
        try { recRef.current?.abort(); } catch { /* abaikan */ }
        prosesUcapan(sementara);
      }, JEDA_AKHIR_UCAPAN_MS);
    }
  };

  // ---------- Inisialisasi SpeechRecognition ----------
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { ubahStatus('tidak-didukung'); return; }

    const rec = new SR();
    rec.lang = 'id-ID';
    rec.continuous = true;
    rec.interimResults = true; // perlu untuk menyela cepat & komit dini
    rec.maxAlternatives = 3;

    rec.onresult = (e: any) => hasilRef.current(e);

    rec.onerror = (e: any) => {
      console.warn('[VoiceAssistant] error mic:', e.error);
      if (e.error === 'network') setGalat('Pengenalan suara butuh internet (Chrome memakai server Google).');
      else if (e.error === 'audio-capture') setGalat('Mikrofon tidak ditemukan.');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        ubahStatus('izin-ditolak');
        rec.__berhenti = true;
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        errorBeruntunRef.current += 1;
      }
    };

    rec.onend = () => {
      recAktifRef.current = false;
      if (rec.__berhenti || muteRef.current) return;
      // mulai lagi (Chrome menutup sesi otomatis tiap beberapa menit); beri jeda jika error beruntun
      const jeda = Math.min(5000, 300 + errorBeruntunRef.current * 700);
      setTimeout(() => { if (!rec.__berhenti && !muteRef.current && !recAktifRef.current) { try { rec.start(); } catch { /* abaikan */ } } }, jeda);
    };

    rec.onstart = () => {
      recAktifRef.current = true;
      if (!bicaraRef.current && !sedangMemprosesRef.current) {
        ubahStatus(aktifRef.current ? 'menunggu' : 'mendengar');
      }
    };

    recRef.current = rec;
    if (!muteRef.current) { try { rec.start(); } catch { /* abaikan */ } }

    return () => {
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
        const diam = synth ? !synth.speaking && !synth.pending : true;
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
      if (document.visibilityState === 'visible') tick();
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

  // ---------- Tahan hidup di latar belakang ----------
  // Browser membekukan/membuang tab yang "tidak melakukan apa-apa". Tiga hal ini membuatnya
  // dianggap sedang memutar & merekam media, jadi tidak dibekukan saat kamu pindah tab/aplikasi:
  //  1. audio sunyi yang diputar terus (+ Media Session)   2. stream mikrofon tetap terbuka
  //  3. Screen Wake Lock (layar tidak mati selama tab terlihat)
  useEffect(() => {
    let audio: HTMLAudioElement | null = null;
    let stream: MediaStream | null = null;
    let kunci: any = null;
    let batal = false;

    // WAV sunyi 1 detik (8 kHz, 8-bit mono) sebagai data URI
    const buatWavSunyi = () => {
      const n = 8000;
      const buf = new Uint8Array(44 + n).fill(128);
      const dv = new DataView(buf.buffer);
      const tulis = (o: number, t: string) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i); };
      tulis(0, 'RIFF'); dv.setUint32(4, 36 + n, true); tulis(8, 'WAVE'); tulis(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true);
      dv.setUint16(34, 8, true); tulis(36, 'data'); dv.setUint32(40, n, true);
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return 'data:audio/wav;base64,' + btoa(bin);
    };

    const mintaWakeLock = async () => {
      try {
        const nav: any = navigator;
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        kunci = await nav.wakeLock.request('screen');
      } catch { /* tidak didukung / ditolak: abaikan */ }
    };

    const nyalakan = async () => {
      if (batal) return;
      // 1. audio sunyi + Media Session
      try {
        if (!audio) {
          audio = new Audio(buatWavSunyi());
          audio.loop = true;
          audio.volume = 0.01;
        }
        await audio.play();
        const ms: any = (navigator as any).mediaSession;
        if (ms) {
          ms.metadata = new (window as any).MediaMetadata({ title: 'Asisten suara AI aktif', artist: 'Gouf' });
          ms.playbackState = 'playing';
          ['pause', 'stop'].forEach((a) => { try { ms.setActionHandler(a, () => audio?.play()); } catch { /* abaikan */ } });
        }
      } catch { /* autoplay diblokir sampai ada klik pertama: dicoba lagi di bawah */ }
      // 2. mikrofon tetap terbuka (sekalian echo-cancellation bawaan browser)
      try {
        if (!stream && navigator.mediaDevices?.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        }
      } catch { /* izin mic ditolak: SpeechRecognition akan menampilkan pesannya sendiri */ }
      // 3. layar tetap menyala
      mintaWakeLock();
    };

    // autoplay butuh interaksi pertama; setelah itu langsung nyalakan semuanya
    const pertamaKali = () => {
      nyalakan();
      window.removeEventListener('pointerdown', pertamaKali);
      window.removeEventListener('keydown', pertamaKali);
    };
    window.addEventListener('pointerdown', pertamaKali);
    window.addEventListener('keydown', pertamaKali);
    nyalakan(); // kalau browser mengizinkan langsung (mis. izin media sudah diberikan)

    // wake lock dilepas otomatis saat tab disembunyikan -> minta lagi saat kembali; audio dijaga tetap jalan
    const saatTampil = () => {
      if (document.visibilityState === 'visible') mintaWakeLock();
      if (audio && audio.paused) audio.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', saatTampil);

    return () => {
      batal = true;
      window.removeEventListener('pointerdown', pertamaKali);
      window.removeEventListener('keydown', pertamaKali);
      document.removeEventListener('visibilitychange', saatTampil);
      try { audio?.pause(); } catch { /* abaikan */ }
      stream?.getTracks().forEach((t) => t.stop());
      try { kunci?.release(); } catch { /* abaikan */ }
    };
  }, []);

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

  // ---------- Tombol mute ----------
  const toggleMute = () => {
    const baru = !mute;
    setMute(baru);
    muteRef.current = baru;
    if (baru) {
      stopSemua();
      hentikanDengar();
      ubahStatus('mati');
    } else {
      ubahStatus('mendengar');
      mulaiDengar();
    }
  };

  if (status === 'tidak-didukung') return null;

  const label: Record<Status, string> = {
    'tidak-didukung': '',
    mati: 'Suara dimatikan',
    mendengar: `Ucapkan “halo ${NAMA_AI}”`,
    menunggu: 'Silakan bicara…',
    berpikir: 'Memikirkan jawaban… (bicara untuk menyela)',
    bicara: 'Sedang menjawab (bicara untuk menyela)',
    'izin-ditolak': 'Izin mikrofon ditolak — aktifkan di pengaturan situs',
  };

  const warna =
    status === 'mati' || status === 'izin-ditolak'
      ? 'bg-muted-foreground'
      : status === 'mendengar'
      ? 'bg-emerald-500'
      : 'bg-amber-500';

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm shadow-md">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${warna} ${status === 'mendengar' ? 'animate-pulse' : ''}`} />
      <span className="flex max-w-[280px] flex-col" aria-live="polite">
        <span className="truncate text-foreground">{label[status]}</span>
        {teksTerakhir && !galat && (
          <span className="truncate text-xs text-muted-foreground" title={teksTerakhir}>Terdengar: {teksTerakhir}</span>
        )}
        {galat && <span className="truncate text-xs text-red-500" title={galat}>{galat}</span>}
      </span>
      <button
        type="button"
        onClick={toggleMute}
        className="rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-pressed={mute}
      >
        {mute ? 'Nyalakan' : 'Matikan'}
      </button>
    </div>
  );
}