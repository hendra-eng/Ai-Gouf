// Peta lantai gedung untuk AI penghuni (Nova, Aria, Echo, ...): kotak-kotak lantai yang bisa / tidak bisa dilalui + pencari jalur A*.
// Murni logika (tanpa Three.js / React) supaya bisa diuji sendiri. OfficeScene.tsx mengisi petanya dari geometri 3D yang SUDAH ada
// (meja, kursi, dinding, rak, sofa, ...) lewat tandaiKotak(), jadi kalau Anda memindahkan perabot, jalur AI ikut menyesuaikan sendiri
// tanpa ada koordinat yang perlu diubah manual.
//
// Cara kerja:
//  - Lantai dibagi kotak kecil (sel, default 0.2 m). Tiap benda setinggi badan ditandai sebagai kotak terhalang, lalu DIGEMUKKAN
//    sebesar jari-jari badan AI (radius), jadi titik tengah AI yang berjalan di sel bebas tidak pernah menembus benda.
//  - selesai() memberi label "daerah terhubung" ke semua sel bebas: dua titik hanya bisa dihubungkan kalau labelnya sama
//    (mencegah AI diberi tujuan di kantong lantai yang terkurung perabot).
//  - jalur() = A* 8 arah (tanpa memotong sudut benda) lalu dirapikan (string pulling) menjadi beberapa titik belok saja.

export type Titik = [number, number];

const AKAR2 = Math.SQRT2;

export class PetaLantai {
  readonly x0: number;
  readonly z0: number;
  readonly sel: number;
  readonly w: number; // jumlah sel arah x
  readonly h: number; // jumlah sel arah z
  readonly radius: number;
  private blok: Uint8Array; // 1 = terhalang (sudah digemukkan)
  private komp: Int32Array; // label daerah terhubung (0 = terhalang)
  private nKomp = 0;
  // buffer A* dipakai ulang (alokasi sekali)
  private gBuf: Float32Array;
  private asal: Int32Array;
  private stamp: Int32Array;
  private tutup: Int32Array;
  private giliran = 0;

  constructor(x0: number, z0: number, x1: number, z1: number, sel = 0.2, radius = 0.32) {
    this.x0 = x0;
    this.z0 = z0;
    this.sel = sel;
    this.radius = radius;
    this.w = Math.max(1, Math.ceil((x1 - x0) / sel));
    this.h = Math.max(1, Math.ceil((z1 - z0) / sel));
    const n = this.w * this.h;
    this.blok = new Uint8Array(n);
    this.komp = new Int32Array(n);
    this.gBuf = new Float32Array(n);
    this.asal = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.tutup = new Int32Array(n);
  }

  // ---- koordinat ----------------------------------------------------------------------------------------------------------
  ix(x: number): number { return Math.floor((x - this.x0) / this.sel); }
  iz(z: number): number { return Math.floor((z - this.z0) / this.sel); }
  private id(ix: number, iz: number): number { return iz * this.w + ix; }
  private dalam(ix: number, iz: number): boolean { return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h; }
  pusat(ix: number, iz: number): Titik { return [this.x0 + (ix + 0.5) * this.sel, this.z0 + (iz + 0.5) * this.sel]; }

  // ---- mengisi peta ---------------------------------------------------------------------------------------------------------
  /** Tandai kotak benda (koordinat dunia). Otomatis digemukkan sebesar radius badan AI. */
  tandaiKotak(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const r = this.radius;
    const a = Math.max(0, this.ix(minX - r));
    const b = Math.min(this.w - 1, this.ix(maxX + r));
    const c = Math.max(0, this.iz(minZ - r));
    const d = Math.min(this.h - 1, this.iz(maxZ + r));
    for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) this.blok[this.id(x, z)] = 1;
  }

  /** Panggil sekali setelah semua kotak ditandai: memberi label daerah terhubung. */
  selesai(): void {
    this.komp.fill(0);
    this.nKomp = 0;
    const antri = new Int32Array(this.w * this.h);
    for (let s = 0; s < this.blok.length; s++) {
      if (this.blok[s] || this.komp[s]) continue;
      this.nKomp += 1;
      let kepala = 0, ekor = 0;
      antri[ekor++] = s;
      this.komp[s] = this.nKomp;
      while (kepala < ekor) {
        const u = antri[kepala++];
        const ux = u % this.w, uz = (u - ux) / this.w;
        const tetangga = [[ux + 1, uz], [ux - 1, uz], [ux, uz + 1], [ux, uz - 1]];
        for (const [vx, vz] of tetangga) {
          if (!this.dalam(vx, vz)) continue;
          const v = this.id(vx, vz);
          if (this.blok[v] || this.komp[v]) continue;
          this.komp[v] = this.nKomp;
          antri[ekor++] = v;
        }
      }
    }
  }

  // ---- pertanyaan -----------------------------------------------------------------------------------------------------------
  bebas(x: number, z: number): boolean {
    const ix = this.ix(x), iz = this.iz(z);
    return this.dalam(ix, iz) && !this.blok[this.id(ix, iz)];
  }
  /** Label daerah terhubung di titik (0 = terhalang / di luar peta). */
  komponenDi(x: number, z: number): number {
    const ix = this.ix(x), iz = this.iz(z);
    return this.dalam(ix, iz) ? this.komp[this.id(ix, iz)] : 0;
  }
  get jumlahKomponen(): number { return this.nKomp; }
  persenTerhalang(): number {
    let n = 0;
    for (let i = 0; i < this.blok.length; i++) n += this.blok[i];
    return n / this.blok.length;
  }
  /** Untuk gambar debug: 1 = terhalang. */
  salinBlok(): Uint8Array { return this.blok.slice(); }

  /** Sel bebas terdekat dari (x, z); `komp` (opsional) = hanya sel di daerah terhubung itu. null kalau tidak ada dalam `maks` meter. */
  terdekatBebas(x: number, z: number, komp = 0, maks = 8): Titik | null {
    const cx = this.ix(x), cz = this.iz(z);
    const R = Math.ceil(maks / this.sel);
    let terbaik: Titik | null = null;
    let jarakTerbaik = Infinity;
    for (let r = 0; r <= R; r++) {
      if (terbaik && (r - 1) * this.sel > jarakTerbaik) break;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // hanya cincin ke-r
          const ix = cx + dx, iz = cz + dz;
          if (!this.dalam(ix, iz)) continue;
          const i = this.id(ix, iz);
          if (this.blok[i]) continue;
          if (komp && this.komp[i] !== komp) continue;
          const p = this.pusat(ix, iz);
          const j = Math.hypot(p[0] - x, p[1] - z);
          if (j < jarakTerbaik) { jarakTerbaik = j; terbaik = p; }
        }
      }
    }
    return terbaik;
  }

  /** Apakah garis lurus a -> b tidak menabrak apa pun (dicek tiap setengah sel). */
  garisBebas(ax: number, az: number, bx: number, bz: number): boolean {
    const jarak = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(jarak / (this.sel * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.bebas(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // ---- pencari jalur --------------------------------------------------------------------------------------------------------
  /**
   * Jalur dari `dari` ke `ke`. Hasil = daftar titik yang harus dilalui berurutan (titik awal TIDAK disertakan, titik akhir = `ke` persis).
   * Kalau awal / tujuan terhalang (mis. kursi), jalur dimulai / diakhiri di sel bebas terdekat. null = tidak ada jalur.
   */
  jalur(dari: Titik, ke: Titik): Titik[] | null {
    // tujuan: sel bebas (kalau terhalang, sel bebas terdekat)
    let tujuan: Titik | null = this.bebas(ke[0], ke[1]) ? this.pusat(this.ix(ke[0]), this.iz(ke[1])) : this.terdekatBebas(ke[0], ke[1]);
    if (!tujuan) return null;
    const kompTujuan = this.komponenDi(tujuan[0], tujuan[1]);
    let awal: Titik | null = this.bebas(dari[0], dari[1]) ? this.pusat(this.ix(dari[0]), this.iz(dari[1])) : this.terdekatBebas(dari[0], dari[1], kompTujuan);
    if (!awal) return null;
    if (this.komponenDi(awal[0], awal[1]) !== kompTujuan) return null;

    const sx = this.ix(awal[0]), sz = this.iz(awal[1]);
    const gx = this.ix(tujuan[0]), gz = this.iz(tujuan[1]);
    const sel = this.cariSel(sx, sz, gx, gz);
    if (!sel) return null;

    // titik belok: rapikan (string pulling) dari posisi awal sebenarnya (kalau bebas) atau dari sel awal
    const mulai: Titik = this.bebas(dari[0], dari[1]) ? [dari[0], dari[1]] : awal;
    const titik: Titik[] = sel.map(([x, z]) => this.pusat(x, z));
    const hasil: Titik[] = [];
    if (!this.bebas(dari[0], dari[1])) hasil.push(awal); // keluar dari benda ke sel bebas terdekat
    let cur: Titik = mulai;
    let i = 0;
    while (i < titik.length) {
      let j = titik.length - 1;
      while (j > i && !this.garisBebas(cur[0], cur[1], titik[j][0], titik[j][1])) j--;
      hasil.push(titik[j]);
      cur = titik[j];
      i = j + 1;
    }
    // titik akhir persis (kalau tujuan bebas = ke; kalau terhalang: sel bebas terdekat lalu ke persis)
    const akhir = hasil[hasil.length - 1];
    if (!akhir || Math.hypot(akhir[0] - ke[0], akhir[1] - ke[1]) > 1e-6) hasil.push([ke[0], ke[1]]);
    return hasil;
  }

  private cariSel(sx: number, sz: number, gx: number, gz: number): [number, number][] | null {
    if (sx === gx && sz === gz) return [[gx, gz]];
    this.giliran += 1;
    const G = this.giliran;
    const start = this.id(sx, sz), goal = this.id(gx, gz);
    const heur = (x: number, z: number) => {
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
      return (dx + dz) + (AKAR2 - 2) * Math.min(dx, dz);
    };
    // antrian prioritas (heap biner)
    const hk: number[] = [];
    const hv: number[] = [];
    const dorong = (k: number, v: number) => {
      let i = hk.length;
      hk.push(k); hv.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= k) break;
        hk[i] = hk[p]; hv[i] = hv[p]; i = p;
      }
      hk[i] = k; hv[i] = v;
    };
    const ambil = (): number => {
      const v0 = hv[0];
      const k = hk.pop()!, v = hv.pop()!;
      const n = hk.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= k) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = k; hv[i] = v;
      }
      return v0;
    };

    this.stamp[start] = G;
    this.gBuf[start] = 0;
    this.asal[start] = -1;
    dorong(heur(sx, sz), start);
    const arah: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, AKAR2], [1, -1, AKAR2], [-1, 1, AKAR2], [-1, -1, AKAR2]];
    while (hk.length) {
      const u = ambil();
      if (this.tutup[u] === G) continue;
      this.tutup[u] = G;
      if (u === goal) break;
      const ux = u % this.w, uz = (u - ux) / this.w;
      for (const [dx, dz, biaya] of arah) {
        const vx = ux + dx, vz = uz + dz;
        if (!this.dalam(vx, vz)) continue;
        const v = this.id(vx, vz);
        if (this.blok[v] || this.tutup[v] === G) continue;
        // jangan memotong sudut benda pada gerak diagonal
        if (dx !== 0 && dz !== 0 && (this.blok[this.id(ux + dx, uz)] || this.blok[this.id(ux, uz + dz)])) continue;
        const g = this.gBuf[u] + biaya;
        if (this.stamp[v] !== G || g < this.gBuf[v]) {
          this.stamp[v] = G;
          this.gBuf[v] = g;
          this.asal[v] = u;
          dorong(g + heur(vx, vz), v);
        }
      }
    }
    if (this.stamp[goal] !== G || this.tutup[goal] !== G) return null;
    const out: [number, number][] = [];
    for (let u = goal; u !== -1; u = this.asal[u]) {
      const ux = u % this.w;
      out.push([ux, (u - ux) / this.w]);
    }
    out.reverse();
    return out;
  }
}