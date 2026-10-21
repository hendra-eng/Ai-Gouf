// pemutarPcm.ts — memutar audio PCM yang datang BERTAHAP (Gemini TTS streaming, endpoint /api/tts/stream).
//
// Format: PCM mentah 16-bit little-endian, 24 kHz, mono.
//
// Supaya suara tidak terbata-bata walau audio datang sepotong-sepotong:
//  1) AliranPcm membaca stream di latar belakang begitu dibuka, jadi kalimat yang sedang MENUNGGU gilirannya
//     sudah terkumpul di memori saat tiba gilirannya diputar (tanpa jeda antar kalimat).
//  2) PemutarPcm tidak langsung memutar potongan pertama. Ia menahan sampai audio yang terkumpul cukup panjang
//     (buffer awal), lalu menjadwalkan potongan berikutnya TEPAT bersambung lewat jam Web Audio (tanpa celah/klik).
//  3) Kalau audio yang datang tidak sempat mengejar (underrun), pemutar berhenti sebentar, mengumpulkan buffer lagi,
//     lalu lanjut, bukan memutar patah-patah. Dan buffer awal otomatis dinaikkan untuk kalimat berikutnya
//     (adaptif), lalu turun lagi pelan-pelan kalau koneksi/Gemini sedang lancar.

const LAJU_SAMPEL = 24000;
const AWAL_MIN_DETIK = 0.45; // buffer awal terkecil (Gemini cepat)
const AWAL_MAKS_DETIK = 3; // buffer awal terbesar (Gemini lambat)
const JEDA_MULAI_DETIK = 0.03; // jarak aman antara "jadwalkan" dan "bunyi"

let awalAdaptif = 0.6; // dipakai bersama semua kalimat

let ctxBersama: AudioContext | null = null;

export function dukungPcmStream(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(w.AudioContext || w.webkitAudioContext) && typeof ReadableStream !== 'undefined';
}

function ambilCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const AC = w.AudioContext || w.webkitAudioContext;
  if (!AC) return null;
  if (!ctxBersama || ctxBersama.state === 'closed') ctxBersama = new AC();
  return ctxBersama;
}

// ---------------------------------------------------------------------------------------------
// AliranPcm: membaca stream sedini mungkin, menyimpan potongan, dan menyerahkannya sebagai sampel float.
// ---------------------------------------------------------------------------------------------
export class AliranPcm {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private antre: Uint8Array[] = [];
  private sisa: Uint8Array = new Uint8Array(0); // 1 byte sisa kalau potongan terakhir ganjil (sampel 16-bit = 2 byte)
  private selesai = false;
  private bangunkan: (() => void) | null = null;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
    void this.pompa();
  }

  private async pompa(): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (value && value.length) {
          this.antre.push(value);
          this.bangun();
        }
      }
    } catch {
      /* putus/dibatalkan: yang sudah terkumpul tetap diputar */
    } finally {
      this.selesai = true;
      this.bangun();
    }
  }

  private bangun(): void {
    const f = this.bangunkan;
    this.bangunkan = null;
    if (f) f();
  }

  /** Ambil semua audio yang sudah tiba (digabung). null = stream selesai dan semuanya sudah diambil. */
  async ambil(): Promise<Float32Array | null> {
    for (;;) {
      if (this.antre.length > 0) {
        let total = this.sisa.length;
        for (const p of this.antre) total += p.length;
        const gabung = new Uint8Array(total);
        gabung.set(this.sisa, 0);
        let pos = this.sisa.length;
        for (const p of this.antre) {
          gabung.set(p, pos);
          pos += p.length;
        }
        this.antre = [];
        const genap = total - (total % 2);
        this.sisa = gabung.slice(genap);
        if (genap === 0) continue;
        const dv = new DataView(gabung.buffer, gabung.byteOffset, genap);
        const out = new Float32Array(genap / 2);
        for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
        return out;
      }
      if (this.selesai) return null;
      await new Promise<void>((r) => {
        this.bangunkan = r;
      });
    }
  }

  batal(): void {
    try {
      void this.reader.cancel();
    } catch {
      /* abaikan */
    }
    this.selesai = true;
    this.antre = [];
    this.bangun();
  }
}

// ---------------------------------------------------------------------------------------------
// PemutarPcm: menjadwalkan sampel ke Web Audio dengan buffer awal + penanganan underrun.
// ---------------------------------------------------------------------------------------------
export interface OpsiPemutarPcm {
  /** Faktor kecepatan bicara (1 = normal). Dibaca tiap kali potongan dijadwalkan. */
  laju: () => number;
  /** Dipanggil sekali, saat suara PERTAMA kalimat ini benar-benar akan terdengar. */
  saatMulai?: () => void;
}

export class PemutarPcm {
  private opsi: OpsiPemutarPcm;
  private sumber: Set<AudioBufferSourceNode> = new Set();
  private dihentikan = false;
  private aliranAktif: AliranPcm | null = null;
  private bangunTunggu: (() => void) | null = null;

  constructor(opsi: OpsiPemutarPcm) {
    this.opsi = opsi;
  }

  hentikan(): void {
    this.dihentikan = true;
    this.sumber.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* abaikan */
      }
    });
    this.sumber.clear();
    this.aliranAktif?.batal();
    const f = this.bangunTunggu;
    this.bangunTunggu = null;
    if (f) f();
  }

  /** Putar satu aliran sampai habis (atau dihentikan). Mengembalikan apakah terjadi underrun. */
  async putar(aliran: AliranPcm): Promise<{ underrun: boolean }> {
    this.aliranAktif = aliran;
    const ctx = ambilCtx();
    if (!ctx) {
      aliran.batal();
      return { underrun: false };
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* abaikan */
      }
    }

    const awal = awalAdaptif;
    let antre: Float32Array[] = [];
    let antreDetik = 0;
    let mulai = false;
    let jadwalSampai = 0; // detik jam ctx: akhir audio yang sudah dijadwalkan
    let underrun = false;
    let akhir = false;

    const jadwalkan = () => {
      if (antre.length === 0) return;
      let n = 0;
      for (const a of antre) n += a.length;
      const gabung = new Float32Array(n);
      let pos = 0;
      for (const a of antre) {
        gabung.set(a, pos);
        pos += a.length;
      }
      antre = [];
      antreDetik = 0;
      const laju = Math.max(0.25, this.opsi.laju() || 1);
      const buf = ctx.createBuffer(1, n, LAJU_SAMPEL);
      buf.copyToChannel(gabung, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = laju;
      src.connect(ctx.destination);
      const mulaiDi = Math.max(jadwalSampai, ctx.currentTime + JEDA_MULAI_DETIK);
      src.onended = () => {
        this.sumber.delete(src);
      };
      this.sumber.add(src);
      src.start(mulaiDi);
      jadwalSampai = mulaiDi + n / LAJU_SAMPEL / laju;
      if (!mulai) {
        mulai = true;
        const cb = this.opsi.saatMulai;
        if (cb) {
          const tunda = Math.max(0, (mulaiDi - ctx.currentTime) * 1000);
          setTimeout(() => {
            if (!this.dihentikan) cb();
          }, tunda);
        }
      }
    };

    while (!this.dihentikan) {
      const potong = await aliran.ambil();
      if (this.dihentikan) break;
      if (potong === null) {
        akhir = true;
      } else {
        antre.push(potong);
        antreDetik += potong.length / LAJU_SAMPEL;
      }

      if (!mulai) {
        // Buffer awal: tahan sampai cukup panjang (atau stream sudah habis, mis. kalimat pendek).
        if (antreDetik >= awal || akhir) jadwalkan();
      } else if (jadwalSampai <= ctx.currentTime) {
        // Underrun: audio yang terjadwal sudah habis padahal stream belum selesai -> kumpulkan buffer dulu, jangan patah-patah.
        if (!akhir) underrun = true;
        if (antreDetik >= awal || akhir) jadwalkan();
      } else {
        // Masih ada audio terjadwal: sambung langsung tanpa celah.
        jadwalkan();
      }
      if (akhir) break;
    }

    // Tunggu audio terjadwal terakhir selesai berbunyi (atau dihentikan).
    if (!this.dihentikan) {
      const sisaMs = Math.max(0, (jadwalSampai - ctx.currentTime) * 1000) + 40;
      await new Promise<void>((r) => {
        const t = setTimeout(r, sisaMs);
        this.bangunTunggu = () => {
          clearTimeout(t);
          r();
        };
      });
      this.bangunTunggu = null;
    }
    this.aliranAktif = null;

    // Adaptif: underrun -> buffer awal kalimat berikutnya dinaikkan; lancar -> diturunkan pelan-pelan.
    if (underrun) awalAdaptif = Math.min(AWAL_MAKS_DETIK, awalAdaptif + 0.5);
    else awalAdaptif = Math.max(AWAL_MIN_DETIK, awalAdaptif - 0.1);
    return { underrun };
  }
}