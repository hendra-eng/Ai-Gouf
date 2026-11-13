// Menyambungkan peta lantai (petaLantai.ts) ke otak AI penghuni (penghuniOtak.ts).
// Murni logika (tanpa Three.js): OfficeScene.tsx memberi data posisi (kursi tiap AI, kotak & simpul pintu tiap ruangan),
// peta lantainya (PetaLantai yang sudah diisi perabot), dan fungsi jalur lorong antar ruangan (graf jalur agen yang sudah ada).
//
// Yang diputuskan di sini:
//  - titikBerdiri(nama): lantai kosong di dekat kursi tiap AI (diutamakan di belakang / samping kursi, bukan di sisi meja), selalu di
//    daerah lantai yang terhubung ke pintu ruangannya, dan tidak menumpuk dengan tempat berdiri AI lain.
//  - titikTemu(ruang, 0, u): tempat acak di dalam ruangan (untuk AI yang berkunjung). Tidak ada tempat tetap.
//  - titikTemu(ruang, -1 / +1, u): sepasang titik berhadapan untuk tuan rumah & tamu yang mengobrol (dekat pintu ruangan).
//  - jalurLokal: jalur A* di dalam ruangan (menghindari meja, kursi, rak, dinding).
//  - jalurGedung: dari mana pun -> simpul ruangan tujuan: keluar ke pintu ruangan asal (A*), lewat lorong (graf agen), masuk ke simpul tujuan.

import type { Dunia, Kursi } from './penghuniOtak';
import type { PetaLantai, Titik } from './petaLantai';

export type KotakRuang = { cx: number; cz: number; w: number; d: number };
export type KonfigRuang = { box: KotakRuang; simpul: Titik }; // simpul = titik lantai kosong di dalam pintu ruangan
export type KursiDunia = Kursi & { ruang: string };
/** Jalur lorong & pintu dari titik `dari` ke simpul ruangan `ruang` (titik awal tidak disertakan, titik akhir = simpul ruangan). */
export type GrafGedung = (dari: Titik, ruang: string) => Titik[];

export type DuniaPenghuni = Dunia & {
  /** Ringkasan untuk debug / uji: berapa ruangan & AI yang bisa berjalan keluar. */
  diagnosa(): {
    ruangSiap: string[]; ruangTanpaSimpul: string[]; bisaKeluar: string[]; terkurung: string[]; spotDarurat: string[];
    simpulBergeser: string[]; // ruangan yang titik pintunya terpaksa digeser (karena tertutup perabot) + jarak geser dalam meter
  };
};

const JARAK_SPOT_MIN = 0.85; // jarak minimum antar tempat berdiri AI (supaya tidak menumpuk)
const dalamBox = (b: KotakRuang, x: number, z: number, m = 0.4) => Math.abs(x - b.cx) <= b.w / 2 - m && Math.abs(z - b.cz) <= b.d / 2 - m;

export function buatDunia(peta: PetaLantai, ruang: Record<string, KonfigRuang>, kursi: Record<string, KursiDunia>, grafGedung: GrafGedung): DuniaPenghuni {
  // Daerah lantai terhubung yang paling luas di dalam kotak ruangan = lantai utama ruangan itu. Titik pintu (simpul) HARUS ada di sana:
  // kalau titik pintu jatuh di kantong lantai yang terkurung perabot (mis. di dalam lingkaran meja), AI di ruangan itu tidak akan bisa keluar.
  const kompUtama = (b: KotakRuang): number => {
    const hitung = new Map<number, number>();
    for (let z = b.cz - b.d / 2; z <= b.cz + b.d / 2; z += peta.sel) {
      for (let x = b.cx - b.w / 2; x <= b.cx + b.w / 2; x += peta.sel) {
        const k = peta.komponenDi(x, z);
        if (k) hitung.set(k, (hitung.get(k) ?? 0) + 1);
      }
    }
    let terbaik = 0, n = 0;
    hitung.forEach((v, k) => { if (v > n) { n = v; terbaik = k; } });
    return terbaik;
  };

  // simpul tiap ruangan yang sudah dipastikan bebas + label daerah terhubungnya
  const simpul: Record<string, { p: Titik; komp: number }> = {};
  const bergeser: string[] = [];
  for (const [r, c] of Object.entries(ruang)) {
    const utama = kompUtama(c.box);
    let p: Titik | null = peta.bebas(c.simpul[0], c.simpul[1]) && (!utama || peta.komponenDi(c.simpul[0], c.simpul[1]) === utama) ? c.simpul : null;
    if (!p && utama) p = peta.terdekatBebas(c.simpul[0], c.simpul[1], utama, 4);
    if (!p) p = peta.terdekatBebas(c.simpul[0], c.simpul[1], 0, 3);
    if (p) {
      simpul[r] = { p, komp: peta.komponenDi(p[0], p[1]) };
      const g = Math.hypot(p[0] - c.simpul[0], p[1] - c.simpul[1]);
      if (g > 0.05) bergeser.push(`${r} ${g.toFixed(1)}m`);
    }
  }

  const ruangDari = (x: number, z: number): string | null => {
    for (const [r, c] of Object.entries(ruang)) if (dalamBox(c.box, x, z, -0.05)) return r;
    return null;
  };

  // ---- tempat berdiri ---------------------------------------------------------------------------------------------------------
  const spot: Record<string, Titik> = {};
  const darurat: string[] = [];
  const dipakai: Titik[] = [];
  const hitungSpot = (nama: string): Titik | undefined => {
    const k = kursi[nama];
    if (!k) return undefined;
    const sm = simpul[k.ruang];
    const box = ruang[k.ruang]?.box;
    const fx = Math.sin(k.rot), fz = Math.cos(k.rot); // arah hadap duduk (ke meja)
    let terbaik: Titik | null = null;
    let skorTerbaik = Infinity;
    for (const r of [0.8, 1.0, 1.25, 1.55, 1.9]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const dx = Math.sin(ang), dz = Math.cos(ang);
        const x = k.x + dx * r, z = k.z + dz * r;
        if (!peta.bebas(x, z)) continue;
        if (sm && peta.komponenDi(x, z) !== sm.komp) continue;
        if (box && !dalamBox(box, x, z)) continue;
        if (dipakai.some((q) => Math.hypot(q[0] - x, q[1] - z) < JARAK_SPOT_MIN)) continue;
        const depan = Math.max(0, dx * fx + dz * fz); // 1 = tepat di depan kursi (sisi meja): dihindari
        const skor = r + 1.6 * depan;
        if (skor < skorTerbaik) { skorTerbaik = skor; terbaik = [x, z]; }
      }
      if (terbaik) break; // pakai lingkaran terdekat yang punya tempat
    }
    if (!terbaik) terbaik = peta.terdekatBebas(k.x, k.z, sm?.komp ?? 0, 4);
    if (!terbaik) { terbaik = [k.x - fx * 0.7, k.z - fz * 0.7]; darurat.push(nama); } // peta terlalu padat: berdiri di belakang kursi
    dipakai.push(terbaik);
    return terbaik;
  };
  // semua tempat berdiri dihitung berurutan sekali di awal supaya hasilnya tidak bergantung urutan pemanggilan
  for (const nama of Object.keys(kursi)) { const s = hitungSpot(nama); if (s) spot[nama] = s; }

  // ---- tempat di dalam ruangan ------------------------------------------------------------------------------------------------
  const acakRuang: Record<string, Titik[]> = {};
  const daftarAcak = (r: string): Titik[] => {
    if (acakRuang[r]) return acakRuang[r];
    const c = ruang[r], sm = simpul[r];
    const out: Titik[] = [];
    if (c && sm) {
      const langkah = peta.sel * 4;
      for (let z = c.box.cz - c.box.d / 2; z <= c.box.cz + c.box.d / 2; z += langkah) {
        for (let x = c.box.cx - c.box.w / 2; x <= c.box.cx + c.box.w / 2; x += langkah) {
          if (!dalamBox(c.box, x, z, 0.5)) continue;
          if (!peta.bebas(x, z) || peta.komponenDi(x, z) !== sm.komp) continue;
          out.push([x, z]);
        }
      }
    }
    if (!out.length && sm) out.push(sm.p);
    return (acakRuang[r] = out);
  };

  const pasangan: Record<string, [Titik, Titik][]> = {};
  const daftarPasangan = (r: string): [Titik, Titik][] => {
    if (pasangan[r]) return pasangan[r];
    const sm = simpul[r];
    const out: [Titik, Titik][] = [];
    if (sm) {
      const box = ruang[r].box;
      // titik di sekitar pintu (radius 3.4 m) beserta pasangannya 0.95 m di sebelahnya
      for (let dz = -3.4; dz <= 3.4; dz += 0.4) {
        for (let dx = -3.4; dx <= 3.4; dx += 0.4) {
          const x = sm.p[0] + dx, z = sm.p[1] + dz;
          if (Math.hypot(dx, dz) > 3.4) continue;
          if (!peta.bebas(x, z) || peta.komponenDi(x, z) !== sm.komp) continue;
          if (!dalamBox(box, x, z, 0.5)) continue;
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const q: Titik = [x + Math.sin(ang) * 0.95, z + Math.cos(ang) * 0.95];
            if (!peta.bebas(q[0], q[1]) || peta.komponenDi(q[0], q[1]) !== sm.komp) continue;
            if (!dalamBox(box, q[0], q[1], 0.5)) continue;
            if (!peta.garisBebas(x, z, q[0], q[1])) continue;
            out.push([[x, z], q]);
            break;
          }
        }
      }
      if (!out.length) out.push([sm.p, peta.terdekatBebas(sm.p[0] + 0.9, sm.p[1], sm.komp) ?? sm.p]);
    }
    return (pasangan[r] = out);
  };

  const jalurLokal = (dari: Titik, ke: Titik): Titik[] => peta.jalur(dari, ke) ?? [ke];

  const bisa: Record<string, boolean> = {};
  const bisaKeluar = (nama: string): boolean => {
    if (nama in bisa) return bisa[nama];
    const k = kursi[nama], s = spot[nama];
    const sm = k ? simpul[k.ruang] : undefined;
    let ok = false;
    if (k && s && sm && peta.komponenDi(s[0], s[1]) === sm.komp) ok = peta.jalur(s, sm.p) !== null;
    return (bisa[nama] = ok);
  };

  const jalurGedung = (dari: Titik, tujuan: string): Titik[] => {
    const st = simpul[tujuan];
    if (!st) return [];
    const R = ruangDari(dari[0], dari[1]);
    if (R === tujuan) return jalurLokal(dari, st.p);
    const out: Titik[] = [];
    let awal = dari;
    if (R && simpul[R]) {
      out.push(...jalurLokal(dari, simpul[R].p)); // dari tempat di dalam ruangan -> pintu ruangan itu
      awal = simpul[R].p;
    }
    out.push(...grafGedung(awal, tujuan));
    const akhir = out[out.length - 1];
    if (!akhir || Math.hypot(akhir[0] - st.p[0], akhir[1] - st.p[1]) > 0.01) out.push(st.p);
    return out;
  };

  return {
    kursi: (nama) => { const k = kursi[nama]; return k ? { x: k.x, z: k.z, rot: k.rot } : undefined; },
    titikBerdiri: (nama) => spot[nama],
    simpul: (r) => simpul[r]?.p,
    bisaKeluar,
    jalurLokal,
    jalurGedung,
    titikTemu: (r, sisi, u) => {
      const s = Math.min(0.999999, Math.max(0, u));
      if (sisi === 0) {
        const d = daftarAcak(r);
        return d.length ? d[Math.floor(s * d.length)] : undefined;
      }
      const d = daftarPasangan(r);
      if (!d.length) return undefined;
      const pr = d[Math.floor(s * d.length)];
      return sisi < 0 ? pr[0] : pr[1];
    },
    diagnosa: () => {
      const nama = Object.keys(kursi);
      return {
        ruangSiap: Object.keys(simpul),
        ruangTanpaSimpul: Object.keys(ruang).filter((r) => !simpul[r]),
        bisaKeluar: nama.filter(bisaKeluar),
        terkurung: nama.filter((n) => !bisaKeluar(n)),
        spotDarurat: darurat.slice(),
        simpulBergeser: bergeser.slice(),
      };
    },
  };
}