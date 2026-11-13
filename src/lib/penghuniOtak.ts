// "Otak" 27 AI penghuni kantor (Nova, Aria, Echo, ...). Murni logika (tanpa Three.js / React) supaya bisa diuji sendiri.
// Dijalankan OfficeScene.tsx (komponen PenghuniKantor) tiap frame; tubuh 3D-nya hanya membaca hasilnya.
//
// ATURAN:
//  1. AI HANYA duduk di meja kerjanya kalau sedang diberi tugas (lihat src/lib/tugasAi.ts), sama seperti agen
//     Neo/Atlas/Zeno di ruang Transactions. Tanpa tugas, AI berdiri di dekat mejanya.
//  2. AI yang tidak punya tugas BOLEH keluar ruangannya kapan saja (acak) dan mengunjungi ruangan MANA SAJA
//     (tidak ada AI tertentu / ruangan tertentu / urutan tertentu). Di sana mereka berpura-pura mengobrol.
//  3. Ruangan tidak boleh kosong: AI baru boleh keluar kalau setelah dia pergi masih ada minimal 1 AI penghuni
//     ruangan itu yang tetap berada di dalam (berdiri / duduk / sedang menemui tamu).
//  4. Kalau tugas datang saat AI sedang di luar, dia langsung pulang dan duduk di mejanya.
//
// Semua jalur berjalan dihitung oleh "dunia" (lihat src/lib/duniaPenghuni.ts): di dalam ruangan lewat pencari jalur A*
// (menghindari meja, kursi, rak, dinding), antar ruangan lewat lorong & pintu.

import {
  SEMUA_RUANG, bolehKeluar, daftarPet, hapusPet, infoPet, jumlahDiRuangan, lepasTamu, pasangTamu, pilihRuangTujuan, pilihTuanRumah,
  setFase, setLokasi, setTugas, tandaiKeluar, tandaiPulang, teksStatus, type RuangKunci,
} from './pet-Direktur';

export { SEMUA_RUANG };
export type { RuangKunci };

export type Titik = [number, number];

export type Fase =
  | 'init' // belum dipasang di dunia (menunggu data kursi & peta lantai)
  | 'duduk' // duduk di meja (ada tugas)
  | 'kekursi' // berjalan dari tempat berdiri ke kursi
  | 'kespot' // berjalan dari kursi / dari titik temu ke tempat berdiri
  | 'siap' // berdiri di dekat meja, tanpa tugas
  | 'keluar' // berjalan menuju ruangan tujuan
  | 'tamu' // sedang di ruangan orang lain (mengobrol / lihat-lihat)
  | 'pulang' // berjalan pulang ke ruangannya
  | 'temu' // tuan rumah berjalan ke titik temu untuk menemui tamu
  | 'ngobrol'; // tuan rumah mengobrol dengan tamu

export type Penghuni = {
  nama: string;
  ruang: string; // ruangan asal (kunci SEMUA_RUANG)
  mode: 'ketik' | 'baca';
  seatKey?: string;
  fase: Fase;
  x: number;
  z: number;
  rot: number; // arah hadap yang diinginkan (radian, 0 = +z)
  path: Titik[];
  i: number;
  gerak: boolean; // sedang berjalan
  di: string | null; // ruangan tempat AI berada sekarang (null = di lorong / perjalanan)
  tujuan: string | null; // ruangan yang sedang dituju / dikunjungi
  lawan: string | null; // nama lawan bicara
  timer: number; // hitung mundur umum (detik)
  cek: number; // hitung mundur untuk mencari lawan bicara
  hop: number; // berapa kali pindah ruangan dalam satu perjalanan
};

export type Kursi = { x: number; z: number; rot: number };

/** Layanan geometri dunia 3D (diberikan oleh OfficeScene lewat buatDunia). Semua koordinat = koordinat dunia. */
export interface Dunia {
  /** Kursi (posisi + arah hadap duduk). undefined = ruangan belum selesai dimuat. */
  kursi(nama: string): Kursi | undefined;
  /** Tempat berdiri di dekat kursi (lantai kosong). */
  titikBerdiri(nama: string): Titik | undefined;
  /** Titik lantai kosong di dalam pintu ruangan (simpul jalur gedung). */
  simpul(ruang: string): Titik | undefined;
  /** Apakah AI ini bisa berjalan dari tempat berdirinya ke pintu ruangannya (peta lantai terhubung)? */
  bisaKeluar(nama: string): boolean;
  /** Jalur lantai di dalam satu ruangan (menghindari perabot). Titik awal TIDAK disertakan; titik akhir = `ke`. */
  jalurLokal(dari: Titik, ke: Titik): Titik[];
  /** Jalur dari titik mana pun ke simpul ruangan `ruang` (lewat pintu & lorong). Titik awal TIDAK disertakan; titik akhir = simpul. */
  jalurGedung(dari: Titik, ruang: string): Titik[];
  /** Titik di dalam ruangan: sisi 0 = tempat acak (u = 0..1), -1 / +1 = sepasang titik berhadapan (tuan rumah / tamu), dekat pintu. */
  titikTemu(ruang: string, sisi: -1 | 0 | 1, u: number): Titik | undefined;
}

export const ROSTER: { nama: string; ruang: string; mode: 'ketik' | 'baca'; seatKey?: string }[] = [
  { nama: 'Nova', ruang: 'perpus', mode: 'ketik', seatKey: 'p:Nova' },
  { nama: 'Aria', ruang: 'perpus', mode: 'ketik', seatKey: 'p:Aria' },
  { nama: 'Echo', ruang: 'perpus', mode: 'baca' },
  { nama: 'Pixel', ruang: 'planning', mode: 'ketik', seatKey: 'pl:Pixel' },
  { nama: 'Quark', ruang: 'planning', mode: 'ketik', seatKey: 'pl:Quark' },
  { nama: 'Radian', ruang: 'planning', mode: 'baca', seatKey: 'pl:Radian' },
  { nama: 'Sigma', ruang: 'planning', mode: 'ketik', seatKey: 'pl:Sigma' },
  { nama: 'Tensor', ruang: 'management', mode: 'ketik', seatKey: 'mg:0' },
  { nama: 'Vector', ruang: 'management', mode: 'ketik', seatKey: 'mg:1' },
  { nama: 'Orion', ruang: 'management', mode: 'ketik', seatKey: 'mg:2' },
  { nama: 'Theta', ruang: 'management', mode: 'ketik', seatKey: 'mg:3' },
  { nama: 'Kappa', ruang: 'management', mode: 'ketik', seatKey: 'mg:4' },
  { nama: 'Omega', ruang: 'management', mode: 'ketik', seatKey: 'mg:5' },
  { nama: 'Kilo', ruang: 'ar', mode: 'ketik', seatKey: 'ar:0' },
  { nama: 'Lumen', ruang: 'ar', mode: 'baca', seatKey: 'ar:1' },
  { nama: 'Matrix', ruang: 'ar', mode: 'ketik', seatKey: 'ar:2' },
  { nama: 'Nexus', ruang: 'ap', mode: 'ketik', seatKey: 'ap:1' },
  { nama: 'Omni', ruang: 'ap', mode: 'baca', seatKey: 'ap:3' },
  { nama: 'Axiom', ruang: 'aset', mode: 'baca', seatKey: 'as:0' },
  { nama: 'Byte', ruang: 'aset', mode: 'ketik', seatKey: 'as:1' },
  { nama: 'Cipher', ruang: 'aset', mode: 'ketik', seatKey: 'as:2' },
  { nama: 'Delta', ruang: 'aset', mode: 'baca', seatKey: 'as:3' },
  { nama: 'Flux', ruang: 'studio', mode: 'baca', seatKey: 'fs:0' },
  { nama: 'Gamma', ruang: 'studio', mode: 'ketik', seatKey: 'fs:1' },
  { nama: 'Helix', ruang: 'studio', mode: 'ketik', seatKey: 'fs:2' },
  { nama: 'Ion', ruang: 'studio', mode: 'ketik', seatKey: 'fs:3' },
  { nama: 'Juno', ruang: 'studio', mode: 'ketik', seatKey: 'fs:4' },
];

// ---- Pengaturan (ubah di sini kalau ingin lebih ramai / lebih tenang) ---------------------------------------------------------
export const KECEPATAN = 1.45; // m/s
export const MAKS_DI_LUAR = 9; // paling banyak sekian AI sedang berkeliling sekaligus (supaya tidak terlalu ramai)
const JEDA_SIAP: [number, number] = [4, 16]; // detik antar keputusan AI yang berdiri menganggur
const PELUANG_KELUAR = 0.6; // peluang AI menganggur memutuskan keluar saat keputusan tiba
const LAMA_TAMU: [number, number] = [16, 42]; // detik di ruangan yang dikunjungi
const PELUANG_PINDAH = 0.4; // peluang pindah ke ruangan lain (bukan pulang) setelah selesai di satu ruangan
const MAKS_PINDAH = 2;
const PELUANG_NGOBROL = 0.85;
// Aturan siapa boleh keluar, pemilihan ruangan tujuan, pemilihan tuan rumah, dan teks status ada di src/lib/pet-Direktur.ts ("direktur");
// berkas ini menjalankan keputusan itu menjadi gerakan dan mengirim keadaan terbaru tiap AI ke direktur (lihat sinkron()).

export class OtakPenghuni {
  pets: Penghuni[];
  private byNama: Record<string, Penghuni> = {};
  private rnd: () => number;
  private dunia: Dunia | null = null;

  constructor(rnd: () => number = Math.random, roster = ROSTER) {
    this.rnd = rnd;
    this.pets = roster.map((r) => ({
      nama: r.nama, ruang: r.ruang, mode: r.mode, seatKey: r.seatKey,
      fase: 'init', x: 0, z: 0, rot: 0, path: [], i: 0, gerak: false, di: r.ruang, tujuan: null, lawan: null,
      timer: 0, cek: 0, hop: 0,
    }));
    for (const p of this.pets) {
      this.byNama[p.nama] = p;
      hapusPet(p.nama); // mulai dari keadaan bersih (mis. setelah hot-reload)
      daftarPet(p.nama);
    }
  }

  get(nama: string): Penghuni | undefined { return this.byNama[nama]; }

  private acak(a: number, b: number) { return a + (b - a) * this.rnd(); }

  /** Berapa AI penghuni `ruang` yang sedang benar-benar ada di dalam ruangannya (dihitung direktur). */
  hadir(ruang: string): number {
    return jumlahDiRuangan(ruang as RuangKunci);
  }
  diLuar(): number {
    let n = 0;
    for (const p of this.pets) if (p.fase === 'keluar' || p.fase === 'tamu' || p.fase === 'pulang') n++;
    return n;
  }

  /** Teks & status untuk label di UI / bar profil (dari direktur). */
  tampilan(p: Penghuni): { teks: string; status: 'bekerja' | 'berjalan' | 'rapat' | 'santai' } {
    return teksStatus(daftarPet(p.nama));
  }

  /** Kirim keadaan terbaru AI ini ke direktur (lokasi, fase, tugas, sedang di luar atau tidak). */
  private sinkron(p: Penghuni, tugas: boolean) {
    const i = daftarPet(p.nama); // dibuat ulang otomatis kalau sempat terhapus
    if (i.tugas !== tugas) setTugas(p.nama, tugas);
    setLokasi(p.nama, p.di as RuangKunci | null);
    const bicara = !p.gerak && (p.fase === 'ngobrol' || (p.fase === 'tamu' && !!p.lawan));
    setFase(p.nama, p.gerak ? 'jalan' : p.fase === 'duduk' ? 'duduk' : bicara ? 'ngobrol' : 'diam');
    const luar = p.fase === 'keluar' || p.fase === 'tamu' || p.fase === 'pulang';
    if (luar && !i.keluar) tandaiKeluar(p.nama, (p.tujuan ?? p.ruang) as RuangKunci);
    else if (!luar && i.keluar) tandaiPulang(p.nama);
    else if (luar && p.tujuan) i.tujuan = p.tujuan as RuangKunci;
  }

  // ---- pergerakan ------------------------------------------------------------------------------------------------------------
  private jalan(p: Penghuni, path: Titik[]) {
    p.path = path.length ? path : [[p.x, p.z]];
    p.i = 0;
    p.gerak = true;
  }

  private lepasLawan(p: Penghuni) {
    if (!p.lawan) return;
    const o = this.byNama[p.lawan];
    lepasTamu(p.nama); // putuskan hubungan tamu <-> tuan rumah di direktur (salah satunya pasti tamu)
    if (o) lepasTamu(o.nama);
    p.lawan = null;
    if (!o || o.lawan !== p.nama) return;
    o.lawan = null;
    if (o.fase === 'ngobrol' || o.fase === 'temu') this.pulangDalam(o);
  }

  /** Tuan rumah yang sedang di titik temu kembali ke tempat berdirinya (jalur lantai menghindari perabot). */
  private pulangDalam(p: Penghuni, d?: Dunia) {
    const dunia = d ?? this.dunia;
    p.fase = 'kespot';
    p.di = p.ruang;
    p.tujuan = null;
    const spot = dunia?.titikBerdiri(p.nama);
    if (dunia && spot) this.jalan(p, dunia.jalurLokal([p.x, p.z], spot));
    else p.gerak = false;
  }

  private pasang(p: Penghuni, d: Dunia, adaTugas: boolean): boolean {
    const k = d.kursi(p.nama);
    const spot = d.titikBerdiri(p.nama);
    if (!k || !spot) return false;
    if (adaTugas) { p.fase = 'duduk'; p.x = k.x; p.z = k.z; p.rot = k.rot; }
    else { p.fase = 'siap'; p.x = spot[0]; p.z = spot[1]; p.rot = k.rot; p.timer = this.acak(1, JEDA_SIAP[1]); }
    p.di = p.ruang;
    return true;
  }

  private pergiKeKursi(p: Penghuni, d: Dunia) {
    const k = d.kursi(p.nama)!;
    p.fase = 'kekursi';
    p.di = p.ruang;
    this.jalan(p, d.jalurLokal([p.x, p.z], [k.x, k.z]));
  }

  private pergiKeSpot(p: Penghuni, d: Dunia) {
    const s = d.titikBerdiri(p.nama);
    p.fase = 'kespot';
    p.di = p.ruang;
    this.jalan(p, s ? d.jalurLokal([p.x, p.z], s) : [[p.x, p.z]]);
  }

  /** Pulang ke ruangan asal dari posisi sekarang (di mana pun). */
  private pulang(p: Penghuni, d: Dunia) {
    this.lepasLawan(p);
    const spot = d.titikBerdiri(p.nama);
    const sm = d.simpul(p.ruang);
    const graf = d.jalurGedung([p.x, p.z], p.ruang);
    const masuk = sm && spot ? d.jalurLokal(sm, spot) : spot ? [spot] : [];
    p.fase = 'pulang';
    p.di = null;
    p.tujuan = p.ruang;
    this.jalan(p, graf.concat(masuk));
  }

  /** Ruangan lain yang dipilih acak (seragam) dari semua ruangan di gedung selain `dari`. */
  private pilihRuangLain(dari: string): string {
    return pilihRuangTujuan(dari as RuangKunci, this.rnd);
  }

  private mulaiKeluar(p: Penghuni, d: Dunia): boolean {
    const sm = d.simpul(p.ruang);
    if (!sm || !d.bisaKeluar(p.nama)) return false;
    const tujuan = this.pilihRuangLain(p.ruang);
    const st = d.simpul(tujuan);
    const titik = d.titikTemu(tujuan, 0, this.rnd());
    if (!st || !titik) return false;
    const keluar = d.jalurLokal([p.x, p.z], sm);
    const graf = d.jalurGedung(sm, tujuan);
    const masuk = d.jalurLokal(st, titik);
    p.fase = 'keluar';
    p.di = null;
    p.tujuan = tujuan;
    p.hop = 0;
    this.jalan(p, keluar.concat(graf, masuk));
    return true;
  }

  private pindah(p: Penghuni, d: Dunia) {
    this.lepasLawan(p);
    const tujuan = this.pilihRuangLain(p.tujuan ?? p.ruang);
    if (tujuan === p.ruang) return this.pulang(p, d);
    const st = d.simpul(tujuan);
    const titik = d.titikTemu(tujuan, 0, this.rnd());
    if (!st || !titik) return this.pulang(p, d);
    const graf = d.jalurGedung([p.x, p.z], tujuan);
    p.fase = 'keluar';
    p.di = null;
    p.tujuan = tujuan;
    p.hop += 1;
    this.jalan(p, graf.concat(d.jalurLokal(st, titik)));
  }

  private cariLawan(p: Penghuni, d: Dunia, adaTugas: (n: string) => boolean) {
    if (p.lawan || !p.tujuan) return;
    const ruang = p.tujuan;
    // 1) tuan rumah: penghuni ruangan itu yang sedang berdiri santai, dipilih direktur
    const namaTuan = pilihTuanRumah(ruang as RuangKunci, p.nama, this.rnd);
    let o: Penghuni | undefined = namaTuan ? this.byNama[namaTuan] : undefined;
    if (o && (o.fase !== 'siap' || o.gerak || o.lawan || adaTugas(o.nama))) o = undefined;
    // 2) cadangan: sesama tamu di ruangan itu yang sedang berdiri
    if (!o) {
      const calon = this.pets.filter((x) => x !== p && !x.lawan && !adaTugas(x.nama) && x.fase === 'tamu' && x.tujuan === ruang && !x.gerak);
      if (!calon.length) return;
      o = calon[Math.min(calon.length - 1, Math.floor(this.rnd() * calon.length))];
    }
    if (o.fase === 'siap') {
      // tuan rumah berjalan ke titik temu di dekat pintu ruangannya; tamu bergeser ke sisi seberang
      const u = this.rnd();
      const th = d.titikTemu(ruang, -1, u), tt = d.titikTemu(ruang, 1, u);
      if (!th || !tt) return;
      p.lawan = o.nama;
      o.lawan = p.nama;
      pasangTamu(o.nama, p.nama);
      o.fase = 'temu';
      o.di = o.ruang;
      this.jalan(o, d.jalurLokal([o.x, o.z], th));
      this.jalan(p, d.jalurLokal([p.x, p.z], tt));
    } else {
      // sesama tamu: tamu baru mendekat ke tamu yang sudah ada
      p.lawan = o.nama;
      o.lawan = p.nama;
      const dx = o.x - p.x, dz = o.z - p.z;
      const L = Math.hypot(dx, dz) || 1;
      this.jalan(p, d.jalurLokal([p.x, p.z], [o.x - (dx / L) * 0.9, o.z - (dz / L) * 0.9]));
    }
  }

  private tiba(p: Penghuni, d: Dunia, adaTugas: (n: string) => boolean) {
    p.gerak = false;
    switch (p.fase) {
      case 'kekursi': {
        const k = d.kursi(p.nama)!;
        p.x = k.x; p.z = k.z; p.rot = k.rot; p.fase = 'duduk'; p.di = p.ruang;
        break;
      }
      case 'kespot': {
        if (adaTugas(p.nama)) { p.di = p.ruang; this.pergiKeKursi(p, d); break; }
        p.fase = 'siap'; p.di = p.ruang; p.timer = this.acak(JEDA_SIAP[0], JEDA_SIAP[1]);
        const k = d.kursi(p.nama);
        if (k) p.rot = k.rot + (this.rnd() - 0.5) * 1.2;
        break;
      }
      case 'keluar': {
        p.fase = 'tamu'; p.di = p.tujuan; p.timer = this.acak(LAMA_TAMU[0], LAMA_TAMU[1]); p.cek = this.acak(0.3, 1.5);
        break;
      }
      case 'pulang': {
        p.di = p.ruang;
        p.tujuan = null;
        if (adaTugas(p.nama)) this.pergiKeKursi(p, d);
        else { p.fase = 'siap'; p.timer = this.acak(JEDA_SIAP[0], JEDA_SIAP[1]); const k = d.kursi(p.nama); if (k) p.rot = k.rot; }
        break;
      }
      case 'temu':
        p.fase = 'ngobrol';
        break;
      default:
        break;
    }
  }

  /** Dipanggil tiap frame. `adaTugas(nama)` = apakah AI itu sedang punya tugas. */
  tick(dt: number, d: Dunia, adaTugas: (nama: string) => boolean) {
    this.dunia = d;
    dt = Math.min(dt, 0.1);
    for (const p of this.pets) {
      const tugas = adaTugas(p.nama);
      this.langkah(p, d, dt, tugas, adaTugas);
      this.sinkron(p, tugas);
    }
  }

  private langkah(p: Penghuni, d: Dunia, dt: number, tugas: boolean, adaTugas: (nama: string) => boolean) {
    {
      if (p.fase === 'init') { this.pasang(p, d, tugas); return; }

      // ---- tugas berubah -------------------------------------------------------------------------------------------------
      if (tugas) {
        if (p.fase === 'siap') this.pergiKeKursi(p, d);
        else if (p.fase === 'kespot') {
          // baru berdiri dari kursi lalu diberi tugas lagi: langsung duduk kembali; kalau sedang jauh (titik temu), tiba dulu di tempat berdiri
          const k = d.kursi(p.nama);
          if (k && Math.hypot(k.x - p.x, k.z - p.z) < 2) this.pergiKeKursi(p, d);
        } else if (p.fase === 'temu' || p.fase === 'ngobrol') {
          // tuan rumah yang sedang menemui tamu: lepas lawan, kembali ke tempat berdiri lalu duduk
          this.lepasLawan(p);
          this.pulangDalam(p, d);
        } else if (p.fase === 'keluar' || p.fase === 'tamu') this.pulang(p, d);
      } else if (p.fase === 'duduk' || p.fase === 'kekursi') {
        this.pergiKeSpot(p, d);
      }

      // ---- berjalan ------------------------------------------------------------------------------------------------------
      if (p.gerak) {
        let sisa = KECEPATAN * dt;
        while (sisa > 1e-6 && p.i < p.path.length) {
          const [tx, tz] = p.path[p.i];
          const dx = tx - p.x, dz = tz - p.z;
          const jarak = Math.hypot(dx, dz);
          if (jarak < 1e-4) { p.i += 1; continue; }
          p.rot = Math.atan2(dx, dz);
          if (jarak <= sisa) { p.x = tx; p.z = tz; p.i += 1; sisa -= jarak; }
          else { p.x += (dx / jarak) * sisa; p.z += (dz / jarak) * sisa; sisa = 0; }
        }
        if (p.i >= p.path.length) this.tiba(p, d, adaTugas);
        return;
      }

      // ---- diam: keputusan ------------------------------------------------------------------------------------------------
      switch (p.fase) {
        case 'siap': {
          p.timer -= dt;
          if (p.timer > 0) break;
          p.timer = this.acak(JEDA_SIAP[0], JEDA_SIAP[1]);
          if (tugas || this.rnd() > PELUANG_KELUAR) break;
          // direktur: boleh keluar hanya kalau tanpa tugas, tidak menerima tamu, dan masih ada AI lain di ruangannya (tidak boleh kosong)
          if (!bolehKeluar(p.nama)) break;
          if (this.diLuar() >= MAKS_DI_LUAR) break;
          this.mulaiKeluar(p, d);
          break;
        }
        case 'tamu': {
          p.timer -= dt;
          p.cek -= dt;
          if (!p.lawan && p.cek <= 0) {
            p.cek = this.acak(1.5, 3.5);
            if (this.rnd() < PELUANG_NGOBROL) this.cariLawan(p, d, adaTugas);
          }
          if (p.lawan) {
            const o = this.byNama[p.lawan];
            if (o) p.rot = Math.atan2(o.x - p.x, o.z - p.z);
          }
          if (p.timer <= 0) {
            if (p.hop < MAKS_PINDAH && this.rnd() < PELUANG_PINDAH) this.pindah(p, d);
            else this.pulang(p, d);
          }
          break;
        }
        case 'ngobrol': {
          const o = p.lawan ? this.byNama[p.lawan] : undefined;
          if (o) p.rot = Math.atan2(o.x - p.x, o.z - p.z);
          else this.pulangDalam(p, d);
          break;
        }
        case 'temu': {
          // sudah sampai di titik temu tapi lawan dibatalkan
          if (!p.lawan) this.pulangDalam(p, d);
          break;
        }
        default:
          break;
      }
    }
  }
}