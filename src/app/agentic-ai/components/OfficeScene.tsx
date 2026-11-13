'use client';

// Kantor 3D low-poly (kamera ortografis, bisa diputar 360°) — mode desain. Agen: Neo (robot), Atlas (rakun gemuk) & Zeno (rubah gemuk).
// Isi: ruangan, meja kerja, meja rapat bundar, sofa, tanaman, dan satu agen "Neo"
// yang berpindah antara mejanya dan meja rapat. Semua dari kotak/silinder (tanpa file model).
// Backend belum terhubung: gerakan Neo masih jadwal simulasi (ROUTE di bawah).
// Nanti ROUTE diganti event dari backend (mis. SSE) -> tujuan & status Neo.

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OtakPenghuni, type Penghuni } from '@/lib/penghuniOtak';
import { buatDunia, type DuniaPenghuni, type KonfigRuang, type KursiDunia } from '@/lib/duniaPenghuni';
import { PetaLantai } from '@/lib/petaLantai';
import { EVENT_TUGAS_AI, tugasAISaatIni, tugasAIDariUrl } from '@/lib/tugasAi';

export type AgentStatus = 'bekerja' | 'berjalan' | 'rapat' | 'santai';
export type NeoStatus = AgentStatus;

const C = {
  floor: '#E8E2D0',
  wall: '#C4D0C9',
  wallEdge: '#EEF2EF',
  wood: '#B98A55',
  woodDark: '#8F673C',
  chair: '#3E4A66',
  screen: '#0F2A24',
  glow: '#6EE7B7',
  rug: '#2F7D5B',
  sofaBlue: '#4C5FA8',
  sofaOrange: '#E0713F',
  leaf: '#3F9A5F',
  pot: '#C7B79A',
  robot: '#1F3B5C',
  robotLight: '#2E5A86',
};

type V3 = [number, number, number];

// [BARU] LEBAR LORONG: lorong 1 (antar baris atas & tengah) dan lorong 2 (antar baris tengah & bawah) kini sama lebar.
// LORONG_LEBAR = jarak tembok ke tembok (dulu lorong 1 = 3.2, lorong 2 = 2.6). Baris tengah bergeser GESER_BARIS_2 ke selatan,
// baris bawah (Planning, Management) bergeser GESER_BARIS_3. gz() memetakan z lama -> z baru (dipakai dinding, lantai, jalur agen).
const LORONG_LEBAR = 3.8;
const GESER_BARIS_2 = LORONG_LEBAR - 3.2; // 0.6
const GESER_BARIS_3 = GESER_BARIS_2 + (LORONG_LEBAR - 2.6); // 1.8
// [BARU] Kolom paling barat (AR, lorong, Research, lorong 2, Planning) dilebarkan ke barat sebesar ini supaya Research selebar Financial Statements (13.1).
// Ruang barunya kosong; hanya benda yang menempel di dinding barat (jendela, papan, layar, rak server, tanaman sudut) ikut bergeser.
const GESER_BARAT = 1.8;
// [BARU] DUA LORONG SAMPING (vertikal) di baris tengah, menghubungkan lorong 1 dan lorong 2 (ukuran & desain sama dengan lorong 2):
//   A = di antara Research dan Santai, B = di antara Asset dan Financial Statements. Tiap lorong selebar LORONG_LEBAR, jadi gedung
//   melebar TAMBAH_TIMUR ke timur. Santai & Asset bergeser GESER_SANTAI, Financial Statements bergeser GESER_STUDIO; baris atas (AR |
//   Transactions | AP) tetap dibagi tiga sama lebar, Management melebar sama besar (Planning tidak berubah).
const TAMBAH_TIMUR = 2 * LORONG_LEBAR; // 7.6
const X_TIMUR = 22.3 + TAMBAH_TIMUR; // dinding luar timur baru (dulu 22.3)
const GESER_SANTAI = LORONG_LEBAR; // Santai & Asset
const GESER_STUDIO = 2 * LORONG_LEBAR; // Financial Statements
const LS_A_X0 = -11.1, LS_A_X1 = LS_A_X0 + LORONG_LEBAR, LS_A_CX = (LS_A_X0 + LS_A_X1) / 2; // lorong A (dinding timur Research .. dinding barat Santai)
const SANTAI_X1 = -0.9 + GESER_SANTAI; // dinding timur Santai = dinding barat Asset
const LS_B_X0 = 9.3 + GESER_SANTAI, LS_B_X1 = LS_B_X0 + LORONG_LEBAR, LS_B_CX = (LS_B_X0 + LS_B_X1) / 2; // lorong B (dinding timur Asset .. dinding barat Financial Statements)
const LORONG_LANTAI_W = 44.4 + GESER_BARAT + TAMBAH_TIMUR; // panjang lantai lorong 1 & 2
const LORONG_LANTAI_CX = -GESER_BARAT / 2 + TAMBAH_TIMUR / 2;
// [DIUBAH] Tembok sekat Planning | Management digeser ke TENGAH baris 3: lebar Planning = lebar Management (total lebar gedung tidak berubah).
// Baris 3 membentang dari dinding barat (-22.3 - GESER_BARAT) sampai dinding timur (X_TIMUR); SEKAT_B3 = titik tengahnya (dulu sekat di x = -2.3).
const SEKAT_B3 = (-22.3 - GESER_BARAT + X_TIMUR) / 2; // 2.9
const PL_DX = SEKAT_B3 + 2.3; // Planning melebar ke timur sebesar ini (5.2); isi sisi timur ikut bergeser PL_DX, globe di tengah ikut PL_DX / 2
const MG_EXT = ((X_TIMUR - SEKAT_B3) - 24.6) / 2; // Management: tiap sisi melebar sebesar ini dari 24.6 (meja bundar tetap di tengah)
// [BARU] BARIS ATAS (AR | Transactions | AP) dibuat SAMA LEBAR. Total lebar baris atas = lebar gedung (dinding luar barat -24.1 .. timur X_TIMUR, sudah termasuk 2 lorong samping),
// dibagi tiga. Batas AR|Transactions = ATAS_B1, Transactions|AP = ATAS_B2. Transactions jadi bergeser TRX_OX ke barat (pusatnya tidak lagi di x = 0),
// isi ruangannya ikut digeser lewat <group position={[TRX_OX,0,0]}> dan jalur agennya lewat tx(). TRX_DX = berapa dinding barat/timur Transactions
// masuk ke dalam (16.2 -> ATAS_W), dipakai menggeser benda yang menempel di dinding.
const ATAS_XL = -22.3 - GESER_BARAT, ATAS_XR = X_TIMUR;
const ATAS_W = (ATAS_XR - ATAS_XL) / 3; // lebar (antar pusat dinding) tiap ruangan baris atas
const ATAS_B1 = ATAS_XL + ATAS_W;
const ATAS_B2 = ATAS_B1 + ATAS_W;
const TRX_OX = (ATAS_B1 + ATAS_B2) / 2;
const TRX_DX = (16.2 - ATAS_W) / 2;
const TRX_LANTAI_W = ATAS_W - 0.2;
const tx = (x: number) => x + TRX_OX; // x lokal Transactions -> x dunia
function gz(z: number): number {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  if (z <= 5.6) return z;
  if (z < 8.8) return r(5.6 + ((z - 5.6) * LORONG_LEBAR) / 3.2); // di dalam lorong 1
  if (z <= 17.1) return r(z + GESER_BARIS_2); // baris tengah
  if (z < 19.6) return r(17.1 + GESER_BARIS_2 + ((z - 17.1) * (2.5 + GESER_BARIS_3 - GESER_BARIS_2)) / 2.5); // di dalam lorong 2
  return r(z + GESER_BARIS_3); // baris bawah
}

function Box({ pos, size, color, rot, cast = true }: { pos: V3; size: V3; color: string; rot?: V3; cast?: boolean }) {
  return (
    <mesh position={pos} rotation={rot} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// ---- Helper kecil --------------------------------------------------------

const lighten = (c: string, a: number) => '#' + new THREE.Color(c).offsetHSL(0, 0, a).getHexString();

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Status kursi & layar komputer -------------------------------------------------
// Agen menulis seberapa "duduk" mereka di kursi (0..1); layar membaca nilai ini:
// kursi kosong -> layar mati, kursi terisi -> layar menyala dengan teks yang terus bergulir.

const SEAT: Record<string, number> = {};
const deskKey = (p: [number, number]) => `d:${p[0]},${p[1]}`;
const meetKey = (a: number) => `m:${Math.round(a / (Math.PI / 4))}`;

// Tekstur "teks jurnal" yang bisa digulir (canvas 256x512, 32 baris).
type ScreenTema = { bg: string; cols: string[]; glow: string };
function makeScreenTexture(seed: number, katakata?: string[], tema?: ScreenTema) {
  const W = 256;
  const H = 512;
  const LH = 16;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 0.3);
  if (g) {
    const r = mulberry32(seed);
    g.fillStyle = tema?.bg ?? '#0B1A17';
    g.fillRect(0, 0, W, H);
    g.font = '13px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    const words = katakata ?? ['Kas', 'Bank', 'Piutang', 'Utang', 'PPN', 'PPh21', 'Beban', 'Pendapatan', 'Debit', 'Kredit', 'Posting', 'Jurnal', 'Saldo', 'Total', 'Rp', 'Rekon', 'Invoice'];
    const cols = tema?.cols ?? ['#6EE7B7', '#A7F3D0', '#93C5FD', '#FDE68A', '#E5E7EB', '#F9A8D4'];
    for (let i = 0; i < H / LH; i++) {
      let x = 8 + (r() < 0.3 ? 16 : 0);
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const w =
          r() < 0.35
            ? String(Math.floor(r() * 9000000 + 100000)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
            : words[Math.floor(r() * words.length)];
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillText(w, x, i * LH + LH / 2);
        x += g.measureText(w).width + 8;
        if (x > W - 20) break;
      }
    }
  }
  return t;
}

// [PERFORMA] Tekstur layar dibagi: kanvas dasar dibuat sekali per variasi (maks. 8 variasi per tema), tiap layar memakai
// clone() sendiri (offset gulir terpisah) yang berbagi data gambar/GPU yang sama. Sebelumnya tiap layar membuat kanvas 256x512 sendiri.
const _layarDasar = new Map<string, THREE.CanvasTexture>();
function screenTexture(seed: number, katakata?: string[], tema?: ScreenTema) {
  const varian = Math.abs(Math.floor(seed)) % 8;
  const kunci = `${varian}|${katakata ? katakata.join(',') : ''}|${tema ? tema.bg + tema.cols.join('') : ''}`;
  let dasar = _layarDasar.get(kunci);
  if (!dasar) {
    dasar = makeScreenTexture(varian * 7919 + 13, katakata, tema);
    _layarDasar.set(kunci, dasar);
  }
  const t = dasar.clone();
  t.needsUpdate = true;
  return t;
}

let _glow: THREE.CanvasTexture | null = null;
function glowTex() {
  if (!_glow) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    _glow = new THREE.CanvasTexture(c);
  }
  return _glow;
}

type GlowSpec = { floorPos: V3; floorSize: [number, number]; haloPos: V3; haloSize: [number, number]; haloRot?: V3 };

function Screen({
  seatKey,
  size,
  pos,
  rot,
  seed,
  glow,
  ledPos,
  words,
  tema,
}: {
  seatKey: string;
  size: [number, number];
  pos: V3;
  rot?: V3;
  seed: number;
  glow: GlowSpec;
  ledPos?: V3;
  words?: string[];
  tema?: ScreenTema;
}) {
  const tex = useMemo(() => screenTexture(seed, words, tema), [seed, words, tema]);
  const gtex = useMemo(() => glowTex(), []);
  const screenMat = useRef<THREE.MeshBasicMaterial>(null);
  const screenMesh = useRef<THREE.Mesh>(null);
  const cursor = useRef<THREE.Mesh>(null);
  const floorMat = useRef<THREE.MeshBasicMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  const st = useRef({ level: 0, target: 0, next: 0.3 });

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    const on = (SEAT[seatKey] ?? 0) > 0.5 ? 1 : 0;
    s.level += (on - s.level) * Math.min(1, dt * (on ? 7 : 12));
    const L = s.level;
    if (screenMat.current) screenMat.current.opacity = L;
    if (screenMesh.current) screenMesh.current.visible = L > 0.01;

    if (on) {
      s.next -= dt;
      if (s.next <= 0) {
        s.target -= 1 / 32; // maju satu baris, seperti sedang mengetik
        s.next = 0.3 + Math.random() * 0.55;
      }
    }
    tex.offset.y += (s.target - tex.offset.y) * Math.min(1, dt * 10);
    if (s.target < -64) {
      s.target += 64;
      tex.offset.y += 64;
    }

    if (cursor.current) cursor.current.visible = L > 0.5 && Math.floor(state.clock.elapsedTime * 2) % 2 === 0;
    const flicker = 1 + Math.sin(state.clock.elapsedTime * 7 + seed) * 0.04;
    if (floorMat.current) floorMat.current.opacity = L * 0.3 * flicker;
    if (haloMat.current) haloMat.current.opacity = L * 0.17 * flicker;
    if (ledMat.current) {
      const col = on ? '#4ADE80' : '#EF4444';
      ledMat.current.color.set(col);
      ledMat.current.emissive.set(col);
      ledMat.current.emissiveIntensity = on ? 1.4 : 0.5;
    }
  });

  return (
    <>
      <group position={pos} rotation={rot}>
        <mesh ref={screenMesh} visible={false}>
          <planeGeometry args={size} />
          <meshBasicMaterial ref={screenMat} map={tex} transparent opacity={0} toneMapped={false} />
        </mesh>
        <mesh ref={cursor} position={[-size[0] / 2 + 0.05, -size[1] / 2 + 0.05, 0.002]} visible={false}>
          <planeGeometry args={[size[0] * 0.04, size[1] * 0.08]} />
          <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
        </mesh>
      </group>
      {/* sinar ke meja & sekitar layar */}
      <mesh position={glow.floorPos} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <planeGeometry args={glow.floorSize} />
        <meshBasicMaterial ref={floorMat} map={gtex} color={tema?.glow ?? '#6EE7B7'} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={glow.haloPos} rotation={glow.haloRot} renderOrder={5}>
        <planeGeometry args={glow.haloSize} />
        <meshBasicMaterial ref={haloMat} map={gtex} color={tema?.glow ?? '#6EE7B7'} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {ledPos && (
        <mesh position={ledPos}>
          <boxGeometry args={[0.03, 0.012, 0.006]} />
          <meshStandardMaterial ref={ledMat} color="#EF4444" emissive="#EF4444" emissiveIntensity={0.5} />
        </mesh>
      )}
    </>
  );
}

function Tube({ pos, r, rb, h, color, rot, seg = 20, cast = true }: { pos: V3; r: number; rb?: number; h: number; color: string; rot?: V3; seg?: number; cast?: boolean }) {
  return (
    <mesh position={pos} rotation={rot} castShadow={cast} receiveShadow>
      <cylinderGeometry args={[r, rb ?? r, h, seg]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Cone({ pos, r, h, color, rot, seg = 6 }: { pos: V3; r: number; h: number; color: string; rot?: V3; seg?: number }) {
  return (
    <mesh position={pos} rotation={rot} castShadow>
      <coneGeometry args={[r, h, seg]} />
      <meshLambertMaterial color={color} flatShading />
    </mesh>
  );
}

function Ball({ pos, r, color, emissive, flat = true }: { pos: V3; r: number; color: string; emissive?: number; flat?: boolean }) {
  return (
    <mesh position={pos} castShadow>
      <icosahedronGeometry args={[r, flat ? 0 : 2]} />
      {emissive ? (
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive} flatShading={flat} />
      ) : (
        <meshLambertMaterial color={color} flatShading={flat} />
      )}
    </mesh>
  );
}

// ---- Ruangan ---------------------------------------------------------------

// Dinding tinggi: memudar saat kamera berada di sisi luarnya, supaya isi ruangan tetap terlihat saat diputar.
// [DIUBAH] `luar` = sisi luar dinding (px/nx/pz/nz) dicat putih (PUTIH_LUAR, didefinisikan di dekat <Dinding />); sisi lain tetap C.wall. Keduanya ikut memudar.
function Wall({ pos, size, axis, luar }: { pos: V3; size: V3; axis: 'x' | 'z'; luar?: 'px' | 'nx' | 'pz' | 'nz' }) {
  const mats = useMemo(() => {
    const a = new THREE.MeshLambertMaterial({ color: C.wall, transparent: true });
    const b = luar ? new THREE.MeshLambertMaterial({ color: PUTIH_LUAR, transparent: true }) : a;
    const idx = luar ? { px: 0, nx: 1, pz: 4, nz: 5 }[luar] : -1; // urutan sisi boxGeometry: +x, -x, +y, -y, +z, -z
    // [DIUBAH] ujung dinding (sudut) juga putih: axis 'z' membentang sepanjang x -> ujung = sisi 0 & 1; axis 'x' -> sisi 4 & 5
    const ujung = luar ? (axis === 'z' ? [0, 1] : [4, 5]) : [];
    return { a, b, arr: [0, 1, 2, 3, 4, 5].map((k) => (k === idx || ujung.includes(k) ? b : a)) };
  }, [luar, axis]);
  useEffect(() => () => { mats.a.dispose(); if (mats.b !== mats.a) mats.b.dispose(); }, [mats]);
  useFrame(({ camera }, dt) => {
    const outside = axis === 'z' ? camera.position.z < pos[2] : camera.position.x < pos[0];
    const k = Math.min(1, dt * 8);
    for (const m of mats.b === mats.a ? [mats.a] : [mats.a, mats.b]) m.opacity += ((outside ? 0.1 : 1) - m.opacity) * k;
  });
  return (
    <mesh position={pos} castShadow receiveShadow material={mats.arr}>
      <boxGeometry args={size} />
    </mesh>
  );
}

// Lantai berpola ubin (tekstur dari canvas, 1 ubin = 1 unit).
// [DIUBAH] Porselen krem 1x1 dua nada (papan catur halus) dengan urat marmer, bintik, sambungan, bevel, dan penanda berlian di tiap sambungan.
function FloorTiles({ w = 16 }: { w?: number }) {
  const tex = useMemo(() => {
    const S = 512, T = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    if (g) {
      const r = mulberry32(2026);
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const x0 = i * T, y0 = j * T;
          g.fillStyle = (i + j) % 2 === 1 ? '#E2DBC6' : '#EAE4D3';
          g.fillRect(x0, y0, T, T);
          const gr = g.createLinearGradient(x0, y0, x0 + T, y0 + T);
          gr.addColorStop(0, 'rgba(255,255,255,0.18)');
          gr.addColorStop(1, 'rgba(120,100,60,0.06)');
          g.fillStyle = gr;
          g.fillRect(x0, y0, T, T);
          g.save();
          g.beginPath();
          g.rect(x0, y0, T, T);
          g.clip();
          for (let k = 0; k < 3; k++) {
            let x = x0 + r() * T, y = y0 - 10;
            g.beginPath();
            g.moveTo(x, y);
            for (let sg = 0; sg < 5; sg++) {
              const nx = x + (r() - 0.5) * 90, ny = y + T / 4.5;
              g.quadraticCurveTo(x + (r() - 0.5) * 70, (y + ny) / 2, nx, ny);
              x = nx; y = ny;
            }
            g.strokeStyle = k === 0 ? 'rgba(150,132,96,0.20)' : 'rgba(150,132,96,0.10)';
            g.lineWidth = k === 0 ? 1.6 : 0.9;
            g.stroke();
          }
          for (let k = 0; k < 50; k++) {
            g.fillStyle = `rgba(120,100,60,${0.05 + r() * 0.05})`;
            g.fillRect(x0 + r() * T, y0 + r() * T, 1.5, 1.5);
          }
          g.restore();
        }
      }
      // sambungan (grout) + bevel tiap ubin
      g.fillStyle = '#CBC2A6';
      for (const p of [0, T]) { g.fillRect(p - 2, 0, 4, S); g.fillRect(0, p - 2, S, 4); }
      g.fillRect(S - 2, 0, 2, S);
      g.fillRect(0, S - 2, S, 2);
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const x0 = i * T, y0 = j * T;
          g.fillStyle = 'rgba(255,255,255,0.55)';
          g.fillRect(x0 + 3, y0 + 3, T - 6, 1.5);
          g.fillRect(x0 + 3, y0 + 3, 1.5, T - 6);
          g.fillStyle = 'rgba(110,95,60,0.25)';
          g.fillRect(x0 + 3, y0 + T - 4.5, T - 6, 1.5);
          g.fillRect(x0 + T - 4.5, y0 + 3, 1.5, T - 6);
        }
      }
      // penanda berlian kecil di tiap pertemuan sambungan
      for (const px of [0, T, S]) {
        for (const py of [0, T, S]) {
          g.save();
          g.translate(px, py);
          g.rotate(Math.PI / 4);
          g.fillStyle = '#BDB293';
          g.fillRect(-5, -5, 10, 10);
          g.fillStyle = '#E9E2CD';
          g.fillRect(-2.5, -2.5, 5, 5);
          g.restore();
        }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 2, 5.5);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [w]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
      <planeGeometry args={[w, 11]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Jendela. Sisi +z lokal = arah ke dalam ruangan.
function Window({ pos, rotY = 0, w = 1.8 }: { pos: V3; rotY?: number; w?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[w, 0.95, 0.07]} color="#F3F6F4" cast={false} />
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[w - 0.2, 0.75, 0.03]} />
        <meshStandardMaterial color="#BFE3F2" emissive="#BFE3F2" emissiveIntensity={0.55} />
      </mesh>
      <Box pos={[0, 0, 0.05]} size={[0.04, 0.75, 0.04]} color="#F3F6F4" cast={false} />
      <Box pos={[0, 0, 0.05]} size={[w - 0.2, 0.04, 0.04]} color="#F3F6F4" cast={false} />
      <Box pos={[0, -0.5, 0.08]} size={[w + 0.1, 0.05, 0.18]} color="#F3F6F4" cast={false} />
    </group>
  );
}

// Jam dinding mengikuti waktu nyata WIB (Asia/Jakarta, UTC+7, tanpa DST); jarum jam, menit, dan detik bergerak.
function Clock({ pos }: { pos: V3 }) {
  const hourH = useRef<THREE.Group>(null);
  const minH = useRef<THREE.Group>(null);
  const secH = useRef<THREE.Group>(null);
  useFrame(() => {
    const ms = (Date.now() + 7 * 3600 * 1000) % (24 * 3600 * 1000);
    const detik = (ms / 1000) % 60;
    const menit = (ms / 60000) % 60;
    const jam = (ms / 3600000) % 12;
    if (secH.current) secH.current.rotation.z = -(detik / 60) * Math.PI * 2;
    if (minH.current) minH.current.rotation.z = -(menit / 60) * Math.PI * 2;
    if (hourH.current) hourH.current.rotation.z = -(jam / 12) * Math.PI * 2;
  });
  return (
    <group position={pos}>
      <Tube pos={[0, 0, 0]} r={0.31} h={0.05} color="#2B3340" rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      <Tube pos={[0, 0, 0.03]} r={0.27} h={0.03} color="#F7F7F5" rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      {/* penanda 12, 3, 6, 9 */}
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} pos={[Math.sin((i * Math.PI) / 2) * 0.22, Math.cos((i * Math.PI) / 2) * 0.22, 0.048]} size={[0.02, 0.05, 0.006]} rot={[0, 0, (i * Math.PI) / 2]} color="#2B3340" cast={false} />
      ))}
      <group ref={hourH} position={[0, 0, 0.055]}>
        <Box pos={[0, 0.05, 0]} size={[0.03, 0.12, 0.01]} color="#2B3340" cast={false} />
      </group>
      <group ref={minH} position={[0, 0, 0.062]}>
        <Box pos={[0, 0.08, 0]} size={[0.02, 0.18, 0.01]} color="#2B3340" cast={false} />
      </group>
      <group ref={secH} position={[0, 0, 0.069]}>
        <Box pos={[0, 0.09, 0]} size={[0.008, 0.2, 0.008]} color="#E0713F" cast={false} />
      </group>
      <Box pos={[0, 0, 0.074]} size={[0.04, 0.04, 0.01]} color="#E0713F" cast={false} />
    </group>
  );
}

function Whiteboard({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.9, 0.95, 0.05]} color="#B8C4BE" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[1.8, 0.85, 0.02]} color="#FAFBFA" cast={false} />
      <Box pos={[-0.35, 0.2, 0.045]} size={[0.8, 0.03, 0.005]} color="#2F7D5B" cast={false} />
      <Box pos={[-0.45, 0.08, 0.045]} size={[0.6, 0.025, 0.005]} color="#4C5FA8" cast={false} />
      <Box pos={[-0.4, -0.04, 0.045]} size={[0.7, 0.025, 0.005]} color="#4C5FA8" cast={false} />
      <Box pos={[-0.5, -0.16, 0.045]} size={[0.5, 0.025, 0.005]} color="#E0713F" cast={false} />
      <Box pos={[0.5, 0.18, 0.045]} size={[0.22, 0.22, 0.006]} color="#FDE68A" cast={false} />
      <Box pos={[0.74, 0.0, 0.045]} size={[0.22, 0.22, 0.006]} color="#FBCFE8" cast={false} />
      <Box pos={[0.46, -0.12, 0.045]} size={[0.22, 0.22, 0.006]} color="#A7F3D0" cast={false} />
      <Box pos={[0, -0.5, 0.06]} size={[1.2, 0.03, 0.09]} color="#B8C4BE" cast={false} />
      <Box pos={[-0.3, -0.47, 0.07]} size={[0.14, 0.02, 0.02]} color="#E0713F" cast={false} />
      <Box pos={[-0.1, -0.47, 0.07]} size={[0.14, 0.02, 0.02]} color="#2F7D5B" cast={false} />
    </group>
  );
}

function Art({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[1.1, 0.7, 0.05]} color="#5B4630" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[0.96, 0.56, 0.02]} color="#DCEFE6" cast={false} />
      <Box pos={[-0.25, -0.1, 0.045]} size={[0.3, 0.3, 0.006]} color="#2F7D5B" cast={false} />
      <Box pos={[0.1, 0.05, 0.045]} size={[0.26, 0.26, 0.006]} color="#E0713F" cast={false} />
      <Box pos={[0.3, -0.12, 0.045]} size={[0.22, 0.22, 0.006]} color="#4C5FA8" cast={false} />
    </group>
  );
}

function Room() {
  return (
    <group>
      <Box pos={[0, -0.1, 0]} size={[TRX_LANTAI_W, 0.2, 11]} color={C.floor} cast={false} />
      <FloorTiles w={TRX_LANTAI_W} />
      {/* dinding belakang & kiri */}
      <Wall pos={[0, 0.8, -5.6]} size={[ATAS_W + 0.2, 1.6, 0.2]} axis="z" luar="nz" />
      <Wall pos={[-ATAS_W / 2, 0.8, 0]} size={[0.2, 1.6, 11]} axis="x" luar="nx" />
      {/* [DIUBAH] lis atas: separuh sisi luar putih, separuh sisi dalam warna lama */}
      <Box pos={[0, 1.62, -5.66]} size={[ATAS_W + 0.2, 0.04, 0.12]} color={PUTIH_LUAR} cast={false} />
      <Box pos={[0, 1.62, -5.54]} size={[ATAS_W + 0.2, 0.04, 0.12]} color={C.wallEdge} cast={false} />
      <Box pos={[-ATAS_W / 2 - 0.06, 1.62, 0]} size={[0.12, 0.04, 11]} color={PUTIH_LUAR} cast={false} />
      <Box pos={[-ATAS_W / 2 + 0.06, 1.62, 0]} size={[0.12, 0.04, 11]} color={C.wallEdge} cast={false} />
      {/* [DIUBAH] plint lama diganti lapisan dinding baru (plint hijau tua + dado + kertas dinding + list) di belakang, barat, dan timur */}
      <DindingDekorTrx s={-5.5} segs={[[-8.9, 8.7]]} />
      <group rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorTrx s={-8.9} segs={[[-5.43, 5.45]]} />
      </group>
      <group rotation={[0, -Math.PI / 2, 0]}>
        <DindingDekorTrx s={-8.7} segs={[[-5.43, 5.45]]} />
      </group>
      {/* [BARU] hiasan lantai (inlay, karpet meja, runner, keset, cincin meja rapat) */}
      <LantaiDekorTrx />
      {/* dinding depan & kanan Kantor = partisi kaca dari <Gedung /> */}
      {/* hiasan dinding belakang */}
      <Window pos={[-6.2, 1.0, -5.46]} />
      <Art pos={[-3.4, 1.05, -5.46]} />
      <Clock pos={[0.6, 1.15, -5.46]} />
      <Whiteboard pos={[2.2, 1.0, -5.46]} />
      <Art pos={[4.3, 1.2, -5.46]} />
      <WallAC pos={[-1.2, 1.35, -5.46]} />
      <Extinguisher pos={[7.6 - TRX_DX, 0.28, -5.4]} />
      <SunPatch pos={[-5.7, 0.045, -4.0]} size={[3.0, 3.6]} rotY={0.35} />
      <SunPatch pos={[-6.2, 0.045, -0.9]} size={[3.2, 2.4]} rotY={-0.15} />
      {/* hiasan dinding kiri */}
      <WallTV pos={[-7.95 + TRX_DX, 1.05, 0.9]} rotY={Math.PI / 2} />
      <Window pos={[-7.96 + TRX_DX, 1.0, -1.5]} rotY={Math.PI / 2} />
      <Art pos={[-7.96 + TRX_DX, 1.05, 2.9]} rotY={Math.PI / 2} />
      {/* karpet area rapat (dengan bingkai) */}
      {/* [DIUBAH] karpet bundar abu-abu (diameter = sisi pendek karpet kotak lama: 4.8 / 4.4 / 4.0) */}
      <Tube pos={[4.6, 0.01, 1.8]} r={2.4} h={0.02} color="#7B8794" seg={64} cast={false} />
      <Tube pos={[4.6, 0.022, 1.8]} r={2.2} h={0.02} color="#8E99A6" seg={64} cast={false} />
      <Tube pos={[4.6, 0.034, 1.8]} r={2.0} h={0.02} color="#9AA5B1" seg={64} cast={false} />
      {/* karpet area sofa */}
      <Box pos={[-5.7, 0.01, 3.7]} size={[3.8, 0.02, 3.0]} color="#9FB3C8" cast={false} />
      <Box pos={[-5.7, 0.022, 3.7]} size={[3.5, 0.02, 2.7]} color="#B9C8D8" cast={false} />
    </group>
  );
}

// ---- Meja & kursi ------------------------------------------------------------

// [BARU] Tiap meja punya ciri khas sesuai halaman Transactions yang terhubung (urutan = HALAMAN_MEJA di tugasKantor.ts).
type PageKey = 'sales' | 'purchase' | 'journal' | 'bank' | 'other' | 'ar';

function Mug({ pos, color = '#F3F4F6', steam = false, seed = 0 }: { pos: V3; color?: string; steam?: boolean; seed?: number }) {
  return (
    <group position={pos}>
      {steam && <Steam pos={[0, 0.11, 0]} rise={0.36} size={0.062} peak={0.9} count={6} speed={0.4} seed={seed} />}
      <Tube pos={[0, 0.05, 0]} r={0.045} h={0.1} color={color} seg={14} cast={false} />
      <Box pos={[0.06, 0.05, 0]} size={[0.025, 0.06, 0.02]} color={color} cast={false} />
      <Tube pos={[0, 0.098, 0]} r={0.036} h={0.006} color="#5B3A29" seg={14} cast={false} />
    </group>
  );
}

const PAGE_STYLE: Record<PageKey, { label: string; color: string }> = {
  sales: { label: 'SALES', color: '#10B981' },
  purchase: { label: 'PURCHASE', color: '#F59E0B' },
  journal: { label: 'JOURNAL', color: '#3B82F6' },
  bank: { label: 'CASH & BANK', color: '#14B8A6' },
  other: { label: 'OTHER', color: '#8B5CF6' },
  ar: { label: 'RECEIVABLE', color: '#14B8A6' }, // [BARU] meja Account Receivable
};

// Papan nama berdiri di tepi depan meja (miring ke belakang, menghadap kamera).
const _papanNama = new Map<string, THREE.CanvasTexture>();
function papanNamaTex(label: string, color: string) {
  const kunci = `${label}|${color}`;
  const ada = _papanNama.get(kunci);
  if (ada) return ada;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#F8FAFC';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 24);
    let fs = 76;
    g.font = `800 ${fs}px Inter, system-ui, sans-serif`;
    while (g.measureText(label).width > 460 && fs > 24) {
      fs -= 4;
      g.font = `800 ${fs}px Inter, system-ui, sans-serif`;
    }
    g.fillStyle = '#0F172A';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 256, 78);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _papanNama.set(kunci, t);
  return t;
}

function DeskPlate({ label, color }: { label: string; color: string }) {
  // [PERFORMA] Papan nama dengan label+warna sama memakai satu tekstur (dulu: satu kanvas per meja).
  const tex = useMemo(() => papanNamaTex(label, color), [label, color]);
  return (
    <group position={[-0.3, 0.82, 0.33]} rotation={[0, 0.55, 0]}>
      <Box pos={[0, 0.012, -0.04]} size={[0.5, 0.024, 0.1]} color="#94A3B8" cast={false} />
      <group rotation={[-0.35, 0, 0]}>
        <Box pos={[0, 0.075, -0.012]} size={[0.58, 0.15, 0.02]} color="#CBD5E1" cast={false} />
        <mesh position={[0, 0.075, 0.0]}>
          <planeGeometry args={[0.56, 0.14]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// Barang khas tiap halaman (koordinat lokal meja; permukaan meja y = 0.82).
function DeskKit({ page }: { page: PageKey }) {
  if (page === 'sales') {
    // grafik batang naik + tas belanja + koin
    const tinggi = [0.07, 0.12, 0.18, 0.25];
    return (
      <>
        <Box pos={[-0.62, 0.826, -0.1]} size={[0.36, 0.012, 0.14]} color="#F8FAFC" cast={false} />
        {tinggi.map((h, i) => (
          <Box key={i} pos={[-0.74 + i * 0.075, 0.832 + h / 2, -0.1]} size={[0.05, h, 0.05]} color={i === 3 ? '#059669' : '#34D399'} cast={false} />
        ))}
        <Box pos={[0.62, 0.92, -0.14]} size={[0.16, 0.2, 0.1]} color="#34D399" cast={false} />
        <Box pos={[0.62, 0.935, -0.087]} size={[0.07, 0.07, 0.006]} color="#FFFFFF" cast={false} />
        <Box pos={[0.58, 1.04, -0.14]} size={[0.01, 0.06, 0.01]} color="#065F46" cast={false} />
        <Box pos={[0.66, 1.04, -0.14]} size={[0.01, 0.06, 0.01]} color="#065F46" cast={false} />
        <Box pos={[0.62, 1.07, -0.14]} size={[0.09, 0.01, 0.01]} color="#065F46" cast={false} />
        <Tube pos={[0.45, 0.83, -0.02]} r={0.04} h={0.01} color="#FBBF24" seg={14} cast={false} />
        <Mug pos={[-0.6, 0.82, 0.12]} color="#A7F3D0" steam seed={0.1} />
      </>
    );
  }
  if (page === 'purchase') {
    // tumpukan kardus berpita + papan klip (nota)
    return (
      <>
        <Box pos={[-0.64, 0.9, -0.12]} size={[0.28, 0.16, 0.22]} color="#C8A06A" cast={false} />
        <Box pos={[-0.64, 0.9, -0.12]} size={[0.05, 0.162, 0.222]} color="#E5D3A8" cast={false} />
        <Box pos={[-0.62, 1.04, -0.12]} size={[0.2, 0.12, 0.16]} color="#D9B17A" rot={[0, 0.3, 0]} cast={false} />
        <Box pos={[-0.62, 1.04, -0.12]} size={[0.045, 0.122, 0.162]} color="#E5D3A8" rot={[0, 0.3, 0]} cast={false} />
        <Box pos={[-0.64, 1.14, -0.12]} size={[0.13, 0.08, 0.11]} color="#C8A06A" rot={[0, -0.25, 0]} cast={false} />
        <Box pos={[0.62, 0.83, -0.02]} size={[0.22, 0.012, 0.3]} color="#8B5E34" rot={[0, -0.2, 0]} cast={false} />
        <Box pos={[0.62, 0.84, -0.02]} size={[0.19, 0.008, 0.26]} color="#FFFFFF" rot={[0, -0.2, 0]} cast={false} />
        {[0, 1, 2].map((i) => (
          <Box key={i} pos={[0.62 - i * 0.008, 0.846, -0.07 + i * 0.05]} size={[0.14, 0.004, 0.012]} color="#F59E0B" rot={[0, -0.2, 0]} cast={false} />
        ))}
        <Box pos={[0.59, 0.842, -0.16]} size={[0.08, 0.02, 0.025]} color="#6B7280" rot={[0, -0.2, 0]} cast={false} />
        <Mug pos={[-0.6, 0.82, 0.14]} color="#FDE68A" steam seed={0.5} />
      </>
    );
  }
  if (page === 'journal') {
    // tumpukan buku besar + buku jurnal terbuka + pena
    const buku = ['#1E3A8A', '#3B82F6', '#1D4ED8', '#93C5FD'];
    return (
      <>
        {buku.map((c, i) => (
          <Box key={i} pos={[-0.64 + (i % 2) * 0.012, 0.845 + i * 0.052, -0.12]} size={[0.32, 0.05, 0.23]} color={c} rot={[0, (i - 1.5) * 0.08, 0]} cast={false} />
        ))}
        <Box pos={[0.58, 0.83, 0.02]} size={[0.44, 0.014, 0.3]} color="#1E3A8A" rot={[0, -0.15, 0]} cast={false} />
        <Box pos={[0.47, 0.842, 0.02]} size={[0.2, 0.01, 0.27]} color="#FFFFFF" rot={[0.0, -0.15, 0.04]} cast={false} />
        <Box pos={[0.69, 0.842, 0.02]} size={[0.2, 0.01, 0.27]} color="#FFFFFF" rot={[0.0, -0.15, -0.04]} cast={false} />
        {[0, 1, 2, 3].map((i) => (
          <React.Fragment key={i}>
            <Box pos={[0.47 - i * 0.004, 0.849, -0.07 + i * 0.055]} size={[0.15, 0.003, 0.008]} color="#93C5FD" rot={[0, -0.15, 0.04]} cast={false} />
            <Box pos={[0.69 - i * 0.004, 0.849, -0.07 + i * 0.055]} size={[0.15, 0.003, 0.008]} color="#93C5FD" rot={[0, -0.15, -0.04]} cast={false} />
          </React.Fragment>
        ))}
        <Box pos={[0.4, 0.86, 0.2]} size={[0.012, 0.012, 0.16]} color="#111827" rot={[0, 0.5, 0]} cast={false} />
      </>
    );
  }
  if (page === 'bank') {
    // tumpukan koin + ikat uang kertas + kartu bank
    return (
      <>
        {[4, 6, 3].map((n, k) => (
          <React.Fragment key={k}>
            {Array.from({ length: n }).map((_, i) => (
              <Tube key={i} pos={[-0.72 + k * 0.1, 0.835 + i * 0.022, -0.12 + (k === 1 ? 0.04 : 0)]} r={0.045} h={0.02} color={i % 2 ? '#F59E0B' : '#FBBF24'} seg={16} cast={false} />
            ))}
          </React.Fragment>
        ))}
        <Box pos={[0.6, 0.85, -0.12]} size={[0.24, 0.05, 0.11]} color="#86EFAC" rot={[0, 0.15, 0]} cast={false} />
        <Box pos={[0.6, 0.9, -0.12]} size={[0.24, 0.05, 0.11]} color="#4ADE80" rot={[0, 0.05, 0]} cast={false} />
        <Box pos={[0.6, 0.875, -0.12]} size={[0.05, 0.107, 0.114]} color="#166534" rot={[0, 0.1, 0]} cast={false} />
        <Box pos={[0.62, 0.829, 0.16]} size={[0.17, 0.006, 0.11]} color="#0F766E" rot={[0, 0.35, 0]} cast={false} />
        <Box pos={[0.6, 0.834, 0.17]} size={[0.04, 0.004, 0.03]} color="#FDE68A" rot={[0, 0.35, 0]} cast={false} />
      </>
    );
  }
  // other: baki berkas warna-warni + kotak arsip + kertas tempel
  return (
    <>
      <Box pos={[-0.64, 0.835, -0.1]} size={[0.34, 0.03, 0.24]} color="#6D28D9" cast={false} />
      {['#A78BFA', '#F9A8D4', '#FDE68A', '#93C5FD'].map((c, i) => (
        <Box key={i} pos={[-0.64 + i * 0.012, 0.86 + i * 0.016, -0.1]} size={[0.3, 0.014, 0.21]} color={c} rot={[0, (i - 1.5) * 0.1, 0]} cast={false} />
      ))}
      <Box pos={[0.62, 0.9, -0.1]} size={[0.24, 0.16, 0.2]} color="#E2E8F0" cast={false} />
      <Box pos={[0.62, 0.92, 0.0]} size={[0.1, 0.03, 0.01]} color="#475569" cast={false} />
      <Box pos={[0.62, 0.99, -0.1]} size={[0.26, 0.015, 0.22]} color="#CBD5E1" cast={false} />
      <Box pos={[0.36, 0.83, -0.28]} size={[0.07, 0.006, 0.07]} color="#FDE68A" rot={[0, 0.2, 0]} cast={false} />
      <Box pos={[0.45, 0.83, -0.3]} size={[0.07, 0.006, 0.07]} color="#F9A8D4" rot={[0, -0.15, 0]} cast={false} />
      <Box pos={[0.28, 0.83, -0.3]} size={[0.07, 0.006, 0.07]} color="#C4B5FD" rot={[0, 0.1, 0]} cast={false} />
    </>
  );
}

// ---- [BARU] Perlengkapan meja Account Receivable ---------------------------------------------------------------------------
// Ukuran meja AR = ukuran meja Transactions (komponen <Desk /> yang sama: daun 1.72 x 0.88, tinggi 0.82). Yang berbeda hanya
// papan nama, alas meja (teal), dan isi mejanya. Tiga varian: 0 = Billing (Kilo), 1 = Collection (Lumen), 2 = Reconcile (Matrix).

// Kolam cahaya lembut (additive) di lantai / meja / dinding; ikut meredup bersama ruangan saat ruangan lain difokuskan.
function Kolam({ pos, size, color = '#FFF1C9', opacity = 0.16, rot = [-Math.PI / 2, 0, 0] }: { pos: V3; size: [number, number]; color?: string; opacity?: number; rot?: V3 }) {
  const gtex = useMemo(() => glowTex(), []);
  return (
    <mesh position={pos} rotation={rot} renderOrder={4}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={gtex} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

// Lampu meja kecil: kaki, lengan, kap menyala, dan bercak cahaya hangat di meja.
function LampuMeja({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Tube pos={[0, 0.012, 0]} r={0.06} h={0.024} color="#2B3340" seg={16} cast={false} />
      <Box pos={[0, 0.14, 0]} size={[0.018, 0.25, 0.018]} color="#475569" cast={false} />
      <Box pos={[0.06, 0.27, 0]} size={[0.16, 0.016, 0.018]} color="#475569" rot={[0, 0, 0.35]} cast={false} />
      <group position={[0.15, 0.3, 0]} rotation={[0, 0, -0.5]}>
        <mesh>
          <cylinderGeometry args={[0.035, 0.075, 0.09, 14, 1, true]} />
          <meshStandardMaterial color="#FDE9B8" emissive="#FDE9B8" emissiveIntensity={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <Kolam pos={[0.2, 0.004, 0.03]} size={[0.66, 0.52]} opacity={0.09} />
    </group>
  );
}

function KalkulatorMeja({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.014, 0]} size={[0.12, 0.028, 0.17]} color="#2B3340" cast={false} />
      <Box pos={[0, 0.0305, -0.055]} size={[0.095, 0.004, 0.035]} color="#A7F3D0" cast={false} />
      {[0, 1, 2, 3].flatMap((r) =>
        [0, 1, 2].map((c) => (
          <Box key={`${r}${c}`} pos={[-0.034 + c * 0.034, 0.031, -0.012 + r * 0.03]} size={[0.026, 0.005, 0.02]} color={r === 3 && c === 2 ? EMAS : '#E5E7EB'} cast={false} />
        ))
      )}
    </group>
  );
}

function TumpukKertas({ pos, n = 5, rotY = 0, header = '#2AA79B' }: { pos: V3; n?: number; rotY?: number; header?: string }) {
  const atas = 0.006 + (n - 1) * 0.011 + 0.005 + 0.0015;
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <Box key={i} pos={[(i % 2) * 0.004, 0.006 + i * 0.011, (i % 3) * 0.003]} size={[0.22, 0.01, 0.3]} color="#FFFFFF" rot={[0, (i - n / 2) * 0.02, 0]} cast={false} />
      ))}
      <Box pos={[0, atas, -0.1]} size={[0.2, 0.002, 0.045]} color={header} cast={false} />
      {[-0.03, 0.0, 0.03, 0.06, 0.09].map((z) => (
        <Box key={z} pos={[0, atas, z]} size={[0.17, 0.002, 0.008]} color="#CBD5D1" cast={false} />
      ))}
      <Box pos={[0.07, atas, 0.12]} size={[0.06, 0.002, 0.03]} color="#94A3B8" cast={false} />
    </group>
  );
}

function Stempel({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0.1, 0.007, 0]} size={[0.11, 0.014, 0.085]} color="#DC2626" cast={false} />
      <Box pos={[0, 0.045, 0]} size={[0.08, 0.03, 0.055]} color="#2B3340" cast={false} />
      <Tube pos={[0, 0.09, 0]} r={0.018} h={0.07} color="#8B5E34" seg={10} cast={false} />
      <Ball pos={[0, 0.135, 0]} r={0.028} color="#8B5E34" flat={false} />
    </group>
  );
}

function TeleponMeja({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.03, 0]} size={[0.2, 0.06, 0.22]} color="#1F2937" cast={false} />
      <Box pos={[0, 0.064, 0.05]} size={[0.16, 0.008, 0.1]} color="#334155" rot={[-0.12, 0, 0]} cast={false} />
      {[0, 1, 2, 3].flatMap((r) =>
        [0, 1, 2].map((c) => (
          <Box key={`${r}${c}`} pos={[-0.04 + c * 0.04, 0.071, 0.012 + r * 0.026]} size={[0.026, 0.005, 0.018]} color="#E5E7EB" rot={[-0.12, 0, 0]} cast={false} />
        ))
      )}
      <mesh position={[0, 0.067, -0.07]}>
        <boxGeometry args={[0.1, 0.006, 0.03]} />
        <meshStandardMaterial color="#6EE7B7" emissive="#6EE7B7" emissiveIntensity={0.9} />
      </mesh>
      {/* gagang telepon */}
      <Box pos={[0, 0.098, -0.02]} size={[0.04, 0.03, 0.22]} color="#111827" cast={false} />
      <Box pos={[0, 0.088, -0.125]} size={[0.055, 0.04, 0.05]} color="#111827" cast={false} />
      <Box pos={[0, 0.088, 0.085]} size={[0.055, 0.04, 0.05]} color="#111827" cast={false} />
      <mesh position={[0.085, 0.066, -0.08]}>
        <boxGeometry args={[0.012, 0.006, 0.012]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.3} />
      </mesh>
    </group>
  );
}

function HeadsetMeja({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.04, 0]}>
        <torusGeometry args={[0.07, 0.009, 8, 20, Math.PI]} />
        <meshLambertMaterial color="#1F2937" />
      </mesh>
      {[-1, 1].map((sd) => (
        <Tube key={sd} pos={[sd * 0.07, 0.045, 0]} r={0.03} h={0.026} color="#111827" rot={[0, 0, Math.PI / 2]} seg={14} cast={false} />
      ))}
      <Box pos={[-0.09, 0.025, 0.05]} size={[0.008, 0.008, 0.1]} color="#111827" rot={[0, 0.4, 0]} cast={false} />
      <Ball pos={[-0.115, 0.025, 0.098]} r={0.014} color="#EF4444" flat={false} />
    </group>
  );
}

function KalenderTenda({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const merah = [3, 9, 10, 16], hijau = [5, 12];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <group position={[0, 0.07, 0.02]} rotation={[-0.3, 0, 0]}>
        <Box pos={[0, 0, 0]} size={[0.2, 0.13, 0.008]} color="#FFFFFF" cast={false} />
        <Box pos={[0, 0.048, 0.005]} size={[0.2, 0.034, 0.004]} color="#E5566A" cast={false} />
        {Array.from({ length: 15 }, (_, n) => {
          const r = Math.floor(n / 5), c = n % 5;
          const col = merah.includes(n) ? '#F87171' : hijau.includes(n) ? '#34D399' : '#E2E8E6';
          return <Box key={n} pos={[-0.075 + c * 0.0375, 0.018 - r * 0.03, 0.005]} size={[0.03, 0.022, 0.003]} color={col} cast={false} />;
        })}
      </group>
      <Box pos={[0, 0.06, -0.04]} size={[0.2, 0.12, 0.006]} color="#CBD5D1" rot={[0.3, 0, 0]} cast={false} />
    </group>
  );
}

function PapanKlip({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.006, 0]} size={[0.2, 0.012, 0.27]} color="#8B5E34" cast={false} />
      <Box pos={[0, 0.0135, 0.01]} size={[0.17, 0.004, 0.23]} color="#FFFFFF" cast={false} />
      {[-0.05, -0.02, 0.01, 0.04, 0.07].map((z) => (
        <Box key={z} pos={[0, 0.0165, z]} size={[0.14, 0.002, 0.008]} color={z > 0.05 ? '#F87171' : '#CBD5D1'} cast={false} />
      ))}
      <Box pos={[0, 0.02, -0.12]} size={[0.08, 0.016, 0.03]} color={EMAS} cast={false} />
    </group>
  );
}

function BukuBesar({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.006, 0]} size={[0.4, 0.012, 0.28]} color="#14532D" cast={false} />
      {[-1, 1].map((sd) => (
        <Box key={sd} pos={[sd * 0.095, 0.017, 0]} size={[0.185, 0.012, 0.25]} color="#FFFFFF" rot={[0, 0, -sd * 0.04]} cast={false} />
      ))}
      {[-0.08, -0.04, 0, 0.04, 0.08].map((z) => (
        <React.Fragment key={z}>
          <Box pos={[-0.098, 0.0245, z]} size={[0.15, 0.002, 0.006]} color="#93C5FD" cast={false} />
          <Box pos={[0.098, 0.0245, z]} size={[0.15, 0.002, 0.006]} color="#93C5FD" cast={false} />
        </React.Fragment>
      ))}
      <Box pos={[0.0, 0.0245, 0.0]} size={[0.008, 0.002, 0.25]} color="#DC2626" cast={false} />
      <Box pos={[0.22, 0.008, 0.06]} size={[0.012, 0.012, 0.16]} color="#111827" rot={[0, 0.5, 0]} cast={false} />
    </group>
  );
}

function TusukNota({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.01, 0]} r={0.04} h={0.02} color="#2B3340" seg={14} cast={false} />
      <Tube pos={[0, 0.09, 0]} r={0.004} h={0.16} color="#CBD5E1" seg={6} cast={false} />
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} pos={[(i % 2) * 0.004, 0.03 + i * 0.012, 0]} size={[0.065, 0.005, 0.05]} color={i % 3 ? '#FFF7E0' : '#FFFFFF'} rot={[0, i * 0.5, 0]} cast={false} />
      ))}
    </group>
  );
}

function KalkulatorPita({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.02, 0]} size={[0.16, 0.04, 0.24]} color="#374151" cast={false} />
      <Box pos={[0, 0.043, -0.07]} size={[0.12, 0.004, 0.04]} color="#A7F3D0" cast={false} />
      {[0, 1, 2].flatMap((r) =>
        [0, 1, 2, 3].map((c) => (
          <Box key={`${r}${c}`} pos={[-0.05 + c * 0.033, 0.043, -0.01 + r * 0.04]} size={[0.026, 0.005, 0.03]} color={c === 3 ? EMAS : '#E5E7EB'} cast={false} />
        ))
      )}
      <Tube pos={[0, 0.075, -0.115]} r={0.035} h={0.085} color="#FFFFFF" rot={[0, 0, Math.PI / 2]} seg={14} cast={false} />
      <Box pos={[0, 0.06, -0.16]} size={[0.07, 0.002, 0.1]} color="#FFFFFF" rot={[-0.5, 0, 0]} cast={false} />
      <Box pos={[0, 0.03, 0.19]} size={[0.07, 0.002, 0.1]} color="#FFFFFF" rot={[0.25, 0, 0]} cast={false} />
    </group>
  );
}

function TabletAging({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const bars: [number, string][] = [[0.07, '#34D399'], [0.055, '#A3E635'], [0.04, '#FACC15'], [0.025, '#FB923C'], [0.012, '#F87171']];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.005, 0]} size={[0.17, 0.01, 0.11]} color="#475569" cast={false} />
      <group position={[0, 0.075, -0.01]} rotation={[-0.6, 0, 0]}>
        <Box pos={[0, 0, 0]} size={[0.2, 0.14, 0.01]} color="#1F2937" cast={false} />
        <Box pos={[0, 0, 0.0055]} size={[0.18, 0.12, 0.002]} color="#0B1A17" cast={false} />
        {bars.map(([h, c], i) => (
          <Box key={i} pos={[-0.06 + i * 0.03, -0.05 + h / 2, 0.008]} size={[0.02, h, 0.003]} color={c} cast={false} />
        ))}
      </group>
    </group>
  );
}

function CangkirPena({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.045, 0]} r={0.035} h={0.09} color="#2AA79B" seg={14} cast={false} />
      {[['#EF4444', -0.012, 0.2], ['#1D4ED8', 0.012, -0.15], ['#111827', 0, 0.05]].map(([c, x, t], i) => (
        <Box key={i} pos={[x as number, 0.115, 0]} size={[0.008, 0.1, 0.008]} color={c as string} rot={[0, 0, t as number]} cast={false} />
      ))}
    </group>
  );
}

function PostIt({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {['#FDE68A', '#FBCFE8', '#A7F3D0'].map((c, i) => (
        <Box key={c} pos={[i * 0.012, 0.002 + i * 0.004, i * 0.01]} size={[0.06, 0.004, 0.06]} color={c} rot={[0, i * 0.4 - 0.3, 0]} cast={false} />
      ))}
    </group>
  );
}

function ArDeskKit({ varian }: { varian: number }) {
  const Y = 0.82;
  return (
    <>
      <LampuMeja pos={[-0.74, Y, -0.3]} />
      <PostIt pos={[-0.44, Y, -0.3]} />
      {varian === 0 && (
        <>
          {/* Billing: baki surat bertingkat berisi faktur, stempel PAID, lembar yang sudah dicap */}
          <group position={[-0.6, Y, -0.04]}>
            <Box pos={[0, 0.008, 0]} size={[0.27, 0.016, 0.33]} color="#2AA79B" cast={false} />
            {[[-0.12, -0.15], [0.12, -0.15], [-0.12, 0.15], [0.12, 0.15]].map(([x, z]) => (
              <Box key={`${x}${z}`} pos={[x, 0.1, z]} size={[0.012, 0.18, 0.012]} color="#1F8F84" cast={false} />
            ))}
            <Box pos={[0, 0.1, 0]} size={[0.27, 0.012, 0.33]} color="#2AA79B" cast={false} />
            <TumpukKertas pos={[0, 0.016, 0]} n={4} />
            <TumpukKertas pos={[0, 0.112, 0]} n={3} rotY={0.1} header="#3B82F6" />
          </group>
          <Stempel pos={[0.46, Y, -0.2]} rotY={0.3} />
          <Box pos={[0.6, Y + 0.004, -0.02]} size={[0.2, 0.004, 0.27]} color="#FFFFFF" rot={[0, 0.2, 0]} cast={false} />
          <Teks pos={[0.6, Y + 0.0065, -0.02]} rot={[-Math.PI / 2, 0, 0.2]} w={0.17} h={0.07} text="PAID" fg="#DC2626" />
          <KalkulatorMeja pos={[0.68, Y, 0.22]} rotY={-0.15} />
          <CangkirPena pos={[0.74, Y, -0.3]} />
        </>
      )}
      {varian === 1 && (
        <>
          {/* Collection: telepon meja, headset, kalender jatuh tempo, papan klip catatan telepon */}
          <TeleponMeja pos={[-0.6, Y, -0.03]} rotY={0.1} />
          <HeadsetMeja pos={[0.62, Y, -0.27]} rotY={-0.4} />
          <KalenderTenda pos={[0.46, Y, -0.1]} rotY={-0.15} />
          <PapanKlip pos={[0.68, Y + 0.001, 0.03]} rotY={0.15} />
          <KalkulatorMeja pos={[0.7, Y, 0.24]} rotY={0.1} />
          <Mug pos={[-0.62, Y, 0.22]} color="#FDE68A" steam seed={0.7} />
        </>
      )}
      {varian === 2 && (
        <>
          {/* Reconcile: buku besar terbuka, tusuk nota, kalkulator pita, tablet umur piutang */}
          <BukuBesar pos={[-0.58, Y + 0.001, -0.06]} rotY={0.05} />
          <TabletAging pos={[-0.72, Y, 0.2]} rotY={0.5} />
          <TusukNota pos={[0.5, Y, -0.2]} />
          <KalkulatorPita pos={[0.66, Y, 0.1]} rotY={-0.1} />
          <CangkirPena pos={[0.74, Y, -0.3]} />
        </>
      )}
    </>
  );
}

// [DIUBAH] Meja Transactions & Accounts Receivable memakai MEJA PUTIH yang sama dengan Accounts Payable (lihat MejaPutih).
// Aksen (papan nama + garis alas keyboard) mengikuti warna halamannya; isi meja tetap khas halaman. Karena meja kini punya 2 monitor,
// isi meja Transactions digeser 0,16 ke depan supaya tidak menembus monitor (isi meja AR memang sudah menyesuaikan).
function Desk({ pos, page, seatKey, label, varian = 0 }: { pos: V3; page: PageKey; seatKey: string; label?: string; varian?: number }) {
  const seed = Math.floor(Math.abs(pos[0] * 7 + pos[2] * 13) * 100) + 3 + varian * 17;
  return (
    <MejaPutih pos={pos} label={label ?? PAGE_STYLE[page].label} aksen={PAGE_STYLE[page].color} seatKey={seatKey} seed={seed} kata={KATA_UMUM}>
      {page === 'ar' ? (
        <ArDeskKit varian={varian} />
      ) : (
        <group position={[0, 0, 0.16]}>
          <DeskKit page={page} />
        </group>
      )}
    </MejaPutih>
  );
}

// Kursi kantor menghadap -z (ke arah meja). rotY memutar kursi.
function Chair({ pos, rotY = 0, color = C.chair }: { pos: V3; rotY?: number; color?: string }) {
  const light = lighten(color, 0.07);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* kaki bintang + roda */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i * 2 * Math.PI) / 5;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Box pos={[0, 0.07, 0.13]} size={[0.045, 0.025, 0.27]} color="#2B3340" cast={false} />
            <Ball pos={[0, 0.035, 0.27]} r={0.035} color="#1A1F27" />
          </group>
        );
      })}
      <Tube pos={[0, 0.19, 0]} r={0.03} h={0.24} color="#4B5563" seg={10} cast={false} />
      {/* dudukan */}
      <Box pos={[0, 0.32, 0]} size={[0.56, 0.08, 0.54]} color={color} />
      <Box pos={[0, 0.368, 0]} size={[0.5, 0.03, 0.48]} color={light} cast={false} />
      {/* sandaran + sandaran kepala */}
      <Box pos={[0, 0.68, 0.25]} size={[0.54, 0.5, 0.07]} color={color} rot={[0.08, 0, 0]} />
      <Box pos={[0, 0.66, 0.21]} size={[0.46, 0.4, 0.03]} color={light} rot={[0.08, 0, 0]} cast={false} />
      <Box pos={[0, 1.0, 0.27]} size={[0.32, 0.13, 0.06]} color={color} rot={[0.08, 0, 0]} cast={false} />
      {/* sandaran tangan */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <Box pos={[sd * 0.3, 0.45, 0.1]} size={[0.035, 0.17, 0.035]} color="#2B3340" cast={false} />
          <Box pos={[sd * 0.3, 0.545, 0.06]} size={[0.07, 0.03, 0.3]} color="#2B3340" cast={false} />
        </group>
      ))}
    </group>
  );
}

const MEETING: [number, number] = [4.6, 1.8];

function Laptop({ pos, rotY, seatKey, seed }: { pos: V3; rotY: number; seatKey: string; seed: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.015, 0]} size={[0.36, 0.02, 0.25]} color="#B8C0C8" cast={false} />
      <Box pos={[0, 0.14, -0.12]} size={[0.36, 0.24, 0.015]} color="#2B3340" rot={[-0.25, 0, 0]} cast={false} />
      <Screen
        seatKey={seatKey}
        size={[0.32, 0.2]}
        pos={[0, 0.14, -0.108]}
        rot={[-0.25, 0, 0]}
        seed={seed}
        glow={{ floorPos: [0, 0.03, 0.18], floorSize: [0.9, 0.7], haloPos: [0, 0.16, -0.02], haloSize: [0.6, 0.45], haloRot: [-0.25, 0, 0] }}
      />
    </group>
  );
}

function MeetingTable() {
  const seats = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  return (
    <group position={[MEETING[0], 0, MEETING[1]]}>
      {/* [DIUBAH] meja rapat putih */}
      <Tube pos={[0, 0.78, 0]} r={1.3} h={0.06} color="#F8F9FB" seg={40} />
      <Tube pos={[0, 0.73, 0]} r={1.22} h={0.06} color="#E4E9EE" seg={40} cast={false} />
      <Tube pos={[0, 0.37, 0]} r={0.14} h={0.72} color="#DCE3E8" />
      <Tube pos={[0, 0.02, 0]} r={0.55} h={0.04} color="#2B3340" seg={28} />
      {seats.map((a) => (
        <React.Fragment key={a}>
          <Chair pos={[Math.sin(a) * 1.9, 0, Math.cos(a) * 1.9]} rotY={a} />
          <Laptop pos={[Math.sin(a) * 0.85, 0.81, Math.cos(a) * 0.85]} rotY={a} seatKey={meetKey(a)} seed={Math.round(a * 10) + 11} />
          <Box pos={[Math.sin(a + 0.5) * 0.6, 0.815, Math.cos(a + 0.5) * 0.6]} size={[0.2, 0.01, 0.28]} color="#FFFFFF" rot={[0, a + 0.3, 0]} cast={false} />
        </React.Fragment>
      ))}
      {/* vas bunga di tengah + gelas */}
      <Tube pos={[0, 0.9, 0]} r={0.07} rb={0.05} h={0.16} color="#9CC9D8" seg={14} cast={false} />
      <Cone pos={[0, 1.05, 0]} r={0.12} h={0.2} color="#58B879" seg={7} />
      <Ball pos={[0.06, 1.14, 0.02]} r={0.05} color="#F9A8D4" />
      <Ball pos={[-0.05, 1.12, -0.04]} r={0.045} color="#FDE68A" />
      <Tube pos={[-0.3, 0.84, 0]} r={0.09} h={0.03} color="#2B3340" seg={18} cast={false} />
      <Tube pos={[-0.3, 0.857, 0]} r={0.06} h={0.004} color="#4ADE80" seg={18} cast={false} />
    </group>
  );
}

// ---- Sofa & meja kopi -----------------------------------------------------------

function Sofa({ pos, rotY, color }: { pos: V3; rotY: number; color: string }) {
  const light = lighten(color, 0.06);
  const dark = lighten(color, -0.06);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {[
        [-0.95, -0.38],
        [0.95, -0.38],
        [-0.95, 0.38],
        [0.95, 0.38],
      ].map(([x, z], i) => (
        <Tube key={i} pos={[x, 0.05, z]} r={0.04} h={0.1} color="#3B2A1E" seg={8} cast={false} />
      ))}
      <Box pos={[0, 0.25, 0]} size={[2.1, 0.3, 0.9]} color={dark} />
      <Box pos={[-0.47, 0.46, -0.05]} size={[0.92, 0.16, 0.72]} color={light} />
      <Box pos={[0.47, 0.46, -0.05]} size={[0.92, 0.16, 0.72]} color={light} />
      <Box pos={[-0.47, 0.8, 0.32]} size={[0.92, 0.46, 0.2]} color={color} rot={[-0.12, 0, 0]} />
      <Box pos={[0.47, 0.8, 0.32]} size={[0.92, 0.46, 0.2]} color={color} rot={[-0.12, 0, 0]} />
      <Box pos={[-1.0, 0.5, 0]} size={[0.2, 0.55, 0.9]} color={color} />
      <Box pos={[1.0, 0.5, 0]} size={[0.2, 0.55, 0.9]} color={color} />
      <Box pos={[-0.7, 0.72, 0.08]} size={[0.3, 0.3, 0.1]} color={lighten(color, 0.25)} rot={[-0.3, 0.3, 0.15]} cast={false} />
      <Box pos={[0.72, 0.7, 0.1]} size={[0.28, 0.28, 0.1]} color="#FDE68A" rot={[-0.3, -0.25, -0.1]} cast={false} />
    </group>
  );
}

function CoffeeTable({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.4, 0]} size={[1.0, 0.06, 0.7]} color="#C99863" />
      <Box pos={[0, 0.24, 0]} size={[0.9, 0.04, 0.6]} color={C.woodDark} cast={false} />
      {[
        [-0.44, -0.29],
        [0.44, -0.29],
        [-0.44, 0.29],
        [0.44, 0.29],
      ].map(([x, z], i) => (
        <Box key={i} pos={[x, 0.2, z]} size={[0.05, 0.4, 0.05]} color={C.woodDark} />
      ))}
      <Box pos={[-0.2, 0.435, 0.05]} size={[0.3, 0.015, 0.22]} color="#E0713F" rot={[0, 0.3, 0]} cast={false} />
      <Box pos={[-0.2, 0.45, 0.05]} size={[0.26, 0.012, 0.18]} color="#FFFFFF" rot={[0, 0.3, 0]} cast={false} />
      <Mug pos={[0.25, 0.43, -0.1]} color="#A7F3D0" />
      <Succulent pos={[0.3, 0.43, 0.18]} scale={0.5} />
    </group>
  );
}

// ---- Tanaman ---------------------------------------------------------------------

function Pot({ r = 0.22, h = 0.4, color = C.pot }: { r?: number; h?: number; color?: string }) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 0.72, h, 20]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <Tube pos={[0, h, 0]} r={r * 1.08} h={0.04} color={lighten(color, 0.05)} seg={20} cast={false} />
      <Tube pos={[0, h + 0.01, 0]} r={r * 0.92} h={0.03} color="#4A3728" seg={20} cast={false} />
    </group>
  );
}

function Succulent({ pos = [0, 0, 0], scale = 1 }: { pos?: V3; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <Pot r={0.1} h={0.12} color="#E5E7EB" />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i * Math.PI) / 3;
        return <Cone key={i} pos={[Math.sin(a) * 0.05, 0.2, Math.cos(a) * 0.05]} r={0.035} h={0.14} color={i % 2 ? '#58B879' : '#3F9A5F'} rot={[Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]} />;
      })}
    </group>
  );
}

function PlantBush({ pos, scale = 1 }: { pos: V3; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <Pot />
      <Ball pos={[0, 0.72, 0]} r={0.36} color="#3F9A5F" />
      <Ball pos={[0.22, 0.62, 0.1]} r={0.26} color="#2F8A52" />
      <Ball pos={[-0.2, 0.66, -0.08]} r={0.27} color="#4DAA6B" />
      <Ball pos={[0.05, 1.0, 0.04]} r={0.24} color="#58B879" />
      <Ball pos={[-0.1, 0.9, 0.2]} r={0.17} color="#6BC789" />
    </group>
  );
}

function PlantSnake({ pos, scale = 1 }: { pos: V3; scale?: number }) {
  const hs = [0.7, 0.95, 0.6, 0.85, 0.75, 1.05, 0.65, 0.8];
  const cs = ['#2F7D4F', '#3F9A5F', '#246B43', '#4DAA6B'];
  return (
    <group position={pos} scale={scale}>
      <Pot r={0.24} h={0.36} color="#E5E7EB" />
      {hs.map((h, i) => (
        <group key={i} rotation={[0, (i * Math.PI) / 4, 0]}>
          <group position={[0.07 + (i % 2) * 0.05, 0.38, 0]} rotation={[0, 0, -0.1 - (i % 3) * 0.05]}>
            <Box pos={[0, h / 2, 0]} size={[0.09, h, 0.025]} color={cs[i % 4]} />
          </group>
        </group>
      ))}
    </group>
  );
}

function PlantPalm({ pos, scale = 1 }: { pos: V3; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <Pot r={0.26} h={0.42} color="#B9A98C" />
      <Tube pos={[0, 0.9, 0]} r={0.045} rb={0.06} h={0.95} color="#7A5A3A" seg={8} />
      <group position={[0, 1.38, 0]}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <group key={i} rotation={[0, (i * 2 * Math.PI) / 7, 0]}>
            <group rotation={[0, 0, -0.25 - (i % 2) * 0.2]}>
              <Box pos={[0.38, 0, 0]} size={[0.78, 0.02, 0.18]} color={i % 2 ? '#3F9A5F' : '#2F8A52'} />
              <Box pos={[0.82, -0.05, 0]} size={[0.2, 0.02, 0.1]} color="#58B879" cast={false} />
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

// ---- Rak buku --------------------------------------------------------------------

function Bookshelf({ pos }: { pos: V3 }) {
  const books = useMemo(() => {
    const r = mulberry32(7);
    const pal = ['#E0713F', '#4C5FA8', '#2F7D5B', '#E8C95A', '#B05A7A', '#3E4A66', '#C9453B', '#7BA05B', '#EDE6D6'];
    const out: { x: number; y: number; w: number; h: number; c: string; lean: number }[] = [];
    [0.06, 0.52, 0.98, 1.44].forEach((y0, si) => {
      let x = -0.7;
      const end = si === 1 ? 0.0 : 0.7;
      while (x < end - 0.08) {
        const w = 0.07 + r() * 0.07;
        const h = 0.24 + r() * 0.17;
        out.push({ x: x + w / 2, y: y0 + h / 2, w, h, c: pal[Math.floor(r() * pal.length)], lean: 0 });
        x += w + 0.004;
      }
      if (si !== 1) out[out.length - 1].lean = 0.28;
    });
    return out;
  }, []);

  return (
    <group position={pos}>
      {/* [DIUBAH] rangka putih modern (gaya rak putih di Account Payable): panel samping putih, panel belakang abu muda, alas abu, strip aksen biru di tiap papan */}
      <Box pos={[-0.77, 0.94, 0]} size={[0.06, 1.88, 0.4]} color="#F8F9FB" />
      <Box pos={[0.77, 0.94, 0]} size={[0.06, 1.88, 0.4]} color="#F8F9FB" />
      <Box pos={[0, 0.94, -0.18]} size={[1.6, 1.88, 0.03]} color="#DCE3E8" />
      <Box pos={[0, 0.02, 0.0]} size={[1.64, 0.04, 0.42]} color="#C5CDD6" cast={false} />
      {[0.04, 0.5, 0.96, 1.42, 1.86].map((y) => (
        <React.Fragment key={y}>
          <Box pos={[0, y, 0]} size={[1.6, 0.04, 0.4]} color="#FFFFFF" />
          {y > 0.05 && <Box pos={[0, y - 0.005, 0.2]} size={[1.6, 0.025, 0.006]} color="#4C8FBF" cast={false} />}
        </React.Fragment>
      ))}
      {/* buku */}
      {books.map((b, i) => (
        <Box key={i} pos={[b.x, b.y, 0.0]} size={[b.w, b.h, 0.26]} color={b.c} rot={[0, 0, b.lean ? -b.lean : 0]} cast={false} />
      ))}
      {/* dekorasi rak ke-2: globe + pigura */}
      <Tube pos={[0.25, 0.54, 0]} r={0.09} h={0.03} color="#2B3340" seg={12} cast={false} />
      <Ball pos={[0.25, 0.7, 0]} r={0.12} color="#4C8FB5" flat={false} />
      <Box pos={[0.58, 0.68, 0.02]} size={[0.22, 0.28, 0.03]} color="#E4E9EE" rot={[0, -0.2, 0]} cast={false} />
      <Box pos={[0.58, 0.68, 0.04]} size={[0.17, 0.22, 0.01]} color="#A7F3D0" rot={[0, -0.2, 0]} cast={false} />
      {/* tanaman kecil di atas rak */}
      <Succulent pos={[-0.4, 1.88, 0]} scale={0.8} />
      <Box pos={[0.3, 1.95, 0]} size={[0.3, 0.12, 0.25]} color="#3E4A66" cast={false} />
      <Box pos={[0.3, 2.06, 0]} size={[0.26, 0.1, 0.22]} color="#E0713F" cast={false} />
    </group>
  );
}

// ---- Detail dinding & suasana -----------------------------------------------------------

// TV dinding: dashboard keuangan yang bergerak pelan (digambar ulang ~4x per detik).
function WallTV({ pos, rotY }: { pos: V3; rotY: number }) {
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);
  const acc = useRef(1);

  const draw = (t: number) => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0E1B17';
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#E5E7EB';
    g.font = '700 15px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('Ringkasan Keuangan', 14, 18);
    const kpi = [
      ['Kas', 'Rp 1,2 M', '#6EE7B7'],
      ['Laba', '+8%', '#FDE68A'],
      ['Piutang', '3 faktur', '#93C5FD'],
    ];
    kpi.forEach(([k, v, c], i) => {
      const x = 14 + i * 100;
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x, 36, 92, 36);
      g.fillStyle = '#9CA3AF';
      g.font = '11px Inter, system-ui, sans-serif';
      g.fillText(k, x + 8, 47);
      g.fillStyle = c;
      g.font = '700 14px Inter, system-ui, sans-serif';
      g.fillText(v, x + 8, 62);
    });
    const base = [0.5, 0.7, 0.55, 0.8, 0.65, 0.9];
    base.forEach((b, i) => {
      const h = (b + Math.sin(t * 0.8 + i * 1.3) * 0.08) * 80;
      g.fillStyle = i % 2 ? '#34D399' : '#10B981';
      g.fillRect(16 + i * 24, 168 - h, 16, h);
    });
    g.strokeStyle = '#FDE68A';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const x = 176 + i * 12;
      const y = 140 - Math.sin(i * 0.6 + t * 0.7) * 14 - i * 2.5;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    tex.needsUpdate = true;
  };

  useEffect(() => draw(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((state, dt) => {
    acc.current += dt;
    if (acc.current > 0.25) {
      acc.current = 0;
      draw(state.clock.elapsedTime);
    }
  });

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[1.7, 1.0, 0.06]} color="#1F2630" cast={false} />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[1.6, 0.9]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function WallAC({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0.06]} size={[1.3, 0.34, 0.22]} color="#F3F6F4" cast={false} />
      {[-0.06, 0, 0.06].map((y) => (
        <Box key={y} pos={[0, y - 0.04, 0.175]} size={[1.1, 0.012, 0.01]} color="#CBD5D1" cast={false} />
      ))}
      <mesh position={[0.52, 0.1, 0.175]}>
        <boxGeometry args={[0.03, 0.03, 0.01]} />
        <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function Extinguisher({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0, 0]} r={0.06} h={0.34} color="#C9453B" seg={12} />
      <Tube pos={[0, 0.2, 0]} r={0.025} h={0.06} color="#2B3340" seg={8} cast={false} />
      <Box pos={[0.04, 0.24, 0]} size={[0.07, 0.02, 0.02]} color="#2B3340" cast={false} />
    </group>
  );
}

// Bercak sinar matahari dari jendela di lantai.
function SunPatch({ pos, size, rotY, opacity = 0.22 }: { pos: V3; size: [number, number]; rotY: number; opacity?: number }) {
  const gtex = useMemo(() => glowTex(), []);
  return (
    <mesh position={pos} rotation={[-Math.PI / 2, 0, rotY]} renderOrder={2}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={gtex} color="#FFF0B8" transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// Uap tipis yang naik dari kopi/ketel (pelan, melengkung, memudar di atas).
function Steam({
  pos,
  rise = 0.38,
  size = 0.045,
  peak = 0.3,
  count = 3,
  speed = 0.35,
  seed = 0,
}: {
  pos: V3;
  rise?: number;
  size?: number;
  peak?: number;
  count?: number;
  speed?: number;
  seed?: number;
}) {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    g.current?.children.forEach((c, i) => {
      const m = c as THREE.Mesh;
      const ph = (state.clock.elapsedTime * speed + i / count + seed) % 1;
      m.position.y = ph * rise;
      m.position.x = Math.sin(ph * 6 + i * 2 + seed * 7) * size * (0.4 + ph);
      m.position.z = Math.cos(ph * 5 + i * 3 + seed * 5) * size * 0.5 * ph;
      m.scale.setScalar(0.55 + ph * 1.0);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, ph * 6) * (1 - ph) * peak;
    });
  });
  return (
    <group ref={g} position={pos}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[size, 8, 8]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function CoatRack({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.02, 0]} r={0.22} h={0.04} color="#2B3340" seg={16} cast={false} />
      <Tube pos={[0, 0.9, 0]} r={0.025} h={1.8} color="#6B4A2B" seg={8} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} pos={[Math.sin((i * Math.PI) / 2) * 0.1, 1.7, Math.cos((i * Math.PI) / 2) * 0.1]} size={[0.04, 0.04, 0.16]} color="#6B4A2B" rot={[0, (i * Math.PI) / 2, 0]} cast={false} />
      ))}
      <Box pos={[0.14, 1.35, 0]} size={[0.1, 0.55, 0.3]} color="#3E4A66" />
      <Box pos={[-0.12, 1.5, 0.04]} size={[0.08, 0.35, 0.24]} color="#B05A7A" />
    </group>
  );
}

// ---- Perabot pendukung ---------------------------------------------------------------

function CoffeeStation({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* [DIUBAH] kabinet putih: badan putih-abu, alas hijau-abu, 4 pintu berpanel dengan gagang kuning, daun meja kayu */}
      <Box pos={[0, 0.045, 0]} size={[1.5, 0.09, 0.55]} color="#7FA9A4" />
      <Box pos={[0, 0.465, 0]} size={[1.5, 0.75, 0.55]} color="#E8EDF1" />
      <Box pos={[0, 0.875, 0]} size={[1.56, 0.05, 0.6]} color="#C99863" />
      {[-0.56, -0.19, 0.19, 0.56].map((x, i) => (
        <React.Fragment key={x}>
          <Box pos={[x, 0.465, 0.278]} size={[0.34, 0.66, 0.02]} color="#F8F9FB" cast={false} />
          <Box pos={[x + (i % 2 === 0 ? 0.12 : -0.12), 0.6, 0.298]} size={[0.035, 0.14, 0.025]} color="#E8B93A" cast={false} />
        </React.Fragment>
      ))}
      {/* mesin kopi */}
      <Box pos={[-0.4, 1.09, -0.08]} size={[0.34, 0.38, 0.3]} color="#2B3340" />
      <Box pos={[-0.4, 1.3, -0.08]} size={[0.36, 0.06, 0.32]} color="#1F2630" cast={false} />
      <Box pos={[-0.4, 1.0, 0.08]} size={[0.06, 0.12, 0.06]} color="#9CA3AF" cast={false} />
      <mesh position={[-0.3, 1.18, 0.075]}>
        <boxGeometry args={[0.04, 0.04, 0.01]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
      <Tube pos={[-0.4, 0.95, 0.12]} r={0.06} h={0.1} color="#9CC9D8" seg={12} cast={false} />
      {/* ketel, gelas, toples */}
      <Tube pos={[0.1, 0.99, -0.1]} r={0.1} rb={0.13} h={0.22} color="#CBD5D1" seg={16} />
      <Box pos={[0.1, 1.12, -0.1]} size={[0.03, 0.04, 0.03]} color="#2B3340" cast={false} />
      <Mug pos={[0.4, 0.9, 0.05]} color="#E0713F" />
      <Steam pos={[0.4, 1.02, 0.05]} />
      <Steam pos={[-0.4, 1.1, 0.08]} />
      <Mug pos={[0.52, 0.9, 0.12]} color="#4C5FA8" />
      <Tube pos={[0.55, 1.0, -0.15]} r={0.08} h={0.2} color="#E8D9B0" seg={14} cast={false} />
    </group>
  );
}

function WaterCooler({ pos, rotY }: { pos: V3; rotY: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.45, 0]} size={[0.38, 0.9, 0.38]} color="#E5E7EB" />
      <Box pos={[0, 0.62, 0.2]} size={[0.2, 0.1, 0.02]} color="#9CA3AF" cast={false} />
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.4, 18]} />
        <meshLambertMaterial color="#7CC4E8" transparent opacity={0.75} />
      </mesh>
      <Tube pos={[0, 1.38, 0]} r={0.06} h={0.06} color="#7CC4E8" seg={12} cast={false} />
      <Box pos={[-0.06, 0.72, 0.2]} size={[0.04, 0.04, 0.03]} color="#38BDF8" cast={false} />
      <Box pos={[0.06, 0.72, 0.2]} size={[0.04, 0.04, 0.03]} color="#EF4444" cast={false} />
    </group>
  );
}

function PrinterStation({ pos, rotY }: { pos: V3; rotY: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.35, 0]} size={[1.1, 0.7, 0.55]} color="#B8C4BE" />
      <Box pos={[0, 0.35, 0.28]} size={[1.0, 0.02, 0.01]} color="#8FA39A" cast={false} />
      <Box pos={[0, 0.72, 0]} size={[1.14, 0.04, 0.58]} color="#E5E7EB" />
      <Box pos={[-0.15, 0.86, 0]} size={[0.62, 0.24, 0.45]} color="#F3F4F6" />
      <Box pos={[-0.15, 0.99, 0.0]} size={[0.5, 0.03, 0.34]} color="#CBD5D1" cast={false} />
      <Box pos={[-0.15, 0.8, 0.24]} size={[0.4, 0.015, 0.14]} color="#FFFFFF" cast={false} />
      <mesh position={[0.1, 0.9, 0.23]}>
        <boxGeometry args={[0.05, 0.03, 0.01]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
      <Box pos={[0.38, 0.8, 0.05]} size={[0.2, 0.1, 0.28]} color="#4C5FA8" cast={false} />
    </group>
  );
}

function FloorLamp({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.015, 0]} r={0.16} h={0.03} color="#2B3340" seg={16} cast={false} />
      <Tube pos={[0, 0.75, 0]} r={0.02} h={1.5} color="#2B3340" seg={8} cast={false} />
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 0.3, 16, 1, true]} />
        <meshStandardMaterial color="#FDE9B8" emissive="#FDE9B8" emissiveIntensity={0.8} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function TrashBin({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.17, 0]} r={0.15} rb={0.12} h={0.34} color="#4B5563" seg={14} />
      <Tube pos={[0, 0.345, 0]} r={0.16} h={0.025} color="#374151" seg={14} cast={false} />
    </group>
  );
}

// [BARU] Dekor dinding timur Transactions (sisi tembok biru, bekas tanaman): papan nama TRANSACTIONS gaya papan AR, rak buku, papan laporan,
// troli dokumen, lemari arsip 3 buah (+ tumpukan nota & stempel), papan gabus, rak surat, dan lampu dinding.
// Grup diputar -90 derajat: x lokal = z dunia, z lokal = menjauh dari dinding (ke arah ruangan).
function LemariArsip({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0.23]}>
      <Box pos={[0, 0.36, 0]} size={[0.5, 0.72, 0.4]} color="#D9DEE5" />
      <Box pos={[0, 0.74, 0]} size={[0.54, 0.04, 0.44]} color="#8FA0B5" cast={false} />
      {[0.14, 0.38, 0.6].map((y, i) => (
        <React.Fragment key={i}>
          <Box pos={[0, y, 0.205]} size={[0.44, 0.2, 0.012]} color="#C3CAD3" cast={false} />
          <Box pos={[0, y + 0.03, 0.218]} size={[0.18, 0.025, 0.016]} color="#6B7280" cast={false} />
          <Box pos={[0, y - 0.05, 0.215]} size={[0.14, 0.05, 0.006]} color={['#60A5FA', '#F5C84C', '#2DD4BF'][i]} cast={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

function RakSurat({ pos }: { pos: V3 }) {
  const warna = ['#FFFFFF', '#FDE68A', '#BFDBFE', '#A7F3D0', '#FBCFE8', '#FFFFFF'];
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.0, 0.64, 0.14]} color="#2F3B4E" cast={false} />
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((k) => (
          <React.Fragment key={`${r}${k}`}>
            <Box pos={[-0.32 + k * 0.32, 0.2 - r * 0.2, 0.03]} size={[0.28, 0.17, 0.1]} color="#E5E9EF" cast={false} />
            <Box pos={[-0.32 + k * 0.32, 0.2 - r * 0.2 - 0.01, 0.075]} size={[0.22, 0.12, 0.02]} color={warna[(r * 3 + k) % warna.length]} cast={false} />
          </React.Fragment>
        ))
      )}
      <Box pos={[0, 0.355, 0.03]} size={[1.04, 0.04, 0.18]} color={EMAS} cast={false} />
    </group>
  );
}

function TroliDokumen({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {[[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]].map(([x, z], i) => (
        <React.Fragment key={i}>
          <Tube pos={[x, 0.3, z]} r={0.02} h={0.52} color="#8A97A6" seg={8} cast={false} />
          <Ball pos={[x, 0.04, z]} r={0.04} color="#2B2F3A" />
        </React.Fragment>
      ))}
      <Box pos={[0, 0.56, 0]} size={[0.92, 0.04, 0.5]} color="#CBD2DA" />
      <Box pos={[0, 0.2, 0]} size={[0.92, 0.04, 0.5]} color="#CBD2DA" />
      {/* map & tumpukan nota di tiap rak */}
      <Box pos={[-0.2, 0.62, 0]} size={[0.34, 0.09, 0.26]} color="#FAFAF7" cast={false} />
      <Box pos={[-0.2, 0.675, 0]} size={[0.34, 0.015, 0.26]} color="#2563EB" cast={false} />
      <Box pos={[0.2, 0.63, 0.02]} size={[0.3, 0.11, 0.24]} color="#F5C84C" cast={false} />
      <Box pos={[-0.12, 0.27, 0]} size={[0.5, 0.11, 0.3]} color="#E7ECF2" cast={false} />
      <Box pos={[0.28, 0.26, 0]} size={[0.26, 0.09, 0.26]} color="#2DD4BF" cast={false} />
    </group>
  );
}

function DekorTransaksi() {
  const xw = ATAS_W / 2 - 0.33; // permukaan dalam dinding timur lapisan biru (koordinat lokal Transactions)
  return (
    <group position={[xw, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      {/* rak buku (buku besar & peraturan) di sudut belakang */}
      <Bookshelf pos={[-3.9, 0, 0.22]} />
      {/* papan laporan arus transaksi + troli dokumen di bawahnya */}
      <PapanLaporan pos={[-1.8, 1.08, 0.03]} judul="ARUS TRANSAKSI" />
      <TroliDokumen pos={[-1.8, 0, 0.4]} />
      {/* papan nama TRANSACTIONS (sama gayanya dengan papan ACCOUNT RECEIVABLE) + 5 label halaman */}
      <group position={[0.7, 0, 0.02]}>
        <Box pos={[0, 1.2, -0.005]} size={[1.78, 0.4, 0.03]} color={EMAS} cast={false} />
        <Box pos={[0, 1.2, 0]} size={[1.7, 0.34, 0.04]} color="#F8F9FB" cast={false} />
        <Teks pos={[0, 1.2, 0.03]} w={1.62} h={0.26} text="TRANSACTIONS" fg="#FFFFFF" bg="#1E4FA3" />
        {['#2563EB', '#F5C84C', '#2DD4BF', '#A78BFA', '#FB7185'].map((c, i) => (
          <Box key={c} pos={[-0.64 + i * 0.32, 0.93, 0.02]} size={[0.26, 0.09, 0.02]} color={c} cast={false} />
        ))}
      </group>
      <LampuDinding pos={[-0.6, 1.2, 0.02]} />
      {/* papan gabus pengumuman + lemari arsip (3) dengan nota, stempel, dan kalkulator */}
      <PapanGabus pos={[2.9, 1.2, 0.05]} />
      <LemariArsip x={2.25} />
      <LemariArsip x={2.85} />
      <LemariArsip x={3.45} />
      <TumpukKertas pos={[2.25, 0.76, 0.23]} n={6} header="#2563EB" />
      <Stempel pos={[2.85, 0.76, 0.23]} />
      <KalkulatorMeja pos={[3.45, 0.76, 0.23]} />
      {/* rak surat di dekat pintu */}
      <RakSurat pos={[4.75, 1.05, 0.08]} />
    </group>
  );
}

// ---- [BARU] LANTAI & DINDING TRANSACTIONS: tema "buku besar" (hijau botol + kuningan + krem), hangat-klasik tapi modern -----------------
// Lantai: porselen krem berurat marmer, karpet modular per meja (tepi berwarna sesuai halaman meja), 
// inlay keliling, ambang pintu + keset, cincin kuningan di sekeliling karpet meja rapat, kotak colokan lantai, penanda alat pemadam.
// Dinding (belakang, barat, timur): plint hijau tua, dado panel bingkai kuningan, rel krem, kertas dinding hijau bergaris ala kertas buku besar
// (kolom, angka, koin kecil), list krem + garis kuningan. Dado dibuat rendah (0,5) supaya jendela, papan, dan TV yang sudah ada tidak tertutup.
const TRXC = { hijau: '#2E5B4C', hijau2: '#3A6D5A', hijauTua: '#22443A', kuningan: '#D9B24C', krem: '#F1ECDD' };

function KertasDindingTrx({ pos, w, h = 0.97 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 248, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#D9E6D7');
    gr.addColorStop(1, '#CEDDCE');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    const RH = H / 16;
    // garis baris (seperti kertas kolom akuntansi)
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(78,128,102,0.20)';
    for (let r = 1; r < 16; r++) { g.beginPath(); g.moveTo(0, r * RH); g.lineTo(W, r * RH); g.stroke(); }
    // garis kolom
    g.strokeStyle = 'rgba(78,128,102,0.38)';
    g.lineWidth = 1.5;
    for (let c = 0; c < 4; c++) { g.beginPath(); g.moveTo(c * 64 + 1, 0); g.lineTo(c * 64 + 1, H); g.stroke(); }
    // garis margin ganda merah muda
    g.strokeStyle = 'rgba(196,92,104,0.45)';
    g.lineWidth = 1;
    for (const x of [124.5, 131.5]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    // angka samar + koin kecil
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const rnd = mulberry32(77);
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 4; c++) {
        const v = rnd();
        if (v < 0.2) {
          const n = Math.floor(rnd() * 900000 + 10000);
          g.fillStyle = 'rgba(52,96,74,0.5)';
          g.fillText(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), c * 64 + 60, (r + 0.5) * RH);
        } else if (v > 0.94) {
          g.fillStyle = '#E3BC55';
          g.strokeStyle = '#B8923A';
          g.lineWidth = 1;
          g.beginPath();
          g.arc(c * 64 + 1, r * RH, 3.2, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
    }
  }, 'trx-kertas-buku-besar');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias satu dinding. s = z permukaan dinding (menghadap +z lokal); segs = rentang x lokal.
function DindingDekorTrx({ s, segs }: { s: number; segs: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const n = Math.max(1, Math.round(L / 0.9));
        const mw = L / n;
        return (
          <React.Fragment key={`d${a}`}>
            {/* plint hijau tua + garis kuningan */}
            <Box pos={[cx, 0.07, s + 0.025]} size={[L, 0.14, 0.05]} color={TRXC.hijauTua} cast={false} />
            <Box pos={[cx, 0.147, s + 0.027]} size={[L, 0.012, 0.054]} color={TRXC.kuningan} cast={false} />
            {/* dado: papan dasar + panel bingkai kuningan per modul */}
            <Box pos={[cx, 0.32, s + 0.01]} size={[L, 0.36, 0.02]} color={TRXC.hijau} cast={false} />
            {Array.from({ length: n }, (_, i) => {
              const x = a + (i + 0.5) * mw;
              return (
                <React.Fragment key={i}>
                  <Box pos={[x, 0.32, s + 0.024]} size={[mw - 0.1, 0.3, 0.016]} color={TRXC.kuningan} cast={false} />
                  <Box pos={[x, 0.32, s + 0.034]} size={[mw - 0.14, 0.26, 0.012]} color={TRXC.hijau2} cast={false} />
                </React.Fragment>
              );
            })}
            {/* rel dado krem + garis kuningan di bawahnya */}
            <Box pos={[cx, 0.525, s + 0.03]} size={[L, 0.045, 0.06]} color={TRXC.krem} cast={false} />
            <Box pos={[cx, 0.497, s + 0.031]} size={[L, 0.012, 0.062]} color={TRXC.kuningan} cast={false} />
            {/* kertas dinding buku besar */}
            <KertasDindingTrx pos={[cx, 1.035, s + 0.002]} w={L} />
            {/* list atas krem + garis kuningan */}
            <Box pos={[cx, 1.545, s + 0.035]} size={[L, 0.05, 0.07]} color={TRXC.krem} cast={false} />
            <Box pos={[cx, 1.515, s + 0.03]} size={[L, 0.012, 0.05]} color={TRXC.kuningan} cast={false} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Karpet modular satu meja (2,5 x 2,0): ubin 0,5 dua nada, binding, dan garis tepi berwarna halaman meja.
function KarpetMejaTrx({ pos, aksen }: { pos: V3; aksen: string }) {
  const dasar = useKanvasMg(256, 256, (g, W, H) => {
    const r = mulberry32(31);
    const nada = ['#AAB9CB', '#A2B1C4'];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        g.fillStyle = nada[(i + j) % 2];
        g.fillRect(i * 128, j * 128, 128, 128);
        for (let k = 0; k < 70; k++) {
          g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(70,90,120,0.10)';
          g.fillRect(i * 128 + r() * 124, j * 128 + r() * 124, 2, 1);
        }
      }
    }
    g.fillStyle = 'rgba(80,98,125,0.55)';
    for (const p of [0, 128]) { g.fillRect(p, 0, 1.5, H); g.fillRect(0, p, W, 1.5); }
    g.fillRect(W - 1.5, 0, 1.5, H);
    g.fillRect(0, H - 1.5, W, 1.5);
  }, 'trx-karpet-modular');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.5, 2.0);
    t.needsUpdate = true;
    return t;
  }, [dasar]);
  return (
    <group position={pos}>
      <Box pos={[0, 0.007, 0]} size={[2.56, 0.008, 2.06]} color="#6F8199" cast={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0125, 0]} receiveShadow>
        <planeGeometry args={[2.5, 2.0]} />
        <meshLambertMaterial map={tex} />
      </mesh>
      <Box pos={[0, 0.0145, -0.9]} size={[2.3, 0.004, 0.03]} color={aksen} cast={false} />
      <Box pos={[0, 0.0145, 0.9]} size={[2.3, 0.004, 0.03]} color={aksen} cast={false} />
      <Box pos={[-1.15, 0.0145, 0]} size={[0.03, 0.004, 1.8]} color={aksen} cast={false} />
      <Box pos={[1.15, 0.0145, 0]} size={[0.03, 0.004, 1.8]} color={aksen} cast={false} />
    </group>
  );
}

function KotakColokanLantai({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.0195, 0]} size={[0.18, 0.012, 0.12]} color="#C9D1D9" cast={false} />
      <Box pos={[0, 0.0262, 0]} size={[0.14, 0.004, 0.08]} color="#A9B3BD" cast={false} />
      <Box pos={[-0.03, 0.0288, 0]} size={[0.025, 0.002, 0.025]} color="#3A4150" cast={false} />
      <Box pos={[0.03, 0.0288, 0]} size={[0.025, 0.002, 0.025]} color="#3A4150" cast={false} />
    </group>
  );
}

function LantaiDekorTrx() {
  const ix0 = -8.54, ix1 = 8.31, iz0 = -5.14, iz1 = 5.14;
  const iw = ix1 - ix0, ih = iz1 - iz0;
  const icx = (ix0 + ix1) / 2, icz = (iz0 + iz1) / 2;
  const lantaiDepan = runs(ix0, ix1, [0], 2.4); // inlay depan terputus di celah pintu
  return (
    <group>
      {/* inlay keliling: pita hijau + garis kuningan di dalamnya + penanda sudut */}
      <Box pos={[icx, 0.007, iz0]} size={[iw + 0.1, 0.008, 0.1]} color={TRXC.hijau} cast={false} />
      <Box pos={[ix0, 0.007, icz]} size={[0.1, 0.008, ih]} color={TRXC.hijau} cast={false} />
      <Box pos={[ix1, 0.007, icz]} size={[0.1, 0.008, ih]} color={TRXC.hijau} cast={false} />
      {lantaiDepan.map(([m, l]) => (
        <Box key={`h${m}`} pos={[m, 0.007, iz1]} size={[l, 0.008, 0.1]} color={TRXC.hijau} cast={false} />
      ))}
      <Box pos={[icx, 0.0075, iz0 + 0.13]} size={[iw - 0.26, 0.008, 0.022]} color={TRXC.kuningan} cast={false} />
      <Box pos={[ix0 + 0.13, 0.0075, icz]} size={[0.022, 0.008, ih - 0.26]} color={TRXC.kuningan} cast={false} />
      <Box pos={[ix1 - 0.13, 0.0075, icz]} size={[0.022, 0.008, ih - 0.26]} color={TRXC.kuningan} cast={false} />
      {lantaiDepan.map(([m, l]) => (
        <Box key={`k${m}`} pos={[m, 0.0075, iz1 - 0.13]} size={[l, 0.008, 0.022]} color={TRXC.kuningan} cast={false} />
      ))}
      {[[ix0, iz0], [ix1, iz0], [ix0, iz1], [ix1, iz1]].map(([x, z], i) => (
        <Box key={i} pos={[x, 0.0078, z]} size={[0.2, 0.008, 0.2]} rot={[0, Math.PI / 4, 0]} color={TRXC.kuningan} cast={false} />
      ))}

      {/* karpet modular di bawah tiap meja; tepinya berwarna sesuai halaman meja */}
      {DESKS.map(({ p: [x, z], page }) => (
        <React.Fragment key={`${x}-${z}`}>
          <KarpetMejaTrx pos={[x, 0, z + 0.45]} aksen={PAGE_STYLE[page].color} />
          <KotakColokanLantai pos={[x + 1.02, 0, z + 0.3]} />
        </React.Fragment>
      ))}

      {/* ambang pintu aluminium + keset bertulisan */}
      <Box pos={[0, 0.012, 5.52]} size={[1.9, 0.024, 0.14]} color="#B8C0C9" cast={false} />
      <Box pos={[0, 0.026, 5.52]} size={[1.9, 0.004, 0.03]} color="#E3E8ED" cast={false} />
      <group position={[0, 0, 4.85]}>
        <Box pos={[0, 0.008, 0]} size={[1.7, 0.012, 0.8]} color="#233A5E" cast={false} />
        <Box pos={[0, 0.0145, 0.36]} size={[1.64, 0.003, 0.02]} color={TRXC.kuningan} cast={false} />
        <Box pos={[0, 0.0145, -0.36]} size={[1.64, 0.003, 0.02]} color={TRXC.kuningan} cast={false} />
        <Teks pos={[0, 0.0165, 0]} rot={[-Math.PI / 2, 0, 0]} w={1.35} h={0.2} text="TRANSACTIONS" fg={TRXC.kuningan} bg="#233A5E" />
      </group>

      {/* cincin kuningan + hijau di sekeliling karpet meja rapat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[MEETING[0], 0.0125, MEETING[1]]}>
        <ringGeometry args={[2.5, 2.57, 72]} />
        <meshLambertMaterial color={TRXC.kuningan} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[MEETING[0], 0.0115, MEETING[1]]}>
        <ringGeometry args={[2.62, 2.76, 72]} />
        <meshLambertMaterial color={TRXC.hijau} />
      </mesh>

      {/* penanda lantai alat pemadam (di bawah APAR dekat sudut timur laut) */}
      <Box pos={[8.35, 0.013, -5.1]} size={[0.6, 0.004, 0.6]} color="#C94A4A" cast={false} />
      <Box pos={[8.35, 0.0155, -5.1]} size={[0.5, 0.004, 0.5]} color={TRXC.krem} cast={false} />
    </group>
  );
}

const DESKS: { p: [number, number]; page: PageKey }[] = [
  { p: [-5, -3.6], page: 'sales' },
  { p: [-1.5, -3.6], page: 'purchase' },
  { p: [2, -3.6], page: 'journal' },
  { p: [-5, -0.2], page: 'bank' },
  { p: [-1.5, -0.2], page: 'other' },
];
const NEO_DESK: [number, number] = [-1.5, -3.6];

function Furniture() {
  return (
    <group>
      {DESKS.map(({ p: [x, z], page }, i) => (
        <React.Fragment key={`${x}-${z}`}>
          <Desk pos={[x, 0, z]} page={page} seatKey={deskKey([x, z])} />
          <Chair pos={[x, 0, z + 0.85]} rotY={i === 4 ? 0.25 : i === 3 ? -0.2 : 0} />
        </React.Fragment>
      ))}
      <MeetingTable />
      <Sofa pos={[-7.2 + TRX_DX, 0, 3]} rotY={-Math.PI / 2} color={C.sofaBlue} />
      <Sofa pos={[-6.85 + TRX_DX, 0, 5.0]} rotY={0} color={C.sofaOrange} />
      <CoffeeTable pos={[-5.0, 0, 3.1]} />
      <Bookshelf pos={[6.2, 0, -5.28]} />
      <CoffeeStation pos={[4.3, 0, -5.15]} />
      <PrinterStation pos={[-7.5 + TRX_DX, 0, -2.7]} rotY={Math.PI / 2} />
      <WaterCooler pos={[-7.6 + TRX_DX, 0, -0.5]} rotY={Math.PI / 2} />
      <FloorLamp pos={[-4.6, 0, 4.9]} />
      <CoatRack pos={[7.5 - TRX_DX, 0, 4.2]} />
      <TrashBin pos={[-3.3, 0, -3.1]} />
      <TrashBin pos={[0.1, 0, -3.2]} />
      <PlantPalm pos={[-7.35 + TRX_DX, 0, -5.0]} scale={1.1} />
      <PlantBush pos={[2.0, 0, 4.8]} scale={0.9} />
      <PlantSnake pos={[-3.2, 0, -5.0]} scale={0.8} />
      <DekorTransaksi />
    </group>
  );
}


// ---- [BARU] GEDUNG KANTOR: satu bangunan, banyak ruangan (satu lantai) -----------------------------------------------------
// Denah (x ke kanan, z ke arah kamera). Dinding luar belakang & kiri tinggi + berjendela; dinding luar depan & kanan rendah
// (supaya isi gedung terlihat dari kamera). Dinding pemisah antar ruangan = tembok setengah + kaca (partisi kantor) dengan
// pintu berkusen ke lorong. Semua ruangan satu lantai (tanpa tangga).
//
//   z -5.6 ┌──────────────┬─────────────────────────┬──────────────┐
//          │ ACCOUNT      │   TRANSACTIONS (Kantor) │ ACCOUNT      │
//          │ RECEIVABLE   │   16 x 11               │ PAYABLE      │
//   z  5.6 ├──────┬───────┴─────────────────────────┴──────┬───────┤
//          │            LORONG (pintu utama di kanan)       │       │
//   z  8.8 ├────────┬────────────┬────────────┬─────────────┤
//          │PERPUS  │  SANTAI    │  ASSET     │  STUDIO     │
//   z 17.0 └────────┴────────────┴────────────┴─────────────┘
//          x -22.3  -11.1        -0.9         9.3           22.3   (AP & bagian timur diperlebar 4 unit: AP 14 x 11 = AR)
// [DIUBAH] Baris tengah kini: PERPUS | lorong samping A | SANTAI | ASSET | lorong samping B | STUDIO (lihat TAMBAH_TIMUR, LS_A_*, LS_B_*);
// kedua lorong samping (lebar = LORONG_LEBAR) tembus dari lorong 1 ke lorong 2, dan gedung melebar ke timur (X_TIMUR).
type Theme = { floor: string; wall: string; trim: string; base: string };
type Gaya = 'tinggi' | 'kaca' | 'rendah';

const TH: Record<'studio' | 'santai' | 'perpus' | 'lorong' | 'ar' | 'ap' | 'aset' | 'plan' | 'mgmt' | 'trx', Theme> = {
  studio: { floor: '#F1EBDD', wall: '#BCD8EA', trim: '#F4F9FC', base: '#A9B7C0' },
  santai: { floor: '#EBD3AE', wall: '#F5D9C6', trim: '#FFF3E8', base: '#C9A57A' },
  perpus: { floor: '#E4D1B3', wall: '#4F45B5', trim: '#F6F2FC', base: '#BBA98B' },
  lorong: { floor: '#E6E1D3', wall: '#D5DCDD', trim: '#F4F7F6', base: '#A9B7B2' },
  ar: { floor: '#CFE3DE', wall: '#9ED8D0', trim: '#F2FBFA', base: '#6FB0A8' },
  ap: { floor: '#F9E6E1', wall: '#EFA9A0', trim: '#FFF1EE', base: '#C77F78' },
  trx: { floor: '#E8E2D0', wall: '#B9CFEA', trim: '#F4F8FD', base: '#8FA7C7' }, // [BARU] sisi Transactions dari partisi Transactions | AP: biru langit lembut (sisi AP tetap pink)
  aset: { floor: '#F3E9D6', wall: '#D9B88F', trim: '#FFF6E4', base: '#A98258' },
  plan: { floor: '#ECE9FA', wall: '#4F45B5', trim: '#F6F4FF', base: '#8E82C9' }, // [BARU] Planning: violet / indigo
  mgmt: { floor: '#EFE8DA', wall: '#9DB4D4', trim: '#F3F7FC', base: '#6F89AD' }, // [BARU] Management: biru baja + kayu
};
const EMAS = '#F5C84C';

// Bagi garis a..b menjadi potongan dinding, menyisakan celah (lebar gw) di tiap titik gaps. Hasil: [tengah, panjang].
function runs(a: number, b: number, gaps: number[] = [], gw = 2): [number, number][] {
  const out: [number, number][] = [];
  let cur = a;
  [...gaps].sort((p, q) => p - q).forEach((g) => {
    const st = g - gw / 2;
    if (st > cur) out.push([(cur + st) / 2, st - cur]);
    cur = g + gw / 2;
  });
  if (b > cur) out.push([(cur + b) / 2, b - cur]);
  return out;
}

// Lantai satu ruangan (tebal 0.2, permukaan di y = 0).
function Lantai({ cx = 0, cz = 0, w, d, color }: { cx?: number; cz?: number; w: number; d: number; color: string }) {
  return <Box pos={[cx, -0.1, cz]} size={[w, 0.2, d]} color={color} cast={false} />;
}

// Dinding lurus. sumbu 'x' = membentang sepanjang x di z = `di`; sumbu 'z' = membentang sepanjang z di x = `di`.
// 'tinggi' = tembok penuh (1.6), 'kaca' = tembok 0.7 + kaca sampai 1.45 (partisi kantor, isi ruangan di belakangnya tetap terlihat),
// 'rendah' = pagar rendah. `pintu` = titik tengah celah pintu (lebar 2); partisi kaca diberi kusen aluminium grafit + daun kaca geser terbuka.
// [BARU] penuh = badan dinding dibuat setinggi dinding 'tinggi' (tanpa kaca) tetapi kusen pintu gaya 'kaca' tetap digambar.
// [BARU] Sisi luar semua dinding gedung dibuat putih seragam. `luar` = arah sisi luar dinding: +1 = sisi +z (sumbu 'x') / +x (sumbu 'z'), -1 = sebaliknya.
// Dilapis pelat putih sangat tipis (tetap bisa digabung BatchStatis); sisi dalam ruangan tetap warna tema ruangan.
const PUTIH_LUAR = '#F3F3EF';
// ---- [BARU] DETAIL DINDING LUAR & LANTAI LORONG ala kantor modern ---------------------------------------------------------
// Sisi luar dinding (menghadap lorong / luar gedung) sebelumnya polos putih. Sekarang tiap dinding luar mendapat: plint charcoal + list aluminium,
// panel bawah (wainscot) abu muda berlis, sambungan panel vertikal & garis reveal (satu tekstur per bentang dinding, murah), LED cove tipis di atas,
// lukisan abstrak & lampu dinding bergantian, papan nomor ruang di samping pintu, ambang pintu aluminium, dan pita kaca buram (frosted) di partisi kaca.
// Semua digambar di dalam <Dinding /> sehingga ikut naik bersama dindingnya. Geometri/material/tekstur dipakai bersama (cache) supaya ringan.
const KT_TEX = new Map<string, THREE.CanvasTexture>();
function kTex(key: string, w: number, h: number, gambar: (x: CanvasRenderingContext2D) => void, ulang = false): THREE.CanvasTexture {
  let t = KT_TEX.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (x) gambar(x);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (ulang) t.wrapS = THREE.RepeatWrapping;
  KT_TEX.set(key, t);
  return t;
}
const KT_GEO = new Map<string, THREE.BoxGeometry>();
function kGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w}|${h}|${d}`;
  let g = KT_GEO.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); KT_GEO.set(k, g); }
  return g;
}
const KT_MAT = new Map<string, THREE.Material>();
function kMat(jenis: 'lambert' | 'basic' | 'tambah' | 'kaca', warna: string, opacity = 1): THREE.Material {
  const k = `${jenis}|${warna}|${opacity}`;
  let m = KT_MAT.get(k);
  if (!m) {
    if (jenis === 'lambert') m = new THREE.MeshLambertMaterial({ color: warna });
    else if (jenis === 'basic') m = new THREE.MeshBasicMaterial({ color: warna, transparent: opacity < 1, opacity });
    else if (jenis === 'tambah') m = new THREE.MeshBasicMaterial({ color: warna, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    else m = new THREE.MeshLambertMaterial({ color: warna, transparent: true, opacity, depthWrite: false });
    KT_MAT.set(k, m);
  }
  return m;
}
function KBox({ pos, size, color, jenis = 'lambert', opacity = 1 }: { pos: V3; size: V3; color: string; jenis?: 'lambert' | 'basic' | 'tambah' | 'kaca'; opacity?: number }) {
  return <mesh position={pos} geometry={kGeo(size[0], size[1], size[2])} material={kMat(jenis, color, opacity)} />;
}

// Tekstur panel dinding (1 panel = 1.5 satuan lebar, tinggi = tinggi dinding). Transparan: hanya detail, warna dasar dari pelat putih.
const PANEL_W = 1.5;
function texPanel(hb: number): THREE.CanvasTexture {
  const PPU = 128;
  const w = Math.round(PANEL_W * PPU), h = Math.round(hb * PPU);
  return kTex(`panel${hb}`, w, h, (x) => {
    const Y = (u: number) => h - u * PPU;
    if (hb >= 1.5) {
      x.fillStyle = '#E3E6E2'; x.fillRect(0, Y(0.56), w, (0.56 - 0.1) * PPU); // panel bawah
      x.fillStyle = '#AEB5BC'; x.fillRect(0, Y(0.56) - 2, w, 3); // list aluminium
      x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(0, Y(0.56) + 1, w, 1);
      x.fillStyle = 'rgba(120,126,124,0.26)'; x.fillRect(0, Y(hb - 0.16), w, 2); // garis reveal horizontal atas
    }
    const atas = hb >= 1.5 ? hb - 0.16 : hb;
    x.fillStyle = 'rgba(120,126,124,0.30)'; x.fillRect(0, Y(atas), 2, (atas - 0.1) * PPU); // sambungan panel vertikal
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(2, Y(atas), 1, (atas - 0.1) * PPU);
    x.fillStyle = '#4A5058'; x.fillRect(0, Y(0.1), w, 0.1 * PPU); // plint charcoal
    x.fillStyle = '#C5CBD1'; x.fillRect(0, Y(0.1), w, 2); // list atas plint
  }, true);
}
// Lukisan abstrak modern (6 varian).
const PAL_ART = [
  ['#1F3B5C', '#2AA79B', '#E8A33D', '#F3EFE6'], ['#2B2F4A', '#E26D5A', '#F2C14E', '#EDE8DD'], ['#17324D', '#5BB5A2', '#F28F5B', '#F6F1E7'],
  ['#3A2E4F', '#A78BFA', '#F59E0B', '#F4F0E8'], ['#1D3A33', '#7DBE6B', '#E5C07B', '#F2EEE3'], ['#33415C', '#F28482', '#F6BD60', '#F7F3EA'],
];
function texArt(i: number): THREE.CanvasTexture {
  return kTex(`art${i}`, 256, 170, (x) => {
    const p = PAL_ART[i % PAL_ART.length];
    const r = mulberry32(i * 31 + 7);
    x.fillStyle = p[3]; x.fillRect(0, 0, 256, 170);
    const t = i % 3;
    if (t === 0) {
      x.fillStyle = p[1]; x.beginPath(); x.arc(92, 88, 56, 0, Math.PI * 2); x.fill();
      x.fillStyle = p[0]; x.fillRect(120, 30, 90, 110);
      x.fillStyle = p[2]; x.beginPath(); x.arc(176, 52, 22, 0, Math.PI * 2); x.fill();
    } else if (t === 1) {
      [p[0], p[1], p[2]].forEach((c, k) => { x.fillStyle = c; x.fillRect(0, 20 + k * 46, 256, 34); });
      x.fillStyle = p[3]; x.beginPath(); x.arc(70 + r() * 110, 85, 34, 0, Math.PI * 2); x.fill();
    } else {
      x.fillStyle = p[0]; x.fillRect(24, 24, 120, 90);
      x.fillStyle = p[1]; x.fillRect(96, 56, 130, 90);
      x.globalAlpha = 0.85; x.fillStyle = p[2]; x.fillRect(60, 86, 80, 60); x.globalAlpha = 1;
      x.strokeStyle = p[0]; x.lineWidth = 3; x.beginPath(); x.moveTo(20, 150); x.lineTo(236, 20); x.stroke();
    }
  });
}
function texGlowDinding(): THREE.CanvasTexture {
  return kTex('glowD', 64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}
// Papan nomor ruang: "KODE|NAMA RUANG".
function texPlat(label: string): THREE.CanvasTexture {
  return kTex(`plat${label}`, 384, 140, (x) => {
    const [kode, nama] = label.split('|');
    x.fillStyle = '#262B33'; x.fillRect(0, 0, 384, 140);
    x.fillStyle = '#59C2B8'; x.fillRect(0, 128, 384, 12);
    x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 52px sans-serif'; x.fillText(kode ?? '', 192, 44);
    const f = Math.max(18, Math.min(30, Math.floor(340 / Math.max(6, (nama ?? '').length) * 1.5)));
    x.font = `600 ${f}px sans-serif`; x.fillStyle = '#C9D0D6'; x.fillText(nama ?? '', 192, 96);
  });
}

// Dinding luar menghadap gedung bagian luar (bukan lorong): hanya panel/plint, tanpa lukisan & lampu.
function dindingGedungLuar(sumbu: 'x' | 'z', di: number): boolean {
  if (sumbu === 'z') return Math.abs(di - (-22.3 - GESER_BARAT)) < 0.02 || Math.abs(di - X_TIMUR) < 0.02;
  return Math.abs(di - gz(-5.6)) < 0.02 || Math.abs(di - gz(30.6)) < 0.02;
}

// Detail satu bentang dinding. Kerangka lokal: x = sepanjang dinding (pusat bentang), y = naik, z = keluar dari permukaan luar dinding.
function DetailLuar({ m, l, hb, kaca, koridor, sgn, hindar, pintu, seed }: {
  m: number; l: number; hb: number; kaca: boolean; koridor: boolean; sgn: 1 | -1; hindar: number[]; pintu: number[]; seed: number;
}) {
  const tex = useMemo(() => {
    const t = texPanel(hb).clone();
    t.repeat.set(l / PANEL_W, 1);
    t.needsUpdate = true;
    return t;
  }, [hb, l]);
  useEffect(() => () => tex.dispose(), [tex]);
  const items: { u: number; jenis: 'art' | 'lampu'; v: number }[] = [];
  if (koridor && !kaca && l > 2.6) {
    const n = Math.floor((l - 1.2) / 3.2);
    for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * 3.2;
      const along = m + sgn * u;
      if (pintu.some((g) => Math.abs(along - g) < 1.9)) continue;
      if (hindar.some((g) => Math.abs(along - g) < 1.3)) continue;
      items.push({ u, jenis: (k + seed) % 2 === 0 ? 'art' : 'lampu', v: (seed * 3 + k * 5) % 6 });
    }
  }
  return (
    <group>
      <mesh position={[0, hb / 2, 0.108]}>
        <planeGeometry args={[l, hb]} />
        <meshLambertMaterial map={tex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      {kaca && <KBox pos={[0, 1.08, 0]} size={[l, 0.2, 0.07]} color="#FFFFFF" jenis="kaca" opacity={0.55} />}
      {koridor && !kaca && hb >= 1.5 && l > 1 && <KBox pos={[0, hb - 0.11, 0.112]} size={[l - 0.4, 0.014, 0.006]} color="#8FF3FF" jenis="basic" />}
      {items.map((it) => it.jenis === 'art' ? (
        <group key={it.u} position={[it.u, 1.0, 0.108]}>
          <KBox pos={[0, 0, 0.015]} size={[0.9, 0.62, 0.03]} color="#2B2F36" />
          <mesh position={[0, 0, 0.032]}>
            <planeGeometry args={[0.8, 0.53]} />
            <meshLambertMaterial map={texArt(it.v)} />
          </mesh>
        </group>
      ) : (
        <group key={it.u} position={[it.u, 1.0, 0.108]}>
          <mesh position={[0, 0, 0.006]}>
            <planeGeometry args={[0.8, 1.3]} />
            <meshBasicMaterial map={texGlowDinding()} color="#FFD9A0" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <KBox pos={[0, 0, 0.03]} size={[0.1, 0.36, 0.05]} color="#2E343C" />
          <KBox pos={[0, 0, 0.058]} size={[0.05, 0.28, 0.012]} color="#FFE7B0" jenis="basic" />
        </group>
      ))}
    </group>
  );
}

function Dinding({ sumbu, di, dari, ke, gaya, theme, pintu = [], modern = false, penuh = false, luar, papan = [], hindar = [] }: {
  sumbu: 'x' | 'z'; di: number; dari: number; ke: number; gaya: Gaya; theme: Theme; pintu?: number[]; modern?: boolean; penuh?: boolean; luar?: 1 | -1;
  papan?: string[]; hindar?: number[]; // papan = teks papan nomor ruang di samping tiap pintu (urut sesuai `pintu`, "KODE|NAMA"); hindar = titik (sepanjang dinding) yang sudah berdekorasi
}) {
  // [BARU] kerangka lokal sisi luar: z lokal = keluar dari permukaan luar dinding, x lokal = sepanjang dinding (arah dunia = sgn)
  const sgn: 1 | -1 = sumbu === 'x' ? (luar === 1 ? 1 : -1) : (luar === 1 ? -1 : 1);
  const frame = (along: number): { position: V3; rotation: V3 } => ({
    position: sumbu === 'x' ? [along, 0, di] : [di, 0, along],
    rotation: [0, sumbu === 'x' ? (luar === 1 ? 0 : Math.PI) : (luar === 1 ? Math.PI / 2 : -Math.PI / 2), 0],
  });
  const koridor = !dindingGedungLuar(sumbu, di);
  const P = (m: number, y: number): V3 => (sumbu === 'x' ? [m, y, di] : [di, y, m]);
  const S = (l: number, h: number, t: number): V3 => (sumbu === 'x' ? [l, h, t] : [t, h, l]);
  return (
    <group>
      {runs(dari, ke, pintu).map(([m, l]) => {
        const hb = gaya === 'tinggi' || penuh ? 1.6 : gaya === 'rendah' ? 0.3 : 0.7;
        const po = luar ? 0.102 * luar : 0;
        // [DIUBAH] Dinding luar: sisi luar, UJUNG dinding (sudut), dan separuh luar lis atas semuanya putih; sisi dalam tetap warna tema.
        const st = m - l / 2, en = m + l / 2;
        const slab = luar ? (
          <>
            <Box pos={sumbu === 'x' ? [m, hb / 2, di + po] : [di + po, hb / 2, m]} size={S(l, hb, 0.004)} color={PUTIH_LUAR} cast={false} />
            {Math.abs(st - dari) < 1e-6 && <Box pos={P(st - 0.002, hb / 2)} size={S(0.004, hb, 0.2)} color={PUTIH_LUAR} cast={false} />}
            {Math.abs(en - ke) < 1e-6 && <Box pos={P(en + 0.002, hb / 2)} size={S(0.004, hb, 0.2)} color={PUTIH_LUAR} cast={false} />}
          </>
        ) : null;
        // lis atas: tanpa `luar` utuh warna tema; dengan `luar` separuh sisi luar putih, separuh sisi dalam warna tema
        const Q = (y: number, off: number): V3 => (sumbu === 'x' ? [m, y, di + off] : [di + off, y, m]);
        const lis = (y: number, h: number, t: number) => luar ? (
          <>
            <Box pos={Q(y, (t / 4) * luar)} size={S(l, h, t / 2)} color={PUTIH_LUAR} cast={false} />
            <Box pos={Q(y, (-t / 4) * luar)} size={S(l, h, t / 2)} color={theme.trim} cast={false} />
          </>
        ) : <Box pos={P(m, y)} size={S(l, h, t)} color={theme.trim} cast={false} />;
        if (gaya === 'tinggi' || penuh) {
          return (
            <React.Fragment key={m}>
              {slab}
              <Box pos={P(m, 0.8)} size={S(l, 1.6, 0.2)} color={theme.wall} />
              {lis(1.62, 0.04, 0.24)}
            </React.Fragment>
          );
        }
        if (gaya === 'rendah') {
          return (
            <React.Fragment key={m}>
              {slab}
              <Box pos={P(m, 0.15)} size={S(l, 0.3, 0.2)} color={theme.wall} />
              {lis(0.31, 0.03, 0.24)}
            </React.Fragment>
          );
        }
        const n = Math.max(0, Math.floor(l / 2.6));
        return (
          <React.Fragment key={m}>
            {slab}
            <Box pos={P(m, 0.35)} size={S(l, 0.7, 0.2)} color={theme.wall} />
            {lis(0.72, 0.04, 0.26)}
            <mesh position={P(m, 1.1)}>
              <boxGeometry args={S(l, 0.68, 0.04)} />
              <meshLambertMaterial color="#BFE3F2" transparent opacity={0.2} depthWrite={false} />
            </mesh>
            <Box pos={P(m, 1.46)} size={S(l, 0.05, 0.1)} color={theme.trim} cast={false} />
            {Array.from({ length: n }, (_, i) => (
              <Box key={i} pos={P(m - l / 2 + ((i + 1) * l) / (n + 1), 1.1)} size={S(0.05, 0.68, 0.07)} color={theme.trim} cast={false} />
            ))}
          </React.Fragment>
        );
      })}
      {/* [BARU] detail sisi luar ala kantor modern (hanya dinding ber-`luar`, bukan pagar rendah) */}
      {luar && gaya !== 'rendah' && runs(dari, ke, pintu).map(([m, l], i) => (
        <group key={`dl${m}`} {...frame(m)}>
          <DetailLuar m={m} l={l} hb={gaya === 'tinggi' || penuh ? 1.6 : 0.7} kaca={gaya === 'kaca' && !penuh} koridor={koridor} sgn={sgn}
            hindar={hindar} pintu={pintu} seed={i + Math.round(Math.abs(di) * 3)} />
        </group>
      ))}
      {luar && gaya !== 'rendah' && pintu.map((g, i) => (
        <React.Fragment key={`dp${g}`}>
          {/* ambang pintu aluminium */}
          <group {...frame(g)}>
            <KBox pos={[0, 0.008, 0]} size={[2.0, 0.016, 0.34]} color="#B8BFC6" />
            <KBox pos={[0, 0.0165, 0]} size={[1.9, 0.002, 0.05]} color="#4A5058" />
          </group>
          {/* papan nomor ruang di samping pintu */}
          {papan[i] && (
            <group {...frame(g + 1.45)}>
              <group position={[0, gaya === 'kaca' && !penuh ? 0.42 : 1.05, 0.108]}>
                <KBox pos={[0, 0, 0.012]} size={[0.62, 0.24, 0.024]} color="#1B1F26" />
                <mesh position={[0, 0, 0.026]}>
                  <planeGeometry args={[0.58, 0.213]} />
                  <meshBasicMaterial map={texPlat(papan[i])} />
                </mesh>
              </group>
            </group>
          )}
        </React.Fragment>
      ))}
      {gaya === 'kaca' && pintu.map((g) => (
        modern ? (
          <group key={`k${g}`}>
            {[-1, 1].map((sd) => (
              <React.Fragment key={sd}>
                <Box pos={P(g + sd * 1.0, 0.76)} size={S(0.1, 1.52, 0.18)} color="#1B1740" />
                <Cahaya pos={P(g + sd * 0.94, 0.76)} size={S(0.014, 1.4, 0.022)} color="#67E8F9" />
              </React.Fragment>
            ))}
            <PintuGeser sumbu={sumbu} di={di} g={g} modern />
            <Box pos={P(g, 1.55)} size={S(2.12, 0.1, 0.18)} color="#1B1740" />
            <Cahaya pos={P(g, 1.495)} size={S(2.0, 0.014, 0.024)} color="#67E8F9" />
            <Cahaya pos={P(g, 0.012)} size={S(1.9, 0.01, 0.05)} color="#A78BFA" opacity={0.85} />
          </group>
        ) : (
          <group key={`k${g}`}>
            {/* [DIGANTI] Pintu kaca geser kusen aluminium grafit (tanpa neon), daun terbuka menumpuk di sisi dinding.
                Bukaan tetap selebar 2 (tiang di g ± 1.0), jadi jalur agen tidak berubah. */}
            {[-1, 1].map((sd) => (
              <React.Fragment key={sd}>
                <Box pos={P(g + sd * 1.0, 0.76)} size={S(0.1, 1.52, 0.18)} color="#2E3238" />
                <Box pos={P(g + sd * 0.945, 0.76)} size={S(0.012, 1.46, 0.2)} color="#C9D1D8" cast={false} />
              </React.Fragment>
            ))}
            <PintuGeser sumbu={sumbu} di={di} g={g} modern={false} />
            <Box pos={P(g, 1.55)} size={S(2.12, 0.1, 0.18)} color="#2E3238" />
            <Box pos={P(g, 1.495)} size={S(2.0, 0.02, 0.2)} color="#C9D1D8" cast={false} />
            {/* ambang aluminium di lantai */}
            <Box pos={P(g, 0.008)} size={S(1.9, 0.012, 0.12)} color="#AEB6BE" cast={false} />
          </group>
        )
      ))}
    </group>
  );
}

// [BARU] PINTU OTOMATIS: dua daun kaca geser yang NORMALNYA TERTUTUP. Daun membuka otomatis bila ada AI (Neo / Atlas / Zeno, posisi dari POS_AGEN)
// berada tepat di depan / di celah pintu pada jarak dekat, lalu menutup lagi setelah tidak ada AI di depan pintu (sudah lewat atau menjauh).
// Zona: sejajar dinding |u| < 1.1 dan tegak lurus dinding |v| < 1.6 (histeresis: bila sudah terbuka, baru menutup setelah keluar |u| < 1.5, |v| < 2.1),
// berlaku di kedua sisi dinding. Bukaan tetap selebar 2 (tiang di g +- 1.0). Lampu indikator di kusen atas: cyan = tertutup, hijau = terbuka.
const PINTU_BUKA_DETIK = 0.32; // lama membuka / menutup penuh
const WARNA_PINTU_TUTUP = new THREE.Color('#67E8F9');
const WARNA_PINTU_BUKA = new THREE.Color('#6EE7B7');
function PintuGeser({ sumbu, di, g, modern }: { sumbu: 'x' | 'z'; di: number; g: number; modern: boolean }) {
  const daun = useRef<(THREE.Group | null)[]>([null, null]);
  const lampu = useRef<THREE.MeshBasicMaterial>(null);
  const buka = useRef(0); // 0 = tertutup, 1 = terbuka penuh
  const dekat = useRef(false);
  const S = (l: number, h: number, t: number): V3 => (sumbu === 'x' ? [l, h, t] : [t, h, l]);
  const Q = (l: number, y: number, t: number): V3 => (sumbu === 'x' ? [l, y, t] : [t, y, l]);
  const tempat = (sd: number, along: number): V3 => {
    const t = di + (sd < 0 ? 0.14 : 0.17); // dua daun beda ketebalan z supaya tidak saling tumpang saat menutup
    return sumbu === 'x' ? [along, 0.76, t] : [t, 0.76, along];
  };
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cx = sumbu === 'x' ? g : di;
    const cz = sumbu === 'x' ? di : g;
    const uMax = dekat.current ? 1.5 : 1.1;
    const vMax = dekat.current ? 2.1 : 1.6;
    let ada = false;
    for (const k in POS_AGEN) {
      const [ax, az] = POS_AGEN[k];
      const u = Math.abs(sumbu === 'x' ? ax - cx : az - cz);
      const v = Math.abs(sumbu === 'x' ? az - cz : ax - cx);
      if (u < uMax && v < vMax) { ada = true; break; }
    }
    dekat.current = ada;
    const target = ada ? 1 : 0;
    const b = buka.current;
    if (b === target) return;
    const next = b + Math.sign(target - b) * Math.min(Math.abs(target - b), dt / PINTU_BUKA_DETIK);
    buka.current = next;
    const e = next * next * (3 - 2 * next); // smoothstep
    [-1, 1].forEach((sd, i) => {
      const d = daun.current[i];
      if (d) d.position.set(...tempat(sd, g + sd * (0.48 + e * 1.02)));
    });
    if (lampu.current) lampu.current.color.copy(WARNA_PINTU_TUTUP).lerp(WARNA_PINTU_BUKA, e);
  });
  return (
    <>
      {[-1, 1].map((sd, i) => (
        <group key={sd} ref={(r) => { daun.current[i] = r; }} position={tempat(sd, g + sd * 0.48)} userData={{ nopeta: true }}>
          {modern ? (
            <>
              <mesh>
                <boxGeometry args={S(0.96, 1.4, 0.025)} />
                <meshBasicMaterial color="#67E8F9" transparent opacity={0.16} depthWrite={false} toneMapped={false} />
              </mesh>
              <Cahaya pos={[0, 0.7, 0]} size={S(0.96, 0.014, 0.03)} color="#A78BFA" />
              <Cahaya pos={[0, -0.7, 0]} size={S(0.96, 0.014, 0.03)} color="#A78BFA" />
              <Cahaya pos={Q(-sd * 0.47, 0, 0)} size={S(0.012, 1.38, 0.03)} color="#67E8F9" opacity={0.85} />
            </>
          ) : (
            <>
              <mesh>
                <boxGeometry args={S(0.96, 1.4, 0.025)} />
                <meshLambertMaterial color="#BFE3F2" transparent opacity={0.22} depthWrite={false} />
              </mesh>
              <Box pos={[0, 0.69, 0]} size={S(0.96, 0.04, 0.04)} color="#C9D1D8" cast={false} />
              <Box pos={[0, -0.69, 0]} size={S(0.96, 0.04, 0.04)} color="#C9D1D8" cast={false} />
              {[-1, 1].map((e) => (
                <Box key={e} pos={Q(e * 0.47, 0, 0)} size={S(0.04, 1.4, 0.04)} color="#C9D1D8" cast={false} />
              ))}
              <Box pos={Q(-sd * 0.36, 0, 0.03)} size={S(0.03, 0.42, 0.03)} color="#7C858E" cast={false} />
            </>
          )}
        </group>
      ))}
      <mesh position={sumbu === 'x' ? [g, 1.62, di] : [di, 1.62, g]}>
        <boxGeometry args={S(0.14, 0.03, 0.03)} />
        <meshBasicMaterial ref={lampu} color="#67E8F9" toneMapped={false} />
      </mesh>
    </>
  );
}

function Beanbag({ pos, color, s = 1 }: { pos: V3; color: string; s?: number }) {
  return (
    <group position={pos} scale={[s, s * 0.7, s]}>
      <Ball pos={[0, 0.4, 0]} r={0.5} color={color} flat={false} />
      <Ball pos={[0, 0.78, -0.12]} r={0.3} color={lighten(color, 0.06)} flat={false} />
    </group>
  );
}

// [DIGANTI] Bangku modern futuristik: dudukan putih tanpa sandaran, dua kaki papan putih, LED tipis cyan/lilac di bawah & tepi depan.
// Ukuran/tinggi sama dengan bangku kayu lama (1.5 x 0.45, duduk di y = 0.45) jadi posisi & jalur agen tidak berubah.
function Bench({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* dudukan putih + alas abu terang (kesan melayang) */}
      <Box pos={[0, 0.46, 0]} size={[1.5, 0.08, 0.46]} color="#F4F7FA" />
      <Box pos={[0, 0.405, 0]} size={[1.42, 0.03, 0.4]} color="#D5DCE4" cast={false} />
      {/* kaki papan putih */}
      {[-0.52, 0.52].map((x) => (
        <Box key={x} pos={[x, 0.19, 0]} size={[0.12, 0.38, 0.34]} color="#ECF0F4" />
      ))}
      {/* LED: garis tepi depan dudukan, garis di bawah dudukan, dan cahaya lembut di lantai */}
      <Cahaya pos={[0, 0.462, 0.232]} size={[1.46, 0.014, 0.012]} color="#A78BFA" />
      <Cahaya pos={[0, 0.386, 0.12]} size={[1.3, 0.012, 0.03]} color="#67E8F9" />
      <Cahaya pos={[0, 0.011, 0]} size={[1.34, 0.008, 0.4]} color="#67E8F9" opacity={0.22} />
    </group>
  );
}

function StudioDesk({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.78, 0]} size={[1.9, 0.07, 0.85]} color="#F6F1E6" />
      {[-0.85, 0.85].map((x) => (
        <Box key={x} pos={[x, 0.38, 0]} size={[0.06, 0.76, 0.75]} color="#DCE3E8" />
      ))}
      <Box pos={[0, 0.4, -0.36]} size={[1.64, 0.5, 0.03]} color="#DCE3E8" />
      <Box pos={[0, 0.745, 0.4]} size={[1.9, 0.03, 0.03]} color="#4C8FBF" cast={false} />
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * 0.4, 0, -0.18]} rotation={[0, sd * -0.22, 0]}>
          <Box pos={[0, 0.9, 0]} size={[0.06, 0.2, 0.06]} color="#B8C2CC" cast={false} />
          <Box pos={[0, 1.2, 0]} size={[0.68, 0.42, 0.04]} color="#E9EEF2" />
          <mesh position={[0, 1.2, 0.022]}>
            <boxGeometry args={[0.62, 0.36, 0.008]} />
            <meshStandardMaterial color="#17212B" roughness={0.3} />
          </mesh>
        </group>
      ))}
      <Box pos={[0, 0.822, 0.18]} size={[0.5, 0.015, 0.16]} color="#E9EEF2" cast={false} />
      <Box pos={[0.72, 0.87, 0.05]} size={[0.14, 0.12, 0.14]} color="#4C8FBF" />
    </group>
  );
}

function Cabinet({ pos, color = '#E3EAF0' }: { pos: V3; color?: string }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.7, 0]} size={[1.2, 1.4, 0.5]} color={color} />
      {[0.3, 0.7, 1.1].map((y) => (
        <React.Fragment key={y}>
          <Box pos={[0, y, 0.255]} size={[1.1, 0.34, 0.02]} color={lighten(color, -0.04)} cast={false} />
          <Box pos={[0, y + 0.08, 0.275]} size={[0.3, 0.03, 0.03]} color="#8FA3B3" cast={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

function TVWall({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.9, 1.1, 0.06]} color="#2B3340" cast={false} />
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[1.8, 1.0, 0.01]} />
        <meshStandardMaterial color="#111827" roughness={0.25} />
      </mesh>
    </group>
  );
}

function VaultDoor({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.5, 1.4, 0.1]} color="#6B7280" cast={false} />
      <Tube pos={[0, 0, 0.08]} r={0.55} h={0.12} color="#9CA3AF" rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      <Tube pos={[0, 0, 0.15]} r={0.4} h={0.06} color="#6B7280" rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      {Array.from({ length: 8 }, (_, i) => (
        <Box key={i} pos={[Math.sin((i * Math.PI) / 4) * 0.49, Math.cos((i * Math.PI) / 4) * 0.49, 0.15]} size={[0.06, 0.06, 0.05]} color={EMAS} cast={false} />
      ))}
      <Box pos={[0, 0, 0.2]} size={[0.62, 0.05, 0.05]} color={EMAS} cast={false} />
      <Box pos={[0, 0, 0.2]} size={[0.05, 0.62, 0.05]} color={EMAS} cast={false} />
      <Tube pos={[0, 0, 0.2]} r={0.1} h={0.08} color={EMAS} rot={[Math.PI / 2, 0, 0]} seg={14} cast={false} />
    </group>
  );
}

function GoldScale({ pos, s = 1 }: { pos: V3; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <Tube pos={[0, 0.04, 0]} r={0.3} h={0.08} color="#8F673C" seg={20} />
      <Tube pos={[0, 0.5, 0]} r={0.04} h={0.92} color={EMAS} seg={10} />
      <Box pos={[0, 0.98, 0]} size={[0.95, 0.04, 0.05]} color={EMAS} />
      <Ball pos={[0, 1.04, 0]} r={0.07} color={EMAS} />
      {[-1, 1].map((sd) => (
        <React.Fragment key={sd}>
          <Tube pos={[sd * 0.44, 0.8, 0]} r={0.008} h={0.36} color="#B8860B" seg={6} cast={false} />
          <Tube pos={[sd * 0.44, 0.62, 0]} r={0.2} h={0.03} color="#FBE08A" seg={18} />
        </React.Fragment>
      ))}
    </group>
  );
}

function Crate({ pos, s = 0.7, color = '#C9A26B' }: { pos: V3; s?: number; color?: string }) {
  return (
    <group position={pos}>
      <Box pos={[0, s / 2, 0]} size={[s, s, s]} color={color} />
      <Box pos={[0, s / 2, 0]} size={[s + 0.02, 0.07, s + 0.02]} color={lighten(color, -0.1)} cast={false} />
      <Box pos={[0, s / 2, 0]} size={[0.07, s + 0.02, s + 0.02]} color={lighten(color, -0.1)} cast={false} />
    </group>
  );
}

function PalletRack({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {[-1.25, 1.25].flatMap((x) => [-0.25, 0.25].map((z) => (
        <Box key={`${x}${z}`} pos={[x, 0.8, z]} size={[0.07, 1.6, 0.07]} color="#B45309" />
      )))}
      {[0.5, 1.05].map((y) => (
        <Box key={y} pos={[0, y, 0]} size={[2.6, 0.06, 0.6]} color="#F1F4F7" />
      ))}
      <Crate pos={[-0.8, 0.53, 0]} s={0.42} color="#C9A26B" />
      <Crate pos={[-0.2, 0.53, 0]} s={0.42} color="#B5834A" />
      <Crate pos={[0.5, 0.53, 0]} s={0.42} color="#5B9BD5" />
      <Crate pos={[1.0, 0.53, 0]} s={0.36} color="#C9A26B" />
      <Crate pos={[-0.6, 1.08, 0]} s={0.42} color="#B5834A" />
      <Crate pos={[0.2, 1.08, 0]} s={0.42} color="#C9A26B" />
      <Crate pos={[0.9, 1.08, 0]} s={0.36} color="#E0713F" />
    </group>
  );
}

function MejaPenanda({ kind }: { kind: 'aset' | 'persediaan' | 'kewajiban' | 'ekuitas' }) {
  if (kind === 'aset') {
    return (
      <group>
        <Box pos={[0, 0.9, 0]} size={[0.2, 0.2, 0.2]} color={EMAS} />
        <Box pos={[0, 0.9, 0]} size={[0.22, 0.04, 0.22]} color="#B8860B" cast={false} />
      </group>
    );
  }
  if (kind === 'persediaan') {
    return (
      <group>
        <Box pos={[-0.07, 0.87, 0]} size={[0.16, 0.14, 0.16]} color="#C9A26B" />
        <Box pos={[0.09, 0.86, 0.03]} size={[0.14, 0.12, 0.14]} color="#B5834A" />
        <Box pos={[0, 1.0, 0]} size={[0.15, 0.13, 0.15]} color="#D8B27A" />
      </group>
    );
  }
  if (kind === 'kewajiban') {
    return (
      <group>
        <Box pos={[0, 0.86, 0]} size={[0.3, 0.1, 0.2]} color="#7C4A21" />
        <Box pos={[0, 0.92, 0.0]} size={[0.3, 0.03, 0.2]} color="#E0713F" cast={false} />
        <Box pos={[0.05, 0.89, 0.11]} size={[0.08, 0.05, 0.01]} color={EMAS} cast={false} />
      </group>
    );
  }
  return (
    <group>
      <Box pos={[0, 0.84, 0]} size={[0.22, 0.03, 0.12]} color="#8F673C" />
      <Tube pos={[0, 0.96, 0]} r={0.015} h={0.24} color={EMAS} seg={6} cast={false} />
      <Box pos={[0, 1.07, 0]} size={[0.4, 0.015, 0.02]} color={EMAS} cast={false} />
      {[-1, 1].map((sd) => (
        <Tube key={sd} pos={[sd * 0.19, 1.0, 0]} r={0.07} h={0.012} color="#FBE08A" seg={12} cast={false} />
      ))}
    </group>
  );
}


// ---- Studio = ruang FINANCIAL STATEMENTS (kanan-bawah) — biru langit, krem ----
// [DIUBAH] Lantai Studio ikut diperlebar ke timur (8.8 -> 13); isi lama tetap di koordinat 12.3..20.4 (pusat isi = 16.4).
// MODE DESAIN SAJA: belum terhubung ke backend / tugas agen. Daftar di bawah disiapkan supaya nanti tinggal disambungkan
// (kunci = jenis meja, href = halaman tujuan, seat = kunci kursi untuk layar monitor; urutan = urutan meja di ruangan).
export const HALAMAN_FS = [
  { id: 'profit-loss', nama: 'Profit & Loss', href: '/financial-statements/profit-loss', warna: '#34D399', kunci: 'pl', seat: 'fs:0' },
  { id: 'balance-sheet', nama: 'Balance Sheet', href: '/financial-statements/balance-sheet', warna: '#38BDF8', kunci: 'bs', seat: 'fs:1' },
  { id: 'cash-flow', nama: 'Cash Flow', href: '/financial-statements/cash-flow', warna: '#2DD4BF', kunci: 'cf', seat: 'fs:2' },
  { id: 'changes-in-equity', nama: 'Changes in Equity', href: '/financial-statements/changes-in-equity', warna: '#A78BFA', kunci: 'ce', seat: 'fs:3' },
  { id: 'notes', nama: 'Notes (CALK)', href: '/financial-statements/notes', warna: '#FBBF24', kunci: 'nt', seat: 'fs:4' },
] as const;
// Halaman ke-6 tanpa meja sendiri: nanti disambungkan ke Menara Laporan (hologram) di sisi timur ruangan.
export const HALAMAN_FS_MAPPING = { id: 'mapping', nama: 'Statement Mapping', href: '/financial-statements/mapping', warna: '#67E8F9' } as const;
type KunciFS = (typeof HALAMAN_FS)[number]['kunci'];

const FS_TEMA: ScreenTema = {
  bg: '#06142B',
  cols: ['#67E8F9', '#34D399', '#BAE6FD', '#FDE68A', '#C4B5FD', '#E2E8F0'],
  glow: '#38BDF8',
};
const FS_KATA: Record<KunciFS, string[]> = {
  pl: ['Pendapatan', 'HPP', 'Laba Kotor', 'Beban Usaha', 'EBITDA', 'Laba Bersih', 'Margin', 'Penjualan', 'Beban Pajak', 'YoY', 'Rp', 'Laba Rugi'],
  bs: ['Aset Lancar', 'Aset Tetap', 'Liabilitas', 'Ekuitas', 'Kas', 'Piutang', 'Persediaan', 'Utang Usaha', 'Neraca', 'Balance', 'Rp', 'Total Aset'],
  cf: ['Operasi', 'Investasi', 'Pendanaan', 'Kas Awal', 'Kas Akhir', 'Arus Kas', 'Metode Tidak Langsung', 'Penerimaan', 'Pembayaran', 'Rp', 'Net'],
  ce: ['Modal Saham', 'Saldo Laba', 'Dividen', 'Saldo Awal', 'Saldo Akhir', 'Laba Periode', 'Penambahan', 'Pengurangan', 'Ekuitas', 'Rp', 'Agio'],
  nt: ['CALK', 'Catatan 1', 'Catatan 2', 'Kebijakan Akuntansi', 'Dasar Penyusunan', 'Estimasi', 'Pihak Berelasi', 'Perpajakan', 'Aset Tetap', 'Peristiwa Setelah Periode', 'Rp'],
};
const FS_NAVY = '#1E3A5F';
const FS_BIRU = '#3E6A94';
const FS_BIRU2 = '#4F7DA6';
const FS_PERAK = '#B8C4CE';

function MonitorFS({ sd, seatKey, seed, warna, kata }: { sd: -1 | 1; seatKey: string; seed: number; warna: string; kata: string[] }) {
  return (
    <group position={[sd * 0.5, 0, -0.17]} rotation={[0, sd * -0.22, 0]}>
      <Tube pos={[0, 0.832, 0]} r={0.13} h={0.016} color={FS_NAVY} seg={24} cast={false} />
      <Tube pos={[0, 0.842, 0]} r={0.1} h={0.006} color={FS_PERAK} seg={24} cast={false} />
      <Box pos={[0, 0.93, -0.03]} size={[0.05, 0.2, 0.04]} color="#94A3B8" cast={false} />
      <Box pos={[0, 1.2, 0]} size={[0.8, 0.48, 0.035]} color={FS_NAVY} />
      <Box pos={[0, 1.2, -0.022]} size={[0.74, 0.42, 0.012]} color="#2B5A87" cast={false} />
      <mesh position={[0, 1.2, 0.019]}>
        <boxGeometry args={[0.76, 0.44, 0.006]} />
        <meshStandardMaterial color="#030A18" roughness={0.2} />
      </mesh>
      <Cahaya pos={[0, 1.2 + 0.235, 0.012]} size={[0.012, 0.012, 0.004]} color="#94A3B8" />
      <Box pos={[0, 0.97, 0.018]} size={[0.1, 0.018, 0.004]} color={FS_PERAK} cast={false} />
      <group position={[0, 1.2, 0.024]}>
        <NyalaRim seatKey={seatKey} w={0.8} h={0.48} color={warna} />
      </group>
      <Screen
        seatKey={seatKey}
        size={[0.76, 0.44]}
        pos={[0, 1.2, 0.0255]}
        seed={seed}
        words={kata}
        tema={FS_TEMA}
        ledPos={sd === 1 ? [0.34, 0.968, 0.02] : undefined}
        glow={{ floorPos: [0, 0.832, 0.26], floorSize: [1.1, 0.8], haloPos: [0, 1.2, 0.14], haloSize: [1.0, 0.75] }}
      />
    </group>
  );
}

// Barang khas tiap meja halaman (permukaan meja y = 0.8265, sisi kanan meja).
function KitFS({ k }: { k: KunciFS }) {
  const Y = 0.8265;
  if (k === 'pl') {
    // grafik batang naik hologram + garis tren + tumpukan koin + panah naik hijau
    return (
      <group position={[0.78, Y, 0.14]}>
        <Tube pos={[0, 0.006, 0]} r={0.15} h={0.012} color={FS_NAVY} seg={24} cast={false} />
        {[0.05, 0.09, 0.14, 0.2, 0.27].map((h, i) => (
          <Cahaya key={i} pos={[-0.1 + i * 0.05, 0.012 + h / 2, -0.02]} size={[0.034, h, 0.034]} color={i % 2 ? '#34D399' : '#6EE7B7'} />
        ))}
        <mesh position={[0.1, 0.32, -0.02]}>
          <coneGeometry args={[0.035, 0.07, 12]} />
          <meshBasicMaterial color="#34D399" toneMapped={false} />
        </mesh>
        <Cahaya pos={[0.1, 0.27, -0.02]} size={[0.014, 0.05, 0.014]} color="#34D399" />
        {[0, 1, 2, 3, 4].map((j) => (
          <Tube key={j} pos={[-0.2, 0.006 + j * 0.0105, 0.12]} r={0.04} h={0.01} color={j % 3 === 2 ? '#FDE68A' : '#F5C84C'} seg={16} cast={false} />
        ))}
        <Box pos={[0.18, 0.012, 0.12]} size={[0.12, 0.024, 0.17]} color="#1F2937" cast={false} />
        <Cahaya pos={[0.18, 0.026, 0.07]} size={[0.09, 0.003, 0.03]} color="#6EE7B7" />
      </group>
    );
  }
  if (k === 'bs') {
    // timbangan neraca meja + dua buku besar
    return (
      <group position={[0.78, Y, 0.14]}>
        <Tube pos={[0, 0.008, 0]} r={0.09} h={0.016} color={FS_NAVY} seg={20} cast={false} />
        <Tube pos={[0, 0.12, 0]} r={0.012} h={0.22} color={FS_PERAK} seg={8} cast={false} />
        <Box pos={[0, 0.235, 0]} size={[0.34, 0.012, 0.016]} color={FS_PERAK} cast={false} />
        <Ball pos={[0, 0.245, 0]} r={0.022} color="#38BDF8" />
        {[-1, 1].map((sd) => (
          <React.Fragment key={sd}>
            <Tube pos={[sd * 0.16, 0.17, 0]} r={0.004} h={0.13} color="#94A3B8" seg={6} cast={false} />
            <Tube pos={[sd * 0.16, 0.1, 0]} r={0.065} rb={0.04} h={0.016} color={sd < 0 ? '#38BDF8' : '#34D399'} seg={16} />
          </React.Fragment>
        ))}
        <Box pos={[-0.18, 0.02, 0.15]} size={[0.14, 0.04, 0.1]} color="#2563EB" rot={[0, 0.2, 0]} cast={false} />
        <Box pos={[-0.18, 0.058, 0.15]} size={[0.13, 0.034, 0.09]} color="#059669" rot={[0, -0.1, 0]} cast={false} />
        <Box pos={[-0.18, 0.02, 0.157]} size={[0.13, 0.03, 0.004]} color="#F8FAFC" rot={[0, 0.2, 0]} cast={false} />
      </group>
    );
  }
  if (k === 'cf') {
    // tumpukan uang kertas + koin dengan cincin berputar + panah masuk/keluar
    return (
      <group position={[0.78, Y, 0.14]}>
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} pos={[-0.1, 0.007 + i * 0.012, 0.02]} size={[0.2, 0.011, 0.1]} color={i % 2 ? '#4ADE80' : '#86EFAC'} rot={[0, (i - 1.5) * 0.06, 0]} cast={false} />
        ))}
        <Box pos={[-0.1, 0.056, 0.02]} size={[0.04, 0.012, 0.102]} color="#166534" cast={false} />
        <Tube pos={[0.12, 0.016, -0.04]} r={0.07} h={0.012} color={FS_NAVY} seg={20} cast={false} />
        <Putar pos={[0.12, 0.12, -0.04]} speed={1.2}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.07, 0.008, 8, 28]} />
            <meshBasicMaterial color="#2DD4BF" toneMapped={false} />
          </mesh>
          <Tube pos={[0, 0, 0]} r={0.045} h={0.012} color="#F5C84C" seg={16} cast={false} />
        </Putar>
        <mesh position={[-0.12, 0.2, -0.1]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.03, 0.06, 10]} />
          <meshBasicMaterial color="#34D399" toneMapped={false} />
        </mesh>
        <Cahaya pos={[-0.12, 0.25, -0.1]} size={[0.012, 0.05, 0.012]} color="#34D399" />
        <mesh position={[0.02, 0.2, -0.1]}>
          <coneGeometry args={[0.03, 0.06, 10]} />
          <meshBasicMaterial color="#F87171" toneMapped={false} />
        </mesh>
        <Cahaya pos={[0.02, 0.155, -0.1]} size={[0.012, 0.05, 0.012]} color="#F87171" />
        <Box pos={[0.02, 0.012, 0.15]} size={[0.2, 0.024, 0.1]} color="#92400E" cast={false} />
      </group>
    );
  }
  if (k === 'ce') {
    // grafik air terjun (waterfall) saldo awal -> penambahan -> pengurangan -> saldo akhir + koin
    const blok = [
      { y0: 0, h: 0.12, c: '#A78BFA' },
      { y0: 0.12, h: 0.07, c: '#34D399' },
      { y0: 0.14, h: 0.05, c: '#F87171' },
      { y0: 0, h: 0.14, c: '#A78BFA' },
    ];
    return (
      <group position={[0.78, Y, 0.14]}>
        <Tube pos={[0, 0.006, 0]} r={0.15} h={0.012} color={FS_NAVY} seg={24} cast={false} />
        {blok.map((b, i) => (
          <Cahaya key={i} pos={[-0.105 + i * 0.07, 0.012 + b.y0 + b.h / 2, -0.02]} size={[0.05, b.h, 0.05]} color={b.c} />
        ))}
        {[0, 1, 2].map((i) => (
          <Cahaya key={`l${i}`} pos={[-0.07 + i * 0.07, 0.012 + [0.12, 0.19, 0.14][i], -0.02]} size={[0.02, 0.004, 0.004]} color="#E2E8F0" opacity={0.8} />
        ))}
        {[0, 1, 2, 3].map((j) => (
          <Tube key={j} pos={[0.17, 0.006 + j * 0.0105, 0.12]} r={0.04} h={0.01} color="#F5C84C" seg={16} cast={false} />
        ))}
        <Box pos={[-0.12, 0.012, 0.14]} size={[0.16, 0.024, 0.1]} color="#4C1D95" cast={false} />
        <Box pos={[-0.12, 0.026, 0.14]} size={[0.13, 0.004, 0.075]} color="#EDE9FE" cast={false} />
      </group>
    );
  }
  // nt: CALK — 3 binder berdiri + buku catatan terbuka + gelas pena + sticky notes + kaca pembesar
  return (
    <group position={[0.78, Y, 0.12]}>
      {[['#2563EB', 0.17], ['#DC2626', 0.15], ['#059669', 0.16]].map(([c, h], i) => (
        <group key={i} position={[-0.17 + i * 0.045, 0, -0.08]}>
          <Box pos={[0, Number(h) / 2, 0]} size={[0.04, Number(h), 0.13]} color={String(c)} cast={false} />
          <Box pos={[0.0205, Number(h) / 2, 0]} size={[0.002, Number(h) * 0.6, 0.1]} color="#F8FAFC" cast={false} />
        </group>
      ))}
      <Box pos={[0.12, 0.008, 0.08]} size={[0.24, 0.014, 0.17]} color="#92400E" cast={false} />
      <Box pos={[0.06, 0.017, 0.08]} size={[0.11, 0.004, 0.15]} color="#FFFDF6" rot={[0, 0, 0.06]} cast={false} />
      <Box pos={[0.18, 0.017, 0.08]} size={[0.11, 0.004, 0.15]} color="#FFFDF6" rot={[0, 0, -0.06]} cast={false} />
      {[0, 1, 2, 3].map((r) => (
        <Box key={r} pos={[0.06, 0.02, 0.03 + r * 0.035]} size={[0.08, 0.002, 0.006]} color="#94A3B8" cast={false} />
      ))}
      <Tube pos={[-0.02, 0.05, 0.14]} r={0.028} h={0.1} color="#1E3A5F" seg={12} cast={false} />
      {[0, 1, 2].map((i) => (
        <Box key={i} pos={[-0.02 + (i - 1) * 0.012, 0.11, 0.14]} size={[0.006, 0.07, 0.006]} color={['#F59E0B', '#EF4444', '#2563EB'][i]} rot={[0.15 * (i - 1), 0, 0.2 * (i - 1)]} cast={false} />
      ))}
      <Box pos={[-0.2, 0.006, 0.12]} size={[0.07, 0.012, 0.07]} color="#FDE047" rot={[0, 0.3, 0]} cast={false} />
      <Box pos={[-0.19, 0.016, 0.125]} size={[0.07, 0.01, 0.07]} color="#FEF08A" rot={[0, 0.1, 0]} cast={false} />
      <group position={[0.27, 0.01, 0.2]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.04, 0.006, 8, 20]} />
          <meshStandardMaterial color="#B8860B" />
        </mesh>
        <mesh position={[0, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.038, 20]} />
          <meshBasicMaterial color="#BAE6FD" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
        </mesh>
        <Box pos={[0, 0.006, 0.08]} size={[0.012, 0.012, 0.07]} color="#8F5A2C" cast={false} />
      </group>
    </group>
  );
}

// Meja kerja Financial Statements: daun putih es + inlay kaca biru tua, list perak + LED cyan, panel baja biru,
// laci 3 tingkat, 2 monitor navy, keyboard kaca + mouse, lampu meja, papan nama halaman, dan barang khas halaman.
function MejaFS({ pos, k, label, warna, seatKey, seed }: { pos: V3; k: KunciFS; label: string; warna: string; seatKey: string; seed: number }) {
  const Y = 0.8265;
  return (
    <group position={pos}>
      {/* karpet kecil + sinar lantai */}
      <Kolam pos={[0, 0.02, 0.35]} size={[3.2, 2.6]} color={warna} opacity={0.15} />
      <Box pos={[0, 0.008, 0.3]} size={[2.3, 0.016, 2.1]} color="#C4D9EA" cast={false} />
      <Box pos={[0, 0.017, 0.3]} size={[2.16, 0.006, 1.96]} color="#E6F0F8" cast={false} />
      {[-1.05, 1.05].map((x) => (
        <Box key={x} pos={[x, 0.021, 0.3]} size={[0.025, 0.004, 1.96]} color={warna} cast={false} />
      ))}
      {[-0.97, 0.97].map((z) => (
        <Box key={z} pos={[0, 0.021, 0.3 + z]} size={[2.16, 0.004, 0.025]} color={FS_PERAK} cast={false} />
      ))}
      {/* daun meja */}
      <Box pos={[0, 0.79, 0]} size={[2.2, 0.07, 0.9]} color="#F7FAFC" />
      <Box pos={[0, 0.8265, 0.04]} size={[2.02, 0.004, 0.76]} color={FS_NAVY} cast={false} />
      <Box pos={[0, 0.77, 0.455]} size={[2.2, 0.03, 0.012]} color={FS_PERAK} cast={false} />
      <Box pos={[0, 0.77, -0.455]} size={[2.2, 0.03, 0.012]} color="#94A3B8" cast={false} />
      {[-1.1, 1.1].map((x) => (
        <Box key={x} pos={[x, 0.77, 0]} size={[0.012, 0.03, 0.9]} color={FS_PERAK} cast={false} />
      ))}
      <Cahaya pos={[0, 0.745, 0.455]} size={[2.1, 0.01, 0.01]} color={warna} opacity={0.9} />
      {/* panel samping + kaki perak + panel belakang + rak kabel */}
      {[-0.98, 0.98].map((x) => (
        <Box key={x} pos={[x, 0.37, 0]} size={[0.1, 0.72, 0.78]} color={FS_BIRU} />
      ))}
      {[-0.98, 0.98].map((x) => (
        <Box key={`k${x}`} pos={[x, 0.02, 0.0]} size={[0.12, 0.04, 0.8]} color={FS_PERAK} cast={false} />
      ))}
      <Box pos={[0, 0.45, -0.38]} size={[1.86, 0.5, 0.03]} color={FS_BIRU2} />
      <Box pos={[0, 0.66, -0.3]} size={[1.4, 0.04, 0.16]} color="#1E293B" cast={false} />
      {/* laci 3 tingkat di kolong kanan */}
      <group position={[0.58, 0, 0.0]}>
        <Box pos={[0, 0.37, 0]} size={[0.62, 0.7, 0.72]} color={FS_BIRU} />
        {[0.13, 0.37, 0.6].map((y) => (
          <React.Fragment key={y}>
            <Box pos={[0, y, 0.365]} size={[0.56, 0.2, 0.012]} color={FS_BIRU2} cast={false} />
            <Box pos={[0, y + 0.05, 0.38]} size={[0.2, 0.025, 0.02]} color={FS_PERAK} cast={false} />
          </React.Fragment>
        ))}
      </group>
      {/* 2 monitor (menyala saat AI duduk) */}
      <MonitorFS sd={-1} seatKey={seatKey} seed={seed} warna={warna} kata={FS_KATA[k]} />
      <MonitorFS sd={1} seatKey={seatKey} seed={seed + 5} warna={warna} kata={FS_KATA[k]} />
      {/* keyboard kaca + mouse + alas */}
      <Box pos={[0.0, 0.8285, 0.27]} size={[0.84, 0.004, 0.34]} color="#16233A" cast={false} />
      <Box pos={[-0.05, 0.834, 0.25]} size={[0.5, 0.012, 0.17]} color="#243A5C" cast={false} />
      {[0, 1, 2, 3].map((r) => (
        <Box key={r} pos={[-0.05, 0.8415, 0.19 + r * 0.04]} size={[0.46, 0.004, 0.026]} color={r === 3 ? '#BAE6FD' : '#7DA3C8'} cast={false} />
      ))}
      <Box pos={[-0.05, 0.8425, 0.3]} size={[0.3, 0.004, 0.02]} color="#BAE6FD" cast={false} />
      <Box pos={[0.3, 0.8335, 0.27]} size={[0.07, 0.016, 0.11]} color="#243A5C" cast={false} />
      <Cahaya pos={[0.3, 0.843, 0.25]} size={[0.012, 0.003, 0.03]} color={warna} />
      <Cahaya pos={[-0.05, 0.8295, 0.4]} size={[0.5, 0.002, 0.008]} color={warna} opacity={0.6} />
      {/* lampu meja + papan nama + barang khas */}
      <LampuMeja pos={[-0.86, Y, -0.22]} rotY={0.6} />
      <group position={[-0.28, 0, 0.0]}>
        <DeskPlate label={label} color={warna} />
      </group>
      <KitFS k={k} />
    </group>
  );
}

// Papan laporan di dinding: bingkai perak, kop navy, grafik batang + tren, baris tabel, nampan spidol, sticky notes.
function PapanLaporan({ pos, judul }: { pos: V3; judul: string }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.9, 0.95, 0.05]} color="#94A3B8" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[1.8, 0.85, 0.02]} color="#FAFCFE" cast={false} />
      <Box pos={[0, 0.34, 0.043]} size={[1.8, 0.17, 0.006]} color={FS_NAVY} cast={false} />
      <Teks pos={[0, 0.34, 0.048]} w={1.5} h={0.12} text={judul} fg="#E0F2FE" />
      {[0.12, 0.2, 0.3, 0.22, 0.36].map((h, i) => (
        <Box key={i} pos={[-0.62 + i * 0.12, -0.02 + h / 2 - 0.1, 0.046]} size={[0.08, h, 0.006]} color={['#38BDF8', '#34D399', '#38BDF8', '#34D399', '#2563EB'][i]} cast={false} />
      ))}
      {[[-0.62, 0.0], [-0.5, 0.08], [-0.38, 0.2], [-0.26, 0.12], [-0.14, 0.26]].slice(1).map(([x, y], i, a) => {
        const p = i === 0 ? [-0.62, 0.0] : a[i - 1];
        const dx = x - p[0], dy = y - p[1], l = Math.hypot(dx, dy);
        return <Box key={i} pos={[(x + p[0]) / 2, (y + p[1]) / 2 - 0.08, 0.052]} size={[l, 0.012, 0.004]} color="#F59E0B" rot={[0, 0, Math.atan2(dy, dx)]} cast={false} />;
      })}
      {[0, 1, 2, 3].map((r) => (
        <React.Fragment key={r}>
          <Box pos={[0.5, 0.17 - r * 0.1, 0.046]} size={[0.62, 0.012, 0.004]} color="#94A3B8" cast={false} />
          <Box pos={[0.28, 0.2 - r * 0.1, 0.046]} size={[0.14, 0.02, 0.004]} color={r === 3 ? '#34D399' : '#CBD5E1'} cast={false} />
        </React.Fragment>
      ))}
      <Box pos={[0.74, -0.3, 0.046]} size={[0.16, 0.14, 0.006]} color="#FDE68A" rot={[0, 0, 0.08]} cast={false} />
      <Box pos={[0.56, -0.32, 0.046]} size={[0.14, 0.12, 0.006]} color="#A7F3D0" rot={[0, 0, -0.06]} cast={false} />
      <Box pos={[0, -0.5, 0.06]} size={[1.2, 0.03, 0.09]} color="#94A3B8" cast={false} />
      {['#2563EB', '#DC2626', '#059669'].map((c, i) => (
        <Box key={c} pos={[-0.3 + i * 0.2, -0.47, 0.07]} size={[0.14, 0.02, 0.02]} color={c} cast={false} />
      ))}
    </group>
  );
}

// Stasiun cetak: meja, printer besar dengan panel LED + tray keluaran berisi laporan, rim kertas di lantai.
function StasiunCetak({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.7, 0]} size={[1.5, 0.06, 0.74]} color="#F7FAFC" />
      <Box pos={[0, 0.735, 0.37]} size={[1.5, 0.02, 0.01]} color="#38BDF8" cast={false} />
      {[-0.68, 0.68].map((x) => (
        <Box key={x} pos={[x, 0.34, 0]} size={[0.06, 0.68, 0.66]} color={FS_BIRU} />
      ))}
      <Box pos={[0, 0.36, -0.3]} size={[1.3, 0.6, 0.03]} color={FS_BIRU2} cast={false} />
      <Box pos={[0, 0.16, 0]} size={[1.3, 0.04, 0.5]} color={FS_BIRU} cast={false} />
      <Box pos={[-0.3, 0.06, 0.05]} size={[0.38, 0.12, 0.3]} color="#F8FAFC" />
      <Box pos={[-0.3, 0.07, 0.205]} size={[0.38, 0.03, 0.006]} color="#2563EB" cast={false} />
      <Box pos={[0.12, 0.06, 0.05]} size={[0.38, 0.12, 0.3]} color="#F8FAFC" />
      <Box pos={[0.12, 0.07, 0.205]} size={[0.38, 0.03, 0.006]} color="#2563EB" cast={false} />
      <Box pos={[0, 0.9, -0.05]} size={[0.8, 0.34, 0.5]} color="#E5EDF4" />
      <Box pos={[0, 1.085, -0.05]} size={[0.82, 0.04, 0.52]} color="#94A3B8" cast={false} />
      <Box pos={[0, 0.9, 0.205]} size={[0.62, 0.05, 0.01]} color="#1E293B" cast={false} />
      <Box pos={[0.26, 0.97, 0.21]} size={[0.2, 0.1, 0.02]} color="#0F172A" cast={false} />
      <Cahaya pos={[0.26, 0.975, 0.222]} size={[0.16, 0.06, 0.004]} color="#67E8F9" />
      <Cahaya pos={[-0.3, 0.99, 0.212]} size={[0.025, 0.025, 0.004]} color="#4ADE80" />
      <Box pos={[0, 0.79, 0.28]} size={[0.5, 0.012, 0.28]} color="#F8FAFC" rot={[-0.18, 0, 0]} cast={false} />
      {[0, 1, 2].map((r) => (
        <Box key={r} pos={[0, 0.805, 0.22 + r * 0.05]} size={[0.38, 0.003, 0.008]} color="#94A3B8" rot={[-0.18, 0, 0]} cast={false} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} pos={[0.62 - 0.03, 0.735 + i * 0.012, 0.1]} size={[0.22, 0.011, 0.3]} color="#FFFFFF" rot={[0, (i - 2) * 0.05, 0]} cast={false} />
      ))}
      <Box pos={[0.59, 0.797, 0.1]} size={[0.22, 0.004, 0.04]} color="#2563EB" cast={false} />
      <Kolam pos={[0, 0.02, 0.5]} size={[2.2, 1.6]} color="#38BDF8" opacity={0.1} />
    </group>
  );
}

// Menara laporan hologram (pusat sisi timur): dais navy, pilar, 4 lembar laporan melayang berputar, cincin orbit, grafik batang.
function MenaraLaporan({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[3.2, 3.2]} color="#38BDF8" opacity={0.2} />
      <CincinLantai pos={[0, 0.02, 0]} r={0.95} lebar={0.04} color="#38BDF8" opacity={0.9} />
      <CincinLantai pos={[0, 0.02, 0]} r={0.7} lebar={0.025} color="#A78BFA" opacity={0.8} />
      <Tube pos={[0, 0.04, 0]} r={0.62} h={0.08} color={FS_NAVY} seg={32} />
      <Tube pos={[0, 0.1, 0]} r={0.5} h={0.04} color="#2B5A87" seg={32} cast={false} />
      <Tube pos={[0, 0.34, 0]} r={0.1} rb={0.16} h={0.44} color={FS_BIRU} seg={20} />
      <TabungCahaya pos={[0, 0.6, 0]} r={0.12} h={0.03} color="#67E8F9" seg={20} />
      <TabungCahaya pos={[0, 1.15, 0]} r={0.32} rb={0.1} h={1.0} color="#67E8F9" opacity={0.1} seg={20} />
      <Putar pos={[0, 1.0, 0]} speed={0.7}>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} position={[Math.sin((i * Math.PI) / 2) * 0.32, 0.12 * i - 0.1, Math.cos((i * Math.PI) / 2) * 0.32]} rotation={[0, (i * Math.PI) / 2, 0]}>
            <Box pos={[0, 0, 0]} size={[0.34, 0.2, 0.012]} color="#F8FAFC" cast={false} />
            <Cahaya pos={[0, 0.075, 0.008]} size={[0.3, 0.04, 0.004]} color={['#38BDF8', '#34D399', '#2DD4BF', '#A78BFA'][i]} />
            {[0, 1, 2].map((r) => (
              <Box key={r} pos={[0, 0.02 - r * 0.045, 0.008]} size={[0.26, 0.012, 0.003]} color="#94A3B8" cast={false} />
            ))}
          </group>
        ))}
      </Putar>
      <Putar pos={[0, 1.0, 0]} speed={-0.9}>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.55, 0.008, 8, 48]} />
          <meshBasicMaterial color="#A78BFA" toneMapped={false} />
        </mesh>
      </Putar>
      {[0.12, 0.2, 0.3].map((h, i) => (
        <Cahaya key={i} pos={[-0.12 + i * 0.12, 0.12 + h / 2, 0.45]} size={[0.07, h, 0.07]} color={['#38BDF8', '#34D399', '#A78BFA'][i]} />
      ))}
      <Teks pos={[0, 0.34, 0.172]} w={0.34} h={0.07} text="REPORTS" fg="#BAE6FD" />
    </group>
  );
}

// ---- [BARU] Desain lantai & dinding Financial Statements: kantor modern biru-krem-perak (porselen, karpet modular, panel slat, kertas dinding motif grafik) ----
// Lantai porselen besar krem: ubin 1.5 x 1.5 bervariasi tipis + urat marmer halus + sambungan + sorot tepi (tekstur 3 x 3 unit diulang).
function LantaiFS({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const dasar = useKanvasMg(1024, 1024, (g) => {
    const r = mulberry32(77);
    const warna = ['#F3EEE1', '#EFE8D8', '#F1EBDD', '#F4EFE4'];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x = i * 512, y = j * 512;
        g.fillStyle = warna[(i * 2 + j + (i ? 1 : 0)) % 4];
        g.fillRect(x, y, 512, 512);
        g.save();
        g.beginPath();
        g.rect(x, y, 512, 512);
        g.clip();
        for (let k = 0; k < 5; k++) {
          g.strokeStyle = `rgba(185,170,140,${0.12 + r() * 0.12})`;
          g.lineWidth = 1 + r() * 2.2;
          g.beginPath();
          const sx = x + r() * 512, sy = y + r() * 512;
          g.moveTo(sx, sy);
          g.bezierCurveTo(sx + (r() - 0.5) * 260, sy + (r() - 0.5) * 260, sx + (r() - 0.5) * 380, sy + (r() - 0.5) * 380, sx + (r() - 0.5) * 460, sy + (r() - 0.5) * 460);
          g.stroke();
        }
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(150,135,105,${0.03 + r() * 0.05})`;
          g.fillRect(x + r() * 512, y + r() * 512, 2 + r() * 3, 2 + r() * 3);
        }
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.38)';
        g.fillRect(x + 2, y + 2, 508, 2);
        g.fillRect(x + 2, y + 2, 2, 508);
        g.fillStyle = 'rgba(120,105,75,0.14)';
        g.fillRect(x + 2, y + 508, 508, 2);
        g.fillRect(x + 508, y + 2, 2, 508);
      }
    }
    g.fillStyle = '#D6CCB6';
    for (const o of [0, 512, 1022]) {
      g.fillRect(o - 1, 0, 3, 1024);
      g.fillRect(0, o - 1, 1024, 3);
    }
  }, 'fs-lantai-porselen');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 3, d / 3);
    t.needsUpdate = true;
    return t;
  }, [dasar, w, d]);
  return (
    <mesh position={[cx, 0.002, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Karpet modular (ubin 0.5 x 0.5 dua nada + serat halus). 1 unit = 2 x 2 ubin.
function KarpetModular({ pos, w, d, a, b, kunci }: { pos: V3; w: number; d: number; a: string; b: string; kunci: string }) {
  const dasar = useKanvasMg(256, 256, (g) => {
    const r = mulberry32(kunci.length * 31 + 5);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? b : a;
        g.fillRect(i * 128, j * 128, 128, 128);
      }
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(30,58,95,0.07)' : 'rgba(255,255,255,0.10)';
      g.fillRect(r() * 256, r() * 256, 1.5, 1.5 + r() * 2);
    }
    g.fillStyle = 'rgba(30,58,95,0.16)';
    for (const o of [0, 128, 255]) {
      g.fillRect(o - 0.5, 0, 1.2, 256);
      g.fillRect(0, o - 0.5, 256, 1.2);
    }
  }, `fs-karpet-${kunci}`);
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w, d);
    t.needsUpdate = true;
    return t;
  }, [dasar, w, d]);
  return (
    <mesh position={pos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Kertas dinding Financial Statements: biru muda berpinstripe halus + motif grafik batang / garis tren / donat (tile 2.0 x 0.6).
function KertasDindingFS({ pos, w, h = 0.6 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(640, 192, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#DCEAF4');
    gr.addColorStop(1, '#C9DDEC');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    for (let y = 4; y < H; y += 8) g.fillRect(0, y, W, 1);
    g.strokeStyle = 'rgba(30,58,95,0.07)';
    g.lineWidth = 1;
    g.setLineDash([6, 6]);
    for (const y of [50, 90, 130]) { g.beginPath(); g.moveTo(20, y); g.lineTo(420, y); g.stroke(); }
    g.setLineDash([]);
    const tinggi = [30, 46, 38, 62, 54, 80, 70, 96, 88];
    g.fillStyle = 'rgba(30,58,95,0.10)';
    tinggi.forEach((t, i) => g.fillRect(40 + i * 40, 160 - t, 22, t));
    g.strokeStyle = 'rgba(37,99,235,0.26)';
    g.lineWidth = 2;
    g.beginPath();
    tinggi.forEach((t, i) => { const x = 51 + i * 40, y = 160 - t - 12; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
    g.stroke();
    g.fillStyle = 'rgba(37,99,235,0.35)';
    tinggi.forEach((t, i) => { g.beginPath(); g.arc(51 + i * 40, 160 - t - 12, 3, 0, Math.PI * 2); g.fill(); });
    g.strokeStyle = 'rgba(30,58,95,0.12)';
    g.beginPath(); g.moveTo(30, 160); g.lineTo(420, 160); g.stroke();
    // donat
    const cx = 520, cy = 96;
    g.lineWidth = 16;
    const bagi = [[0, 1.9, 'rgba(30,58,95,0.14)'], [1.9, 3.6, 'rgba(37,99,235,0.16)'], [3.6, 6.28, 'rgba(52,211,153,0.20)']] as [number, number, string][];
    bagi.forEach(([a0, a1, c]) => { g.strokeStyle = c; g.beginPath(); g.arc(cx, cy, 38, a0, a1 - 0.06); g.stroke(); });
  }, 'fs-kertas-dinding');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w / 2), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Panel slat vertikal (felt akustik biru baja, celah gelap, sorot tepi). Tile 1.0 x 0.78.
function PanelSlatFS({ pos, w, h = 0.78 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 200, (g, W, H) => {
    const r = mulberry32(19);
    g.fillStyle = '#1B3550';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i++) {
      const x = i * 32 + 2;
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#5283AD');
      gr.addColorStop(1, '#3F6C93');
      g.fillStyle = gr;
      g.fillRect(x, 0, 28, H);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x, 0, 2, H);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(x + 26, 0, 2, H);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + 4 + r() * 20, r() * H, 1, 10 + r() * 40);
      }
    }
  }, 'fs-slat');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias dinding Financial Statements (menghadap +z lokal, x sepanjang dinding): lis bawah aluminium + navy, panel slat (kecuali di
// bawah papan dinding), rel aluminium + LED putih-biru, kertas dinding motif grafik, list atas navy + LED tipis.
function DindingDekorFS({ s, segs, slat }: { s: number; segs: [number, number][]; slat: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        return (
          <React.Fragment key={`d${a}`}>
            <Box pos={[cx, 0.45, s + 0.006]} size={[L, 0.8, 0.012]} color="#2A4E73" cast={false} />
            <Box pos={[cx, 0.045, s + 0.017]} size={[L, 0.09, 0.034]} color={FS_NAVY} cast={false} />
            <Box pos={[cx, 0.096, s + 0.02]} size={[L, 0.012, 0.04]} color={FS_PERAK} cast={false} />
            <Box pos={[cx, 0.9, s + 0.022]} size={[L, 0.03, 0.044]} color={FS_PERAK} cast={false} />
            <Cahaya pos={[cx, 0.878, s + 0.02]} size={[L - 0.02, 0.008, 0.004]} color="#BAE6FD" opacity={0.85} />
            <KertasDindingFS pos={[cx, 1.215, s + 0.002]} w={L} />
            <Box pos={[cx, 1.54, s + 0.02]} size={[L, 0.05, 0.04]} color={FS_NAVY} cast={false} />
            <Cahaya pos={[cx, 1.572, s + 0.012]} size={[L - 0.02, 0.008, 0.008]} color="#E0F2FE" opacity={0.9} />
          </React.Fragment>
        );
      })}
      {slat.map(([a, b]) => (
        <PanelSlatFS key={`s${a}`} pos={[(a + b) / 2, 0.5, s + 0.015]} w={b - a} />
      ))}
    </>
  );
}

// Tiang sudut: kolom navy berlis aluminium (tinggi dinding).
function TiangSudutFS({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.8, 0]} size={[0.22, 1.6, 0.22]} color={FS_NAVY} />
      <Box pos={[0, 0.8, 0]} size={[0.24, 1.6, 0.03]} color={FS_PERAK} cast={false} />
      <Box pos={[0, 0.8, 0]} size={[0.03, 1.6, 0.24]} color={FS_PERAK} cast={false} />
      <Box pos={[0, 0.03, 0]} size={[0.26, 0.06, 0.26]} color="#0F2540" cast={false} />
      <Cahaya pos={[0, 1.57, 0]} size={[0.2, 0.012, 0.2]} color="#E0F2FE" opacity={0.9} />
    </group>
  );
}

// Kotak colokan lantai (flush, aluminium) di dekat meja kerja.
function KotakColokanFS({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.006, 0]} size={[0.24, 0.012, 0.24]} color={FS_PERAK} cast={false} />
      <Box pos={[0, 0.0135, 0]} size={[0.18, 0.004, 0.18]} color="#9FB0BE" cast={false} />
      <Box pos={[0.05, 0.0165, 0]} size={[0.05, 0.002, 0.025]} color="#38BDF8" cast={false} />
    </group>
  );
}

const STUDIO = { cx: 18.4, cz: 0, w: 13, d: 8 };
const STUDIO_ISI_CX = 16.4;
function StudioArea() {
  const { cx, cz, w, d } = STUDIO;
  const z0 = cz - d / 2;
  const meja = [
    { p: [13.0, -2.6] as [number, number], h: HALAMAN_FS[0], seed: 301 },
    { p: [16.0, -2.6] as [number, number], h: HALAMAN_FS[1], seed: 317 },
    { p: [13.4, 0.8] as [number, number], h: HALAMAN_FS[2], seed: 333 },
    { p: [16.4, 0.8] as [number, number], h: HALAMAN_FS[3], seed: 349 },
    { p: [19.7, 0.8] as [number, number], h: HALAMAN_FS[4], seed: 365 },
  ];
  return (
    <>
      <Lantai cx={cx} cz={cz} w={w} d={d} color={TH.studio.floor} />
      {/* [DIPERDETAIL] lantai porselen krem bertekstur + karpet modular biru (dua zona) */}
      <LantaiFS cx={cx} cz={cz} w={w} d={d} />
      <Box pos={[STUDIO_ISI_CX, 0.005, 0.2]} size={[7.4, 0.015, 5.2]} color="#CFE3F1" cast={false} />
      <Box pos={[22.6, 0.005, 0.2]} size={[3.6, 0.015, 5.2]} color="#D8E9F5" cast={false} />
      <KarpetModular pos={[STUDIO_ISI_CX, 0.0132, 0.2]} w={7.4} d={5.2} a="#BDD7EA" b="#C9DFEF" kunci="zona1" />
      <KarpetModular pos={[22.6, 0.0132, 0.2]} w={3.6} d={5.2} a="#CADFF0" b="#D6E8F5" kunci="zona2" />
      {/* bingkai inlay karpet: biru + perak */}
      {[-2.5, 2.9].map((z) => (
        <React.Fragment key={z}>
          <Box pos={[STUDIO_ISI_CX, 0.014, z]} size={[7.4, 0.01, 0.05]} color="#38BDF8" cast={false} />
          <Box pos={[22.6, 0.014, z]} size={[3.6, 0.01, 0.05]} color={FS_PERAK} cast={false} />
        </React.Fragment>
      ))}
      {/* [BARU] bingkai inlay keliling lantai (navy + perak), garis penuntun dari pintu ke medali, ambang aluminium pintu */}
      {[-3.65, 3.65].map((z) => (
        <React.Fragment key={`bz${z}`}>
          <Box pos={[18.48, 0.0035, z]} size={[12.25, 0.004, 0.07]} color={FS_NAVY} cast={false} />
          <Box pos={[18.48, 0.0038, z + (z < 0 ? 0.07 : -0.07)]} size={[12.25, 0.004, 0.02]} color={FS_PERAK} cast={false} />
        </React.Fragment>
      ))}
      {[12.35, 24.6].map((x) => (
        <React.Fragment key={`bx${x}`}>
          <Box pos={[x, 0.0035, 0]} size={[0.07, 0.004, 7.3]} color={FS_NAVY} cast={false} />
          <Box pos={[x + (x < 18 ? 0.07 : -0.07), 0.0038, 0]} size={[0.02, 0.004, 7.3]} color={FS_PERAK} cast={false} />
        </React.Fragment>
      ))}
      {[18.1, 19.1].map((x) => (
        <Box key={`gl${x}`} pos={[x, 0.0038, -3.05]} size={[0.025, 0.004, 1.2]} color={FS_PERAK} cast={false} />
      ))}
      <Box pos={[18.6, 0.007, -3.93]} size={[2.0, 0.014, 0.12]} color={FS_PERAK} cast={false} />
      <Box pos={[18.6, 0.0145, -3.93]} size={[1.9, 0.002, 0.03]} color={FS_NAVY} cast={false} />
      {/* medali lantai tengah */}
      <CincinLantai pos={[18.6, 0.02, -1.25]} r={0.95} lebar={0.045} color="#38BDF8" opacity={0.95} />
      <CincinLantai pos={[18.6, 0.02, -1.25]} r={0.72} lebar={0.025} color={FS_NAVY} opacity={0.9} />
      <Tube pos={[18.6, 0.012, -1.25]} r={0.7} h={0.012} color="#EAF3FA" seg={40} cast={false} />
      <CincinLantai pos={[18.6, 0.02, -1.25]} r={1.2} lebar={0.018} color={FS_PERAK} opacity={0.95} />
      {[[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].map(([dx, dz]) => (
        <Box key={`dm${dx}${dz}`} pos={[18.6 + dx, 0.022, -1.25 + dz]} size={[0.12, 0.006, 0.12]} color={FS_NAVY} rot={[0, Math.PI / 4, 0]} cast={false} />
      ))}
      <Teks pos={[18.6, 0.026, -1.35]} rot={[-Math.PI / 2, 0, 0]} w={1.15} h={0.22} text="FINANCIAL" fg={FS_NAVY} />
      <Teks pos={[18.6, 0.026, -1.12]} rot={[-Math.PI / 2, 0, 0]} w={1.15} h={0.2} text="STATEMENTS" fg="#2B5A87" />
      {/* papan laporan di dinding */}
      <PapanLaporan pos={[14.6, 1.0, z0 + 0.04]} judul="LAPORAN KEUANGAN" />
      {/* papan nama ruangan (gaya sama dengan ruang Asset) di sela lemari; papan "PERIODE BERJALAN" diganti */}
      <Box pos={[22.4, 1.1, z0 + 0.03]} size={[2.1, 0.3, 0.04]} color="#F8F9FB" cast={false} />
      <Box pos={[22.4, 1.1, z0 + 0.052]} size={[2.0, 0.24, 0.006]} color={FS_NAVY} cast={false} />
      <Teks pos={[22.4, 1.1, z0 + 0.058]} w={1.9} h={0.2} text="FINANCIAL STATEMENTS" fg="#E0F2FE" />
      <Box pos={[22.4, 0.95, z0 + 0.052]} size={[2.0, 0.012, 0.006]} color="#38BDF8" cast={false} />
      {/* AC split di dinding utara, antara papan laporan dan pintu, + pipa kondensat ke lantai */}
      <WallAC pos={[16.5, 1.3, z0 + 0.05]} />
      <Box pos={[17.24, 0.72, z0 + 0.06]} size={[0.04, 0.84, 0.04]} color="#E5E7EB" cast={false} />
      <Box pos={[17.24, 0.3, z0 + 0.075]} size={[0.07, 0.03, 0.07]} color="#9CA3AF" cast={false} />
      {/* 5 meja = 5 halaman Financial Statements */}
      {meja.map(({ p: [x, z], h, seed }) => (
        <React.Fragment key={h.id}>
          <MejaFS pos={[x, 0, z]} k={h.kunci} label={h.nama} warna={h.warna} seatKey={h.seat} seed={seed} />
          <Chair pos={[x, 0, z + 0.85]} color="#5B9BD5" />
        </React.Fragment>
      ))}
      <Cabinet pos={[12.7, 0, z0 + 0.5]} color="#F1EBDD" />
      <Cabinet pos={[20.2, 0, z0 + 0.5]} />
      <FloorLamp pos={[24.5, 0, 3.2]} />
      <PlantPalm pos={[24.4, 0, 2.0]} scale={1.0} />
      {/* bentangan timur: stasiun cetak + menara laporan hologram (menggantikan meja kosong) */}
      <Cabinet pos={[24.4, 0, z0 + 0.5]} />
      <StasiunCetak pos={[22.4, 0, -2.2]} />
      <MenaraLaporan pos={[22.7, 0, 1.0]} />
      <PlantSnake pos={[24.5, 0, -1.2]} scale={0.9} />
      <PlantSnake pos={[12.3, 0, 3.2]} scale={1.0} />
      <DekorDindingKiri pos={[12.04, 0, 0.05]} jenis="fs" />
      {/* [BARU] lapisan hias dinding utara (kecuali celah pintu x 17.6-19.6) & barat; panel slat dikosongkan di bawah papan laporan */}
      <DindingDekorFS s={z0} segs={[[12.0, 17.54], [19.66, 24.9]]} slat={[[12.0, 13.6], [15.6, 17.54], [19.66, 24.9]]} />
      <group rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorFS s={12.0} segs={[[-4, 4]]} slat={[[-4, -2.75], [-1.05, 4]]} />
      </group>
      <TiangSudutFS pos={[12.11, 0, z0 + 0.11]} />
      <TiangSudutFS pos={[24.79, 0, z0 + 0.11]} />
      <TiangSudutFS pos={[12.11, 0, 3.89]} />
      {meja.map(({ p: [x, z], h }) => (
        <KotakColokanFS key={`kc${h.id}`} pos={[x - 0.8, 0, z + 0.5]} />
      ))}
      <StudioPenghuni />
    </>
  );
}

// ---- [BARU] Dekorasi dinding kiri (penuh) ruangan baris tengah: Santai, Asset, Financial Statements ----------------------------
// Grup diputar 90° supaya x lokal = sepanjang dinding (ke arah -z dunia) dan z lokal = keluar dari dinding ke dalam ruangan.
// Jam dinding = komponen <Clock /> yang sama dengan semua ruangan lain (waktu nyata WIB).
function DekorDindingKiri({ pos, jenis }: { pos: V3; jenis: 'santai' | 'aset' | 'fs' }) {
  return (
    <group position={pos} rotation={[0, Math.PI / 2, 0]}>
      <Clock pos={[jenis === 'fs' ? 1.0 : jenis === 'aset' ? 0.2 : 0, 1.15, 0.0]} />
      {jenis === 'santai' && (
        <>
          {/* lukisan matahari terbenam + ombak */}
          <Box pos={[-2.1, 1.0, 0.0]} size={[1.1, 0.7, 0.05]} color="#F8F9FB" cast={false} />
          <Box pos={[-2.1, 1.0, 0.03]} size={[0.98, 0.58, 0.02]} color="#FDE9DC" cast={false} />
          <Tube pos={[-2.0, 1.1, 0.045]} r={0.14} h={0.01} color="#F4A88A" rot={[Math.PI / 2, 0, 0]} seg={20} cast={false} />
          <Box pos={[-2.1, 0.86, 0.045]} size={[0.98, 0.1, 0.006]} color="#7FC8C0" cast={false} />
          <Box pos={[-2.1, 0.78, 0.047]} size={[0.98, 0.07, 0.006]} color="#3FA796" cast={false} />
          {/* papan sapaan + rak kecil dengan tanaman, buku, dan cangkir */}
          <Box pos={[2.1, 1.2, 0.0]} size={[1.58, 0.36, 0.04]} color="#F8F9FB" cast={false} />
          <Teks pos={[2.1, 1.2, 0.03]} w={1.5} h={0.28} text="RELAX & RECHARGE" fg="#FFFFFF" bg="#F4A88A" />
          <Box pos={[2.1, 0.8, 0.1]} size={[1.3, 0.04, 0.2]} color="#FFFFFF" cast={false} />
          <Succulent pos={[1.65, 0.82, 0.1]} scale={0.6} />
          <Box pos={[2.1, 0.86, 0.1]} size={[0.3, 0.07, 0.16]} color="#4C5FA8" cast={false} />
          <Box pos={[2.1, 0.93, 0.1]} size={[0.26, 0.06, 0.14]} color="#E0713F" cast={false} />
          <Mug pos={[2.5, 0.82, 0.1]} color="#FDE68A" />
        </>
      )}
      {jenis === 'aset' && (
        <>
          {/* papan daftar aset: kop cokelat, grafik batang emas, baris tabel */}
          <Box pos={[-2.1, 1.0, 0.0]} size={[1.7, 0.9, 0.05]} color="#F8F9FB" cast={false} />
          <Box pos={[-2.1, 1.0, 0.03]} size={[1.6, 0.8, 0.02]} color="#FFFDF6" cast={false} />
          <Box pos={[-2.1, 1.3, 0.043]} size={[1.6, 0.18, 0.006]} color="#8F5A2C" cast={false} />
          <Teks pos={[-2.1, 1.3, 0.048]} w={1.4} h={0.12} text="ASSET REGISTER" fg="#FFF6E4" />
          {[0.14, 0.22, 0.3, 0.38, 0.46].map((h, i) => (
            <Box key={i} pos={[-2.65 + i * 0.12, 0.84 + h / 2, 0.046]} size={[0.08, h, 0.006]} color={i % 2 ? '#B8860B' : '#E8B93A'} cast={false} />
          ))}
          {[0, 1, 2, 3].map((r) => (
            <Box key={r} pos={[-1.75, 1.14 - r * 0.1, 0.046]} size={[0.62, 0.012, 0.004]} color="#D9C7A3" cast={false} />
          ))}
          {/* papan nama: sejajar tinggi jam (y 1.15), koin Rp dihapus */}
          <Box pos={[2.0, 1.15, 0.0]} size={[1.36, 0.26, 0.04]} color="#F8F9FB" cast={false} />
          <Teks pos={[2.0, 1.15, 0.03]} w={1.3} h={0.2} text="ASSETS & EQUITY" fg="#FFF6E4" bg="#8F5A2C" />
          {/* papan kunci aset (sudut selatan dinding) */}
          <Box pos={[-3.45, 1.3, 0.0]} size={[0.62, 0.46, 0.04]} color="#5A3D20" cast={false} />
          <Box pos={[-3.45, 1.3, 0.025]} size={[0.56, 0.4, 0.012]} color="#7B4B24" cast={false} />
          <Teks pos={[-3.45, 1.46, 0.034]} w={0.5} h={0.08} text="KUNCI ASET" fg="#FFF6E4" />
          {[-0.2, -0.067, 0.067, 0.2].map((x) => (
            <React.Fragment key={x}>
              <Box pos={[-3.45 + x, 1.34, 0.036]} size={[0.014, 0.014, 0.02]} color={EMAS} cast={false} />
              <Box pos={[-3.45 + x, 1.27, 0.04]} size={[0.045, 0.1, 0.008]} color="#E8B93A" cast={false} />
              <Tube pos={[-3.45 + x, 1.33, 0.04]} r={0.02} h={0.008} color="#B8860B" rot={[Math.PI / 2, 0, 0]} seg={10} cast={false} />
            </React.Fragment>
          ))}
        </>
      )}
      {jenis === 'fs' && (
        <group position={[-1.9, 1.0, 0.0]} scale={0.85}>
          <PapanLaporan pos={[0, 0, 0]} judul="LABA RUGI" />
        </group>
      )}
    </group>
  );
}

// ---- Ruang santai (lounge) — krem hangat, peach ----
const SANTAI = { cx: 3.0, cz: 12.9, w: 10, d: 8 };
function SantaiArea() {
  const z0 = 8.9;
  return (
    <>
      <Lantai {...SANTAI} color={TH.santai.floor} />
      <Tube pos={[3.0, 0.01, 13.2]} r={2.6} h={0.02} color="#F4A88A" seg={40} cast={false} />
      <Tube pos={[3.0, 0.02, 13.2]} r={1.9} h={0.02} color="#FBD3BF" seg={40} cast={false} />
      <DekorDindingKiri pos={[-1.96, 0, 12.95]} jenis="santai" />
      <TVWall pos={[-0.3, 1.0, z0 + 0.05]} />
      <Box pos={[-0.3, 0.25, z0 + 0.3]} size={[2.0, 0.5, 0.45]} color="#C99863" />
      <Sofa pos={[3.0, 0, 15.9]} rotY={0} color={C.sofaOrange} />
      <Sofa pos={[6.3, 0, 15.9]} rotY={0} color="#3FA796" />
      <CoffeeTable pos={[3.0, 0, 13.0]} />
      <Mug pos={[3.2, 0.43, 13.0]} color="#FDE68A" steam seed={4} />
      <Beanbag pos={[0.2, 0, 15.2]} color="#F9C74F" />
      <Beanbag pos={[1.4, 0, 10.6]} color="#90BE6D" s={0.9} />
      <FloorLamp pos={[-1.2, 0, 16.2]} />
      <FloorLamp pos={[4.7, 0, 16.3]} />
      <PlantPalm pos={[7.4, 0, 9.8]} scale={1.0} />
      <PlantBush pos={[0.9, 0, 10.0]} scale={0.8} />
      <PlantSnake pos={[0.0, 0, 16.3]} scale={0.9} />
    </>
  );
}

// ---- Perpustakaan / Research → PUSAT INFORMASI (futuristik) ----
// Koordinat lokal PerpusArea: x -16.4..-5.3, z 8.9..16.9. Pintu di x = -8.9 (utara & selatan).
// Jalur agen (JANGAN diblokir): kolom x -7.4..-6.0 untuk z 10.4..15.4, lorong pintu x -9.6..-8.2 (z 8.9..10.9 & 15.0..16.9).
// Meja riset + 3 kursi + 3 AI (Nova, Aria, Echo) tetap di posisi lama. Semua isi lain adalah dekorasi desain (belum terhubung backend).
const PERPUS = { cx: -8.9, cz: 12.9, w: 7, d: 8 };
const HUB = {
  cyan: '#67E8F9',
  violet: '#A78BFA',
  mint: '#6EE7B7',
  pink: '#F0ABFC',
  amber: '#FCD34D',
  navy: '#1B1740',
  navy2: '#2A2560',
  putih: '#EDE9FE',
};

// Tabung / silinder bercahaya (tidak terpengaruh lampu).
function TabungCahaya({ pos, r, rb, h, color, opacity = 1, seg = 24, rot }: { pos: V3; r: number; rb?: number; h: number; color: string; opacity?: number; seg?: number; rot?: V3 }) {
  return (
    <mesh position={pos} rotation={rot}>
      <cylinderGeometry args={[r, rb ?? r, h, seg]} />
      <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} toneMapped={false} />
    </mesh>
  );
}

// Cincin datar bercahaya di lantai.
function CincinLantai({ pos, r, lebar = 0.04, color, opacity = 1 }: { pos: V3; r: number; lebar?: number; color: string; opacity?: number }) {
  return (
    <mesh position={pos} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[r - lebar, r, 72]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// Cincin putus-putus yang berputar pelan (di lantai).
function CincinPutus({ pos, r, n = 20, speed = 0.3, color, panjang = 0.3, lebar = 0.05 }: { pos: V3; r: number; n?: number; speed?: number; color: string; panjang?: number; lebar?: number }) {
  return (
    <Putar pos={pos} speed={speed}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i * 2 * Math.PI) / n;
        return (
          <mesh key={i} position={[Math.sin(a) * r, 0, Math.cos(a) * r]} rotation={[0, a, 0]}>
            <boxGeometry args={[panjang, 0.006, lebar]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        );
      })}
    </Putar>
  );
}

// Jejak sirkuit di lantai (garis bercahaya + titik simpul).
function Jejak({ pts, color = HUB.cyan, lebar = 0.035, opacity = 0.85 }: { pts: [number, number][]; color?: string; lebar?: number; opacity?: number }) {
  return (
    <>
      {pts.slice(1).map((p, i) => {
        const a = pts[i];
        const dx = p[0] - a[0];
        const dz = p[1] - a[1];
        const len = Math.hypot(dx, dz);
        return (
          <mesh key={i} position={[(a[0] + p[0]) / 2, 0.01, (a[1] + p[1]) / 2]} rotation={[0, Math.atan2(dx, dz), 0]}>
            <boxGeometry args={[lebar, 0.006, len]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
          </mesh>
        );
      })}
      {pts.map((p, i) => (
        <mesh key={`n${i}`} position={[p[0], 0.012, p[1]]}>
          <boxGeometry args={[lebar * 3, 0.008, lebar * 3]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// Denyut cahaya yang berjalan di sepanjang jejak (aliran data).
function DenyutJejak({ pts, kecepatan = 1.1, color = '#FFFFFF', n = 2 }: { pts: [number, number][]; kecepatan?: number; color?: string; n?: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const { segs, total } = useMemo(() => {
    const segs = pts.slice(1).map((p, i) => {
      const a = pts[i];
      const dx = p[0] - a[0];
      const dz = p[1] - a[1];
      const len = Math.hypot(dx, dz);
      return { ax: a[0], az: a[1], ux: dx / len, uz: dz / len, len, rot: Math.atan2(dx, dz) };
    });
    return { segs, total: segs.reduce((s, x) => s + x.len, 0) };
  }, [pts]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((m, k) => {
      if (!m) return;
      let d = (t * kecepatan + (k * total) / n) % total;
      for (const s of segs) {
        if (d <= s.len) {
          m.position.set(s.ax + s.ux * d, 0.018, s.az + s.uz * d);
          m.rotation.y = s.rot;
          break;
        }
        d -= s.len;
      }
    });
  });
  return (
    <>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} ref={(m) => { refs.current[k] = m; }}>
          <boxGeometry args={[0.075, 0.01, 0.3]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// Lampu penuntun di lantai (kedip berurutan) — untuk lorong pintu masuk.
function LampuJalur({ titik, color = HUB.cyan }: { titik: [number, number][]; color?: string }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mats.current.forEach((m, i) => {
      if (m) m.opacity = 0.2 + 0.8 * Math.max(0, Math.sin(t * 3.2 - Math.floor(i / 2) * 0.9));
    });
  });
  return (
    <>
      {titik.map((p, i) => (
        <mesh key={i} position={[p[0], 0.011, p[1]]}>
          <boxGeometry args={[0.05, 0.006, 0.22]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} color={color} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// Layar berisi canvas yang digambar ulang beberapa kali per detik (video wall, kiosk, peta jaringan).
type GambarFn = (g: CanvasRenderingContext2D, W: number, H: number, t: number) => void;
function LayarCanvas({ pos, rotY = 0, w, h, px = 512, draw, fps = 4, rim = HUB.cyan }: { pos: V3; rotY?: number; w: number; h: number; px?: number; draw: GambarFn; fps?: number; rim?: string }) {
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round((px * h) / w);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { canvas, tex };
  }, [px, w, h]);
  const acc = useRef(10);
  const gambar = (t: number) => {
    const g = canvas.getContext('2d');
    if (!g) return;
    draw(g, canvas.width, canvas.height, t);
    tex.needsUpdate = true;
  };
  useEffect(() => gambar(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((s, dt) => {
    acc.current += dt;
    if (acc.current > 1 / fps) {
      acc.current = 0;
      gambar(s.clock.elapsedTime);
    }
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[w + 0.1, h + 0.1, 0.06]} color={HUB.navy} cast={false} />
      <Cahaya pos={[0, h / 2 + 0.05, 0.02]} size={[w + 0.1, 0.014, 0.02]} color={rim} />
      <Cahaya pos={[0, -h / 2 - 0.05, 0.02]} size={[w + 0.1, 0.014, 0.02]} color={rim} />
      <Cahaya pos={[-w / 2 - 0.05, 0, 0.02]} size={[0.014, h + 0.1, 0.02]} color={rim} opacity={0.7} />
      <Cahaya pos={[w / 2 + 0.05, 0, 0.02]} size={[0.014, h + 0.1, 0.02]} color={rim} opacity={0.7} />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

const FONT = 'Inter, system-ui, sans-serif';
function jamWIB() {
  const now = new Date();
  const w = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(w.getHours())}:${p(w.getMinutes())}:${p(w.getSeconds())}`;
}

// Isi video wall utama (data contoh/desain, belum dari backend).
const gambarInfo: GambarFn = (g, W, H, t) => {
  g.fillStyle = '#0B0A24';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(103,232,249,0.07)';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = 'rgba(167,139,250,0.2)';
  g.fillRect(0, 0, W, 48);
  g.textBaseline = 'middle';
  g.fillStyle = '#EDE9FE';
  g.font = `800 24px ${FONT}`;
  g.textAlign = 'left';
  g.fillText('PUSAT INFORMASI', 24, 25);
  g.fillStyle = '#6EE7B7';
  g.font = `700 13px ${FONT}`;
  g.fillText('● ONLINE', 250, 25);
  g.textAlign = 'right';
  g.fillStyle = '#67E8F9';
  g.font = `700 22px ${FONT}`;
  g.fillText(`${jamWIB()} WIB`, W - 24, 25);
  g.textAlign = 'left';
  // kiri: 3 KPI
  const kpi: [string, string, string][] = [
    ['Dokumen terindeks', '12.480', '#67E8F9'],
    ['Panduan aplikasi', '86', '#A78BFA'],
    ['Regulasi & SOP', '312', '#FCD34D'],
  ];
  kpi.forEach(([k, v, c], i) => {
    const y = 66 + i * 100;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(24, y, 300, 88);
    g.fillStyle = c;
    g.fillRect(24, y, 5, 88);
    g.fillStyle = '#9CA3AF';
    g.font = `600 14px ${FONT}`;
    g.fillText(k, 44, y + 24);
    g.fillStyle = c;
    g.font = `800 38px ${FONT}`;
    g.fillText(v, 44, y + 58);
  });
  // tengah: grafik aktivitas pencarian
  const cx = 350, cw = 330;
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(cx, 66, cw, 288);
  g.fillStyle = '#E5E7EB';
  g.font = `700 14px ${FONT}`;
  g.fillText('Aktivitas pencarian', cx + 14, 86);
  for (let i = 0; i < 12; i++) {
    const h = (0.35 + (Math.sin(t * 0.9 + i * 0.8) * 0.5 + 0.5) * 0.55) * 120;
    g.fillStyle = i % 2 ? '#67E8F9' : '#A78BFA';
    g.fillRect(cx + 16 + i * 25, 230 - h, 16, h);
  }
  g.strokeStyle = '#FCD34D';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const x = cx + 16 + i * 12.5;
    const y = 300 - Math.sin(i * 0.5 + t * 0.8) * 22 - i * 2.2;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // kanan: log kategori bergulir
  const rx = 704, rw = W - rx - 24;
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(rx, 66, rw, 288);
  g.fillStyle = '#E5E7EB';
  g.font = `700 14px ${FONT}`;
  g.fillText('Sedang diakses', rx + 14, 86);
  g.save();
  g.beginPath();
  g.rect(rx, 100, rw, 254);
  g.clip();
  const log = ['Panduan • Import jurnal', 'Regulasi • PPh 21', 'Klien • Profil perusahaan', 'SOP • Closing bulanan', 'FAQ • Rekonsiliasi bank', 'Panduan • Export laporan', 'Regulasi • PPN masukan'];
  const off = (t * 22) % (log.length * 40);
  g.font = `600 15px ${FONT}`;
  for (let i = -1; i <= log.length + 1; i++) {
    const y = 124 + i * 40 - off;
    const idx = ((i % log.length) + log.length) % log.length;
    g.fillStyle = ['#67E8F9', '#A78BFA', '#6EE7B7', '#FCD34D', '#F0ABFC'][idx % 5];
    g.fillText('●', rx + 14, y);
    g.fillStyle = '#E5E7EB';
    g.fillText(log[idx], rx + 36, y);
  }
  g.restore();
};

// Layar kiosk pencarian: mengetik otomatis.
const gambarKiosk: GambarFn = (g, W, H, t) => {
  g.fillStyle = '#0B0A24';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(103,232,249,0.18)';
  g.fillRect(0, 0, W, 38);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#EDE9FE';
  g.font = `800 18px ${FONT}`;
  g.fillText('CARI INFORMASI', 16, 20);
  const q = ['cara import jurnal', 'kebijakan pajak terbaru', 'profil perusahaan klien', 'panduan rekonsiliasi bank'];
  const dur = 4.5;
  const i = Math.floor(t / dur) % q.length;
  const lt = t % dur;
  const n = Math.min(q[i].length, Math.floor(lt * 9));
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(16, 54, W - 32, 40);
  g.fillStyle = '#67E8F9';
  g.font = `700 16px ${FONT}`;
  g.fillText('⌕', 26, 75);
  g.fillStyle = '#FFFFFF';
  g.font = `600 17px ${FONT}`;
  const teks = q[i].slice(0, n);
  g.fillText(teks, 52, 75);
  if (Math.floor(t * 2) % 2 === 0) {
    const tw = g.measureText(teks).width;
    g.fillStyle = '#67E8F9';
    g.fillRect(54 + tw, 62, 2, 26);
  }
  const hasil = ['Panduan • langkah demi langkah', 'Regulasi • ringkasan & rujukan', 'Dokumen • berkas terkait'];
  hasil.forEach((r, k) => {
    const a = Math.max(0, Math.min(1, (lt - 1.2 - k * 0.5) * 2));
    g.globalAlpha = a;
    g.fillStyle = ['#A78BFA', '#FCD34D', '#6EE7B7'][k];
    g.fillRect(16, 112 + k * 40, 4, 28);
    g.fillStyle = '#E5E7EB';
    g.font = `600 15px ${FONT}`;
    g.fillText(r, 30, 126 + k * 40);
  });
  g.globalAlpha = 1;
};

// Peta jaringan informasi (dinding barat): simpul hub + denyut data.
const SIMPUL = ['Aplikasi', 'Klien', 'Pajak', 'Regulasi', 'SOP', 'Laporan', 'Dokumen', 'Bantuan'];
const gambarJaringan: GambarFn = (g, W, H, t) => {
  g.fillStyle = '#0B0A24';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#C4B5FD';
  g.font = `800 15px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('JARINGAN INFORMASI', 14, 18);
  const cx = W / 2, cy = H / 2 + 12;
  const rx = W * 0.36, ry = H * 0.34;
  const pts = SIMPUL.map((_, i) => {
    const a = (i / SIMPUL.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as [number, number];
  });
  g.strokeStyle = 'rgba(167,139,250,0.25)';
  g.lineWidth = 1;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
  });
  pts.forEach((p, i) => {
    g.strokeStyle = 'rgba(103,232,249,0.5)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(p[0], p[1]); g.stroke();
    const f = (t * 0.45 + i * 0.125) % 1;
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.arc(cx + (p[0] - cx) * f, cy + (p[1] - cy) * f, 3, 0, Math.PI * 2); g.fill();
  });
  pts.forEach((p, i) => {
    g.fillStyle = ['#67E8F9', '#A78BFA', '#FCD34D', '#6EE7B7'][i % 4];
    g.beginPath(); g.arc(p[0], p[1], 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#E5E7EB';
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(SIMPUL[i], p[0], p[1] + (p[1] < cy ? -14 : 15));
  });
  const pulse = 10 + Math.sin(t * 2) * 2;
  g.fillStyle = 'rgba(103,232,249,0.25)';
  g.beginPath(); g.arc(cx, cy, pulse + 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#67E8F9';
  g.beginPath(); g.arc(cx, cy, pulse, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0B0A24';
  g.font = `800 10px ${FONT}`;
  g.fillText('HUB', cx, cy + 1);
  g.textAlign = 'left';
};

// Chip label melayang yang mengorbit hologram inti (selalu menghadap kamera).
function ChipOrbit({ pusat, teks, warna, radius, y, fase, kecepatan = 0.22, w = 1.3 }: { pusat: V3; teks: string; warna: string; radius: number; y: number; fase: number; kecepatan?: number; w?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime;
    const a = fase + t * kecepatan;
    g.current.position.set(Math.cos(a) * radius, y + Math.sin(t * 1.2 + fase) * 0.05, Math.sin(a) * radius);
  });
  return (
    <group position={pusat}>
      <group ref={g}>
        <Billboard>
          <Cahaya pos={[0, 0, -0.01]} size={[w + 0.1, 0.28, 0.01]} color={warna} opacity={0.3} />
          <Teks pos={[0, 0, 0]} w={w} h={0.2} text={teks} fg="#0B1020" bg={warna} />
        </Billboard>
      </group>
    </group>
  );
}

// Label hologram datar yang melayang di atas rak / perabot.
function LabelHolo({ pos, teks, warna, w = 1.3 }: { pos: V3; teks: string; warna: string; w?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = pos[1] + Math.sin(clock.elapsedTime * 1.3 + pos[0]) * 0.03;
  });
  return (
    <group ref={g} position={pos}>
      <Cahaya pos={[0, 0, -0.012]} size={[w + 0.12, 0.3, 0.01]} color={warna} opacity={0.28} />
      <Teks pos={[0, 0, 0]} w={w} h={0.2} text={teks} fg="#0B1020" bg={warna} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cahaya pos={[s * (w / 2 + 0.07), 0.12, 0]} size={[0.1, 0.015, 0.01]} color={warna} />
          <Cahaya pos={[s * (w / 2 + 0.07), -0.12, 0]} size={[0.1, 0.015, 0.01]} color={warna} />
        </group>
      ))}
    </group>
  );
}

// Hologram inti: dais, pedestal proyektor, kerucut cahaya, globe kawat, cincin orbit, pemindai, 4 label orbit.
function InfoCore({ pos }: { pos: V3 }) {
  const inti = useRef<THREE.MeshStandardMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const scan = useRef<THREE.Mesh>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  const globe = useRef<THREE.Group>(null);
  const nodes = useMemo(() => {
    const n = 14;
    return Array.from({ length: n }, (_, i) => {
      const y = 1 - (i / (n - 1)) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      return [Math.cos(th) * rr * 0.55, y * 0.55, Math.sin(th) * rr * 0.55] as V3;
    });
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (inti.current) inti.current.emissiveIntensity = 0.9 + Math.sin(t * 2.2) * 0.4;
    if (beam.current) beam.current.opacity = 0.11 + Math.sin(t * 1.5) * 0.03;
    if (globe.current) globe.current.position.y = 1.5 + Math.sin(t * 0.9) * 0.05;
    if (scan.current && scanMat.current) {
      const p = (t * 0.45) % 1;
      scan.current.position.y = 0.55 + p * 1.5;
      const s = (0.28 + 0.49 * p) / 0.5;
      scan.current.scale.set(s, s, 1);
      scanMat.current.opacity = Math.sin(p * Math.PI) * 0.8;
    }
  });
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[4.4, 4.4]} color={HUB.cyan} opacity={0.32} />
      {/* dais */}
      <Tube pos={[0, 0.025, 0]} r={1.35} h={0.05} color={HUB.navy} seg={48} />
      <Tube pos={[0, 0.062, 0]} r={1.22} h={0.03} color={HUB.navy2} seg={48} cast={false} />
      <CincinLantai pos={[0, 0.082, 0]} r={1.2} lebar={0.035} color={HUB.cyan} />
      <CincinLantai pos={[0, 0.082, 0]} r={0.78} lebar={0.025} color={HUB.violet} opacity={0.9} />
      <CincinPutus pos={[0, 0.086, 0]} r={1.0} n={22} speed={0.32} color={HUB.cyan} />
      <CincinPutus pos={[0, 0.086, 0]} r={0.58} n={14} speed={-0.5} color={HUB.pink} panjang={0.22} />
      {/* 4 tiang energi di sudut dais */}
      {[0, 1, 2, 3].map((k) => {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        return (
          <group key={k} position={[Math.sin(a) * 1.18, 0, Math.cos(a) * 1.18]}>
            <Tube pos={[0, 0.3, 0]} r={0.05} h={0.6} color={HUB.navy2} seg={10} cast={false} />
            <TabungCahaya pos={[0, 0.3, 0.0]} r={0.018} h={0.5} color={HUB.cyan} opacity={0.9} seg={8} />
            <Ball pos={[0, 0.66, 0]} r={0.06} color={HUB.cyan} emissive={1.2} />
          </group>
        );
      })}
      {/* pedestal proyektor */}
      <Tube pos={[0, 0.2, 0]} r={0.34} rb={0.5} h={0.3} color={HUB.navy2} seg={28} />
      <TabungCahaya pos={[0, 0.3, 0]} r={0.355} h={0.025} color={HUB.cyan} seg={28} />
      <Tube pos={[0, 0.4, 0]} r={0.3} rb={0.34} h={0.16} color={HUB.navy} seg={28} />
      <Tube pos={[0, 0.5, 0]} r={0.22} h={0.04} color={HUB.putih} seg={28} cast={false} />
      <TabungCahaya pos={[0, 0.525, 0]} r={0.17} h={0.012} color={HUB.cyan} seg={28} />
      {[0, 1, 2, 3].map((k) => (
        <group key={k} rotation={[0, (k * Math.PI) / 2, 0]}>
          <Box pos={[0, 0.58, 0.27]} size={[0.05, 0.26, 0.05]} color={HUB.navy2} rot={[-0.3, 0, 0]} cast={false} />
          <Cahaya pos={[0, 0.72, 0.21]} size={[0.07, 0.02, 0.02]} color={HUB.mint} />
        </group>
      ))}
      {/* kerucut cahaya + cincin pemindai */}
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.78, 0.24, 1.5, 36, 1, true]} />
        <meshBasicMaterial ref={beam} color={HUB.cyan} transparent opacity={0.11} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={scan} position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.012, 6, 44]} />
        <meshBasicMaterial ref={scanMat} color="#FFFFFF" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {/* globe kawat + inti berdenyut + simpul data */}
      <group ref={globe} position={[0, 1.5, 0]}>
        <Putar pos={[0, 0, 0]} speed={0.5}>
          <mesh>
            <icosahedronGeometry args={[0.55, 2]} />
            <meshBasicMaterial color={HUB.cyan} wireframe toneMapped={false} />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.3, 1]} />
            <meshStandardMaterial ref={inti} color={HUB.violet} emissive={HUB.violet} emissiveIntensity={1} transparent opacity={0.6} flatShading />
          </mesh>
          {nodes.map((p, i) => (
            <Ball key={i} pos={p} r={0.03} color={i % 3 === 0 ? HUB.amber : HUB.mint} emissive={1.4} />
          ))}
        </Putar>
        {/* dua cincin orbit miring + satelit */}
        <group rotation={[0.5, 0, 0.35]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.85, 0.01, 6, 72]} />
            <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} toneMapped={false} />
          </mesh>
          <Putar pos={[0, 0, 0]} speed={1.1}>
            <Ball pos={[0.85, 0, 0]} r={0.06} color={HUB.amber} emissive={1.4} />
          </Putar>
        </group>
        <group rotation={[-0.6, 0, -0.5]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.0, 0.008, 6, 72]} />
            <meshBasicMaterial color={HUB.pink} transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <Putar pos={[0, 0, 0]} speed={-0.8}>
            <Ball pos={[1.0, 0, 0]} r={0.05} color={HUB.pink} emissive={1.4} />
          </Putar>
        </group>
      </group>
      {/* label kategori informasi mengorbit */}
      <ChipOrbit pusat={[0, 0, 0]} teks="PROFIL PERUSAHAAN" warna="#A5F3FC" radius={1.55} y={1.05} fase={0} />
      <ChipOrbit pusat={[0, 0, 0]} teks="PANDUAN APLIKASI" warna="#DDD6FE" radius={1.55} y={1.45} fase={Math.PI / 2} />
      <ChipOrbit pusat={[0, 0, 0]} teks="REGULASI & PAJAK" warna="#FDE68A" radius={1.55} y={1.85} fase={Math.PI} />
      <ChipOrbit pusat={[0, 0, 0]} teks="SOP & FAQ" warna="#A7F3D0" radius={1.55} y={1.25} fase={(3 * Math.PI) / 2} w={0.95} />
    </group>
  );
}

// Kabinet arsip modern: rangka navy ramping, rak kaca, kartu data bercahaya (bukan buku), panel belakang menyala, label hologram.
function RakArsipTech({ pos, judul, warna }: { pos: V3; judul: string; warna: string }) {
  const kartu = useMemo(() => {
    const r = mulberry32(judul.length * 7 + 3);
    const pal = [HUB.cyan, HUB.violet, HUB.mint, HUB.amber, HUB.pink];
    const out: { x: number; y: number; h: number; c: string }[] = [];
    [0.1, 0.68, 1.26].forEach((y0) => {
      for (let i = 0; i < 7; i++) out.push({ x: -0.57 + i * 0.19, y: y0, h: 0.22 + r() * 0.22, c: pal[Math.floor(r() * pal.length)] });
    });
    return out;
  }, [judul]);
  return (
    <group position={pos}>
      <Box pos={[0, 0.05, 0]} size={[1.6, 0.1, 0.42]} color={HUB.navy} />
      <Cahaya pos={[0, 0.02, 0.215]} size={[1.5, 0.012, 0.01]} color={warna} />
      {[-0.78, 0.78].map((x) => (
        <Box key={x} pos={[x, 0.96, 0]} size={[0.04, 1.82, 0.4]} color={HUB.navy2} />
      ))}
      <Box pos={[0, 1.88, 0]} size={[1.6, 0.05, 0.42]} color={HUB.navy} />
      <Cahaya pos={[0, 0.96, -0.185]} size={[1.52, 1.76, 0.01]} color={warna} opacity={0.14} />
      {[0.1, 0.68, 1.26].map((y) => (
        <Box key={y} pos={[0, y + 0.01, 0]} size={[1.52, 0.02, 0.38]} color="#E3E9F7" cast={false} />
      ))}
      {[0.66, 1.24, 1.82].map((y) => (
        <Cahaya key={y} pos={[0, y, 0.19]} size={[1.5, 0.014, 0.014]} color={warna} />
      ))}
      {[-0.8, 0.8].map((x) => (
        <Cahaya key={x} pos={[x, 0.96, 0.21]} size={[0.012, 1.82, 0.012]} color={warna} opacity={0.85} />
      ))}
      {kartu.map((k, i) => (
        <group key={i} position={[k.x, k.y + 0.02 + k.h / 2, 0.02]}>
          <Box pos={[0, 0, 0]} size={[0.13, k.h, 0.24]} color="#2D2A55" cast={false} />
          <Cahaya pos={[0, k.h / 2 - 0.02, 0.121]} size={[0.1, 0.015, 0.004]} color={k.c} />
          <Cahaya pos={[0, -k.h / 2 + 0.03, 0.121]} size={[0.1, 0.008, 0.004]} color={k.c} opacity={0.6} />
        </group>
      ))}
      <Putar pos={[0.45, 1.58, 0.0]} speed={1.1}>
        <mesh>
          <octahedronGeometry args={[0.09, 0]} />
          <meshBasicMaterial color={warna} wireframe toneMapped={false} />
        </mesh>
      </Putar>
      <mesh position={[0, 0.96, 0.2]}>
        <planeGeometry args={[1.52, 1.78]} />
        <meshBasicMaterial color={HUB.cyan} transparent opacity={0.05} depthWrite={false} toneMapped={false} />
      </mesh>
      <LabelHolo pos={[0, 2.3, 0.12]} teks={judul} warna={warna} w={1.25} />
    </group>
  );
}

// Rak server / pusat data: lampu status berkedip.
function RakServer({ pos, rotY = 0, warna = HUB.mint }: { pos: V3; rotY?: number; warna?: string }) {
  const leds = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const W = useMemo(() => ({ on: new THREE.Color(warna), off: new THREE.Color('#10281C'), amber: new THREE.Color('#FBBF24') }), [warna]);
  const baris = 8;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    leds.current.forEach((m, i) => {
      if (!m) return;
      const nyala = Math.sin(t * (1.3 + (i % 5) * 0.55) + i * 2.1) > -0.2;
      m.color.copy(nyala ? (i % 7 === 3 ? W.amber : W.on) : W.off);
    });
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 1.0, 0]} size={[0.8, 2.0, 0.7]} color="#1F1B3A" />
      <Box pos={[0, 0.04, 0.02]} size={[0.84, 0.08, 0.74]} color="#12102A" cast={false} />
      <Box pos={[0, 2.02, 0]} size={[0.84, 0.04, 0.74]} color={HUB.navy2} cast={false} />
      {Array.from({ length: baris }, (_, r) => (
        <group key={r} position={[0, 0.3 + r * 0.21, 0.36]}>
          <Box pos={[0, 0, 0]} size={[0.68, 0.16, 0.03]} color={r % 3 === 0 ? '#3A3578' : '#2D2A55'} cast={false} />
          <Cahaya pos={[0.12, 0, 0.02]} size={[0.3, 0.02, 0.005]} color="#0B0A24" />
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[-0.26 + k * 0.07, 0, 0.02]}>
              <boxGeometry args={[0.035, 0.035, 0.01]} />
              <meshBasicMaterial ref={(m) => { leds.current[r * 3 + k] = m; }} color={warna} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 1.0, 0.385]}>
        <planeGeometry args={[0.72, 1.92]} />
        <meshBasicMaterial color={HUB.cyan} transparent opacity={0.06} depthWrite={false} toneMapped={false} />
      </mesh>
      <Cahaya pos={[0, 1.97, 0.37]} size={[0.6, 0.02, 0.02]} color={warna} />
      <Cahaya pos={[0, 0.12, 0.37]} size={[0.6, 0.015, 0.02]} color={HUB.violet} />
    </group>
  );
}

// Kiosk pencarian: layar miring + cincin kaca pembesar hologram.
function KioskCari({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0.1]} size={[1.8, 1.8]} color={HUB.cyan} opacity={0.22} />
      <Tube pos={[0, 0.03, 0]} r={0.26} h={0.06} color={HUB.navy} seg={24} />
      <CincinLantai pos={[0, 0.07, 0]} r={0.24} lebar={0.02} color={HUB.cyan} />
      <Tube pos={[0, 0.5, 0]} r={0.05} h={0.9} color={HUB.navy2} seg={10} />
      <TabungCahaya pos={[0, 0.5, 0.0]} r={0.056} h={0.04} color={HUB.cyan} seg={10} />
      <group position={[0, 1.08, 0.08]} rotation={[-0.45, 0, 0]}>
        <LayarCanvas pos={[0, 0, 0]} w={0.8} h={0.5} px={400} draw={gambarKiosk} fps={5} />
      </group>
      <Putar pos={[0, 1.78, 0.06]} speed={1.0}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.014, 6, 32]} />
          <meshBasicMaterial color={HUB.cyan} toneMapped={false} />
        </mesh>
        <Box pos={[0.2, 0, -0.14]} size={[0.05, 0.05, 0.2]} color={HUB.cyan} rot={[0, 0.8, 0]} cast={false} />
      </Putar>
      <TabungCahaya pos={[0, 1.5, 0.06]} r={0.14} rb={0.03} h={0.3} color={HUB.cyan} opacity={0.12} seg={16} />
    </group>
  );
}

// Pod baca: kursi tertutup setengah cangkang dengan LED tepi + tablet hologram melayang.
function PodBaca({ pos, rotY = 0, warna = '#8B5CF6' }: { pos: V3; rotY?: number; warna?: string }) {
  const ujung = [Math.PI - 1.1, Math.PI + 1.1];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Tube pos={[0, 0.04, 0]} r={0.62} h={0.08} color={HUB.navy} seg={32} />
      <CincinLantai pos={[0, 0.088, 0]} r={0.6} lebar={0.025} color={HUB.cyan} />
      <Tube pos={[0, 0.26, 0]} r={0.36} h={0.3} color={warna} seg={24} />
      <Tube pos={[0, 0.43, 0]} r={0.34} h={0.05} color={lighten(warna, 0.1)} seg={24} cast={false} />
      <mesh position={[0, 0.66, 0]} castShadow>
        <cylinderGeometry args={[0.52, 0.52, 0.9, 28, 1, true, Math.PI - 1.1, 2.2]} />
        <meshLambertMaterial color={HUB.putih} side={THREE.DoubleSide} />
      </mesh>
      {ujung.map((a) => (
        <Cahaya key={a} pos={[Math.sin(a) * 0.52, 0.66, Math.cos(a) * 0.52]} size={[0.03, 0.9, 0.03]} color={HUB.cyan} />
      ))}
      <Cahaya pos={[0, 0.2, 0.37]} size={[0.5, 0.015, 0.015]} color={HUB.violet} opacity={0.8} />
      <LabelHolo pos={[0.62, 0.92, 0.12]} teks="BACA" warna="#DDD6FE" w={0.42} />
    </group>
  );
}

// Meja bundar kecil dengan hologram oktahedron (zona konsultasi).
function MejaInfoBulat({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[1.6, 1.6]} color={HUB.violet} opacity={0.25} />
      <Tube pos={[0, 0.23, 0]} r={0.07} rb={0.12} h={0.46} color={HUB.navy2} seg={16} />
      <Tube pos={[0, 0.48, 0]} r={0.34} h={0.04} color={HUB.putih} seg={32} />
      <TabungCahaya pos={[0, 0.5, 0]} r={0.3} h={0.01} color={HUB.violet} seg={32} />
      <TabungCahaya pos={[0, 0.74, 0]} r={0.12} rb={0.03} h={0.46} color={HUB.violet} opacity={0.14} seg={14} />
      <Putar pos={[0, 0.92, 0]} speed={1.2}>
        <mesh>
          <octahedronGeometry args={[0.13, 0]} />
          <meshBasicMaterial color={HUB.pink} wireframe toneMapped={false} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.06, 0]} />
          <meshBasicMaterial color={HUB.cyan} toneMapped={false} />
        </mesh>
      </Putar>
    </group>
  );
}

// Proyektor hologram mini di atas meja riset.
function MiniHolo({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.012, 0]} r={0.11} h={0.024} color={HUB.navy} seg={20} cast={false} />
      <TabungCahaya pos={[0, 0.027, 0]} r={0.08} h={0.008} color={HUB.cyan} seg={20} />
      <TabungCahaya pos={[0, 0.14, 0]} r={0.09} rb={0.04} h={0.22} color={HUB.cyan} opacity={0.14} seg={14} />
      <Putar pos={[0, 0.27, 0]} speed={1.4}>
        <mesh>
          <octahedronGeometry args={[0.095, 0]} />
          <meshBasicMaterial color={HUB.cyan} wireframe toneMapped={false} />
        </mesh>
      </Putar>
    </group>
  );
}

// Drone informasi: melayang mengelilingi ruangan, rotor berputar.
function DroneInfo({ pusat, rx, rz, y, kecepatan = 0.3 }: { pusat: V3; rx: number; rz: number; y: number; kecepatan?: number }) {
  const g = useRef<THREE.Group>(null);
  const rotor = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const a = t * kecepatan;
    if (g.current) {
      g.current.position.set(pusat[0] + Math.cos(a) * rx, y + Math.sin(t * 1.7) * 0.06, pusat[2] + Math.sin(a) * rz);
      g.current.rotation.y = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
    }
    rotor.current.forEach((r) => {
      if (r) r.rotation.y += Math.min(dt, 0.05) * 40;
    });
  });
  const lengan: V3[] = [[0.17, 0.04, 0.17], [-0.17, 0.04, 0.17], [0.17, 0.04, -0.17], [-0.17, 0.04, -0.17]];
  return (
    <group ref={g}>
      <Ball pos={[0, 0, 0]} r={0.11} color="#F4F1FF" flat={false} />
      <Box pos={[0, 0.0, 0.1]} size={[0.1, 0.035, 0.03]} color="#0B0A24" cast={false} />
      <Cahaya pos={[0, 0.0, 0.118]} size={[0.07, 0.016, 0.006]} color={HUB.cyan} />
      <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.15, 0.008, 6, 24]} />
        <meshBasicMaterial color={HUB.cyan} toneMapped={false} />
      </mesh>
      {[Math.PI / 4, -Math.PI / 4].map((a) => (
        <Box key={a} pos={[0, 0.03, 0]} size={[0.4, 0.014, 0.02]} color={HUB.navy2} rot={[0, a, 0]} cast={false} />
      ))}
      {lengan.map((p, i) => (
        <group key={i} position={p}>
          <group ref={(r) => { rotor.current[i] = r; }}>
            <mesh>
              <boxGeometry args={[0.15, 0.004, 0.018]} />
              <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

// Konsol data di bawah jendela barat: tabung data berisi cairan bercahaya + LED.
function KonsolJendela({ pos }: { pos: V3 }) {
  const warna = [HUB.cyan, HUB.violet, HUB.mint, HUB.amber, HUB.pink, HUB.cyan];
  return (
    <group position={pos}>
      <Box pos={[0, 0.21, 0]} size={[0.5, 0.42, 2.0]} color={HUB.navy2} />
      <Box pos={[0, 0.43, 0]} size={[0.54, 0.03, 2.04]} color={HUB.putih} cast={false} />
      <Cahaya pos={[0.255, 0.21, 0]} size={[0.01, 0.02, 1.8]} color={HUB.cyan} />
      <Cahaya pos={[0.255, 0.1, 0]} size={[0.01, 0.015, 1.8]} color={HUB.violet} opacity={0.7} />
      {warna.map((c, i) => (
        <group key={i} position={[0, 0.45, -0.8 + i * 0.32]}>
          <Tube pos={[0, 0.0, 0]} r={0.06} h={0.03} color={HUB.navy} seg={12} cast={false} />
          <TabungCahaya pos={[0, 0.11, 0]} r={0.035} h={0.18} color={c} opacity={0.85} seg={10} />
          <mesh position={[0, 0.11, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.22, 12]} />
            <meshBasicMaterial color="#FFFFFF" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
          </mesh>
          <Tube pos={[0, 0.225, 0]} r={0.055} h={0.025} color={HUB.navy} seg={12} cast={false} />
        </group>
      ))}
    </group>
  );
}

// Tiang cahaya (pengganti lampu lantai) dengan cincin berputar.
function TiangHolo({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.02, 0]} r={0.17} h={0.04} color={HUB.navy} seg={20} cast={false} />
      <Tube pos={[0, 0.75, 0]} r={0.035} h={1.5} color={HUB.navy2} seg={10} cast={false} />
      {[0.35, 0.75, 1.15].map((y) => (
        <TabungCahaya key={y} pos={[0, y, 0]} r={0.045} h={0.07} color={HUB.cyan} seg={10} />
      ))}
      <Putar pos={[0, 1.55, 0]} speed={1.5}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.13, 0.01, 6, 24]} />
          <meshBasicMaterial color={HUB.violet} toneMapped={false} />
        </mesh>
      </Putar>
      <Ball pos={[0, 1.55, 0]} r={0.06} color={HUB.cyan} emissive={1.4} />
    </group>
  );
}

// Lantai teknologi: ubin lilac + garis sambungan + LED tepi + jejak sirkuit dengan aliran data + tulisan inlay.
function LantaiTeknologi() {
  const J_utara: [number, number][] = useMemo(() => [[-8.9, 11.8], [-8.9, 11.2], [-11.5, 11.2], [-11.5, 9.6]], []);
  const J_rak: [number, number][] = useMemo(() => [[-14.0, 12.4], [-14.0, 11.4], [-16.8, 11.4], [-16.8, 10.7]], []);
  const J_pod: [number, number][] = useMemo(() => [[-8.9, 14.4], [-8.9, 14.85]], []);
  const J_meja: [number, number][] = useMemo(() => [[-10.25, 13.2], [-11.7, 13.2]], []);
  const J_kios: [number, number][] = useMemo(() => [[-8.9, 10.9], [-8.9, 10.5], [-6.4, 10.5], [-6.4, 10.1]], []);
  const ac = HUB.cyan;
  return (
    <>
      <Lantai cx={PERPUS.cx - 2 - GESER_BARAT / 2} cz={PERPUS.cz} w={PERPUS.w + 4 + GESER_BARAT} d={PERPUS.d} color="#12102F" />
      <LantaiFuturistik cx={PERPUS.cx - 2 - GESER_BARAT / 2} cz={PERPUS.cz} w={PERPUS.w + 4 + GESER_BARAT} d={PERPUS.d} />
      {/* LED tepi ruangan (celah pintu dibiarkan kosong) */}
      <Cahaya pos={[-13.125 - GESER_BARAT / 2, 0.03, 9.03]} size={[6.35 + GESER_BARAT, 0.025, 0.025]} color={HUB.violet} />
      <Cahaya pos={[-6.65, 0.03, 9.03]} size={[2.4, 0.025, 0.025]} color={HUB.violet} />
      <Cahaya pos={[-16.27 - GESER_BARAT, 0.03, 12.9]} size={[0.025, 0.025, 7.9]} color={HUB.violet} />
      <Cahaya pos={[-5.5, 0.03, 12.9]} size={[0.025, 0.025, 7.9]} color={ac} />
      <Cahaya pos={[-13.125 - GESER_BARAT / 2, 0.18, 16.87]} size={[6.35 + GESER_BARAT, 0.02, 0.02]} color={ac} />
      <Cahaya pos={[-6.65, 0.18, 16.87]} size={[2.4, 0.02, 0.02]} color={ac} />
      {/* inlay di bawah meja riset [DITUKAR: kini di posisi lama hologram] */}
      <group position={[-5.1, 0, 0.2]}>
        <Tube pos={[-8.9, 0.006, 13.0]} r={2.3} h={0.012} color="#0D0B26" seg={64} cast={false} />
        <CincinLantai pos={[-8.9, 0.015, 13.0]} r={2.25} lebar={0.04} color={HUB.violet} />
        <CincinLantai pos={[-8.9, 0.015, 13.0]} r={1.7} lebar={0.025} color={ac} opacity={0.8} />
        <CincinPutus pos={[-8.9, 0.018, 13.0]} r={2.0} n={26} speed={0.2} color={ac} panjang={0.34} />
        <Kolam pos={[-8.9, 0.02, 13.0]} size={[5.4, 4.6]} color={HUB.violet} opacity={0.22} />
      </group>
      {/* jejak sirkuit + aliran data */}
      {[J_utara, J_rak, J_pod, J_meja, J_kios].map((p, i) => (
        <Jejak key={i} pts={p} color={i % 2 ? HUB.violet : ac} />
      ))}
      <DenyutJejak pts={J_utara} color="#FFFFFF" kecepatan={1.0} />
      <DenyutJejak pts={J_rak} color={HUB.mint} kecepatan={0.9} n={1} />
      <DenyutJejak pts={J_kios} color={HUB.amber} kecepatan={1.0} />
      {/* lampu penuntun lorong pintu */}
      <LampuJalur titik={[[-9.45, 9.4], [-8.35, 9.4], [-9.45, 9.85], [-8.35, 9.85], [-9.45, 10.3], [-8.35, 10.3]]} />
      <LampuJalur titik={[[-9.45, 16.5], [-8.35, 16.5], [-9.45, 16.1], [-8.35, 16.1], [-9.45, 15.7], [-8.35, 15.7]]} color={HUB.violet} />
      {/* tulisan inlay di lantai dekat dinding selatan */}
      <Teks pos={[-13.5, 0.014, 16.55]} rot={[-Math.PI / 2, 0, 0]} w={3.6} h={0.26} text="PUSAT INFORMASI  •  RESEARCH HUB" fg="#A78BFA" />
    </>
  );
}

// [BARU] Kubus data: pedestal + kubus kawat berputar dengan inti menyala dan satelit kecil (pengganti tanaman di sudut barat daya Research).
function KubusData({ pos }: { pos: V3 }) {
  const mel = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (mel.current) mel.current.position.y = 1.5 + Math.sin(clock.elapsedTime * 1.1) * 0.05;
  });
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.2, 2.2]} color={HUB.cyan} opacity={0.22} />
      <Tube pos={[0, 0.03, 0]} r={0.62} h={0.06} color={HUB.navy} seg={36} />
      <CincinLantai pos={[0, 0.065, 0]} r={0.56} lebar={0.03} color={HUB.cyan} />
      <CincinPutus pos={[0, 0.068, 0]} r={0.4} n={10} speed={0.5} color={HUB.violet} panjang={0.2} />
      <Tube pos={[0, 0.45, 0]} r={0.2} rb={0.32} h={0.8} color={HUB.navy2} seg={24} />
      <TabungCahaya pos={[0, 0.3, 0]} r={0.285} h={0.02} color={HUB.cyan} seg={24} />
      <Tube pos={[0, 0.87, 0]} r={0.27} h={0.04} color={HUB.putih} seg={24} cast={false} />
      <TabungCahaya pos={[0, 0.9, 0]} r={0.2} h={0.012} color={HUB.cyan} seg={24} />
      <TabungCahaya pos={[0, 1.2, 0]} r={0.2} rb={0.04} h={0.6} color={HUB.cyan} opacity={0.12} seg={16} />
      <group ref={mel} position={[0, 1.5, 0]}>
        <Putar pos={[0, 0, 0]} speed={0.7}>
          <mesh>
            <boxGeometry args={[0.5, 0.5, 0.5]} />
            <meshBasicMaterial color={HUB.cyan} wireframe toneMapped={false} />
          </mesh>
          <mesh rotation={[0.6, 0.6, 0]}>
            <boxGeometry args={[0.28, 0.28, 0.28]} />
            <meshStandardMaterial color={HUB.violet} emissive={HUB.violet} emissiveIntensity={1.1} transparent opacity={0.7} flatShading />
          </mesh>
        </Putar>
        <Putar pos={[0, 0, 0]} speed={-1.2}>
          <Ball pos={[0.5, 0, 0]} r={0.035} color={HUB.amber} emissive={1.4} />
          <Ball pos={[-0.5, 0, 0]} r={0.03} color={HUB.mint} emissive={1.4} />
        </Putar>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.55, 0.007, 6, 48]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// [BARU] Dok drone: landasan bercincin dengan huruf H, drone kecil melayang dengan rotor berputar, 2 tiang lampu (pengganti tanaman di sudut timur laut).
function DockDrone({ pos }: { pos: V3 }) {
  const g = useRef<THREE.Group>(null);
  const rotor = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }, dt) => {
    if (g.current) g.current.position.y = 0.62 + Math.sin(clock.elapsedTime * 1.6) * 0.04;
    rotor.current.forEach((r) => {
      if (r) r.rotation.y += Math.min(dt, 0.05) * 40;
    });
  });
  const lengan: V3[] = [[0.17, 0.04, 0.17], [-0.17, 0.04, 0.17], [0.17, 0.04, -0.17], [-0.17, 0.04, -0.17]];
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.2, 2.2]} color={HUB.mint} opacity={0.18} />
      <Tube pos={[0, 0.03, 0]} r={0.7} h={0.06} color={HUB.navy} seg={36} />
      <CincinLantai pos={[0, 0.065, 0]} r={0.63} lebar={0.035} color={HUB.mint} />
      <CincinPutus pos={[0, 0.07, 0]} r={0.46} n={12} speed={0.4} color={HUB.cyan} panjang={0.2} />
      {/* huruf H pendaratan */}
      <Cahaya pos={[-0.14, 0.072, 0]} size={[0.045, 0.006, 0.34]} color="#FFFFFF" />
      <Cahaya pos={[0.14, 0.072, 0]} size={[0.045, 0.006, 0.34]} color="#FFFFFF" />
      <Cahaya pos={[0, 0.072, 0]} size={[0.24, 0.006, 0.045]} color="#FFFFFF" />
      {[-0.82, 0.82].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Tube pos={[0, 0.02, 0]} r={0.1} h={0.04} color={HUB.navy} seg={14} cast={false} />
          <Tube pos={[0, 0.4, 0]} r={0.025} h={0.8} color={HUB.navy2} seg={8} cast={false} />
          <TabungCahaya pos={[0, 0.8, 0]} r={0.045} h={0.08} color={HUB.mint} seg={10} />
        </group>
      ))}
      <group ref={g} position={[0, 0.62, 0]}>
        <Ball pos={[0, 0, 0]} r={0.11} color="#F4F1FF" flat={false} />
        <Box pos={[0, 0, 0.1]} size={[0.1, 0.035, 0.03]} color="#0B0A24" cast={false} />
        <Cahaya pos={[0, 0, 0.118]} size={[0.07, 0.016, 0.006]} color={HUB.mint} />
        <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.15, 0.008, 6, 24]} />
          <meshBasicMaterial color={HUB.mint} toneMapped={false} />
        </mesh>
        {[Math.PI / 4, -Math.PI / 4].map((a) => (
          <Box key={a} pos={[0, 0.03, 0]} size={[0.4, 0.014, 0.02]} color={HUB.navy2} rot={[0, a, 0]} cast={false} />
        ))}
        {lengan.map((q, i) => (
          <group key={i} position={q}>
            <group ref={(r) => { rotor.current[i] = r; }}>
              <mesh>
                <boxGeometry args={[0.15, 0.004, 0.018]} />
                <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} toneMapped={false} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
      <TabungCahaya pos={[0, 0.34, 0]} r={0.2} rb={0.45} h={0.55} color={HUB.mint} opacity={0.07} seg={20} />
    </group>
  );
}

// [BARU] Etalase kaca: alas navy bercahaya + kotak kaca berisi model poligon melayang (di dinding timur Research).
function PilarEtalase({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const mel = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (mel.current) mel.current.position.y = 1.18 + Math.sin(clock.elapsedTime * 1.3) * 0.04;
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0]} size={[1.5, 1.5]} color={HUB.violet} opacity={0.2} />
      <Box pos={[0, 0.4, 0]} size={[0.62, 0.8, 0.62]} color={HUB.navy2} />
      <Cahaya pos={[0, 0.12, 0.312]} size={[0.5, 0.014, 0.008]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.68, 0.312]} size={[0.5, 0.014, 0.008]} color={HUB.violet} />
      <Box pos={[0, 0.82, 0]} size={[0.66, 0.04, 0.66]} color={HUB.putih} cast={false} />
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[0.56, 0.7, 0.56]} />
        <meshBasicMaterial color="#C4B5FD" transparent opacity={0.13} depthWrite={false} toneMapped={false} />
      </mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <Box key={`${a}${b}`} pos={[a * 0.28, 1.2, b * 0.28]} size={[0.02, 0.7, 0.02]} color={HUB.navy2} cast={false} />
      )))}
      <Box pos={[0, 1.56, 0]} size={[0.62, 0.03, 0.62]} color={HUB.navy2} cast={false} />
      <Cahaya pos={[0, 1.54, 0]} size={[0.5, 0.01, 0.5]} color={HUB.cyan} opacity={0.6} />
      <group ref={mel} position={[0, 1.18, 0]}>
        <Putar pos={[0, 0, 0]} speed={0.9}>
          <mesh>
            <dodecahedronGeometry args={[0.16, 0]} />
            <meshBasicMaterial color={HUB.cyan} wireframe toneMapped={false} />
          </mesh>
          <mesh>
            <dodecahedronGeometry args={[0.08, 0]} />
            <meshStandardMaterial color={HUB.pink} emissive={HUB.pink} emissiveIntensity={1.2} flatShading />
          </mesh>
        </Putar>
      </group>
    </group>
  );
}

// [BARU] Bangku modern panjang: dudukan putih, kaki navy, LED di bawah dan di tepi depan.
function BangkuModern({ pos, rotY = 0, w = 1.6 }: { pos: V3; rotY?: number; w?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.42, 0]} size={[w, 0.08, 0.5]} color={HUB.putih} />
      <Box pos={[0, 0.47, 0]} size={[w - 0.1, 0.03, 0.4]} color="#8E7CC3" cast={false} />
      {[-1, 1].map((sd) => (
        <Box key={sd} pos={[sd * (w / 2 - 0.15), 0.19, 0]} size={[0.07, 0.38, 0.44]} color={HUB.navy2} />
      ))}
      <Cahaya pos={[0, 0.38, 0.252]} size={[w - 0.1, 0.012, 0.008]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.03, 0]} size={[w - 0.3, 0.008, 0.4]} color={HUB.violet} opacity={0.5} />
    </group>
  );
}

// [BARU] Jendela futuristik (smart glass): rangka navy tipis dengan LED tepi, kaca bertint gradasi + pantulan diagonal, garis pemindai yang bergerak,
// sirip tengah ber-LED, siku sudut putih, papan nama kecil, dan ambang bawah berisi LED + indikator status.
function JendelaFuturistik({ pos, rotY = 0, w = 1.8, h = 0.95 }: { pos: V3; rotY?: number; w?: number; h?: number }) {
  const scan = useRef<THREE.Mesh>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const p = (clock.elapsedTime * 0.22) % 1;
    if (scan.current) scan.current.position.x = -w / 2 + 0.12 + p * (w - 0.24);
    if (scanMat.current) scanMat.current.opacity = Math.sin(p * Math.PI) * 0.5;
  });
  const indikator = [HUB.mint, HUB.cyan, HUB.amber, HUB.violet, HUB.pink];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* rangka luar */}
      <Box pos={[0, 0, 0]} size={[w, h, 0.07]} color={HUB.navy} cast={false} />
      <Box pos={[0, 0, 0.02]} size={[w - 0.06, h - 0.06, 0.05]} color={HUB.navy2} cast={false} />
      {/* kaca */}
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[w - 0.2, h - 0.2, 0.02]} />
        <meshStandardMaterial color="#BFE3F2" emissive="#9FD8EE" emissiveIntensity={0.5} />
      </mesh>
      {/* tint gradasi: atas violet gelap -> bawah bening */}
      {[0.3, 0.2, 0.1].map((t, i) => (
        <mesh key={i} position={[0, (h - 0.2) / 2 - 0.07 - i * 0.12, 0.052]}>
          <boxGeometry args={[w - 0.2, 0.12, 0.002]} />
          <meshBasicMaterial color={HUB.violet} transparent opacity={t} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {/* pantulan diagonal */}
      {[[-0.35, 0.16], [0.1, 0.08], [0.45, 0.05]].map(([x, o], i) => (
        <mesh key={i} position={[x, 0, 0.054]} rotation={[0, 0, 0.55]}>
          <boxGeometry args={[i === 0 ? 0.12 : 0.05, h - 0.1, 0.001]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={o} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {/* garis pemindai bergerak */}
      <mesh ref={scan} position={[0, 0, 0.056]}>
        <boxGeometry args={[0.018, h - 0.22, 0.002]} />
        <meshBasicMaterial ref={scanMat} color={HUB.cyan} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* sirip tengah + LED */}
      <Box pos={[0, 0, 0.058]} size={[0.035, h - 0.2, 0.035]} color={HUB.navy} cast={false} />
      <Cahaya pos={[0, 0, 0.078]} size={[0.008, h - 0.26, 0.004]} color={HUB.cyan} />
      {/* LED tepi */}
      <Cahaya pos={[0, h / 2 - 0.012, 0.045]} size={[w - 0.04, 0.014, 0.012]} color={HUB.cyan} />
      <Cahaya pos={[0, -h / 2 + 0.012, 0.045]} size={[w - 0.04, 0.014, 0.012]} color={HUB.cyan} />
      <Cahaya pos={[-w / 2 + 0.012, 0, 0.045]} size={[0.014, h - 0.04, 0.012]} color={HUB.violet} />
      <Cahaya pos={[w / 2 - 0.012, 0, 0.045]} size={[0.014, h - 0.04, 0.012]} color={HUB.violet} />
      {/* siku sudut */}
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <group key={`${a}${b}`} position={[a * (w / 2 - 0.02), b * (h / 2 - 0.02), 0.05]}>
          <Box pos={[-a * 0.07, 0, 0]} size={[0.16, 0.03, 0.02]} color={HUB.putih} cast={false} />
          <Box pos={[0, -b * 0.07, 0]} size={[0.03, 0.16, 0.02]} color={HUB.putih} cast={false} />
        </group>
      )))}
      {/* papan nama kecil di rangka atas */}
      <Box pos={[0, h / 2 - 0.05, 0.075]} size={[0.62, 0.06, 0.012]} color="#0B0A24" cast={false} />
      <Teks pos={[0, h / 2 - 0.05, 0.083]} w={0.56} h={0.045} text="SMART GLASS" fg={HUB.cyan} />
      {/* ambang bawah + indikator status */}
      <Box pos={[0, -h / 2 - 0.03, 0.1]} size={[w + 0.12, 0.05, 0.22]} color={HUB.navy2} />
      <Box pos={[0, -h / 2 - 0.0, 0.1]} size={[w + 0.12, 0.012, 0.22]} color={HUB.putih} cast={false} />
      <Cahaya pos={[0, -h / 2 - 0.03, 0.212]} size={[w + 0.04, 0.012, 0.006]} color={HUB.violet} />
      {indikator.map((c, i) => (
        <Cahaya key={i} pos={[-0.32 + i * 0.16, -h / 2 + 0.005, 0.15]} size={[0.045, 0.012, 0.045]} color={c} />
      ))}
    </group>
  );
}

// [BARU] Papan nama ruangan RESEARCH (futuristik, kini menempel di dinding timur, di sisi utara etalase hologram): pelat navy melayang di atas 4 penyangga dengan halo violet,
// muka bergambar kanvas (ikon heksagon + tulisan RESEARCH bercahaya + subjudul PUSAT INFORMASI), LED tepi cyan/violet, siku sudut putih,
// kaca tipis dengan garis pemindai yang bergerak. Warna & bahasa desain sama dengan JendelaFuturistik (smart glass) di dinding barat.
// z = 0 adalah permukaan dinding; benda menonjol ke +z (ke dalam ruangan).
function PapanNamaRiset({ pos, label = 'RESEARCH', sub = 'PUSAT INFORMASI' }: { pos: V3; label?: string; sub?: string }) {
  const W = 1.3, H = 0.36;
  const pw = W - 0.08, ph = H - 0.08; // ukuran muka papan
  const tex = useMemo(() => {
    const CW = 1024, CH = Math.round((CW * ph) / pw);
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    const g = c.getContext('2d');
    if (g) {
      const FONT_P = 'Inter, system-ui, sans-serif';
      const bg = g.createLinearGradient(0, 0, CW, CH);
      bg.addColorStop(0, '#0B0A24');
      bg.addColorStop(0.55, '#16123A');
      bg.addColorStop(1, '#2A2560');
      g.fillStyle = bg;
      g.fillRect(0, 0, CW, CH);
      // kisi sirkuit halus
      g.strokeStyle = 'rgba(167,139,250,0.10)';
      g.lineWidth = 1;
      for (let x = 0; x <= CW; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CH); g.stroke(); }
      for (let y = 0; y <= CH; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(CW, y); g.stroke(); }
      // pendar cyan di sisi kanan
      const rg = g.createRadialGradient(CW * 0.7, CH * 0.5, 10, CW * 0.7, CH * 0.5, CW * 0.5);
      rg.addColorStop(0, 'rgba(103,232,249,0.18)');
      rg.addColorStop(1, 'rgba(103,232,249,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, CW, CH);
      // ikon kiri: heksagon ganda + inti + titik sudut
      const ix = 118, iy = CH / 2;
      const hex = (r: number) => {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          const x = ix + Math.cos(a) * r, y = iy + Math.sin(a) * r;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath();
      };
      g.lineJoin = 'round';
      g.strokeStyle = '#67E8F9'; g.lineWidth = 8; hex(Math.min(78, CH * 0.36)); g.stroke();
      g.strokeStyle = '#A78BFA'; g.lineWidth = 5; hex(Math.min(50, CH * 0.23)); g.stroke();
      g.fillStyle = '#F0ABFC';
      g.beginPath(); g.arc(ix, iy, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#67E8F9';
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        g.beginPath(); g.arc(ix + Math.cos(a) * Math.min(78, CH * 0.36), iy + Math.sin(a) * Math.min(78, CH * 0.36), 7, 0, Math.PI * 2); g.fill();
      }
      // pemisah vertikal
      const sep = g.createLinearGradient(0, CH * 0.14, 0, CH * 0.86);
      sep.addColorStop(0, 'rgba(103,232,249,0)');
      sep.addColorStop(0.5, 'rgba(103,232,249,0.85)');
      sep.addColorStop(1, 'rgba(103,232,249,0)');
      g.fillStyle = sep;
      g.fillRect(236, CH * 0.14, 4, CH * 0.72);
      // teks utama (berpendar)
      const x0 = 270, x1 = CW - 46, cx = (x0 + x1) / 2;
      (g as any).letterSpacing = '14px';
      let fs = Math.round(CH * 0.46);
      g.font = `800 ${fs}px ${FONT_P}`;
      while (g.measureText(label).width > x1 - x0 && fs > 40) { fs -= 4; g.font = `800 ${fs}px ${FONT_P}`; }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#67E8F9';
      g.shadowBlur = 30;
      g.fillStyle = '#F5F3FF';
      g.fillText(label, cx + 7, CH * 0.4);
      g.shadowBlur = 0;
      g.fillText(label, cx + 7, CH * 0.4);
      // garis pemisah + subjudul
      const ln = g.createLinearGradient(x0, 0, x1, 0);
      ln.addColorStop(0, 'rgba(167,139,250,0)');
      ln.addColorStop(0.5, 'rgba(167,139,250,0.9)');
      ln.addColorStop(1, 'rgba(167,139,250,0)');
      g.fillStyle = ln;
      g.fillRect(x0, CH * 0.665, x1 - x0, 3);
      (g as any).letterSpacing = '9px';
      g.font = `600 ${Math.round(CH * 0.14)}px ${FONT_P}`;
      g.fillStyle = '#A78BFA';
      g.fillText(sub, cx + 4, CH * 0.82);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [pw, ph, label, sub]);
  const scan = useRef<THREE.Mesh>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const p = (clock.elapsedTime * 0.28) % 1;
    if (scan.current) scan.current.position.x = -pw / 2 + 0.06 + p * (pw - 0.12);
    if (scanMat.current) scanMat.current.opacity = Math.sin(p * Math.PI) * 0.4;
  });
  return (
    <group position={pos}>
      {/* halo violet di dinding di belakang papan */}
      <Cahaya pos={[0, 0, 0.004]} size={[W + 0.16, H + 0.16, 0.004]} color={HUB.violet} opacity={0.2} />
      {/* 4 penyangga: papan melayang sedikit dari dinding */}
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <Tube key={`${a}${b}`} pos={[a * (W / 2 - 0.1), b * (H / 2 - 0.07), 0.02]} r={0.014} h={0.04} color={HUB.putih} rot={[Math.PI / 2, 0, 0]} seg={10} cast={false} />
      )))}
      {/* pelat navy + bingkai dalam */}
      <Box pos={[0, 0, 0.055]} size={[W, H, 0.05]} color={HUB.navy} />
      <Box pos={[0, 0, 0.083]} size={[W - 0.04, H - 0.04, 0.008]} color={HUB.navy2} cast={false} />
      {/* muka papan (kanvas) + kaca tipis + garis pemindai */}
      <mesh position={[0, 0, 0.0875]}>
        <planeGeometry args={[pw, ph]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.0885]}>
        <planeGeometry args={[pw, ph]} />
        <meshBasicMaterial color="#C4B5FD" transparent opacity={0.05} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={scan} position={[0, 0, 0.0895]}>
        <planeGeometry args={[0.02, ph - 0.04]} />
        <meshBasicMaterial ref={scanMat} color={HUB.cyan} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* LED tepi */}
      <Cahaya pos={[0, H / 2 - 0.012, 0.082]} size={[W - 0.02, 0.014, 0.014]} color={HUB.cyan} />
      <Cahaya pos={[0, -H / 2 + 0.012, 0.082]} size={[W - 0.02, 0.014, 0.014]} color={HUB.violet} />
      <Cahaya pos={[-W / 2 + 0.012, 0, 0.082]} size={[0.014, H - 0.04, 0.014]} color={HUB.violet} opacity={0.75} />
      <Cahaya pos={[W / 2 - 0.012, 0, 0.082]} size={[0.014, H - 0.04, 0.014]} color={HUB.cyan} opacity={0.75} />
      {/* siku sudut putih */}
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <group key={`s${a}${b}`} position={[a * (W / 2 - 0.02), b * (H / 2 - 0.02), 0.085]}>
          <Box pos={[-a * 0.06, 0, 0]} size={[0.13, 0.024, 0.016]} color={HUB.putih} cast={false} />
          <Box pos={[0, -b * 0.05, 0]} size={[0.024, 0.1, 0.016]} color={HUB.putih} cast={false} />
        </group>
      )))}
      {/* cahaya bawah: papan tampak melayang */}
      <Cahaya pos={[0, -H / 2 - 0.02, 0.05]} size={[W - 0.3, 0.008, 0.05]} color={HUB.cyan} opacity={0.55} />
    </group>
  );
}

// [BARU] AC dinding futuristik untuk Research (kini di dinding timur, di sisi selatan etalase hologram): bodi lilac-putih membulat, pita kaca gelap
// dengan garis LED cyan + lensa sensor, panel suhu digital, kisi intake, sirip hembusan navy yang miring, cahaya bawah violet,
// dan 5 garis udara tipis yang berdenyut. Menempel di dinding utara (z = 0 = permukaan dinding), menghadap ke dalam ruangan (+z).
function ACFuturistik({ pos }: { pos: V3 }) {
  const W = 1.3;
  const aliran = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const status = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    aliran.current.forEach((m, i) => {
      if (m) m.opacity = 0.04 + 0.16 * Math.max(0, Math.sin(t * 1.7 - i * 0.8));
    });
    if (status.current) status.current.opacity = 0.5 + 0.5 * Math.sin(t * 2.2) ** 2;
  });
  return (
    <group position={pos}>
      {/* pendar violet di dinding + pelat dudukan */}
      <Cahaya pos={[0, 0, 0.004]} size={[W + 0.12, 0.36, 0.004]} color={HUB.violet} opacity={0.16} />
      <Box pos={[0, 0, 0.02]} size={[W - 0.16, 0.26, 0.04]} color={HUB.navy} cast={false} />
      {/* bodi membulat */}
      <RoundedBox args={[W, 0.3, 0.17]} radius={0.05} smoothness={3} position={[0, 0, 0.105]} castShadow receiveShadow>
        <meshLambertMaterial color="#F1EEFF" />
      </RoundedBox>
      {/* pita kaca gelap + LED + lensa sensor */}
      <Box pos={[-0.06, 0.035, 0.192]} size={[W - 0.44, 0.11, 0.006]} color="#12102E" cast={false} />
      <Cahaya pos={[-0.06, -0.012, 0.197]} size={[W - 0.5, 0.008, 0.004]} color={HUB.cyan} />
      <Tube pos={[-0.57, 0.035, 0.195]} r={0.024} h={0.01} color={HUB.navy} rot={[Math.PI / 2, 0, 0]} seg={16} cast={false} />
      <Cahaya pos={[-0.57, 0.035, 0.2]} size={[0.018, 0.018, 0.004]} color={HUB.violet} />
      {/* panel suhu digital + indikator status */}
      <Box pos={[0.49, 0.035, 0.192]} size={[0.2, 0.1, 0.006]} color="#0B0A24" cast={false} />
      <Teks pos={[0.49, 0.045, 0.1965]} w={0.17} h={0.06} text="24°C" fg={HUB.cyan} />
      <mesh position={[0.56, -0.005, 0.197]}>
        <boxGeometry args={[0.016, 0.016, 0.004]} />
        <meshBasicMaterial ref={status} color={HUB.mint} transparent toneMapped={false} />
      </mesh>
      {/* kisi intake di bagian bawah muka */}
      {[0, 1, 2].map((i) => (
        <Box key={i} pos={[0, -0.085 - i * 0.022, 0.191]} size={[W - 0.3, 0.008, 0.006]} color={HUB.navy2} cast={false} />
      ))}
      {/* LED ujung kiri / kanan */}
      <Cahaya pos={[-W / 2 + 0.035, 0, 0.19]} size={[0.006, 0.2, 0.004]} color={HUB.violet} opacity={0.8} />
      <Cahaya pos={[W / 2 - 0.035, 0, 0.19]} size={[0.006, 0.2, 0.004]} color={HUB.violet} opacity={0.8} />
      {/* sirip hembusan miring + garis tepi cyan */}
      <group position={[0, -0.15, 0.1]} rotation={[0.45, 0, 0]}>
        <Box pos={[0, 0, 0.06]} size={[W - 0.2, 0.02, 0.12]} color={HUB.navy2} cast={false} />
        <Cahaya pos={[0, 0.011, 0.118]} size={[W - 0.24, 0.006, 0.008]} color={HUB.cyan} />
      </group>
      <Cahaya pos={[0, -0.165, 0.12]} size={[W - 0.3, 0.008, 0.14]} color={HUB.violet} opacity={0.35} />
      {/* garis udara dingin (berdenyut) */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[-0.5 + i * 0.25, -0.235, 0.215]} rotation={[-0.25, 0, 0]}>
          <planeGeometry args={[0.05, 0.12]} />
          <meshBasicMaterial ref={(m) => { aliran.current[i] = m; }} color={HUB.cyan} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function PerpusArea() {
  const z0 = 8.9, x0 = -16.4 - GESER_BARAT; // [DIPERLEBAR] dinding barat bergeser 4 unit (sebelumnya -12.4), menyesuaikan Account Receivable di atasnya
  const core: V3 = [-8.9, 0, 13.1]; // [DITUKAR] hologram kini tepat lurus dengan pintu masuk (x -8.9), di tengah kedalaman ruangan
  // [DIRAPIKAN] 2 pod baca simetris terhadap hologram: jarak sama (2.6) dari inti, sudut +-36 derajat dari arah selatan, keduanya menghadap inti
  const POD_R = 2.6, POD_A = 0.63;
  const aPodPos: V3 = [core[0] - POD_R * Math.sin(POD_A), 0, core[2] + POD_R * Math.cos(POD_A)];
  const bPodPos: V3 = [core[0] + POD_R * Math.sin(POD_A), 0, core[2] + POD_R * Math.cos(POD_A)];
  const aPod = Math.atan2(core[0] - aPodPos[0], core[2] - aPodPos[2]);
  const bPod = Math.atan2(core[0] - bPodPos[0], core[2] - bPodPos[2]);
  return (
    <>
      <LantaiTeknologi />

      {/* [BARU] lapisan hias dinding Research (sama seperti Planning): utara (kecuali celah pintu x -8.9), timur, barat (panel dikosongkan di jendela) */}
      <DindingDekorPlan s={8.9} segs={[[-18.2, -9.96], [-7.84, -5.4]]} panel={[[-18.2, -9.96], [-7.84, -5.4]]} />
      <group rotation={[0, -Math.PI / 2, 0]}>
        <DindingDekorPlan s={5.4} segs={[[8.9, 16.9]]} panel={[[8.9, 16.9]]} />
      </group>
      <group rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorPlan s={x0} segs={[[-16.9, -8.9]]} panel={[[-11.9, -8.9], [-16.9, -13.9]]} />
      </group>

      {/* dinding utara: 2 rak arsip + video wall pusat informasi + kiosk pencarian */}
      <RakArsipTech pos={[-15.4, 0, z0 + 0.22]} judul="ARSIP PAJAK" warna={HUB.violet} />
      <RakArsipTech pos={[-13.7, 0, z0 + 0.22]} judul="PANDUAN APLIKASI" warna={HUB.cyan} />
      <group position={[-11.5, 0, z0 + 0.3]}>
        <Box pos={[-1.05, 0.75, 0]} size={[0.06, 1.5, 0.06]} color={HUB.navy2} cast={false} />
        <Box pos={[1.05, 0.75, 0]} size={[0.06, 1.5, 0.06]} color={HUB.navy2} cast={false} />
        <Box pos={[0, 0.06, 0]} size={[2.4, 0.08, 0.3]} color={HUB.navy} />
        <Cahaya pos={[0, 0.11, 0.15]} size={[2.3, 0.012, 0.012]} color={HUB.cyan} />
        <LayarCanvas pos={[0, 1.55, 0.04]} w={2.4} h={0.9} px={1024} draw={gambarInfo} fps={4} />
      </group>
      <KioskCari pos={[-6.4, 0, 9.75]} rotY={Math.atan2(core[0] - -6.4, core[2] - 9.75)} /> {/* [DIUBAH] layar menghadap hologram (inti) */}
      {/* [DIPINDAH] dinding timur Research (permukaan x = -5.4), mengapit etalase hologram (z 13.6) dengan jarak sama (1.2):
          papan nama RESEARCH di sisi utara etalase (di atas dock drone), AC futuristik di sisi selatan etalase. rotY -PI/2 = menghadap ke dalam ruangan (barat). */}
      <group position={[-5.4, 0, 12.4]} rotation={[0, -Math.PI / 2, 0]}><PapanNamaRiset pos={[0, 1.33, 0]} /></group>
      <group position={[-5.4, 0, 14.8]} rotation={[0, -Math.PI / 2, 0]}><ACFuturistik pos={[0, 1.36, 0]} /></group>

      {/* dinding barat: rak server, konsol data + jendela pintar, peta jaringan */}
      <RakServer pos={[-15.95 - GESER_BARAT, 0, 9.9]} rotY={Math.PI / 2} />
      <RakServer pos={[-15.95 - GESER_BARAT, 0, 10.8]} rotY={Math.PI / 2} warna={HUB.cyan} />
      {/* [DIDESAIN ULANG] jendela barat: smart glass futuristik */}
      <JendelaFuturistik pos={[x0 + 0.04, 1.0, 12.9]} rotY={Math.PI / 2} w={1.8} h={0.95} />
      {/* [BARU] jam dinding yang sama dengan ruangan lain */}
      <group position={[x0 + 0.04, 1.15, 16.3]} rotation={[0, Math.PI / 2, 0]}><Clock pos={[0, 0, 0]} /></group>
      <KonsolJendela pos={[-17.7 - 0.0, 0, 12.22]} /> {/* [DIPINDAH] ke dinding barat baru (ikut GESER_BARAT), di bawah jendela, ujung utaranya menempel lemari server (z 11.2) */}
      <LayarCanvas pos={[-16.28 - GESER_BARAT, 1.3, 15.1]} rotY={Math.PI / 2} w={1.3} h={0.8} px={512} draw={gambarJaringan} fps={4} rim={HUB.violet} />

      {/* inti hologram + zona konsultasi */}
      <InfoCore pos={core} />
      <PodBaca pos={aPodPos} rotY={aPod} warna="#8B5CF6" />
      <PodBaca pos={bPodPos} rotY={bPod} warna="#2DD4BF" />
      <MejaInfoBulat pos={[core[0], 0, core[2] + 2.1]} />

      {/* meja riset [DITUKAR + DIGESER ke kiri + DIRAPIKAN]: meja lebih panjang (3.0 x 1.1), kursi simetris (Aria di tengah utara, Echo & Nova di selatan), bantalan cahaya di bawah tiap kursi */}
      <group position={[-5.1, 0, 0.2]}>
        <Box pos={[-8.9, 0.76, 13.1]} size={[3.0, 0.07, 1.1]} color="#ECE9FA" />
        <Box pos={[-8.9, 0.7965, 13.1]} size={[2.88, 0.004, 0.98]} color={HUB.navy} cast={false} />
        <Cahaya pos={[-8.9, 0.775, 13.66]} size={[3.0, 0.02, 0.012]} color={HUB.cyan} />
        <Cahaya pos={[-8.9, 0.775, 12.54]} size={[3.0, 0.02, 0.012]} color={HUB.cyan} />
        <Cahaya pos={[-10.401, 0.775, 13.1]} size={[0.012, 0.02, 1.1]} color={HUB.violet} />
        <Cahaya pos={[-7.399, 0.775, 13.1]} size={[0.012, 0.02, 1.1]} color={HUB.violet} />
        <Cahaya pos={[-8.9, 0.8, 13.1]} size={[2.5, 0.004, 0.01]} color={HUB.cyan} opacity={0.55} />
        {[-1.2, 1.2].map((x) => (
          <Box key={x} pos={[-8.9 + x, 0.37, 13.1]} size={[0.1, 0.72, 0.9]} color={HUB.navy2} />
        ))}
        <Box pos={[-8.9, 0.2, 13.1]} size={[2.3, 0.06, 0.5]} color={HUB.navy} cast={false} />
        <Cahaya pos={[-8.9, 0.05, 13.1]} size={[2.6, 0.01, 0.4]} color={HUB.violet} opacity={0.5} />
        {/* tablet baca Echo, mini hologram di tengah, 2 mug, notes */}
        <Box pos={[-9.9, 0.81, 13.38]} size={[0.5, 0.02, 0.36]} color="#0F0D2B" cast={false} />
        <Cahaya pos={[-9.9, 0.822, 13.38]} size={[0.46, 0.004, 0.32]} color="#7DD3FC" opacity={0.85} />
        <MiniHolo pos={[-8.9, 0.795, 13.2]} />
        <Mug pos={[-7.55, 0.795, 13.4]} color="#C4B5FD" steam seed={2.1} />
        <Mug pos={[-10.25, 0.795, 12.85]} color="#A7F3D0" steam seed={3.4} />
        <Box pos={[-7.65, 0.8, 12.85]} size={[0.28, 0.01, 0.2]} color="#FFFFFF" rot={[0, 0.3, 0]} cast={false} />
        <Cahaya pos={[-7.65, 0.808, 12.85]} size={[0.2, 0.003, 0.012]} color={HUB.violet} />
        {/* kursi + bantalan cahaya lantai */}
        <Chair pos={[-9.9, 0, 14.0]} color="#8E7CC3" />
        <Chair pos={[-7.9, 0, 14.0]} color="#8E7CC3" />
        <Chair pos={[-8.9, 0, 12.2]} rotY={Math.PI} color="#B8A5E0" />
        {([[-9.9, 14.0], [-7.9, 14.0], [-8.9, 12.2]] as [number, number][]).map(([x, z]) => (
          <React.Fragment key={`${x}${z}`}>
            <Tube pos={[x, 0.014, z]} r={0.46} h={0.012} color={HUB.navy} seg={28} cast={false} />
            <CincinLantai pos={[x, 0.024, z]} r={0.44} lebar={0.02} color={HUB.violet} opacity={0.9} />
          </React.Fragment>
        ))}
        <PerpusPenghuni />
        {/* halo hologram di atas meja */}
        <Putar pos={[-8.9, 2.2, 13.1]} speed={0.25}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.7, 0.012, 6, 72]} />
            <meshBasicMaterial color={HUB.violet} transparent opacity={0.55} toneMapped={false} />
          </mesh>
        </Putar>
        <Putar pos={[-8.9, 2.45, 13.1]} speed={-0.35}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.2, 0.01, 6, 64]} />
            <meshBasicMaterial color={HUB.cyan} transparent opacity={0.45} toneMapped={false} />
          </mesh>
        </Putar>
      </group>

      {/* drone informasi, komponen dekor, tiang cahaya */}
      <DroneInfo pusat={[-8.1, 0, 12.7]} rx={2.4} rz={2.1} y={1.95} />
      {/* [DIHAPUS] semua tanaman Research; diganti komponen futuristik */}
      <DockDrone pos={[-6.0, 0, 11.4]} />
      <PilarEtalase pos={[-5.85, 0, 13.6]} rotY={-Math.PI / 2} />
      <KubusData pos={[-16.9, 0, 15.8]} />
      <BangkuModern pos={[-7.0, 0, 16.45]} w={1.6} />
      <TiangHolo pos={[-5.9, 0, 16.3]} />
    </>
  );
}

// ---- Account Receivable (kiri-atas) — teal & emas: "uang masuk". Koordinat lokal (u, v) dari pusat ruangan. ----
// ==============================================================================================================================
// [BARU] RUANG ACCOUNT RECEIVABLE — versi detail: lantai ubin + karpet, dinding berpanel (plint, wainscot, list emas),
// lampu dinding / lampu meja / kolam cahaya, meja kerja seukuran meja Transactions, loket tagihan, papan status invoice, dll.
// Koordinat lokal ruangan: x -5..5, z -5.5..5.5; pintu di x = -0.5 (z = 5.6); jalur agen ke ar_tengah (-0.6, 2.0) harus tetap kosong.
// ==============================================================================================================================

// [DIPERLEBAR] Ruang AR kini 14 x 11 (sebelumnya 10 x 11): sisi barat digeser 4 unit. Titik asal grup (pintu, 3 meja, loket) TIDAK berubah,
// jadi jalur agen & semua koordinat lama tetap benar. Ruang di kolom yang sama (lorong, Research, lorong 2, Planning) ikut dilebarkan.
// Koordinat lokal: x -9..5, z -5.5..5.5. Zona barat (x -9..-4.6) = area istirahat (lounge) + jalan lapang.
const AR_X0 = -9 - GESER_BARAT, AR_X1 = ATAS_B1 - 0.1 + 13.2; // 13.2 = posisi grup AR di dunia (|x lokal -> dunia|)
const AR_DX = AR_X1 - 5; // dinding timur AR masuk sebesar ini (benda yang menempel di dinding timur ikut)
const AR_W = AR_X1 - AR_X0; // 14
const AR_CX = (AR_X0 + AR_X1) / 2; // -2

// Karpet berlapis (tepi + isi + garis emas tipis). `naik` mengangkat sedikit supaya karpet di atas karpet tidak berkedip.
function Karpet({ pos, w, d, dasar, tepi, emas = true, naik = 0 }: { pos: V3; w: number; d: number; dasar: string; tepi: string; emas?: boolean; naik?: number }) {
  return (
    <group position={[pos[0], pos[1] + naik, pos[2]]}>
      <Box pos={[0, 0.007, 0]} size={[w, 0.012, d]} color={tepi} cast={false} />
      <Box pos={[0, 0.009, 0]} size={[w - 0.2, 0.012, d - 0.2]} color={dasar} cast={false} />
      {emas && (
        <>
          {[-1, 1].map((sd) => (
            <React.Fragment key={sd}>
              <Box pos={[0, 0.0155, sd * (d / 2 - 0.2)]} size={[w - 0.34, 0.004, 0.025]} color={EMAS} cast={false} />
              <Box pos={[sd * (w / 2 - 0.2), 0.0155, 0]} size={[0.025, 0.004, d - 0.34]} color={EMAS} cast={false} />
            </React.Fragment>
          ))}
        </>
      )}
    </group>
  );
}

// Lantai: ubin 1x1 bertekstur (sorot tepi + urat halus), list lantai teal, garis emas, karpet area, keset pintu, garis antrean.
// Warna ubin & karpet dibuat lebih redup supaya ruangan tidak terlalu silau.
function ArLantai() {
  // [DIPERDETAIL] lantai porselen terrazzo mint-teal: ubin 1x1 bersorot tepi, serpihan krem/teal/emas tipis, urat halus. Kanvas = 2 x 2 ubin.
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    if (g) {
      const r = mulberry32(11);
      const dasarWarna = ['#CFE4DF', '#C3DCD6', '#C9E0DA', '#D2E7E2'];
      const serpih = ['rgba(247,255,252,0.7)', 'rgba(111,184,174,0.5)', 'rgba(42,167,155,0.36)', 'rgba(31,111,104,0.28)', 'rgba(224,184,74,0.45)'];
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * 256, y = Math.floor(i / 2) * 256;
        g.fillStyle = dasarWarna[i];
        g.fillRect(x, y, 256, 256);
        g.save();
        g.beginPath();
        g.rect(x, y, 256, 256);
        g.clip();
        for (let k = 0; k < 3; k++) {
          g.strokeStyle = `rgba(100,155,145,${0.1 + r() * 0.1})`;
          g.lineWidth = 1 + r() * 1.6;
          g.beginPath();
          const sx = x + r() * 256, sy = y + r() * 256;
          g.moveTo(sx, sy);
          g.bezierCurveTo(sx + (r() - 0.5) * 160, sy + (r() - 0.5) * 160, sx + (r() - 0.5) * 240, sy + (r() - 0.5) * 240, sx + (r() - 0.5) * 300, sy + (r() - 0.5) * 300);
          g.stroke();
        }
        for (let k = 0; k < 150; k++) {
          g.fillStyle = serpih[Math.floor(r() * serpih.length)];
          g.beginPath();
          g.ellipse(x + r() * 256, y + r() * 256, 1.2 + r() * 4.2, 1 + r() * 2.6, r() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.34)';
        g.fillRect(x + 2, y + 2, 252, 2);
        g.fillRect(x + 2, y + 2, 2, 252);
        g.fillStyle = 'rgba(60,120,110,0.16)';
        g.fillRect(x + 2, y + 252, 252, 2);
        g.fillRect(x + 252, y + 2, 2, 252);
      }
      g.fillStyle = '#A9C9C1';
      for (const o of [0, 256, 510]) {
        g.fillRect(o - 1, 0, 3, 512);
        g.fillRect(0, o - 1, 512, 3);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(AR_W / 2, 5.5); // 1 ubin = 1 unit (kanvas = 2 x 2 ubin)
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  return (
    <group>
      <Lantai cx={AR_CX} w={AR_W} d={11} color={TH.ar.floor} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[AR_CX, 0.003, 0]} receiveShadow>
        <planeGeometry args={[AR_W, 11]} />
        <meshLambertMaterial map={tex} />
      </mesh>
      {/* list lantai teal di sepanjang dinding + garis emas tipis di dalamnya */}
      <Box pos={[AR_CX, 0.007, -5.33]} size={[AR_W - 0.2, 0.008, 0.3]} color="#6FB8AE" cast={false} />
      <Box pos={[AR_CX, 0.007, 5.33]} size={[AR_W - 0.2, 0.008, 0.3]} color="#6FB8AE" cast={false} />
      <Box pos={[AR_X0 + 0.17, 0.007, 0]} size={[0.3, 0.008, 10.4]} color="#6FB8AE" cast={false} />
      <Box pos={[AR_X1 - 0.17, 0.007, 0]} size={[0.3, 0.008, 10.4]} color="#6FB8AE" cast={false} />
      <Box pos={[AR_CX, 0.0105, -5.1]} size={[AR_W - 0.6, 0.003, 0.025]} color={EMAS} cast={false} />
      <Box pos={[AR_CX, 0.0105, 5.1]} size={[AR_W - 0.6, 0.003, 0.025]} color={EMAS} cast={false} />
      <Box pos={[AR_X0 + 0.4, 0.0105, 0]} size={[0.025, 0.003, 10.2]} color={EMAS} cast={false} />
      <Box pos={[AR_X1 - 0.4, 0.0105, 0]} size={[0.025, 0.003, 10.2]} color={EMAS} cast={false} />
      {/* karpet area kerja (di bawah 3 meja), area resepsi (depan loket), lorong masuk, area tunggu, area istirahat (barat) */}
      <Karpet pos={[-6.2, 0, -1.5]} w={7.4} d={6.0} dasar="#B4D6CF" tepi="#1F8F84" /> {/* [DIPERPANJANG] ke selatan (z -4.5..1.5) supaya kursi & AI Matrix ikut berada di atas karpet penuh */}
      {[-8.0, -4.4].map((x) => (
        <Box key={x} pos={[x, 0.0165, -1.5]} size={[0.03, 0.002, 5.5]} color="#9CC6BE" cast={false} />
      ))}
      <Karpet pos={[-0.5, 0, 1.3]} w={3.4} d={2.2} dasar="#E2D2A2" tepi="#A87A0E" /> {/* [DIPINDAH] tepat di bawah meja administrasi, tepat di tengahnya (loket x -0.5, z 1.3), ditimpa loket */}
      <Karpet pos={[-0.5, 0, 3.515]} w={1.2} d={3.67} dasar="#2AA79B" tepi="#1F8F84" naik={0.006} />
      <Karpet pos={[3.3, 0, -0.6]} w={3.6} d={5.8} dasar="#E6D5AE" tepi="#B8860B" /> {/* [DIPINDAH] lounge ke kanan, di depan monumen koin & lemari arsip (dx +9.7) */}
      {/* [BARU] ambang pintu: pita teal tua + garis emas */}
      <Box pos={[-0.5, 0.007, 5.44]} size={[2.0, 0.012, 0.12]} color="#154E49" cast={false} />
      <Box pos={[-0.5, 0.0135, 5.44]} size={[1.9, 0.002, 0.03]} color={EMAS} cast={false} />
      {/* keset pintu */}
      <Karpet pos={[-0.5, 0, 5.0]} w={1.5} d={0.8} dasar="#1F6F68" tepi="#154E49" emas={false} naik={0.012} />
      <Teks pos={[-0.5, 0.03, 5.0]} rot={[-Math.PI / 2, 0, 0]} w={1.1} h={0.26} text="SELAMAT DATANG" fg="#F5C84C" />
      {/* [BARU] medali lantai AR (gaya sama dengan AP, warna teal & emas): [DIPINDAH] dari sudut barat daya (bawah meja negosiasi) ke BELAKANG meja administrasi: sejajar loket (x -0.5), di tengah area kosong antara loket dan dinding belakang (z -2.2) */}
      <CincinLantai pos={[-0.5, 0.02, -2.2]} r={0.95} lebar={0.045} color="#2AA79B" opacity={0.95} />
      <CincinLantai pos={[-0.5, 0.02, -2.2]} r={0.72} lebar={0.025} color={EMAS} opacity={0.9} />
      <Tube pos={[-0.5, 0.012, -2.2]} r={0.7} h={0.012} color="#E6FFF8" seg={40} cast={false} />
      <Teks pos={[-0.5, 0.026, -2.32]} rot={[-Math.PI / 2, 0, 0]} w={1.15} h={0.22} text="ACCOUNT" fg="#1F6F68" />
      <Teks pos={[-0.5, 0.026, -2.08]} rot={[-Math.PI / 2, 0, 0]} w={1.2} h={0.18} text="RECEIVABLE" fg="#2AA79B" />
      {/* garis antre di depan loket */}
      <Box pos={[-0.5, 0.0235, 2.48]} size={[3.0, 0.002, 0.06]} color={EMAS} cast={false} />
      <Teks pos={[-0.5, 0.0245, 2.72]} rot={[-Math.PI / 2, 0, 0]} w={1.05} h={0.11} text="ANTRE DI BELAKANG GARIS" fg="#F5C84C" />
    </group>
  );
}

// ---- [BARU] Dinding Account Receivable: panel alur teal, kertas dinding mint bermotif faktur & panah terima, rel krem, pita emas, list atas + LED ----
const AR_TEAL_TUA = '#1F6F68';
const AR_KRIM = '#F1FBF8';

// Panel beralur (fluted) teal: alur vertikal bersorot kiri-gelap kanan. Tile 1.0 x 0.48.
function PanelAlurAR({ pos, w, h = 0.48 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 128, (g, W, H) => {
    g.fillStyle = '#5FAFA4';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i++) {
      const x = i * 32 + 2;
      const gr = g.createLinearGradient(x, 0, x + 28, 0);
      gr.addColorStop(0, '#8FD3CA');
      gr.addColorStop(0.55, '#7EC5BC');
      gr.addColorStop(1, '#58A89E');
      g.fillStyle = gr;
      g.fillRect(x, 0, 28, H);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x, 0, 2, H);
      g.fillStyle = 'rgba(20,70,65,0.22)';
      g.fillRect(x + 26, 0, 2, H);
    }
    g.fillStyle = 'rgba(241,251,248,0.4)';
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(20,70,65,0.25)';
    g.fillRect(0, H - 2, W, 2);
  }, 'ar-panel-alur');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Kertas dinding rose: pinstripe halus + faktur (invoice) dan panah masuk-dalam-lingkaran (penerimaan) bergantian. Tile 2.0 x 0.825.
function KertasDindingAR({ pos, w, h = 0.825 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(640, 264, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#E9F6F3');
    gr.addColorStop(1, '#D6ECE7');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (let x = 4; x < W; x += 12) g.fillRect(x, 0, 1, H);
    g.fillStyle = 'rgba(31,143,132,0.07)';
    for (let y = 22; y < H; y += 44) g.fillRect(0, y, W, 1);
    const ikon = (cx: number, cy: number, jenis: number) => {
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = 'rgba(31,143,132,0.38)';
      g.fillStyle = 'rgba(31,143,132,0.14)';
      g.lineWidth = 2;
      if (jenis === 0) {
        // faktur: lembar bersudut lipat + baris teks
        g.beginPath();
        g.moveTo(-12, -16); g.lineTo(6, -16); g.lineTo(12, -10); g.lineTo(12, 16); g.lineTo(-12, 16);
        g.closePath();
        g.fill(); g.stroke();
        g.beginPath(); g.moveTo(6, -16); g.lineTo(6, -10); g.lineTo(12, -10); g.stroke();
        g.lineWidth = 1.6;
        for (const y of [-3, 3, 9]) { g.beginPath(); g.moveTo(-7, y); g.lineTo(7, y); g.stroke(); }
      } else {
        // pembayaran masuk: lingkaran + panah ke kiri-bawah
        g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(6, -6); g.lineTo(-6, 6); g.stroke();
        g.beginPath(); g.moveTo(1, 6); g.lineTo(-6, 6); g.lineTo(-6, -1); g.stroke();
      }
      g.restore();
    };
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) {
        const x = i * 160 + 80 + (j % 2 ? 80 : 0);
        const y = 44 + j * 88;
        const jenis = (i + j) % 2;
        ikon(x, y, jenis);
        if (x > W - 30) ikon(x - W, y, jenis);
        // titik penghubung kecil antar ikon
        g.fillStyle = 'rgba(184,134,11,0.4)';
        g.beginPath(); g.arc(x + 40, y + 44, 2.4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(x - 40, y + 44, 2.4, 0, Math.PI * 2); g.fill();
      }
    }
  }, 'ar-kertas-dinding');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w / 2), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias dinding AR (menghadap +z lokal, x sepanjang dinding, z = keluar dari permukaan dinding).
function DindingDekorAR({ segs }: { segs: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        return (
          <React.Fragment key={`dp${a}`}>
            <PanelAlurAR pos={[cx, 0.38, 0.008]} w={L} />
            <Box pos={[cx, 0.07, 0.025]} size={[L, 0.14, 0.05]} color="#C77F78" cast={false} />
            <Box pos={[cx, 0.145, 0.03]} size={[L, 0.012, 0.06]} color={AR_KRIM} cast={false} />
            <Box pos={[cx, 0.645, 0.035]} size={[L, 0.04, 0.07]} color={AR_KRIM} cast={false} />
            <Box pos={[cx, 0.668, 0.036]} size={[L, 0.008, 0.072]} color={EMAS} cast={false} />
            <Cahaya pos={[cx, 0.622, 0.02]} size={[L - 0.02, 0.008, 0.004]} color="#FFD0CA" opacity={0.85} />
            <KertasDindingAR pos={[cx, 1.08, 0.003]} w={L} />
            <Box pos={[cx, 1.5, 0.02]} size={[L, 0.025, 0.04]} color={EMAS} cast={false} />
            <Box pos={[cx, 1.545, 0.024]} size={[L, 0.05, 0.048]} color={AR_KRIM} cast={false} />
            <Cahaya pos={[cx, 1.578, 0.014]} size={[L - 0.02, 0.008, 0.008]} color="#FFE3DE" opacity={0.9} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Tiang sudut: kolom teal tua berlis krem (tinggi dinding).
function TiangSudutAR({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.8, 0]} size={[0.22, 1.6, 0.22]} color={AR_TEAL_TUA} />
      <Box pos={[0, 0.8, 0]} size={[0.24, 1.6, 0.03]} color={AR_KRIM} cast={false} />
      <Box pos={[0, 0.8, 0]} size={[0.03, 1.6, 0.24]} color={AR_KRIM} cast={false} />
      <Box pos={[0, 0.03, 0]} size={[0.27, 0.06, 0.27]} color="#6A1F2D" cast={false} />
      <Box pos={[0, 1.55, 0]} size={[0.26, 0.05, 0.26]} color="#6A1F2D" cast={false} />
      <Cahaya pos={[0, 1.58, 0]} size={[0.2, 0.012, 0.2]} color="#FFE3DE" opacity={0.9} />
    </group>
  );
}

// Dinding belakang (z = -5.5), barat (dinding luar), dan timur (sisi AR dari dinding ke Transactions) + tiang sudut.
// Menggantikan ArDinding lama. Tiang sudut timur-belakang dilewati karena ada APAR di sana.
function ArDinding() {
  return (
    <group>
      <group position={[0, 0, -5.5]}>
        <DindingDekorAR segs={[[AR_X0, AR_X1]]} />
      </group>
      <group position={[AR_X0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorAR segs={[[-5.5, 5.5]]} />
      </group>
      <group position={[AR_X1, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <DindingDekorAR segs={[[-5.5, 5.5]]} />
      </group>
      <TiangSudutAR pos={[AR_X0 + 0.11, 0, -5.39]} />
      <TiangSudutAR pos={[AR_X0 + 0.11, 0, 5.39]} />
      <TiangSudutAR pos={[AR_X1 - 0.11, 0, 5.39]} />
    </group>
  );
}

// Lampu dinding: pelat emas, kap menyala, dan halo hangat di dinding. +z lokal = arah ke dalam ruangan.
function LampuDinding({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0.01]} size={[0.1, 0.24, 0.02]} color="#C9A227" cast={false} />
      <Box pos={[0, 0, 0.06]} size={[0.025, 0.025, 0.08]} color="#C9A227" cast={false} />
      <mesh position={[0, 0.02, 0.13]}>
        <cylinderGeometry args={[0.055, 0.078, 0.17, 14, 1, true]} />
        <meshStandardMaterial color="#FFF1C9" emissive="#FFE3A0" emissiveIntensity={1.1} side={THREE.DoubleSide} />
      </mesh>
      <Kolam pos={[0, 0.02, 0.035]} size={[1.1, 1.1]} rot={[0, 0, 0]} opacity={0.13} />
    </group>
  );
}

// Papan status invoice (kanban) di dinding belakang.
function PapanInvoice({ pos }: { pos: V3 }) {
  const kol: { t: string; c: string; n: number }[] = [
    { t: 'DRAFT', c: '#94A3B8', n: 2 },
    { t: 'TERKIRIM', c: '#3B82F6', n: 3 },
    { t: 'JATUH TEMPO', c: '#F59E0B', n: 3 },
    { t: 'LUNAS', c: '#22C55E', n: 4 },
  ];
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[2.1, 1.1, 0.05]} color="#8FA3A0" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[2.02, 1.02, 0.02]} color="#F7FBFA" cast={false} />
      <Box pos={[0, 0.43, 0.045]} size={[2.02, 0.15, 0.01]} color="#2AA79B" cast={false} />
      <Teks pos={[0, 0.43, 0.052]} w={1.2} h={0.11} text="STATUS INVOICE" fg="#FFFFFF" />
      {kol.map((k, i) => {
        const x = -0.75 + i * 0.5;
        return (
          <React.Fragment key={k.t}>
            <Box pos={[x, 0, 0.043]} size={[0.46, 0.8, 0.006]} color="#E8F1EF" cast={false} />
            <Box pos={[x, 0.31, 0.049]} size={[0.46, 0.1, 0.008]} color={k.c} cast={false} />
            <Teks pos={[x, 0.31, 0.055]} w={0.4} h={0.07} text={k.t} fg="#FFFFFF" />
            {Array.from({ length: k.n }, (_, j) => (
              <React.Fragment key={j}>
                <Box pos={[x, 0.17 - j * 0.14, 0.05]} size={[0.38, 0.11, 0.008]} color="#FFFFFF" cast={false} />
                <Box pos={[x - 0.17, 0.17 - j * 0.14, 0.055]} size={[0.025, 0.11, 0.006]} color={k.c} cast={false} />
                <Box pos={[x + 0.02, 0.2 - j * 0.14, 0.055]} size={[0.24, 0.015, 0.004]} color="#CBD5D1" cast={false} />
                <Box pos={[x - 0.03, 0.15 - j * 0.14, 0.055]} size={[0.15, 0.012, 0.004]} color="#E2E8E6" cast={false} />
              </React.Fragment>
            ))}
          </React.Fragment>
        );
      })}
      <Box pos={[0, -0.575, 0.08]} size={[1.9, 0.03, 0.1]} color="#8FA3A0" cast={false} />
      {['#EF4444', '#3B82F6', '#22C55E', '#F59E0B'].map((c, i) => (
        <Box key={c} pos={[-0.5 + i * 0.33, -0.545, 0.085]} size={[0.1, 0.03, 0.03]} color={c} cast={false} />
      ))}
    </group>
  );
}

// Papan gabus pengumuman (dinding kiri).
function PapanGabus({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const kertas: [number, number, string, number][] = [
    [-0.25, 0.15, '#FFFFFF', 0.08], [0.05, 0.2, '#FDE68A', -0.1], [0.28, 0.1, '#FBCFE8', 0.12],
    [-0.2, -0.15, '#A7F3D0', -0.06], [0.1, -0.12, '#FFFFFF', 0.05], [0.3, -0.18, '#BFDBFE', -0.1],
  ];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[0.96, 0.76, 0.04]} color="#8B5E34" cast={false} />
      <Box pos={[0, 0, 0.025]} size={[0.88, 0.68, 0.02]} color="#C9A26B" cast={false} />
      {kertas.map(([x, y, c, r], i) => (
        <React.Fragment key={i}>
          <Box pos={[x, y, 0.04]} size={[0.2, 0.26, 0.004]} color={c} rot={[0, 0, r]} cast={false} />
          <Box pos={[x, y + 0.06, 0.044]} size={[0.14, 0.015, 0.002]} color="#94A3B8" rot={[0, 0, r]} cast={false} />
          <Box pos={[x, y, 0.044]} size={[0.14, 0.012, 0.002]} color="#CBD5D1" rot={[0, 0, r]} cast={false} />
          <Ball pos={[x, y + 0.11, 0.05]} r={0.016} color={i % 2 ? '#EF4444' : '#2AA79B'} flat={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

// Kredensa arsip di dinding belakang.
function Kredensa({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.05, 0]} size={[1.96, 0.1, 0.44]} color="#2F6F69" />
      <Box pos={[0, 0.4, 0]} size={[2.0, 0.62, 0.5]} color="#E8F3F1" />
      <Box pos={[0, 0.735, 0]} size={[2.06, 0.05, 0.54]} color="#C99863" />
      {[0, 1, 2, 3].map((i) => (
        <React.Fragment key={i}>
          <Box pos={[-0.75 + i * 0.5, 0.4, 0.256]} size={[0.46, 0.54, 0.012]} color="#CDE7E2" cast={false} />
          <Box pos={[-0.75 + i * 0.5 + (i % 2 ? -0.17 : 0.17), 0.4, 0.27]} size={[0.02, 0.12, 0.02]} color={EMAS} cast={false} />
        </React.Fragment>
      ))}
      {/* di atas kredensa: map majalah, bingkai foto, tanaman */}
      {['#2AA79B', '#F59E0B', '#3B82F6'].map((c, i) => (
        <Box key={c} pos={[0.55 + i * 0.11, 0.9, 0]} size={[0.09, 0.26, 0.24]} color={c} cast={false} />
      ))}
      <group position={[-0.55, 0.88, -0.1]} rotation={[-0.15, 0, 0]}>
        <Box pos={[0, 0, 0]} size={[0.3, 0.22, 0.02]} color="#5B4630" cast={false} />
        <Box pos={[0, 0, 0.012]} size={[0.25, 0.17, 0.006]} color="#DCEFE6" cast={false} />
        <Box pos={[-0.04, -0.02, 0.016]} size={[0.1, 0.1, 0.003]} color="#2AA79B" cast={false} />
        <Box pos={[0.05, 0.015, 0.016]} size={[0.08, 0.08, 0.003]} color="#F5C84C" cast={false} />
      </group>
      <Succulent pos={[0.1, 0.76, 0.05]} scale={0.8} />
      <Mug pos={[-0.15, 0.76, 0.1]} color="#A7F3D0" steam seed={0.3} />
    </group>
  );
}

// Mesin nomor antrean.
function TiketAntrian({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.06, 0]} size={[0.42, 0.12, 0.34]} color="#2F6F69" />
      <Box pos={[0, 0.56, 0]} size={[0.3, 0.88, 0.22]} color="#F3F6F4" />
      <Box pos={[0, 0.93, 0.115]} size={[0.26, 0.14, 0.014]} color="#0B1A17" cast={false} />
      <Teks pos={[0, 0.94, 0.123]} w={0.2} h={0.1} text="A-017" fg="#6EE7B7" />
      <Box pos={[0, 0.8, 0.112]} size={[0.26, 0.05, 0.008]} color="#2AA79B" cast={false} />
      <Teks pos={[0, 0.8, 0.118]} w={0.22} h={0.04} text="ANTRIAN" fg="#FFFFFF" />
      <Box pos={[0, 0.63, 0.115]} size={[0.2, 0.16, 0.012]} color="#1A222B" cast={false} />
      <Box pos={[0, 0.63, 0.123]} size={[0.17, 0.13, 0.003]} color="#2AA79B" cast={false} />
      <Teks pos={[0, 0.63, 0.1265]} w={0.15} h={0.07} text="AMBIL NOMOR" fg="#FFFFFF" />
      <Box pos={[0, 0.4, 0.115]} size={[0.14, 0.02, 0.03]} color="#111827" cast={false} />
      <Box pos={[0, 0.33, 0.14]} size={[0.1, 0.1, 0.004]} color="#FFFFFF" cast={false} />
      <Box pos={[0, 0.375, 0.1425]} size={[0.1, 0.02, 0.002]} color="#2AA79B" cast={false} />
    </group>
  );
}

// Tiang antrean + tali.
function TiangAntri({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.015, 0]} r={0.11} h={0.03} color="#B8860B" seg={20} cast={false} />
      <Tube pos={[0, 0.46, 0]} r={0.018} h={0.88} color={EMAS} seg={10} />
      <Ball pos={[0, 0.92, 0]} r={0.04} color={EMAS} flat={false} />
    </group>
  );
}

// Pencahayaan ruangan: sengaja lembut. Lampu titik (pointLight) DIHAPUS karena membuat ruangan silau & membebani seluruh scene;
// suasana hangat kini hanya dari kolam cahaya tipis di lantai + bercak sinar jendela + halo lampu dinding / lampu meja.
function CahayaAR() {
  return (
    <>
      <Kolam pos={[-8.0, 0.02, -2.2]} size={[3.6, 3.6]} opacity={0.045} />
      <Kolam pos={[-4.4, 0.02, -2.2]} size={[3.6, 3.6]} opacity={0.045} />
      <Kolam pos={[-0.5, 0.02, 2.0]} size={[4.2, 3.2]} color="#E6FFF8" opacity={0.045} />
      <Kolam pos={[3.3, 0.02, -0.6]} size={[4.6, 5.6]} color="#FFE7B0" opacity={0.05} />
      <SunPatch pos={[-3.0, 0.03, -3.9]} size={[2.8, 3.2]} rotY={0.35} opacity={0.07} />
      <SunPatch pos={[4.0, 0.03, -3.6]} size={[2.4, 3.0]} rotY={-0.2} opacity={0.07} />
      <SunPatch pos={[-7.6, 0.03, -3.4]} size={[2.2, 2.6]} rotY={-0.1} opacity={0.07} />
    </>
  );
}

// ---- Objek lama yang dibuat lebih detail -------------------------------------------------------------------------------------

function AgingChart({ pos, rotY = 0, judul = 'UMUR PIUTANG (AGING)', warna = '#2AA79B' }: { pos: V3; rotY?: number; judul?: string; warna?: string }) {
  const bars: [number, string, string, string][] = [
    [0.5, '#34D399', '0-30', '52%'],
    [0.38, '#A3E635', '31-60', '24%'],
    [0.27, '#FACC15', '61-90', '13%'],
    [0.18, '#FB923C', '91-120', '7%'],
    [0.1, '#F87171', '>120', '4%'],
  ];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[2.2, 1.1, 0.05]} color="#8FA3A0" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[2.1, 1.0, 0.02]} color="#F7FBFA" cast={false} />
      <Box pos={[0, 0.43, 0.045]} size={[2.1, 0.14, 0.01]} color={warna} cast={false} />
      <Teks pos={[0, 0.43, 0.052]} w={1.5} h={0.1} text={judul} fg="#FFFFFF" />
      {[0, 1, 2].map((i) => (
        <Box key={i} pos={[0, -0.16 + i * 0.2, 0.045]} size={[1.84, 0.006, 0.004]} color="#DDE6E4" cast={false} />
      ))}
      <Box pos={[0, -0.36, 0.046]} size={[1.9, 0.025, 0.006]} color="#2B3340" cast={false} />
      <Box pos={[-0.93, -0.02, 0.046]} size={[0.02, 0.7, 0.006]} color="#2B3340" cast={false} />
      {bars.map(([h, c, l, p], i) => (
        <React.Fragment key={l}>
          <Box pos={[-0.7 + i * 0.35, -0.36 + h / 2 + 0.012, 0.05]} size={[0.24, h, 0.012]} color={c} cast={false} />
          <Teks pos={[-0.7 + i * 0.35, -0.36 + h + 0.07, 0.058]} w={0.2} h={0.07} text={p} fg="#1F2A37" />
          <Teks pos={[-0.7 + i * 0.35, -0.44, 0.054]} w={0.3} h={0.07} text={l} fg="#475569" />
        </React.Fragment>
      ))}
      {[-0.9, 0.9].map((x) => (
        <Box key={x} pos={[x, 0.58, 0]} size={[0.05, 0.08, 0.05]} color="#2B3340" cast={false} />
      ))}
    </group>
  );
}

function MailRack({ pos, rotY = 0, palet = { sel: '#5E8F89', badan: '#E8F3F1', kaki: '#2F6F69', baki: '#2AA79B' } }: { pos: V3; rotY?: number; palet?: { sel: string; badan: string; kaki: string; baki: string } }) {
  const cells: React.ReactNode[] = [];
  const warna = ['#34D399', '#FACC15', '#60A5FA', '#F87171'];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const x = -0.5 + c * 0.5, y = 0.24 + r * 0.33;
      cells.push(
        <React.Fragment key={`${r}${c}`}>
          <Box pos={[x, y, 0.2]} size={[0.42, 0.26, 0.03]} color={palet.sel} cast={false} />
          {(r + c) % 2 === 0 && <Box pos={[x, y + 0.03, 0.23]} size={[0.32, 0.2, 0.03]} color="#FFFFFF" cast={false} />}
          {(r + c) % 2 === 0 && <Box pos={[x, y + 0.075, 0.248]} size={[0.26, 0.012, 0.004]} color="#CBD5D1" cast={false} />}
          {(r * 3 + c) % 4 === 0 && <Box pos={[x + 0.13, y + 0.1, 0.25]} size={[0.08, 0.05, 0.01]} color="#34D399" cast={false} />}
          <Box pos={[x, y - 0.12, 0.222]} size={[0.2, 0.025, 0.006]} color={warna[(r + c) % 4]} cast={false} />
        </React.Fragment>
      );
    }
  }
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.05, 0]} size={[1.64, 0.1, 0.42]} color={palet.kaki} />
      <Box pos={[0, 0.8, 0]} size={[1.6, 1.4, 0.4]} color={palet.badan} />
      {cells}
      <Box pos={[0, 1.52, 0]} size={[1.66, 0.04, 0.44]} color="#F8F9FB" />
      {/* di atas rak: baki surat masuk + tanaman kecil */}
      <Box pos={[-0.35, 1.58, 0.02]} size={[0.5, 0.04, 0.34]} color={palet.baki} cast={false} />
      <TumpukKertas pos={[-0.35, 1.6, 0.02]} n={4} />
      <Succulent pos={[0.45, 1.54, 0.05]} scale={0.8} />
    </group>
  );
}

function CoinMonument({ pos, plakatPos = [0.55, 0, 0.95], plakatRot = 0.4 }: { pos: V3; plakatPos?: V3; plakatRot?: number }) {
  return (
    <group position={pos}>
      {/* alas bertingkat + lampu sorot */}
      <Tube pos={[0, 0.05, 0]} r={0.74} h={0.1} color="#2F6F69" seg={32} />
      <Tube pos={[0, 0.15, 0]} r={0.62} h={0.1} color="#5FB8AE" seg={32} />
      <Tube pos={[0, 0.26, 0]} r={0.5} h={0.12} color="#E8F3F1" seg={32} />
      <Tube pos={[0, 0.325, 0]} r={0.52} h={0.012} color={EMAS} seg={32} cast={false} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return <Cahaya key={i} pos={[Math.sin(a) * 0.68, 0.205, Math.cos(a) * 0.68]} size={[0.08, 0.025, 0.08]} color="#FFF1C9" />;
      })}
      <Kolam pos={[0, 0.012, 0]} size={[2.6, 2.6]} color={EMAS} opacity={0.10} />
      {/* tiang + koin berputar dengan tulisan Rp di kedua sisi */}
      <Tube pos={[0, 0.85, 0]} r={0.04} h={1.05} color="#8FA3A0" seg={12} />
      <Putar pos={[0, 1.3, 0]} speed={0.7}>
        <Tube pos={[0, 0, 0]} r={0.66} h={0.1} color="#D9A91C" rot={[Math.PI / 2, 0, 0]} seg={40} />
        <Tube pos={[0, 0, 0]} r={0.62} h={0.14} color={EMAS} rot={[Math.PI / 2, 0, 0]} seg={40} />
        <Tube pos={[0, 0, 0.05]} r={0.5} h={0.044} color="#FBE08A" rot={[Math.PI / 2, 0, 0]} seg={40} cast={false} />
        <Tube pos={[0, 0, -0.05]} r={0.5} h={0.044} color="#FBE08A" rot={[Math.PI / 2, 0, 0]} seg={40} cast={false} />
        <Teks pos={[0, 0, 0.0735]} w={0.5} h={0.4} text="Rp" fg="#9A6B00" />
        <Teks pos={[0, 0, -0.0735]} rot={[0, Math.PI, 0]} w={0.5} h={0.4} text="Rp" fg="#9A6B00" />
      </Putar>
      {/* plakat target penagihan */}
      <group position={plakatPos} rotation={[0, plakatRot, 0]}>
        {[-0.3, 0.3].map((x) => (
          <Box key={x} pos={[x, 0.25, 0]} size={[0.03, 0.5, 0.03]} color="#8FA3A0" cast={false} />
        ))}
        <Box pos={[0, 0.58, 0]} size={[0.84, 0.3, 0.03]} color="#0F1B24" />
        <Teks pos={[0, 0.65, 0.017]} w={0.7} h={0.08} text="KOLEKSI BULAN INI" fg="#F5C84C" />
        <Box pos={[0, 0.54, 0.017]} size={[0.7, 0.05, 0.006]} color="#334155" cast={false} />
        <Box pos={[-0.028, 0.54, 0.02]} size={[0.644, 0.05, 0.006]} color="#22C55E" cast={false} />
        <Teks pos={[0, 0.49, 0.017]} w={0.3} h={0.05} text="92% TERTAGIH" fg="#FFFFFF" />
      </group>
    </group>
  );
}

function BillingCounter({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {/* badan, tapak, panel depan berlamel, rel emas, papan tulisan */}
      <Box pos={[0, 0.05, 0]} size={[3.1, 0.1, 0.6]} color="#2F6F69" />
      <Box pos={[0, 0.5, 0]} size={[3.2, 0.8, 0.7]} color="#5FB8AE" />
      {Array.from({ length: 15 }, (_, i) => (
        <Box key={i} pos={[-1.4 + i * 0.2, 0.5, 0.358]} size={[0.13, 0.64, 0.022]} color="#7BCFC5" cast={false} />
      ))}
      <Box pos={[0, 0.865, 0.36]} size={[3.2, 0.03, 0.03]} color={EMAS} cast={false} />
      <Box pos={[0, 0.16, 0.36]} size={[3.2, 0.03, 0.03]} color={EMAS} cast={false} />
      <Box pos={[0, 0.5, 0.372]} size={[1.7, 0.26, 0.012]} color={EMAS} cast={false} />
      <Box pos={[0, 0.5, 0.38]} size={[1.64, 0.22, 0.01]} color="#0F2A28" cast={false} />
      <Teks pos={[0, 0.5, 0.387]} w={1.5} h={0.16} text="BILLING & PAYMENT" fg={EMAS} />
      <Cahaya pos={[0, 0.115, 0.372]} size={[3.0, 0.012, 0.01]} color={EMAS} />
      <Kolam pos={[0, 0.02, 0.75]} size={[3.6, 0.8]} color={EMAS} opacity={0.09} />
      {/* meja loket */}
      <Box pos={[0, 0.93, 0]} size={[3.3, 0.06, 0.82]} color="#F6F1E6" />
      <Box pos={[0, 0.905, 0.41]} size={[3.3, 0.03, 0.03]} color="#2AA79B" cast={false} />

      {/* mesin kasir: badan, tombol, layar miring dengan total, layar pelanggan, printer struk */}
      <group position={[-1.0, 0.96, -0.02]}>
        <Box pos={[0, 0.07, 0]} size={[0.5, 0.14, 0.4]} color="#2B3340" />
        <Box pos={[0, 0.145, 0.04]} size={[0.44, 0.01, 0.26]} color="#3A4454" cast={false} />
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2, 3].map((c) => (
            <Box key={`${r}${c}`} pos={[-0.15 + c * 0.1, 0.153, 0.0 + r * 0.07]} size={[0.07, 0.008, 0.05]} color={c === 3 ? '#34D399' : '#E5E7EB'} cast={false} />
          ))
        )}
        <group position={[0, 0.27, -0.14]} rotation={[-0.35, 0, 0]}>
          <Box pos={[0, 0, 0]} size={[0.42, 0.24, 0.03]} color="#1A222B" />
          <Box pos={[0, 0, 0.017]} size={[0.36, 0.18, 0.008]} color="#0B1A17" cast={false} />
          <Teks pos={[0, 0.035, 0.0225]} w={0.3} h={0.07} text="Rp 12.450.000" fg="#6EE7B7" />
          <Teks pos={[0, -0.04, 0.0225]} w={0.18} h={0.05} text="LUNAS" fg="#FDE68A" />
        </group>
        <Tube pos={[0.22, 0.25, -0.1]} r={0.012} h={0.22} color="#475569" seg={8} cast={false} />
        <Box pos={[0.22, 0.38, -0.1]} size={[0.14, 0.08, 0.02]} color="#1A222B" cast={false} />
        <Box pos={[0.22, 0.38, -0.088]} size={[0.11, 0.05, 0.004]} color="#6EE7B7" cast={false} />
      </group>
      <group position={[-0.38, 0.96, -0.1]}>
        <Box pos={[0, 0.045, 0]} size={[0.14, 0.09, 0.16]} color="#374151" cast={false} />
        <Box pos={[0, 0.14, -0.04]} size={[0.08, 0.12, 0.004]} color="#FFFFFF" cast={false} />
        <Box pos={[0, 0.05, 0.14]} size={[0.075, 0.003, 0.13]} color="#FFFFFF" rot={[0.3, 0, 0]} cast={false} />
      </group>
      {/* mesin EDC kartu */}
      <group position={[-0.5, 0.96, 0.2]} rotation={[0, 0.3, 0]}>
        <Box pos={[0, 0.02, 0]} size={[0.1, 0.035, 0.18]} color="#1F2937" rot={[-0.2, 0, 0]} cast={false} />
        <Box pos={[0, 0.042, -0.04]} size={[0.07, 0.004, 0.045]} color="#6EE7B7" rot={[-0.2, 0, 0]} cast={false} />
        {[0, 1, 2].map((r) => (
          <Box key={r} pos={[0, 0.042 - r * 0.0045 + 0.0, 0.01 + r * 0.03]} size={[0.07, 0.004, 0.02]} color="#E5E7EB" rot={[-0.2, 0, 0]} cast={false} />
        ))}
      </group>
      {/* pena rantai, bel layanan, koin */}
      <CangkirPena pos={[-0.2, 0.96, -0.2]} />
      <group position={[0.15, 0.96, 0.25]}>
        <Tube pos={[0, 0.008, 0]} r={0.065} h={0.016} color="#C9A227" seg={16} cast={false} />
        <mesh position={[0, 0.016, 0]}>
          <sphereGeometry args={[0.055, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshLambertMaterial color={EMAS} />
        </mesh>
        <Tube pos={[0, 0.078, 0]} r={0.012} h={0.02} color="#C9A227" seg={8} cast={false} />
      </group>
      <Box pos={[0.3, 0.965, 0.0]} size={[0.5, 0.012, 0.22]} color="#E8F3F1" cast={false} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Tube key={`a${i}`} pos={[0.1, 0.99 + i * 0.04, 0.0]} r={0.13} h={0.035} color={EMAS} seg={14} cast={false} />
      ))}
      {[0, 1, 2].map((i) => (
        <Tube key={`b${i}`} pos={[0.5, 0.99 + i * 0.04, 0.02]} r={0.13} h={0.035} color="#FBE08A" seg={14} cast={false} />
      ))}
      {/* tenda "BAYAR DI SINI" */}
      <group position={[0.85, 0.96, 0.26]}>
        <group position={[0, 0.1, 0]} rotation={[-0.25, 0, 0]}>
          <Box pos={[0, 0, 0]} size={[0.32, 0.2, 0.012]} color={EMAS} cast={false} />
          <Box pos={[0, 0, 0.007]} size={[0.3, 0.18, 0.006]} color="#2AA79B" cast={false} />
          <Teks pos={[0, 0, 0.0115]} w={0.26} h={0.1} text="BAYAR DI SINI" fg="#FFFFFF" />
        </group>
        <Box pos={[0, 0.1, -0.07]} size={[0.3, 0.19, 0.01]} color="#1F8F84" rot={[0.25, 0, 0]} cast={false} />
      </group>
      {/* tumpukan faktur + lampu meja */}
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          <Box pos={[1.15, 0.97 + i * 0.05, -0.12]} size={[0.6, 0.03, 0.34]} color="#2AA79B" cast={false} />
          <Box pos={[1.15, 1.0 + i * 0.05, -0.12]} size={[0.5, 0.03, 0.28]} color="#FFFFFF" cast={false} />
        </React.Fragment>
      ))}
      <LampuMeja pos={[1.5, 0.96, -0.25]} rotY={Math.PI} />
      {/* rak brosur */}
      <group position={[1.35, 0.96, 0.25]}>
        <Box pos={[0, 0.005, 0]} size={[0.26, 0.01, 0.12]} color="#CBD5E1" cast={false} />
        {['#34D399', '#60A5FA', '#FBBF24'].map((c, i) => (
          <Box key={c} pos={[-0.08 + i * 0.08, 0.08, -0.02 + i * 0.005]} size={[0.07, 0.14, 0.004]} color={c} rot={[-0.15, 0, 0]} cast={false} />
        ))}
      </group>
    </group>
  );
}

// [BARU] Papan alur penagihan (menggantikan satu jendela di dinding belakang): 4 amplop bertingkat dari pengingat sampai somasi.
function PapanTeguran({ pos }: { pos: V3 }) {
  const langkah: { t: string; s: string; c: string }[] = [
    { t: 'H-3', s: 'PENGINGAT', c: '#3B82F6' },
    { t: 'H+7', s: 'TEGURAN 1', c: '#F59E0B' },
    { t: 'H+14', s: 'TEGURAN 2', c: '#FB923C' },
    { t: 'H+30', s: 'SOMASI', c: '#EF4444' },
  ];
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.7, 0.95, 0.05]} color="#8FA3A0" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[1.62, 0.87, 0.02]} color="#F7FBFA" cast={false} />
      <Box pos={[0, 0.355, 0.045]} size={[1.62, 0.15, 0.01]} color="#2AA79B" cast={false} />
      <Teks pos={[0, 0.355, 0.052]} w={1.1} h={0.1} text="ALUR PENAGIHAN" fg="#FFFFFF" />
      {langkah.map((k, i) => {
        const x = -0.6 + i * 0.4;
        return (
          <React.Fragment key={k.t}>
            <Box pos={[x, 0.02, 0.043]} size={[0.34, 0.52, 0.006]} color="#E8F1EF" cast={false} />
            {/* amplop */}
            <Box pos={[x, 0.14, 0.05]} size={[0.26, 0.17, 0.008]} color="#FFFFFF" cast={false} />
            <Box pos={[x, 0.2, 0.056]} size={[0.26, 0.04, 0.004]} color={k.c} cast={false} />
            <Box pos={[x, 0.14, 0.056]} size={[0.08, 0.012, 0.004]} color={k.c} cast={false} />
            <Ball pos={[x, 0.115, 0.06]} r={0.02} color={k.c} flat={false} />
            <Teks pos={[x, -0.04, 0.054]} w={0.3} h={0.09} text={k.t} fg={k.c} />
            <Teks pos={[x, -0.13, 0.054]} w={0.32} h={0.06} text={k.s} fg="#475569" />
            <Box pos={[x, -0.2, 0.05]} size={[0.3, 0.04, 0.006]} color={k.c} cast={false} />
            {i < 3 && <Box pos={[x + 0.2, 0.14, 0.05]} size={[0.06, 0.016, 0.006]} color="#94A3B8" cast={false} />}
          </React.Fragment>
        );
      })}
      <Box pos={[0, -0.455, 0.08]} size={[1.5, 0.03, 0.1]} color="#8FA3A0" cast={false} />
      {['#3B82F6', '#F59E0B', '#FB923C', '#EF4444'].map((c, i) => (
        <Box key={c} pos={[-0.45 + i * 0.3, -0.425, 0.085]} size={[0.1, 0.03, 0.03]} color={c} cast={false} />
      ))}
    </group>
  );
}

// [BARU] Meja bundar negosiasi pelanggan (2 kursi, kontrak, pena, tumpukan koin) di atas karpet bundar teal-emas.
function MejaNegosiasi({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.009, 0]} r={1.72} h={0.006} color={EMAS} seg={40} cast={false} />
      <Tube pos={[0, 0.0125, 0]} r={1.64} h={0.008} color="#CFEBE6" seg={40} cast={false} />
      <Tube pos={[0, 0.0155, 0]} r={1.2} h={0.004} color="#9FD8D0" seg={40} cast={false} />
      {/* meja */}
      <Tube pos={[0, 0.03, 0]} r={0.3} h={0.05} color="#2F6F69" seg={24} />
      <Tube pos={[0, 0.4, 0]} r={0.07} h={0.7} color="#2F6F69" seg={12} />
      <Tube pos={[0, 0.745, 0]} r={0.66} h={0.04} color="#2AA79B" seg={32} />
      <Tube pos={[0, 0.775, 0]} r={0.62} h={0.03} color="#F6F1E6" seg={32} />
      {/* kontrak + salinan, pena, kalkulator kecil, tumpukan koin, cangkir */}
      <Box pos={[-0.12, 0.795, 0.05]} size={[0.3, 0.008, 0.4]} color="#FFFFFF" rot={[0, 0.2, 0]} cast={false} />
      <Box pos={[-0.12, 0.802, 0.05]} size={[0.22, 0.003, 0.012]} color="#CBD5D1" rot={[0, 0.2, 0]} cast={false} />
      <Box pos={[-0.1, 0.802, 0.1]} size={[0.22, 0.003, 0.012]} color="#E2E8E6" rot={[0, 0.2, 0]} cast={false} />
      <Box pos={[-0.08, 0.802, 0.16]} size={[0.12, 0.003, 0.03]} color="#2AA79B" rot={[0, 0.2, 0]} cast={false} />
      <Box pos={[0.22, 0.797, -0.02]} size={[0.3, 0.008, 0.4]} color="#FFFFFF" rot={[0, -0.25, 0]} cast={false} />
      <Box pos={[0.22, 0.803, -0.02]} size={[0.22, 0.003, 0.012]} color="#CBD5D1" rot={[0, -0.25, 0]} cast={false} />
      <Box pos={[0.05, 0.81, 0.18]} size={[0.01, 0.01, 0.15]} color="#111827" rot={[0, 0.8, 0]} cast={false} />
      {[0, 1, 2, 3].map((i) => (
        <Tube key={i} pos={[0.03, 0.8 + i * 0.016, -0.3]} r={0.05} h={0.014} color={EMAS} seg={14} cast={false} />
      ))}
      <Mug pos={[-0.38, 0.795, -0.2]} color="#A7F3D0" steam seed={1.3} />
      <Box pos={[0.4, 0.812, 0.22]} size={[0.14, 0.02, 0.2]} color="#374151" cast={false} />
      <Box pos={[0.4, 0.824, 0.21]} size={[0.11, 0.004, 0.06]} color="#6EE7B7" cast={false} />
    </group>
  );
}

// [BARU] Tumpukan uang tunai (ikatan dengan pita kertas).
function TumpukUang({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          <Box pos={[0, 0.022 + i * 0.044, 0]} size={[0.17, 0.04, 0.08]} color="#4E9C69" cast={false} />
          <Box pos={[0, 0.022 + i * 0.044, 0]} size={[0.04, 0.043, 0.082]} color="#F3F6F4" cast={false} />
        </React.Fragment>
      ))}
      <Box pos={[0.2, 0.02, 0.02]} size={[0.17, 0.04, 0.08]} color="#4E9C69" rot={[0, 0.3, 0]} cast={false} />
      <Box pos={[0.2, 0.02, 0.02]} size={[0.04, 0.043, 0.082]} color="#F3F6F4" rot={[0, 0.3, 0]} cast={false} />
    </group>
  );
}

// [BARU] Standing banner (roll-up) pengingat pembayaran, menghadap +z lokal.
function BannerBayar({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.03, 0]} size={[0.74, 0.06, 0.2]} color="#2F6F69" />
      <Box pos={[0, 0.062, 0]} size={[0.7, 0.012, 0.16]} color={EMAS} cast={false} />
      <Box pos={[0, 0.9, -0.01]} size={[0.62, 1.6, 0.02]} color="#F7FBFA" />
      <Box pos={[0, 1.63, -0.01]} size={[0.66, 0.04, 0.03]} color="#8FA3A0" cast={false} />
      <Box pos={[0, 1.5, 0.003]} size={[0.62, 0.22, 0.01]} color="#2AA79B" cast={false} />
      <Teks pos={[0, 1.54, 0.011]} w={0.5} h={0.07} text="BAYAR" fg="#FFFFFF" />
      <Teks pos={[0, 1.46, 0.011]} w={0.5} h={0.07} text="TEPAT WAKTU" fg={EMAS} />
      <Tube pos={[0, 1.0, 0.004]} r={0.2} h={0.012} color="#D9A91C" rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      <Tube pos={[0, 1.0, 0.01]} r={0.17} h={0.01} color={EMAS} rot={[Math.PI / 2, 0, 0]} seg={28} cast={false} />
      <Teks pos={[0, 1.0, 0.017]} w={0.26} h={0.2} text="Rp" fg="#9A6B00" />
      <Teks pos={[0, 0.66, 0.011]} w={0.5} h={0.06} text="TRANSFER - QRIS - TUNAI" fg="#2F6F69" />
      {['#34D399', '#60A5FA', '#F5C84C'].map((c, i) => (
        <Box key={c} pos={[-0.17 + i * 0.17, 0.5, 0.008]} size={[0.13, 0.1, 0.006]} color={c} cast={false} />
      ))}
      <Teks pos={[0, 0.3, 0.011]} w={0.5} h={0.05} text="TERIMA KASIH" fg="#475569" />
      <Teks pos={[0, 0.23, 0.011]} w={0.5} h={0.05} text="ATAS KEPERCAYAAN ANDA" fg="#94A3B8" />
    </group>
  );
}

// Ruang Account Receivable: meja & kursi (ukuran meja = meja Transactions), loket, dekorasi dinding, area tunggu, lampu.
// 3 meja = 3 AI penghuni (lihat ArPenghuni). Label meja = papan nama di <Desk />.
const AR_MEJA: { p: [number, number]; label: string; varian: number }[] = [
  { p: [-8.0, -3.4], label: 'BILLING', varian: 0 }, // Kilo
  { p: [-4.4, -3.4], label: 'COLLECTION', varian: 1 }, // Lumen
  { p: [-8.0, -0.5], label: 'RECONCILE', varian: 2 }, // Matrix
];

function RuangAR() {
  return (
    <group position={[-13.2, 0, 0]}>
      {/* grup tetap di x = -13.2 (pintu & meja tidak bergeser); ruangan membentang x lokal -9..5 */}
      <ArLantai />
      <ArDinding />
      <CahayaAR />

      {/* dinding belakang (z = -5.5): rak buku mini + jendela (zona istirahat), jendela, lampu, jam, papan status invoice, apar */}
      <Bookshelf pos={[-8.0, 0, -5.28]} />
      <Window pos={[-6.2, 1.0, -5.46]} w={1.6} />
      {/* [DIHAPUS] jendela di belakang Lumen (x -3.6) -> diganti papan alur penagihan */}
      <PapanTeguran pos={[-3.6, 1.0, -5.455]} />
      <LampuDinding pos={[-2.15, 1.15, -5.5]} />
      <Clock pos={[-1.2, 1.15, -5.46]} />
      <PapanInvoice pos={[1.35, 0.98, -5.455]} />
      <LampuDinding pos={[2.9, 1.15, -5.5]} />
      {/* [DIHAPUS] jendela sudut kanan atas (di belakang monumen koin) */}
      <Extinguisher pos={[4.7 + AR_DX, 0.28, -5.4]} />
      <Kredensa pos={[-1.3, 0, -5.2]} />
      <KotakKartu pos={[-2.15, 0.76, -5.1]} />
      <CekBuku pos={[-0.95, 0.76, -5.0]} />
      {/* [BARU] pajangan dinding kosong di belakang lounge (gaya papan nama AP, warna AR teal & emas): papan nama + 3 label status piutang */}
      <group position={[4.2, 0, -5.46]}>
        <Box pos={[0, 1.15, -0.005]} size={[1.78, 0.4, 0.03]} color={EMAS} cast={false} />
        <Box pos={[0, 1.15, 0]} size={[1.7, 0.34, 0.04]} color="#F8F9FB" cast={false} />
        <Teks pos={[0, 1.15, 0.03]} w={1.62} h={0.26} text="ACCOUNT RECEIVABLE" fg="#FFFFFF" bg="#1F8F84" />
        {['#2DD4BF', '#F5C84C', '#60A5FA'].map((c, i) => (
          <Box key={c} pos={[-0.45 + i * 0.45, 0.88, 0.02]} size={[0.34, 0.1, 0.02]} color={c} cast={false} />
        ))}
      </group>

      {/* dinding barat (x = AR_X0 = -9, dinding luar baru): jendela, lampu, dispenser air, grafik umur piutang, papan gabus, rak surat, jendela */}
      <Window pos={[-8.96 - GESER_BARAT, 1.0, -3.6]} rotY={Math.PI / 2} w={1.4} />
      <LampuDinding pos={[-9.0 - GESER_BARAT, 1.15, -2.5]} rotY={Math.PI / 2} />
      <WaterCooler pos={[-8.7 - GESER_BARAT, 0, -1.95]} rotY={Math.PI / 2} />
      <AgingChart pos={[-8.94 - GESER_BARAT, 1.0, -0.6]} rotY={Math.PI / 2} />
      <PapanGabus pos={[-8.96 - GESER_BARAT, 1.0, 1.2]} rotY={Math.PI / 2} />
      <MailRack pos={[-8.75 - GESER_BARAT, 0, 2.6]} rotY={Math.PI / 2} />
      <Window pos={[-8.96 - GESER_BARAT, 1.0, 4.4]} rotY={Math.PI / 2} w={1.4} />

      {/* meja kerja (seukuran meja Transactions) + kursi + tempat sampah */}
      {AR_MEJA.map(({ p: [x, z], label, varian }, i) => (
        <React.Fragment key={`${x}${z}`}>
          <Desk pos={[x, 0, z]} page="ar" label={label} varian={varian} seatKey={`ar:${i}`} />
          <Chair pos={[x, 0, z + 0.85]} color="#2AA79B" />
          <TrashBin pos={[x + 1.12, 0, z + 0.25]} />
        </React.Fragment>
      ))}

      {/* loket tagihan + antrean */}
      {/* [DIPINDAH] loket tepat di ujung utara karpet pintu masuk (x -0.5), menghadap pintu */}
      <BillingCounter pos={[-0.5, 0, 1.3]} />
      {/* [DIUBAH] tiang antrean VERTIKAL (sejajar sumbu z), satu set di kiri & satu set di kanan karpet pintu masuk (karpet x -1.1..0.1) */}
      {[-1.5, 0.5].map((x) => (
        <React.Fragment key={x}>
          {[2.4, 3.6, 4.8].map((z) => (
            <TiangAntri key={z} pos={[x, 0, z]} />
          ))}
          {[3.0, 4.2].map((z) => (
            <Box key={z} pos={[x, 0.78, z]} size={[0.01, 0.05, 1.2]} color="#2AA79B" cast={false} />
          ))}
        </React.Fragment>
      ))}
      <TiketAntrian pos={[-2.6, 0, 1.3]} rotY={0} /> {/* [DIPINDAH] di kiri meja administrasi, menghadap pintu */}

      {/* monumen koin + plakat */}
      {/* [DIPINDAH] sudut kanan atas, di depan bekas jendela; plakat hitam menghadap pintu masuk (x -0.5, z 5.6) */}
      <CoinMonument pos={[5.9, 0, -4.5]} plakatPos={[-0.45, 0, 0.95]} plakatRot={-0.56} />


      {/* [BARU] area istirahat (lounge) di zona barat: dua sofa berhadapan, meja kopi, bean bag, lampu lantai.
          Jalan lapang x -4.6..-3.3 di antara lounge dan meja kerja, dan ruang kosong di tengah ruangan untuk AI berjalan-jalan. */}
      <Sofa pos={[3.3, 0, -2.5]} rotY={Math.PI} color="#E0A33F" />
      <Sofa pos={[3.3, 0, 1.3]} rotY={0} color="#E0A33F" />
      <CoffeeTable pos={[3.3, 0, -0.6]} />
      <Mug pos={[3.5, 0.43, -0.55]} color="#F3F4F6" steam seed={2} />
      <Beanbag pos={[1.6, 0, -1.1]} color="#F9C74F" s={0.85} />
      <Beanbag pos={[1.6, 0, 0.1]} color="#90BE6D" s={0.85} />
      <FloorLamp pos={[4.8, 0, -0.6]} />

      {/* sisi kanan: lemari arsip + printer */}
      {[-1.6, -0.4].map((z) => (
        <group key={z} position={[4.72 + AR_DX, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
          <Cabinet pos={[0, 0, 0]} color="#DDEDEA" />
          <Box pos={[-0.3, 1.46, 0]} size={[0.1, 0.12, 0.3]} color="#2AA79B" cast={false} />
          <Box pos={[-0.18, 1.46, 0]} size={[0.1, 0.12, 0.3]} color="#F59E0B" cast={false} />
          <Box pos={[-0.06, 1.46, 0]} size={[0.1, 0.12, 0.3]} color="#3B82F6" cast={false} />
        </group>
      ))}
      <PrinterStation pos={[4.6 + AR_DX, 0, 1.9]} rotY={-Math.PI / 2} />

      {/* [BARU] sudut konsultasi pelanggan (barat daya): meja negosiasi bundar + 2 kursi; jalur agen (z <= 2.0) tetap kosong */}
      <MejaNegosiasi pos={[-6.2, 0, 3.9]} />
      <Chair pos={[-7.25, 0, 3.9]} rotY={-Math.PI / 2} color="#2AA79B" />
      <Chair pos={[-5.15, 0, 3.9]} rotY={Math.PI / 2} color="#2AA79B" />
      <Kolam pos={[-6.2, 0.02, 3.9]} size={[3.4, 3.0]} color="#E6FFF8" opacity={0.05} />

      {/* [BARU] brankas kas + uang tunai + karung koin di dinding barat, troli nota & banner pengingat bayar di sisi selatan */}
      <BrankasKas pos={[-10.25, 0, 3.7]} rotY={Math.PI / 2} />
      <TumpukUang pos={[-10.25, 0.6, 3.7]} rotY={Math.PI / 2} />
      <KarungUang pos={[-9.55, 0, 3.15]} />
      <KarungUang pos={[-9.4, 0, 3.55]} />
      <TroliDokumen pos={[-3.3, 0, 4.7]} />
      <BannerBayar pos={[-2.55, 0, 3.5]} />

      {/* tanaman */}
      <PlantPalm pos={[0.3, 0, -4.6]} scale={1.0} /> {/* [DIPINDAH] dari (-4.3,-4.6): bentrok dengan meja Collection setelah meja dipindah ke kiri */}
      <PlantBush pos={[-8.4 - GESER_BARAT, 0, 4.9]} scale={0.8} />
      <PlantSnake pos={[-8.5 - GESER_BARAT, 0, -4.4]} scale={0.9} />
      <PlantSnake pos={[4.4 + AR_DX, 0, 4.7]} scale={1.0} />
      <FloorLamp pos={[4.4 + AR_DX, 0, 3.0]} />
      <ArPenghuni />
    </group>
  );
}


// ---- Account Payable (kanan-atas) — koral & merah: "uang keluar". ----
// [DIPERDETAIL] Ruangan AP: lantai ubin + karpet per area, dinding berpanel, jendela bergorden + sinar matahari lembut,
// kalender jatuh tempo, grafik umur utang, 4 meja putih modern (ukuran SAMA dengan meja Transactions: 1.72 x 0.88, tinggi 0.82)
// dengan 2 monitor yang MENYALA saat ada AI duduk (seatKey `ap:i`, sama seperti ruang Transactions), meja persetujuan,
// rak surat keluar, stempel raksasa, arsip bukti bayar, brankas kas kecil, penghancur kertas, printer cek, dan area tunggu.
// [DIPERLUAS] Ruangan kini 14 x 11 (sama dengan AR): koordinat lokal x -5..9, z -5.5..5.5 (grup tetap di x = 13.2, jadi pintu & meja lama tidak bergeser).
// Pintu di x = -0.4 (z = 5.6); jalur agen ke ap_tengah (-0.4, 2.0) harus tetap kosong.

// Kata-kata yang bergulir di layar meja AP (utang usaha).
const AP_KATA = ['Vendor', 'Bill', 'Utang', 'Bayar', 'Jatuh Tempo', 'PPh23', 'PPN Masuk', 'Giro', 'Transfer', 'Voucher', 'Approve', 'Saldo', 'Total', 'Rp', 'Supplier', 'PO', 'GRN', 'Aging', 'Kas', 'Bank'];

// 4 meja = 4 tab halaman Accounts Payable (Bills, Payments, Vendor Statements, Aging). Urutan = seatKey `ap:i`.
// [DIUBAH] Semua meja kerja (beserta karpet, kursi, tempat sampah) digeser ke KANAN mentok sejauh -AP_GS (negatif = ke kanan), menyisakan celah kecil ke perabot dinding timur.
// Meja Aging (Omni) ikut mentok kanan sejajar meja paling kanan (AP_OMNI_X). Meja bundar vendor dipindah ke sudut kiri-belakang yang kosong.
const AP_GS = -2.7;
// Baris kedua (di belakang kursi baris atas): meja Bills di belakang meja Payments (Nexus), meja Aging (Omni) di belakang meja Vendors.
const AP_OMNI_X = 3.0 - AP_GS;
const AP_BILLS_X = 0 - AP_GS;
const AP_MEJA: { p: [number, number]; label: string; varian: number }[] = [
  { p: [AP_BILLS_X, 0.6], label: 'BILLS', varian: 0 },
  { p: [0 - AP_GS, -3.1], label: 'PAYMENTS', varian: 1 }, // Nexus
  { p: [3.0 - AP_GS, -3.1], label: 'VENDORS', varian: 2 },
  { p: [AP_OMNI_X, 0.6], label: 'AGING', varian: 3 }, // Omni
  { p: [6.0 - AP_GS, -3.1], label: 'MATCHING', varian: 4 }, // [BARU] 3-way match: PO / GRN / Invoice (seatKey ap:4, belum ada AI)
];

// Lantai: ubin 1x1 rose-krem (sorot tepi + urat halus), list lantai koral, garis tipis, karpet per area, keset pintu.
// [DIUBAH] Grup AP kini ikut batas Transactions|AP (AP_GX; dulu tetap 13.2). Dinding barat lokal tetap -6.2667 (isi ruangan tidak bergeser terhadap dindingnya),
// dinding timur lokal mengikuti dinding luar baru (AP_X1; dulu 9). AP_DXE = berapa dinding timur bergeser (benda yang menempel di dinding timur ikut).
const AP_X0 = -6.2667;
const AP_GX = ATAS_B2 + 0.1 - AP_X0; // posisi grup AP di dunia
const AP_X1 = ATAS_XR - 0.1 - AP_GX;
const AP_W = AP_X1 - AP_X0;
const AP_CX = (AP_X0 + AP_X1) / 2;
const AP_DX = AP_X0 + 5; // dinding barat AP bergeser sebesar ini (benda yang menempel di dinding barat ikut)
const AP_DXE = AP_X1 - 9; // dinding timur AP bergeser sebesar ini (benda yang menempel di dinding timur ikut)
function ApLantai() {
  // [DIPERDETAIL] lantai porselen terrazzo rose: ubin 1x1 bersorot tepi, serpihan krem/koral/rose, urat halus. Kanvas = 2 x 2 ubin.
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    if (g) {
      const r = mulberry32(23);
      const dasarWarna = ['#F8E4DF', '#F4DDD7', '#F6E1DB', '#F9E8E3'];
      const serpih = ['rgba(255,247,244,0.7)', 'rgba(231,168,162,0.5)', 'rgba(216,131,125,0.42)', 'rgba(183,107,107,0.3)', 'rgba(255,255,255,0.55)'];
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * 256, y = Math.floor(i / 2) * 256;
        g.fillStyle = dasarWarna[i];
        g.fillRect(x, y, 256, 256);
        g.save();
        g.beginPath();
        g.rect(x, y, 256, 256);
        g.clip();
        for (let k = 0; k < 3; k++) {
          g.strokeStyle = `rgba(200,130,125,${0.1 + r() * 0.1})`;
          g.lineWidth = 1 + r() * 1.6;
          g.beginPath();
          const sx = x + r() * 256, sy = y + r() * 256;
          g.moveTo(sx, sy);
          g.bezierCurveTo(sx + (r() - 0.5) * 160, sy + (r() - 0.5) * 160, sx + (r() - 0.5) * 240, sy + (r() - 0.5) * 240, sx + (r() - 0.5) * 300, sy + (r() - 0.5) * 300);
          g.stroke();
        }
        for (let k = 0; k < 150; k++) {
          g.fillStyle = serpih[Math.floor(r() * serpih.length)];
          g.beginPath();
          g.ellipse(x + r() * 256, y + r() * 256, 1.2 + r() * 4.2, 1 + r() * 2.6, r() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.34)';
        g.fillRect(x + 2, y + 2, 252, 2);
        g.fillRect(x + 2, y + 2, 2, 252);
        g.fillStyle = 'rgba(190,110,105,0.16)';
        g.fillRect(x + 2, y + 252, 252, 2);
        g.fillRect(x + 252, y + 2, 2, 252);
      }
      g.fillStyle = '#E5BDB7';
      for (const o of [0, 256, 510]) {
        g.fillRect(o - 1, 0, 3, 512);
        g.fillRect(0, o - 1, 512, 3);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(AP_W / 2, 5.5); // 1 ubin = 1 unit (kanvas = 2 x 2 ubin)
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  return (
    <group>
      <Lantai cx={AP_CX} w={AP_W} d={11} color={TH.ap.floor} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[AP_CX, 0.003, 0]} receiveShadow>
        <planeGeometry args={[AP_W, 11]} />
        <meshLambertMaterial map={tex} />
      </mesh>
      {/* list lantai koral di sepanjang dinding + garis krem tipis di dalamnya */}
      <Box pos={[AP_CX, 0.007, -5.33]} size={[AP_W - 0.2, 0.008, 0.3]} color="#EBA9A3" cast={false} />
      <Box pos={[AP_CX, 0.007, 5.33]} size={[AP_W - 0.2, 0.008, 0.3]} color="#EBA9A3" cast={false} />
      <Box pos={[AP_X0 + 0.17, 0.007, 0]} size={[0.3, 0.008, 10.4]} color="#EBA9A3" cast={false} />
      <Box pos={[AP_X1 - 0.17, 0.007, 0]} size={[0.3, 0.008, 10.4]} color="#EBA9A3" cast={false} />
      <Box pos={[AP_CX, 0.0105, -5.1]} size={[AP_W - 0.6, 0.003, 0.025]} color="#FFF1EE" cast={false} />
      <Box pos={[AP_CX, 0.0105, 5.1]} size={[AP_W - 0.6, 0.003, 0.025]} color="#FFF1EE" cast={false} />
      <Box pos={[AP_X0 + 0.4, 0.0105, 0]} size={[0.025, 0.003, 10.2]} color="#FFF1EE" cast={false} />
      <Box pos={[AP_X1 - 0.4, 0.0105, 0]} size={[0.025, 0.003, 10.2]} color="#FFF1EE" cast={false} />
      {/* karpet: area meja kerja (3 meja belakang), meja Aging (Omni), meja persetujuan, lorong masuk, area tunggu */}
      <Karpet pos={[5.7, 0, -2.95]} w={8.6} d={3.3} dasar="#F2D3CE" tepi="#E0868A" />
      {[1.5, 4.5].map((x) => (
        <Box key={x} pos={[x - AP_GS, 0.0165, -2.95]} size={[0.03, 0.002, 2.8]} color="#E9B5B0" cast={false} />
      ))}
      <Karpet pos={[AP_BILLS_X + 0.1, 0, 1.1]} w={2.8} d={2.4} dasar="#F3E3DC" tepi="#E0868A" />
      <Karpet pos={[AP_OMNI_X, 0, 1.1]} w={3.0} d={2.4} dasar="#F3E3DC" tepi="#E0868A" />
      <Karpet pos={[-2.6, 0, 4.0]} w={2.0} d={2.6} dasar="#EBD9D4" tepi="#C77F78" />
      <Karpet pos={[-0.4, 0, 4.0]} w={1.2} d={3.0} dasar="#E5566A" tepi="#B83E50" />
      <Karpet pos={[8.7, 0, 3.75]} w={3.4} d={2.8} dasar="#F6E2D3" tepi="#D9606B" />
      {/* [BARU] karpet area perluasan: meja vendor, pantry */}
      <Karpet pos={[-3.3, 0, -3.0]} w={3.4} d={3.4} dasar="#F3E3DC" tepi="#E0868A" />
      {/* [BARU] ambang pintu: pita anggur + garis krem */}
      <Box pos={[-0.4, 0.007, 5.44]} size={[2.0, 0.012, 0.12]} color={AP_ANGGUR} cast={false} />
      <Box pos={[-0.4, 0.0135, 5.44]} size={[1.9, 0.002, 0.03]} color="#FFF1EE" cast={false} />
      {/* keset pintu */}
      <Karpet pos={[-0.4, 0, 5.0]} w={1.5} d={0.8} dasar="#B83E50" tepi="#8F2E3E" emas={false} naik={0.004} />
      <Teks pos={[-0.4, 0.0215, 5.0]} rot={[-Math.PI / 2, 0, 0]} w={1.3} h={0.2} text="BAYAR TEPAT WAKTU" fg="#F5C84C" />
      {/* medali lantai tengah (sama seperti Financial Statements & Asset): cincin koral + cakram krem + tulisan, warna ruang AP */}
      <CincinLantai pos={[-3.3, 0.02, 0.7]} r={0.95} lebar={0.045} color="#E5566A" opacity={0.95} />
      <CincinLantai pos={[-3.3, 0.02, 0.7]} r={0.72} lebar={0.025} color="#8F2E3E" opacity={0.9} />
      <Tube pos={[-3.3, 0.012, 0.7]} r={0.7} h={0.012} color="#FFF1EE" seg={40} cast={false} />
      <Teks pos={[-3.3, 0.026, 0.6]} rot={[-Math.PI / 2, 0, 0]} w={1.15} h={0.22} text="ACCOUNT" fg="#8F2E3E" />
      <Teks pos={[-3.3, 0.026, 0.83]} rot={[-Math.PI / 2, 0, 0]} w={1.15} h={0.2} text="PAYABLE" fg="#C94A5A" />
    </group>
  );
}

// ---- [BARU] Dinding Account Payable: panel alur koral, kertas dinding rose bermotif faktur & panah bayar, rel krem, list atas + LED hangat ----
const AP_ANGGUR = '#8F2E3E';
const AP_MERAH = '#C94A5A';
const AP_KRIM = '#FFF1EE';

// Panel beralur (fluted) koral: alur vertikal bersorot kiri-gelap kanan. Tile 1.0 x 0.48.
function PanelAlurAP({ pos, w, h = 0.48 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 128, (g, W, H) => {
    g.fillStyle = '#D8837D';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i++) {
      const x = i * 32 + 2;
      const gr = g.createLinearGradient(x, 0, x + 28, 0);
      gr.addColorStop(0, '#EDA9A2');
      gr.addColorStop(0.55, '#E3968F');
      gr.addColorStop(1, '#D17D77');
      g.fillStyle = gr;
      g.fillRect(x, 0, 28, H);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x, 0, 2, H);
      g.fillStyle = 'rgba(120,40,45,0.22)';
      g.fillRect(x + 26, 0, 2, H);
    }
    g.fillStyle = 'rgba(255,241,238,0.35)';
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(120,40,45,0.25)';
    g.fillRect(0, H - 2, W, 2);
  }, 'ap-panel-alur');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Kertas dinding rose: pinstripe halus + faktur (invoice) dan panah keluar-dalam-lingkaran (pembayaran) bergantian. Tile 2.0 x 0.825.
function KertasDindingAP({ pos, w, h = 0.825 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(640, 264, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#FCEAE6');
    gr.addColorStop(1, '#F6D9D3');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (let x = 4; x < W; x += 12) g.fillRect(x, 0, 1, H);
    g.fillStyle = 'rgba(201,74,90,0.06)';
    for (let y = 22; y < H; y += 44) g.fillRect(0, y, W, 1);
    const ikon = (cx: number, cy: number, jenis: number) => {
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = 'rgba(201,74,90,0.34)';
      g.fillStyle = 'rgba(201,74,90,0.12)';
      g.lineWidth = 2;
      if (jenis === 0) {
        // faktur: lembar bersudut lipat + baris teks
        g.beginPath();
        g.moveTo(-12, -16); g.lineTo(6, -16); g.lineTo(12, -10); g.lineTo(12, 16); g.lineTo(-12, 16);
        g.closePath();
        g.fill(); g.stroke();
        g.beginPath(); g.moveTo(6, -16); g.lineTo(6, -10); g.lineTo(12, -10); g.stroke();
        g.lineWidth = 1.6;
        for (const y of [-3, 3, 9]) { g.beginPath(); g.moveTo(-7, y); g.lineTo(7, y); g.stroke(); }
      } else {
        // pembayaran keluar: lingkaran + panah ke kanan-atas
        g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(-6, 6); g.lineTo(6, -6); g.stroke();
        g.beginPath(); g.moveTo(-1, -6); g.lineTo(6, -6); g.lineTo(6, 1); g.stroke();
      }
      g.restore();
    };
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) {
        const x = i * 160 + 80 + (j % 2 ? 80 : 0);
        const y = 44 + j * 88;
        const jenis = (i + j) % 2;
        ikon(x, y, jenis);
        if (x > W - 30) ikon(x - W, y, jenis);
        // titik penghubung kecil antar ikon
        g.fillStyle = 'rgba(201,74,90,0.28)';
        g.beginPath(); g.arc(x + 40, y + 44, 2.4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(x - 40, y + 44, 2.4, 0, Math.PI * 2); g.fill();
      }
    }
  }, 'ap-kertas-dinding');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w / 2), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias dinding AP (menghadap +z lokal, x sepanjang dinding, z = keluar dari permukaan dinding).
function DindingDekorAP({ segs }: { segs: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        return (
          <React.Fragment key={`dp${a}`}>
            <PanelAlurAP pos={[cx, 0.38, 0.008]} w={L} />
            <Box pos={[cx, 0.07, 0.025]} size={[L, 0.14, 0.05]} color="#C77F78" cast={false} />
            <Box pos={[cx, 0.145, 0.03]} size={[L, 0.012, 0.06]} color={AP_KRIM} cast={false} />
            <Box pos={[cx, 0.645, 0.035]} size={[L, 0.04, 0.07]} color={AP_KRIM} cast={false} />
            <Box pos={[cx, 0.668, 0.036]} size={[L, 0.008, 0.072]} color={AP_MERAH} cast={false} />
            <Cahaya pos={[cx, 0.622, 0.02]} size={[L - 0.02, 0.008, 0.004]} color="#FFD0CA" opacity={0.85} />
            <KertasDindingAP pos={[cx, 1.08, 0.003]} w={L} />
            <Box pos={[cx, 1.5, 0.02]} size={[L, 0.025, 0.04]} color={AP_MERAH} cast={false} />
            <Box pos={[cx, 1.545, 0.024]} size={[L, 0.05, 0.048]} color={AP_KRIM} cast={false} />
            <Cahaya pos={[cx, 1.578, 0.014]} size={[L - 0.02, 0.008, 0.008]} color="#FFE3DE" opacity={0.9} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Tiang sudut: kolom koral tua berlis krem (tinggi dinding).
function TiangSudutAP({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.8, 0]} size={[0.22, 1.6, 0.22]} color={AP_ANGGUR} />
      <Box pos={[0, 0.8, 0]} size={[0.24, 1.6, 0.03]} color={AP_KRIM} cast={false} />
      <Box pos={[0, 0.8, 0]} size={[0.03, 1.6, 0.24]} color={AP_KRIM} cast={false} />
      <Box pos={[0, 0.03, 0]} size={[0.27, 0.06, 0.27]} color="#6A1F2D" cast={false} />
      <Box pos={[0, 1.55, 0]} size={[0.26, 0.05, 0.26]} color="#6A1F2D" cast={false} />
      <Cahaya pos={[0, 1.58, 0]} size={[0.2, 0.012, 0.2]} color="#FFE3DE" opacity={0.9} />
    </group>
  );
}

// Dinding belakang (z = -5.5) dan barat (partisi ke Transactions) + tiang sudut.
function ApDinding() {
  return (
    <group>
      <group position={[0, 0, -5.5]}>
        <DindingDekorAP segs={[[AP_X0, AP_X1]]} />
      </group>
      <group position={[AP_X0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorAP segs={[[-5.5, 5.5]]} />
      </group>
      <TiangSudutAP pos={[AP_X1 - 0.11, 0, -5.39]} />
      <TiangSudutAP pos={[AP_X0 + 0.11, 0, 5.39]} />
    </group>
  );
}

// Kerai (blind) gulung setengah turun di jendela + tali penarik. Koordinat sama dengan <Window /> (+z = ke dalam ruangan).
function Kerai({ pos, w }: { pos: V3; w: number }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.4, 0.075]} size={[w - 0.1, 0.045, 0.06]} color="#FFFFFF" cast={false} />
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={i} pos={[0, 0.34 - i * 0.04, 0.072]} size={[w - 0.22, 0.026, 0.018]} color={i % 2 ? '#FBE9E6' : '#FFFFFF'} cast={false} />
      ))}
      <Box pos={[w / 2 - 0.2, 0.12, 0.082]} size={[0.006, 0.5, 0.006]} color="#E5566A" cast={false} />
      <Box pos={[w / 2 - 0.2, -0.13, 0.082]} size={[0.02, 0.04, 0.02]} color="#E5566A" cast={false} />
    </group>
  );
}

// Kalender dinding "JATUH TEMPO" (satu tekstur kanvas): bulan & tanggal nyata, hari ini dilingkari,
// merah = tagihan jatuh tempo, hijau = sudah dibayar.
function DueCalendar({ pos }: { pos: V3 }) {
  const tex = useMemo(() => {
    const W = 640, H = 540;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (g) {
      const now = new Date();
      const th = now.getFullYear(), bl = now.getMonth(), hariIni = now.getDate();
      const awal = (new Date(th, bl, 1).getDay() + 6) % 7; // Senin = 0
      const jml = new Date(th, bl + 1, 0).getDate();
      const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
      const HARI = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
      const FONT = 'Inter, system-ui, sans-serif';
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#E5566A';
      g.fillRect(0, 0, W, 86);
      g.fillStyle = '#FFFFFF';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `800 38px ${FONT}`;
      g.fillText('JATUH TEMPO UTANG', 28, 32);
      g.font = `600 26px ${FONT}`;
      g.fillText(`${BULAN[bl]} ${th}`, 28, 64);
      const cw = 592 / 7;
      g.textAlign = 'center';
      g.font = `700 20px ${FONT}`;
      HARI.forEach((h, i) => {
        g.fillStyle = i >= 5 ? '#E5566A' : '#64748B';
        g.fillText(h, 24 + cw * i + cw / 2, 112);
      });
      const r = mulberry32(th * 12 + bl);
      for (let d = 1; d <= jml; d++) {
        const idx = awal + d - 1;
        const col = idx % 7, row = Math.floor(idx / 7);
        const x = 24 + col * cw + 3, y = 130 + row * 58 + 2;
        const p = r();
        const jatuhTempo = d >= hariIni && p < 0.25 && col < 5;
        const lunas = d < hariIni && p < 0.35 && col < 5;
        g.fillStyle = jatuhTempo ? '#FCA5A5' : lunas ? '#86EFAC' : '#F1F5F9';
        g.fillRect(x, y, cw - 6, 52);
        g.fillStyle = jatuhTempo ? '#7F1D1D' : lunas ? '#14532D' : col >= 5 ? '#E5566A' : '#475569';
        g.font = `700 24px ${FONT}`;
        g.fillText(String(d), x + (cw - 6) / 2, y + 22);
        if (jatuhTempo || lunas) {
          g.fillStyle = jatuhTempo ? '#B91C1C' : '#15803D';
          g.fillRect(x + (cw - 6) / 2 - 14, y + 40, 28, 5);
        }
        if (d === hariIni) {
          g.strokeStyle = '#1E293B';
          g.lineWidth = 4;
          g.strokeRect(x + 1, y + 1, cw - 8, 50);
        }
      }
      // legenda
      g.textAlign = 'left';
      g.font = `600 18px ${FONT}`;
      const leg: [string, string][] = [['#FCA5A5', 'Jatuh tempo'], ['#86EFAC', 'Sudah dibayar'], ['#1E293B', 'Hari ini']];
      leg.forEach(([cc, t], i) => {
        const lx = 28 + i * 200;
        if (i === 2) { g.strokeStyle = cc; g.lineWidth = 3; g.strokeRect(lx, 506, 20, 20); }
        else { g.fillStyle = cc; g.fillRect(lx, 506, 20, 20); }
        g.fillStyle = '#475569';
        g.fillText(t, lx + 30, 517);
      });
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  return (
    <group position={pos} scale={0.7}>
      <Box pos={[0, 0, 0]} size={[2.0, 1.72, 0.05]} color="#8A5A55" cast={false} />
      <mesh position={[0, -0.01, 0.027]}>
        <planeGeometry args={[1.9, 1.6]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <Box key={x} pos={[x, 0.88, 0.04]} size={[0.06, 0.12, 0.06]} color="#2B3340" cast={false} />
      ))}
      {/* paku payung + pena bertali */}
      <Box pos={[0.92, -0.2, 0.04]} size={[0.006, 0.5, 0.006]} color="#475569" cast={false} />
      <Box pos={[0.92, -0.5, 0.04]} size={[0.02, 0.14, 0.02]} color="#111827" cast={false} />
    </group>
  );
}

// Meja persetujuan (berdiri): meja putih berkaki kayu ek, ukuran 1.6 x 0.8. Stempel besar, bantalan tinta, voucher, dokumen persetujuan, baki masuk/keluar.
function StampTable({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const Y = 0.815;
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.79, 0]} size={[1.6, 0.05, 0.8]} color="#F8F9FB" />
      <Box pos={[0, 0.752, 0]} size={[1.5, 0.026, 0.7]} color="#E4E9EE" cast={false} />
      <Box pos={[0, 0.79, 0.4015]} size={[1.6, 0.02, 0.004]} color="#E5566A" cast={false} />
      {[[-0.72, -0.34], [0.72, -0.34], [-0.72, 0.34], [0.72, 0.34]].map(([x, z]) => (
        <Box key={`${x}${z}`} pos={[x, 0.38, z]} size={[0.06, 0.76, 0.06]} color="#C99863" />
      ))}
      <Box pos={[0, 0.12, 0]} size={[1.4, 0.03, 0.6]} color="#DDB98C" cast={false} />
      {/* di rak bawah: kardus arsip */}
      <Box pos={[-0.35, 0.22, 0]} size={[0.36, 0.17, 0.3]} color="#E2C9A0" cast={false} />
      <Box pos={[-0.35, 0.23, 0.151]} size={[0.14, 0.04, 0.004]} color="#FFFFFF" cast={false} />
      <Box pos={[0.2, 0.2, 0]} size={[0.3, 0.12, 0.26]} color="#E5566A" cast={false} />
      <Box pos={[0.2, 0.2, 0.131]} size={[0.12, 0.04, 0.004]} color="#FFFFFF" cast={false} />

      {/* stempel besar berpegangan bola merah muda di atas bantalan merah */}
      <Box pos={[-0.55, 0.835, 0.05]} size={[0.34, 0.04, 0.24]} color="#B91C1C" cast={false} />
      <Box pos={[-0.55, 0.89, 0.05]} size={[0.22, 0.05, 0.14]} color="#F8F4EC" />
      <Tube pos={[-0.55, 1.04, 0.05]} r={0.045} h={0.26} color="#7C2D12" seg={10} />
      <Ball pos={[-0.55, 1.2, 0.05]} r={0.09} color="#F43F5E" />
      {/* bantalan tinta merah + stempel kecil */}
      <Box pos={[-0.18, Y + 0.012, 0.2]} size={[0.18, 0.024, 0.12]} color="#2B3340" cast={false} />
      <Box pos={[-0.18, Y + 0.025, 0.2]} size={[0.15, 0.004, 0.09]} color="#DC2626" cast={false} />
      <Stempel pos={[-0.3, Y, -0.12]} rotY={0.4} />
      {/* voucher bertab + dokumen persetujuan + pena */}
      <TumpukKertas pos={[0.08, Y, -0.17]} n={6} header="#E5566A" />
      <TumpukKertas pos={[0.34, Y, -0.17]} n={4} rotY={0.12} header="#16A34A" />
      <Box pos={[0.12, Y + 0.002, 0.18]} size={[0.22, 0.003, 0.3]} color="#FFFFFF" rot={[0, -0.12, 0]} cast={false} />
      <Teks pos={[0.12, Y + 0.0045, 0.1]} rot={[-Math.PI / 2, 0, -0.12]} w={0.19} h={0.05} text="PERSETUJUAN BAYAR" fg="#B91C1C" />
      {[0.15, 0.2, 0.25].map((z) => (
        <Box key={z} pos={[0.12, Y + 0.0045, z]} size={[0.16, 0.001, 0.008]} color="#CBD5D1" rot={[0, -0.12, 0]} cast={false} />
      ))}
      <Box pos={[0.2, Y + 0.0055, 0.3]} size={[0.012, 0.012, 0.14]} color="#111827" rot={[0, 0.5, 0]} cast={false} />
      {/* baki masuk / keluar di kanan + lampu + tanaman + kopi */}
      <BakiTagihan pos={[0.62, Y, 0.05]} />
      <LampuMeja pos={[-0.76, Y, -0.3]} />
      <Succulent pos={[0.72, Y, -0.3]} scale={0.6} />
      <Mug pos={[0.4, Y, 0.3]} color="#FDE68A" steam seed={0.9} />
    </group>
  );
}

// Rak surat keluar / pembayaran keluar: 3 tingkat berlabel, baki merah, amplop bertumpuk, atap limas merah.
function OutboxRack({ pos }: { pos: V3 }) {
  const label = ['PERLU BAYAR', 'DISETUJUI', 'TERKIRIM'];
  return (
    <group position={pos}>
      <Box pos={[0, 0.06, 0]} size={[1.3, 0.12, 0.45]} color="#C77F78" />
      <Box pos={[0, 0.68, -0.2]} size={[1.3, 1.1, 0.04]} color="#F3D3CF" />
      {[-0.63, 0.63].map((x) => (
        <Box key={x} pos={[x, 0.68, 0]} size={[0.04, 1.1, 0.45]} color="#FBEAE7" />
      ))}
      <Box pos={[0, 1.25, 0]} size={[1.3, 0.04, 0.45]} color="#FBEAE7" />
      {[0, 1, 2].map((i) => {
        const y = 0.27 + i * 0.36;
        return (
          <React.Fragment key={i}>
            <Box pos={[0, y, 0]} size={[1.22, 0.03, 0.42]} color="#FBEAE7" cast={false} />
            <Box pos={[0, y + 0.035, 0.16]} size={[1.0, 0.04, 0.03]} color="#E5566A" cast={false} />
            <Box pos={[0, y + 0.035, -0.12]} size={[1.0, 0.04, 0.03]} color="#E5566A" cast={false} />
            <Box pos={[0, y + 0.02, 0.02]} size={[1.0, 0.012, 0.3]} color="#E5566A" cast={false} />
            {[0, 1, 2, 3].map((k) => (
              <React.Fragment key={k}>
                <Box pos={[-0.32 + k * 0.2 + (i % 2) * 0.03, y + 0.035 + (k % 2) * 0.012, 0.02]} size={[0.3, 0.012, 0.2]} color={k % 2 ? '#FFF7E0' : '#FFFFFF'} rot={[0, (k - 1.5) * 0.06, 0]} cast={false} />
                <Box pos={[-0.32 + k * 0.2 + (i % 2) * 0.03, y + 0.043 + (k % 2) * 0.012, 0.1]} size={[0.14, 0.004, 0.02]} color={['#F87171', '#FBBF24', '#34D399', '#60A5FA'][(k + i) % 4]} rot={[0, (k - 1.5) * 0.06, 0]} cast={false} />
              </React.Fragment>
            ))}
            <Teks pos={[0, y - 0.045, 0.218]} w={0.5} h={0.065} text={label[i]} fg="#7F1D1D" bg="#FDECEA" />
          </React.Fragment>
        );
      })}
      <Box pos={[0, 1.38, 0]} size={[0.1, 0.22, 0.1]} color="#F87171" cast={false} />
      <Cone pos={[0, 1.6, 0]} r={0.17} h={0.26} color="#F87171" seg={4} />
    </group>
  );
}

// Stempel raksasa "APPROVED": alas berundak, bantalan tinta, plakat; kepala stempel naik-turun pelan (menghentak tiap ~7 detik).
function GiantStamp({ pos }: { pos: V3 }) {
  const kepala = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime % 7;
    const h = t < 0.7 ? 0.1 * (1 - Math.sin((t / 0.7) * Math.PI)) : 0.1;
    if (kepala.current) kepala.current.position.y = h;
  });
  return (
    <group position={pos}>
      <Box pos={[0, 0.15, 0]} size={[0.9, 0.3, 0.9]} color="#FBEAE7" />
      <Box pos={[0, 0.02, 0]} size={[0.96, 0.04, 0.96]} color="#C77F78" cast={false} />
      <Teks pos={[0, 0.16, 0.452]} w={0.72} h={0.17} text="APPROVED" fg="#B91C1C" bg="#FBEAE7" />
      <Box pos={[0, 0.33, 0]} size={[0.8, 0.06, 0.7]} color="#B91C1C" cast={false} />
      <Box pos={[0, 0.366, 0]} size={[0.62, 0.012, 0.46]} color="#7F1D1D" cast={false} />
      <Box pos={[0, 0.374, 0]} size={[0.58, 0.004, 0.42]} color="#DC2626" cast={false} />
      <group ref={kepala}>
        <Box pos={[0, 0.5, 0]} size={[0.62, 0.2, 0.46]} color="#F8F4EC" />
        <Box pos={[0, 0.395, 0]} size={[0.6, 0.012, 0.44]} color="#DC2626" cast={false} />
        <Tube pos={[0, 0.82, 0]} r={0.13} h={0.45} color="#B91C1C" seg={14} />
        <Tube pos={[0, 0.62, 0]} r={0.17} h={0.04} color="#7F1D1D" seg={14} cast={false} />
        <Ball pos={[0, 1.15, 0]} r={0.22} color="#F43F5E" flat={false} />
      </group>
    </group>
  );
}

// Baki surat bertingkat berisi tagihan (masuk / keluar).
function BakiTagihan({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.008, 0]} size={[0.27, 0.016, 0.33]} color="#E5566A" cast={false} />
      {[[-0.12, -0.15], [0.12, -0.15], [-0.12, 0.15], [0.12, 0.15]].map(([x, z]) => (
        <Box key={`${x}${z}`} pos={[x, 0.1, z]} size={[0.012, 0.18, 0.012]} color="#C94A5A" cast={false} />
      ))}
      <Box pos={[0, 0.1, 0]} size={[0.27, 0.012, 0.33]} color="#E5566A" cast={false} />
      <TumpukKertas pos={[0, 0.016, 0]} n={4} header="#F59E0B" />
      <TumpukKertas pos={[0, 0.112, 0]} n={3} rotY={0.1} header="#E5566A" />
      <Box pos={[0, 0.055, 0.168]} size={[0.14, 0.03, 0.004]} color="#FFFFFF" cast={false} />
      <Box pos={[0, 0.15, 0.168]} size={[0.14, 0.03, 0.004]} color="#FFFFFF" cast={false} />
    </group>
  );
}

// Buku cek / giro: sampul biru, lembar bergaris, garis sobekan, pena.
function CekBuku({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.008, 0]} size={[0.2, 0.016, 0.1]} color="#1E3A8A" cast={false} />
      <Box pos={[0.012, 0.0175, 0]} size={[0.17, 0.003, 0.088]} color="#FFFFFF" cast={false} />
      <Box pos={[-0.04, 0.0195, 0]} size={[0.004, 0.001, 0.086]} color="#CBD5E1" cast={false} />
      {[-0.025, 0, 0.025].map((z) => (
        <Box key={z} pos={[0.04, 0.0195, z]} size={[0.08, 0.001, 0.006]} color="#94A3B8" cast={false} />
      ))}
      <Box pos={[0.075, 0.0195, -0.03]} size={[0.03, 0.001, 0.02]} color="#BFDBFE" cast={false} />
      <Box pos={[0.02, 0.022, 0.075]} size={[0.012, 0.012, 0.14]} color="#111827" rot={[0, 0.4, 0]} cast={false} />
    </group>
  );
}

// Kotak kartu vendor (rolodex): kotak biru, kartu berdiri dengan tab warna-warni, label.
function KotakKartu({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tab = ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA'];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.04, 0]} size={[0.24, 0.08, 0.13]} color="#4C8FBF" cast={false} />
      <Box pos={[0, 0.04, 0.0655]} size={[0.08, 0.025, 0.004]} color="#FFFFFF" cast={false} />
      {tab.map((c, i) => (
        <React.Fragment key={c}>
          <Box pos={[-0.09 + i * 0.045, 0.118, -0.01 + (i % 2) * 0.005]} size={[0.038, 0.075, 0.004]} color="#FFFFFF" cast={false} />
          <Box pos={[-0.09 + i * 0.045, 0.158, -0.01 + (i % 2) * 0.005]} size={[0.026, 0.012, 0.006]} color={c} cast={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

// Brankas kas kecil: badan baja, pintu, dial, gagang, keypad menyala, engsel, plakat.
function BrankasKas({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.3, 0]} size={[0.62, 0.6, 0.5]} color="#4B5563" />
      <Box pos={[0, 0.3, 0.255]} size={[0.5, 0.48, 0.02]} color="#6B7280" cast={false} />
      <Box pos={[0, 0.3, 0.268]} size={[0.44, 0.42, 0.006]} color="#7B8494" cast={false} />
      <Tube pos={[-0.06, 0.28, 0.282]} r={0.07} h={0.02} color="#D1D5DB" rot={[Math.PI / 2, 0, 0]} seg={20} cast={false} />
      <Tube pos={[-0.06, 0.28, 0.294]} r={0.03} h={0.02} color="#374151" rot={[Math.PI / 2, 0, 0]} seg={14} cast={false} />
      <Box pos={[0.15, 0.28, 0.285]} size={[0.03, 0.14, 0.02]} color="#E5E7EB" cast={false} />
      <Box pos={[0.15, 0.4, 0.276]} size={[0.1, 0.07, 0.01]} color="#111827" cast={false} />
      <mesh position={[0.15, 0.4, 0.283]}>
        <boxGeometry args={[0.07, 0.025, 0.004]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.1} />
      </mesh>
      {[0.42, 0.16].map((y) => (
        <Box key={y} pos={[-0.25, y, 0.268]} size={[0.03, 0.06, 0.03]} color="#9CA3AF" cast={false} />
      ))}
      <Teks pos={[0, 0.5, 0.273]} w={0.3} h={0.055} text="KAS KECIL" fg="#E5E7EB" />
      {[[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]].map(([x, z]) => (
        <Box key={`${x}${z}`} pos={[x, 0.01, z]} size={[0.06, 0.02, 0.06]} color="#1F2937" cast={false} />
      ))}
    </group>
  );
}

// Penghancur kertas: tong abu-abu, kepala dengan celah, lampu status, kertas masuk, serpihan di dalam.
function PenghancurKertas({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.28, 0]} size={[0.44, 0.56, 0.28]} color="#E5E7EB" />
      <Box pos={[0, 0.22, 0.145]} size={[0.36, 0.3, 0.006]} color="#F3F4F6" cast={false} />
      {[-0.1, -0.03, 0.04, 0.1].map((x, i) => (
        <Box key={x} pos={[x, 0.16 + (i % 2) * 0.04, 0.15]} size={[0.012, 0.18, 0.004]} color="#FFFFFF" rot={[0, 0, (i - 1.5) * 0.1]} cast={false} />
      ))}
      <Box pos={[0, 0.6, 0]} size={[0.5, 0.09, 0.32]} color="#4B5563" />
      <Box pos={[0, 0.648, 0]} size={[0.34, 0.012, 0.03]} color="#111827" cast={false} />
      <mesh position={[0.19, 0.62, 0.165]}>
        <boxGeometry args={[0.04, 0.025, 0.006]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
      <Box pos={[0, 0.72, 0]} size={[0.2, 0.14, 0.004]} color="#FFFFFF" rot={[0.08, 0, 0]} cast={false} />
    </group>
  );
}

// Lemari arsip bukti bayar: lemari + map berjajar di atas + label laci.
function ArsipAP({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const punggung = ['#E5566A', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#E5566A'];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Cabinet pos={[0, 0, 0]} color="#F6E3E0" />
      {[0.3, 0.7, 1.1].map((y, i) => (
        <Box key={y} pos={[-0.3, y, 0.268]} size={[0.16, 0.06, 0.004]} color={['#E5566A', '#F59E0B', '#16A34A'][i]} cast={false} />
      ))}
      {punggung.map((c, i) => (
        <Box key={i} pos={[-0.38 + i * 0.1, 1.47, 0]} size={[0.085, 0.14, 0.3]} color={c} cast={false} />
      ))}
    </group>
  );
}

// Cahaya ruang AP: kolam cahaya tipis di tiap meja + sinar matahari lembut dari 2 jendela (sengaja redup, tidak silau).
function CahayaAP() {
  return (
    <>
      {AP_MEJA.map(({ p: [x, z] }) => (
        <Kolam key={`${x}${z}`} pos={[x, 0.02, z + 0.8]} size={[3.4, 3.0]} color="#FFE7B0" opacity={0.04} />
      ))}
      <Kolam pos={[-2.6, 0.02, 4.0]} size={[2.6, 3.2]} color="#FFE7B0" opacity={0.045} />
      <Kolam pos={[8.7, 0.02, 3.75]} size={[3.6, 3.0]} color="#FFF1D6" opacity={0.04} />
      {/* sinar matahari dari jendela belakang (lebih lembut daripada ruang Transactions) */}
      <SunPatch pos={[-3.6 - AP_GS, 0.03, -3.5]} size={[2.6, 3.0]} rotY={0.3} opacity={0.09} />
      <SunPatch pos={[2.8 - AP_GS, 0.03, -3.4]} size={[2.4, 2.8]} rotY={-0.2} opacity={0.09} />
      <SunPatch pos={[AP_BILLS_X + 1.5, 0.03, -0.4]} size={[2.0, 2.0]} rotY={0.2} opacity={0.05} />
      <SunPatch pos={[6.0 - AP_GS, 0.03, -3.3]} size={[2.4, 2.8]} rotY={-0.15} opacity={0.09} />
      <Kolam pos={[-3.3, 0.02, -3.0]} size={[3.8, 3.8]} color="#FFE7B0" opacity={0.045} />
      <Kolam pos={[6.0, 1.0, -5.43]} size={[2.4, 1.8]} rot={[0, 0, 0]} color="#FFF3D0" opacity={0.05} />
      {/* kilau tipis di dinding sekitar jendela */}
      <Kolam pos={[-3.9, 1.0, -5.43]} size={[2.4, 1.8]} rot={[0, 0, 0]} color="#FFF3D0" opacity={0.05} />
      <Kolam pos={[2.4, 1.0, -5.43]} size={[2.4, 1.8]} rot={[0, 0, 0]} color="#FFF3D0" opacity={0.05} />
    </>
  );
}

// Meja kerja putih modern. Ukuran = meja Transactions (daun 1.72 x 0.88, tinggi permukaan 0.82). 2 monitor, keyboard, mouse, alas meja,
// laci 3 tingkat di kanan, panel belakang, nampan kabel, stopkontak. Monitor menyala (+ sinar ke meja) hanya saat AI duduk (SEAT[seatKey]).
function ApMonitor({ sd, seatKey, seed, words = AP_KATA }: { sd: -1 | 1; seatKey: string; seed: number; words?: string[] }) {
  return (
    <group position={[sd * 0.37, 0, -0.17]} rotation={[0, sd * -0.2, 0]}>
      <Tube pos={[0, 0.827, 0]} r={0.1} h={0.014} color="#C5CDD6" seg={20} cast={false} />
      <Box pos={[0, 0.91, -0.02]} size={[0.045, 0.16, 0.03]} color="#B8C2CC" cast={false} />
      <Box pos={[0, 0.985, -0.01]} size={[0.1, 0.04, 0.05]} color="#AEB8C2" cast={false} />
      <Box pos={[0, 1.2, 0]} size={[0.68, 0.42, 0.04]} color="#EEF2F6" />
      <mesh position={[0, 1.205, 0.0215]}>
        <boxGeometry args={[0.62, 0.35, 0.006]} />
        <meshStandardMaterial color="#17212B" roughness={0.3} />
      </mesh>
      <Box pos={[0, 1.4, 0.0215]} size={[0.014, 0.014, 0.006]} color="#3B4452" cast={false} />
      <Box pos={[0, 1.008, 0.0225]} size={[0.07, 0.008, 0.004]} color="#C5CDD6" cast={false} />
      <Screen
        seatKey={seatKey}
        size={[0.62, 0.35]}
        pos={[0, 1.205, 0.0255]}
        seed={seed}
        words={words}
        ledPos={[0.29, 1.008, 0.0225]}
        glow={{ floorPos: [0, 0.842, 0.24], floorSize: [1.0, 0.8], haloPos: [0, 1.2, 0.12], haloSize: [0.95, 0.7] }}
      />
    </group>
  );
}

// [BARU] MEJA PUTIH KLASIK-MODERN (desain meja Accounts Payable) dipakai bersama oleh Accounts Payable, Accounts Receivable dan
// Transactions: daun putih + garis biru, kaki panel + laci 3 tingkat, 2 monitor putih menghadap ke tengah, keyboard & mouse putih.
// Yang berbeda antar ruangan hanya: warna aksen (garis alas keyboard + papan nama), kosakata di layar, dan isi meja (children).
const KATA_UMUM = ['Kas', 'Bank', 'Piutang', 'Utang', 'PPN', 'PPh21', 'Beban', 'Pendapatan', 'Debit', 'Kredit', 'Posting', 'Jurnal', 'Saldo', 'Total', 'Rp', 'Rekon', 'Invoice'];

function MejaPutih({ pos, label, aksen, seatKey, seed, kata, children }: { pos: V3; label: string; aksen: string; seatKey: string; seed: number; kata: string[]; children?: React.ReactNode }) {
  return (
    <group position={pos}>
      {/* daun meja putih + garis aksen biru tipis di tepi depan */}
      <Box pos={[0, 0.79, 0]} size={[1.72, 0.06, 0.88]} color="#F8F9FB" />
      <Box pos={[0, 0.8205, 0]} size={[1.7, 0.003, 0.86]} color="#FFFFFF" cast={false} />
      <Box pos={[0, 0.79, 0.4435]} size={[1.72, 0.02, 0.006]} color="#4C8FBF" cast={false} />
      <Box pos={[0, 0.74, 0]} size={[1.64, 0.03, 0.8]} color="#E4E9EE" />
      {/* kaki panel kiri + sepatu kaki, panel belakang, nampan kabel, stopkontak */}
      <Box pos={[-0.8, 0.38, 0]} size={[0.06, 0.76, 0.78]} color="#DCE3E8" />
      <Box pos={[-0.8, 0.02, 0]} size={[0.09, 0.04, 0.82]} color="#C5CDD6" cast={false} />
      <Box pos={[-0.1, 0.52, -0.37]} size={[1.4, 0.4, 0.03]} color="#DCE3E8" />
      <Box pos={[-0.1, 0.69, -0.3]} size={[1.2, 0.025, 0.12]} color="#8E99A5" cast={false} />
      {[-0.4, 0.05, 0.38].map((x, i) => (
        <Box key={x} pos={[x, 0.675, -0.3]} size={[0.012, 0.012, 0.1]} color={i === 1 ? '#475569' : '#2B3340'} cast={false} />
      ))}
      <Box pos={[-0.55, 0.52, -0.35]} size={[0.3, 0.04, 0.05]} color="#2B3340" cast={false} />
      <mesh position={[-0.43, 0.52, -0.323]}>
        <boxGeometry args={[0.012, 0.012, 0.004]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
      {/* laci kanan 3 tingkat, gagang aluminium, slot label biru, kunci */}
      <Box pos={[0.52, 0.36, 0]} size={[0.5, 0.7, 0.76]} color="#EDF1F4" />
      {[0.58, 0.36, 0.14].map((y) => (
        <React.Fragment key={y}>
          <Box pos={[0.52, y, 0.385]} size={[0.44, 0.19, 0.02]} color="#FFFFFF" cast={false} />
          <Box pos={[0.52, y + 0.05, 0.402]} size={[0.16, 0.018, 0.02]} color="#AEB8C2" cast={false} />
          <Box pos={[0.52, y - 0.05, 0.397]} size={[0.07, 0.03, 0.004]} color="#BFDBFE" cast={false} />
        </React.Fragment>
      ))}
      <Tube pos={[0.72, 0.62, 0.4]} r={0.012} h={0.012} color="#8E99A5" rot={[Math.PI / 2, 0, 0]} seg={10} cast={false} />
      <Box pos={[0.52, 0.02, 0]} size={[0.5, 0.04, 0.78]} color="#C5CDD6" cast={false} />

      {/* 2 monitor, sedikit menghadap ke tengah; menyala saat AI duduk */}
      <ApMonitor sd={-1} seatKey={seatKey} seed={seed} words={kata} />
      <ApMonitor sd={1} seatKey={seatKey} seed={seed + 5} words={kata} />

      {/* alas meja, keyboard, mouse */}
      <Box pos={[0, 0.8235, 0.19]} size={[0.96, 0.003, 0.34]} color="#D2DAE2" cast={false} />
      <Box pos={[0, 0.8252, 0.355]} size={[0.96, 0.001, 0.012]} color={aksen} cast={false} />
      <Box pos={[0, 0.827, 0.19]} size={[0.46, 0.016, 0.15]} color="#EEF2F6" cast={false} />
      {[0, 1, 2, 3].map((r) => (
        <Box key={r} pos={[0, 0.8365, 0.14 + r * 0.037]} size={[0.42, 0.004, 0.024]} color="#D5DBE2" cast={false} />
      ))}
      <Box pos={[0, 0.8368, 0.251]} size={[0.2, 0.005, 0.02]} color="#C5CDD6" cast={false} />
      <Box pos={[0.34, 0.832, 0.2]} size={[0.06, 0.02, 0.1]} color="#EEF2F6" cast={false} />
      <Box pos={[0.34, 0.8425, 0.18]} size={[0.008, 0.004, 0.025]} color="#4C8FBF" cast={false} />

      {/* papan nama di sudut depan kiri + isi meja khas halaman */}
      <group position={[-0.38, 0, -0.06]}>
        <DeskPlate label={label} color={aksen} />
      </group>
      {children}
    </group>
  );
}

function ApDesk({ pos, label, varian, seatKey }: { pos: V3; label: string; varian: number; seatKey: string }) {
  const Y = 0.82;
  const seed = Math.floor(Math.abs(pos[0] * 7 + pos[2] * 13) * 100) + 11 + varian * 17;
  return (
    <MejaPutih pos={pos} label={label} aksen="#E5566A" seatKey={seatKey} seed={seed} kata={AP_KATA}>
      <ApMejaIsi varian={varian} Y={Y} />
    </MejaPutih>
  );
}

// Isi meja khas tiap tab halaman Accounts Payable (koordinat lokal meja; permukaan y = 0.82).
function ApMejaIsi({ varian, Y }: { varian: number; Y: number }) {
  return (
    <>
      <LampuMeja pos={[-0.77, Y, -0.31]} />
      <CangkirPena pos={[0.78, Y, -0.32]} />
      {varian === 0 && (
        <>
          {/* BILLS: baki tagihan masuk, stempel DITERIMA, lembar tagihan, kalkulator */}
          <BakiTagihan pos={[-0.64, Y, -0.02]} />
          <PostIt pos={[-0.5, Y, -0.3]} />
          <Stempel pos={[0.5, Y, 0.0]} rotY={0.3} />
          <Box pos={[0.68, Y + 0.002, 0.08]} size={[0.18, 0.003, 0.25]} color="#FFFFFF" rot={[0, 0.15, 0]} cast={false} />
          <Teks pos={[0.68, Y + 0.0045, 0.0]} rot={[-Math.PI / 2, 0, 0.15]} w={0.15} h={0.05} text="TAGIHAN" fg="#B91C1C" />
          <KalkulatorMeja pos={[0.66, Y, 0.31]} rotY={-0.15} />
        </>
      )}
      {varian === 1 && (
        <>
          {/* PAYMENTS: kalkulator pita, buku cek, tusuk nota, voucher LUNAS */}
          <KalkulatorPita pos={[-0.68, Y, -0.1]} rotY={0.05} />
          <CekBuku pos={[-0.6, Y, 0.1]} rotY={0.2} />
          <Mug pos={[-0.5, Y, -0.3]} color="#FDE68A" steam seed={0.5} />
          <TusukNota pos={[0.5, Y, -0.06]} />
          <TumpukKertas pos={[0.66, Y, 0.12]} n={4} rotY={0.1} header="#16A34A" />
          <Teks pos={[0.66, Y + 0.048, 0.12]} rot={[-Math.PI / 2, 0, 0.1]} w={0.14} h={0.05} text="LUNAS" fg="#16A34A" />
          <KalkulatorMeja pos={[0.78, Y, 0.3]} rotY={0.1} />
        </>
      )}
      {varian === 2 && (
        <>
          {/* VENDORS: telepon, headset, kotak kartu vendor, papan klip daftar vendor */}
          <TeleponMeja pos={[-0.64, Y, -0.04]} rotY={0.1} />
          <Succulent pos={[-0.5, Y, -0.3]} scale={0.5} />
          <HeadsetMeja pos={[0.5, Y, -0.08]} rotY={-0.4} />
          <KotakKartu pos={[0.66, Y, 0.02]} rotY={-0.1} />
          <PapanKlip pos={[0.68, Y + 0.001, 0.25]} rotY={0.15} />
          <PostIt pos={[0.45, Y, 0.3]} />
        </>
      )}
      {varian === 4 && (
        <>
          {/* MATCHING (3-way match): tumpukan PO, GRN (surat terima barang), Invoice; stempel COCOK; kalkulator */}
          <TumpukKertas pos={[-0.66, Y, -0.02]} n={3} rotY={0.08} header="#2563EB" />
          <Teks pos={[-0.66, Y + 0.038, -0.02]} rot={[-Math.PI / 2, 0, 0.08]} w={0.13} h={0.045} text="PO" fg="#2563EB" />
          <TumpukKertas pos={[-0.66, Y, 0.2]} n={3} rotY={-0.1} header="#F59E0B" />
          <Teks pos={[-0.66, Y + 0.038, 0.2]} rot={[-Math.PI / 2, 0, -0.1]} w={0.13} h={0.045} text="GRN" fg="#B45309" />
          <TumpukKertas pos={[0.7, Y, 0.06]} n={3} rotY={0.12} header="#E5566A" />
          <Teks pos={[0.7, Y + 0.038, 0.06]} rot={[-Math.PI / 2, 0, 0.12]} w={0.13} h={0.045} text="INVOICE" fg="#B91C1C" />
          <Stempel pos={[0.48, Y, -0.1]} rotY={0.3} />
          <Teks pos={[0.5, Y + 0.002, 0.2]} rot={[-Math.PI / 2, 0, 0]} w={0.16} h={0.05} text="COCOK" fg="#16A34A" />
          <KalkulatorMeja pos={[0.66, Y, 0.32]} rotY={-0.1} />
        </>
      )}
      {varian === 3 && (
        <>
          {/* AGING: buku besar terbuka, tablet grafik umur utang, kalender tenda, kalkulator */}
          <BukuBesar pos={[-0.6, Y + 0.001, -0.04]} rotY={0.05} />
          <Mug pos={[-0.5, Y, -0.3]} color="#A7F3D0" steam seed={0.3} />
          <KalenderTenda pos={[0.5, Y, -0.13]} rotY={-0.15} />
          <TabletAging pos={[0.7, Y, 0.1]} rotY={-0.4} />
          <KalkulatorMeja pos={[0.58, Y, 0.3]} rotY={0.1} />
        </>
      )}
    </>
  );
}

// ---- [BARU] Perluasan ruang AP (x lokal 5..9): papan alur persetujuan, scanner invoice, meja negosiasi vendor, pantry ----

// Papan kanban dinding: alur satu tagihan dari DITERIMA -> DIVERIFIKASI -> DISETUJUI -> DIBAYAR.
function PapanApproval({ pos }: { pos: V3 }) {
  const tex = useMemo(() => {
    const W = 800, H = 440;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (g) {
      const FONT = 'Inter, system-ui, sans-serif';
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#E5566A';
      g.fillRect(0, 0, W, 72);
      g.fillStyle = '#FFFFFF';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `800 34px ${FONT}`;
      g.fillText('ALUR PERSETUJUAN BAYAR', 24, 38);
      const kol: { t: string; c: string; n: number }[] = [
        { t: 'DITERIMA', c: '#F59E0B', n: 4 },
        { t: 'DIVERIFIKASI', c: '#3B82F6', n: 3 },
        { t: 'DISETUJUI', c: '#8B5CF6', n: 2 },
        { t: 'DIBAYAR', c: '#16A34A', n: 4 },
      ];
      const cw = (W - 48) / 4;
      kol.forEach((k, i) => {
        const x = 24 + i * cw;
        g.fillStyle = '#F1F5F9';
        g.fillRect(x + 4, 88, cw - 8, H - 106);
        g.fillStyle = k.c;
        g.fillRect(x + 4, 88, cw - 8, 40);
        g.fillStyle = '#FFFFFF';
        g.textAlign = 'center';
        g.font = `700 19px ${FONT}`;
        g.fillText(k.t, x + cw / 2, 109);
        for (let j = 0; j < k.n; j++) {
          const y = 140 + j * 70;
          g.fillStyle = '#FFFFFF';
          g.fillRect(x + 14, y, cw - 28, 58);
          g.fillStyle = k.c;
          g.fillRect(x + 14, y, 7, 58);
          g.fillStyle = '#CBD5E1';
          g.fillRect(x + 32, y + 14, cw - 78, 9);
          g.fillStyle = '#E2E8F0';
          g.fillRect(x + 32, y + 34, (cw - 78) * (0.45 + 0.1 * ((i + j) % 4)), 9);
        }
      });
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  return (
    <group position={pos} scale={0.8}>
      <Box pos={[0, 0, 0]} size={[2.1, 1.18, 0.05]} color="#8A5A55" cast={false} />
      <mesh position={[0, 0, 0.027]}>
        <planeGeometry args={[2.0, 1.1]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* penyangga pena di bawah papan */}
      <Box pos={[0, -0.62, 0.05]} size={[1.9, 0.04, 0.1]} color="#C99863" cast={false} />
      {[-0.5, -0.3, 0.1].map((x, i) => (
        <Box key={x} pos={[x, -0.595, 0.05]} size={[0.12, 0.015, 0.015]} color={['#E5566A', '#2563EB', '#111827'][i]} cast={false} />
      ))}
    </group>
  );
}

// Mesin scan invoice / fotokopi di lantai: penutup, kaca pindai, panel layar menyala, baki kertas, tumpukan hasil scan.
function StasiunScan({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.3, 0]} size={[0.92, 0.6, 0.62]} color="#F1F4F7" />
      <Box pos={[0, 0.03, 0.02]} size={[0.86, 0.06, 0.56]} color="#8E99A5" cast={false} />
      {/* baki kertas (laci bawah) */}
      <Box pos={[0, 0.2, 0.316]} size={[0.8, 0.22, 0.014]} color="#DCE3E8" cast={false} />
      <Box pos={[0, 0.2, 0.326]} size={[0.2, 0.025, 0.012]} color="#8E99A5" cast={false} />
      <Box pos={[0, 0.42, 0.316]} size={[0.8, 0.08, 0.014]} color="#E5566A" cast={false} />
      {/* bagian atas: kaca pindai + penutup yang sedikit terangkat */}
      <Box pos={[0, 0.63, 0.02]} size={[0.92, 0.06, 0.6]} color="#DCE3E8" />
      <Box pos={[0, 0.664, 0.02]} size={[0.8, 0.008, 0.5]} color="#BFE3F2" cast={false} />
      <group position={[0, 0.7, -0.27]} rotation={[-0.28, 0, 0]}>
        <Box pos={[0, 0.0, 0.26]} size={[0.9, 0.04, 0.54]} color="#F8F9FB" />
      </group>
      {/* panel kontrol di sudut depan kanan dengan layar menyala */}
      <group position={[0.3, 0.66, 0.3]} rotation={[-0.5, 0, 0]}>
        <Box pos={[0, 0, 0]} size={[0.3, 0.02, 0.16]} color="#2B3340" cast={false} />
        <mesh position={[0, 0.012, 0]}>
          <boxGeometry args={[0.2, 0.004, 0.1]} />
          <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.9} />
        </mesh>
      </group>
      {/* hasil scan di atas, label */}
      <TumpukKertas pos={[-0.25, 0.66, 0.05]} n={4} rotY={0.1} header="#E5566A" />
      <Teks pos={[0, 0.5, 0.324]} rot={[0, 0, 0]} w={0.5} h={0.09} text="SCAN INVOICE" fg="#FFFFFF" bg="#E5566A" />
    </group>
  );
}

// Meja bundar negosiasi vendor: 4 kursi, map kontrak, jadwal termin, kopi.
function MejaVendor({ pos }: { pos: V3 }) {
  const R = 1.32;
  return (
    <group position={pos}>
      <Tube pos={[0, 0.79, 0]} r={0.86} h={0.05} color="#F8F9FB" seg={40} />
      <Tube pos={[0, 0.79, 0]} r={0.872} h={0.014} color="#E5566A" seg={40} cast={false} />
      <Tube pos={[0, 0.38, 0]} r={0.06} h={0.76} color="#C5CDD6" seg={12} />
      <Tube pos={[0, 0.02, 0]} r={0.4} h={0.04} color="#8E99A5" seg={28} cast={false} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + 0.35;
        return <Chair key={i} pos={[Math.sin(a) * R, 0, Math.cos(a) * R]} rotY={a} color="#D9606B" />;
      })}
      {/* papan nama meja + map kontrak + dokumen termin + kopi */}
      <Teks pos={[0, 0.8175, 0]} rot={[-Math.PI / 2, 0, 0]} w={0.62} h={0.13} text="NEGOSIASI VENDOR" fg="#B91C1C" bg="#FFF1EE" />
      <Box pos={[-0.38, 0.824, -0.32]} size={[0.3, 0.012, 0.22]} color="#E5566A" rot={[0, 0.5, 0]} cast={false} />
      <Box pos={[-0.38, 0.832, -0.32]} size={[0.26, 0.004, 0.18]} color="#FFFFFF" rot={[0, 0.5, 0]} cast={false} />
      <TumpukKertas pos={[0.42, 0.815, -0.28]} n={3} rotY={-0.3} header="#16A34A" />
      <TumpukKertas pos={[0.35, 0.815, 0.38]} n={2} rotY={0.5} header="#2563EB" />
      <Mug pos={[-0.35, 0.815, 0.4]} color="#FDE68A" steam seed={2.1} />
      <Mug pos={[0.6, 0.815, 0.05]} color="#A7F3D0" steam seed={3.3} />
    </group>
  );
}

// Pantry kecil: kulkas mini + lemari bawah, mesin kopi, teko, cangkir, toples gula.
function PantryAP({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* kulkas mini */}
      <Box pos={[-0.72, 0.45, 0]} size={[0.56, 0.9, 0.52]} color="#F3F6F9" />
      <Box pos={[-0.72, 0.62, 0.266]} size={[0.5, 0.52, 0.012]} color="#E3E8EE" cast={false} />
      <Box pos={[-0.72, 0.2, 0.266]} size={[0.5, 0.28, 0.012]} color="#E3E8EE" cast={false} />
      <Box pos={[-0.52, 0.62, 0.285]} size={[0.02, 0.22, 0.02]} color="#9AA6B2" cast={false} />
      <Box pos={[-0.52, 0.2, 0.285]} size={[0.02, 0.12, 0.02]} color="#9AA6B2" cast={false} />
      {/* lemari bawah + meja kayu */}
      <Box pos={[0.28, 0.43, 0]} size={[1.4, 0.86, 0.55]} color="#FBEAE7" />
      <Box pos={[0.28, 0.05, 0.02]} size={[1.36, 0.1, 0.5]} color="#8F4F4A" cast={false} />
      {[-0.17, 0.28, 0.73].map((x) => (
        <React.Fragment key={x}>
          <Box pos={[x, 0.46, 0.282]} size={[0.42, 0.66, 0.012]} color="#F6D9D4" cast={false} />
          <Box pos={[x + 0.14, 0.62, 0.296]} size={[0.02, 0.1, 0.02]} color={EMAS} cast={false} />
        </React.Fragment>
      ))}
      <Box pos={[0.28, 0.885, 0]} size={[1.46, 0.05, 0.6]} color="#C99863" />
      {/* mesin kopi */}
      <Box pos={[-0.08, 1.1, -0.1]} size={[0.3, 0.34, 0.28]} color="#2B3340" />
      <Box pos={[-0.08, 1.29, -0.1]} size={[0.32, 0.04, 0.3]} color="#3B4452" cast={false} />
      <Box pos={[-0.08, 0.93, 0.07]} size={[0.26, 0.02, 0.14]} color="#8E99A5" cast={false} />
      <Tube pos={[-0.08, 1.0, 0.05]} r={0.045} h={0.12} color="#E8F1F6" seg={12} cast={false} />
      <mesh position={[0.05, 1.18, 0.045]}>
        <boxGeometry args={[0.02, 0.02, 0.006]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
      {/* teko, cangkir, toples gula */}
      <Tube pos={[0.38, 0.99, -0.05]} r={0.085} h={0.2} color="#E5566A" seg={14} />
      <Tube pos={[0.38, 1.1, -0.05]} r={0.03} h={0.03} color="#2B3340" seg={8} cast={false} />
      <Mug pos={[0.6, 0.91, 0.08]} color="#FFFFFF" steam seed={5.2} />
      <Mug pos={[0.78, 0.91, 0.14]} color="#FDE68A" />
      <Tube pos={[0.62, 0.97, -0.17]} r={0.06} h={0.14} color="#F8F9FB" seg={12} cast={false} />
      <Tube pos={[0.62, 1.05, -0.17]} r={0.064} h={0.02} color="#E5566A" seg={12} cast={false} />
    </group>
  );
}

function RuangAP() {
  return (
    <group position={[AP_GX, 0, 0]}>
      <ApLantai />
      <ApDinding />
      <CahayaAP />

      {/* dinding belakang (z = -5.5): jendela bergorden, lampu, kalender jatuh tempo, grafik umur utang, jam, apar */}
      <Window pos={[-3.9, 1.0, -5.46]} w={1.4} />
      <Kerai pos={[-3.9, 1.0, -5.46]} w={1.4} />
      <Succulent pos={[-3.5, 0.53, -5.37]} scale={0.55} />
      <LampuDinding pos={[-2.9, 1.15, -5.5]} />
      <DueCalendar pos={[-1.9, 0.95, -5.46]} />
      <LampuDinding pos={[-0.82, 1.15, -5.5]} />
      <group position={[0.25, 0.95, -5.46]} scale={0.62}>
        <AgingChart pos={[0, 0, 0]} judul="UMUR UTANG (AGING)" warna="#E5566A" />
      </group>
      <LampuDinding pos={[1.3, 1.15, -5.5]} />
      <Window pos={[2.4, 1.0, -5.46]} w={1.4} />
      <Kerai pos={[2.4, 1.0, -5.46]} w={1.4} />
      <Succulent pos={[2.8, 0.53, -5.37]} scale={0.55} />
      <Clock pos={[9.4, 1.3, -5.46]} />
      <Extinguisher pos={[3.5, 0.28, -5.4]} />
      {/* [BARU] dinding belakang area perluasan: jendela bergorden, papan alur persetujuan, tanaman */}
      <Window pos={[5.9, 1.0, -5.46]} w={1.4} />
      <Kerai pos={[5.9, 1.0, -5.46]} w={1.4} />
      <Succulent pos={[5.5, 0.53, -5.37]} scale={0.55} />
      <PapanApproval pos={[7.5, 1.12, -5.455]} />
      <LampuDinding pos={[8.7 + AP_DXE, 1.15, -5.5]} />

      {/* 4 meja kerja putih (seukuran meja Transactions) + kursi merah + tempat sampah */}
      {AP_MEJA.map(({ p: [x, z], label, varian }, i) => (
        <React.Fragment key={`${x}${z}`}>
          <ApDesk pos={[x, 0, z]} label={label} varian={varian} seatKey={`ap:${i}`} />
          <Chair pos={[x, 0, z + 0.85]} color="#D9606B" />
          <TrashBin pos={[x + 1.1, 0, z + 0.25]} />
        </React.Fragment>
      ))}

      {/* meja persetujuan + rak surat keluar + stempel raksasa */}
      <StampTable pos={[-2.6, 0, 4.0]} rotY={-Math.PI / 2} />
      <OutboxRack pos={[-4.355 + AP_DX, 0, -5.275]} />
      <GiantStamp pos={[4.2, 0, -4.5]} />

      {/* sisi kiri (partisi kaca): arsip, rak surat vendor, printer cek */}
      <ArsipAP pos={[-4.755 + AP_DX, 0, -2.1]} rotY={Math.PI / 2} />
      <MailRack pos={[-4.785 + AP_DX, 0, -0.6]} rotY={Math.PI / 2} palet={{ sel: '#C77F78', badan: '#FBEAE7', kaki: '#8F4F4A', baki: '#E5566A' }} />
      <PrinterStation pos={[-4.715 + AP_DX, 0, 0.95]} rotY={Math.PI / 2} />
      {/* [BARU] dinding kiri penuh: papan nama + label status pembayaran (bagian kosong di antara rak surat keluar dan arsip) */}
      <group position={[-4.98 + AP_DX, 0, -3.9]} rotation={[0, Math.PI / 2, 0]}>
        <Box pos={[0, 1.15, 0]} size={[1.56, 0.36, 0.04]} color="#F8F9FB" cast={false} />
        <Teks pos={[0, 1.15, 0.03]} w={1.5} h={0.28} text="ACCOUNT PAYABLE" fg="#FFFFFF" bg="#E5566A" />
        {['#F87171', '#FBBF24', '#34D399'].map((c, i) => (
          <Box key={c} pos={[-0.4 + i * 0.4, 0.88, 0.02]} size={[0.3, 0.1, 0.02]} color={c} cast={false} />
        ))}
      </group>

      {/* sisi kanan (dinding rendah): penghancur kertas, brankas kas kecil, dua lemari arsip, dispenser air */}
      <PenghancurKertas pos={[8.55 + AP_DXE, 0, -2.3]} rotY={-Math.PI / 2} />
      <BrankasKas pos={[8.55 + AP_DXE, 0, -1.45]} rotY={-Math.PI / 2} />
      <ArsipAP pos={[8.72 + AP_DXE, 0, -0.3]} rotY={-Math.PI / 2} />
      <ArsipAP pos={[8.72 + AP_DXE, 0, 0.9]} rotY={-Math.PI / 2} />
      <WaterCooler pos={[8.6 + AP_DXE, 0, 2.1]} rotY={-Math.PI / 2} />

      {/* [BARU] perluasan: scan invoice, meja negosiasi vendor, pantry (tanpa sofa tambahan) */}
      <StasiunScan pos={[8.2 + AP_DXE, 0, -4.7]} rotY={0} />
      <MejaVendor pos={[-3.3, 0, -3.0]} />
      <PantryAP pos={[8.4 + AP_DXE, 0, 4.0]} rotY={-Math.PI / 2} />
      <PlantPalm pos={[8.5 + AP_DXE, 0, -3.4]} scale={0.9} />
      <FloorLamp pos={[4.9, 0, 4.9]} />

      {/* area tunggu dekat pintu */}
      <Sofa pos={[8.7, 0, 4.4]} rotY={0} color="#D9606B" />
      <CoffeeTable pos={[8.7, 0, 3.0]} />
      <Mug pos={[8.95, 0.43, 3.2]} color="#FDE68A" steam seed={1.4} />

      {/* tanaman + lampu lantai */}
      <PlantPalm pos={[-4.3 + AP_DX, 0, 4.6]} scale={1.0} />
      <PlantSnake pos={[-4.4 + AP_DX, 0, 2.4]} scale={0.9} />
      <FloorLamp pos={[-4.4 + AP_DX, 0, 3.6]} />
      <PlantBush pos={[5.7, 0, 5.0]} scale={0.8} />
      <ApPenghuni />
    </group>
  );
}

// ---- Asset (tengah-bawah) — karamel & emas: gudang + brankas. 4 meja = 4 halaman Assets & Equity (Fixed Assets, Inventory, Liabilities, Equity). ----
// MODE DESAIN SAJA: belum terhubung ke backend / tugas agen. Daftar di bawah disiapkan supaya nanti tinggal disambungkan
// (kunci = jenis meja, href = halaman tujuan, seat = kunci kursi untuk layar monitor; urutan = urutan meja di ruangan).
export const HALAMAN_ASET = [
  { id: 'fixed-assets', nama: 'Fixed Assets', href: '/assets', warna: '#F5C84C', kunci: 'aset', seat: 'as:0' },
  { id: 'inventory', nama: 'Inventory', href: '/inventory', warna: '#FB923C', kunci: 'persediaan', seat: 'as:1' },
  { id: 'liabilities', nama: 'Liabilities', href: '/liabilities', warna: '#F87171', kunci: 'kewajiban', seat: 'as:2' },
  { id: 'equity', nama: 'Equity', href: '/equity', warna: '#34D399', kunci: 'ekuitas', seat: 'as:3' },
] as const;
type KunciAset = (typeof HALAMAN_ASET)[number]['kunci'];
const ASET = { cx: 16.4, cz: 24.3, w: 10, d: 8 };

const AS_TEMA: ScreenTema = {
  bg: '#1A1006',
  cols: ['#FCD34D', '#F59E0B', '#FDE68A', '#FB923C', '#FEF3C7', '#E7D3A8'],
  glow: '#F5C84C',
};
const AS_KATA: Record<KunciAset, string[]> = {
  aset: ['Tanah', 'Gedung', 'Kendaraan', 'Mesin', 'Peralatan', 'Penyusutan', 'Akum.', 'Nilai Buku', 'Aset Tetap', 'Revaluasi', 'Umur', 'Rp', 'Garis Lurus'],
  persediaan: ['Stok', 'SKU', 'Gudang', 'Masuk', 'Keluar', 'HPP', 'FIFO', 'Opname', 'Saldo', 'Qty', 'Rak', 'Batch', 'Rp'],
  kewajiban: ['Utang', 'Jatuh Tempo', 'Cicilan', 'Bunga', 'Pinjaman', 'Hutang Pajak', 'Akrual', 'Saldo', 'Pokok', 'Tenor', 'Rp', 'Bank'],
  ekuitas: ['Modal', 'Laba Ditahan', 'Saham', 'Dividen', 'Setoran', 'Prive', 'Saldo Laba', 'Ekuitas', 'Agio', 'Rp', 'ROE', 'Komposisi'],
};
const AS_KAYU = '#7B4B24';
const AS_KAYU2 = '#8F5A2C';
const AS_KULIT = '#4A2F18';

// Kardus bertape: badan, tape tengah, label putih + strip barcode, panah "atas" (dan strip FRAGILE merah bila diminta).
function Kardus({ pos, s = 0.6, color = '#C9A26B', rotY = 0, fragile = false }: { pos: V3; s?: number; color?: string; rotY?: number; fragile?: boolean }) {
  const gelap = lighten(color, -0.08);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, s / 2, 0]} size={[s, s, s]} color={color} />
      <Box pos={[0, s + 0.004, 0]} size={[s + 0.01, 0.012, 0.09 * (s / 0.6 + 0.4)]} color="#E8D3A2" cast={false} />
      <Box pos={[0, s / 2, s / 2 + 0.004]} size={[0.09 * (s / 0.6 + 0.4), s, 0.008]} color="#E8D3A2" cast={false} />
      <Box pos={[s * 0.24, s * 0.4, s / 2 + 0.008]} size={[s * 0.3, s * 0.2, 0.006]} color="#FFFDF6" cast={false} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} pos={[s * 0.15 + i * s * 0.055, s * 0.4, s / 2 + 0.013]} size={[0.012 + (i % 2) * 0.01, s * 0.12, 0.004]} color="#1F2937" cast={false} />
      ))}
      <Box pos={[-s * 0.3, s * 0.2, s / 2 + 0.006]} size={[s * 0.18, s * 0.14, 0.006]} color={gelap} cast={false} />
      <Box pos={[-s * 0.3, s * 0.2, s / 2 + 0.011]} size={[0.012, s * 0.1, 0.004]} color="#F3E8CF" cast={false} />
      <Box pos={[-s * 0.3, s * 0.24, s / 2 + 0.011]} size={[s * 0.08, 0.012, 0.004]} color="#F3E8CF" cast={false} />
      {fragile && <Box pos={[0, s * 0.82, s / 2 + 0.01]} size={[s * 0.9, s * 0.1, 0.006]} color="#DC2626" cast={false} />}
    </group>
  );
}

// Palet kayu (3 papan atas, 3 balok, 2 papan bawah).
function Palet({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {[-0.4, 0, 0.4].map((z) => (
        <Box key={z} pos={[0, 0.115, z]} size={[1.2, 0.025, 0.2]} color="#C79A5B" cast={false} />
      ))}
      {[-0.5, 0, 0.5].map((x) => (
        <Box key={x} pos={[x, 0.06, 0]} size={[0.14, 0.07, 0.95]} color="#A97C45" cast={false} />
      ))}
      {[-0.4, 0.4].map((z) => (
        <Box key={z} pos={[0, 0.012, z]} size={[1.2, 0.024, 0.14]} color="#B98A55" cast={false} />
      ))}
    </group>
  );
}

// Tumpukan di palet dibungkus stretch-wrap (transparan) + label.
function PaletBungkus({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Palet pos={[0, 0, 0]} />
      <Kardus pos={[-0.28, 0.13, -0.2]} s={0.46} color="#C9A26B" />
      <Kardus pos={[0.28, 0.13, -0.2]} s={0.46} color="#B5834A" />
      <Kardus pos={[-0.28, 0.13, 0.26]} s={0.46} color="#B5834A" />
      <Kardus pos={[0.28, 0.13, 0.26]} s={0.46} color="#C9A26B" />
      <Kardus pos={[0, 0.59, 0]} s={0.5} color="#D8B27A" fragile />
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.2, 1.0, 1.04]} />
        <meshBasicMaterial color="#E7F3F8" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// Hand pallet truck (forklift tangan): garpu meruncing + roller, roda kemudi, rumah pompa hidrolik, silinder krom,
// tuas kemudi miring dengan grip karet + tuas kontrol, dan pita reflektif di ujung garpu.
function PalletJack({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {[-0.17, 0.17].map((x) => (
        <React.Fragment key={x}>
          {/* garpu: pelat atas + rel bawah + ujung meruncing + pita kuning */}
          <Box pos={[x, 0.075, 0.2]} size={[0.15, 0.03, 1.0]} color="#DC2626" />
          <Box pos={[x - 0.065, 0.045, 0.2]} size={[0.02, 0.03, 0.96]} color="#7F1D1D" cast={false} />
          <Box pos={[x + 0.065, 0.045, 0.2]} size={[0.02, 0.03, 0.96]} color="#7F1D1D" cast={false} />
          <Box pos={[x, 0.065, 0.74]} size={[0.15, 0.022, 0.1]} color="#B91C1C" rot={[0.35, 0, 0]} cast={false} />
          <Box pos={[x, 0.093, 0.62]} size={[0.13, 0.004, 0.05]} color={EMAS} cast={false} />
          {/* roller ganda di ujung garpu */}
          {[0.5, 0.66].map((z) => (
            <React.Fragment key={z}>
              <Tube pos={[x, 0.034, z]} r={0.032} h={0.1} color="#1F2937" rot={[0, 0, Math.PI / 2]} seg={10} cast={false} />
              <Tube pos={[x, 0.034, z]} r={0.012} h={0.11} color="#9CA3AF" rot={[0, 0, Math.PI / 2]} seg={6} cast={false} />
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}
      {/* roda kemudi belakang */}
      {[-0.22, 0.22].map((x) => (
        <React.Fragment key={x}>
          <Tube pos={[x, 0.055, -0.3]} r={0.055} h={0.05} color="#1F2937" rot={[0, 0, Math.PI / 2]} seg={12} cast={false} />
          <Tube pos={[x, 0.055, -0.3]} r={0.022} h={0.056} color="#9CA3AF" rot={[0, 0, Math.PI / 2]} seg={8} cast={false} />
        </React.Fragment>
      ))}
      {/* rumah pompa hidrolik + pelat atas + baut + label peringatan */}
      <Box pos={[0, 0.17, -0.3]} size={[0.5, 0.2, 0.2]} color="#B91C1C" />
      <Box pos={[0, 0.285, -0.3]} size={[0.46, 0.02, 0.18]} color="#7F1D1D" cast={false} />
      {[-0.2, 0.2].map((x) => (
        <Box key={x} pos={[x, 0.298, -0.3]} size={[0.03, 0.012, 0.03]} color="#D1D5DB" cast={false} />
      ))}
      <Box pos={[0, 0.17, -0.197]} size={[0.16, 0.07, 0.006]} color="#FDE68A" cast={false} />
      <Box pos={[0, 0.17, -0.193]} size={[0.12, 0.012, 0.004]} color="#1F2937" cast={false} />
      <Box pos={[0, 0.13, -0.197]} size={[0.5, 0.012, 0.006]} color={EMAS} cast={false} />
      {/* silinder hidrolik krom + cincin kuningan */}
      <Tube pos={[0.14, 0.4, -0.36]} r={0.026} h={0.26} color="#D1D5DB" seg={10} />
      <Tube pos={[0.14, 0.3, -0.36]} r={0.036} h={0.03} color="#B8860B" seg={10} cast={false} />
      <Tube pos={[0.14, 0.53, -0.36]} r={0.03} h={0.025} color="#6B7280" seg={10} cast={false} />
      {/* braket + tuas kemudi miring ke belakang */}
      <Box pos={[0, 0.3, -0.36]} size={[0.12, 0.06, 0.08]} color="#374151" cast={false} />
      <Box pos={[0, 0.65, -0.485]} size={[0.045, 0.74, 0.045]} color="#374151" rot={[-0.343, 0, 0]} cast={false} />
      {/* tuas kontrol (kuning) + batang penarik */}
      <Box pos={[0.045, 0.6, -0.465]} size={[0.012, 0.6, 0.012]} color={EMAS} rot={[-0.343, 0, 0]} cast={false} />
      <Box pos={[0.055, 0.96, -0.6]} size={[0.03, 0.04, 0.13]} color={EMAS} rot={[0.2, 0, 0]} cast={false} />
      {/* gagang T + grip karet */}
      <Box pos={[0, 1.0, -0.62]} size={[0.38, 0.035, 0.045]} color="#1F2937" cast={false} />
      {[-0.15, 0.15].map((x) => (
        <Tube key={x} pos={[x, 1.0, -0.62]} r={0.026} h={0.1} color="#111827" rot={[0, 0, Math.PI / 2]} seg={10} cast={false} />
      ))}
      <Box pos={[0, 0.9, -0.58]} size={[0.07, 0.09, 0.04]} color="#B91C1C" cast={false} />
    </group>
  );
}

// Rak gudang 3 tingkat: tiang oranye, balok pengaman, kardus bertape, label lokasi rak, strip barcode.
function RakGudang({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Palet pos={[0, 0, 0.0]} rotY={Math.PI / 2} />
      {[-1.45, 1.45].flatMap((x) => [-0.3, 0.3].map((z) => (
        <Box key={`${x}${z}`} pos={[x, 1.0, z]} size={[0.07, 2.0, 0.07]} color="#E0713F" />
      )))}
      {[-1.45, 1.45].map((x) => (
        <React.Fragment key={x}>
          {[0.3, 0.9, 1.5].map((y) => (
            <Box key={y} pos={[x, y, 0]} size={[0.05, 0.03, 0.62]} color="#9A3412" cast={false} />
          ))}
          <Box pos={[x, 1.0, 0.3]} size={[0.04, 1.8, 0.03]} color="#9A3412" rot={[0.0, 0, 0]} cast={false} />
        </React.Fragment>
      ))}
      {[0.32, 0.92, 1.52].map((y, i) => (
        <React.Fragment key={y}>
          <Box pos={[0, y, 0]} size={[2.9, 0.06, 0.62]} color="#F1F4F7" />
          <Box pos={[0, y - 0.045, 0.32]} size={[2.9, 0.045, 0.03]} color="#EA580C" cast={false} />
          <Box pos={[-0.95 + i * 0.3, y - 0.045, 0.341]} size={[0.28, 0.034, 0.006]} color="#FFFDF6" cast={false} />
        </React.Fragment>
      ))}
      {/* tingkat bawah */}
      <Kardus pos={[-1.0, 0.35, 0]} s={0.5} color="#C9A26B" />
      <Kardus pos={[-0.42, 0.35, 0]} s={0.5} color="#B5834A" />
      <Kardus pos={[0.2, 0.35, 0]} s={0.5} color="#5B9BD5" />
      <Kardus pos={[0.85, 0.35, 0]} s={0.44} color="#C9A26B" />
      {/* tingkat tengah */}
      <Kardus pos={[-0.85, 0.95, 0]} s={0.46} color="#B5834A" />
      <Kardus pos={[-0.25, 0.95, 0]} s={0.42} color="#D8B27A" fragile />
      <Kardus pos={[0.4, 0.95, 0]} s={0.46} color="#C9A26B" />
      <Kardus pos={[1.02, 0.95, 0]} s={0.4} color="#E0713F" />
      {/* tingkat atas */}
      <Kardus pos={[-0.6, 1.55, 0]} s={0.42} color="#C9A26B" />
      <Kardus pos={[0.1, 1.55, 0]} s={0.42} color="#B5834A" />
      <Kardus pos={[0.75, 1.55, 0]} s={0.36} color="#D8B27A" />
      {/* papan label rak */}
      <Box pos={[0, 2.04, 0]} size={[2.9, 0.08, 0.08]} color="#E0713F" cast={false} />
      <Teks pos={[0, 2.04, 0.045]} w={1.1} h={0.1} text="RAK PERSEDIAAN A-01" fg="#FFF6E4" />
    </group>
  );
}

// Tumpukan emas batangan.
function BatangEmas({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const baris = [3, 2, 1];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {baris.map((n, r) =>
        Array.from({ length: n }, (_, i) => (
          <React.Fragment key={`${r}${i}`}>
            <Box pos={[(i - (n - 1) / 2) * 0.27, 0.055 + r * 0.1, 0]} size={[0.25, 0.09, 0.14]} color={EMAS} />
            <Box pos={[(i - (n - 1) / 2) * 0.27, 0.1 + r * 0.1, 0]} size={[0.19, 0.012, 0.09]} color="#FDE68A" cast={false} />
          </React.Fragment>
        ))
      )}
    </group>
  );
}

// Karung uang kecil dengan koin emas di depannya.
function KarungUang({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Ball pos={[0, 0.2, 0]} r={0.2} color="#C9A26B" flat={false} />
      <Tube pos={[0, 0.4, 0]} r={0.07} rb={0.1} h={0.1} color="#B5834A" seg={12} />
      <Tube pos={[0, 0.46, 0]} r={0.1} rb={0.06} h={0.08} color="#C9A26B" seg={12} />
      <Tube pos={[0, 0.43, 0]} r={0.075} h={0.025} color="#B91C1C" seg={12} cast={false} />
      <Tube pos={[0, 0.22, 0.19]} r={0.07} h={0.012} color={EMAS} rot={[Math.PI / 2, 0, 0]} seg={16} cast={false} />
    </group>
  );
}

// Brankas besar: plinth, rangka kuningan, pintu bulat berputar pelan, engsel, baut kunci, keypad menyala, papan nama.
function BrankasAset({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0.9]} size={[3.0, 2.2]} color="#F5C84C" opacity={0.14} />
      <Box pos={[0, 0.04, 0.2]} size={[2.1, 0.05, 1.7]} color="#6B4A2B" cast={false} />
      <Box pos={[0, 0.07, 0.2]} size={[2.0, 0.012, 1.6]} color={EMAS} cast={false} />
      <Box pos={[0, 0.09, 0]} size={[1.8, 0.1, 0.9]} color="#3F4756" />
      <Box pos={[0, 0.9, 0]} size={[1.7, 1.6, 0.8]} color="#7B8494" />
      <Box pos={[0, 1.72, 0]} size={[1.78, 0.06, 0.88]} color="#9CA3AF" cast={false} />
      <Box pos={[0, 1.76, 0.02]} size={[1.2, 0.025, 0.5]} color="#4B5563" cast={false} />
      {/* bingkai kuningan pintu */}
      <Box pos={[0, 0.9, 0.41]} size={[1.52, 1.42, 0.02]} color="#B8860B" cast={false} />
      <Box pos={[0, 0.9, 0.42]} size={[1.44, 1.34, 0.02]} color="#5B6472" cast={false} />
      {/* engsel kiri + baut kunci kanan */}
      {[0.4, 0.9, 1.4].map((y) => (
        <React.Fragment key={y}>
          <Tube pos={[-0.74, y, 0.44]} r={0.05} h={0.2} color="#B8860B" seg={10} cast={false} />
          <Box pos={[0.76, y, 0.43]} size={[0.06, 0.1, 0.04]} color="#D1D5DB" cast={false} />
        </React.Fragment>
      ))}
      {/* roda pintu bulat */}
      <Tube pos={[-0.1, 0.9, 0.46]} r={0.58} h={0.1} color="#9CA3AF" rot={[Math.PI / 2, 0, 0]} seg={32} />
      <Tube pos={[-0.1, 0.9, 0.52]} r={0.46} h={0.05} color="#6B7280" rot={[Math.PI / 2, 0, 0]} seg={32} cast={false} />
      {Array.from({ length: 12 }, (_, i) => (
        <Box key={i} pos={[-0.1 + Math.sin((i * Math.PI) / 6) * 0.52, 0.9 + Math.cos((i * Math.PI) / 6) * 0.52, 0.53]} size={[0.05, 0.05, 0.04]} color={EMAS} cast={false} />
      ))}
      <group position={[-0.1, 0.9, 0.58]} rotation={[Math.PI / 2, 0, 0]}>
        <Putar pos={[0, 0, 0]} speed={0.35}>
          <Tube pos={[0, 0, 0]} r={0.12} h={0.08} color={EMAS} seg={16} cast={false} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <group key={i} rotation={[0, (i * Math.PI) / 3, 0]}>
              <Box pos={[0, 0, 0.2]} size={[0.045, 0.05, 0.3]} color={EMAS} cast={false} />
              <Ball pos={[0, 0, 0.36]} r={0.04} color="#FDE68A" />
            </group>
          ))}
        </Putar>
      </group>
      {/* keypad + lampu status */}
      <Box pos={[0.58, 0.95, 0.43]} size={[0.26, 0.5, 0.03]} color="#1F2937" cast={false} />
      <Cahaya pos={[0.58, 1.12, 0.448]} size={[0.18, 0.07, 0.004]} color="#6EE7B7" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => (
        <Box key={`${r}${c}`} pos={[0.5 + c * 0.075, 0.9 - r * 0.075, 0.448]} size={[0.05, 0.05, 0.006]} color="#E5E7EB" cast={false} />
      )))}
      <Cahaya pos={[0.58, 0.66, 0.448]} size={[0.06, 0.02, 0.004]} color="#F87171" />
      {/* papan nama emas */}
      <Box pos={[0, 1.58, 0.425]} size={[0.62, 0.12, 0.012]} color="#8F5A2C" cast={false} />
      <Teks pos={[0, 1.58, 0.433]} w={0.56} h={0.09} text="VAULT · ASSET" fg={EMAS} />
    </group>
  );
}

// Timbangan keadilan di atas dais bundar + cincin emas di lantai.
function TimbanganDais({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <CincinLantai pos={[0, 0.02, 0]} r={0.62} lebar={0.04} color={EMAS} opacity={0.9} />
      <Tube pos={[0, 0.02, 0]} r={0.58} h={0.04} color="#5B3A1C" seg={32} cast={false} />
      <GoldScale pos={[0, 0.04, 0]} s={0.85} />
    </group>
  );
}

function MonitorAset({ sd, seatKey, seed, warna, kata }: { sd: -1 | 1; seatKey: string; seed: number; warna: string; kata: string[] }) {
  return (
    <group position={[sd * 0.5, 0, -0.17]} rotation={[0, sd * -0.22, 0]}>
      <Tube pos={[0, 0.832, 0]} r={0.13} h={0.016} color="#3B2A18" seg={24} cast={false} />
      <Tube pos={[0, 0.842, 0]} r={0.1} h={0.006} color={EMAS} seg={24} cast={false} />
      <Box pos={[0, 0.93, -0.03]} size={[0.05, 0.2, 0.04]} color="#B8860B" cast={false} />
      <Box pos={[0, 1.2, 0]} size={[0.8, 0.48, 0.035]} color="#3B2A18" />
      <Box pos={[0, 1.2, -0.022]} size={[0.74, 0.42, 0.012]} color="#5A3D20" cast={false} />
      <mesh position={[0, 1.2, 0.019]}>
        <boxGeometry args={[0.76, 0.44, 0.006]} />
        <meshStandardMaterial color="#0D0803" roughness={0.2} />
      </mesh>
      <Cahaya pos={[0, 1.2 + 0.235, 0.012]} size={[0.012, 0.012, 0.004]} color="#1F2937" />
      <Box pos={[0, 0.97, 0.018]} size={[0.1, 0.018, 0.004]} color={EMAS} cast={false} />
      <group position={[0, 1.2, 0.024]}>
        <NyalaRim seatKey={seatKey} w={0.8} h={0.48} color={warna} />
      </group>
      <Screen
        seatKey={seatKey}
        size={[0.76, 0.44]}
        pos={[0, 1.2, 0.0255]}
        seed={seed}
        words={kata}
        tema={AS_TEMA}
        ledPos={sd === 1 ? [0.34, 0.968, 0.02] : undefined}
        glow={{ floorPos: [0, 0.832, 0.26], floorSize: [1.1, 0.8], haloPos: [0, 1.2, 0.14], haloSize: [1.0, 0.75] }}
      />
    </group>
  );
}

// Barang khas tiap meja halaman (permukaan meja y = 0.8265, sisi kanan meja).
function KitAset({ k }: { k: KunciAset }) {
  const Y = 0.8265;
  if (k === 'aset') {
    // maket gedung + roda gigi mesin + kunci emas + label aset
    return (
      <group position={[0.78, Y, 0.14]}>
        <Box pos={[0, 0.008, 0]} size={[0.38, 0.016, 0.3]} color="#EAD9B8" cast={false} />
        {[[-0.1, 0.17, 0.09], [0.02, 0.26, 0.1], [0.12, 0.13, 0.08]].map(([x, h, w], i) => (
          <React.Fragment key={i}>
            <Box pos={[x, 0.016 + h / 2, -0.02]} size={[w, h, 0.1]} color={i === 1 ? '#F3E6C8' : '#E7D3A8'} />
            {[0.3, 0.6, 0.85].map((f) => (
              <Cahaya key={f} pos={[x, 0.016 + h * f, 0.032]} size={[w * 0.6, 0.012, 0.004]} color="#FCD34D" opacity={0.9} />
            ))}
          </React.Fragment>
        ))}
        <Putar pos={[-0.02, 0.06, 0.12]} speed={0.9}>
          <Tube pos={[0, 0, 0]} r={0.045} h={0.02} color="#9CA3AF" seg={14} cast={false} />
          {Array.from({ length: 8 }, (_, i) => (
            <Box key={i} pos={[Math.sin((i * Math.PI) / 4) * 0.055, 0, Math.cos((i * Math.PI) / 4) * 0.055]} size={[0.025, 0.02, 0.025]} color="#9CA3AF" rot={[0, (i * Math.PI) / 4, 0]} cast={false} />
          ))}
        </Putar>
        <Tube pos={[0.2, 0.012, 0.1]} r={0.025} h={0.01} color={EMAS} seg={12} cast={false} />
        <Box pos={[0.2, 0.012, 0.15]} size={[0.012, 0.01, 0.07]} color={EMAS} cast={false} />
        <Box pos={[-0.17, 0.03, 0.12]} size={[0.07, 0.03, 0.05]} color="#DC2626" cast={false} />
      </group>
    );
  }
  if (k === 'persediaan') {
    // kardus kecil + pemindai barcode + papan klip + tablet stok
    return (
      <group position={[0.78, Y, 0.1]}>
        <Kardus pos={[0.05, 0, -0.04]} s={0.16} color="#C9A26B" />
        <Kardus pos={[-0.1, 0, -0.06]} s={0.13} color="#B5834A" rotY={0.3} />
        <Kardus pos={[0.0, 0.16, -0.04]} s={0.12} color="#D8B27A" rotY={-0.2} />
        <group position={[-0.12, 0, 0.17]} rotation={[0, 0.5, 0]}>
          <Box pos={[0, 0.03, 0]} size={[0.05, 0.05, 0.13]} color="#1F2937" rot={[0.2, 0, 0]} cast={false} />
          <Box pos={[0, 0.07, 0.08]} size={[0.07, 0.05, 0.08]} color="#374151" cast={false} />
          <Cahaya pos={[0, 0.07, 0.125]} size={[0.05, 0.004, 0.012]} color="#EF4444" />
          <Cahaya pos={[0, 0.0 + 0.012, 0.28]} size={[0.012, 0.002, 0.3]} color="#EF4444" opacity={0.45} />
        </group>
        <Box pos={[0.26, 0.012, 0.12]} size={[0.2, 0.014, 0.26]} color="#8F673C" rot={[0, -0.1, 0]} cast={false} />
        <Box pos={[0.26, 0.021, 0.12]} size={[0.17, 0.004, 0.22]} color="#FFFDF6" rot={[0, -0.1, 0]} cast={false} />
        <Box pos={[0.255, 0.026, 0.01]} size={[0.07, 0.012, 0.02]} color="#9CA3AF" cast={false} />
        {[0, 1, 2].map((i) => (
          <Box key={i} pos={[0.26, 0.025, 0.07 + i * 0.05]} size={[0.12, 0.002, 0.008]} color="#9CA3AF" rot={[0, -0.1, 0]} cast={false} />
        ))}
      </group>
    );
  }
  if (k === 'kewajiban') {
    // tumpukan faktur + stempel + kalkulator + jam pasir jatuh tempo
    return (
      <group position={[0.78, Y, 0.12]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Box key={i} pos={[-0.08, 0.006 + i * 0.01, 0]} size={[0.22, 0.01, 0.3]} color={i === 4 ? '#FFFFFF' : '#F6F1E6'} rot={[0, (i - 2) * 0.05, 0]} cast={false} />
        ))}
        <Box pos={[-0.08, 0.057, -0.06]} size={[0.16, 0.002, 0.03]} color="#DC2626" cast={false} />
        <Box pos={[-0.08, 0.057, 0.02]} size={[0.16, 0.002, 0.008]} color="#9CA3AF" cast={false} />
        <Box pos={[-0.08, 0.057, 0.05]} size={[0.12, 0.002, 0.008]} color="#9CA3AF" cast={false} />
        <group position={[0.1, 0, -0.06]}>
          <Box pos={[0, 0.03, 0]} size={[0.09, 0.05, 0.07]} color="#7F1D1D" />
          <Tube pos={[0, 0.08, 0]} r={0.015} h={0.06} color="#B91C1C" seg={10} cast={false} />
          <Ball pos={[0, 0.12, 0]} r={0.03} color="#DC2626" />
        </group>
        <group position={[0.1, 0, 0.1]} rotation={[0, -0.25, 0]}>
          <Box pos={[0, 0.012, 0]} size={[0.12, 0.024, 0.18]} color="#1F2937" cast={false} />
          <Cahaya pos={[0, 0.026, -0.065]} size={[0.09, 0.003, 0.03]} color="#6EE7B7" />
          {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
            <Box key={`${r}${c}`} pos={[-0.035 + c * 0.035, 0.026, -0.02 + r * 0.04]} size={[0.026, 0.004, 0.026]} color={c === 2 ? '#F59E0B' : '#E5E7EB'} cast={false} />
          )))}
        </group>
        <group position={[-0.28, 0, 0.0]}>
          <Box pos={[0, 0.006, 0]} size={[0.1, 0.012, 0.1]} color="#8F5A2C" cast={false} />
          <Box pos={[0, 0.174, 0]} size={[0.1, 0.012, 0.1]} color="#8F5A2C" cast={false} />
          <Tube pos={[0, 0.13, 0]} r={0.045} rb={0.008} h={0.08} color="#FDE68A" seg={12} cast={false} />
          <Tube pos={[0, 0.05, 0]} r={0.008} rb={0.045} h={0.08} color="#F59E0B" seg={12} cast={false} />
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
            <Tube key={`${sx}${sz}`} pos={[sx * 0.042, 0.09, sz * 0.042]} r={0.006} h={0.16} color="#B8860B" seg={6} cast={false} />
          )))}
        </group>
      </group>
    );
  }
  // ekuitas: tumpukan koin + diagram pai hologram di dais + piala kecil
  return (
    <group position={[0.78, Y, 0.14]}>
      {[[-0.14, 6], [-0.05, 4], [0.04, 8]].map(([x, n], i) => (
        <group key={i} position={[x, 0, -0.04 + (i % 2) * 0.05]}>
          {Array.from({ length: n }, (_, j) => (
            <Tube key={j} pos={[0, 0.006 + j * 0.0105, 0]} r={0.04} h={0.01} color={j % 3 === 2 ? '#FDE68A' : EMAS} seg={16} cast={false} />
          ))}
        </group>
      ))}
      <group position={[0.2, 0, 0.1]}>
        <Tube pos={[0, 0.012, 0]} r={0.12} h={0.024} color="#3B2A18" seg={24} cast={false} />
        <Cahaya pos={[0, 0.026, 0]} size={[0.02, 0.002, 0.02]} color={EMAS} />
        <Putar pos={[0, 0.1, 0]} speed={0.8}>
          {[
            { a: 0, l: 2.2, c: '#34D399' },
            { a: 2.2, l: 1.9, c: EMAS },
            { a: 4.1, l: 2.183, c: '#FB923C' },
          ].map((w) => (
            <mesh key={w.c} rotation={[0, w.a, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 0.05, 20, 1, false, 0, w.l]} />
              <meshBasicMaterial color={w.c} transparent opacity={0.8} toneMapped={false} />
            </mesh>
          ))}
        </Putar>
      </group>
      <Box pos={[-0.22, 0.012, 0.16]} size={[0.1, 0.024, 0.07]} color="#5A3D20" cast={false} />
      <Tube pos={[-0.22, 0.06, 0.16]} r={0.014} h={0.06} color={EMAS} seg={8} cast={false} />
      <Tube pos={[-0.22, 0.12, 0.16]} r={0.04} rb={0.014} h={0.06} color={EMAS} seg={14} cast={false} />
    </group>
  );
}

// Meja kerja Asset: daun krem + inlay kulit cokelat + list kuningan, panel kayu walnut, laci 3 tingkat, 2 monitor emas,
// keyboard + mouse + alas, lampu meja, papan nama halaman, dan barang khas halaman. Monitor menyala saat AI duduk (SEAT[seatKey]).
function MejaAset({ pos, k, label, warna, seatKey, seed }: { pos: V3; k: KunciAset; label: string; warna: string; seatKey: string; seed: number }) {
  const Y = 0.8265;
  return (
    <group position={pos}>
      {/* karpet kecil di bawah meja + sinar lantai */}
      <Kolam pos={[0, 0.02, 0.35]} size={[3.4, 2.7]} color={warna} opacity={0.16} />
      <Box pos={[0, 0.008, 0.3]} size={[2.9, 0.016, 2.2]} color="#E6CFA2" cast={false} />
      <Box pos={[0, 0.017, 0.3]} size={[2.74, 0.006, 2.04]} color="#F6E7C6" cast={false} />
      {[-1.37, 1.37].map((x) => (
        <Box key={x} pos={[x, 0.021, 0.3]} size={[0.03, 0.004, 2.04]} color={EMAS} cast={false} />
      ))}
      {[-1.02, 1.02].map((z) => (
        <Box key={z} pos={[0, 0.021, 0.3 + z]} size={[2.74, 0.004, 0.03]} color={EMAS} cast={false} />
      ))}
      {/* daun meja */}
      <Box pos={[0, 0.79, 0]} size={[2.2, 0.07, 0.9]} color="#F4E9D0" />
      <Box pos={[0, 0.8265, 0.04]} size={[2.02, 0.004, 0.76]} color={AS_KULIT} cast={false} />
      <Box pos={[0, 0.77, 0.455]} size={[2.2, 0.03, 0.012]} color={EMAS} cast={false} />
      <Box pos={[0, 0.77, -0.455]} size={[2.2, 0.03, 0.012]} color="#B8860B" cast={false} />
      {[-1.1, 1.1].map((x) => (
        <Box key={x} pos={[x, 0.77, 0]} size={[0.012, 0.03, 0.9]} color={EMAS} cast={false} />
      ))}
      <Cahaya pos={[0, 0.745, 0.455]} size={[2.1, 0.01, 0.01]} color={warna} opacity={0.9} />
      {/* panel samping walnut + panel belakang + rak kabel */}
      {[-0.98, 0.98].map((x) => (
        <Box key={x} pos={[x, 0.37, 0]} size={[0.1, 0.72, 0.78]} color={AS_KAYU} />
      ))}
      {[-0.98, 0.98].map((x) => (
        <Box key={`k${x}`} pos={[x, 0.02, 0.0]} size={[0.12, 0.04, 0.8]} color="#B8860B" cast={false} />
      ))}
      <Box pos={[0, 0.45, -0.38]} size={[1.86, 0.5, 0.03]} color={AS_KAYU2} />
      <Box pos={[0, 0.66, -0.3]} size={[1.4, 0.04, 0.16]} color="#2A2118" cast={false} />
      {/* laci 3 tingkat di kolong kanan */}
      <group position={[0.58, 0, 0.0]}>
        <Box pos={[0, 0.37, 0]} size={[0.62, 0.7, 0.72]} color={AS_KAYU} />
        {[0.13, 0.37, 0.6].map((y) => (
          <React.Fragment key={y}>
            <Box pos={[0, y, 0.365]} size={[0.56, 0.2, 0.012]} color={AS_KAYU2} cast={false} />
            <Box pos={[0, y + 0.05, 0.38]} size={[0.2, 0.025, 0.02]} color={EMAS} cast={false} />
          </React.Fragment>
        ))}
      </group>
      {/* 2 monitor emas (menyala saat AI duduk) */}
      <MonitorAset sd={-1} seatKey={seatKey} seed={seed} warna={warna} kata={AS_KATA[k]} />
      <MonitorAset sd={1} seatKey={seatKey} seed={seed + 5} warna={warna} kata={AS_KATA[k]} />
      {/* keyboard berkey + mouse + alas */}
      <Box pos={[0.0, 0.8285, 0.27]} size={[0.84, 0.004, 0.34]} color="#2A2118" cast={false} />
      <Box pos={[-0.05, 0.834, 0.25]} size={[0.5, 0.012, 0.17]} color="#3B2F22" cast={false} />
      {[0, 1, 2, 3].map((r) => (
        <Box key={r} pos={[-0.05, 0.8415, 0.19 + r * 0.04]} size={[0.46, 0.004, 0.026]} color={r === 3 ? '#E7D3A8' : '#8A7455'} cast={false} />
      ))}
      <Box pos={[-0.05, 0.8425, 0.3]} size={[0.3, 0.004, 0.02]} color="#E7D3A8" cast={false} />
      <Box pos={[0.3, 0.8335, 0.27]} size={[0.07, 0.016, 0.11]} color="#3B2F22" cast={false} />
      <Cahaya pos={[0.3, 0.843, 0.25]} size={[0.012, 0.003, 0.03]} color={EMAS} />
      <Cahaya pos={[-0.05, 0.8295, 0.4]} size={[0.5, 0.002, 0.008]} color={warna} opacity={0.6} />
      {/* lampu meja + papan nama + barang khas */}
      <LampuMeja pos={[-0.86, Y, -0.22]} rotY={0.6} />
      <group position={[-0.28, 0, 0.0]}>
        <DeskPlate label={label} color={warna} />
      </group>
      <KitAset k={k} />
    </group>
  );
}

// [BARU] Troli plat (flatbed trolley) bermuatan kardus: roda, dek kayu, gagang dorong.
function TroliPlat({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.17, 0]} size={[1.1, 0.04, 0.66]} color="#3F4756" />
      <Box pos={[0, 0.192, 0]} size={[1.04, 0.012, 0.6]} color="#A97C45" cast={false} />
      <Box pos={[0, 0.17, 0.335]} size={[1.1, 0.03, 0.012]} color={EMAS} cast={false} />
      {[-0.48, 0.48].flatMap((x) => [-0.26, 0.26].map((z) => (
        <React.Fragment key={`${x}${z}`}>
          <Tube pos={[x, 0.06, z]} r={0.055} h={0.045} color="#1F2937" rot={[0, 0, Math.PI / 2]} seg={12} cast={false} />
          <Tube pos={[x, 0.06, z]} r={0.02} h={0.05} color="#9CA3AF" rot={[0, 0, Math.PI / 2]} seg={8} cast={false} />
          <Box pos={[x, 0.125, z]} size={[0.05, 0.06, 0.06]} color="#6B7280" cast={false} />
        </React.Fragment>
      )))}
      {[-0.26, 0.26].map((z) => (
        <Box key={z} pos={[-0.52, 0.55, z]} size={[0.03, 0.72, 0.03]} color="#374151" cast={false} />
      ))}
      <Box pos={[-0.52, 0.91, 0]} size={[0.045, 0.045, 0.56]} color="#1F2937" cast={false} />
      <Box pos={[-0.52, 0.91, 0.2]} size={[0.05, 0.05, 0.14]} color="#DC2626" cast={false} />
      <Kardus pos={[0.1, 0.198, -0.1]} s={0.42} color="#C9A26B" />
      <Kardus pos={[0.1, 0.618, -0.1]} s={0.3} color="#D8B27A" rotY={0.2} fragile />
      <Kardus pos={[0.3, 0.198, 0.18]} s={0.3} color="#B5834A" rotY={-0.15} />
      <Kardus pos={[-0.2, 0.198, 0.16]} s={0.26} color="#5B9BD5" rotY={0.25} />
    </group>
  );
}

// [BARU] Tong sampah kecil (kayu walnut + bibir emas) berisi kertas.
function TongSampahAset({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.15, 0]} r={0.13} rb={0.1} h={0.3} color="#6B4A2B" seg={14} />
      <Tube pos={[0, 0.305, 0]} r={0.135} h={0.016} color={EMAS} seg={14} cast={false} />
      <Box pos={[0.02, 0.34, 0.01]} size={[0.1, 0.07, 0.08]} color="#F6F1E6" rot={[0.3, 0.5, 0.2]} cast={false} />
      <Box pos={[-0.04, 0.33, -0.03]} size={[0.08, 0.06, 0.07]} color="#FFFFFF" rot={[-0.2, 0.9, 0.3]} cast={false} />
    </group>
  );
}

// [BARU] Detail kecil ruang Asset (hanya tampilan): AC dinding, APAR, keset, area palet, troli, tong sampah.
// Tidak menyentuh jalur agen (kolom x 15.4..17.4 dari pintu ke tengah ruangan hanya diberi keset datar).
function AsetDetail() {
  const { cx } = ASET;
  const z0 = ASET.cz - 4;
  return (
    <>
      {/* AC split di dinding utara, antara brankas dan pintu (dinding itu padat), + pipa kondensat ke lantai */}
      <WallAC pos={[14.45, 1.3, z0 + 0.05]} />
      <Box pos={[15.14, 0.72, z0 + 0.06]} size={[0.04, 0.84, 0.04]} color="#E5E7EB" cast={false} />
      <Box pos={[15.14, 0.3, z0 + 0.075]} size={[0.07, 0.03, 0.07]} color="#9CA3AF" cast={false} />
      {/* APAR + tanda merah di sebelah kanan pintu */}
      <Extinguisher pos={[17.68, 0.28, z0 + 0.12]} />
      <Box pos={[17.68, 0.78, z0 + 0.014]} size={[0.28, 0.2, 0.024]} color="#C9453B" cast={false} />
      <Teks pos={[17.68, 0.78, z0 + 0.03]} w={0.24} h={0.1} text="APAR" fg="#FFFFFF" />
      {/* keset pintu masuk */}
      <Box pos={[cx, 0.011, z0 + 0.62]} size={[1.5, 0.012, 0.6]} color="#4A2F18" cast={false} />
      <Box pos={[cx, 0.0175, z0 + 0.62]} size={[1.4, 0.004, 0.5]} color="#6B4A2B" cast={false} />
      <Teks pos={[cx, 0.021, z0 + 0.62]} rot={[-Math.PI / 2, 0, 0]} w={0.9} h={0.16} text="ASSET ROOM" fg={EMAS} />
      {/* garis area palet di lantai + label */}
      {[23.15, 24.65].map((z) => (
        <Box key={z} pos={[14.0, 0.017, z]} size={[1.7, 0.012, 0.05]} color={EMAS} cast={false} />
      ))}
      {[13.15, 14.85].map((x) => (
        <Box key={x} pos={[x, 0.017, 23.9]} size={[0.05, 0.012, 1.55]} color={EMAS} cast={false} />
      ))}
      <Teks pos={[14.0, 0.022, 24.92]} rot={[-Math.PI / 2, 0, 0]} w={0.9} h={0.13} text="AREA PALET" fg="#8F5A2C" />
      {/* troli plat bermuatan di dekat meja Delta + tong sampah di samping meja */}
      <TroliPlat pos={[17.2, 0, 27.5]} rotY={-0.08} />
      <TongSampahAset pos={[20.85, 0, 23.65]} />
      <TongSampahAset pos={[14.85, 0, 26.45]} />
    </>
  );
}

// ---- [BARU] Lantai & dinding ruang Asset ---------------------------------------------------------------------------------
// Tema: brankas + gudang aset. Lantai parket kayu madu (pola anyaman), karpet tenun pasir, inlay keliling walnut + kuningan.
// Dinding: lis bawah walnut, panel walnut berbingkai, rel kuningan, kertas dinding krem bermotif koin & peti, list atas walnut + LED hangat.
const AS_WALNUT = '#4A2F18';
const AS_KUNINGAN = '#C9A24A';

// Lantai parket kayu madu pola anyaman (blok 0.5 x 0.5, tiap blok 4 papan; blok bergantian arah). Tile 2.0 x 2.0.
function LantaiParketAset({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const dasar = useKanvasMg(512, 512, (g) => {
    const r = mulberry32(4242);
    const warna = ['#E9D2A6', '#E3C998', '#EBD6AE', '#DFC28F', '#E7CFA0', '#EDD8B0'];
    for (let bi = 0; bi < 4; bi++) {
      for (let bj = 0; bj < 4; bj++) {
        const horiz = (bi + bj) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const x = horiz ? bi * 128 : bi * 128 + k * 32;
          const y = horiz ? bj * 128 + k * 32 : bj * 128;
          const pw = horiz ? 128 : 32, ph = horiz ? 32 : 128;
          g.fillStyle = warna[Math.floor(r() * warna.length)];
          g.fillRect(x, y, pw, ph);
          // serat kayu searah papan
          for (let n = 0; n < 5; n++) {
            g.strokeStyle = `rgba(140,95,45,${0.07 + r() * 0.1})`;
            g.lineWidth = 1;
            g.beginPath();
            if (horiz) { const yy = y + 4 + r() * 24; g.moveTo(x + 2, yy); g.lineTo(x + pw - 2, yy + (r() - 0.5) * 3); }
            else { const xx = x + 4 + r() * 24; g.moveTo(xx, y + 2); g.lineTo(xx + (r() - 0.5) * 3, y + ph - 2); }
            g.stroke();
          }
          // sorot tepi atas/kiri + celah gelap bawah/kanan
          g.fillStyle = 'rgba(255,255,255,0.2)';
          g.fillRect(x, y, pw, 1.5);
          g.fillRect(x, y, 1.5, ph);
          g.fillStyle = 'rgba(95,62,28,0.42)';
          g.fillRect(x, y + ph - 1.5, pw, 1.5);
          g.fillRect(x + pw - 1.5, y, 1.5, ph);
        }
        // garis batas blok sedikit lebih gelap
        g.strokeStyle = 'rgba(95,62,28,0.35)';
        g.lineWidth = 2;
        g.strokeRect(bi * 128 + 1, bj * 128 + 1, 126, 126);
      }
    }
  }, 'aset-parket');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 2, d / 2);
    t.needsUpdate = true;
    return t;
  }, [dasar, w, d]);
  return (
    <mesh position={[cx, 0.003, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Karpet tenun pasir: kisi berlian halus + titik benang emas + serat. Tile 1.0 x 1.0.
function KarpetTenunAset({ pos, w, d }: { pos: V3; w: number; d: number }) {
  const dasar = useKanvasMg(256, 256, (g) => {
    const r = mulberry32(909);
    g.fillStyle = '#EBDAB8';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 1400; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(150,115,60,0.07)' : 'rgba(255,255,255,0.12)';
      g.fillRect(r() * 256, r() * 256, 1.5, 1.5 + r() * 2.5);
    }
    g.strokeStyle = 'rgba(160,118,52,0.22)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x = i * 128, y = j * 128;
        g.beginPath();
        g.moveTo(x + 64, y);
        g.lineTo(x + 128, y + 64);
        g.lineTo(x + 64, y + 128);
        g.lineTo(x, y + 64);
        g.closePath();
        g.stroke();
        g.fillStyle = 'rgba(184,134,11,0.34)';
        g.beginPath(); g.arc(x + 64, y + 64, 3.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(184,134,11,0.22)';
        for (const [ox, oy] of [[64, 0], [128, 64], [64, 128], [0, 64]]) { g.beginPath(); g.arc(x + ox, y + oy, 2, 0, Math.PI * 2); g.fill(); }
      }
    }
  }, 'aset-karpet-tenun');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w, d);
    t.needsUpdate = true;
    return t;
  }, [dasar, w, d]);
  return (
    <mesh position={pos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Inlay keliling lantai: pita walnut 0.24 + garis kuningan tipis di sisi dalam. Celah pintu utara (x 15.4 .. 17.4) dilewati; ambang kuningan di pintu.
function InlayLantaiAset() {
  const x0 = ASET.cx - 5, x1 = ASET.cx + 5, z0 = ASET.cz - 4, z1 = ASET.cz + 4;
  const cx = ASET.cx;
  const WAL = '#5A3A1D';
  const utara: [number, number][] = [[x0, cx - 1.0], [cx + 1.0, x1]];
  return (
    <>
      {utara.map(([a, b]) => (
        <React.Fragment key={`u${a}`}>
          <Box pos={[(a + b) / 2, 0.0035, z0 + 0.12]} size={[b - a, 0.003, 0.24]} color={WAL} cast={false} />
          <Box pos={[(a + b) / 2, 0.0042, z0 + 0.29]} size={[b - a, 0.002, 0.022]} color={AS_KUNINGAN} cast={false} />
        </React.Fragment>
      ))}
      <Box pos={[cx, 0.0035, z1 - 0.12]} size={[x1 - x0, 0.003, 0.24]} color={WAL} cast={false} />
      <Box pos={[cx, 0.0042, z1 - 0.29]} size={[x1 - x0 - 0.48, 0.002, 0.022]} color={AS_KUNINGAN} cast={false} />
      {[x0 + 0.12, x1 - 0.12].map((x, i) => (
        <React.Fragment key={`s${x}`}>
          <Box pos={[x, 0.0035, ASET.cz]} size={[0.24, 0.003, z1 - z0]} color={WAL} cast={false} />
          <Box pos={[x + (i ? -0.17 : 0.17), 0.0042, ASET.cz]} size={[0.022, 0.002, z1 - z0 - 0.48]} color={AS_KUNINGAN} cast={false} />
        </React.Fragment>
      ))}
      {/* ambang kuningan pintu */}
      <Box pos={[cx, 0.007, z0 + 0.06]} size={[2.0, 0.012, 0.12]} color={AS_KUNINGAN} cast={false} />
      <Box pos={[cx, 0.0135, z0 + 0.06]} size={[1.9, 0.002, 0.03]} color={AS_WALNUT} cast={false} />
    </>
  );
}

function LantaiAset() {
  const { cx, cz, w, d } = ASET;
  return (
    <>
      <LantaiParketAset cx={cx} cz={cz} w={w} d={d} />
      <KarpetTenunAset pos={[cx, 0.005, 24.6]} w={8.6} d={6.0} />
      {/* pita tepi karpet */}
      {[21.7, 27.5].map((z) => (
        <Box key={`kz${z}`} pos={[cx, 0.0058, z]} size={[8.6, 0.002, 0.2]} color="#D6B982" cast={false} />
      ))}
      {[cx - 4.2, cx + 4.2].map((x) => (
        <Box key={`kx${x}`} pos={[x, 0.0058, 24.6]} size={[0.2, 0.002, 5.6]} color="#D6B982" cast={false} />
      ))}
      <InlayLantaiAset />
    </>
  );
}

// Kertas dinding krem-emas: kisi berlian + koin (aset tetap) dan peti (persediaan) bergantian. Tile 2.0 x 0.6.
function KertasDindingAset({ pos, w, h = 0.6 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(640, 192, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#F7ECD3');
    gr.addColorStop(1, '#EBDBB8');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(184,134,11,0.07)';
    for (let x = 6; x < W; x += 16) g.fillRect(x, 0, 1.2, H);
    g.strokeStyle = 'rgba(160,110,40,0.2)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 2; j++) {
        const cx = i * 128 + 64, cy = j * 96 + 48;
        g.beginPath();
        g.moveTo(cx, cy - 48);
        g.lineTo(cx + 64, cy);
        g.lineTo(cx, cy + 48);
        g.lineTo(cx - 64, cy);
        g.closePath();
        g.stroke();
        // simpul sudut
        g.fillStyle = 'rgba(184,134,11,0.3)';
        g.beginPath(); g.arc(cx + 64, cy, 2.2, 0, Math.PI * 2); g.fill();
        if ((i + j) % 2 === 0) {
          // koin
          g.strokeStyle = 'rgba(184,134,11,0.5)';
          g.lineWidth = 2;
          g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.stroke();
          g.lineWidth = 1;
          g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.stroke();
          g.fillStyle = 'rgba(184,134,11,0.45)';
          g.fillRect(cx - 1.5, cy - 6, 3, 12);
        } else {
          // peti + pita
          g.fillStyle = 'rgba(143,90,44,0.22)';
          g.fillRect(cx - 14, cy - 12, 28, 24);
          g.strokeStyle = 'rgba(143,90,44,0.5)';
          g.lineWidth = 1.6;
          g.strokeRect(cx - 14, cy - 12, 28, 24);
          g.beginPath(); g.moveTo(cx - 14, cy - 2); g.lineTo(cx + 14, cy - 2); g.moveTo(cx, cy - 12); g.lineTo(cx, cy + 12); g.stroke();
        }
        g.strokeStyle = 'rgba(160,110,40,0.2)';
        g.lineWidth = 1.2;
      }
    }
  }, 'aset-kertas-dinding');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(0.5, w / 2), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Panel walnut berbingkai (satu panel timbul per 1.0 lebar). Tile 1.0 x 0.78.
function PanelWalnutAset({ pos, w, h = 0.78 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 200, (g, W, H) => {
    const r = mulberry32(31);
    g.fillStyle = '#5A3A1D';
    g.fillRect(0, 0, W, H);
    // serat bingkai
    for (let k = 0; k < 18; k++) {
      g.fillStyle = `rgba(30,16,6,${0.06 + r() * 0.08})`;
      g.fillRect(r() * W, 0, 1, H);
    }
    // panel timbul
    const gr = g.createLinearGradient(0, 18, 0, H - 18);
    gr.addColorStop(0, '#8A5A2F');
    gr.addColorStop(1, '#74481F');
    g.fillStyle = gr;
    g.fillRect(22, 18, W - 44, H - 36);
    g.fillStyle = 'rgba(255,225,170,0.3)';
    g.fillRect(22, 18, W - 44, 3);
    g.fillRect(22, 18, 3, H - 36);
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(22, H - 21, W - 44, 3);
    g.fillRect(W - 25, 18, 3, H - 36);
    // bidang dalam (cekung)
    g.fillStyle = '#7B4B24';
    g.fillRect(46, 40, W - 92, H - 80);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(46, 40, W - 92, 2.5);
    g.fillRect(46, 40, 2.5, H - 80);
    g.fillStyle = 'rgba(255,225,170,0.22)';
    g.fillRect(46, H - 42, W - 92, 2.5);
    g.fillRect(W - 48, 40, 2.5, H - 80);
    for (let k = 0; k < 10; k++) {
      g.strokeStyle = `rgba(50,28,10,${0.08 + r() * 0.1})`;
      g.lineWidth = 1;
      const x = 52 + r() * (W - 104);
      g.beginPath(); g.moveTo(x, 46); g.lineTo(x + (r() - 0.5) * 6, H - 46); g.stroke();
    }
    // paku kuningan di sudut panel
    g.fillStyle = '#D9B45A';
    for (const [x, y] of [[34, 30], [W - 34, 30], [34, H - 30], [W - 34, H - 30]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  }, 'aset-panel-walnut');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(w)), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias dinding Asset (menghadap +z lokal, x sepanjang dinding, z = keluar dari permukaan dinding).
function DindingDekorAset({ segs }: { segs: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        return (
          <React.Fragment key={`da${a}`}>
            <PanelWalnutAset pos={[cx, 0.5, 0.012]} w={L} />
            <Box pos={[cx, 0.045, 0.017]} size={[L, 0.09, 0.034]} color="#3B2412" cast={false} />
            <Box pos={[cx, 0.096, 0.02]} size={[L, 0.012, 0.04]} color={AS_KUNINGAN} cast={false} />
            <Box pos={[cx, 0.9, 0.022]} size={[L, 0.04, 0.044]} color={AS_WALNUT} cast={false} />
            <Box pos={[cx, 0.924, 0.024]} size={[L, 0.008, 0.048]} color={AS_KUNINGAN} cast={false} />
            <Cahaya pos={[cx, 0.876, 0.02]} size={[L - 0.02, 0.008, 0.004]} color="#FFE2A0" opacity={0.85} />
            <KertasDindingAset pos={[cx, 1.218, 0.002]} w={L} />
            <Box pos={[cx, 1.54, 0.02]} size={[L, 0.05, 0.04]} color={AS_WALNUT} cast={false} />
            <Box pos={[cx, 1.51, 0.022]} size={[L, 0.008, 0.044]} color={AS_KUNINGAN} cast={false} />
            <Cahaya pos={[cx, 1.572, 0.012]} size={[L - 0.02, 0.008, 0.008]} color="#FFEFC4" opacity={0.9} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Tiang sudut: kolom walnut berlis kuningan (tinggi dinding).
function TiangSudutAset({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.8, 0]} size={[0.22, 1.6, 0.22]} color={AS_WALNUT} />
      <Box pos={[0, 0.8, 0]} size={[0.24, 1.6, 0.03]} color={AS_KUNINGAN} cast={false} />
      <Box pos={[0, 0.8, 0]} size={[0.03, 1.6, 0.24]} color={AS_KUNINGAN} cast={false} />
      <Box pos={[0, 0.03, 0]} size={[0.27, 0.06, 0.27]} color="#2E1C0D" cast={false} />
      <Box pos={[0, 1.55, 0]} size={[0.26, 0.05, 0.26]} color="#2E1C0D" cast={false} />
      <Cahaya pos={[0, 1.58, 0]} size={[0.2, 0.012, 0.2]} color="#FFEFC4" opacity={0.9} />
    </group>
  );
}

// Lampu dinding kuningan (bar cahaya hangat) untuk dinding timur.
function LampuDindingAset({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0.018]} size={[0.12, 0.3, 0.03]} color="#8F6A1F" cast={false} />
      <Box pos={[0, 0.16, 0.05]} size={[0.14, 0.03, 0.09]} color={AS_KUNINGAN} cast={false} />
      <Box pos={[0, -0.16, 0.05]} size={[0.14, 0.03, 0.09]} color={AS_KUNINGAN} cast={false} />
      <Cahaya pos={[0, 0, 0.05]} size={[0.05, 0.28, 0.05]} color="#FFE7A8" opacity={0.95} />
      <Kolam pos={[0, 0, 0.004]} size={[0.9, 1.1]} color="#FFE7A8" opacity={0.1} rot={[0, 0, 0]} />
    </group>
  );
}

// Dinding utara (kecuali celah pintu), barat, dan timur ruang Asset. Dinding selatan = partisi kaca, tidak dilapis.
function DindingAset() {
  const x0 = ASET.cx - 5, x1 = ASET.cx + 5, z0 = ASET.cz - 4, z1 = ASET.cz + 4;
  const cx = ASET.cx;
  return (
    <>
      <group position={[0, 0, z0]}>
        <DindingDekorAset segs={[[x0, cx - 1.06], [cx + 1.06, x1]]} />
      </group>
      <group position={[x0, 0, ASET.cz]} rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorAset segs={[[-4, 4]]} />
      </group>
      <group position={[x1, 0, ASET.cz]} rotation={[0, -Math.PI / 2, 0]}>
        <DindingDekorAset segs={[[-4, 4]]} />
        {[-2.3, 0.0, 2.3].map((x) => (
          <LampuDindingAset key={`ld${x}`} pos={[x, 1.2, 0.0]} />
        ))}
      </group>
      <TiangSudutAset pos={[x0 + 0.11, 0, z0 + 0.11]} />
      <TiangSudutAset pos={[x1 - 0.11, 0, z0 + 0.11]} />
      <TiangSudutAset pos={[x0 + 0.11, 0, z1 - 0.11]} />
      <TiangSudutAset pos={[x1 - 0.11, 0, z1 - 0.11]} />
    </>
  );
}

function AsetArea() {
  const { cx } = ASET;
  const x0 = cx - 5, z0 = ASET.cz - 4, x1 = cx + 5;
  const meja = [
    { p: [cx + 3.0, 22.6] as [number, number], h: HALAMAN_ASET[0], seed: 201 },
    { p: [cx + 3.0, 24.7] as [number, number], h: HALAMAN_ASET[1], seed: 217 },
    { p: [cx - 3.0, 26.6] as [number, number], h: HALAMAN_ASET[2], seed: 233 },
    { p: [cx + 3.0, 27.0] as [number, number], h: HALAMAN_ASET[3], seed: 249 },
  ];
  return (
    <>
      <Lantai {...ASET} color={TH.aset.floor} />
      {/* [DIPERDETAIL] lantai parket kayu madu pola anyaman + karpet tenun pasir + inlay keliling walnut/kuningan */}
      <LantaiAset />
      {/* bingkai emas karpet + garis dalam */}
      {[22.0, 27.2].map((z) => (
        <Box key={z} pos={[cx, 0.014, z]} size={[8.6, 0.01, 0.06]} color={EMAS} cast={false} />
      ))}
      {[cx - 4.27, cx + 4.27].map((x) => (
        <Box key={x} pos={[x, 0.014, 24.6]} size={[0.06, 0.01, 5.2]} color={EMAS} cast={false} />
      ))}
      {/* medali lantai tengah: cincin emas + tulisan */}
      <CincinLantai pos={[cx, 0.02, 24.6]} r={1.25} lebar={0.05} color={EMAS} opacity={0.95} />
      <CincinLantai pos={[cx, 0.02, 24.6]} r={0.95} lebar={0.03} color="#B8860B" opacity={0.9} />
      <Tube pos={[cx, 0.012, 24.6]} r={0.92} h={0.012} color="#F8EBCB" seg={40} cast={false} />
      <Teks pos={[cx, 0.026, 24.6]} rot={[-Math.PI / 2, 0, 0]} w={1.5} h={0.42} text="ASSETS" fg="#B8860B" />
      {/* garis keselamatan kuning dari pintu masuk */}
      {[cx - 1.0, cx + 1.0].map((x) => (
        <Box key={x} pos={[x, 0.016, 21.7]} size={[0.07, 0.012, 2.8]} color={EMAS} cast={false} />
      ))}
      <DekorDindingKiri pos={[11.44, 0, 24.35]} jenis="aset" />
      {/* [BARU] lapisan hias dinding utara (kecuali celah pintu), barat, timur + tiang sudut */}
      <DindingAset />
      {/* brankas + emas batangan + karung uang + timbangan */}
      <BrankasAset pos={[x0 + 1.12, 0, z0 + 0.5]} />
      <BatangEmas pos={[x0 + 0.87, 0, z0 + 1.7]} rotY={0.15} />
      {[[1.42, 1.78, 5], [1.58, 1.62, 3]].map(([dx, dz, n], i) => (
        <group key={i} position={[x0 + dx, 0, z0 + dz]}>
          {Array.from({ length: n }, (_, j) => (
            <Tube key={j} pos={[0, 0.008 + j * 0.0125, 0]} r={0.06} h={0.012} color={j % 2 ? '#FDE68A' : EMAS} seg={14} cast={false} />
          ))}
        </group>
      ))}
      <KarungUang pos={[x0 + 1.97, 0, z0 + 1.8]} />
      <TimbanganDais pos={[cx - 1.9, 0, 21.4]} />
      {/* rak gudang + palet bungkus + hand pallet */}
      <RakGudang pos={[cx + 3.0, 0, 20.9]} />
      <PaletBungkus pos={[cx - 2.4, 0, 23.9]} rotY={0.12} />
      <PalletJack pos={[cx - 3.7, 0, 25.1]} rotY={Math.PI / 2 + 0.1} />
      {/* 4 meja = 4 halaman Assets & Equity */}
      {meja.map(({ p: [x, z], h, seed }) => (
        <React.Fragment key={h.id}>
          <MejaAset pos={[x, 0, z]} k={h.kunci} label={h.nama} warna={h.warna} seatKey={h.seat} seed={seed} />
          <Chair pos={[x, 0, z + 0.85]} color="#B8833F" />
        </React.Fragment>
      ))}
      {/* tumpukan kardus sudut */}
      <Kardus pos={[x0 + 0.65, 0, 27.7]} s={0.7} color="#C9A26B" fragile />
      <Kardus pos={[x0 + 0.65, 0.7, 27.7]} s={0.5} color="#B5834A" rotY={0.2} />
      <Kardus pos={[cx - 1.4, 0, 27.6]} s={0.8} color="#B5834A" />
      <Kardus pos={[cx - 1.4, 0.8, 27.6]} s={0.5} color="#C9A26B" rotY={-0.15} />
      <Kardus pos={[cx - 0.55, 0, 27.8]} s={0.42} color="#D8B27A" rotY={0.3} />
      <PlantPalm pos={[x1 - 0.5, 0, 21.0]} scale={0.9} />
      <PlantSnake pos={[x0 + 0.5, 0, 23.2]} scale={0.9} />
      <FloorLamp pos={[x1 - 0.4, 0, 27.6]} />
      <AsetDetail />
      <AsetPenghuni />
    </>
  );
}

// ---- [BARU] BARIS 3: lorong bawah + ruang PLANNING + ruang MANAGEMENT -------------------------------------------------------
// MODE DESAIN SAJA: belum terhubung ke backend / tugas agen. Daftar halaman di bawah disiapkan supaya nanti tinggal
// disambungkan (id = kunci meja, href = halaman tujuan; urutan = urutan meja/kursi di ruangan).
//
//   z 17.1  ── LORONG 2 (tersambung lewat pintu depan Perpus & Studio) ──
//   z 19.6  ┌──────────────────────────────┬────────────────────────────────────┐
//           │ PLANNING (16 x 11)           │ MANAGEMENT (20.6 x 11)             │
//           │ 3 meja: Budget, Tax, Analytics│ meja bundar besar + 7 kursi        │
//   z 30.6  └──────────────────────────────┴────────────────────────────────────┘
//           x -18.3                       -2.3                                18.3

export const HALAMAN_PLANNING = [
  { id: 'budget-forecast', nama: 'Budget & Forecast', href: '/budget-forecast', warna: '#8B5CF6' },
  { id: 'tax-compliance', nama: 'Tax Compliance', href: '/tax-compliance', warna: '#6366F1' },
  { id: 'financial-analytics', nama: 'Financial Analytics', href: '/financial-analytics', warna: '#A78BFA' },
] as const;

export const HALAMAN_MANAGEMENT = [
  { id: 'reports', nama: 'Reports', href: '/reports', warna: '#3B82F6', kit: 'reports' },
  { id: 'clients', nama: 'Clients', href: '/clients', warna: '#0EA5E9', kit: 'clients' },
  { id: 'coa', nama: 'Chart of Accounts', href: '/coa', warna: '#14B8A6', kit: 'coa' },
  { id: 'year-end-closing', nama: 'Year-End Closing', href: '/year-end-closing', warna: '#EF4444', kit: 'tutup' },
  { id: 'documents', nama: 'Documents', href: '/documents', warna: '#F59E0B', kit: 'dokumen' },
  { id: 'settings', nama: 'Settings', href: '/settings', warna: '#64748B', kit: 'pengaturan' },
  { id: 'payroll', nama: 'Payroll', href: '/payroll', warna: '#22C55E', kit: 'payroll' },
] as const;

const PLAN = { cx: -10.3, cz: 25.1 + GESER_BARIS_3, w: 16, d: 11 };
// [DIUBAH] Meja bundar Management sekarang TEPAT di tengah ruangan: pusat ruang 10.0 = pusat meja (MG_OX). Pintu lorong 2 & jalur agen ikut x = 10.0.
const MGMT = { cx: (SEKAT_B3 + X_TIMUR) / 2, cz: 25.1 + GESER_BARIS_3, w: X_TIMUR - SEKAT_B3, d: 11 }; // [DIUBAH] melebar ke timur sebesar TAMBAH_TIMUR; meja bundar tetap di pusat ruangan
const MG_OX = MGMT.cx;
// Kursi di meja bundar Management: tanpa Year-End Closing (kursi kosong dihapus) -> 6 kursi/AI melingkar rata.
const HALAMAN_MG_DUDUK = HALAMAN_MANAGEMENT.filter((h) => h.id !== 'year-end-closing');

// ---- helper umum baris 3 ----

// Grup yang berputar pelan terus-menerus (hologram, gigi, dll).
function Putar({ pos, speed = 0.6, children }: { pos: V3; speed?: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += Math.min(dt, 0.05) * speed;
  });
  return <group ref={ref} position={pos}>{children}</group>;
}

// Bidang bercahaya (layar / hologram) — tidak terpengaruh lampu.
function Cahaya({ pos, size, color, opacity = 1 }: { pos: V3; size: V3; color: string; opacity?: number }) {
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

// Tulisan di bidang datar (tekstur canvas), dipakai untuk papan kecil.
function Teks({ pos, rot, w, h, text, fg = '#FFFFFF', bg }: { pos: V3; rot?: V3; w: number; h: number; text: string; fg?: string; bg?: string }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.max(32, Math.round((512 * h) / w));
    const g = c.getContext('2d');
    if (g) {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, c.width, c.height);
      }
      let fs = Math.round(c.height * 0.62);
      g.font = `800 ${fs}px Inter, system-ui, sans-serif`;
      while (g.measureText(text).width > c.width * 0.92 && fs > 16) {
        fs -= 4;
        g.font = `800 ${fs}px Inter, system-ui, sans-serif`;
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, c.width / 2, c.height / 2 + 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [text, fg, bg, w, h]);
  return (
    <mesh position={pos} rotation={rot}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

// ======================= RUANG PLANNING (violet / indigo): "PUSAT PROYEKSI" futuristik, gaya Research =======================
// [DIDESAIN ULANG] Tata letak (koordinat lokal ruangan, x -12..8, z -5.5..5.5):
//   - 4 meja kerja TETAP di posisi lama (jalur agen tidak berubah): Pixel(-5.2,-3.4) Sigma(-5.2,0.4) Radian(5.2,-3.4) Quark(5.2,0.4)
//   - globe proyeksi + karpet cincin di (0.4, 2.0); jejak sirkuit lantai menghubungkan tiap meja ke globe
//   - dinding barat: papan roadmap + layar proyeksi; dinding utara: 3 layar dasbor + rak arsip; sudut barat-daya: lounge
//   - jalur agen yang harus tetap kosong: x -2.4..-0.9 (z -4.5..-0.3), z -0.8..0.3 (x -1.7..6.3), x 6.8..8 (z -0.2..3.6)
// Murni tampilan (belum terhubung backend). Layar komputer menyala saat AI duduk di meja (lewat SEAT[seatKey]).

const PL_TEMA: ScreenTema = {
  bg: '#0A0A26',
  cols: ['#A78BFA', '#67E8F9', '#6EE7B7', '#FDE68A', '#F0ABFC', '#E5E7EB'],
  glow: '#A78BFA',
};
const PL_KATA = ['Budget', 'Forecast', 'Proyeksi', 'Skenario', 'Tren', 'Q1', 'Q2', 'Q3', 'Q4', 'Pajak', 'SPT', 'PPh Badan', 'Margin', 'Arus Kas', 'Rasio', 'Target', 'Risiko', 'Growth', 'Rp', 'YoY'];

// ---- isi layar canvas (data contoh / desain) ----
function kepalaLayar(g: CanvasRenderingContext2D, W: number, judul: string, warna: string, status = '● LIVE') {
  g.fillStyle = 'rgba(167,139,250,0.2)';
  g.fillRect(0, 0, W, Math.round(W * 0.085));
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#EDE9FE';
  g.font = `800 ${Math.round(W * 0.05)}px ${FONT}`;
  g.fillText(judul, W * 0.04, W * 0.043);
  g.textAlign = 'right';
  g.fillStyle = warna;
  g.font = `700 ${Math.round(W * 0.034)}px ${FONT}`;
  g.fillText(status, W * 0.96, W * 0.043);
  g.textAlign = 'left';
}
function gridLayar(g: CanvasRenderingContext2D, W: number, H: number, step: number) {
  g.fillStyle = '#0B0A24';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(103,232,249,0.07)';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
}

// Layar proyeksi besar (dinding barat): 3 skenario masa depan, kursor "sekarang" bergerak.
const gambarProyeksi: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 32);
  kepalaLayar(g, W, 'PROYEKSI KONDISI PERUSAHAAN 2027', '#6EE7B7');
  const x0 = 50, x1 = W - 300, yT = 90, yB = H - 34;
  g.strokeStyle = 'rgba(237,233,254,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = yT + ((yB - yT) * i) / 4;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  }
  const N = 40, K = 22;
  const nilai = (i: number, ska: number) => {
    const dasar = 0.3 + 0.32 * (Math.min(i, K) / K) + 0.025 * Math.sin(i * 0.9);
    if (i <= K) return dasar;
    const d = i - K;
    return dasar + d * [0.014, 0.0075, -0.004][ska] + 0.012 * Math.sin(i * 0.7 + ska);
  };
  const px = (i: number) => x0 + ((x1 - x0) * i) / (N - 1);
  const py = (v: number) => yB - (yB - yT) * v;
  const warna = ['#6EE7B7', '#67E8F9', '#F0ABFC'];
  g.lineWidth = 4;
  g.setLineDash([]);
  g.strokeStyle = '#EDE9FE';
  g.beginPath();
  for (let i = 0; i <= K; i++) { const x = px(i), y = py(nilai(i, 1)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  g.setLineDash([12, 8]);
  [0, 1, 2].forEach((s) => {
    g.strokeStyle = warna[s];
    g.beginPath();
    for (let i = K; i < N; i++) { const x = px(i), y = py(nilai(i, s)); if (i === K) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  });
  g.setLineDash([]);
  g.strokeStyle = 'rgba(253,230,138,0.7)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(px(K), yT - 6); g.lineTo(px(K), yB); g.stroke();
  g.fillStyle = '#FDE68A';
  g.font = `700 16px ${FONT}`;
  g.fillText('SEKARANG', px(K) - 38, yT - 14);
  // kursor penyapu
  const f = (t * 0.07) % 1;
  const ci = f * (N - 1);
  const ca = Math.floor(ci);
  const cb = Math.min(N - 1, ca + 1);
  const cv = nilai(ca, 1) + (nilai(cb, 1) - nilai(ca, 1)) * (ci - ca);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0 + (x1 - x0) * f, yT); g.lineTo(x0 + (x1 - x0) * f, yB); g.stroke();
  g.fillStyle = '#FFFFFF';
  g.beginPath(); g.arc(x0 + (x1 - x0) * f, py(cv), 7, 0, Math.PI * 2); g.fill();
  // panel kanan
  const kx = W - 270;
  const kartu: [string, string, string][] = [['OPTIMIS', '+24%', warna[0]], ['DASAR', '+13%', warna[1]], ['PESIMIS', '-4%', warna[2]]];
  kartu.forEach(([n, v, c], i) => {
    const y = 96 + i * 108;
    g.fillStyle = 'rgba(167,139,250,0.14)';
    g.fillRect(kx, y, 246, 92);
    g.fillStyle = c;
    g.fillRect(kx, y, 6, 92);
    g.font = `700 17px ${FONT}`;
    g.fillStyle = '#C4B5FD';
    g.fillText(`SKENARIO ${n}`, kx + 20, y + 24);
    g.font = `800 40px ${FONT}`;
    g.fillStyle = c;
    g.fillText(v, kx + 20, y + 64);
    g.font = `600 14px ${FONT}`;
    g.fillStyle = '#9CA3C9';
    g.fillText('laba bersih vs 2026', kx + 100, y + 66);
  });
};

// 3 layar dasbor kecil (dinding utara): Budget, Pajak, Tren Analitik.
const gambarBudget: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  kepalaLayar(g, W, 'BUDGET vs REALISASI', '#6EE7B7', '●');
  const baris: [string, number, string][] = [['Penjualan', 0.86, '#6EE7B7'], ['Beban Ops', 0.64, '#67E8F9'], ['Gaji', 0.78, '#A78BFA'], ['Marketing', 0.46, '#F0ABFC'], ['Capex', 0.3, '#FDE68A']];
  baris.forEach(([n, v, c], i) => {
    const y = 72 + i * 40;
    g.font = `600 ${Math.round(W * 0.036)}px ${FONT}`;
    g.fillStyle = '#C4B5FD';
    g.fillText(n, 16, y + 8);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(120, y, W - 150, 16);
    g.fillStyle = c;
    g.fillRect(120, y, (W - 150) * Math.min(1, v * (0.94 + 0.06 * Math.sin(t * 1.2 + i))), 16);
  });
};
const gambarPajak: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  kepalaLayar(g, W, 'KEPATUHAN PAJAK', '#6EE7B7', '●');
  const cx = 96, cy = 176, r = 56;
  g.lineWidth = 16;
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  const prog = 0.92 * (0.9 + 0.1 * Math.sin(t * 0.8));
  g.strokeStyle = '#8B5CF6';
  g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); g.stroke();
  g.fillStyle = '#EDE9FE';
  g.textAlign = 'center';
  g.font = `800 34px ${FONT}`;
  g.fillText(`${Math.round(prog * 100)}%`, cx, cy + 2);
  g.textAlign = 'left';
  ['SPT Tahunan', 'PPN Masa', 'PPh 21', 'PPh Badan'].forEach((n, i) => {
    const y = 92 + i * 42;
    g.fillStyle = i === 3 ? '#FDE68A' : '#6EE7B7';
    g.font = `800 22px ${FONT}`;
    g.fillText(i === 3 ? '◔' : '✓', 192, y + 56);
    g.fillStyle = '#C4B5FD';
    g.font = `600 18px ${FONT}`;
    g.fillText(n, 222, y + 56);
  });
};
const gambarTren: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  kepalaLayar(g, W, 'TREN ANALITIK', '#6EE7B7', '●');
  const n = 28;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = 16 + ((W - 32) * i) / (n - 1);
    const v = 0.45 + 0.22 * Math.sin(i * 0.5 + t * 0.9) + 0.1 * Math.sin(i * 1.3 - t * 0.5) + i * 0.006;
    pts.push([x, H - 28 - (H - 110) * v]);
  }
  const gr = g.createLinearGradient(0, 70, 0, H);
  gr.addColorStop(0, 'rgba(103,232,249,0.35)');
  gr.addColorStop(1, 'rgba(103,232,249,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(pts[0][0], H - 28);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(pts[n - 1][0], H - 28);
  g.fill();
  g.strokeStyle = '#67E8F9';
  g.lineWidth = 3;
  g.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  g.stroke();
  g.fillStyle = '#FDE68A';
  g.beginPath(); g.arc(pts[n - 1][0], pts[n - 1][1], 6, 0, Math.PI * 2); g.fill();
};

// ---- helper tampilan ----

// Rim monitor: tepi layar menyala terang saat AI duduk, redup saat kursi kosong.
function NyalaRim({ seatKey, w, h, color }: { seatKey: string; w: number; h: number; color: string }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const lv = useRef(0);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const on = (SEAT[seatKey] ?? 0) > 0.5 ? 1 : 0;
    lv.current += (on - lv.current) * Math.min(1, dt * (on ? 7 : 10));
    mats.current.forEach((m) => { if (m) m.opacity = 0.14 + 0.86 * lv.current; });
  });
  const garis: { p: V3; s: V3 }[] = [
    { p: [0, h / 2, 0], s: [w, 0.014, 0.012] },
    { p: [0, -h / 2, 0], s: [w, 0.014, 0.012] },
    { p: [-w / 2, 0, 0], s: [0.014, h, 0.012] },
    { p: [w / 2, 0, 0], s: [0.014, h, 0.012] },
  ];
  return (
    <>
      {garis.map((o, i) => (
        <mesh key={i} position={o.p}>
          <boxGeometry args={o.s} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} color={color} transparent opacity={0.14} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// Monitor tipis futuristik: bezel navy, rim neon, layar menyala (teks bergulir) saat AI duduk.
function MonitorTech({ sd, seatKey, seed, warna }: { sd: -1 | 1; seatKey: string; seed: number; warna: string }) {
  return (
    <group position={[sd * 0.5, 0, -0.17]} rotation={[0, sd * -0.22, 0]}>
      <Tube pos={[0, 0.832, 0]} r={0.13} h={0.016} color={HUB.navy} seg={24} cast={false} />
      <Cahaya pos={[0, 0.842, 0.0]} size={[0.2, 0.004, 0.004]} color={HUB.violet} opacity={0.8} />
      <Box pos={[0, 0.93, -0.03]} size={[0.05, 0.2, 0.04]} color={HUB.navy2} cast={false} />
      <Box pos={[0, 1.2, 0]} size={[0.8, 0.48, 0.035]} color={HUB.navy} />
      <mesh position={[0, 1.2, 0.019]}>
        <boxGeometry args={[0.76, 0.44, 0.006]} />
        <meshStandardMaterial color="#080720" roughness={0.2} />
      </mesh>
      <group position={[0, 1.2, 0.024]}>
        <NyalaRim seatKey={seatKey} w={0.8} h={0.48} color={warna} />
      </group>
      <Screen
        seatKey={seatKey}
        size={[0.76, 0.44]}
        pos={[0, 1.2, 0.0255]}
        seed={seed}
        words={PL_KATA}
        tema={PL_TEMA}
        ledPos={[0.34, 0.968, 0.02]}
        glow={{ floorPos: [0, 0.832, 0.26], floorSize: [1.1, 0.8], haloPos: [0, 1.2, 0.14], haloSize: [1.0, 0.75] }}
      />
    </group>
  );
}

// Barang khas tiap meja (hologram kecil di sisi kanan meja; permukaan meja y = 0.8265).
function KitPlanning({ k }: { k: 'budget' | 'tax' | 'analytics' | 'skenario' }) {
  const Y = 0.8265;
  if (k === 'budget') {
    return (
      <group position={[0.95, Y, 0.12]}>
        {[0, 0.16, 0.32].map((z, i) => (
          <group key={z} position={[0, 0, z - 0.1]}>
            <Tube pos={[0, 0.006, 0]} r={0.06} h={0.012} color={HUB.navy} seg={16} cast={false} />
            {Array.from({ length: 2 + i * 2 }, (_, j) => (
              <TabungCahaya key={j} pos={[0, 0.02 + j * 0.022, 0]} r={0.045} h={0.016} color={j % 2 ? HUB.amber : '#FDE68A'} seg={14} />
            ))}
          </group>
        ))}
      </group>
    );
  }
  if (k === 'tax') {
    const warna = [HUB.violet, '#F87171', HUB.mint, HUB.amber];
    return (
      <group position={[0.95, Y, 0.1]}>
        <Box pos={[0, 0.003, 0]} size={[0.34, 0.006, 0.26]} color={HUB.navy} cast={false} />
        {warna.map((c, i) => (
          <Box key={c} pos={[0, 0.02 + i * 0.03, 0]} size={[0.3, 0.026, 0.22]} color={c} rot={[0, (i - 1.5) * 0.08, 0]} cast={false} />
        ))}
        <TabungCahaya pos={[0, 0.2, 0]} r={0.07} rb={0.02} h={0.16} color={HUB.violet} opacity={0.16} seg={12} />
        <Putar pos={[0, 0.25, 0]} speed={1.4}>
          <mesh>
            <octahedronGeometry args={[0.05, 0]} />
            <meshBasicMaterial color={HUB.violet} wireframe toneMapped={false} />
          </mesh>
        </Putar>
      </group>
    );
  }
  if (k === 'analytics') {
    const tinggi = [0.06, 0.1, 0.15, 0.2];
    return (
      <group position={[0.95, Y, 0.18]}>
        <Tube pos={[0, 0.006, 0]} r={0.13} h={0.012} color={HUB.navy} seg={20} cast={false} />
        {tinggi.map((h, i) => (
          <Cahaya key={i} pos={[-0.075 + i * 0.05, 0.012 + h / 2, 0]} size={[0.034, h, 0.034]} color={i % 2 ? HUB.violet : HUB.cyan} />
        ))}
      </group>
    );
  }
  return <MiniHolo pos={[0.95, Y, 0.2]} />;
}

// Meja kerja Planning bergaya meja riset Research: daun lilac, inlay navy, LED tepi, panel samping navy, 2 monitor.
function MejaPlanning({ pos, k, label, warna, seatKey, seed }: { pos: V3; k: 'budget' | 'tax' | 'analytics' | 'skenario'; label?: string; warna: string; seatKey: string; seed: number }) {
  return (
    <group position={pos}>
      {/* sinar lantai + inlay navy di bawah meja */}
      <Kolam pos={[0, 0.02, 0.35]} size={[3.4, 2.7]} color={warna} opacity={0.2} />
      <Box pos={[0, 0.006, 0.2]} size={[2.8, 0.012, 2.1]} color="#2C2766" cast={false} />
      {[-1.4, 1.4].map((x) => (
        <Cahaya key={x} pos={[x, 0.014, 0.2]} size={[0.02, 0.006, 2.1]} color={HUB.violet} opacity={0.8} />
      ))}
      <Cahaya pos={[0, 0.014, 1.25]} size={[2.8, 0.006, 0.02]} color={HUB.cyan} opacity={0.8} />
      <Cahaya pos={[0, 0.014, -0.85]} size={[2.8, 0.006, 0.02]} color={HUB.cyan} opacity={0.5} />
      {/* daun meja + inlay + LED tepi */}
      <Box pos={[0, 0.79, 0]} size={[2.2, 0.07, 0.9]} color="#ECE9FA" />
      <Box pos={[0, 0.8265, 0]} size={[2.1, 0.004, 0.8]} color={HUB.navy} cast={false} />
      <Cahaya pos={[0, 0.77, 0.455]} size={[2.2, 0.02, 0.012]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.77, -0.455]} size={[2.2, 0.02, 0.012]} color={HUB.cyan} opacity={0.6} />
      {[-1.1, 1.1].map((x) => (
        <Cahaya key={x} pos={[x, 0.77, 0]} size={[0.012, 0.02, 0.9]} color={HUB.violet} />
      ))}
      {/* panel samping, panel belakang, rak bawah, lampu bawah meja */}
      {[-0.95, 0.95].map((x) => (
        <Box key={x} pos={[x, 0.37, 0]} size={[0.1, 0.72, 0.78]} color={HUB.navy2} />
      ))}
      <Box pos={[0, 0.45, -0.38]} size={[1.8, 0.5, 0.03]} color={HUB.navy} />
      <Box pos={[0, 0.2, 0]} size={[1.8, 0.06, 0.5]} color={HUB.navy} cast={false} />
      <Cahaya pos={[0, 0.05, 0]} size={[1.9, 0.01, 0.4]} color={HUB.violet} opacity={0.5} />
      <Cahaya pos={[-0.95, 0.72, 0.4]} size={[0.1, 0.012, 0.012]} color={warna} />
      <Cahaya pos={[0.95, 0.72, 0.4]} size={[0.1, 0.012, 0.012]} color={warna} />
      {/* 2 monitor (menyala saat AI duduk) */}
      <MonitorTech sd={-1} seatKey={seatKey} seed={seed} warna={warna} />
      <MonitorTech sd={1} seatKey={seatKey} seed={seed + 5} warna={warna} />
      {/* keyboard hologram + pad + mouse */}
      <Box pos={[0.08, 0.8285, 0.22]} size={[0.62, 0.004, 0.3]} color="#0F0D2B" cast={false} />
      <Cahaya pos={[0.08, 0.832, 0.22]} size={[0.58, 0.002, 0.26]} color="#7DD3FC" opacity={0.25} />
      {[0, 1, 2, 3].map((r) => (
        <Cahaya key={r} pos={[0.08, 0.8335, 0.13 + r * 0.06]} size={[0.5, 0.002, 0.03]} color={HUB.cyan} opacity={0.55} />
      ))}
      <Box pos={[0.55, 0.832, 0.22]} size={[0.06, 0.02, 0.1]} color={HUB.navy2} cast={false} />
      <Cahaya pos={[0.55, 0.8425, 0.2]} size={[0.01, 0.003, 0.03]} color={HUB.cyan} />
      {label && (
        <group position={[-0.28, 0, 0.0]}>
          <DeskPlate label={label} color={warna} />
        </group>
      )}
      <KitPlanning k={k} />
    </group>
  );
}

// Globe proyeksi utama: dais, pedestal, berkas cahaya, globe kawat, cincin orbit, pemindai naik-turun, 4 label orbit.
function GlobeProyeksi({ pos }: { pos: V3 }) {
  const scan = useRef<THREE.Mesh>(null);
  const scanMat = useRef<THREE.MeshBasicMaterial>(null);
  const inti = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = (t * 0.35) % 1;
    if (scan.current) {
      scan.current.position.y = 0.75 + f * 1.7;
      const s = 0.62 * Math.sqrt(Math.max(0.02, 1 - Math.pow((f - 0.5) * 2, 2)));
      scan.current.scale.set(s / 0.62 + 0.05, s / 0.62 + 0.05, 1);
    }
    if (scanMat.current) scanMat.current.opacity = 0.9 * Math.sin(f * Math.PI);
    if (inti.current) inti.current.emissiveIntensity = 0.7 + Math.sin(t * 1.8) * 0.3;
  });
  const y = 1.6;
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[4.2, 4.2]} color={HUB.violet} opacity={0.28} />
      <Tube pos={[0, 0.05, 0]} r={1.0} rb={1.1} h={0.1} color={HUB.navy} seg={40} />
      <CincinLantai pos={[0, 0.103, 0]} r={0.96} lebar={0.03} color={HUB.cyan} />
      <CincinLantai pos={[0, 0.104, 0]} r={0.7} lebar={0.02} color={HUB.violet} opacity={0.9} />
      <Tube pos={[0, 0.3, 0]} r={0.3} rb={0.5} h={0.4} color={HUB.navy2} seg={28} />
      <Tube pos={[0, 0.51, 0]} r={0.34} h={0.03} color={HUB.putih} seg={28} cast={false} />
      <TabungCahaya pos={[0, 0.53, 0]} r={0.3} h={0.01} color={HUB.cyan} seg={28} />
      <TabungCahaya pos={[0, 1.3, 0]} r={0.2} rb={0.5} h={1.5} color={HUB.violet} opacity={0.07} seg={24} />
      {/* globe */}
      <Putar pos={[0, y, 0]} speed={0.5}>
        <mesh>
          <icosahedronGeometry args={[0.62, 2]} />
          <meshBasicMaterial color={HUB.cyan} wireframe transparent opacity={0.8} toneMapped={false} />
        </mesh>
      </Putar>
      <Putar pos={[0, y, 0]} speed={-0.8}>
        <mesh>
          <icosahedronGeometry args={[0.36, 1]} />
          <meshStandardMaterial ref={inti} color={HUB.violet} emissive={HUB.violet} emissiveIntensity={0.8} transparent opacity={0.6} />
        </mesh>
      </Putar>
      <Putar pos={[0, y, 0]} speed={1.0}>
        <mesh rotation={[Math.PI / 2.6, 0, 0]}>
          <torusGeometry args={[0.95, 0.012, 6, 64]} />
          <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
        </mesh>
        <Ball pos={[0.95, 0, 0]} r={0.05} color={HUB.amber} emissive={1.4} />
      </Putar>
      <Putar pos={[0, y, 0]} speed={-0.6}>
        <mesh rotation={[-Math.PI / 3.2, 0.5, 0]}>
          <torusGeometry args={[1.2, 0.01, 6, 72]} />
          <meshBasicMaterial color={HUB.pink} transparent opacity={0.8} toneMapped={false} />
        </mesh>
      </Putar>
      {/* pemindai naik-turun */}
      <mesh ref={scan} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1, 0]}>
        <ringGeometry args={[0.58, 0.62, 48]} />
        <meshBasicMaterial ref={scanMat} color={HUB.mint} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <ChipOrbit pusat={[0, 0, 0]} teks="PROYEKSI KAS" warna={HUB.cyan} radius={1.55} y={2.55} fase={0} />
      <ChipOrbit pusat={[0, 0, 0]} teks="TARGET LABA" warna={HUB.mint} radius={1.55} y={2.3} fase={Math.PI / 2} />
      <ChipOrbit pusat={[0, 0, 0]} teks="RISIKO" warna={HUB.pink} radius={1.55} y={2.55} fase={Math.PI} w={1.0} />
      <ChipOrbit pusat={[0, 0, 0]} teks="PAJAK 2027" warna={HUB.amber} radius={1.55} y={2.3} fase={(3 * Math.PI) / 2} />
    </group>
  );
}

// Lantai teknologi ruang Planning: ubin lilac, garis sambungan, LED tepi, karpet cincin, jejak sirkuit ke tiap meja.
// [BARU] Lantai Planning futuristik modern: ubin grafit-indigo gelap berbevel dengan celah cahaya, ubin aksen heksagon/lingkaran,
// garis cahaya tiap 2 & 4 ubin, titik simpul di sudut ubin. Dua lapis: tekstur terpengaruh lampu (ubin) + tekstur bercahaya (garis, tanpa lampu).
function LantaiFuturistik({ cx, cz = 0, w, d }: { cx: number; cz?: number; w: number; d: number }) {
  const ubin = useKanvasMg(1024, 1024, (g) => {
    g.fillStyle = '#12102F';
    g.fillRect(0, 0, 1024, 1024);
    const shade = ['#262160', '#292466', '#2C276B', '#242058'];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 256, y = j * 256;
        g.fillStyle = shade[(i * 3 + j * 5) % 4];
        g.fillRect(x + 4, y + 4, 248, 248);
        g.fillStyle = 'rgba(167,139,250,0.20)';
        g.fillRect(x + 4, y + 4, 248, 3);
        g.fillRect(x + 4, y + 4, 3, 248);
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.fillRect(x + 4, y + 249, 248, 3);
        g.fillRect(x + 249, y + 4, 3, 248);
        g.strokeStyle = 'rgba(103,232,249,0.10)';
        g.lineWidth = 2;
        g.strokeRect(x + 24, y + 24, 208, 208);
      }
    }
    // ubin aksen
    const heks = (cx0: number, cy0: number, r: number, warna: string) => {
      g.strokeStyle = warna;
      g.lineWidth = 3;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx0 + r * Math.cos(a), py = cy0 + r * Math.sin(a);
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
    };
    heks(256 + 128, 256 + 128, 74, 'rgba(167,139,250,0.55)');
    heks(256 + 128, 256 + 128, 44, 'rgba(103,232,249,0.40)');
    g.fillStyle = 'rgba(103,232,249,0.7)';
    g.beginPath(); g.arc(256 + 128, 256 + 128, 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(103,232,249,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.arc(768 + 128, 512 + 128, 70, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(167,139,250,0.45)';
    g.beginPath(); g.arc(768 + 128, 512 + 128, 38, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(240,171,252,0.45)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(40, 768 + 60); g.lineTo(120, 768 + 60); g.lineTo(150, 768 + 130); g.lineTo(220, 768 + 130); g.stroke();
    g.fillStyle = 'rgba(240,171,252,0.8)';
    g.beginPath(); g.arc(220, 768 + 130, 6, 0, Math.PI * 2); g.fill();
  }, 'plan-lantai-fut-ubin');
  const cahaya = useKanvasMg(1024, 1024, (g) => {
    g.clearRect(0, 0, 1024, 1024);
    const garis = (p: number, tebal: number, warna: string) => {
      g.fillStyle = warna;
      for (const o of [0, 1024]) {
        g.fillRect(p - tebal / 2 + o, 0, tebal, 1024);
        g.fillRect(0, p - tebal / 2 + o, 1024, tebal);
      }
    };
    garis(512, 3, 'rgba(167,139,250,0.40)');
    garis(0, 5, 'rgba(103,232,249,0.50)');
    g.fillStyle = 'rgba(103,232,249,0.85)';
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        g.beginPath(); g.arc(i * 256, j * 256, 5, 0, Math.PI * 2); g.fill();
      }
    }
  }, 'plan-lantai-fut-cahaya');
  const ulang = (t: THREE.Texture) => {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(w / 4, d / 4);
    c.needsUpdate = true;
    return c;
  };
  const t1 = useMemo(() => ulang(ubin), [ubin, w, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const t2 = useMemo(() => ulang(cahaya), [cahaya, w, d]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <mesh position={[cx, 0.0015, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshLambertMaterial map={t1} />
      </mesh>
      <mesh position={[cx, 0.0024, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={t2} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

function LantaiPlanning() {
  const G: V3 = [-2.0 + PL_DX / 2, 0, 0.0]; // globe di tengah (ruangan kini x -13.8..13.2, z -5.5..5.5)
  const J_pixel: [number, number][] = useMemo(() => [[-8.0, -3.0], [-6.5, -3.0], [-6.5, -0.9], [-3.6 + PL_DX / 2, -0.9]], []);
  const J_sigma: [number, number][] = useMemo(() => [[-8.0, 0.9], [-6.2, 0.9], [-6.2, 1.4], [-3.7 + PL_DX / 2, 1.4]], []);
  const J_radian: [number, number][] = useMemo(() => [[4.0 + PL_DX, -3.0], [2.6 + PL_DX, -3.0], [2.6 + PL_DX, -0.9], [-0.2 + PL_DX / 2, -0.9]], []);
  const J_quark: [number, number][] = useMemo(() => [[4.0 + PL_DX, 0.9], [2.9 + PL_DX, 0.9], [2.9 + PL_DX, 1.4], [-0.3 + PL_DX / 2, 1.4]], []);
  return (
    <>
      <Lantai cx={-2 - GESER_BARAT / 2 + PL_DX / 2} w={20 + GESER_BARAT + PL_DX} d={11} color="#12102F" />
      <LantaiFuturistik cx={-2 - GESER_BARAT / 2 + PL_DX / 2} w={20 + GESER_BARAT + PL_DX} d={11} />
      {/* LED tepi (celah pintu utara x 0 dan timur z 3.6 dibiarkan kosong) */}
      <Cahaya pos={[-6.5 - GESER_BARAT / 2, 0.03, -5.47]} size={[11 + GESER_BARAT, 0.025, 0.025]} color={HUB.violet} />
      <Cahaya pos={[4.5 + PL_DX / 2, 0.03, -5.47]} size={[6.6 + PL_DX, 0.025, 0.025]} color={HUB.violet} />
      <Cahaya pos={[-11.9 - GESER_BARAT, 0.03, 0]} size={[0.025, 0.025, 10.9]} color={HUB.violet} />
      <Cahaya pos={[7.96 + PL_DX, 0.03, -1.45]} size={[0.025, 0.025, 7.9]} color={HUB.cyan} />
      <Cahaya pos={[7.96 + PL_DX, 0.03, 5.05]} size={[0.025, 0.025, 0.7]} color={HUB.cyan} />
      <Cahaya pos={[-2 - GESER_BARAT / 2 + PL_DX / 2, 0.03, 5.47]} size={[19.8 + GESER_BARAT + PL_DX, 0.025, 0.025]} color={HUB.cyan} />
      {/* karpet cincin di bawah globe */}
      <Tube pos={[G[0], 0.006, G[2]]} r={3.3} h={0.012} color="#0D0B26" seg={72} cast={false} />
      <CincinLantai pos={[G[0], 0.015, G[2]]} r={3.25} lebar={0.05} color={HUB.violet} />
      <CincinLantai pos={[G[0], 0.015, G[2]]} r={2.6} lebar={0.025} color={HUB.cyan} opacity={0.8} />
      <CincinLantai pos={[G[0], 0.015, G[2]]} r={1.6} lebar={0.03} color={HUB.violet} opacity={0.9} />
      <CincinPutus pos={[G[0], 0.018, G[2]]} r={2.95} n={30} speed={0.2} color={HUB.cyan} panjang={0.34} />
      <CincinPutus pos={[G[0], 0.019, G[2]]} r={2.0} n={20} speed={-0.3} color={HUB.mint} panjang={0.22} lebar={0.04} />
      {[0, Math.PI / 2].map((a) => (
        <Box key={a} pos={[G[0], 0.02, G[2]]} size={[0.05, 0.006, 6.4]} color={HUB.violet} rot={[0, a, 0]} cast={false} />
      ))}
      <Cone pos={[G[0], 0.04, G[2] - 2.0]} r={0.2} h={0.4} color={EMAS} seg={4} rot={[-Math.PI / 2, 0, 0]} />
      {/* jejak sirkuit meja -> globe + aliran data */}
      {[J_pixel, J_sigma, J_radian, J_quark].map((p, i) => (
        <Jejak key={i} pts={p} color={i % 2 ? HUB.violet : HUB.cyan} />
      ))}
      <DenyutJejak pts={J_pixel} color="#FFFFFF" kecepatan={0.9} />
      <DenyutJejak pts={J_sigma} color={HUB.mint} kecepatan={0.8} n={1} />
      <DenyutJejak pts={J_radian} color={HUB.amber} kecepatan={1.0} />
      <DenyutJejak pts={J_quark} color={HUB.pink} kecepatan={0.85} n={1} />
      {/* lampu penuntun di lorong pintu utara */}
      <LampuJalur titik={[[-0.55, -5.2], [0.55, -5.2], [-0.55, -4.8], [0.55, -4.8], [-0.55, -4.4], [0.55, -4.4]]} />
      {/* tulisan inlay lantai */}
      <Teks pos={[-1.5 + PL_DX / 2, 0.014, 5.05]} rot={[-Math.PI / 2, 0, 0]} w={4.4} h={0.26} text="PUSAT PROYEKSI  •  PLANNING HUB" fg="#A78BFA" />
    </>
  );
}

// Papan roadmap dinding barat: bingkai navy + rim neon, batang naik berdenyut, garis tren, titik yang menyusuri tren. rotY = PI/2.
function PapanRoadmap({ pos }: { pos: V3 }) {
  const xs = [-1.2, -0.6, 0, 0.6, 1.2];
  const hs = [0.2, 0.35, 0.5, 0.68, 0.88];
  const warna = ['#6D5BD0', '#7C6BD6', '#8B7CE0', '#A78BFA', '#C4B5FD'];
  const titik: [number, number][] = xs.map((x, i) => [x, -0.55 + hs[i] + 0.12]);
  const bar = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const dot = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    bar.current.forEach((m, i) => { if (m) m.opacity = 0.72 + 0.28 * Math.sin(t * 1.5 - i * 0.7); });
    if (dot.current) {
      const f = ((t * 0.25) % 1) * (titik.length - 1);
      const a = Math.min(titik.length - 2, Math.floor(f));
      const u = f - a;
      dot.current.position.set(titik[a][0] + (titik[a + 1][0] - titik[a][0]) * u, titik[a][1] + (titik[a + 1][1] - titik[a][1]) * u, 0.09);
    }
  });
  return (
    <group position={pos} rotation={[0, Math.PI / 2, 0]}>
      <Box pos={[0, 0, -0.03]} size={[3.5, 1.68, 0.04]} color={HUB.navy2} cast={false} />
      <Box pos={[0, 0, 0]} size={[3.4, 1.58, 0.06]} color="#14123A" cast={false} />
      <Cahaya pos={[0, 0.8, 0.035]} size={[3.4, 0.02, 0.02]} color={HUB.cyan} />
      <Cahaya pos={[0, -0.8, 0.035]} size={[3.4, 0.02, 0.02]} color={HUB.violet} />
      <Cahaya pos={[-1.7, 0, 0.035]} size={[0.02, 1.6, 0.02]} color={HUB.violet} opacity={0.7} />
      <Cahaya pos={[1.7, 0, 0.035]} size={[0.02, 1.6, 0.02]} color={HUB.violet} opacity={0.7} />
      {[-0.2, 0.15, 0.5].map((y) => (
        <Cahaya key={y} pos={[0, y, 0.032]} size={[3.2, 0.006, 0.004]} color="#EDE9FE" opacity={0.12} />
      ))}
      <Teks pos={[-1.15, 0.62, 0.036]} w={1.3} h={0.24} text="ROADMAP 2027" fg="#C4B5FD" />
      {xs.map((x, i) => (
        <React.Fragment key={x}>
          <mesh position={[x, -0.55 + hs[i] / 2, 0.04]}>
            <boxGeometry args={[0.26, hs[i], 0.03]} />
            <meshBasicMaterial ref={(m) => { bar.current[i] = m; }} color={warna[i]} transparent opacity={0.85} toneMapped={false} />
          </mesh>
          <Teks pos={[x, -0.68, 0.036]} w={0.3} h={0.14} text={`Q${i + 1}`} fg="#C4B5FD" />
        </React.Fragment>
      ))}
      {titik.slice(0, -1).map(([x1, y1], i) => {
        const [x2, y2] = titik[i + 1];
        const L = Math.hypot(x2 - x1, y2 - y1);
        return <Cahaya key={i} pos={[(x1 + x2) / 2, (y1 + y2) / 2, 0.07]} size={[L, 0.025, 0.02]} color="#FDE68A" />;
      })}
      {titik.map(([x, y], i) => (
        <Ball key={i} pos={[x, y, 0.08]} r={0.05} color="#FDE68A" emissive={1} />
      ))}
      <group ref={dot}>
        <Ball pos={[0, 0, 0]} r={0.075} color="#FFFFFF" emissive={1.6} />
      </group>
    </group>
  );
}

// Bola kristal "Forecast": alas navy bercincin, bola kaca berdenyut, bintang & cincin mengorbit, kolam cahaya.
function BolaKristal({ pos }: { pos: V3 }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = 0.5 + Math.sin(clock.elapsedTime * 1.6) * 0.25;
  });
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.0, 2.0]} color={HUB.violet} opacity={0.25} />
      <Tube pos={[0, 0.04, 0]} r={0.46} h={0.08} color={HUB.navy} seg={28} />
      <CincinLantai pos={[0, 0.083, 0]} r={0.44} lebar={0.025} color={HUB.cyan} />
      <Tube pos={[0, 0.3, 0]} r={0.16} rb={0.28} h={0.4} color={HUB.navy2} seg={20} />
      <Tube pos={[0, 0.52, 0]} r={0.27} h={0.04} color={EMAS} seg={20} cast={false} />
      <mesh position={[0, 0.88, 0]} castShadow>
        <sphereGeometry args={[0.34, 24, 18]} />
        <meshStandardMaterial ref={mat} color="#C4B5FD" emissive="#8B5CF6" emissiveIntensity={0.6} transparent opacity={0.6} roughness={0.15} />
      </mesh>
      <Putar pos={[0, 0.88, 0]} speed={1.2}>
        <Ball pos={[0.12, 0, 0]} r={0.07} color="#FDE68A" emissive={1} />
        <Ball pos={[-0.1, 0.08, 0.06]} r={0.05} color="#F9A8D4" emissive={1} />
      </Putar>
      <Putar pos={[0, 0.88, 0]} speed={-0.9}>
        <mesh rotation={[Math.PI / 2.3, 0, 0]}>
          <torusGeometry args={[0.5, 0.008, 6, 48]} />
          <meshBasicMaterial color={HUB.cyan} toneMapped={false} />
        </mesh>
      </Putar>
      <LabelHolo pos={[0.72, 1.1, 0]} teks="FORECAST" warna="#DDD6FE" w={0.8} />
    </group>
  );
}

// Monumen perisai kepatuhan pajak: alas navy bercincin + perisai hologram berputar pelan dengan centang.
function TamengPatuh({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.2, 2.2]} color={HUB.violet} opacity={0.25} />
      <Box pos={[0, 0.18, 0]} size={[1.1, 0.36, 0.5]} color={HUB.navy2} />
      <Box pos={[0, 0.37, 0]} size={[1.18, 0.03, 0.56]} color={EMAS} cast={false} />
      <Cahaya pos={[0, 0.2, 0.255]} size={[0.9, 0.02, 0.01]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.1, 0.255]} size={[0.9, 0.012, 0.01]} color={HUB.violet} opacity={0.7} />
      <TabungCahaya pos={[0, 0.85, 0]} r={0.35} rb={0.45} h={0.9} color={HUB.violet} opacity={0.07} seg={20} />
      <Putar pos={[0, 1.15, 0]} speed={0.45}>
        <group scale={0.85}>
          <Box pos={[0, 0.18, 0]} size={[1.0, 0.7, 0.12]} color="#6D5BD0" />
          <Cahaya pos={[0, 0.18, 0.065]} size={[0.9, 0.6, 0.004]} color={HUB.violet} opacity={0.35} />
          <group position={[0, -0.52, 0]} scale={[1, 1, 0.24]}>
            <Cone pos={[0, 0, 0]} r={0.5} h={0.7} color="#6D5BD0" seg={4} rot={[Math.PI, 0, 0]} />
          </group>
          <Box pos={[0.14, 0.12, 0.08]} size={[0.12, 0.62, 0.03]} color="#FFFFFF" rot={[0, 0, -0.75]} cast={false} />
          <Box pos={[-0.2, 0.0, 0.08]} size={[0.12, 0.34, 0.03]} color="#FFFFFF" rot={[0, 0, 0.8]} cast={false} />
        </group>
      </Putar>
      <LabelHolo pos={[0, 2.15, 0]} teks="TAX SHIELD" warna={HUB.violet} w={0.95} />
    </group>
  );
}

// Dinding 3 layar dasbor (utara): Budget, Kepatuhan Pajak, Tren Analitik — canvas hidup.
function DindingLayar({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.03, -0.06]} size={[3.5, 0.06, 0.5]} color={HUB.navy} cast={false} />
      <Cahaya pos={[0, 0.065, 0.19]} size={[3.4, 0.012, 0.012]} color={HUB.cyan} />
      {[-1.65, 1.65].map((x) => (
        <Box key={x} pos={[x, 0.9, -0.06]} size={[0.06, 1.7, 0.08]} color={HUB.navy2} />
      ))}
      <LayarCanvas pos={[-1.1, 1.3, 0]} w={1.0} h={0.72} px={384} draw={gambarBudget} fps={4} rim={HUB.mint} />
      <LayarCanvas pos={[0, 1.3, 0]} w={1.0} h={0.72} px={384} draw={gambarPajak} fps={5} rim={HUB.violet} />
      <LayarCanvas pos={[1.1, 1.3, 0]} w={1.0} h={0.72} px={384} draw={gambarTren} fps={6} rim={HUB.cyan} />
      <Kolam pos={[0, 0.02, 0.9]} size={[4.0, 1.8]} color={HUB.cyan} opacity={0.15} />
    </group>
  );
}

// Grafik batang hologram di atas alas: batang naik-turun terus + rangka sumbu + label.
function BatangHolo({ pos }: { pos: V3 }) {
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    bars.current.forEach((m, i) => {
      if (!m) return;
      const h = 0.25 + (Math.sin(t * 1.1 + i * 1.3) * 0.5 + 0.5) * 0.55;
      m.scale.y = h;
      m.position.y = 0.56 + h / 2;
    });
  });
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.2, 2.2]} color={HUB.cyan} opacity={0.22} />
      <Tube pos={[0, 0.25, 0]} r={0.45} rb={0.52} h={0.5} color={HUB.navy2} seg={24} />
      <Tube pos={[0, 0.512, 0]} r={0.42} h={0.012} color={HUB.cyan} seg={24} cast={false} />
      <CincinLantai pos={[0, 0.07, 0]} r={0.5} lebar={0.02} color={HUB.violet} />
      <Cahaya pos={[-0.36, 1.0, -0.1]} size={[0.012, 0.9, 0.012]} color={HUB.cyan} opacity={0.6} />
      <Cahaya pos={[0, 0.58, -0.1]} size={[0.74, 0.012, 0.012]} color={HUB.cyan} opacity={0.6} />
      {[-0.28, -0.14, 0, 0.14, 0.28].map((x, i) => (
        <mesh key={x} position={[x, 0.8, 0]} ref={(m) => { bars.current[i] = m; }}>
          <boxGeometry args={[0.1, 1, 0.1]} />
          <meshBasicMaterial color={i % 2 ? '#C4B5FD' : '#60A5FA'} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      ))}
      <LabelHolo pos={[0, 1.7, 0]} teks="ANALYTICS" warna={HUB.cyan} w={0.9} />
    </group>
  );
}

// Teleskop di tripod + cincin cahaya di lantai (suasana "mengintip masa depan").
function Teleskop({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0]} size={[1.6, 1.6]} color={HUB.cyan} opacity={0.18} />
      <CincinLantai pos={[0, 0.012, 0]} r={0.5} lebar={0.02} color={HUB.violet} />
      {[0, 1, 2].map((i) => (
        <group key={i} rotation={[0, (i * 2 * Math.PI) / 3, 0]}>
          <Box pos={[0, 0.5, 0.11]} size={[0.04, 1.1, 0.04]} color={HUB.navy2} rot={[-0.2, 0, 0]} cast={false} />
        </group>
      ))}
      <Tube pos={[0, 1.02, 0]} r={0.07} h={0.08} color={HUB.navy} seg={10} cast={false} />
      <group position={[0, 1.1, 0]} rotation={[0, 0, 0.95]}>
        <Tube pos={[0, 0.3, 0]} r={0.075} rb={0.1} h={0.95} color="#E8EEF5" seg={16} />
        <Tube pos={[0, 0.78, 0]} r={0.105} h={0.05} color={EMAS} seg={16} cast={false} />
        <Tube pos={[0, 0.5, 0]} r={0.082} h={0.02} color={HUB.cyan} seg={16} cast={false} />
        <Tube pos={[0, -0.22, 0]} r={0.04} h={0.2} color={HUB.navy} seg={10} cast={false} />
      </group>
    </group>
  );
}

// Podium 3 skenario: tiga kartu hologram melayang (optimis / dasar / pesimis).
function PodiumSkenario({ pos }: { pos: V3 }) {
  const kartu: { x: number; teks: string; c: string; y: number }[] = [
    { x: -0.72, teks: 'OPTIMIS', c: HUB.mint, y: 1.28 },
    { x: 0, teks: 'DASAR', c: HUB.cyan, y: 1.46 },
    { x: 0.72, teks: 'PESIMIS', c: HUB.pink, y: 1.28 },
  ];
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0.1]} size={[3.0, 2.0]} color={HUB.violet} opacity={0.22} />
      <Box pos={[0, 0.06, 0]} size={[2.3, 0.12, 0.7]} color={HUB.navy} />
      <Box pos={[0, 0.3, 0]} size={[1.9, 0.36, 0.5]} color={HUB.navy2} />
      <Box pos={[0, 0.5, 0]} size={[2.0, 0.04, 0.56]} color={HUB.putih} cast={false} />
      <Cahaya pos={[0, 0.3, 0.255]} size={[1.7, 0.02, 0.01]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.17, 0.255]} size={[1.7, 0.012, 0.01]} color={HUB.violet} opacity={0.7} />
      {kartu.map((o) => (
        <group key={o.teks}>
          <TabungCahaya pos={[o.x, 0.9, 0]} r={0.07} rb={0.2} h={0.76} color={o.c} opacity={0.1} seg={12} />
          <LabelHolo pos={[o.x, o.y, 0]} teks={o.teks} warna={o.c} w={0.62} />
        </group>
      ))}
    </group>
  );
}

// Sofa modern (pengganti sofa lama): alas navy dengan LED bawah, bantalan bulat rendah, sandaran ramping, bantal aksen.
function SofaModern({ pos, rotY = 0, color = '#4F6FA8' }: { pos: V3; rotY?: number; color?: string }) {
  const gelap = lighten(color, -0.08);
  const terang = lighten(color, 0.06);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0]} size={[3.2, 1.9]} color={HUB.cyan} opacity={0.2} />
      <Box pos={[0, 0.09, 0]} size={[2.2, 0.12, 0.92]} color={HUB.navy} />
      <Cahaya pos={[0, 0.03, 0.2]} size={[2.0, 0.012, 0.5]} color={HUB.cyan} opacity={0.55} />
      <Cahaya pos={[0, 0.16, 0.465]} size={[2.1, 0.012, 0.01]} color={HUB.violet} />
      {/* dua bantalan dudukan */}
      {[-0.52, 0.52].map((x) => (
        <RBox key={x} pos={[x, 0.3, -0.04]} size={[1.0, 0.24, 0.78]} radius={0.08} color={terang} />
      ))}
      {/* sandaran ramping sedikit miring */}
      {[-0.52, 0.52].map((x) => (
        <RBox key={x} pos={[x, 0.64, 0.36]} size={[1.0, 0.46, 0.16]} radius={0.07} color={color} rot={[-0.1, 0, 0]} />
      ))}
      {/* lengan tipis kiri-kanan */}
      {[-1.07, 1.07].map((x) => (
        <RBox key={x} pos={[x, 0.42, 0.02]} size={[0.14, 0.34, 0.86]} radius={0.05} color={gelap} />
      ))}
      <Cahaya pos={[0, 0.89, 0.4]} size={[2.0, 0.012, 0.012]} color={HUB.cyan} />
      {/* bantal aksen */}
      <RBox pos={[-0.78, 0.55, 0.12]} size={[0.3, 0.28, 0.1]} radius={0.04} color="#FDE68A" rot={[-0.3, 0.3, 0.12]} cast={false} />
      <RBox pos={[0.78, 0.55, 0.12]} size={[0.3, 0.28, 0.1]} radius={0.04} color={HUB.violet} rot={[-0.3, -0.3, -0.12]} cast={false} />
      {/* kaki logam */}
      {[[-0.95, -0.38], [0.95, -0.38], [-0.95, 0.38], [0.95, 0.38]].map(([x, z], i) => (
        <Box key={i} pos={[x, 0.025, z]} size={[0.07, 0.05, 0.07]} color={HUB.navy2} cast={false} />
      ))}
    </group>
  );
}

// ---- [BARU] Detail tambahan ruang Planning (futuristik modern, gaya Research) ---------------------------------------------------------
// Layar kiosk simulasi: 3 slider asumsi (harga / biaya / volume) bergerak pelan + kurva hasil proyeksi laba.
const gambarSimulasi: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  kepalaLayar(g, W, 'SIMULASI SKENARIO', '#6EE7B7', '● SIM');
  const asumsi: { n: string; v: number; c: string }[] = [
    { n: 'Harga', v: 0.62, c: '#67E8F9' },
    { n: 'Biaya', v: 0.38, c: '#F0ABFC' },
    { n: 'Volume', v: 0.74, c: '#6EE7B7' },
  ];
  const x0 = W * 0.06, x1 = W * 0.5;
  asumsi.forEach((a, i) => {
    const y = H * (0.36 + i * 0.2);
    const v = Math.min(0.95, Math.max(0.05, a.v + 0.1 * Math.sin(t * 0.8 + i * 1.7)));
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#EDE9FE';
    g.font = `600 ${Math.round(W * 0.044)}px ${FONT}`;
    g.fillText(a.n, x0, y - H * 0.07);
    g.fillStyle = 'rgba(237,233,254,0.18)';
    g.fillRect(x0, y, x1 - x0, 5);
    g.fillStyle = a.c;
    g.fillRect(x0, y, (x1 - x0) * v, 5);
    g.beginPath();
    g.arc(x0 + (x1 - x0) * v, y + 2.5, 8, 0, Math.PI * 2);
    g.fill();
  });
  // kurva hasil
  const cx0 = W * 0.58, cx1 = W * 0.95, cyT = H * 0.3, cyB = H * 0.86;
  g.strokeStyle = 'rgba(237,233,254,0.2)';
  g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = cyT + ((cyB - cyT) * i) / 3;
    g.beginPath(); g.moveTo(cx0, y); g.lineTo(cx1, y); g.stroke();
  }
  const N = 24;
  const f = (i: number) => 0.25 + 0.5 * (i / N) + 0.06 * Math.sin(i * 0.8 + t * 1.2);
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = cx0 + ((cx1 - cx0) * i) / N, y = cyB - (cyB - cyT) * f(i);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.strokeStyle = '#6EE7B7';
  g.lineWidth = 3;
  g.stroke();
  g.lineTo(cx1, cyB);
  g.lineTo(cx0, cyB);
  g.closePath();
  g.fillStyle = 'rgba(110,231,183,0.12)';
  g.fill();
  g.fillStyle = '#FDE68A';
  g.textAlign = 'right';
  g.font = `800 ${Math.round(W * 0.05)}px ${FONT}`;
  g.fillText('Laba +' + (8 + 3 * Math.sin(t * 0.8)).toFixed(1) + '%', cx1, H * 0.2);
};

// Kiosk simulasi: tiang navy + layar miring bercanvas + alas bercincin mint (menghadap +z).
function KioskSimulasi({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0.5]} size={[1.8, 1.6]} color={HUB.cyan} opacity={0.2} />
      <Tube pos={[0, 0.04, 0]} r={0.34} h={0.08} color={HUB.navy} seg={24} />
      <CincinLantai pos={[0, 0.085, 0]} r={0.3} lebar={0.02} color={HUB.mint} />
      <Box pos={[0, 0.55, -0.04]} size={[0.12, 0.9, 0.1]} color={HUB.navy2} />
      <Cahaya pos={[0, 0.55, 0.014]} size={[0.012, 0.8, 0.006]} color={HUB.cyan} />
      <group position={[0, 1.4, 0.02]} rotation={[-0.14, 0, 0]}>
        <LayarCanvas pos={[0, 0, 0]} w={1.15} h={0.84} px={448} draw={gambarSimulasi} fps={4} rim={HUB.mint} />
      </group>
      <LabelHolo pos={[0, 2.1, 0.1]} teks="SIMULASI" warna={HUB.mint} w={0.8} />
    </group>
  );
}

// Menara proyeksi: alas navy bertingkat + tabung kaca berisi 3 cincin yang berputar dan inti yang berdenyut.
function MenaraProyeksi({ pos }: { pos: V3 }) {
  const inti = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (inti.current) inti.current.opacity = 0.5 + 0.4 * Math.sin(clock.elapsedTime * 2.0) ** 2;
  });
  const cincin: { y: number; r: number; c: string; sp: number }[] = [
    { y: 0.95, r: 0.34, c: HUB.cyan, sp: 1.1 },
    { y: 1.25, r: 0.28, c: HUB.violet, sp: -1.5 },
    { y: 1.55, r: 0.22, c: HUB.mint, sp: 2.0 },
  ];
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[1.7, 1.7]} color={HUB.violet} opacity={0.22} />
      <Tube pos={[0, 0.05, 0]} r={0.46} h={0.1} color={HUB.navy} seg={28} />
      <CincinLantai pos={[0, 0.105, 0]} r={0.42} lebar={0.022} color={HUB.cyan} />
      <Tube pos={[0, 0.4, 0]} r={0.2} rb={0.3} h={0.6} color={HUB.navy2} seg={20} />
      <TabungCahaya pos={[0, 0.28, 0]} r={0.265} h={0.018} color={HUB.violet} seg={20} />
      <Tube pos={[0, 0.72, 0]} r={0.26} h={0.04} color={HUB.putih} seg={20} cast={false} />
      <TabungCahaya pos={[0, 1.25, 0]} r={0.26} h={1.0} color={HUB.cyan} opacity={0.07} seg={20} />
      {cincin.map((o) => (
        <Putar key={o.y} pos={[0, o.y, 0]} speed={o.sp}>
          <mesh rotation={[Math.PI / 2.2, 0, 0]}>
            <torusGeometry args={[o.r, 0.012, 6, 40]} />
            <meshBasicMaterial color={o.c} toneMapped={false} />
          </mesh>
          <Ball pos={[o.r, 0, 0]} r={0.03} color={o.c} emissive={1.4} />
        </Putar>
      ))}
      <mesh position={[0, 1.25, 0]}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial ref={inti} color={HUB.pink} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <Tube pos={[0, 1.82, 0]} r={0.2} h={0.03} color={HUB.navy2} seg={20} cast={false} />
      <LabelHolo pos={[0, 2.15, 0]} teks="RISIKO" warna={HUB.pink} w={0.7} />
    </group>
  );
}

// Meja peta hologram bundar: daun putih + inlay navy + LED tepi, medan wireframe berputar pelan dengan penanda data, cincin melayang.
function MejaHoloPeta({ pos }: { pos: V3 }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1.45, 1.45, 16, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, 0.12 * Math.sin(x * 4.6) * Math.cos(y * 3.8) + 0.07 * Math.sin((x + y) * 7));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const titik = useMemo(() => {
    const r = mulberry32(2711);
    const warna = [HUB.cyan, HUB.mint, HUB.pink, HUB.amber];
    return Array.from({ length: 7 }, (_, i) => ({ x: (r() - 0.5) * 1.1, z: (r() - 0.5) * 1.1, h: 0.18 + r() * 0.2, c: warna[i % 4] }));
  }, []);
  return (
    <group position={pos}>
      <Kolam pos={[0, 0.02, 0]} size={[2.4, 2.4]} color={HUB.cyan} opacity={0.18} />
      <Tube pos={[0, 0.36, 0]} r={0.28} rb={0.36} h={0.72} color={HUB.navy2} seg={24} />
      <Tube pos={[0, 0.03, 0]} r={0.62} h={0.06} color={HUB.navy} seg={32} />
      <CincinLantai pos={[0, 0.065, 0]} r={0.58} lebar={0.02} color={HUB.violet} />
      <Tube pos={[0, 0.75, 0]} r={0.95} h={0.07} color={HUB.putih} seg={40} />
      <TabungCahaya pos={[0, 0.788, 0]} r={0.86} h={0.006} color={HUB.navy} seg={40} />
      <CincinLantai pos={[0, 0.795, 0]} r={0.9} lebar={0.018} color={HUB.cyan} />
      <CincinLantai pos={[0, 0.795, 0]} r={0.5} lebar={0.01} color={HUB.violet} opacity={0.7} />
      <TabungCahaya pos={[0, 0.9, 0]} r={0.75} rb={0.2} h={0.24} color={HUB.cyan} opacity={0.07} seg={24} />
      <Putar pos={[0, 1.0, 0]} speed={0.18}>
        <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color={HUB.cyan} wireframe transparent opacity={0.5} toneMapped={false} />
        </mesh>
        {titik.map((q, i) => (
          <group key={i}>
            <Cahaya pos={[q.x, 0.1 + q.h / 2, q.z]} size={[0.012, q.h, 0.012]} color={q.c} />
            <Ball pos={[q.x, 0.1 + q.h, q.z]} r={0.03} color={q.c} emissive={1.3} />
          </group>
        ))}
      </Putar>
      <Putar pos={[0, 1.5, 0]} speed={-0.35}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.75, 0.008, 6, 56]} />
          <meshBasicMaterial color={HUB.violet} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </Putar>
      <LabelHolo pos={[0, 1.85, 0]} teks="PETA RISIKO" warna={HUB.cyan} w={0.9} />
    </group>
  );
}

// Kredensa rendah futuristik (menempel dinding): badan navy + daun putih + LED depan, di atasnya mini hologram, grafik batang mini, dan tablet.
// Panjang di sumbu x lokal, muka depan di +z.
function KredensaHolo({ pos, rotY = 0, p = 3.0 }: { pos: V3; rotY?: number; p?: number }) {
  const bar = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    bar.current.forEach((m, i) => {
      if (!m) return;
      const h = 0.06 + (Math.sin(clock.elapsedTime * 1.3 + i * 1.1) * 0.5 + 0.5) * 0.16;
      m.scale.y = h;
      m.position.y = 0.36 + h / 2;
    });
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Kolam pos={[0, 0.02, 0.2]} size={[p + 0.4, 1.1]} color={HUB.violet} opacity={0.18} />
      <Box pos={[0, 0.17, 0]} size={[p, 0.3, 0.42]} color={HUB.navy2} />
      <Box pos={[0, 0.34, 0]} size={[p + 0.04, 0.035, 0.46]} color={HUB.putih} cast={false} />
      <Cahaya pos={[0, 0.22, 0.213]} size={[p - 0.2, 0.014, 0.008]} color={HUB.cyan} />
      <Cahaya pos={[0, 0.08, 0.213]} size={[p - 0.2, 0.01, 0.008]} color={HUB.violet} opacity={0.7} />
      {[-p / 6, p / 6].map((x) => (
        <Box key={x} pos={[x, 0.17, 0.212]} size={[0.012, 0.26, 0.006]} color={HUB.navy} cast={false} />
      ))}
      <MiniHolo pos={[-p / 2 + 0.42, 0.355, 0]} />
      {[-0.1, 0, 0.1].map((x, i) => (
        <mesh key={x} position={[x, 0.45, 0.02]} ref={(m) => { bar.current[i] = m; }}>
          <boxGeometry args={[0.06, 1, 0.06]} />
          <meshBasicMaterial color={i % 2 ? HUB.violet : HUB.cyan} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      ))}
      <Cahaya pos={[0, 0.357, 0.02]} size={[0.34, 0.004, 0.14]} color={HUB.cyan} opacity={0.35} />
      <group position={[p / 2 - 0.5, 0.36, 0.02]} rotation={[0, -0.25, 0]}>
        <Box pos={[0, 0.1, -0.02]} size={[0.34, 0.22, 0.015]} color="#0F0D2B" rot={[-0.35, 0, 0]} cast={false} />
        <Cahaya pos={[0, 0.1, -0.012]} size={[0.3, 0.18, 0.004]} color="#7DD3FC" opacity={0.85} />
      </group>
    </group>
  );
}

// Layar dinding timur Planning: 4 kartu KPI + grafik target vs aktual dengan kursor bergerak.
const gambarKpiBesar: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 32);
  kepalaLayar(g, W, 'KINERJA VS TARGET 2027', '#6EE7B7');
  const kpi: { n: string; v: string; c: string }[] = [
    { n: 'PENDAPATAN', v: '112%', c: '#6EE7B7' },
    { n: 'MARGIN', v: '18.4%', c: '#67E8F9' },
    { n: 'ARUS KAS', v: '+4.2%', c: '#FDE68A' },
    { n: 'RISIKO', v: 'RENDAH', c: '#F0ABFC' },
  ];
  const hd = W * 0.085;
  const gap = W * 0.02, tw = (W - gap * 5) / 4, ty = hd + H * 0.04, th = H * 0.24;
  kpi.forEach((k, i) => {
    const x = gap + i * (tw + gap);
    g.fillStyle = 'rgba(167,139,250,0.14)';
    g.fillRect(x, ty, tw, th);
    g.fillStyle = k.c;
    g.fillRect(x, ty, 4, th);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#C4B5FD';
    g.font = `600 ${Math.round(W * 0.022)}px ${FONT}`;
    g.fillText(k.n, x + W * 0.014, ty + th * 0.3);
    g.fillStyle = k.c;
    g.font = `800 ${Math.round(W * 0.04)}px ${FONT}`;
    g.fillText(k.v, x + W * 0.014, ty + th * 0.7);
  });
  const x0 = W * 0.04, x1 = W * 0.96, yT = ty + th + H * 0.06, yB = H - H * 0.05, N = 30;
  g.strokeStyle = 'rgba(237,233,254,0.16)';
  g.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = yT + ((yB - yT) * i) / 2;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  }
  const tgt = (i: number) => 0.3 + 0.5 * (i / N);
  const akt = (i: number) => tgt(i) + 0.05 * Math.sin(i * 0.6) + 0.03 * (i / N);
  const px = (i: number) => x0 + ((x1 - x0) * i) / N;
  const py = (v: number) => yB - (yB - yT) * v;
  g.setLineDash([8, 6]);
  g.strokeStyle = '#A78BFA';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= N; i++) { if (i) g.lineTo(px(i), py(tgt(i))); else g.moveTo(px(i), py(tgt(i))); }
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = '#6EE7B7';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= N; i++) { if (i) g.lineTo(px(i), py(akt(i))); else g.moveTo(px(i), py(akt(i))); }
  g.stroke();
  const c = (t * 3) % N;
  g.fillStyle = '#FDE68A';
  g.beginPath();
  g.arc(px(c), py(akt(c)), 6, 0, Math.PI * 2);
  g.fill();
};

// Dua layar KPI mini untuk dinding utara.
const gambarMiniA: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#C4B5FD';
  g.font = `700 ${Math.round(H * 0.14)}px ${FONT}`;
  g.fillText('ARUS KAS BULANAN', W * 0.05, H * 0.17);
  g.fillStyle = '#6EE7B7';
  g.font = `800 ${Math.round(H * 0.34)}px ${FONT}`;
  g.fillText('+' + (4.2 + 0.3 * Math.sin(t)).toFixed(1) + '%', W * 0.05, H * 0.58);
  const N = 20;
  g.strokeStyle = '#67E8F9';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = W * 0.52 + (W * 0.43 * i) / N, y = H * 0.85 - H * 0.5 * (0.35 + 0.5 * (i / N) + 0.1 * Math.sin(i * 0.9 + t * 1.5));
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
};
const gambarMiniB: GambarFn = (g, W, H, t) => {
  gridLayar(g, W, H, 24);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#C4B5FD';
  g.font = `700 ${Math.round(H * 0.14)}px ${FONT}`;
  g.fillText('REALISASI BUDGET', W * 0.05, H * 0.17);
  const cols = ['#67E8F9', '#A78BFA', '#6EE7B7', '#F0ABFC'];
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, i) => {
    const v = 0.35 + 0.5 * ((Math.sin(t * 0.9 + i * 1.4) + 1) / 2);
    const bw = W * 0.14, x = W * 0.08 + i * (bw + W * 0.07), hMax = H * 0.5, y = H * 0.9 - hMax;
    g.fillStyle = 'rgba(237,233,254,0.12)';
    g.fillRect(x, y, bw, hMax);
    g.fillStyle = cols[i];
    g.fillRect(x, y + hMax * (1 - v), bw, hMax * v);
    g.fillStyle = '#EDE9FE';
    g.font = `600 ${Math.round(H * 0.11)}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(q, x + bw / 2, H * 0.95);
  });
};

// Panel heksagon dinding: pelat navy + sarang lebah mini, sebagian sel menyala berdenyut (seni dinding futuristik). Muka di +z.
function PanelHeks({ pos, rotY = 0, w = 1.8, h = 0.7, seed = 5 }: { pos: V3; rotY?: number; w?: number; h?: number; seed?: number }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const cell = useMemo(() => {
    const r = mulberry32(seed * 13 + 1);
    const pal = [HUB.cyan, HUB.violet, HUB.mint, HUB.pink, HUB.amber];
    const out: { x: number; y: number; c: string; on: boolean; ph: number }[] = [];
    const dx = 0.17, dy = 0.147;
    const nx = Math.floor((w - 0.14) / dx), ny = Math.floor((h - 0.1) / dy) + 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        out.push({
          x: -((nx - 1) * dx) / 2 + i * dx + (j % 2 ? dx / 4 : -dx / 4),
          y: ((ny - 1) * dy) / 2 - j * dy,
          c: pal[Math.floor(r() * pal.length)],
          on: r() < 0.55,
          ph: r() * 6.28,
        });
      }
    }
    return out;
  }, [w, h, seed]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mats.current.forEach((m, i) => {
      const q = cell[i];
      if (m && q) m.opacity = q.on ? 0.35 + 0.6 * Math.max(0, Math.sin(t * 1.1 + q.ph)) : 0.1;
    });
  });
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Cahaya pos={[0, 0, 0.004]} size={[w + 0.12, h + 0.12, 0.004]} color={HUB.violet} opacity={0.14} />
      <Box pos={[0, 0, 0.03]} size={[w, h, 0.05]} color={HUB.navy} cast={false} />
      {cell.map((q, i) => (
        <mesh key={i} position={[q.x, q.y, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.072, 0.072, 0.008, 6]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} color={q.c} transparent opacity={0.3} toneMapped={false} />
        </mesh>
      ))}
      <Cahaya pos={[0, h / 2 - 0.01, 0.058]} size={[w - 0.02, 0.014, 0.012]} color={HUB.cyan} />
      <Cahaya pos={[0, -h / 2 + 0.01, 0.058]} size={[w - 0.02, 0.014, 0.012]} color={HUB.violet} />
    </group>
  );
}

function RuangPlanning() {
  const { cx, cz } = PLAN;
  const meja: { k: 'budget' | 'tax' | 'analytics' | 'skenario'; p: [number, number]; label?: string; warna: string; seat: string; seed: number }[] = [
    { k: 'budget', p: [-9.2, -3.4], label: HALAMAN_PLANNING[0].nama, warna: HALAMAN_PLANNING[0].warna, seat: 'pl:Pixel', seed: 101 },
    { k: 'tax', p: [5.2 + PL_DX, 0.4], label: HALAMAN_PLANNING[1].nama, warna: HALAMAN_PLANNING[1].warna, seat: 'pl:Quark', seed: 117 },
    { k: 'analytics', p: [5.2 + PL_DX, -3.4], label: HALAMAN_PLANNING[2].nama, warna: HALAMAN_PLANNING[2].warna, seat: 'pl:Radian', seed: 133 },
    { k: 'skenario', p: [-9.2, 0.4], warna: '#C4B5FD', seat: 'pl:Sigma', seed: 149 },
  ];
  return (
    <group position={[cx, 0, cz]}>
      <LantaiPlanning />
      <GlobeProyeksi pos={[-2.0 + PL_DX / 2, 0, 0]} />

      {/* dinding barat: jendela, roadmap, layar proyeksi, jam */}
      {/* [DIGANTI] jendela barat: smart glass futuristik, sama seperti jendela Research */}
      <JendelaFuturistik pos={[-11.86 - GESER_BARAT, 1.0, -4.5]} rotY={Math.PI / 2} w={1.8} h={0.95} />
      <PapanRoadmap pos={[-11.84 - GESER_BARAT, 1.05, -1.8]} />
      <LayarCanvas pos={[-11.8 - GESER_BARAT, 1.15, 2.1]} rotY={Math.PI / 2} w={3.4} h={1.3} px={1024} draw={gambarProyeksi} fps={5} rim={HUB.violet} />
      <group position={[-11.86 - GESER_BARAT, 1.15, 4.7]} rotation={[0, Math.PI / 2, 0]}><Clock pos={[0, 0, 0]} /></group>

      {/* dinding utara: rak arsip skenario + 3 layar dasbor */}
      <RakArsipTech pos={[-10.2, 0, -5.28]} judul="SKENARIO 2027" warna={HUB.violet} />
      <RakArsipTech pos={[-8.5, 0, -5.28]} judul="LAPORAN PROYEKSI" warna={HUB.cyan} />
      <DindingLayar pos={[2.6 + PL_DX * 0.77, 0, -4.7]} />
      <TamengPatuh pos={[-3.0, 0, -4.5]} />

      {/* 4 meja kerja bergaya Research (monitor menyala saat AI duduk) */}
      {meja.map((m) => (
        <group key={m.seat}>
          <MejaPlanning pos={[m.p[0], 0, m.p[1]]} k={m.k} label={m.label} warna={m.warna} seatKey={m.seat} seed={m.seed} />
          <Chair pos={[m.p[0], 0, m.p[1] + 0.85]} color="#8E7CC3" />
          <Tube pos={[m.p[0], 0.014, m.p[1] + 0.85]} r={0.46} h={0.012} color={HUB.navy} seg={28} cast={false} />
          <CincinLantai pos={[m.p[0], 0.024, m.p[1] + 0.85]} r={0.44} lebar={0.02} color={HUB.violet} opacity={0.9} />
        </group>
      ))}
      <PlanningPenghuni />

      {/* hologram ikon halaman */}
      <BolaKristal pos={[-6.6, 0, -4.3]} />
      <BatangHolo pos={[7.3 + PL_DX, 0, -3.4]} />

      {/* podium skenario di tengah selatan */}
      <PodiumSkenario pos={[2.6 + PL_DX / 2, 0, 4.75]} />

      {/* sudut santai barat-daya */}
      <SofaModern pos={[-6.0, 0, 4.5]} rotY={0} />
      <MejaInfoBulat pos={[-6.0, 0, 3.1]} />
      <Beanbag pos={[-9.6, 0, 3.4]} color="#C4B5FD" />
      <TiangHolo pos={[-9.8, 0, 4.8]} />
      <TiangHolo pos={[-1.8 + PL_DX / 2, 0, 4.8]} />
      <Teleskop pos={[5.6 + PL_DX, 0, 4.2]} rotY={0.5} />
      {/* [DIHAPUS] semua tanaman Planning; diganti komponen futuristik */}
      {/* 4 sudut ruangan */}
      <KubusData pos={[-12.5, 0, -4.4]} />
      <PilarEtalase pos={[-12.7, 0, 4.4]} rotY={Math.atan2(0.6 + 12.7, 0 - 4.4)} />
      <DockDrone pos={[12.1, 0, -4.75]} />
      <MenaraProyeksi pos={[12.3, 0, 4.9]} />

      {/* [BARU] detail tambahan */}
      <KioskSimulasi pos={[3.6, 0, -4.8]} />
      <MejaHoloPeta pos={[-2.6, 0, 4.1]} />
      <BangkuModern pos={[8.0, 0, 5.05]} w={1.8} />
      <KredensaHolo pos={[-13.3, 0, 2.1]} rotY={Math.PI / 2} p={3.0} />

      {/* [BARU] dinding utara (permukaan z = -5.4, bagian yang paling terlihat dari kamera): papan nama PLANNING di kiri pintu, 2 AC futuristik (sama seperti Research),
          panel heksagon di ujung barat, 2 layar KPI mini, dan garis LED atas (celah pintu dibiarkan kosong) */}
      <PapanNamaRiset pos={[-1.95, 1.33, -5.4]} label="PLANNING" sub="PUSAT PROYEKSI" />
      <ACFuturistik pos={[-4.9, 1.36, -5.4]} />
      <ACFuturistik pos={[11.0, 1.36, -5.4]} />
      <PanelHeks pos={[-12.2, 1.2, -5.4]} w={1.9} h={0.72} seed={3} />
      <LayarCanvas pos={[-6.65, 1.15, -5.36]} w={1.2} h={0.46} px={512} draw={gambarMiniA} fps={3} rim={HUB.mint} />
      <LayarCanvas pos={[9.3, 1.15, -5.36]} w={1.2} h={0.46} px={512} draw={gambarMiniB} fps={3} rim={HUB.violet} />
      <Cahaya pos={[-7.3, 1.57, -5.395]} size={[12.4, 0.014, 0.01]} color={HUB.violet} opacity={0.85} />
      <Cahaya pos={[7.05, 1.57, -5.395]} size={[11.9, 0.014, 0.01]} color={HUB.violet} opacity={0.85} />

      {/* [BARU] dinding timur (permukaan x = 13.1): layar KPI besar + panel heksagon + garis LED (pintu Management di z 3.6 dibiarkan kosong) */}
      <LayarCanvas pos={[13.07, 1.02, -1.4]} rotY={-Math.PI / 2} w={3.2} h={1.0} px={1024} draw={gambarKpiBesar} fps={4} rim={HUB.cyan} />
      <PanelHeks pos={[13.09, 1.15, -4.3]} rotY={-Math.PI / 2} w={1.7} h={0.62} seed={9} />
      <Cahaya pos={[13.095, 1.57, -1.4]} size={[0.01, 0.014, 7.8]} color={HUB.violet} opacity={0.85} />

      {/* [BARU] lapisan hias dinding Planning (tidak polos lagi, padanan wainscot Management): utara (kecuali celah pintu), barat, timur (kecuali celah pintu Management) */}
      <DindingDekorPlan s={-5.4} segs={[[-13.7, -1.06], [1.06, 13.1]]} panel={[[-13.7, -1.06], [1.06, 13.1]]} />
      <group rotation={[0, Math.PI / 2, 0]}>
        <DindingDekorPlan s={-13.7} segs={[[-5.4, 5.4]]} panel={[[-5.4, -3.8]]} />
      </group>
      <group rotation={[0, -Math.PI / 2, 0]}>
        <DindingDekorPlan s={-13.1} segs={[[-5.4, 2.6], [4.6, 5.4]]} panel={[[-5.4, -3.1], [0.3, 2.6], [4.6, 5.4]]} />
      </group>

      {/* drone informasi melayang */}
      <DroneInfo pusat={[-2.5 + PL_DX / 2, 0, 0.5]} rx={4.4} rz={3.2} y={2.1} />
    </group>
  );
}

// ---- [DIDESAIN ULANG] RUANG MANAGEMENT: kantor biasa (tanpa efek futuristik), ramai & berisi informasi -------------------------------
// Tata letak (koordinat lokal ruangan, pusat = pusat ruangan: x -13.5..13.5, z -5.5..5.5):
//   - SATU-SATUNYA MEJA KERJA: MEJA BUNDAR PUTIH di tengah (0, 0), 6 kursi/AI melingkar (reports, clients, coa, documents, settings, payroll);
//     laptop menyala hanya saat ada AI duduk. Di meja: speakerphone, teko air + gelas, tisu, tanaman kecil, kertas, buku, pulpen, mug.
//   - Dinding utara: 2 rak buku berjudul, AC, papan agenda, kalender, sertifikat, jam, [pintu], papan nama, 2 lemari arsip berlabel + piala,
//     printer + denah, rak buku, APAR, dispenser, papan gabus pengumuman.
//   - Dinding barat: palem, papan organisasi berdiri, rak buku, gantungan jas, AC, jadwal ruang rapat. Timur: kopi, etalase penghargaan, lemari arsip,
//     bendera, sofa + meja kopi. Timur-tengah: pojok informasi (banner visi-misi, papan direktori, rak brosur), troli dokumen.
//   - Barat daya: sudut tunggu (sofa + meja kopi + karpet + rak majalah). Selatan: bak tanaman, tanaman & lampu.
//   - Lantai parket kayu berbingkai + karpet bundar bermotif; dinding: panel kayu, kertas dinding motif, lis atas-bawah.
//   - Jalur agen yang harus tetap kosong: lingkaran r < 4.6 dari pusat, garis (0,-5.5)->(0,-4.3), dan jalur pintu barat (-12.6,3.6)->(-4.2,1.0).

const MG_R = 3.05; // jarak kursi dari pusat meja (mepet meja supaya tangan AI sampai ke laptop)
const MG_N = HALAMAN_MG_DUDUK.length; // 6 kursi
const MG_MEJA_R = 2.62; // jari-jari daun meja
const MG_LAPTOP_Z = 2.3; // laptop di pinggir meja (jarak dari pusat), keyboard ~0.65 di depan AI yang duduk
const MG_SAMPUL = ['#2F5D8A', '#B45309', '#166534', '#7C2D12', '#4C1D95', '#0F766E']; // warna sampul buku tiap kursi
const MG_PULPEN = ['#1E3A8A', '#B91C1C', '#111827', '#1E3A8A', '#047857', '#B91C1C'];

// Meja bundar putih polos: daun putih, sisi bawah abu terang, kolom tengah.
function MejaBundarPutih() {
  return (
    <group>
      <Tube pos={[0, 0.78, 0]} r={MG_MEJA_R} h={0.07} color="#FFFFFF" seg={64} />
      <Tube pos={[0, 0.73, 0]} r={MG_MEJA_R - 0.12} h={0.07} color="#E5E7EB" seg={64} cast={false} />
      <Tube pos={[0, 0.38, 0]} r={0.38} rb={0.46} h={0.74} color="#E5E7EB" />
      <Tube pos={[0, 0.025, 0]} r={1.25} h={0.05} color="#D1D5DB" seg={36} />
    </group>
  );
}

// Buku tertutup (sampul + halaman + sampul atas) dan pulpen, di atas meja (lokal: permukaan meja = y 0).
function BukuMeja({ pos, rotY = 0, warna }: { pos: V3; rotY?: number; warna: string }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.008, 0]} size={[0.2, 0.016, 0.28]} color={warna} cast={false} />
      <Box pos={[0.005, 0.023, 0]} size={[0.19, 0.014, 0.265]} color="#F8FAFC" cast={false} />
      <Box pos={[0, 0.032, 0]} size={[0.2, 0.004, 0.28]} color={warna} cast={false} />
      <Box pos={[0, 0.0345, -0.07]} size={[0.11, 0.001, 0.03]} color="#F8FAFC" cast={false} />
    </group>
  );
}
function PulpenMeja({ pos, rotY = 0, warna }: { pos: V3; rotY?: number; warna: string }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.007, 0]} size={[0.012, 0.012, 0.15]} color={warna} cast={false} />
      <Box pos={[0, 0.007, 0.08]} size={[0.008, 0.008, 0.02]} color="#9CA3AF" cast={false} />
      <Box pos={[0, 0.0135, -0.03]} size={[0.004, 0.003, 0.07]} color="#D1D5DB" cast={false} />
    </group>
  );
}

function Piala({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.03, 0]} size={[0.16, 0.06, 0.16]} color="#5B4630" cast={false} />
      <Tube pos={[0, 0.12, 0]} r={0.012} h={0.12} color={EMAS} seg={6} cast={false} />
      <Tube pos={[0, 0.23, 0]} r={0.07} rb={0.03} h={0.12} color={EMAS} seg={12} cast={false} />
    </group>
  );
}

// [BARU] AC dinding Management: persis AC ruang Financial Statements (WallAC + pipa kondensat ke lantai).
// pos = titik di permukaan dinding (y = 0); +z lokal = menghadap ke dalam ruangan. pipa = 1 / -1 -> pipa di kanan / kiri AC.
function ACDinding({ pos, rotY = 0, pipa = 1 }: { pos: V3; rotY?: number; pipa?: 1 | -1 }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <WallAC pos={[0, 1.3, 0.05]} />
      <Box pos={[0.74 * pipa, 0.72, 0.06]} size={[0.04, 0.84, 0.04]} color="#E5E7EB" cast={false} />
      <Box pos={[0.74 * pipa, 0.3, 0.075]} size={[0.07, 0.03, 0.07]} color="#9CA3AF" cast={false} />
    </group>
  );
}

// [BARU] Papan nama ruangan MANAGEMENT: layar datar menempel di dinding (bezel grafit + muka biru baja, tulisan putih + garis emas),
// gaya kantor biasa (tanpa efek futuristik) agar serasi dengan ruang Management. z = 0 permukaan dinding; menonjol ke +z.
function PapanNamaMgmt({ pos, label = 'MANAGEMENT', sub = 'RUANG DIREKSI' }: { pos: V3; label?: string; sub?: string }) {
  const W = 1.9, H = 0.46;
  const pw = W - 0.1, ph = H - 0.1;
  const tex = useMemo(() => {
    const CW = 1024, CH = Math.round((CW * ph) / pw);
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    const g = c.getContext('2d');
    if (g) {
      const F = 'Inter, system-ui, sans-serif';
      const bg = g.createLinearGradient(0, 0, 0, CH);
      bg.addColorStop(0, '#34567F');
      bg.addColorStop(1, '#1E3556');
      g.fillStyle = bg;
      g.fillRect(0, 0, CW, CH);
      // pantulan kaca tipis (diagonal)
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(CW * 0.34, 0); g.lineTo(CW * 0.16, CH); g.lineTo(0, CH);
      g.closePath();
      g.fill();
      // ikon kiri: tiga batang grafik emas di kotak berbingkai
      const ix = 96, iy = CH / 2, s = Math.min(CH * 0.58, 120);
      g.strokeStyle = '#F5C84C';
      g.lineWidth = 7;
      g.strokeRect(ix - s / 2, iy - s / 2, s, s);
      g.fillStyle = '#F5C84C';
      [0.32, 0.58, 0.82].forEach((hh, i) => {
        const bw = s * 0.16, bx = ix - s * 0.3 + i * s * 0.3 - bw / 2, bh = s * hh * 0.78;
        g.fillRect(bx, iy + s * 0.36 - bh, bw, bh);
      });
      // judul
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let fs = Math.round(CH * 0.46);
      g.font = `800 ${fs}px ${F}`;
      (g as any).letterSpacing = '6px';
      while (g.measureText(label).width > CW * 0.68 && fs > 20) { fs -= 4; g.font = `800 ${fs}px ${F}`; }
      g.fillStyle = '#FFFFFF';
      g.fillText(label, CW * 0.57, CH * 0.43);
      // garis emas + subjudul
      g.fillStyle = '#F5C84C';
      g.fillRect(CW * 0.25, CH * 0.69, CW * 0.64, 5);
      (g as any).letterSpacing = '8px';
      g.font = `700 ${Math.round(CH * 0.15)}px ${F}`;
      g.fillStyle = '#C9D8EE';
      g.fillText(sub, CW * 0.57, CH * 0.84);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [label, sub, ph, pw]);
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0.012]} size={[W + 0.06, H + 0.06, 0.024]} color="#C9D1D8" cast={false} />
      <Box pos={[0, 0, 0.034]} size={[W, H, 0.03]} color="#1F2630" cast={false} />
      <mesh position={[0, 0, 0.0502]}>
        <planeGeometry args={[pw, ph]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* lampu standby kecil di pojok bezel */}
      <mesh position={[W / 2 - 0.05, -H / 2 + 0.03, 0.052]}>
        <boxGeometry args={[0.02, 0.012, 0.004]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

// [BARU] Bendera berdiri kantor direksi: merah-putih + bendera perusahaan (biru baja, garis emas), tiang emas di alas bulat.
function BenderaMgmt({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Tube pos={[0, 0.02, 0]} r={0.22} h={0.04} color="#2B3340" seg={20} cast={false} />
      {[-0.16, 0.16].map((x) => (
        <React.Fragment key={x}>
          <Tube pos={[x, 0.95, 0]} r={0.014} h={1.9} color="#B8962E" seg={8} cast={false} />
          <Ball pos={[x, 1.92, 0]} r={0.035} color={EMAS} flat={false} />
        </React.Fragment>
      ))}
      {/* merah putih (kiri) */}
      <Box pos={[-0.16 - 0.31, 1.72, 0]} size={[0.6, 0.2, 0.012]} color="#D62828" cast={false} />
      <Box pos={[-0.16 - 0.31, 1.52, 0]} size={[0.6, 0.2, 0.012]} color="#FFFFFF" cast={false} />
      {/* bendera perusahaan (kanan) */}
      <Box pos={[0.16 + 0.31, 1.62, 0]} size={[0.6, 0.4, 0.012]} color="#1E3556" cast={false} />
      <Box pos={[0.16 + 0.31, 1.62, 0.008]} size={[0.6, 0.03, 0.004]} color={EMAS} cast={false} />
      <Box pos={[0.16 + 0.31, 1.7, 0.008]} size={[0.1, 0.1, 0.004]} color="#F8F9FB" cast={false} />
    </group>
  );
}

// [BARU] Globe meja di dudukan emas (untuk meja direksi).
function GlobeMeja({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Tube pos={[0, 0.012, 0]} r={0.07} h={0.024} color="#5B4630" seg={16} cast={false} />
      <Tube pos={[0, 0.07, 0]} r={0.008} h={0.1} color={EMAS} seg={6} cast={false} />
      <Ball pos={[0, 0.17, 0]} r={0.1} color="#4C8FB5" flat={false} />
      <Box pos={[0.02, 0.19, 0.06]} size={[0.07, 0.05, 0.05]} color="#6BAA75" cast={false} />
      <Tube pos={[0, 0.17, 0]} r={0.108} h={0.006} color={EMAS} rot={[0.4, 0, 0.35]} seg={24} cast={false} />
    </group>
  );
}

// [BARU] Perlengkapan di atas meja bundar (permukaan meja = y 0.815): speakerphone konferensi di pusat, teko air + gelas,
// tisu, tanaman kecil, dan tumpukan kertas di sela kursi. Semua kecil dan di pusat meja (tidak menyentuh laptop di pinggir meja).
function DekorMejaBundar() {
  const Y = 0.815;
  const D = 1.42;
  return (
    <group>
      <Tube pos={[0, Y + 0.02, 0]} r={0.2} h={0.04} color="#2B3340" seg={24} cast={false} />
      <Tube pos={[0, Y + 0.043, 0]} r={0.15} h={0.008} color="#4B5563" seg={24} cast={false} />
      {[0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3;
        return <Box key={i} pos={[Math.sin(a) * 0.09, Y + 0.049, Math.cos(a) * 0.09]} size={[0.05, 0.004, 0.02]} color="#9CA3AF" rot={[0, a, 0]} cast={false} />;
      })}
      <mesh position={[0, Y + 0.05, 0]}>
        <boxGeometry args={[0.03, 0.006, 0.03]} />
        <meshStandardMaterial color="#4ADE80" emissive="#4ADE80" emissiveIntensity={1.1} />
      </mesh>
      {Array.from({ length: MG_N }, (_, i) => {
        const b = ((i + 0.5) * 2 * Math.PI) / MG_N;
        const x = Math.sin(b) * D, z = Math.cos(b) * D;
        return (
          <group key={i} position={[x, Y, z]} rotation={[0, b, 0]}>
            {i % 2 === 0 ? (
              <>
                <Tube pos={[0, 0.1, 0]} r={0.055} h={0.2} color="#CFEAF5" seg={14} cast={false} />
                <Tube pos={[0, 0.205, 0]} r={0.06} h={0.02} color="#9CA3AF" seg={14} cast={false} />
                <Box pos={[0.075, 0.12, 0]} size={[0.02, 0.1, 0.03]} color="#CFEAF5" cast={false} />
                <Tube pos={[0.2, 0.04, 0.08]} r={0.03} h={0.08} color="#DDF1F8" seg={12} cast={false} />
                <Tube pos={[-0.2, 0.04, 0.08]} r={0.03} h={0.08} color="#DDF1F8" seg={12} cast={false} />
              </>
            ) : (
              <>
                <Succulent pos={[0, 0, 0]} scale={0.9} />
                <Box pos={[0.28, 0.045, 0.02]} size={[0.2, 0.09, 0.11]} color="#F3F4F6" cast={false} />
                <Box pos={[0.28, 0.093, 0.02]} size={[0.1, 0.012, 0.03]} color="#CBD5E1" cast={false} />
                <TumpukKertas pos={[-0.3, 0, 0.02]} n={3} rotY={0.3} header="#4C5FA8" />
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ======================= [BARU] RUANG MANAGEMENT — perabot, papan & lantai/dinding berisi INFORMASI nyata (tekstur kanvas) =======================
// Semua papan, rak, lemari, pigura dan poster di ruang ini menampilkan tulisan / data sungguhan (bukan garis polos).
// Hanya ada SATU meja kerja di ruang ini: meja bundar di tengah. Dua meja kerja coklat + kursinya sudah dihapus dan diganti
// etalase penghargaan + pojok informasi (banner visi-misi, papan direktori, rak brosur).
const MGF = 'Inter, system-ui, sans-serif';
const MGF_TULIS = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Marker Felt", cursive';
const MGF_SERIF = 'Georgia, "Times New Roman", serif';

function useKanvasMg(w: number, h: number, gambar: (g: CanvasRenderingContext2D, w: number, h: number) => void, kunci: string) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) gambar(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, w, h]);
}

function rrMg(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Kecilkan font sampai teks muat dalam maxW. Mengembalikan ukuran font akhir.
function fitMg(g: CanvasRenderingContext2D, t: string, maxW: number, fs: number, weight = '700', fam = MGF) {
  let s = fs;
  g.font = `${weight} ${s}px ${fam}`;
  while (g.measureText(t).width > maxW && s > 8) {
    s -= 2;
    g.font = `${weight} ${s}px ${fam}`;
  }
  return s;
}

// Tulis teks berbaris (word-wrap). Mengembalikan y baris berikutnya.
function bungkusMg(g: CanvasRenderingContext2D, teks: string, x: number, y: number, maxW: number, lh: number, maks = 99) {
  const kata = teks.split(' ');
  let baris = '';
  let yy = y;
  let n = 0;
  for (const k of kata) {
    const uji = baris ? `${baris} ${k}` : k;
    if (g.measureText(uji).width > maxW && baris) {
      g.fillText(baris, x, yy);
      yy += lh;
      baris = k;
      n++;
      if (n >= maks) return yy;
    } else baris = uji;
  }
  if (baris) g.fillText(baris, x, yy);
  return yy + lh;
}

// Bidang datar bertekstur (tulisan di dinding / papan).
function BidangMg({ pos, w, h, tex, rotY = 0, alpha = false }: { pos: V3; w: number; h: number; tex: THREE.Texture; rotY?: number; alpha?: boolean }) {
  return (
    <mesh position={pos} rotation={[0, rotY, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent={alpha} alphaTest={alpha ? 0.05 : 0} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------- LANTAI ----------------------------------------------------------------

// [DIDESAIN ULANG] Karpet bundar Management: nada senada (biru baja redup + krem hangat), kontras rendah supaya tidak mencolok di atas lantai parket kayu.
// Tepi biru baja pekat + garis krem tipis, pita anyaman halus, medan biru-abu dengan cincin tipis & jari-jari samar, rosetta kecil bernada sama di tengah (tertutup meja).
function KarpetBundarMotif({ r }: { r: number }) {
  const tex = useKanvasMg(1024, 1024, (g, W) => {
    const R = W / 2;
    const lingkar = (rad: number, col: string) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(R, R, rad, 0, Math.PI * 2);
      g.fill();
    };
    const cincin = (rad: number, col: string, lw: number) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(R, R, rad, 0, Math.PI * 2);
      g.stroke();
    };
    lingkar(R, '#3A4C68'); // tepi luar biru baja redup
    cincin(R * 0.955, '#A99B7C', 3); // garis krem-kayu tipis (menyatu dengan parket)
    lingkar(R * 0.93, '#46597A'); // pita luar
    // anyaman halus: belah ketupat kecil bernada sama (kontras rendah)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      g.save();
      g.translate(R + Math.cos(a) * R * 0.86, R + Math.sin(a) * R * 0.86);
      g.rotate(a + Math.PI / 4);
      g.fillStyle = i % 2 ? '#52668A' : '#3F5273';
      g.fillRect(-7, -7, 14, 14);
      g.restore();
    }
    cincin(R * 0.79, '#A99B7C', 3);
    lingkar(R * 0.775, '#33445F'); // pita dalam lebih gelap
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      g.fillStyle = '#6F7F9C';
      g.beginPath();
      g.arc(R + Math.cos(a) * R * 0.72, R + Math.sin(a) * R * 0.72, 3, 0, Math.PI * 2);
      g.fill();
    }
    lingkar(R * 0.66, '#586C8F'); // medan tengah biru-abu
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 2;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      g.beginPath();
      g.moveTo(R + Math.cos(a) * R * 0.3, R + Math.sin(a) * R * 0.3);
      g.lineTo(R + Math.cos(a) * R * 0.65, R + Math.sin(a) * R * 0.65);
      g.stroke();
    }
    [0.5, 0.4].forEach((k) => cincin(R * k, 'rgba(255,255,255,0.09)', 2));
    lingkar(R * 0.28, '#4C6084');
    g.fillStyle = '#6A7E9E'; // rosetta samar, nada senada
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rad = i % 2 ? R * 0.11 : R * 0.23;
      g.lineTo(R + Math.cos(a) * rad, R + Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
  }, 'mg-karpet-bundar-v2');
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]} receiveShadow>
      <circleGeometry args={[r, 72]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Karpet persegi bermotif (keset pintu, sudut tunggu, area sofa): bingkai dua garis + medan belah ketupat + rumbai; opsional tulisan.
function KarpetMotif({ pos, w, d, a, b, c = '#EFE6D0', teks }: { pos: V3; w: number; d: number; a: string; b: string; c?: string; teks?: string }) {
  const tw = 1024;
  const th = Math.max(256, Math.round((1024 * d) / w));
  const tex = useKanvasMg(tw, th, (g, W, H) => {
    g.fillStyle = a;
    g.fillRect(0, 0, W, H);
    const m = Math.min(W, H) * 0.05;
    g.strokeStyle = c;
    g.lineWidth = m * 0.35;
    g.strokeRect(m, m, W - 2 * m, H - 2 * m);
    g.strokeStyle = b;
    g.lineWidth = m * 0.25;
    g.strokeRect(m * 1.7, m * 1.7, W - 3.4 * m, H - 3.4 * m);
    const x0 = m * 2.4, y0 = m * 2.4, x1 = W - m * 2.4, y1 = H - m * 2.4;
    g.fillStyle = b;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const s = Math.min(W, H) * 0.13;
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    for (let yy = y0, row = 0; yy < y1 + s; yy += s, row++) {
      for (let xx = x0; xx < x1 + s; xx += s) {
        const ox = (row % 2) * (s / 2);
        g.fillStyle = 'rgba(255,255,255,0.15)';
        g.beginPath();
        g.moveTo(xx + ox, yy - s * 0.4);
        g.lineTo(xx + ox + s * 0.4, yy);
        g.lineTo(xx + ox, yy + s * 0.4);
        g.lineTo(xx + ox - s * 0.4, yy);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.14)';
        g.fillRect(xx + ox - 3, yy - 3, 6, 6);
      }
    }
    g.restore();
    if (teks) {
      g.fillStyle = 'rgba(15,23,42,0.55)';
      g.fillRect(x0, H / 2 - H * 0.16, x1 - x0, H * 0.32);
      g.fillStyle = '#F8FAFC';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitMg(g, teks, (x1 - x0) * 0.86, H * 0.22, '800');
      g.fillText(teks, W / 2, H / 2 + 2);
    }
  }, `mg-karpet-${a}-${b}-${c}-${w}-${d}-${teks ?? ''}`);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={pos} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lantai parket kayu (papan acak + bingkai kayu gelap di tepi) + kotak colokan lantai kuningan.
function LantaiMgmt() {
  const { w, d } = MGMT;
  const kayu = useKanvasMg(2048, 836, (g, W, H) => {
    const r = mulberry32(2711);
    const pxm = W / w;
    const rowH = 0.16 * pxm;
    const pal = ['#C79A63', '#BB8C57', '#D1A774', '#B4854F', '#C2955E', '#CCA06B'];
    for (let ry = 0; ry < Math.ceil(H / rowH); ry++) {
      let x = -r() * 1.4 * pxm;
      while (x < W) {
        const len = (0.9 + r() * 0.9) * pxm;
        g.fillStyle = pal[Math.floor(r() * pal.length)];
        g.fillRect(x, ry * rowH, len, rowH);
        g.strokeStyle = 'rgba(90,58,28,0.18)';
        g.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const yy = ry * rowH + (0.2 + r() * 0.6) * rowH;
          g.beginPath();
          g.moveTo(x + 4, yy);
          g.lineTo(x + len - 4, yy + (r() - 0.5) * 3);
          g.stroke();
        }
        g.fillStyle = 'rgba(70,44,20,0.38)';
        g.fillRect(x, ry * rowH, 1.6, rowH);
        x += len;
      }
      g.fillStyle = 'rgba(70,44,20,0.38)';
      g.fillRect(0, ry * rowH, W, 1.6);
    }
    // bingkai kayu gelap mengelilingi ruangan (inlay) + garis tipis krem di dalamnya
    g.strokeStyle = 'rgba(52,30,12,0.55)';
    g.lineWidth = 0.22 * pxm;
    g.strokeRect(0.42 * pxm, 0.42 * pxm, W - 0.84 * pxm, H - 0.84 * pxm);
    g.strokeStyle = 'rgba(245,230,196,0.7)';
    g.lineWidth = 0.025 * pxm;
    g.strokeRect(0.7 * pxm, 0.7 * pxm, W - 1.4 * pxm, H - 1.4 * pxm);
  }, `mg-kayu-${w}`);
  const colokan: [number, number][] = [[-6.2, 1.9], [6.2, 1.6], [-6.4, -2.6], [6.4, -1.8], [0, 5.0]];
  return (
    <>
      <Lantai cx={0} w={w} d={d} color={TH.mgmt.floor} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[w - 0.04, d - 0.04]} />
        <meshLambertMaterial map={kayu} />
      </mesh>
      <KarpetBundarMotif r={4.9} />
      {/* keset pintu utara + keset pintu barat (ke Planning) */}
      <KarpetMotif pos={[0, 0.009, -4.85]} w={2.2} d={1.1} a="#22365A" b="#2F4B7A" teks="MANAGEMENT" />
      <KarpetMotif pos={[-12.55, 0.009, 3.6]} w={1.2} d={2.0} a="#22365A" b="#2F4B7A" />
      {/* karpet sudut tunggu & area sofa timur */}
      <KarpetMotif pos={[-7.8, 0.008, 4.05]} w={3.2} d={2.2} a="#7C2A3A" b="#34507F" />
      <KarpetMotif pos={[11.8, 0.008, 3.6]} w={3.0} d={2.6} a="#2F5D4F" b="#3E6F5E" />
      {/* karpet pojok informasi */}
      <KarpetMotif pos={[9.4, 0.008, -3.0]} w={3.6} d={1.9} a="#33445F" b="#415A82" />
      {/* kotak colokan lantai kuningan */}
      {colokan.map(([x, z], i) => (
        <group key={i} position={[x, 0.006, z]}>
          <Box pos={[0, 0, 0]} size={[0.16, 0.012, 0.16]} color="#B8962E" cast={false} />
          <Box pos={[0, 0.007, 0]} size={[0.12, 0.004, 0.12]} color="#D4B04C" cast={false} />
          <Box pos={[-0.03, 0.01, 0]} size={[0.025, 0.004, 0.04]} color="#2B3340" cast={false} />
          <Box pos={[0.03, 0.01, 0]} size={[0.025, 0.004, 0.04]} color="#2B3340" cast={false} />
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- DINDING ----------------------------------------------------------------

// Kertas dinding bermotif (garis + belah ketupat emas) yang diulang sepanjang w.
function KertasDinding({ pos, w, h = 0.72 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 192, (g, W, H) => {
    g.fillStyle = '#A7BCDA';
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 32) {
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(x, 0, 16, H);
    }
    for (let ix = 0; ix < 4; ix++) {
      for (let iy = 0; iy < 3; iy++) {
        const cx = 32 + ix * 64, cy = 32 + iy * 64 + (ix % 2) * 0;
        g.fillStyle = '#C9A44A';
        g.beginPath();
        g.moveTo(cx, cy - 12);
        g.lineTo(cx + 9, cy);
        g.lineTo(cx, cy + 12);
        g.lineTo(cx - 9, cy);
        g.closePath();
        g.fill();
        g.fillStyle = '#E9D79A';
        g.beginPath();
        g.arc(cx, cy, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, 'mg-kertas-dinding');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Lapisan hias dinding: lis bawah, panel kayu (wainscot) + rel, kertas dinding motif, lis atas. s = z permukaan dinding (menghadap +z lokal).
function DindingDekor({ s, segs }: { s: number; segs: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const n = Math.max(1, Math.round(L / 0.9));
        return (
          <React.Fragment key={a}>
            <Box pos={[cx, 0.4, s + 0.015]} size={[L, 0.8, 0.03]} color="#8E6E4C" cast={false} />
            {Array.from({ length: n }, (_, i) => (
              <Box key={i} pos={[a + ((i + 0.5) * L) / n, 0.4, s + 0.034]} size={[L / n - 0.16, 0.54, 0.012]} color="#A07E58" cast={false} />
            ))}
            <Box pos={[cx, 0.06, s + 0.027]} size={[L, 0.12, 0.054]} color="#4A3826" cast={false} />
            <Box pos={[cx, 0.82, s + 0.03]} size={[L, 0.045, 0.06]} color="#F3EDE0" cast={false} />
            <KertasDinding pos={[cx, 1.19, s + 0.006]} w={L} />
            <Box pos={[cx, 1.575, s + 0.035]} size={[L, 0.05, 0.07]} color="#F3F7FC" cast={false} />
            <Box pos={[cx, 1.535, s + 0.022]} size={[L, 0.03, 0.044]} color="#D9B25B" cast={false} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// [BARU] Kertas dinding Planning: lavender dengan kisi heksagon halus + simpul cahaya (padanan KertasDinding Management, bertema futuristik).
function KertasDindingPlan({ pos, w, h = 0.64 }: { pos: V3; w: number; h?: number }) {
  const dasar = useKanvasMg(256, 166, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#171347');
    gr.addColorStop(1, '#241E63');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    const dx = W / 8, dy = H / 6, r = dy / 1.5;
    const pusat: [number, number, number, number][] = [];
    for (let j = -1; j <= 7; j++) {
      for (let i = -1; i <= 9; i++) {
        pusat.push([i, j, i * dx + (((j % 2) + 2) % 2 ? dx / 2 : 0), j * dy]);
      }
    }
    const heks = (cx: number, cy: number) => {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
    };
    // sel berisi (tipis) + garis kisi
    for (const [i, j, cx, cy] of pusat) {
      const h3 = ((i + 9) * 7 + (j + 9) * 3) % 11;
      if (h3 === 2 || h3 === 7) { g.fillStyle = 'rgba(167,139,250,0.16)'; heks(cx, cy); g.fill(); }
      if (h3 === 4) { g.fillStyle = 'rgba(103,232,249,0.12)'; heks(cx, cy); g.fill(); }
    }
    g.strokeStyle = 'rgba(103,232,249,0.30)';
    g.lineWidth = 1.5;
    for (const [, , cx, cy] of pusat) { heks(cx, cy); g.stroke(); }
    // simpul cahaya
    for (const [i, j, cx, cy] of pusat) {
      if (((i + 9) * 7 + (j + 9) * 3) % 11 === 0) {
        g.fillStyle = '#67E8F9'; g.beginPath(); g.arc(cx, cy, 2.8, 0, Math.PI * 2); g.fill();
      } else if (((i + 9) * 5 + (j + 9) * 2) % 13 === 0) {
        g.fillStyle = '#F0ABFC'; g.beginPath(); g.arc(cx, cy, 2.4, 0, Math.PI * 2); g.fill();
      }
    }
    // jejak sirkuit tipis
    g.strokeStyle = 'rgba(167,139,250,0.55)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 40); g.lineTo(60, 40); g.lineTo(80, 60); g.lineTo(150, 60); g.stroke();
    g.beginPath(); g.moveTo(150, 60); g.lineTo(170, 40); g.lineTo(256, 40); g.stroke();
    g.beginPath(); g.moveTo(0, 126); g.lineTo(90, 126); g.lineTo(110, 106); g.lineTo(256, 106); g.stroke();
  }, 'plan-kertas-dinding-gelap');
  const tex = useMemo(() => {
    const t = dasar.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, w), 1);
    t.needsUpdate = true;
    return t;
  }, [dasar, w]);
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// [BARU] Lapisan hias dinding Planning (padanan DindingDekor Management): plint gelap + LED, wainscot navy berpanel dengan celah cahaya,
// rel atas bercahaya, kertas dinding heksagon, list atas navy + garis cyan. s = z permukaan dinding (menghadap +z lokal).
// segs = rentang yang diberi plint/dasar/kertas/list; panel = rentang (bagian dari segs) yang juga diberi panel alur + rel
// (dikosongkan di tempat papan/layar dinding menutupi wainscot).
function DindingDekorPlan({ s, segs, panel }: { s: number; segs: [number, number][]; panel: [number, number][] }) {
  return (
    <>
      {segs.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        return (
          <React.Fragment key={`d${a}`}>
            <Box pos={[cx, 0.4, s + 0.01]} size={[L, 0.8, 0.02]} color={HUB.navy2} cast={false} />
            <Box pos={[cx, 0.06, s + 0.027]} size={[L, 0.12, 0.054]} color={HUB.navy} cast={false} />
            <Cahaya pos={[cx, 0.126, s + 0.056]} size={[L - 0.04, 0.012, 0.006]} color={HUB.cyan} opacity={0.9} />
            <KertasDindingPlan pos={[cx, 1.175, s + 0.002]} w={L} />
            <Box pos={[cx, 1.52, s + 0.02]} size={[L, 0.03, 0.04]} color={HUB.navy} cast={false} />
            <Cahaya pos={[cx, 1.545, s + 0.03]} size={[L - 0.04, 0.01, 0.012]} color={HUB.cyan} opacity={0.9} />
          </React.Fragment>
        );
      })}
      {panel.map(([a, b]) => {
        const L = b - a;
        const cx = (a + b) / 2;
        const n = Math.max(1, Math.round(L / 0.9));
        return (
          <React.Fragment key={`p${a}`}>
            {Array.from({ length: n }, (_, i) => {
              const x = a + ((i + 0.5) * L) / n;
              return (
                <React.Fragment key={i}>
                  <Box pos={[x, 0.42, s + 0.03]} size={[L / n - 0.16, 0.54, 0.012]} color="#3B3485" cast={false} />
                  <Cahaya pos={[x, 0.42, s + 0.039]} size={[0.012, 0.4, 0.004]} color={HUB.violet} opacity={0.9} />
                  <Cahaya pos={[x, 0.66, s + 0.039]} size={[0.07, 0.012, 0.004]} color={HUB.cyan} opacity={0.8} />
                  <Cahaya pos={[x, 0.18, s + 0.039]} size={[0.07, 0.012, 0.004]} color={HUB.cyan} opacity={0.8} />
                </React.Fragment>
              );
            })}
            <Box pos={[cx, 0.82, s + 0.03]} size={[L, 0.045, 0.06]} color={HUB.putih} cast={false} />
            <Cahaya pos={[cx, 0.792, s + 0.058]} size={[L, 0.01, 0.004]} color={HUB.violet} opacity={0.95} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Bak tanaman kayu panjang berisi semak (dipasang di sisi dinding rendah selatan).
function BakTanaman({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.2, 0]} size={[1.0, 0.4, 0.38]} color="#7A5B3A" />
      <Box pos={[0, 0.41, 0]} size={[1.06, 0.03, 0.44]} color="#5B4630" cast={false} />
      <Box pos={[0, 0.39, 0]} size={[0.92, 0.02, 0.3]} color="#4A3728" cast={false} />
      {[-0.32, 0, 0.32].map((x, i) => (
        <React.Fragment key={x}>
          <Ball pos={[x, 0.62, 0]} r={0.2} color={i === 1 ? '#4BAA6B' : '#3F9A5F'} flat={false} />
          <Ball pos={[x + 0.07, 0.8, 0.02]} r={0.13} color="#58B678" flat={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- RAK BUKU BERISI ----------------------------------------------------------------

type BukuRak = { x: number; w: number; h: number; c: string; judul: string; map: boolean };

function susunBuku(judul: string[], seed: number, map: boolean, maxW: number, tipis = false): BukuRak[] {
  const r = mulberry32(seed);
  const pal = map
    ? ['#2F5D8A', '#7A2E3B', '#2F6B4F', '#8A5A1F', '#3E4A66', '#4C3A7A', '#1F6F78']
    : ['#E0713F', '#4C5FA8', '#2F7D5B', '#B8862B', '#B05A7A', '#3E4A66', '#C9453B', '#5F8F4B', '#8A5A3C', '#1F6F78'];
  const out: BukuRak[] = [];
  let x = 0;
  for (const t of judul) {
    const w = tipis ? 0.046 + r() * 0.004 : map ? 0.07 + r() * 0.018 : Math.min(0.105, 0.05 + t.length * 0.0027 + r() * 0.012);
    if (x + w > maxW) break;
    const h = map ? 0.33 + r() * 0.05 : 0.27 + r() * 0.12;
    out.push({ x: x + w / 2, w, h, c: pal[Math.floor(r() * pal.length)], judul: t, map });
    x += w + 0.004;
  }
  return out;
}

// [map, judul[]] per tingkat rak (0 = bawah ... 3 = atas); 3 tema: akuntansi & pajak, manajemen & hukum, SDM & data.
const RAK_ISI: { map: boolean; tipis?: boolean; judul: string[] }[][] = [
  [
    { map: true, judul: ['ARSIP 2023', 'ARSIP 2024', 'ARSIP 2025', 'LAP. TAHUNAN', 'NOTULEN', 'SPT BADAN', 'AUDIT 2025', 'NERACA', 'PAJAK'] },
    { map: false, judul: ['PSAK 2026', 'Akuntansi Keuangan', 'Akuntansi Biaya', 'Audit Internal', 'Perpajakan', 'Analisis Lap. Keuangan', 'Sistem Info Akuntansi', 'IFRS Dasar', 'Pengantar Akuntansi'] },
    { map: false, judul: ['UU Pajak', 'PPh Badan', 'PPN & PPnBM', 'Bea Meterai', 'Transfer Pricing', 'Tax Planning', 'Pajak Daerah', 'Akuntansi Pajak', 'KUP'] },
    { map: true, tipis: true, judul: ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'] },
  ],
  [
    { map: true, judul: ['KONTRAK A-M', 'KONTRAK N-Z', 'NDA', 'MoU', 'AKTA', 'NIB / OSS', 'SIUP', 'TDP', 'LEGAL'] },
    { map: false, judul: ['Manajemen Strategis', 'Good Corp. Governance', 'Manajemen Risiko', 'Kepemimpinan', 'Hukum Bisnis', 'Etika Bisnis', 'Balanced Scorecard', 'OKR & KPI', 'Manajemen Keuangan'] },
    { map: false, judul: ['Hukum Perseroan', 'UU PT', 'UU Ketenagakerjaan', 'Hukum Kontrak', 'Kepatuhan', 'Anti Fraud', 'Whistleblowing', 'Tata Kelola', 'Compliance'] },
    { map: true, tipis: true, judul: ['SOP 01', 'SOP 02', 'SOP 03', 'SOP 04', 'SOP 05', 'SOP 06', 'SOP 07', 'SOP 08', 'KEBIJAKAN', 'PERATURAN'] },
  ],
  [
    { map: true, judul: ['KLIEN 01', 'KLIEN 02', 'KLIEN 03', 'KLIEN 04', 'KLIEN 05', 'KLIEN 06', 'ONBOARD', 'ADDENDUM'] },
    { map: false, judul: ['Manajemen SDM', 'PPh 21 Praktis', 'Penggajian', 'BPJS & Jamsos', 'Rekrutmen', 'Penilaian Kinerja', 'Budaya Kerja', 'Pelatihan', 'Motivasi'] },
    { map: false, judul: ['Excel Keuangan', 'Dashboard & BI', 'Data Analytics', 'Python Dasar', 'SQL Praktis', 'Otomasi Kerja', 'AI untuk Bisnis', 'Machine Learning', 'Big Data'] },
    { map: true, tipis: true, judul: ['GAJI JAN', 'GAJI FEB', 'GAJI MAR', 'GAJI APR', 'GAJI MEI', 'GAJI JUN', 'GAJI JUL', 'GAJI AGU', 'GAJI SEP', 'GAJI OKT'] },
  ],
];

const RAK_S = 640; // piksel per meter pada tekstur judul buku

// Satu tingkat rak: buku bervolume (kotak) + tulisan punggung buku (tekstur transparan di depannya).
function TingkatBuku({ isi, level, seed, maxW, y0 }: { isi: number; level: number; seed: number; maxW: number; y0: number }) {
  const spec = RAK_ISI[isi % RAK_ISI.length][level];
  const buku = useMemo(() => susunBuku(spec.judul, seed, spec.map, maxW, spec.tipis), [spec, seed, maxW]);
  const cw = Math.round(maxW * RAK_S);
  const ch = Math.round(0.42 * RAK_S);
  const tex = useKanvasMg(cw, ch, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    buku.forEach((b) => {
      const px = (b.x - b.w / 2) * RAK_S, bw = b.w * RAK_S, bh = b.h * RAK_S;
      const top = H - bh;
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(px, top, bw, 4);
      g.fillRect(px, H - 5, bw, 5);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(px + 2, top + 4, 2, bh - 9);
      const col = new THREE.Color(b.c);
      const terang = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b > 0.45;
      if (b.map) {
        // map arsip: label putih di punggung
        g.fillStyle = '#F8FAFC';
        const lh = bh * 0.62;
        g.fillRect(px + bw * 0.12, top + bh * 0.18, bw * 0.76, lh);
        g.save();
        g.translate(px + bw / 2, top + bh * 0.18 + lh / 2);
        g.rotate(-Math.PI / 2);
        g.fillStyle = '#111827';
        fitMg(g, b.judul, lh * 0.9, Math.min(bw * 0.5, 22), '800');
        g.fillText(b.judul, 0, 0);
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.arc(px + bw / 2, top + bh * 0.1, 3.5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = 'rgba(232,201,90,0.9)';
        g.fillRect(px, top + 12, bw, 3);
        g.fillRect(px, H - 18, bw, 3);
        g.save();
        g.translate(px + bw / 2, top + bh / 2);
        g.rotate(-Math.PI / 2);
        g.fillStyle = terang ? '#111827' : '#FFFFFF';
        fitMg(g, b.judul, bh * 0.78, Math.min(bw * 0.46, 21), '700');
        g.fillText(b.judul, 0, 0);
        g.restore();
      }
    });
  }, `mg-rak-${isi}-${level}-${seed}-${maxW}`);
  return (
    <group position={[-0.72, y0, 0]}>
      {buku.map((b, i) => (
        <Box key={i} pos={[b.x, b.h / 2, 0]} size={[b.w, b.h, 0.26]} color={b.c} cast={false} />
      ))}
      <BidangMg pos={[maxW / 2, 0.21, 0.1315]} w={maxW} h={0.42} tex={tex} alpha />
    </group>
  );
}

function BingkaiFoto({ pos, rotY = 0, w = 0.2, h = 0.26, warna = '#A7F3D0' }: { pos: V3; rotY?: number; w?: number; h?: number; warna?: string }) {
  return (
    <group position={pos} rotation={[-0.12, rotY, 0]}>
      <Box pos={[0, h / 2, 0]} size={[w, h, 0.025]} color="#5B4630" cast={false} />
      <Box pos={[0, h / 2, 0.014]} size={[w - 0.04, h - 0.04, 0.006]} color={warna} cast={false} />
      <Box pos={[-w * 0.12, h * 0.4, 0.019]} size={[w * 0.28, h * 0.28, 0.004]} color="#2F7D5B" cast={false} />
      <Box pos={[w * 0.15, h * 0.58, 0.019]} size={[w * 0.2, h * 0.2, 0.004]} color="#F59E0B" cast={false} />
    </group>
  );
}

function BoxFile({ pos, warna, judul, rotY = 0 }: { pos: V3; warna: string; judul: string; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.15, 0]} size={[0.12, 0.3, 0.26]} color={warna} cast={false} />
      <Box pos={[0.061, 0.15, 0]} size={[0.004, 0.3, 0.25]} color="#F8FAFC" cast={false} />
      <Box pos={[0, 0.2, 0.131]} size={[0.09, 0.14, 0.004]} color="#F8FAFC" cast={false} />
      <Teks pos={[0, 0.2, 0.1335]} w={0.085} h={0.045} text={judul} fg="#111827" />
    </group>
  );
}

// Rak buku putih: isi buku BERJUDUL (akuntansi, pajak, hukum, SDM, data) + map arsip berlabel + pajangan.
function RakBukuDetail({ pos, isi = 0, seed = 0 }: { pos: V3; isi?: number; seed?: number }) {
  const sd = isi * 11 + seed;
  const dasar = [0.06, 0.52, 0.98, 1.44];
  return (
    <group position={pos}>
      <Box pos={[-0.77, 0.94, 0]} size={[0.06, 1.88, 0.4]} color="#F8F9FB" />
      <Box pos={[0.77, 0.94, 0]} size={[0.06, 1.88, 0.4]} color="#F8F9FB" />
      <Box pos={[0, 0.94, -0.18]} size={[1.6, 1.88, 0.03]} color="#DCE3E8" />
      <Box pos={[0, 0.02, 0.0]} size={[1.64, 0.04, 0.42]} color="#C5CDD6" cast={false} />
      {[0.04, 0.5, 0.96, 1.42, 1.86].map((y) => (
        <React.Fragment key={y}>
          <Box pos={[0, y, 0]} size={[1.6, 0.04, 0.4]} color="#FFFFFF" />
          {y > 0.05 && <Box pos={[0, y - 0.005, 0.2]} size={[1.6, 0.025, 0.006]} color="#4C8FBF" cast={false} />}
        </React.Fragment>
      ))}
      <TingkatBuku isi={isi} level={0} seed={sd + 1} maxW={1.44} y0={dasar[0]} />
      <TingkatBuku isi={isi} level={1} seed={sd + 2} maxW={0.9} y0={dasar[1]} />
      <TingkatBuku isi={isi} level={2} seed={sd + 3} maxW={0.9} y0={dasar[2]} />
      <TingkatBuku isi={isi} level={3} seed={sd + 4} maxW={1.44} y0={dasar[3]} />
      {/* pajangan rak 2 */}
      {isi % 3 === 0 && (
        <>
          <GlobeMeja pos={[0.35, dasar[1], 0]} />
          <BingkaiFoto pos={[0.6, dasar[1], 0.02]} rotY={-0.2} />
        </>
      )}
      {isi % 3 === 1 && (
        <>
          <Piala pos={[0.3, dasar[1], 0]} />
          <BingkaiFoto pos={[0.58, dasar[1], 0.02]} rotY={-0.15} warna="#BFDBFE" />
        </>
      )}
      {isi % 3 === 2 && (
        <>
          <Succulent pos={[0.3, dasar[1], 0]} scale={0.9} />
          <BingkaiFoto pos={[0.58, dasar[1], 0.02]} rotY={-0.2} warna="#FDE68A" />
        </>
      )}
      {/* pajangan rak 3 */}
      <Piala pos={[0.32, dasar[2], 0]} />
      <Piala pos={[0.55, dasar[2], 0.02]} />
      <Box pos={[0.12, dasar[2] + 0.03, 0.02]} size={[0.14, 0.06, 0.12]} color="#F3F4F6" cast={false} />
      {/* atas rak */}
      <Succulent pos={[-0.5, 1.88, 0]} scale={0.8} />
      <BoxFile pos={[-0.12, 1.88, 0]} warna="#3E4A66" judul="ARSIP" />
      <BoxFile pos={[0.04, 1.88, 0]} warna="#C9453B" judul="URGENT" />
      <BoxFile pos={[0.2, 1.88, 0]} warna="#2F7D5B" judul="LUNAS" />
      <Box pos={[0.55, 1.93, 0]} size={[0.3, 0.1, 0.25]} color="#3E4A66" cast={false} />
      <Box pos={[0.55, 2.02, 0]} size={[0.26, 0.08, 0.22]} color="#E0713F" cast={false} />
    </group>
  );
}

// ---------------------------------------------------------------- LEMARI ----------------------------------------------------------------

const ARSIP_LABEL: [string, string][][] = [
  [['KONTRAK KLIEN', 'A – M'], ['LAPORAN KEUANGAN', '2023 – 2025'], ['PAJAK & NPWP', 'SPT · PPN · PPh'], ['LEGAL & PERIZINAN', 'NIB · SIUP · AKTA']],
  [['PAYROLL & SDM', 'SLIP GAJI 2026'], ['AUDIT', 'INTERNAL · EKSTERNAL'], ['ASET & INVENTARIS', 'DAFTAR ASET TETAP'], ['NOTULEN RAPAT', 'DIREKSI 2026']],
  [['BANK & KAS', 'REKENING KORAN'], ['FAKTUR PENJUALAN', 'JAN – DES 2026'], ['FAKTUR PEMBELIAN', 'JAN – DES 2026'], ['ARSIP LAMA', 'SEBELUM 2023']],
];

// Lemari arsip baja 4 laci: tiap laci punya kartu label berisi judul + keterangan, gagang, lubang kunci; di atasnya box file / piala.
function LemariArsipMg({ pos, rotY = 0, isi = 0, warna = '#B7C3D2', atas = 'berkas' }: { pos: V3; rotY?: number; isi?: number; warna?: string; atas?: 'berkas' | 'piala' }) {
  const lab = ARSIP_LABEL[isi % ARSIP_LABEL.length];
  const tex = useKanvasMg(440, 520, (g, W, H) => {
    g.fillStyle = warna;
    g.fillRect(0, 0, W, H);
    const dh = H / 4;
    lab.forEach(([t, sub], i) => {
      const y = i * dh;
      g.fillStyle = lighten(warna, -0.04);
      rrMg(g, 10, y + 8, W - 20, dh - 16, 8);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(16, y + 11, W - 32, 3);
      g.fillStyle = '#FFFFFF';
      rrMg(g, W / 2 - 150, y + 20, 300, 64, 6);
      g.fill();
      g.strokeStyle = '#8FA3B3';
      g.lineWidth = 3;
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#1F2937';
      fitMg(g, t, 270, 27, '800');
      g.fillText(t, W / 2, y + 43);
      g.fillStyle = '#475569';
      fitMg(g, sub, 270, 18, '600');
      g.fillText(sub, W / 2, y + 68);
      g.fillStyle = '#6B7280';
      g.beginPath();
      g.arc(W - 40, y + dh / 2 + 10, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#374151';
      g.fillRect(W - 42, y + dh / 2 + 10, 4, 12);
      g.fillStyle = '#6B7280';
      g.font = `700 16px ${MGF}`;
      g.textAlign = 'left';
      g.fillText(`${i + 1}`, 28, y + dh / 2 + 10);
    });
  }, `mg-arsip-${isi}-${warna}`);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.7, 0]} size={[1.2, 1.4, 0.5]} color={warna} />
      <BidangMg pos={[0, 0.7, 0.2515]} w={1.1} h={1.3} tex={tex} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} pos={[0, 1.35 - (i + 0.5) * 0.325 - 0.1, 0.268]} size={[0.34, 0.028, 0.03]} color="#7B8794" cast={false} />
      ))}
      <Box pos={[0, 0.03, 0.01]} size={[1.2, 0.06, 0.52]} color="#6B7280" cast={false} />
      <Box pos={[0, 1.415, 0]} size={[1.24, 0.03, 0.54]} color="#9AA8B8" />
      {atas === 'piala' ? (
        <>
          <Piala pos={[-0.35, 1.43, 0]} />
          <Piala pos={[0.0, 1.43, 0]} />
          <Succulent pos={[0.38, 1.43, 0]} scale={0.9} />
        </>
      ) : (
        <>
          <BoxFile pos={[-0.4, 1.43, 0]} warna="#3E4A66" judul="PAJAK" />
          <BoxFile pos={[-0.24, 1.43, 0]} warna="#2F5D8A" judul="BANK" />
          <BoxFile pos={[-0.08, 1.43, 0]} warna="#C9453B" judul="URGENT" />
          <Box pos={[0.3, 1.5, 0]} size={[0.3, 0.14, 0.26]} color="#E0E7EE" cast={false} />
          <Box pos={[0.3, 1.58, 0]} size={[0.28, 0.02, 0.24]} color="#FDE68A" cast={false} />
        </>
      )}
    </group>
  );
}

function TrofiBesar({ pos, s = 1 }: { pos: V3; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <Box pos={[0, 0.025, 0]} size={[0.16, 0.05, 0.16]} color="#3B2A18" cast={false} />
      <Box pos={[0, 0.06, 0]} size={[0.12, 0.02, 0.12]} color="#5B4630" cast={false} />
      <Tube pos={[0, 0.12, 0]} r={0.014} h={0.1} color={EMAS} seg={8} cast={false} />
      <Tube pos={[0, 0.16, 0]} r={0.035} rb={0.02} h={0.04} color={EMAS} seg={14} cast={false} />
      <Tube pos={[0, 0.235, 0]} r={0.085} rb={0.04} h={0.12} color={EMAS} seg={16} cast={false} />
      {[-1, 1].map((sd) => (
        <Tube key={sd} pos={[sd * 0.1, 0.24, 0]} r={0.022} h={0.02} color={EMAS} rot={[0, 0, Math.PI / 2]} seg={10} cast={false} />
      ))}
      <Box pos={[0, 0.04, 0.082]} size={[0.08, 0.025, 0.004]} color="#F8F2D0" cast={false} />
    </group>
  );
}

function Plakat({ pos, judul, sub }: { pos: V3; judul: string; sub: string }) {
  return (
    <group position={pos} rotation={[-0.18, 0, 0]}>
      <Box pos={[0, 0.11, 0]} size={[0.3, 0.22, 0.03]} color="#4A3320" cast={false} />
      <Box pos={[0, 0.11, 0.017]} size={[0.26, 0.18, 0.006]} color="#7A5A38" cast={false} />
      <Box pos={[0, 0.14, 0.022]} size={[0.22, 0.07, 0.004]} color="#D9B25B" cast={false} />
      <Teks pos={[0, 0.14, 0.0245]} w={0.21} h={0.06} text={judul} fg="#3B2A12" />
      <Teks pos={[0, 0.07, 0.0245]} w={0.12} h={0.035} text={sub} fg="#F8E7B0" />
    </group>
  );
}

function SertifikatKecil({ pos, judul }: { pos: V3; judul: string }) {
  return (
    <group position={pos} rotation={[-0.2, 0, 0]}>
      <Box pos={[0, 0.12, 0]} size={[0.32, 0.24, 0.02]} color="#D9B25B" cast={false} />
      <Box pos={[0, 0.12, 0.012]} size={[0.29, 0.21, 0.004]} color="#FBF4E1" cast={false} />
      <Teks pos={[0, 0.17, 0.0145]} w={0.24} h={0.04} text="SERTIFIKAT" fg="#6B4A12" />
      <Teks pos={[0, 0.115, 0.0145]} w={0.26} h={0.04} text={judul} fg="#111827" />
      <Box pos={[0, 0.07, 0.0145]} size={[0.16, 0.004, 0.002]} color="#B8962E" cast={false} />
      <Ball pos={[0.1, 0.05, 0.016]} r={0.025} color="#C9453B" flat={false} />
    </group>
  );
}

// Etalase kaca penghargaan (menggantikan meja direksi di dinding timur): trofi, plakat, sertifikat, globe, buku.
function EtalaseKaca({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const kayu = '#6B4A2F';
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.95, -0.2]} size={[1.6, 1.9, 0.04]} color={kayu} />
      {[-0.775, 0.775].map((x) => (
        <Box key={x} pos={[x, 0.95, 0]} size={[0.05, 1.9, 0.45]} color={kayu} />
      ))}
      <Box pos={[0, 1.93, 0]} size={[1.7, 0.06, 0.52]} color="#5B3F28" />
      <Box pos={[0, 0.38, 0.0]} size={[1.5, 0.76, 0.44]} color="#7D5A3A" />
      {[-0.375, 0.375].map((x) => (
        <React.Fragment key={x}>
          <Box pos={[x, 0.38, 0.225]} size={[0.7, 0.66, 0.02]} color="#8A6544" cast={false} />
          <Box pos={[x, 0.38, 0.237]} size={[0.58, 0.54, 0.008]} color="#7D5A3A" cast={false} />
          <Box pos={[x + (x < 0 ? 0.3 : -0.3), 0.45, 0.255]} size={[0.025, 0.16, 0.03]} color="#D9B25B" cast={false} />
        </React.Fragment>
      ))}
      <mesh position={[0, 1.33, 0.2]}>
        <boxGeometry args={[1.5, 1.15, 0.015]} />
        <meshLambertMaterial color="#CDE8F2" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <Box pos={[0, 1.33, 0.205]} size={[0.03, 1.15, 0.04]} color="#5B3F28" cast={false} />
      <Box pos={[0.02, 1.2, 0.228]} size={[0.012, 0.04, 0.012]} color="#D9B25B" cast={false} />
      {[0.77, 1.1, 1.4, 1.68].map((y) => (
        <Box key={y} pos={[0, y, 0]} size={[1.5, 0.018, 0.4]} color="#BFD9E2" cast={false} />
      ))}
      {/* rak 1: trofi */}
      <TrofiBesar pos={[-0.55, 0.779, 0]} s={1.0} />
      <TrofiBesar pos={[-0.15, 0.779, 0]} s={1.1} />
      <Plakat pos={[0.35, 0.779, 0.05]} judul="CLIENT CHOICE" sub="AWARD 2026" />
      <TrofiBesar pos={[0.62, 0.779, 0]} s={0.9} />
      {/* rak 2: plakat */}
      <Plakat pos={[-0.5, 1.109, 0.05]} judul="BEST FINANCE TEAM" sub="2026" />
      <Plakat pos={[0, 1.109, 0.05]} judul="EXCELLENCE REPORTING" sub="2025" />
      <Plakat pos={[0.5, 1.109, 0.05]} judul="ZERO AUDIT FINDING" sub="2025" />
      {/* rak 3: sertifikat + globe */}
      <SertifikatKecil pos={[-0.5, 1.409, 0.05]} judul="ISO 9001:2015" />
      <SertifikatKecil pos={[-0.1, 1.409, 0.05]} judul="ISO 27001" />
      <GlobeMeja pos={[0.4, 1.409, 0]} />
      <BingkaiFoto pos={[0.65, 1.409, 0.02]} rotY={-0.2} warna="#FDE68A" />
      {/* rak 4: buku & trofi kecil */}
      <BoxFile pos={[-0.62, 1.689, 0]} warna="#2F5D8A" judul="LAP 25" />
      <BoxFile pos={[-0.47, 1.689, 0]} warna="#7A2E3B" judul="LAP 24" />
      <TrofiBesar pos={[0.0, 1.689, 0]} s={0.7} />
      <TrofiBesar pos={[0.3, 1.689, 0]} s={0.7} />
      <Succulent pos={[0.62, 1.689, 0]} scale={0.7} />
      {/* papan nama atas */}
      <Box pos={[0, 2.03, 0.27]} size={[1.5, 0.12, 0.02]} color="#2B2118" cast={false} />
      <Teks pos={[0, 2.03, 0.282]} w={1.36} h={0.08} text="PENGHARGAAN & SERTIFIKASI" fg="#F5C84C" />
    </group>
  );
}

// ---------------------------------------------------------------- PAPAN & PIGURA BERISI ----------------------------------------------------------------

const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Papan tulis putih dinding: AGENDA RAPAT DIREKSI (tanggal hari ini), daftar tugas berceklis, grafik pendapatan vs target, jadwal closing, sticky note.
function PapanAgenda({ pos }: { pos: V3 }) {
  const now = new Date();
  const kunci = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const tex = useKanvasMg(1520, 718, (g, W, H) => {
    g.fillStyle = '#FBFCFB';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.025)';
    for (let i = 0; i < 6; i++) g.fillRect(40 + i * 230, 30 + (i % 3) * 60, 180, 90);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    // judul
    g.fillStyle = '#1D4ED8';
    g.font = `800 56px ${MGF_TULIS}`;
    g.fillText('AGENDA RAPAT DIREKSI', 40, 52);
    g.strokeStyle = '#DC2626';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(40, 92);
    for (let x = 40; x < 760; x += 24) g.lineTo(x + 12, 92 + (((x / 24) | 0) % 2 ? 6 : -4));
    g.stroke();
    g.fillStyle = '#374151';
    g.font = `600 30px ${MGF_TULIS}`;
    g.fillText(`${HARI_ID[now.getDay()]}, ${now.getDate()} ${BULAN_ID[now.getMonth()]} ${now.getFullYear()}  ·  09.00 WIB`, 40, 128);
    // daftar tugas
    const tugas = ['Review laporan keuangan Oktober', 'Rekonsiliasi bank & kas', 'Persetujuan payroll + PPh 21', 'Tutup buku & Year-End Closing', 'Evaluasi kinerja 6 agen AI'];
    g.font = `600 34px ${MGF_TULIS}`;
    tugas.forEach((t, i) => {
      const y = 190 + i * 64;
      g.strokeStyle = '#111827';
      g.lineWidth = 3.5;
      g.strokeRect(44, y - 17, 34, 34);
      g.fillStyle = '#1F2937';
      g.fillText(`${i + 1}. ${t}`, 96, y);
      if (i < 2) {
        g.strokeStyle = '#15803D';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(50, y);
        g.lineTo(60, y + 12);
        g.lineTo(84, y - 20);
        g.stroke();
      }
    });
    // grafik pendapatan vs target
    const gx = 800, gy = 170, gw = 330, gh = 260;
    g.fillStyle = '#111827';
    g.font = `700 26px ${MGF_TULIS}`;
    g.fillText('Pendapatan vs Target (Rp juta)', gx - 10, gy - 22);
    g.strokeStyle = '#111827';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(gx, gy);
    g.lineTo(gx, gy + gh);
    g.lineTo(gx + gw, gy + gh);
    g.stroke();
    const data: [string, number, number][] = [['Q1', 820, 900], ['Q2', 940, 950], ['Q3', 1010, 1000], ['Q4*', 1100, 1150]];
    data.forEach(([q, real, tar], i) => {
      const bx = gx + 24 + i * 78;
      const hr = (real / 1200) * gh, ht = (tar / 1200) * gh;
      g.fillStyle = '#3B82F6';
      g.fillRect(bx, gy + gh - hr, 28, hr);
      g.fillStyle = '#F59E0B';
      g.fillRect(bx + 30, gy + gh - ht, 22, ht);
      g.fillStyle = '#111827';
      g.font = `700 20px ${MGF}`;
      g.textAlign = 'center';
      g.fillText(q, bx + 28, gy + gh + 22);
      g.font = `700 16px ${MGF}`;
      g.fillText(String(real), bx + 14, gy + gh - hr - 11);
    });
    g.textAlign = 'left';
    g.fillStyle = '#3B82F6';
    g.fillRect(gx + 20, gy + gh + 44, 18, 14);
    g.fillStyle = '#111827';
    g.font = `600 20px ${MGF}`;
    g.fillText('Realisasi', gx + 44, gy + gh + 52);
    g.fillStyle = '#F59E0B';
    g.fillRect(gx + 150, gy + gh + 44, 18, 14);
    g.fillStyle = '#111827';
    g.fillText('Target   (*proyeksi)', gx + 174, gy + gh + 52);
    // jadwal closing (gantt)
    const jx = 1180, jy = 170;
    g.fillStyle = '#111827';
    g.font = `700 26px ${MGF_TULIS}`;
    g.fillText('Jadwal Closing', jx, jy - 22);
    ['Nov', 'Des'].forEach((b, i) => {
      g.fillStyle = '#6B7280';
      g.font = `700 20px ${MGF}`;
      g.fillText(b, jx + 80 + i * 130, jy + 6);
    });
    const gantt: [string, number, number, string][] = [['Rekon', 0, 80, '#3B82F6'], ['Audit', 60, 130, '#10B981'], ['Pajak', 120, 90, '#F59E0B'], ['Closing', 180, 80, '#EF4444']];
    gantt.forEach(([n, x0, ww, c], i) => {
      const y = jy + 44 + i * 58;
      g.fillStyle = '#111827';
      g.font = `600 20px ${MGF}`;
      g.fillText(n, jx, y);
      g.fillStyle = c;
      rrMg(g, jx + 80 + x0, y - 14, ww, 28, 6);
      g.fill();
    });
    // sticky notes
    const notes: [number, number, string, string, number][] = [
      [780, 520, '#FDE68A', 'Cek faktur jatuh tempo!', -0.05],
      [1000, 535, '#FBCFE8', 'Kirim laporan ke klien Jumat', 0.04],
      [1220, 520, '#A7F3D0', 'Backup database sebelum closing', -0.03],
    ];
    notes.forEach(([x, y, c, t, rot]) => {
      g.save();
      g.translate(x + 85, y + 80);
      g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(-84, -76, 176, 164);
      g.fillStyle = c;
      g.fillRect(-88, -80, 176, 160);
      g.fillStyle = '#1F2937';
      g.font = `600 26px ${MGF_TULIS}`;
      g.textAlign = 'center';
      bungkusMg(g, t, 0, -36, 150, 32);
      g.restore();
    });
    // lingkaran deadline
    g.strokeStyle = '#DC2626';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(250, 596, 200, 60, -0.04, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#DC2626';
    g.font = `800 44px ${MGF_TULIS}`;
    g.textAlign = 'center';
    g.fillText('DEADLINE 30 NOV!', 250, 598);
    g.textAlign = 'left';
  }, `mg-agenda-${kunci}`);
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[1.9, 0.95, 0.05]} color="#B8C4BE" cast={false} />
      <BidangMg pos={[0, 0.005, 0.0265]} w={1.8} h={0.85} tex={tex} />
      <Box pos={[0, -0.5, 0.06]} size={[1.2, 0.03, 0.09]} color="#B8C4BE" cast={false} />
      {[['#DC2626', -0.3], ['#2563EB', -0.15], ['#15803D', 0.0], ['#111827', 0.15]].map(([c, x]) => (
        <Box key={String(x)} pos={[x as number, -0.47, 0.07]} size={[0.12, 0.02, 0.02]} color={c as string} cast={false} />
      ))}
      <Box pos={[0.38, -0.475, 0.07]} size={[0.14, 0.03, 0.05]} color="#4B5563" cast={false} />
    </group>
  );
}

// Papan berdiri roda/kaki: STRUKTUR TIM MANAGEMENT — 6 agen AI beserta halaman yang ditangani (dari daftar halaman Management).
function PapanOrganisasi({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tim = HALAMAN_MG_DUDUK.map((h, i) => ({ ai: MG_PET[i] ?? '-', nama: h.nama, href: h.href, warna: h.warna }));
  const tex = useKanvasMg(1360, 680, (g, W, H) => {
    g.fillStyle = '#FBFCFB';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1E3556';
    g.fillRect(0, 0, W, 96);
    g.fillStyle = '#F5C84C';
    g.fillRect(0, 96, W, 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#FFFFFF';
    g.font = `800 52px ${MGF}`;
    g.fillText('STRUKTUR TIM MANAGEMENT', W / 2, 50);
    // kotak direksi
    g.fillStyle = '#1E3556';
    rrMg(g, W / 2 - 230, 140, 460, 90, 14);
    g.fill();
    g.fillStyle = '#F5C84C';
    g.font = `800 38px ${MGF}`;
    g.fillText('DIREKSI', W / 2, 172);
    g.fillStyle = '#C9D8EE';
    g.font = `600 24px ${MGF}`;
    g.fillText('Rapat setiap Senin · 09.00', W / 2, 206);
    // garis penghubung
    g.strokeStyle = '#475569';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(W / 2, 230);
    g.lineTo(W / 2, 280);
    g.moveTo(130, 280);
    g.lineTo(W - 130, 280);
    g.stroke();
    const bw = 196, gap = 12;
    const x0 = (W - (6 * bw + 5 * gap)) / 2;
    tim.forEach((t, i) => {
      const x = x0 + i * (bw + gap);
      g.strokeStyle = '#475569';
      g.beginPath();
      g.moveTo(x + bw / 2, 280);
      g.lineTo(x + bw / 2, 320);
      g.stroke();
      g.fillStyle = '#FFFFFF';
      rrMg(g, x, 320, bw, 250, 12);
      g.fill();
      g.strokeStyle = t.warna;
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = t.warna;
      g.fillRect(x + 4, 324, bw - 8, 54);
      g.fillStyle = '#FFFFFF';
      fitMg(g, t.ai, bw - 24, 36, '800');
      g.fillText(t.ai, x + bw / 2, 352);
      g.fillStyle = '#111827';
      fitMg(g, t.nama, bw - 20, 28, '800');
      g.fillText(t.nama, x + bw / 2, 420);
      g.fillStyle = '#64748B';
      fitMg(g, t.href, bw - 24, 24, '600');
      g.fillText(t.href, x + bw / 2, 462);
      g.fillStyle = '#16A34A';
      g.beginPath();
      g.arc(x + 34, 524, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#334155';
      g.textAlign = 'left';
      g.font = `600 22px ${MGF}`;
      g.fillText('Aktif', x + 52, 524);
      g.textAlign = 'center';
    });
    g.fillStyle = '#64748B';
    g.font = `600 24px ${MGF}`;
    g.fillText('Jam kerja 08.00 – 17.00 WIB   ·   Eskalasi ke Direksi bila ada selisih > Rp 10 juta', W / 2, 618);
  }, 'mg-organisasi');
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 1.3, 0]} size={[1.8, 0.95, 0.05]} color="#B8C4BE" cast={false} />
      <BidangMg pos={[0, 1.3, 0.0265]} w={1.7} h={0.85} tex={tex} />
      <Box pos={[0, 0.82, 0.06]} size={[1.2, 0.03, 0.09]} color="#B8C4BE" cast={false} />
      {[-0.8, 0.8].map((x) => (
        <React.Fragment key={x}>
          <Box pos={[x, 0.6, -0.04]} size={[0.05, 1.2, 0.05]} color="#6B7280" />
          <Box pos={[x, 0.03, 0]} size={[0.08, 0.06, 0.5]} color="#4B5563" cast={false} />
        </React.Fragment>
      ))}
    </group>
  );
}

// Papan gabus pengumuman dengan kertas berisi tulisan (menempel di dinding; +z lokal = ke dalam ruangan).
function PapanGabusMg({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tex = useKanvasMg(800, 560, (g, W, H) => {
    const r = mulberry32(99);
    g.fillStyle = '#C9A26B';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,80,40,0.22)' : 'rgba(255,230,180,0.25)';
      g.fillRect(r() * W, r() * H, 2 + r() * 4, 2 + r() * 3);
    }
    const lembar: { x: number; y: number; w: number; h: number; c: string; rot: number; judul: string; isi: string }[] = [
      { x: 30, y: 28, w: 270, h: 230, c: '#FFFFFF', rot: -0.03, judul: 'PENGUMUMAN', isi: 'Tutup buku bulanan paling lambat tanggal 5 setiap bulan. Mohon semua bukti kas dilampirkan.' },
      { x: 330, y: 40, w: 220, h: 190, c: '#FDE68A', rot: 0.04, judul: 'REMINDER', isi: 'PPN & PPh disetor sebelum tanggal 10. Lapor SPT Masa sebelum tanggal 20.' },
      { x: 580, y: 24, w: 190, h: 250, c: '#BFDBFE', rot: -0.02, judul: 'JADWAL PIKET', isi: 'Sen: Tensor · Sel: Vector · Rab: Orion · Kam: Theta · Jum: Kappa · Sab: Omega' },
      { x: 40, y: 300, w: 230, h: 220, c: '#FBCFE8', rot: 0.03, judul: 'LIBUR NASIONAL', isi: '25 Des — Natal. 31 Des cuti bersama. Kantor buka kembali 2 Jan.' },
      { x: 310, y: 280, w: 240, h: 240, c: '#A7F3D0', rot: -0.04, judul: 'TARGET BULAN INI', isi: 'Piutang tertagih 95%. Rekonsiliasi bank selesai H+3. Zero selisih kas.' },
      { x: 590, y: 310, w: 180, h: 200, c: '#FFFFFF', rot: 0.05, judul: 'MEMO', isi: 'Rapat direksi pindah ke ruang Management. Bawa laporan.' },
    ];
    lembar.forEach((l) => {
      g.save();
      g.translate(l.x + l.w / 2, l.y + l.h / 2);
      g.rotate(l.rot);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(-l.w / 2 + 5, -l.h / 2 + 6, l.w, l.h);
      g.fillStyle = l.c;
      g.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
      g.fillStyle = '#B91C1C';
      g.beginPath();
      g.arc(0, -l.h / 2 + 14, 8, 0, Math.PI * 2);
      g.fill();
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = '#111827';
      fitMg(g, l.judul, l.w - 24, 24, '800');
      g.fillText(l.judul, 0, -l.h / 2 + 32);
      g.fillStyle = '#374151';
      g.font = `500 19px ${MGF}`;
      bungkusMg(g, l.isi, 0, -l.h / 2 + 66, l.w - 30, 25);
      g.restore();
    });
  }, 'mg-gabus');
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[1.1, 0.8, 0.05]} color="#8B6B47" cast={false} />
      <BidangMg pos={[0, 0, 0.0265]} w={1.0} h={0.7} tex={tex} />
    </group>
  );
}

// Kalender dinding bulan berjalan (tanggal hari ini dilingkari merah; hari Minggu merah).
function KalenderDinding({ pos }: { pos: V3 }) {
  const now = new Date();
  const kunci = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const tex = useKanvasMg(400, 560, (g, W, H) => {
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, W, H);
    // gambar atas: langit + gunung
    const sk = g.createLinearGradient(0, 0, 0, 200);
    sk.addColorStop(0, '#7DD3FC');
    sk.addColorStop(1, '#E0F2FE');
    g.fillStyle = sk;
    g.fillRect(0, 0, W, 200);
    g.fillStyle = '#64748B';
    g.beginPath();
    g.moveTo(0, 200);
    g.lineTo(110, 70);
    g.lineTo(200, 160);
    g.lineTo(290, 50);
    g.lineTo(W, 190);
    g.lineTo(W, 200);
    g.closePath();
    g.fill();
    g.fillStyle = '#F8FAFC';
    g.beginPath();
    g.moveTo(290, 50);
    g.lineTo(262, 88);
    g.lineTo(290, 80);
    g.lineTo(312, 92);
    g.closePath();
    g.fill();
    g.fillStyle = '#16A34A';
    g.fillRect(0, 176, W, 24);
    // judul bulan
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#1E3556';
    g.font = `800 40px ${MGF}`;
    g.fillText(`${BULAN_ID[now.getMonth()].toUpperCase()} ${now.getFullYear()}`, W / 2, 238);
    const hari = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
    const cw = W / 7;
    hari.forEach((h, i) => {
      g.fillStyle = i === 6 ? '#DC2626' : '#475569';
      g.font = `800 20px ${MGF}`;
      g.fillText(h, cw * i + cw / 2, 282);
    });
    const awal = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const jml = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= jml; d++) {
      const idx = awal + d - 1;
      const cx = cw * (idx % 7) + cw / 2;
      const cy = 322 + Math.floor(idx / 7) * 42;
      if (d === now.getDate()) {
        g.strokeStyle = '#DC2626';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(cx, cy, 18, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = idx % 7 === 6 ? '#DC2626' : '#111827';
      g.font = `700 22px ${MGF}`;
      g.fillText(String(d), cx, cy);
    }
  }, `mg-kalender-${kunci}`);
  return (
    <group position={pos}>
      <Box pos={[0, 0, 0]} size={[0.5, 0.7, 0.025]} color="#E5E7EB" cast={false} />
      <BidangMg pos={[0, -0.005, 0.0135]} w={0.48} h={0.672} tex={tex} />
      <Box pos={[0, 0.355, 0.02]} size={[0.5, 0.025, 0.02]} color="#374151" cast={false} />
      {[-0.18, -0.09, 0, 0.09, 0.18].map((x) => (
        <Box key={x} pos={[x, 0.345, 0.025]} size={[0.012, 0.04, 0.012]} color="#9CA3AF" cast={false} />
      ))}
    </group>
  );
}

type JenisPigura = 'sertifikat' | 'nilai' | 'piagam' | 'denah';

// Pigura berisi dokumen bertulisan: sertifikat ISO, poster nilai perusahaan, piagam penghargaan, atau denah ruangan.
function PigiuraTeks({ pos, w, h, jenis, rotY = 0 }: { pos: V3; w: number; h: number; jenis: JenisPigura; rotY?: number }) {
  const px = 1024;
  const py = Math.round((px * (h - 0.1)) / (w - 0.1));
  const tex = useKanvasMg(px, py, (g, W, H) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (jenis === 'sertifikat' || jenis === 'piagam') {
      g.fillStyle = '#FBF4E1';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#B8962E';
      g.lineWidth = 14;
      g.strokeRect(22, 22, W - 44, H - 44);
      g.lineWidth = 4;
      g.strokeRect(46, 46, W - 92, H - 92);
      g.fillStyle = '#6B4A12';
      const sert = jenis === 'sertifikat';
      g.font = `700 ${H * 0.13}px ${MGF_SERIF}`;
      g.fillText(sert ? 'SERTIFIKAT' : 'PIAGAM PENGHARGAAN', W / 2, H * 0.2);
      g.fillStyle = '#B8962E';
      g.fillRect(W * 0.3, H * 0.29, W * 0.4, 5);
      g.fillStyle = '#374151';
      g.font = `italic 400 ${H * 0.065}px ${MGF_SERIF}`;
      g.fillText(sert ? 'Sistem Manajemen Mutu' : 'diberikan kepada', W / 2, H * 0.38);
      g.fillStyle = '#111827';
      g.font = `800 ${H * 0.13}px ${MGF_SERIF}`;
      g.fillText(sert ? 'ISO 9001:2015' : 'TIM KEUANGAN TERBAIK', W / 2, H * 0.52);
      g.fillStyle = '#374151';
      g.font = `400 ${H * 0.055}px ${MGF_SERIF}`;
      g.fillText(sert ? 'Penerapan standar mutu layanan akuntansi' : 'atas ketepatan laporan & nol temuan audit 2025', W / 2, H * 0.63);
      g.fillText(sert ? 'dan pelaporan keuangan klien' : 'Jakarta, 12 Desember 2025', W / 2, H * 0.7);
      g.fillStyle = '#C9453B';
      g.beginPath();
      g.arc(W * 0.18, H * 0.82, H * 0.07, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FDE68A';
      g.font = `800 ${H * 0.05}px ${MGF}`;
      g.fillText('ASLI', W * 0.18, H * 0.82);
      g.strokeStyle = '#111827';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W * 0.6, H * 0.84);
      g.lineTo(W * 0.85, H * 0.84);
      g.stroke();
      g.fillStyle = '#374151';
      g.font = `600 ${H * 0.045}px ${MGF}`;
      g.fillText('Direktur Utama', W * 0.725, H * 0.89);
    } else if (jenis === 'nilai') {
      g.fillStyle = '#1E3556';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#F5C84C';
      g.font = `800 ${H * 0.12}px ${MGF}`;
      g.fillText('NILAI KAMI', W / 2, H * 0.12);
      g.fillRect(W * 0.3, H * 0.2, W * 0.4, 5);
      const nilai: [string, string][] = [['INTEGRITAS', 'Jujur pada angka, terbuka pada klien'], ['AKURASI', 'Setiap rupiah tercatat & dapat ditelusuri'], ['KOLABORASI', 'Manusia & AI bekerja sebagai satu tim'], ['INOVASI', 'Otomasi untuk waktu yang lebih berharga']];
      nilai.forEach(([n, t], i) => {
        const y = H * (0.34 + i * 0.2);
        g.fillStyle = '#F5C84C';
        g.beginPath();
        g.arc(W * 0.12, y, H * 0.055, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1E3556';
        g.font = `800 ${H * 0.06}px ${MGF}`;
        g.fillText(String(i + 1), W * 0.12, y + 2);
        g.textAlign = 'left';
        g.fillStyle = '#FFFFFF';
        g.font = `800 ${H * 0.06}px ${MGF}`;
        g.fillText(n, W * 0.2, y - H * 0.032);
        g.fillStyle = '#C9D8EE';
        fitMg(g, t, W * 0.74, H * 0.042, '500');
        g.fillText(t, W * 0.2, y + H * 0.035);
        g.textAlign = 'center';
      });
    } else {
      // denah ruangan
      g.fillStyle = '#F3F4F6';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#1E3556';
      g.font = `800 ${H * 0.085}px ${MGF}`;
      g.fillText('DENAH RUANG MANAGEMENT', W / 2, H * 0.08);
      const rx = W * 0.06, ry = H * 0.17, rw = W * 0.88, rh = H * 0.68;
      g.fillStyle = '#E9F2EC';
      g.fillRect(rx, ry, rw, rh);
      g.strokeStyle = '#475569';
      g.lineWidth = 8;
      g.strokeRect(rx, ry, rw, rh);
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.arc(rx + rw / 2, ry + rh / 2, rh * 0.28, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#94A3B8';
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = '#1E3556';
      g.font = `700 ${H * 0.05}px ${MGF}`;
      g.fillText('MEJA RAPAT', rx + rw / 2, ry + rh / 2 - H * 0.02);
      g.fillStyle = '#64748B';
      g.font = `600 ${H * 0.04}px ${MGF}`;
      g.fillText('6 kursi', rx + rw / 2, ry + rh / 2 + H * 0.04);
      const tag = (t: string, x: number, y: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x - W * 0.07, y - H * 0.04, W * 0.14, H * 0.08);
        g.fillStyle = '#FFFFFF';
        g.font = `700 ${H * 0.036}px ${MGF}`;
        g.fillText(t, x, y);
      };
      tag('Sudut Tunggu', rx + rw * 0.14, ry + rh * 0.85, '#7C2A3A');
      tag('Sofa & Kopi', rx + rw * 0.86, ry + rh * 0.8, '#2F5D4F');
      tag('Arsip & Rak', rx + rw * 0.5, ry + rh * 0.09, '#475569');
      tag('Etalase', rx + rw * 0.92, ry + rh * 0.4, '#6B4A2F');
      g.fillStyle = '#DC2626';
      g.beginPath();
      g.arc(rx + rw / 2, ry + rh - 4, H * 0.025, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#DC2626';
      g.font = `800 ${H * 0.04}px ${MGF}`;
      g.fillText('ANDA DI SINI', rx + rw / 2, ry + rh + H * 0.07);
    }
  }, `mg-pigura-${jenis}-${w}-${h}`);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[w, h, 0.05]} color="#5B4630" cast={false} />
      <Box pos={[0, 0, 0.026]} size={[w - 0.06, h - 0.06, 0.004]} color="#F3EDE0" cast={false} />
      <BidangMg pos={[0, 0, 0.0295]} w={w - 0.1} h={h - 0.1} tex={tex} />
    </group>
  );
}

// Papan jadwal ruang rapat kecil di dekat pintu barat.
function JadwalRuang({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tex = useKanvasMg(440, 330, (g, W, H) => {
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1E3556';
    g.fillRect(0, 0, W, 64);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#FFFFFF';
    g.font = `800 28px ${MGF}`;
    g.fillText('RUANG RAPAT DIREKSI', 18, 34);
    g.fillStyle = '#DC2626';
    rrMg(g, W - 120, 78, 102, 34, 17);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = `800 20px ${MGF}`;
    g.textAlign = 'center';
    g.fillText('TERPAKAI', W - 69, 96);
    g.textAlign = 'left';
    g.fillStyle = '#334155';
    g.font = `700 21px ${MGF}`;
    g.fillText('Jadwal hari ini', 18, 96);
    const jd: [string, string][] = [['09.00', 'Rapat Direksi'], ['13.00', 'Review Laporan'], ['15.30', 'Evaluasi Agen AI']];
    jd.forEach(([j, t], i) => {
      const y = 150 + i * 56;
      g.fillStyle = '#EFF6FF';
      g.fillRect(14, y - 22, W - 28, 46);
      g.fillStyle = '#1D4ED8';
      g.font = `800 24px ${MGF}`;
      g.fillText(j, 24, y);
      g.fillStyle = '#111827';
      g.font = `600 24px ${MGF}`;
      g.fillText(t, 120, y);
    });
  }, 'mg-jadwal-ruang');
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[0.6, 0.46, 0.03]} color="#2E3238" cast={false} />
      <BidangMg pos={[0, 0, 0.0165]} w={0.56} h={0.42} tex={tex} />
    </group>
  );
}

// Roll-up banner VISI & MISI (berdiri di lantai).
function RollUpBanner({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tex = useKanvasMg(380, 900, (g, W, H) => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1E3556');
    bg.addColorStop(1, '#2F5D8A');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#F5C84C';
    g.fillRect(0, 150, W, 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#FFFFFF';
    g.font = `800 56px ${MGF}`;
    g.fillText('VISI & MISI', W / 2, 90);
    g.fillStyle = '#F5C84C';
    g.font = `800 36px ${MGF}`;
    g.fillText('VISI', W / 2, 208);
    g.fillStyle = '#E2E8F0';
    g.font = `500 26px ${MGF}`;
    bungkusMg(g, 'Menjadi mitra keuangan paling tepercaya yang memadukan keahlian manusia dan kecerdasan buatan.', W / 2, 252, W - 60, 34);
    g.fillStyle = '#F5C84C';
    g.font = `800 36px ${MGF}`;
    g.fillText('MISI', W / 2, 482);
    g.fillStyle = '#E2E8F0';
    g.font = `500 25px ${MGF}`;
    ['1. Laporan akurat & tepat waktu', '2. Otomasi proses akuntansi', '3. Kepatuhan pajak terjaga', '4. Layanan yang transparan'].forEach((t, i) => {
      g.fillText(t, W / 2, 536 + i * 52);
    });
    g.fillStyle = '#F5C84C';
    g.fillRect(40, 800, W - 80, 4);
    g.fillStyle = '#FFFFFF';
    g.font = `700 24px ${MGF}`;
    g.fillText('Integritas · Akurasi', W / 2, 836);
    g.fillText('Kolaborasi · Inovasi', W / 2, 868);
  }, 'mg-rollup');
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.035, 0]} size={[0.8, 0.07, 0.14]} color="#9CA3AF" />
      <Box pos={[0, 0.075, 0.04]} size={[0.8, 0.02, 0.05]} color="#6B7280" cast={false} />
      <BidangMg pos={[0, 1.0, 0.0]} w={0.76} h={1.8} tex={tex} />
      <Box pos={[0, 1.91, 0]} size={[0.8, 0.035, 0.03]} color="#9CA3AF" cast={false} />
      <Box pos={[0, 0.1, 0]} size={[0.012, 0.06, 0.012]} color="#6B7280" cast={false} />
    </group>
  );
}

// Papan direktori ruangan (rambu berdiri bertiang) — menunjukkan seluruh ruangan di gedung & posisi "Anda di sini".
function PapanDirektori({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const tex = useKanvasMg(520, 640, (g, W, H) => {
    g.fillStyle = '#F8FAFC';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1E3556';
    g.fillRect(0, 0, W, 86);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#FFFFFF';
    g.font = `800 40px ${MGF}`;
    g.fillText('DIREKTORI GEDUNG', W / 2, 44);
    const daftar = ['Transactions', 'Account Receivable', 'Account Payable', 'Perpustakaan', 'Santai', 'Asset', 'Financial Statements', 'Planning', 'Management'];
    daftar.forEach((t, i) => {
      const y = 126 + i * 56;
      const ini = t === 'Management';
      if (ini) {
        g.fillStyle = '#FEE2E2';
        g.fillRect(8, y - 26, W - 16, 52);
      }
      g.fillStyle = ini ? '#DC2626' : '#1E3556';
      g.beginPath();
      g.arc(40, y, 17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.font = `800 20px ${MGF}`;
      g.fillText(String(i + 1), 40, y + 1);
      g.textAlign = 'left';
      g.fillStyle = ini ? '#B91C1C' : '#111827';
      g.font = `${ini ? 800 : 600} 27px ${MGF}`;
      g.fillText(t, 74, y);
      if (ini) {
        g.font = `800 17px ${MGF}`;
        g.textAlign = 'right';
        g.fillText('ANDA DI SINI', W - 16, y + 1);
      }
      g.textAlign = 'center';
    });
  }, 'mg-direktori');
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.03, 0]} size={[0.5, 0.06, 0.3]} color="#4B5563" cast={false} />
      <Box pos={[0, 0.55, -0.03]} size={[0.06, 1.0, 0.06]} color="#6B7280" />
      <Box pos={[0, 1.2, 0]} size={[0.84, 1.02, 0.04]} color="#2E3238" cast={false} />
      <BidangMg pos={[0, 1.2, 0.0215]} w={0.8} h={0.98} tex={tex} />
    </group>
  );
}

// Rak brosur lantai: 3 baris saku berisi brosur berjudul.
function RakBrosur({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const isi: [string, string][][] = [
    [['PROFIL', '#2F5D8A'], ['LAYANAN', '#2F7D5B'], ['TARIF', '#B8862B']],
    [['PAJAK', '#7A2E3B'], ['PAYROLL', '#4C3A7A'], ['AUDIT', '#1F6F78']],
    [['FAQ', '#C9453B'], ['KARIER', '#3E4A66'], ['KONTAK', '#5F8F4B']],
  ];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.03, 0]} size={[0.62, 0.06, 0.34]} color="#4B5563" cast={false} />
      <Box pos={[0, 0.72, -0.12]} size={[0.6, 1.3, 0.03]} color="#E5E7EB" />
      {[-0.29, 0.29].map((x) => (
        <Box key={x} pos={[x, 0.72, -0.02]} size={[0.025, 1.3, 0.22]} color="#CBD5E1" cast={false} />
      ))}
      {isi.map((baris, ri) => (
        <group key={ri} position={[0, 0.36 + ri * 0.4, 0]}>
          <Box pos={[0, 0, 0.0]} size={[0.58, 0.025, 0.2]} color="#CBD5E1" cast={false} />
          <Box pos={[0, 0.06, 0.1]} size={[0.58, 0.12, 0.012]} color="#D1D5DB" cast={false} />
          {baris.map(([t, c], ci) => (
            <group key={t} position={[-0.19 + ci * 0.19, 0.04, 0.0]} rotation={[-0.1, 0, 0]}>
              <Box pos={[0, 0.16, 0.0]} size={[0.16, 0.3, 0.01]} color={c} cast={false} />
              <Box pos={[0, 0.2, 0.007]} size={[0.13, 0.1, 0.003]} color="#F8FAFC" cast={false} />
              <Teks pos={[0, 0.2, 0.0095]} w={0.12} h={0.05} text={t} fg="#111827" />
              <Box pos={[0, 0.1, 0.007]} size={[0.12, 0.012, 0.003]} color="#F8FAFC" cast={false} />
              <Box pos={[0, 0.07, 0.007]} size={[0.09, 0.012, 0.003]} color="#F8FAFC" cast={false} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

// Rak majalah/koran dinding kecil di sudut tunggu: majalah berjudul.
function RakMajalah({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const mj: [string, string][] = [['BISNIS INDONESIA', '#2F5D8A'], ['AKUNTAN', '#7A2E3B'], ['PAJAK KITA', '#2F7D5B'], ['EKONOMI', '#B8862B']];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.03, 0]} size={[0.8, 0.06, 0.34]} color="#5B4630" cast={false} />
      <Box pos={[0, 0.4, -0.15]} size={[0.8, 0.7, 0.03]} color="#7A5B3A" />
      {[-0.39, 0.39].map((x) => (
        <Box key={x} pos={[x, 0.4, -0.02]} size={[0.03, 0.7, 0.3]} color="#7A5B3A" cast={false} />
      ))}
      <Box pos={[0, 0.2, 0.0]} size={[0.76, 0.02, 0.28]} color="#8A6544" cast={false} />
      <Box pos={[0, 0.5, 0.0]} size={[0.76, 0.02, 0.28]} color="#8A6544" cast={false} />
      {mj.map(([t, c], i) => (
        <group key={t} position={[-0.285 + i * 0.19, i % 2 ? 0.52 : 0.22, 0.02]} rotation={[-0.25, 0, 0]}>
          <Box pos={[0, 0.14, 0]} size={[0.17, 0.26, 0.012]} color={c} cast={false} />
          <Box pos={[0, 0.2, 0.008]} size={[0.15, 0.08, 0.003]} color="#F8FAFC" cast={false} />
          <Teks pos={[0, 0.2, 0.0105]} w={0.14} h={0.045} text={t} fg="#111827" />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- RUANGAN ----------------------------------------------------------------

function RuangManagement() {
  const { cz } = MGMT;
  const R = MG_R;
  return (
    <group position={[MG_OX, 0, cz]}>
      <LantaiMgmt />
      <MejaBundarPutih />
      <DekorMejaBundar />

      {/* 1 kursi per halaman, memutari meja (menghadap pusat); laptop di pinggir meja, menyala hanya saat ada AI duduk.
          INI SATU-SATUNYA MEJA KERJA di ruangan ini. */}
      {HALAMAN_MG_DUDUK.map((h, i) => {
        const a = (i * 2 * Math.PI) / MG_N;
        const seat = `mg:${i}`;
        return (
          <group key={h.id} rotation={[0, a, 0]}>
            <Chair pos={[0, 0, R]} color="#4B5E7A" />
            <Laptop pos={[0, 0.815, MG_LAPTOP_Z]} rotY={0} seatKey={seat} seed={40 + i * 7} />
            <BukuMeja pos={[-0.58, 0.815, 1.95]} rotY={0.2} warna={MG_SAMPUL[i % MG_SAMPUL.length]} />
            <PulpenMeja pos={[0.5, 0.815, 2.0]} rotY={-0.5} warna={MG_PULPEN[i % MG_PULPEN.length]} />
            <Mug pos={[0.8, 0.818, 1.8]} color="#F3F4F6" />
          </group>
        );
      })}
      <ManagementPenghuni />

      {/* ===== lapisan hias dinding: utara (kecuali celah pintu) & barat (kecuali celah pintu ke Planning) ===== */}
      <DindingDekor s={-5.4} segs={[[-13.4, -1.06], [1.06, 13.4]]} />
      <group rotation={[0, Math.PI / 2, 0]}>
        <DindingDekor s={-13.4} segs={[[-5.4, -4.65], [-2.55, 5.4]]} />
      </group>

      {/* ===== dinding utara (permukaan z = -5.4), kiri -> kanan: 2 rak buku berjudul, AC, PAPAN AGENDA, kalender, sertifikat, jam, [pintu x = 0],
          papan nama, 2 lemari arsip berlabel + piala, tempat sampah, printer + denah, rak buku, APAR, dispenser, papan gabus pengumuman ===== */}
      <RakBukuDetail pos={[-10.2, 0, -5.28]} isi={0} seed={1} />
      <RakBukuDetail pos={[-8.5, 0, -5.28]} isi={1} seed={2} />
      <ACDinding pos={[-7.0, 0, -5.4]} />
      <PapanAgenda pos={[-5.0, 1.0, -5.35]} />
      <KalenderDinding pos={[-3.72, 1.0, -5.37]} />
      <PigiuraTeks pos={[-2.72, 1.05, -5.35]} w={1.1} h={0.78} jenis="sertifikat" />
      <Clock pos={[-1.75, 1.2, -5.35]} />
      <PlantBush pos={[-1.95, 0, -5.0]} scale={0.6} />
      <PapanNamaMgmt pos={[2.4, 1.12, -5.4]} />
      <PlantSnake pos={[3.2, 0, -5.0]} scale={0.7} />
      <LemariArsipMg pos={[4.4, 0, -5.1]} isi={0} atas="piala" />
      <LemariArsipMg pos={[5.7, 0, -5.1]} isi={1} atas="berkas" />
      <TrashBin pos={[6.55, 0, -5.1]} />
      <PrinterStation pos={[7.5, 0, -5.1]} rotY={0} />
      <PigiuraTeks pos={[7.5, 1.28, -5.35]} w={0.78} h={0.56} jenis="denah" />
      <RakBukuDetail pos={[9.5, 0, -5.28]} isi={2} seed={3} />
      <Extinguisher pos={[10.85, 0.28, -5.2]} />
      <Box pos={[10.85, 0.78, -5.386]} size={[0.28, 0.2, 0.024]} color="#C9453B" cast={false} />
      <Teks pos={[10.85, 0.78, -5.372]} w={0.24} h={0.1} text="APAR" fg="#FFFFFF" />
      <WaterCooler pos={[11.6, 0, -5.1]} rotY={0} />
      <PapanGabusMg pos={[12.78, 1.0, -5.37]} />

      {/* ===== dinding barat (permukaan x = -13.4): palem, papan organisasi berdiri, rak buku, gantungan jas, AC, jadwal ruang rapat ===== */}
      <PlantPalm pos={[-11.7 - MG_EXT, 0, -5.0]} scale={1.0} />
      <PapanOrganisasi pos={[-11.7 - MG_EXT, 0, -3.4]} rotY={Math.PI / 2} />
      <group position={[-12.0 - MG_EXT, 0, -0.9]} rotation={[0, Math.PI / 2, 0]}>
        <RakBukuDetail pos={[0, 0, 0]} isi={0} seed={5} />
      </group>
      <CoatRack pos={[-11.8 - MG_EXT, 0, 0.62]} />
      <ACDinding pos={[-12.2 - MG_EXT, 0, 1.7]} rotY={Math.PI / 2} pipa={-1} />
      <JadwalRuang pos={[-13.37, 1.15, 5.0]} rotY={Math.PI / 2} />

      {/* ===== dinding timur (dinding rendah): kopi, ETALASE PENGHARGAAN (ganti meja direksi), lemari arsip, bendera, sofa + meja kopi ===== */}
      <CoffeeStation pos={[13.1, 0, -4.2]} rotY={-Math.PI / 2} />
      <EtalaseKaca pos={[13.1, 0, -1.9]} rotY={-Math.PI / 2} />
      <PlantPalm pos={[11.7, 0, -3.1]} scale={0.75} />
      <LemariArsipMg pos={[13.12, 0, 0.1]} rotY={-Math.PI / 2} isi={2} atas="berkas" />
      <BenderaMgmt pos={[12.9, 0, 1.75]} rotY={-Math.PI / 2} />
      <Sofa pos={[11.3 + MG_EXT, 0, 3.6]} rotY={Math.PI / 2} color="#4F6FA8" />
      <group position={[9.9 + MG_EXT, 0, 3.6]} rotation={[0, Math.PI / 2, 0]}><CoffeeTable pos={[0, 0, 0]} /></group>

      {/* ===== sisi timur-tengah: POJOK INFORMASI (ganti meja sekretaris): banner visi-misi, papan direktori, rak brosur; troli dokumen ===== */}
      <RollUpBanner pos={[8.1, 0, -3.3]} rotY={0.1} />
      <PapanDirektori pos={[9.3, 0, -3.2]} rotY={-0.05} />
      <RakBrosur pos={[10.4, 0, -3.45]} rotY={-0.1} />
      <PlantBush pos={[7.2, 0, -3.5]} scale={0.6} />
      <TroliDokumen pos={[6.2, 0, -3.3]} />
      <PlantPalm pos={[10.95, 0, -4.4]} scale={0.7} />

      {/* ===== pojok barat daya: sudut tunggu (sofa + meja kopi + karpet), rak majalah, lampu, tanaman ===== */}
      <Sofa pos={[-7.8, 0, 4.7]} rotY={0} color="#4F6FA8" />
      <CoffeeTable pos={[-7.8, 0, 3.55]} />
      <RakMajalah pos={[-9.9, 0, 3.7]} rotY={0.2} />
      <FloorLamp pos={[-10.9, 0, 4.85]} />
      <PlantSnake pos={[-5.7, 0, 4.9]} scale={0.8} />
      <PlantBush pos={[-11.5 - MG_EXT, 0, 5.0]} scale={0.8} />

      {/* ===== sisi selatan (dinding rendah): bak tanaman, tanaman & lampu ===== */}
      <BakTanaman pos={[-4.4, 0, 5.2]} />
      <BakTanaman pos={[0.0, 0, 5.2]} />
      <BakTanaman pos={[5.0, 0, 5.2]} />
      <BakTanaman pos={[9.6, 0, 5.2]} />
      <PlantBush pos={[2.9, 0, 5.0]} scale={0.75} />
      <PlantBush pos={[-2.9, 0, 5.0]} scale={0.75} />
      <PlantSnake pos={[7.0, 0, 5.0]} scale={0.9} />
      <FloorLamp pos={[6.6, 0, 1.8]} />
      <FloorLamp pos={[11.8 + MG_EXT, 0, 5.1]} />
    </group>
  );
}

// ---- [BARU] Detail lorong ala kantor biasa (tanpa lampu, tanpa karpet/garis memanjang) ---------------------------------------

// Lantai lorong: porselen 60x60 abu-krem hangat. Tiap ubin punya nada sendiri, kilap diagonal halus, awan warna, urat tipis,
// bintik ala terrazzo, dan bevel tipis; nat (grout) berbayang di antara ubin. Satu tekstur 1536px = 6x6 ubin, dipakai bersama
// oleh semua lorong (di-clone per lantai), dan garis nat disejajarkan ke grid dunia supaya menyambung antar lorong.
// Tidak ada karpet, garis, atau medali: hanya lantai biasa.
const UBIN_LORONG = 0.6; // sisi satu ubin (satuan scene)
const UBIN_N = 6; // jumlah ubin per sisi dalam satu tekstur (6x6 supaya pola ulang tidak mencolok)
const UBIN_ULANG = UBIN_LORONG * UBIN_N; // satu pengulangan tekstur = 6x6 ubin
let LANTAI_LORONG_TEX: THREE.CanvasTexture | null = null;
function teksturLantaiLorong(): THREE.CanvasTexture {
  if (LANTAI_LORONG_TEX) return LANTAI_LORONG_TEX;
  const N = UBIN_N, T = 256, S = T * N; // 256px per ubin
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  if (x) {
    const rnd = mulberry32(77);
    const nada = ['#E9E6DD', '#E4E1D6', '#DFDCD0', '#E6E3D9', '#E1DED3'];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = i * T, y0 = j * T;
      x.save();
      x.beginPath(); x.rect(x0, y0, T, T); x.clip();
      // dasar + kilap diagonal (arah acak per ubin)
      x.fillStyle = nada[Math.floor(rnd() * nada.length)];
      x.fillRect(x0, y0, T, T);
      const g = x.createLinearGradient(x0, y0, x0 + T, y0 + T);
      const terang = rnd() < 0.5;
      g.addColorStop(0, terang ? 'rgba(255,255,255,0.22)' : 'rgba(120,110,90,0.09)');
      g.addColorStop(1, terang ? 'rgba(120,110,90,0.09)' : 'rgba(255,255,255,0.22)');
      x.fillStyle = g; x.fillRect(x0, y0, T, T);
      // awan warna lembut (variasi nada di dalam satu ubin)
      for (let k = 0; k < 3; k++) {
        const px = x0 + rnd() * T, py = y0 + rnd() * T, r = 60 + rnd() * 90;
        const rg = x.createRadialGradient(px, py, 0, px, py, r);
        rg.addColorStop(0, rnd() < 0.5 ? 'rgba(170,150,115,0.11)' : 'rgba(255,255,255,0.18)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = rg; x.fillRect(x0, y0, T, T);
      }
      // urat tipis (gelap + sorot terang di sebelahnya)
      x.lineCap = 'round';
      const nUrat = 1 + Math.floor(rnd() * 3);
      for (let v = 0; v < nUrat; v++) {
        const a = x0 + rnd() * T, b = x0 + rnd() * T, m1 = x0 + rnd() * T, m2 = x0 + rnd() * T;
        x.strokeStyle = 'rgba(150,140,118,0.14)'; x.lineWidth = 1 + rnd() * 1.2;
        x.beginPath(); x.moveTo(a, y0 - 4); x.bezierCurveTo(m1, y0 + T * 0.33, m2, y0 + T * 0.66, b, y0 + T + 4); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.26)'; x.lineWidth = 0.8;
        x.beginPath(); x.moveTo(a + 2, y0 - 4); x.bezierCurveTo(m1 + 2, y0 + T * 0.33, m2 + 2, y0 + T * 0.66, b + 2, y0 + T + 4); x.stroke();
      }
      // bintik ala terrazzo (gelap, terang, hangat)
      for (let n = 0; n < 150; n++) {
        const r = rnd();
        x.fillStyle = r < 0.4 ? 'rgba(120,105,80,0.20)' : r < 0.75 ? 'rgba(255,255,255,0.55)' : 'rgba(190,160,110,0.20)';
        const u = 1 + rnd() * 2.2;
        x.fillRect(x0 + rnd() * T, y0 + rnd() * T, u, u);
      }
      x.restore();
      // bevel tipis: sorot atas-kiri, bayangan bawah-kanan
      x.fillStyle = 'rgba(255,255,255,0.5)';
      x.fillRect(x0 + 4, y0 + 4, T - 8, 1.5); x.fillRect(x0 + 4, y0 + 4, 1.5, T - 8);
      x.fillStyle = 'rgba(110,100,82,0.24)';
      x.fillRect(x0 + 4, y0 + T - 5.5, T - 8, 1.5); x.fillRect(x0 + T - 5.5, y0 + 4, 1.5, T - 8);
    }
    // nat: dasar lebar 5px + garis gelap tipis di tengah (kesan cekung); digambar di batas ubin, menyambung saat diulang
    for (let k = 0; k <= N; k++) {
      const q = k * T;
      x.fillStyle = '#BDB8A6';
      x.fillRect(q - 2.5, 0, 5, S); x.fillRect(0, q - 2.5, S, 5);
      x.fillStyle = 'rgba(112,106,88,0.6)';
      x.fillRect(q - 0.8, 0, 1.6, S); x.fillRect(0, q - 0.8, S, 1.6);
    }
    for (let n = 0; n < 500; n++) { // butir halus di nat
      const q = Math.floor(rnd() * (N + 1)) * T + (rnd() - 0.5) * 4;
      x.fillStyle = rnd() < 0.5 ? 'rgba(90,84,68,0.25)' : 'rgba(240,236,224,0.35)';
      if (rnd() < 0.5) x.fillRect(q, rnd() * S, 1.2, 1.2); else x.fillRect(rnd() * S, q, 1.2, 1.2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  LANTAI_LORONG_TEX = t;
  return t;
}
function LantaiLorong({ cx = 0, cz, w = 44.4, d }: { cx?: number; cz: number; w?: number; d: number }) {
  const tex = useMemo(() => {
    const t = teksturLantaiLorong().clone();
    t.repeat.set(w / UBIN_ULANG, d / UBIN_ULANG);
    // sejajarkan garis nat ke grid dunia (kelipatan UBIN_LORONG) supaya menyambung antar lantai lorong
    t.offset.set((cx - w / 2) / UBIN_ULANG, -(cz + d / 2) / UBIN_ULANG);
    t.needsUpdate = true;
    return t;
  }, [cx, cz, w, d]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.004, cz]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

// Tempat sampah pilah 3 warna (organik / kertas / plastik).
function BinPilah({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {['#4E9A5B', '#4C7FC0', '#E0B63A'].map((col, i) => (
        <group key={col} position={[(i - 1) * 0.34, 0, 0]}>
          <Tube pos={[0, 0.21, 0]} r={0.15} rb={0.13} h={0.42} color={col} seg={14} />
          <Tube pos={[0, 0.435, 0]} r={0.165} h={0.03} color="#374151" seg={14} cast={false} />
          <Box pos={[0, 0.3, 0.14]} size={[0.14, 0.14, 0.01]} color="#F7F7F5" cast={false} />
        </group>
      ))}
    </group>
  );
}

// APAR (alat pemadam) di dudukan lantai + rambu merah di tiang.
function StandAPAR({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.02, 0]} size={[0.36, 0.04, 0.3]} color="#6B7280" cast={false} />
      <Tube pos={[0, 0.3, 0]} r={0.075} h={0.5} color="#C9453B" seg={14} />
      <Tube pos={[0, 0.58, 0]} r={0.03} h={0.08} color="#2B3340" seg={8} cast={false} />
      <Box pos={[0.06, 0.62, 0]} size={[0.12, 0.025, 0.025]} color="#2B3340" cast={false} />
      <Box pos={[0, 0.33, 0.077]} size={[0.07, 0.1, 0.006]} color="#F7F7F5" cast={false} />
      <Tube pos={[0, 0.75, -0.12]} r={0.015} h={1.5} color="#6B7280" seg={8} cast={false} />
      <Box pos={[0, 1.38, -0.12]} size={[0.34, 0.34, 0.02]} color="#C9453B" cast={false} />
      <Box pos={[0, 1.38, -0.105]} size={[0.18, 0.05, 0.006]} color="#FFFFFF" cast={false} />
      <Box pos={[0, 1.38, -0.105]} size={[0.05, 0.18, 0.006]} color="#FFFFFF" cast={false} />
    </group>
  );
}

// Rambu A "Awas lantai licin" kuning.
function StandLicin({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      {[-1, 1].map((sd) => (
        <group key={sd} position={[0, 0.3, sd * 0.07]} rotation={[sd * 0.22, 0, 0]}>
          <Box pos={[0, 0, 0]} size={[0.34, 0.6, 0.02]} color="#F2C230" cast={false} />
          <Box pos={[0, 0.08, sd * 0.012]} size={[0.14, 0.16, 0.006]} color="#2B3340" cast={false} />
          <Box pos={[0, -0.1, sd * 0.012]} size={[0.2, 0.04, 0.006]} color="#2B3340" cast={false} />
        </group>
      ))}
    </group>
  );
}

// Papan pengumuman gabus (menempel di dinding; +z lokal = menghadap lorong).
function PapanPengumuman({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  const notes: [number, number, string][] = [[-0.38, 0.18, '#FDE68A'], [-0.12, 0.2, '#FBCFE8'], [0.16, 0.15, '#A7F3D0'], [0.42, 0.2, '#BFDBFE'], [-0.3, -0.12, '#FFFFFF'], [0.05, -0.14, '#FDE68A'], [0.38, -0.1, '#FFFFFF']];
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[1.3, 0.85, 0.05]} color="#8B6B47" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[1.2, 0.75, 0.02]} color="#C9A26B" cast={false} />
      {notes.map(([x, y, col], i) => (
        <Box key={i} pos={[x, y, 0.045]} size={[0.2, 0.2, 0.006]} color={col} rot={[0, 0, (i % 3 - 1) * 0.06]} cast={false} />
      ))}
      <Box pos={[0.62, -0.2, 0.05]} size={[0.02, 0.02, 0.01]} color="#D94F4F" cast={false} />
    </group>
  );
}

// Denah evakuasi (bingkai putih, denah sederhana, titik "Anda di sini").
function DenahEvakuasi({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0, 0]} size={[1.0, 0.7, 0.05]} color="#F3F4F6" cast={false} />
      <Box pos={[0, 0, 0.03]} size={[0.9, 0.6, 0.02]} color="#E8F2EC" cast={false} />
      {[[-0.28, 0.14, 0.26, 0.2], [0.0, 0.14, 0.24, 0.2], [0.28, 0.14, 0.26, 0.2], [-0.2, -0.14, 0.4, 0.2], [0.22, -0.14, 0.4, 0.2]].map(([x, y, w, h], i) => (
        <Box key={i} pos={[x, y, 0.045]} size={[w, h, 0.006]} color="#CFE3D8" cast={false} />
      ))}
      <Box pos={[0.0, 0.0, 0.05]} size={[0.8, 0.03, 0.006]} color="#2F7D5B" cast={false} />
      <Box pos={[0.3, 0.0, 0.055]} size={[0.06, 0.06, 0.006]} color="#D94F4F" cast={false} />
      <Box pos={[-0.37, -0.25, 0.05]} size={[0.12, 0.05, 0.006]} color="#2F7D5B" cast={false} />
    </group>
  );
}

// Lantai kedua lorong + hiasan dinding sisi selatan lorong 1. Di luar <BatchStatis /> (bertekstur / ikut naik bersama ruangannya).
function LorongLantaiDekor() {
  const zd = gz(8.8) - 0.12; // permukaan dinding sisi lorong 1 (menghadap utara)
  return (
    <group>
      <LantaiLorong cx={LORONG_LANTAI_CX} w={LORONG_LANTAI_W} cz={gz(7.2)} d={LORONG_LEBAR - 0.2} />
      <LantaiLorong cx={LORONG_LANTAI_CX} w={LORONG_LANTAI_W} cz={gz(19.6) - LORONG_LEBAR / 2} d={LORONG_LEBAR - 0.2} />
      {/* [BARU] lantai ubin dua lorong samping (dari tepi lantai lorong 1 sampai tepi lantai lorong 2) */}
      {[LS_A_CX, LS_B_CX].map((x) => {
        const z0 = gz(7.2) + (LORONG_LEBAR - 0.2) / 2;
        const z1 = gz(19.6) - LORONG_LEBAR / 2 - (LORONG_LEBAR - 0.2) / 2;
        return <LantaiLorong key={`ls${x}`} cx={x} w={LORONG_LEBAR - 0.2} cz={(z0 + z1) / 2} d={z1 - z0} />;
      })}
      <IkutNaik rooms={['perpus']}>
        <PapanPengumuman pos={[-19.0, 1.0, zd]} rotY={Math.PI} />
        <Art pos={[-12.3, 1.0, zd]} rotY={Math.PI} />
      </IkutNaik>
      <IkutNaik rooms={['santai']}>
        <Clock pos={[-9.0 + GESER_SANTAI, 1.1, zd + 0.02]} />
        <DenahEvakuasi pos={[-2.8 + GESER_SANTAI, 1.0, zd]} rotY={Math.PI} />
      </IkutNaik>
      <IkutNaik rooms={['aset']}>
        <Art pos={[1.2 + GESER_SANTAI, 1.0, zd]} rotY={Math.PI} />
        <PapanPengumuman pos={[7.2 + GESER_SANTAI, 1.0, zd]} rotY={Math.PI} />
      </IkutNaik>
      <IkutNaik rooms={['studio']}>
        <DenahEvakuasi pos={[12.2 + GESER_STUDIO, 1.0, zd]} rotY={Math.PI} />
        <Art pos={[19.8 + GESER_STUDIO, 1.0, zd]} rotY={Math.PI} />
      </IkutNaik>
    </group>
  );
}

// ---- Lorong bawah + dinding baris 3 + papan nama ----
function BarisTiga() {
  return (
    <group>
      {/* lantai lorong bawah: ubin digambar oleh <LorongLantaiDekor /> (di luar batch, karena bertekstur) */}
      <Lantai cx={LORONG_LANTAI_CX} cz={gz(19.6) - LORONG_LEBAR / 2} w={LORONG_LANTAI_W} d={LORONG_LEBAR - 0.2} color={TH.lorong.floor} />
      <Bench pos={[-4.8, 0, gz(19.6) - 0.7]} rotY={Math.PI} />
      <Bench pos={[19.6, 0, gz(19.6) - 0.7]} rotY={Math.PI} />
      <Bench pos={[26.4, 0, gz(19.6) - 0.7]} rotY={Math.PI} />
      <PlantPalm pos={[-21.3 - GESER_BARAT, 0, gz(19.6) - LORONG_LEBAR / 2 + 0.05]} scale={1.0} />
      <PlantPalm pos={[21.2 + TAMBAH_TIMUR, 0, gz(19.6) - LORONG_LEBAR / 2 + 0.05]} scale={1.0} />
      <PlantSnake pos={[-2.2, 0, gz(19.6) - 0.7]} scale={0.8} />
      {/* [BARU] perabot lorong 2 ala kantor biasa (sisi utara, di luar jalur agen z ~ 18.6): dispenser, tempat sampah pilah, APAR, tanaman */}
      <WaterCooler pos={[-19.0, 0, 17.98]} rotY={0} />
      <BinPilah pos={[6.0, 0, 17.98]} />
      <StandAPAR pos={[-1.8, 0, 17.98]} />
      <PlantBush pos={[-12.0, 0, 17.98]} scale={0.7} />
      <PlantBush pos={[11.0, 0, 17.98]} scale={0.7} />
      <PlantBush pos={[27.0, 0, 17.98]} scale={0.7} />
      <PlantSnake pos={[19.2, 0, 17.98]} scale={0.8} />
      <BinPilah pos={[-17.4, 0, 20.9]} />
      <BinPilah pos={[24.0, 0, 20.9]} />
      <StandLicin pos={[3.6, 0, 20.7]} />
      {/* [DIUBAH] Dinding & papan nama Planning / Management kini digambar oleh <DindingBaris3 /> (ikut naik bersama ruangan). */}
      {/* Sisa di sini: dinding luar sisi lorong saja (tidak ikut naik). */}
      <Dinding sumbu="z" di={-22.3 - GESER_BARAT} dari={gz(17.1)} ke={gz(19.6)} gaya="tinggi" theme={TH.lorong} luar={-1} />
      <Dinding sumbu="z" di={X_TIMUR} dari={gz(17.1)} ke={gz(19.6)} gaya="rendah" theme={TH.lorong} luar={1} />
    </group>
  );
}

// ---- [BARU] LORONG SAMPING: lorong vertikal selebar LORONG_LEBAR (sama dengan lorong 2) yang menghubungkan lorong 1 dan lorong 2 ----
// Lantai dasar (ubin bertekstur digambar <LorongLantaiDekor />) + perabot ala lorong 2: bangku, dispenser, APAR, tempat sampah pilah, tanaman.
// Perabot menempel di kedua dinding; jalan di tengah (x = cx) dibiarkan kosong untuk jalur agen. Dindingnya digambar <DindingRuang /> (ikut naik bersama ruangan).
function LorongSamping({ cx, varian }: { cx: number; varian: 'a' | 'b' }) {
  const z0 = gz(7.2) + (LORONG_LEBAR - 0.2) / 2; // tepi selatan lantai lorong 1
  const z1 = gz(19.6) - LORONG_LEBAR / 2 - (LORONG_LEBAR - 0.2) / 2; // tepi utara lantai lorong 2
  const zc = (z0 + z1) / 2;
  const xw = cx - 1.58, xe = cx + 1.58; // perabot menempel di dinding barat / timur
  const A = Math.PI / 2; // menghadap timur (perabot di dinding barat)
  return (
    <group>
      <Lantai cx={cx} cz={zc} w={LORONG_LEBAR - 0.2} d={z1 - z0} color={TH.lorong.floor} />
      {varian === 'a' ? (
        <>
          <WaterCooler pos={[xw, 0, zc - 2.4]} rotY={A} />
          <group position={[xw, 0, zc + 2.6]} rotation={[0, A, 0]}><StandAPAR pos={[0, 0, 0]} /></group>
          <Bench pos={[cx + 1.35, 0, zc]} rotY={-A} />
          <PlantBush pos={[xe, 0, zc - 2.6]} scale={0.7} />
          <group position={[xe, 0, zc + 2.4]} rotation={[0, -A, 0]}><BinPilah pos={[0, 0, 0]} /></group>
        </>
      ) : (
        <>
          <Bench pos={[cx - 1.35, 0, zc]} rotY={A} />
          <PlantSnake pos={[xw, 0, zc - 2.6]} scale={0.8} />
          <group position={[xw, 0, zc + 2.4]} rotation={[0, A, 0]}><BinPilah pos={[0, 0, 0]} /></group>
          <WaterCooler pos={[xe, 0, zc - 2.4]} rotY={-A} />
          <group position={[xe, 0, zc + 2.6]} rotation={[0, -A, 0]}><StandAPAR pos={[0, 0, 0]} /></group>
        </>
      )}
    </group>
  );
}

// ---- Lorong + semua dinding pemisah + papan nama ----
const PINTU_AR = -13.7, PINTU_AP = AP_GX - 0.4; // pintu ruang AR & AP di dinding lorong (z = 5.6); Kantor di x = TRX_OX
function Gedung() {
  return (
    <group>
      {/* lantai lorong: ubin digambar oleh <LorongLantaiDekor /> (di luar batch, karena bertekstur) */}
      <Lantai cx={LORONG_LANTAI_CX} cz={gz(7.2)} w={LORONG_LANTAI_W} d={LORONG_LEBAR - 0.2} color={TH.lorong.floor} />
      {/* [BARU] dua lorong samping (A: Research | Santai, B: Asset | Financial Statements): lantai dasar + perabot ala lorong 2 */}
      <LorongSamping cx={LS_A_CX} varian="a" />
      <LorongSamping cx={LS_B_CX} varian="b" />
      {/* dekorasi lorong */}
      <PlantPalm pos={[-21.3 - GESER_BARAT, 0, 6.2]} scale={1.0} />
      <PlantPalm pos={[21.1 + TAMBAH_TIMUR, 0, 6.2]} scale={1.0} />
      <WaterCooler pos={[-21.5 - GESER_BARAT, 0, gz(7.2) + 0.7]} rotY={Math.PI / 2} />
      <Bench pos={[-7.0, 0, 6.15]} />
      <Bench pos={[6.6, 0, 6.15]} />
      <PlantBush pos={[-9.8, 0, 6.15]} scale={0.8} />
      <PlantSnake pos={[9.6, 0, 6.15]} scale={0.9} />
      {/* [BARU] perabot lorong 1 ala kantor biasa: mesin fotokopi, tempat sampah pilah, APAR, rambu lantai licin, tanaman */}
      <PrinterStation pos={[-18.2, 0, 6.1]} rotY={0} />
      <BinPilah pos={[-3.8, 0, 6.05]} />
      <StandAPAR pos={[4.7, 0, 6.0]} />
      <StandLicin pos={[15.0, 0, 6.3]} />
      <PlantBush pos={[-12.0, 0, 8.95]} scale={0.8} />
      <BinPilah pos={[1.4, 0, 8.95]} />
      <PlantPalm pos={[11.4, 0, 8.9]} scale={0.8} />
      <PlantSnake pos={[5.2, 0, 8.95]} scale={0.9} />
      <BinPilah pos={[27.2, 0, 8.95]} />
      <PlantSnake pos={[20.2, 0, 8.95]} scale={0.9} />
      <Bench pos={[21.6, 0, 6.15]} />
      <PlantBush pos={[25.2, 0, 6.15]} scale={0.8} />

      {/* [DIUBAH] Dinding yang berbatasan dengan ruangan kini digambar oleh <DindingRuang /> (ikut naik bersama ruangan). */}
      {/* Sisa di sini: potongan dinding di sisi lorong saja (tidak ikut naik). */}
      <Dinding sumbu="z" di={-22.3 - GESER_BARAT} dari={gz(5.6)} ke={gz(8.8)} gaya="tinggi" theme={TH.lorong} luar={-1} />
      <Dinding sumbu="z" di={X_TIMUR} dari={gz(5.6)} ke={gz(8.8)} gaya="rendah" theme={TH.lorong} pintu={[gz(7.2)]} luar={1} />

      {/* [DIUBAH] Papan nama ruang kerja kini di <DindingRuang /> (ikut naik bersama dindingnya). */}
    </group>
  );
}

// ---- [BARU] FOKUS RUANGAN: klik satu ruangan -> ruangan itu naik sedikit, ruangan lain meredup ----------------------------------
// Klik ruangan yang sama / area kosong / tombol Esc = kembali normal. Hanya tampilan; tidak mengubah isi ruangan.
type RuangId = 'transaksi' | 'ar' | 'ap' | 'perpus' | 'santai' | 'aset' | 'studio' | 'planning' | 'management';
const RUANG_BOX: Record<RuangId, { nama: string; cx: number; cz: number; w: number; d: number }> = {
  transaksi: { nama: 'Transactions', cx: TRX_OX, cz: 0, w: TRX_LANTAI_W, d: 11 },
  ar: { nama: 'Account Receivable', cx: (AR_X0 + AR_X1) / 2 - 13.2, cz: 0, w: AR_X1 - AR_X0, d: 11 },
  ap: { nama: 'Account Payable', cx: AP_CX + AP_GX, cz: 0, w: AP_W, d: 11 },
  perpus: { nama: 'Research', cx: -16.7 - GESER_BARAT / 2, cz: 12.9 + GESER_BARIS_2, w: 11 + GESER_BARAT, d: 8 },
  santai: { nama: 'Santai', cx: -6.0 + GESER_SANTAI, cz: 12.9 + GESER_BARIS_2, w: 10, d: 8 },
  aset: { nama: 'Asset', cx: 4.2 + GESER_SANTAI, cz: 12.9 + GESER_BARIS_2, w: 10, d: 8 },
  studio: { nama: 'Financial Statements', cx: 15.8 + GESER_STUDIO, cz: 12.9 + GESER_BARIS_2, w: 13, d: 8 },
  planning: { nama: 'Planning', cx: (-22.3 - GESER_BARAT + SEKAT_B3) / 2, cz: 25.1 + GESER_BARIS_3, w: SEKAT_B3 + 22.3 + GESER_BARAT, d: 11 },
  management: { nama: 'Management', cx: MGMT.cx, cz: MGMT.cz, w: MGMT.w, d: 11 },
};
const NAIK_MAX = 0.5; // tinggi ruangan terpilih naik
const REDUP_MAX = 0.6; // seberapa gelap ruangan lain (0..1)
// Posisi lantai terbaru Neo / Atlas / Zeno (diisi tiap frame oleh <Agent />), dipakai untuk tahu siapa yang ada di ruangan terfokus.
const POS_AGEN: Record<string, [number, number]> = {};
function ruangDi(x: number, z: number): RuangId | null {
  for (const k of Object.keys(RUANG_BOX) as RuangId[]) {
    const b = RUANG_BOX[k];
    if (Math.abs(x - b.cx) <= b.w / 2 && Math.abs(z - b.cz) <= b.d / 2) return k;
  }
  return null;
}
// Melaporkan (tiap ~0.3 dtk, hanya saat berubah) agen mana yang sedang berada di ruangan terfokus.
function PantauAgen({ onAgen }: { onAgen?: (nama: string[]) => void }) {
  const acc = useRef(0);
  const last = useRef('');
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.3) return;
    acc.current = 0;
    const id = FOKUS.id;
    const daftar = id
      ? ['Neo', 'Atlas', 'Zeno'].filter((n) => {
          const p = POS_AGEN[n];
          return !!p && ruangDi(p[0], p[1]) === id;
        })
      : [];
    const key = `${id ?? ''}:${daftar.join(',')}`;
    if (key === last.current) return;
    last.current = key;
    onAgen?.(daftar);
  });
  return null;
}
const NAIK_HOVER = 0.12; // petunjuk kecil: ruangan terangkat sedikit saat kursor di atasnya
const EVENT_LEPAS_FOKUS = 'agentic:lepas-fokus'; // dikirim tombol Tutup di AgenticAIView
const FOKUS: {
  id: RuangId | null;
  hover: RuangId | null;
  cepat: boolean; // true = tanpa animasi (prefers-reduced-motion)
  naik: Partial<Record<RuangId, number>>;
  pilih: (id: RuangId | null) => void;
  kamera: (id: RuangId | null) => void;
} = {
  id: null,
  hover: null,
  cepat: false,
  naik: {},
  pilih: () => {},
  kamera: () => {},
};
// Tinggi lantai di titik (x, z): agen yang berada di dalam ruangan ikut naik bersama ruangannya (halus di dekat tepi/pintu).
function naikDi(x: number, z: number): number {
  for (const k of Object.keys(RUANG_BOX) as RuangId[]) {
    const n = FOKUS.naik[k];
    if (!n) continue;
    const b = RUANG_BOX[k];
    const m = Math.min(x - (b.cx - b.w / 2), b.cx + b.w / 2 - x, z - (b.cz - b.d / 2), b.cz + b.d / 2 - z);
    if (m > 0) return n * Math.min(1, m / 0.8);
  }
  return 0;
}
const WARNA_REDUP = new THREE.Color('#000000');

// ---- [PERFORMA] Penggabung mesh statis ---------------------------------------------------------------------------
// Masalah: ribuan <Box>/<Tube>/<Ball> = ribuan draw call; saat zoom out semuanya masuk layar -> berat.
// Solusi: setelah ruangan tampil, mesh Lambert opaque yang TIDAK bergerak digabung jadi satu mesh per kelompok
// (warna disimpan sebagai vertex color, jadi tampilan sama persis). Mesh asli disembunyikan, bukan dihapus.
// Yang bergerak / berubah warna / punya event klik / transparan / bertekstur / emissive TIDAK digabung (tetap seperti semula).
// Mesh dicek berkala; kalau ada yang berubah (bergerak, ganti warna, hilang, disembunyikan) kelompok otomatis dilepas & digabung ulang.
// Saklar darurat: ubah BATCH_AKTIF ke false untuk kembali ke cara lama.
// [EKSPERIMEN] Saklar lewat URL (default aman = seperti kode asli):
//   ?batch=1     -> aktifkan penggabungan mesh statis (default MATI sampai terbukti lebih cepat di perangkat Anda)
//   ?bayangan=1  -> aktifkan bayangan (default MATI: bayangan sangat berat di GPU terintegrasi seperti Intel UHD)
//   ?perf=1      -> tampilkan FPS / draw call / GPU
const _qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const BATCH_AKTIF = _qs?.get('batch') === '1';
const BAYANGAN_AKTIF = _qs?.get('bayangan') === '1';
// [PERFORMA] ?lod=0 mematikan LOD ukuran-piksel (untuk membandingkan), ?lod=15 mengunci ambang 15 piksel (tanpa adaptif).
const LOD_PARAM = _qs?.get('lod') ?? null;

// ---- [PERFORMA] MUAT ISI RUANGAN BERTAHAP (lazy) ---------------------------------------------------------------------------
// Masalah: saat halaman dibuka, isi SEMUA ruangan (ribuan mesh: meja, rak, dekor, lantai bertekstur) dibuat sekaligus, padahal
// peta awal tampil zoom-out dan semua detail itu hanya berukuran beberapa piksel. Akibatnya loading bisa belasan detik.
// Sekarang: saat dibuka hanya komponen DASAR yang dibuat (gedung, dinding, papan nama, lantai polos per ruangan, 3 agen, area klik).
// Isi sebuah ruangan baru dibuat (sekali, lalu tetap) saat:
//   1) ruangan itu DIKLIK / difokuskan, atau
//   2) kamera di-ZOOM IN sampai >= ZOOM_DETAIL x zoom peta utuh DAN ruangan itu terlihat di layar, atau
//   3) ada yang membutuhkannya (agen sedang rapat / bertugas / berkunjung ke sana, atau AI penghuni ruangan itu diberi tugas).
// Setelah dibuat, isinya sama persis seperti sebelumnya (LOD piksel, klip dinding, redup, peta AI penghuni ikut menyesuaikan).
// Saklar: ?detail=semua memuat semua ruangan langsung (perilaku lama, untuk membandingkan).
const DETAIL_SEMUA = _qs?.get('detail') === 'semua';
const ZOOM_DETAIL = 1.45; // kelipatan zoom peta utuh (FitCamera) mulai saat isi ruangan yang terlihat dimuat
const EVENT_DETAIL = 'agentic:detail-dimuat'; // dikirim setelah isi sebuah ruangan selesai dibuat (LOD & peta AI penghuni memindai ulang)
const DETAIL: { ada: Record<string, boolean>; jumlah: number; paksa: Set<string>; paksaAI: Set<string> } = { ada: {}, jumlah: 0, paksa: new Set(), paksaAI: new Set() };
const _vRuang = new THREE.Vector3();
// Apakah persegi lantai ruangan (empat sudutnya) beririsan dengan layar? (kamera ortografis)
function ruangTerlihat(b: { cx: number; cz: number; w: number; d: number }, camera: THREE.Camera): boolean {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      _vRuang.set(b.cx + (sx * b.w) / 2, 0, b.cz + (sz * b.d) / 2).project(camera);
      if (_vRuang.x < x0) x0 = _vRuang.x;
      if (_vRuang.x > x1) x1 = _vRuang.x;
      if (_vRuang.y < y0) y0 = _vRuang.y;
      if (_vRuang.y > y1) y1 = _vRuang.y;
    }
  }
  return x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1;
}
const BATCH_EPS = 3e-5;
let batchSeq = 0;
const _tmpM = new THREE.Matrix4();
const _invM = new THREE.Matrix4();
type BatchCand = { mesh: THREE.Mesh; mats: Float32Array[]; col: number[][]; dyn: boolean };
type BatchSumber = { mesh: THREE.Mesh; rel: Float32Array; col: number[] };

function layakGabung(m: THREE.Mesh): boolean {
  const mat = m.material as any;
  if (!(m as any).isMesh || (m as any).isInstancedMesh || (m as any).isSkinnedMesh) return false;
  if (Array.isArray(mat) || !mat || !mat.isMeshLambertMaterial) return false;
  if (m.userData.nodim || m.userData.nobatch || m.userData.batchHasil) return false;
  if (mat.transparent || mat.opacity !== 1 || mat.map || mat.emissiveMap || mat.alphaTest > 0 || mat.vertexColors || mat.wireframe) return false;
  if (mat.side !== THREE.FrontSide || mat.emissive.getHex() !== 0) return false;
  if (m.renderOrder !== 0 || !m.visible) return false;
  const inst = (m as any).__r3f;
  if (inst && (inst.eventCount > 0 || (inst.handlers && Object.keys(inst.handlers).length > 0))) return false;
  const geo = m.geometry as THREE.BufferGeometry;
  if (!geo || !geo.attributes.position || geo.groups.length > 0) return false;
  return true;
}

// true = terlihat sampai root; false = ada leluhur tersembunyi; null = sudah tidak terpasang di root
function terlihatSampai(mesh: THREE.Object3D, root: THREE.Object3D): boolean | null {
  let o: THREE.Object3D | null = mesh.parent;
  let ok = true;
  while (o && o !== root) {
    if (!o.visible) ok = false;
    o = o.parent;
  }
  return o === root ? ok : null;
}

function matRel(root: THREE.Object3D, mesh: THREE.Object3D, out: Float32Array) {
  _tmpM.multiplyMatrices(_invM, mesh.matrixWorld);
  for (let i = 0; i < 16; i++) out[i] = _tmpM.elements[i];
}
const sama = (a: Float32Array, b: Float32Array) => {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > BATCH_EPS) return false;
  return true;
};

function BatchStatis({ nama, children }: { nama: string; children?: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const S = useRef({
    fase: 0, t0: -1, frames: 0, tSnap: 0, fSnap: 0, cek: 0, rebuild: 0, mati: false,
    delay: 0.12 * (batchSeq++ % 12),
    cand: [] as BatchCand[], sumber: [] as BatchSumber[], hasil: [] as THREE.Mesh[],
  });

  const lepas = () => {
    const s = S.current;
    const g = ref.current;
    for (const m of s.hasil) {
      g?.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const r of s.sumber) {
      if (g && terlihatSampai(r.mesh, g) !== null) r.mesh.visible = true;
    }
    s.hasil = [];
    s.sumber = [];
    s.cand = [];
  };

  useEffect(() => () => {
    const s = S.current;
    for (const m of s.hasil) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }, []);

  useFrame((state) => {
    const s = S.current;
    const g = ref.current;
    if (!BATCH_AKTIF || s.mati || !g) return;
    const now = state.clock.elapsedTime;
    if (s.t0 < 0) { s.t0 = now; s.frames = 0; }
    s.frames++;

    const ambil = (k: number) => {
      _invM.copy(g.matrixWorld).invert();
      for (const c of s.cand) {
        const arr = new Float32Array(16);
        matRel(g, c.mesh, arr);
        c.mats[k] = arr;
        const col = (c.mesh.material as THREE.MeshLambertMaterial).color;
        c.col[k] = [col.r, col.g, col.b];
        if (terlihatSampai(c.mesh, g) !== true || !c.mesh.visible) c.dyn = true;
        if (k > 0) {
          if (!sama(c.mats[0], arr)) c.dyn = true;
          const a = c.col[0], b = c.col[k];
          if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) c.dyn = true;
        }
      }
    };

    if (s.fase === 0) {
      if (now - s.t0 >= 0.8 + s.delay && s.frames >= 20) {
        s.cand = [];
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m !== (g as unknown) && layakGabung(m)) s.cand.push({ mesh: m, mats: [], col: [], dyn: false });
        });
        ambil(0);
        s.fase = 1; s.tSnap = now; s.fSnap = s.frames;
      }
    } else if (s.fase === 1 || s.fase === 2) {
      if (now - s.tSnap >= 0.8 && s.frames - s.fSnap >= 6) {
        ambil(s.fase);
        s.tSnap = now; s.fSnap = s.frames;
        if (s.fase === 1) { s.fase = 2; return; }
        // fase 2 selesai: gabungkan yang statis
        const statis = s.cand.filter((c) => !c.dyn);
        const grup: Record<string, { flat: boolean; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[]; src: BatchSumber[] }> = {};
        for (const c of statis) {
          const mat = c.mesh.material as THREE.MeshLambertMaterial;
          const rel = c.mats[2];
          _tmpM.fromArray(rel as unknown as number[]);
          if (_tmpM.determinant() <= 0) continue; // cermin (scale negatif): biarkan apa adanya
          const flat = !!mat.flatShading;
          const cast = !!c.mesh.castShadow;
          const recv = !!c.mesh.receiveShadow;
          const key = `${flat ? 'flat' : 'halus'}-${cast ? 1 : 0}${recv ? 1 : 0}`;
          const geo = c.mesh.geometry as THREE.BufferGeometry;
          const gg = geo.index ? geo.toNonIndexed() : geo.clone();
          for (const nm of Object.keys(gg.attributes)) if (nm !== 'position' && nm !== 'normal') gg.deleteAttribute(nm);
          gg.clearGroups();
          if (!gg.attributes.normal) gg.computeVertexNormals();
          gg.applyMatrix4(_tmpM);
          const n = gg.attributes.position.count;
          const arr = new Float32Array(n * 3);
          const col = c.col[2];
          for (let i = 0; i < n; i++) { arr[i * 3] = col[0]; arr[i * 3 + 1] = col[1]; arr[i * 3 + 2] = col[2]; }
          gg.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          (grup[key] ||= { flat, cast, recv, geos: [], src: [] }).geos.push(gg);
          grup[key].src.push({ mesh: c.mesh, rel, col });
        }
        let digabung = 0;
        for (const key of Object.keys(grup)) {
          const gr = grup[key];
          if (gr.geos.length < 2) { gr.geos.forEach((x) => x.dispose()); continue; }
          const merged = mergeGeometries(gr.geos, false);
          gr.geos.forEach((x) => x.dispose());
          if (!merged) continue;
          const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: gr.flat }));
          mesh.userData.batchHasil = true;
          mesh.castShadow = gr.cast;
          mesh.receiveShadow = gr.recv;
          mesh.matrixAutoUpdate = false;
          g.add(mesh);
          s.hasil.push(mesh);
          for (const r of gr.src) { r.mesh.visible = false; s.sumber.push(r); }
          digabung += gr.src.length;
        }
        if (digabung > 0 && typeof console !== 'undefined') {
          console.info(`[BatchStatis] ${nama}: ${digabung} mesh -> ${s.hasil.length} draw call (dari ${s.cand.length} kandidat)`);
        }
        s.fase = 3; s.cek = 0;
      }
    } else if (s.fase === 3) {
      if (++s.cek % 45 !== 0) return;
      let ok = true;
      _invM.copy(g.matrixWorld).invert();
      const arr = new Float32Array(16);
      for (const r of s.sumber) {
        if (terlihatSampai(r.mesh, g) !== true) { ok = false; break; }
        matRel(g, r.mesh, arr);
        const col = (r.mesh.material as THREE.MeshLambertMaterial).color;
        if (!sama(r.rel, arr) || col.r !== r.col[0] || col.g !== r.col[1] || col.b !== r.col[2]) { ok = false; break; }
      }
      if (!ok) {
        lepas();
        s.rebuild++;
        if (s.rebuild > 3) { s.mati = true; return; } // terlalu sering berubah: biarkan tanpa penggabungan
        s.fase = 0; s.t0 = now; s.frames = 0;
      }
    }
  });

  return <group ref={ref}>{children}</group>;
}
// ---- [BARU] DINDING = PENGHALANG: isi ruangan tidak bisa tembus keluar dinding ------------------------------------------------
// Semua benda di dalam <RuangFokus /> dipotong (clipping plane lokal) di sisi LUAR dinding ruangannya. Benda yang tata letaknya terlalu
// pinggir dan menembus dinding tidak tampak di seberang dinding (sama seperti ekor yang "tidak menembus" sandaran kursi).
// RUANG_BOX = sisi dalam dinding untuk sebagian besar ruangan, tapi = garis tengah dinding untuk sisi timur/barat Financial Statements dan
// semua sisi Planning & Management. KLIP_MARGIN = [x, z] jarak dari tepi RUANG_BOX ke sisi luar dinding (tebal dinding 0.2).
const KLIP_MARGIN: Record<RuangId, [number, number]> = {
  transaksi: [0.2, 0.2], ar: [0.2, 0.2], ap: [0.2, 0.2], perpus: [0.2, 0.2], santai: [0.2, 0.2], aset: [0.2, 0.2],
  studio: [0.1, 0.2], planning: [0.1, 0.1], management: [0.1, 0.1],
};
const KLIP_TOLERANSI = 0.03; // supaya permukaan luar dinding itu sendiri (dan pelat putihnya) tidak ikut terpotong
function bidangKlip(id: RuangId): THREE.Plane[] {
  const b = RUANG_BOX[id];
  const [mx, mz] = KLIP_MARGIN[id];
  const x0 = b.cx - b.w / 2 - mx - KLIP_TOLERANSI, x1 = b.cx + b.w / 2 + mx + KLIP_TOLERANSI;
  const z0 = b.cz - b.d / 2 - mz - KLIP_TOLERANSI, z1 = b.cz + b.d / 2 + mz + KLIP_TOLERANSI;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), z1),
  ];
}
// Satu material hanya boleh punya satu set bidang: kalau dipakai bersama ruangan lain, mesh ini diberi salinan material.
const KLIP_PEMILIK = new WeakMap<THREE.Material, RuangId>();

// Lantai polos pengganti isi ruangan selama isinya belum dimuat (hanya warna lantai tema ruangan itu).
const TEMA_RUANG: Record<RuangId, keyof typeof TH> = { transaksi: 'trx', ar: 'ar', ap: 'ap', perpus: 'perpus', santai: 'santai', aset: 'aset', studio: 'studio', planning: 'plan', management: 'mgmt' };
function LantaiDasar({ id }: { id: RuangId }) {
  const b = RUANG_BOX[id];
  return (
    <mesh position={[b.cx, 0.012, b.cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[b.w - 0.1, b.d - 0.1]} />
      <meshLambertMaterial color={TH[TEMA_RUANG[id]].floor} />
    </mesh>
  );
}

// dasar = komponen dasar yang SELALU tampil (opsional; kalau kosong dipakai lantai polos). children = isi ruangan yang dimuat bertahap.
function RuangFokus({ id, dasar, children }: { id: RuangId; dasar?: React.ReactNode; children: React.ReactNode }) {
  const b = RUANG_BOX[id];
  const g = useRef<THREE.Group>(null);
  const mats = useRef<{ m: any; c: THREE.Color; e: THREE.Color | null }[] | null>(null);
  const redup = useRef(0);
  const terapan = useRef(0);
  const gl = useThree((st) => st.gl);
  const kamera = useThree((st) => st.camera);
  const ukuran = useThree((st) => st.size);
  const [detail, setDetail] = React.useState(DETAIL_SEMUA); // isi ruangan sudah dimuat? (sekali true, tetap)
  const nFrame = useRef(0);
  const sedangMuat = useRef(false);
  useEffect(() => () => { delete FOKUS.naik[id]; delete DETAIL.ada[id]; DETAIL.jumlah = Object.keys(DETAIL.ada).length; }, [id]);
  // [BARU] Putuskan kapan isi ruangan dimuat (dicek tiap 12 frame; murah). Tidak memuat saat ruangan ini sedang redup (fokus ruangan lain)
  // supaya daftar material redup tidak kacau; setelah fokus dilepas dan redup selesai, baru dimuat bila perlu.
  useFrame(() => {
    if (detail || sedangMuat.current) return;
    if (++nFrame.current % 12 !== 0) return;
    const fokusIni = FOKUS.id === id;
    const tenang = FOKUS.id === null && redup.current < 0.002 && terapan.current === 0;
    let mau = fokusIni;
    if (!mau && tenang) {
      if (DETAIL.paksa.has(id) || DETAIL.paksaAI.has(id)) mau = true;
      else {
        const zDasar = Math.max(10, Math.min(ukuran.width / (52 + TAMBAH_TIMUR), ukuran.height / 27));
        if ((kamera as THREE.OrthographicCamera).zoom >= zDasar * ZOOM_DETAIL) mau = ruangTerlihat(b, kamera);
      }
    }
    if (!mau) return;
    sedangMuat.current = true;
    setTimeout(() => setDetail(true), fokusIni ? 80 : 0); // fokus: beri waktu animasi naik mulai dulu
  });
  useEffect(() => {
    if (!detail) return;
    DETAIL.ada[id] = true;
    DETAIL.jumlah = Object.keys(DETAIL.ada).length;
    mats.current = null; // daftar material redup dibangun ulang (isi baru ikut meredup)
    const t = [setTimeout(() => window.dispatchEvent(new Event(EVENT_DETAIL)), 700), setTimeout(() => window.dispatchEvent(new Event(EVENT_DETAIL)), 2500)];
    return () => t.forEach(clearTimeout);
  }, [detail, id]);
  // [BARU] Pasang bidang potong di sisi luar dinding pada semua mesh ruangan ini. Dijalankan beberapa kali setelah mount karena
  // sebagian isi ruangan baru muncul belakangan; mesh yang sudah diproses ditandai (userData.klip).
  useEffect(() => {
    gl.localClippingEnabled = true;
    const bidang = bidangKlip(id);
    const pasang = () => {
      const grp = g.current;
      if (!grp) return;
      let salin = false;
      grp.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.nodim || mesh.userData.klip) return;
        const daftar = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
        if (daftar.some((m) => m && KLIP_PEMILIK.get(m) !== undefined && KLIP_PEMILIK.get(m) !== id)) {
          // material dipakai ruangan lain -> perlu salinan; tunda kalau ruangan sedang meredup (daftar material redup sudah terpakai)
          if (redup.current > 0.002 || terapan.current > 0) return;
          salin = true;
        }
        const baru = daftar.map((m) => {
          if (!m || (m as THREE.ShaderMaterial).isShaderMaterial) return m;
          const pemilik = KLIP_PEMILIK.get(m);
          const target = pemilik !== undefined && pemilik !== id ? m.clone() : m;
          target.clippingPlanes = bidang;
          target.clipShadows = true;
          target.needsUpdate = true;
          KLIP_PEMILIK.set(target, id);
          return target;
        });
        mesh.material = Array.isArray(mesh.material) ? baru : baru[0];
        mesh.userData.klip = true;
      });
      if (salin) mats.current = null; // daftar material redup dibangun ulang (hanya saat ruangan tidak sedang meredup)
    };
    const t = [setTimeout(pasang, 500), setTimeout(pasang, 2500), setTimeout(pasang, 7000)];
    return () => t.forEach(clearTimeout);
  }, [gl, id, detail]); // [DIUBAH] ikut dijalankan ulang setelah isi ruangan dimuat (mesh baru perlu bidang potong)
  useFrame((_, dtRaw) => {
    const grp = g.current;
    if (!grp) return;
    const dt = Math.min(dtRaw, 0.1);
    const k = FOKUS.cepat ? 1 : 1 - Math.exp(-dt * 4); // easing tak bergantung FPS (sebelumnya dt*8 + dt dipotong 0.05 -> patah-patah di FPS rendah)
    const aktif = FOKUS.id === id;
    const lain = FOKUS.id !== null && !aktif;
    const n0 = FOKUS.naik[id] ?? 0;
    const tinggi = aktif ? NAIK_MAX : FOKUS.hover === id ? NAIK_HOVER : 0;
    const n1 = Math.abs(n0 - tinggi) < 0.002 ? tinggi : n0 + (tinggi - n0) * k;
    FOKUS.naik[id] = n1;
    grp.position.y = n1;
    redup.current += ((lain ? 1 : 0) - redup.current) * k;
    if (Math.abs(redup.current - terapan.current) < 0.002 && (redup.current > 0.002 || terapan.current === 0)) return;
    if (Math.abs(redup.current) < 0.002) redup.current = 0;
    if (!mats.current) {
      const list: { m: any; c: THREE.Color; e: THREE.Color | null }[] = [];
      const seen = new Set<any>();
      grp.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.nodim) return;
        for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as any[]) {
          if (!m || !m.color || seen.has(m)) continue;
          seen.add(m);
          list.push({ m, c: m.color.clone(), e: m.emissive ? m.emissive.clone() : null });
        }
      });
      mats.current = list;
    }
    const a = redup.current * REDUP_MAX;
    for (const r of mats.current) {
      r.m.color.copy(r.c).lerp(WARNA_REDUP, a);
      if (r.e) r.m.emissive.copy(r.e).lerp(WARNA_REDUP, Math.min(1, a * 1.4));
    }
    terapan.current = redup.current;
  });
  return (
    <group ref={g} userData={{ ruang: id }}>
      {/* tebal ruangan: terlihat di sisinya saat ruangan naik. [DIUBAH] putih (PUTIH_LUAR) supaya semua sisi luar ruangan (termasuk Transactions yang dindingnya di <Room />) seragam putih */}
      <Box pos={[b.cx, -0.5, b.cz]} size={[b.w - 0.1, 0.6, b.d - 0.1]} color={PUTIH_LUAR} cast={false} />
      <BatchStatis nama={id}>{dasar}{detail ? children : dasar ? null : <LantaiDasar id={id} />}</BatchStatis>
      {/* area klik (tak terlihat) seluas lantai ruangan; geseran peta (drag) tidak dihitung sebagai klik */}
      <mesh
        position={[b.cx, 0.03, b.cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ nodim: true }}
        onClick={(e) => {
          if (e.delta > 6) return;
          e.stopPropagation();
          FOKUS.pilih(FOKUS.id === id ? null : id);
        }}
        onPointerOver={() => { FOKUS.hover = id; document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { if (FOKUS.hover === id) FOKUS.hover = null; document.body.style.cursor = ''; }}
      >
        <planeGeometry args={[b.w, b.d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---- [BARU] DINDING & PAPAN NAMA IKUT NAIK BERSAMA RUANGAN --------------------------------------------------------------
// Dulu dinding ada di <Gedung /> (diam), jadi saat ruangan naik (hover / klik) hanya isinya yang terangkat.
// Kini tiap dinding tahu ruangan mana yang berbatasan dengannya (rooms) dan terangkat setinggi ruangan tertinggi di antaranya
// (FOKUS.naik, dihitung <RuangFokus /> termasuk animasi hover). Dinding terangkat diberi "kaki" (kotak warna dinding setinggi
// angkatan) supaya tidak ada celah antara dasar dinding dan tanah di sisi ruangan tetangga.
// Urutan useFrame: komponen ini dirender SESUDAH semua <RuangFokus />, jadi FOKUS.naik sudah terbarui di frame yang sama
// (jangan beri useFrame priority > 0: itu mematikan render otomatis R3F).
function naikRuang(rooms: RuangId[]): number {
  let y = 0;
  for (const r of rooms) {
    const n = FOKUS.naik[r] ?? 0;
    if (n > y) y = n;
  }
  return y;
}

function IkutNaik({ rooms, children }: { rooms: RuangId[]; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const last = useRef(0);
  useFrame(() => {
    const y = naikRuang(rooms);
    if (Math.abs(y - last.current) < 1e-4) return;
    last.current = y;
    if (g.current) g.current.position.y = y;
  });
  return <group ref={g}>{children}</group>;
}

// [BARU] `sisi` = ruangan di tiap sisi tembok partisi (plus = sisi +x / +z, minus = sisi -x / -z). Saat tembok naik lebih tinggi daripada ruangan
// di salah satu sisinya (mis. Planning naik, Management tidak), tambahan tinggi di sisi ruangan tetangga itu: bagian bawah (kaki) dan bagian
// ATAS (di atas tinggi dinding tetangga) dicat putih. Sisi ruangan yang naik sendiri tidak berubah (desain lama).
function DindingNaik({ rooms, sisi, ...p }: React.ComponentProps<typeof Dinding> & { rooms: RuangId[]; sisi?: { plus?: RuangId; minus?: RuangId } }) {
  const g = useRef<THREE.Group>(null);
  const kaki = useRef<THREE.Group>(null);
  const bandPlus = useRef<THREE.Group>(null);
  const bandMinus = useRef<THREE.Group>(null);
  const last = useRef(0);
  const lastBand = useRef<[number, number]>([0, 0]);
  useFrame(() => {
    const y = naikRuang(rooms);
    if (Math.abs(y - last.current) >= 1e-4) {
      last.current = y;
      if (g.current) g.current.position.y = y;
      if (kaki.current) {
        kaki.current.visible = y > 0.003;
        kaki.current.scale.y = Math.max(y, 1e-3);
      }
    }
    if (!sisi) return;
    // tinggi pita putih di atas dinding tetangga = selisih angkatan tembok dan angkatan ruangan di sisi itu (maks. tinggi tembok 1.6)
    const hP = sisi.plus ? Math.min(1.6, Math.max(0, y - (FOKUS.naik[sisi.plus] ?? 0))) : 0;
    const hM = sisi.minus ? Math.min(1.6, Math.max(0, y - (FOKUS.naik[sisi.minus] ?? 0))) : 0;
    if (Math.abs(hP - lastBand.current[0]) < 1e-4 && Math.abs(hM - lastBand.current[1]) < 1e-4) return;
    lastBand.current = [hP, hM];
    for (const [ref, h] of [[bandPlus, hP], [bandMinus, hM]] as const) {
      const bg = ref.current;
      if (!bg) continue;
      bg.visible = h > 0.003;
      bg.scale.y = Math.max(h, 1e-3);
      bg.position.y = 1.6 - h; // bawah pita; atasnya selalu di puncak dinding (1.6)
    }
  });
  const { sumbu, di, dari, ke, pintu = [] } = p;
  const P = (m: number, y: number): V3 => (sumbu === 'x' ? [m, y, di] : [di, y, m]);
  const S = (l: number): V3 => (sumbu === 'x' ? [l, 1, 0.2] : [0.2, 1, l]);
  const PB = (m: number, off: number): V3 => (sumbu === 'x' ? [m, 0.5, di + off] : [di + off, 0.5, m]); // pita: tinggi 1 satuan, diskalakan
  const SB = (l: number): V3 => (sumbu === 'x' ? [l, 1, 0.004] : [0.004, 1, l]);
  // [DIUBAH] Kaki dinding (bagian tambahan yang muncul saat ruangan naik) putih di SEMUA sisinya: sisi luar gedung, ujung (sudut),
  // dan sisi yang menempel ruangan tetangga. Sisi dalam ruangan yang naik tertutup lantainya sendiri.
  return (
    <group ref={g}>
      {/* kaki: tinggi 1 satuan lalu diskalakan = angkatan; sisi atas di dasar dinding, sisi bawah di tanah */}
      <group ref={kaki} visible={false}>
        {runs(dari, ke, pintu).map(([m, l]) => (
          <mesh key={m} position={P(m, -0.5)}>
            <boxGeometry args={S(l)} />
            <meshLambertMaterial color={PUTIH_LUAR} />
          </mesh>
        ))}
      </group>
      {/* pita putih di sisi tetangga: bagian atas tembok yang lebih tinggi daripada dinding ruangan tetangga */}
      {sisi && ([['plus', bandPlus, 1], ['minus', bandMinus, -1]] as const).map(([k, ref, arah]) => (
        sisi[k] ? (
          <group key={k} ref={ref} visible={false}>
            {runs(dari, ke, pintu).map(([m, l]) => (
              <mesh key={m} position={PB(m, 0.102 * arah)}>
                <boxGeometry args={SB(l)} />
                <meshLambertMaterial color={PUTIH_LUAR} />
              </mesh>
            ))}
          </group>
        ) : null
      ))}
      <Dinding {...p} />
    </group>
  );
}

// Dinding baris 1 & 2 (AR, Transactions, AP, Research, Santai, Asset, Financial Statements) + papan namanya.
function DindingRuang() {
  const XW = -22.4 - GESER_BARAT, XE = X_TIMUR + 0.1; // ujung dinding luar barat / timur
  return (
    <group>
      {/* dinding luar belakang (tinggi) — bagian Transactions digambar oleh <Room /> */}
      <DindingNaik rooms={['ar']} sumbu="x" di={gz(-5.6)} dari={XW} ke={ATAS_B1 - 0.1} gaya="tinggi" theme={TH.ar} luar={-1} />
      <DindingNaik rooms={['ap']} sumbu="x" di={gz(-5.6)} dari={ATAS_B2 + 0.1} ke={XE} gaya="tinggi" theme={TH.ap} luar={-1} />
      {/* dinding luar kiri (tinggi) */}
      <DindingNaik rooms={['ar']} sumbu="z" di={-22.3 - GESER_BARAT} dari={gz(-5.7)} ke={gz(5.6)} gaya="tinggi" theme={TH.ar} luar={-1} />
      <DindingNaik rooms={['perpus']} sumbu="z" di={-22.3 - GESER_BARAT} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.perpus} luar={-1} />
      {/* dinding luar kanan (rendah) */}
      <DindingNaik rooms={['ap']} sumbu="z" di={X_TIMUR} dari={gz(-5.7)} ke={gz(5.6)} gaya="rendah" theme={TH.ap} luar={1} />
      <DindingNaik rooms={['studio']} sumbu="z" di={X_TIMUR} dari={gz(8.8)} ke={gz(17.1)} gaya="rendah" theme={TH.studio} luar={1} />
      {/* dinding belakang baris 2 (menghadap lorong 2): setengah tembok + kaca. [DIUBAH] Research & Financial Statements TIDAK lagi punya pintu belakang;
          jalan antar lorong 1 dan 2 kini lewat lorong samping A dan B (celah di antara ruangan dibiarkan terbuka). */}
      <DindingNaik rooms={['perpus']} sumbu="x" di={gz(17.0)} dari={XW} ke={LS_A_X0} gaya="kaca" theme={TH.perpus} luar={1} />
      <DindingNaik rooms={['santai']} sumbu="x" di={gz(17.0)} dari={LS_A_X1} ke={SANTAI_X1} gaya="kaca" theme={TH.santai} luar={1} />
      <DindingNaik rooms={['aset']} sumbu="x" di={gz(17.0)} dari={SANTAI_X1} ke={LS_B_X0} gaya="kaca" theme={TH.aset} luar={1} />
      <DindingNaik rooms={['studio']} sumbu="x" di={gz(17.0)} dari={LS_B_X1} ke={XE} gaya="kaca" theme={TH.studio} luar={1} />
      {/* partisi baris atas | lorong (pintu ke AR, Transactions, AP): dipecah per ruangan */}
      <DindingNaik rooms={['ar']} sumbu="x" di={gz(5.6)} dari={XW} ke={ATAS_B1} gaya="kaca" theme={TH.lorong} pintu={[PINTU_AR]} papan={['R-01|ACCOUNT RECEIVABLE']} luar={1} />
      <DindingNaik rooms={['transaksi']} sumbu="x" di={gz(5.6)} dari={ATAS_B1} ke={ATAS_B2} gaya="kaca" theme={TH.lorong} pintu={[TRX_OX]} papan={['R-02|TRANSACTIONS']} luar={1} />
      <DindingNaik rooms={['ap']} sumbu="x" di={gz(5.6)} dari={ATAS_B2} ke={XE} gaya="kaca" theme={TH.lorong} pintu={[PINTU_AP]} papan={['R-03|ACCOUNT PAYABLE']} luar={1} />
      {/* partisi Transactions | AP */}
      {/* [DIUBAH] Dulu satu tembok pink untuk dua ruangan. Sekarang sisi AP tetap pink, sisi Transactions punya lapisan dinding sendiri (biru langit) */}
      <DindingNaik rooms={['ap']} sisi={{ minus: 'transaksi', plus: 'ap' }} sumbu="z" di={ATAS_B2} dari={gz(-5.7)} ke={gz(5.7)} gaya="tinggi" theme={TH.ap} />
      <DindingNaik rooms={['transaksi']} sisi={{ minus: 'transaksi', plus: 'ap' }} sumbu="z" di={ATAS_B2 - 0.2} dari={gz(-5.6)} ke={gz(5.6)} gaya="tinggi" theme={TH.trx} />
      {/* partisi lorong 1 | baris tengah (pintu ke tiap ruangan): tembok penuh. Di mulut lorong samping A & B dindingnya terbuka. */}
      <DindingNaik rooms={['perpus']} sumbu="x" di={gz(8.8)} dari={XW} ke={LS_A_X0} gaya="kaca" theme={TH.perpus} pintu={[-14.7]} papan={['R-04|RESEARCH']} hindar={[-19.0, -12.3]} modern penuh luar={-1} />
      <DindingNaik rooms={['santai']} sumbu="x" di={gz(8.8)} dari={LS_A_X1} ke={SANTAI_X1} gaya="kaca" theme={TH.santai} pintu={[-6.0 + GESER_SANTAI]} papan={['R-05|SANTAI']} hindar={[-9.0 + GESER_SANTAI, -2.8 + GESER_SANTAI]} penuh luar={-1} />
      <DindingNaik rooms={['aset']} sumbu="x" di={gz(8.8)} dari={SANTAI_X1} ke={LS_B_X0} gaya="kaca" theme={TH.aset} pintu={[4.2 + GESER_SANTAI]} papan={['R-06|ASSET']} hindar={[1.2 + GESER_SANTAI, 7.2 + GESER_SANTAI]} penuh luar={-1} />
      <DindingNaik rooms={['studio']} sumbu="x" di={gz(8.8)} dari={LS_B_X1} ke={XE} gaya="kaca" theme={TH.studio} pintu={[16.0 + GESER_STUDIO]} papan={['R-07|FINANCIAL STATEMENTS']} hindar={[12.2 + GESER_STUDIO, 19.8 + GESER_STUDIO]} penuh luar={-1} />
      {/* [BARU] dinding samping lorong A (Research | Santai) dan lorong B (Asset | Financial Statements): tiap ruangan punya dindingnya sendiri */}
      <DindingNaik rooms={['perpus']} sumbu="z" di={LS_A_X0} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.perpus} luar={1} />
      <DindingNaik rooms={['santai']} sumbu="z" di={LS_A_X1} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.santai} luar={-1} />
      <DindingNaik rooms={['aset']} sumbu="z" di={LS_B_X0} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.aset} luar={1} />
      <DindingNaik rooms={['studio']} sumbu="z" di={LS_B_X1} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.studio} luar={-1} />
      {/* partisi antar ruang baris tengah: Santai | Asset */}
      <DindingNaik rooms={['santai', 'aset']} sisi={{ minus: 'santai', plus: 'aset' }} sumbu="z" di={SANTAI_X1} dari={gz(8.8)} ke={gz(17.1)} gaya="tinggi" theme={TH.aset} />

      {/* papan nama ruang kerja: menempel di dinding, ikut naik */}
      <IkutNaik rooms={['ar']}><BuildingSign pos={[(ATAS_XL + ATAS_B1) / 2 - 0.05, 1.85, -5.7]} text="ACCOUNT RECEIVABLE" accent="#2DD4BF" /></IkutNaik>
      <IkutNaik rooms={['ap']}><BuildingSign pos={[(ATAS_B2 + ATAS_XR) / 2 + 0.05, 1.85, -5.7]} text="ACCOUNT PAYABLE" accent="#FB7185" /></IkutNaik>
      <IkutNaik rooms={['aset']}><BuildingSign pos={[4.2 + GESER_SANTAI, 1.9, gz(8.8)]} text="ASSET" accent={EMAS} /></IkutNaik>
      <IkutNaik rooms={['studio']}><BuildingSign pos={[16.0 + GESER_STUDIO, 1.9, gz(8.8)]} text="FINANCIAL STATEMENTS" accent="#38BDF8" /></IkutNaik>
      <IkutNaik rooms={['perpus']}><BuildingSign pos={[-14.7, 1.9, gz(8.8)]} text="RESEARCH" accent="#A78BFA" /></IkutNaik>
    </group>
  );
}

// Dinding baris 3 (Planning, Management) + papan namanya.
function DindingBaris3() {
  return (
    <group>
      <DindingNaik rooms={['planning']} sumbu="z" di={-22.3 - GESER_BARAT} dari={gz(19.6)} ke={gz(30.7)} gaya="tinggi" theme={TH.plan} luar={-1} />
      <DindingNaik rooms={['management']} sumbu="z" di={X_TIMUR} dari={gz(19.6)} ke={gz(30.7)} gaya="rendah" theme={TH.mgmt} luar={1} />
      <DindingNaik rooms={['planning']} sumbu="x" di={gz(30.6)} dari={-22.4 - GESER_BARAT} ke={SEKAT_B3} gaya="rendah" theme={TH.plan} luar={1} />
      <DindingNaik rooms={['management']} sumbu="x" di={gz(30.6)} dari={SEKAT_B3} ke={X_TIMUR + 0.1} gaya="rendah" theme={TH.mgmt} luar={1} />
      {/* partisi kaca: lorong bawah | ruang (pintu ke tiap ruang), dan Planning | Management */}
      <DindingNaik rooms={['planning']} sumbu="x" di={gz(19.6)} dari={-22.4 - GESER_BARAT} ke={SEKAT_B3} gaya="kaca" theme={TH.plan} pintu={[-10.3]} papan={['R-08|PLANNING']} modern penuh luar={-1} />
      <DindingNaik rooms={['management']} sumbu="x" di={gz(19.6)} dari={SEKAT_B3} ke={X_TIMUR + 0.1} gaya="kaca" theme={TH.mgmt} pintu={[MG_OX]} papan={['R-09|MANAGEMENT']} modern penuh luar={-1} />
      <DindingNaik rooms={['planning', 'management']} sisi={{ minus: 'planning', plus: 'management' }} sumbu="z" di={SEKAT_B3} dari={gz(19.7)} ke={gz(30.7)} gaya="kaca" theme={TH.plan} pintu={[gz(28.7)]} modern penuh />
      <IkutNaik rooms={['planning']}><BuildingSign pos={[-10.3, 1.9, gz(19.6)]} text="PLANNING" accent="#A78BFA" /></IkutNaik>
      <IkutNaik rooms={['management']}><BuildingSign pos={[MG_OX, 1.9, gz(19.6)]} text="MANAGEMENT" accent="#60A5FA" /></IkutNaik>
    </group>
  );
}

// [BARU] Zoom supaya satu ruangan (alas + dinding ~2.2 + angkatan 0.5) pas di layar untuk ARAH KAMERA SAAT INI. Dulu memakai rumus isometrik
// tetap; sekarang kamera bisa diputar, jadi ruangan diproyeksikan ke sumbu kanan/atas kamera dan zoom dihitung dari ukuran hasilnya.
// Ortografis: zoom = piksel per satuan dunia. Margin 6 satuan sama seperti sebelumnya.
const _kn = new THREE.Vector3();
const _at = new THREE.Vector3();
const _bl = new THREE.Vector3();
function zoomPasRuang(b: { cx: number; cz: number; w: number; d: number }, camera: THREE.Camera, size: { width: number; height: number }): number {
  camera.updateMatrixWorld();
  camera.matrixWorld.extractBasis(_kn, _at, _bl);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-0.3, 2.7]) {
    const px = b.cx + (sx * b.w) / 2;
    const pz = b.cz + (sz * b.d) / 2;
    const u = px * _kn.x + y * _kn.y + pz * _kn.z;
    const v = px * _at.x + y * _at.y + pz * _at.z;
    if (u < x0) x0 = u; if (u > x1) x1 = u;
    if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  return Math.min(size.width / (x1 - x0 + 6), size.height / (y1 - y0 + 6));
}

// [BARU] Kamera menuju ruangan yang difokuskan (geser + zoom-in halus); zoom dikembalikan saat fokus dilepas.
// Arah kamera TIDAK diubah: hanya titik pusat & zoom yang menyesuaikan dengan arah kamera yang sedang dipakai.
// Berhenti otomatis kalau pengguna mulai menggeser / zoom / memutar sendiri.
function FokusKamera() {
  const controls = useThree((s) => s.controls) as any;
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const st = useRef<{ x: number; z: number; zoom: number; t: number } | null>(null);
  const zoomAwal = useRef<number | null>(null);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { st.current = null; };
    controls.addEventListener('start', stop);
    FOKUS.kamera = (id) => {
      if (!id) {
        if (zoomAwal.current !== null) st.current = { x: NaN, z: NaN, zoom: zoomAwal.current, t: 0 };
        zoomAwal.current = null;
        return;
      }
      const b = RUANG_BOX[id];
      if (zoomAwal.current === null) zoomAwal.current = camera.zoom;
      const fit = zoomPasRuang(b, camera, size); // [DIUBAH] sesuai arah kamera saat ini
      st.current = { x: b.cx, z: b.cz, zoom: Math.max(camera.zoom, Math.min(110, fit)), t: 0 };
    };
    return () => { controls.removeEventListener('start', stop); FOKUS.kamera = () => {}; };
  }, [controls, camera, size.width, size.height]);
  useFrame((_, dtRaw) => {
    const s = st.current;
    if (!s || !controls) return;
    const dt = Math.min(dtRaw, 0.1);
    const k = FOKUS.cepat ? 1 : 1 - Math.exp(-dt * 3.5);
    s.t += dt;
    camera.zoom += (s.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    let selesai = Math.abs(s.zoom - camera.zoom) < 0.05;
    if (!Number.isNaN(s.x)) {
      const t = controls.target as THREE.Vector3;
      const dir = t.clone().sub(camera.position).normalize();
      if (Math.abs(dir.y) > 1e-3) {
        const kk = -t.y / dir.y;
        const gx = t.x + dir.x * kk;
        const gz = t.z + dir.z * kk;
        const dx = (s.x - gx) * k;
        const dz = (s.z - gz) * k;
        t.x += dx; t.z += dz;
        camera.position.x += dx; camera.position.z += dz;
        if (Math.hypot(s.x - gx, s.z - gz) > 0.03) selesai = false;
      }
    }
    if (selesai || s.t > 4) st.current = null;
  });
  return null;
}

function Geser({ dari, ke, children }: { dari: [number, number]; ke: [number, number]; children: React.ReactNode }) {
  return <group position={[ke[0] - dari[0], 0, ke[1] - dari[1]]}>{children}</group>;
}

// Ruang yang sudah punya koordinat sendiri (Studio, Santai, Perpus, Asset) digeser ke selnya di dalam gedung (isi tidak diubah).
function PetaBesar() {
  return (
    <group>
      <BatchStatis nama="gedung"><Gedung /></BatchStatis>
      <RuangFokus id="ar"><RuangAR /></RuangFokus>
      <RuangFokus id="ap"><RuangAP /></RuangFokus>
      <RuangFokus id="studio"><Geser dari={[STUDIO.cx, STUDIO.cz]} ke={[15.8 + GESER_STUDIO, 12.9 + GESER_BARIS_2]}><StudioArea /></Geser></RuangFokus>
      <RuangFokus id="santai"><Geser dari={[SANTAI.cx, SANTAI.cz]} ke={[-6.0 + GESER_SANTAI, 12.9 + GESER_BARIS_2]}><SantaiArea /></Geser></RuangFokus>
      <RuangFokus id="perpus"><Geser dari={[PERPUS.cx, PERPUS.cz]} ke={[-14.7, 12.9 + GESER_BARIS_2]}><PerpusArea /></Geser></RuangFokus>
      <RuangFokus id="aset"><Geser dari={[ASET.cx, ASET.cz]} ke={[4.2 + GESER_SANTAI, 12.9 + GESER_BARIS_2]}><AsetArea /></Geser></RuangFokus>
      <BatchStatis nama="baris-tiga"><BarisTiga /></BatchStatis>
      <RuangFokus id="planning"><RuangPlanning /></RuangFokus>
      <RuangFokus id="management"><RuangManagement /></RuangFokus>
      {/* [BARU] Dinding ikut naik: HARUS sesudah semua <RuangFokus /> (urutan useFrame) dan di luar <BatchStatis /> (bergerak). */}
      <DindingRuang />
      <DindingBaris3 />
      <LorongLantaiDekor />
    </group>
  );
}

// Matahari mengikuti titik lantai yang sedang dilihat kamera, jadi bayangan tetap tajam di mana pun peta digeser.
// [DIUBAH] Titik lantai dihitung dari arah pandang kamera yang sebenarnya (kamera bisa diputar), bukan arah tetap (-16,-15,-16).
const _arahMatahari = new THREE.Vector3();
function SunLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [scene]);
  useFrame(({ camera }) => {
    const l = ref.current;
    if (!l) return;
    camera.getWorldDirection(_arahMatahari);
    if (_arahMatahari.y > -0.05) return;
    const k = -camera.position.y / _arahMatahari.y; // titik lantai di bawah pusat layar
    const gx = camera.position.x + _arahMatahari.x * k;
    const gz = camera.position.z + _arahMatahari.z * k;
    l.position.set(gx + 8, 14, gz + 6);
    l.target.position.set(gx, 0, gz);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={ref}
      position={[8, 14, 6]}
      intensity={1.1}
      castShadow={BAYANGAN_AKTIF}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-17}
      shadow-camera-right={17}
      shadow-camera-top={17}
      shadow-camera-bottom={-17}
      shadow-camera-near={0.5}
      shadow-camera-far={60}
    />
  );
}

// ---- Agen (Neo = robot, Atlas = rakun, Zeno = rubah) ---------------------

// [BARU] RUTINITAS SANTAI: kalau tidak sedang rapat & tidak punya tugas, agen tidak duduk di meja mana pun, tapi melakukan
// salah satu dari 3 kegiatan: 'sofa' = tiduran di sofa biru sambil baca buku (satu lutut diangkat), 'rak' = berdiri baca buku
// di depan rak buku, 'main' = mondar-mandir sambil joget/bermain. Kegiatan bergilir antar agen tiap 20 menit
// (berdasarkan jam dinding, jadi tetap konsisten walau halaman di-refresh).
type Act = 'sofa' | 'rak' | 'main';
const ACTS: Act[] = ['sofa', 'rak', 'main'];
const AGENT_IDX: Record<string, number> = { Neo: 0, Atlas: 1, Zeno: 2 };
const ACT_MS_DEFAULT = 20 * 60 * 1000;
const aktivitasSaatIni = (name: string, ms: number): Act =>
  ACTS[(Math.floor(Date.now() / ms) + (AGENT_IDX[name] ?? 0)) % ACTS.length];
const BOOK_COLOR: Record<string, string> = { Neo: '#E8C95A', Atlas: '#C9453B', Zeno: '#2F7D5B' };

type Wp = { p: [number, number]; face?: number; sit?: boolean; wait?: number; status: AgentStatus; seat?: string; act?: Act };
type Look = {
  kind: 'robot' | 'rakun' | 'rubah';
  // robot: warna badan / kaki / lengan / kepala.
  // hewan: torso = bulu badan, head = bulu kepala, arms = bulu lengan, legs = warna kaki bawah & telapak (gelap).
  torso: string;
  legs: string;
  arms: string;
  head: string;
  belly?: string; // hewan: warna perut, pipi, & moncong (krem / putih)
  dark?: string; // hewan: topeng mata & telinga (rakun) / ujung telinga (rubah)
  accent?: string; // hewan: tali ID card (rakun) / syal (rubah)
};

// Kursi meja rapat ada di sudut 45°, 135°, 225°, 315°. Menghadap meja = sudut + 180°.
const seatAt = (a: number): [number, number] => [tx(MEETING[0] + Math.sin(a) * 1.9), MEETING[1] + Math.cos(a) * 1.9];
const deskSeat = (d: [number, number]): [number, number] => [tx(d[0]), d[1] + 0.85];

const LOOK_NEO: Look = { kind: 'robot', torso: C.robot, legs: C.robot, arms: C.robotLight, head: C.robotLight };
// Atlas = rakun gemuk (bulu abu perak, topeng mata gelap, ekor belang). Zeno = rubah gemuk (bulu oranye, ekor lebat berujung putih, syal hijau).
const LOOK_ATLAS: Look = {
  kind: 'rakun', torso: '#8C98A3', head: '#98A3AD', arms: '#8C98A3', legs: '#3C434B',
  belly: '#D3DADF', dark: '#2E343B', accent: '#0F766E',
};
const LOOK_ZENO: Look = {
  kind: 'rubah', torso: '#E9843A', head: '#EC8C42', arms: '#E9843A', legs: '#3A2820',
  belly: '#FBEBD3', dark: '#3A2820', accent: '#2F7D5B',
};

// Jadwal simulasi per agen. Nanti diganti event dari backend.
const NEO_SEAT = deskSeat(NEO_DESK);
const NEO_MEET = seatAt((5 * Math.PI) / 4);
const NEO_ROUTE: Wp[] = [
  // [PERBAIKAN] Tanpa tugas, agen HANYA duduk di kursi rapat. Duduk di meja kerja hanya lewat tugas (nav 'kerja').
  { p: NEO_MEET, face: Math.PI / 4, sit: true, wait: Infinity, status: 'rapat', seat: meetKey((5 * Math.PI) / 4) },
];

const ATLAS_DESK: [number, number] = [-5, -3.6];
const ATLAS_SEAT = deskSeat(ATLAS_DESK);
const ATLAS_MEET = seatAt((3 * Math.PI) / 4);
const ATLAS_ROUTE: Wp[] = [
  // [PERBAIKAN] Tanpa tugas, agen HANYA duduk di kursi rapat. Duduk di meja kerja hanya lewat tugas (nav 'kerja').
  { p: ATLAS_MEET, face: (7 * Math.PI) / 4, sit: true, wait: Infinity, status: 'rapat', seat: meetKey((3 * Math.PI) / 4) },
];

const ZENO_DESK: [number, number] = [2, -3.6];
const ZENO_SEAT = deskSeat(ZENO_DESK);
const ZENO_MEET = seatAt((7 * Math.PI) / 4);
const ZENO_ROUTE: Wp[] = [
  // [PERBAIKAN] Tanpa tugas, agen HANYA duduk di kursi rapat. Duduk di meja kerja hanya lewat tugas (nav 'kerja').
  { p: ZENO_MEET, face: (3 * Math.PI) / 4, sit: true, wait: Infinity, status: 'rapat', seat: meetKey((7 * Math.PI) / 4) },
];

// ---- [BARU] JALUR GEDUNG: peta jalan semua agen antar ruangan (hanya jalur, isi ruangan tidak diubah) -----------------------------------
// Aturan jalur (seperti kantor sungguhan): agen TIDAK PERNAH menembus tembok. Satu-satunya jalan pindah ruangan adalah
//   ruangan -> PINTU -> LORONG -> PINTU -> ruangan.
//   - LORONG 1 (z = 7.2)  : menghubungkan AR, Transactions, AP (pintu di tembok z = 5.6) dan Perpus, Santai, Asset, Studio (pintu di z = 8.8)
//   - LORONG 2 (z = 18.3) : menghubungkan Planning dan Management (pintu di tembok z = 19.6)
//   - Lorong 1 -> Lorong 2: lewat LORONG SAMPING A (Research | Santai, x = LS_A_CX) atau B (Asset | Financial Statements, x = LS_B_CX).
//                           Research dan Financial Statements tidak lagi punya pintu belakang / jalur tembus; jalurnya buntu di dalam ruangan.
//   - Planning <-> Management: lewat pintu samping di x = -2.3 (z = 26). Di Management jalannya mengitari meja bundar (cincin mr0..mr13).
// (Garis putus-putus biru penanda jalur di lantai sudah dihapus; jalur agen tetap dipakai secara internal.)
const MG_PUSAT: [number, number] = [MG_OX, MGMT.cz]; // pusat meja bundar Management (= pusat ruangan)
const MG_CINCIN = 4.3; // jari-jari jalur mengitari meja (di luar kursi, di dalam karpet)
const NAV_GEDUNG: Record<string, [number, number]> = {
  // lorong 1: satu simpul di depan tiap pintu
  c1_perpus: [-14.7, gz(7.2)], c1_ar: [-13.7, gz(7.2)], c1_santai: [-6.0 + GESER_SANTAI, gz(7.2)], c1_kantor: [TRX_OX, gz(7.2)], c1_lA: [LS_A_CX, gz(7.2)], c1_lB: [LS_B_CX, gz(7.2)],
  c1_aset: [4.6 + GESER_SANTAI, gz(7.2)], c1_ap: [PINTU_AP, gz(7.2)], c1_studio: [16.3 + GESER_STUDIO, gz(7.2)], pintuUtama: [21.4 + TAMBAH_TIMUR, gz(7.2)],
  // baris atas: AR, Transactions (Kantor), AP
  ar_pintu: [-13.7, 5.6], ar_tengah: [-13.8, 2.0],
  k_pintu: [TRX_OX, 5.6],
  ap_pintu: [PINTU_AP, 5.6], ap_tengah: [PINTU_AP, 2.0],
  // baris tengah: Perpus (tembus ke lorong 2 lewat sisi timur), Santai, Asset, Studio (tembus ke lorong 2 lewat sela meja)
  pe_pintuA: [-14.7, gz(8.8)], pe_a: [-14.7, gz(10.8)], pe_b: [-12.5, gz(11.4)], pe_t: [-12.5, gz(13.2)],
  sa_pintu: [-6.0 + GESER_SANTAI, gz(8.8)], sa_tengah: [-6.0 + GESER_SANTAI, gz(11.4)],
  as_pintu: [4.6 + GESER_SANTAI, gz(8.8)], as_a: [4.2 + GESER_SANTAI, gz(10.3)], as_tengah: [4.2 + GESER_SANTAI, gz(12.6)],
  st_pintuA: [16.3 + GESER_STUDIO, gz(8.8)], st_a: [16.0 + GESER_STUDIO, gz(11.6)], st_t: [15.3 + GESER_STUDIO, gz(12.8)],
  // lorong 2
  c2_perpus: [-14.7, gz(18.3)], c2_plan: [-10.3, gz(18.3)], c2_mgmt: [MG_OX, gz(18.3)], c2_lA: [LS_A_CX, gz(18.3)], c2_lB: [LS_B_CX, gz(18.3)],
  // lorong samping A & B (vertikal): lorong 1 -> tengah -> lorong 2
  cA_t: [LS_A_CX, gz(13.0)], cB_t: [LS_B_CX, gz(13.0)],
  // baris bawah: Planning, pintu samping Planning <-> Management, Management
  pl_pintu: [-10.3, gz(19.6)], pl_a: [-10.3, gz(20.45)], pl_b: [-10.3, gz(21.9)], pl_tengah: [-9.7, gz(22.8)], pl_e: [-4.2 + PL_DX, gz(24.9)], pl_f: [-2.9 + PL_DX, gz(26.6)], pm_p: [-2.9 + PL_DX, gz(28.7)],
  pm_pintu: [SEKAT_B3, gz(28.7)], mg_a: [SEKAT_B3 + 0.9, gz(28.7)],
  mg_pintu: [MG_OX, gz(19.6)],
  // cincin jalan mengitari meja bundar Management: 14 simpul, mr7 = sisi utara (tepat di depan pintu lorong 2)
  ...Object.fromEntries(
    Array.from({ length: 14 }, (_, k) => [
      `mr${k}`,
      [MG_PUSAT[0] + MG_CINCIN * Math.sin((k * Math.PI) / 7), MG_PUSAT[1] + MG_CINCIN * Math.cos((k * Math.PI) / 7)] as [number, number],
    ])
  ),
};
const NAV_EDGES_GEDUNG: [string, string][] = [
  // lorong 1 (barat -> timur)
  ['c1_perpus', 'c1_ar'], ['c1_ar', 'c1_lA'], ['c1_lA', 'c1_santai'], ['c1_santai', 'c1_kantor'], ['c1_kantor', 'c1_aset'], ['c1_aset', 'c1_lB'], ['c1_lB', 'c1_ap'], ['c1_ap', 'c1_studio'], ['c1_studio', 'pintuUtama'],
  // pintu lorong 1 -> baris atas
  ['c1_ar', 'ar_pintu'], ['ar_pintu', 'ar_tengah'],
  ['c1_kantor', 'k_pintu'], ['k_pintu', 'pB'], // Transactions: pB = titik tengah lantai kantor, tersambung ke jalur lama di dalam kantor
  ['c1_ap', 'ap_pintu'], ['ap_pintu', 'ap_tengah'],
  // pintu lorong 1 -> baris tengah
  ['c1_perpus', 'pe_pintuA'], ['pe_pintuA', 'pe_a'], ['pe_a', 'pe_b'], ['pe_b', 'pe_t'], 
  ['c1_santai', 'sa_pintu'], ['sa_pintu', 'sa_tengah'],
  ['c1_aset', 'as_pintu'], ['as_pintu', 'as_a'], ['as_a', 'as_tengah'],
  ['c1_studio', 'st_pintuA'], ['st_pintuA', 'st_a'], ['st_a', 'st_t'], 
  // lorong 2 (barat -> timur) + sambungan dari pintu belakang Perpus & Studio
  ['c2_perpus', 'c2_plan'], ['c2_plan', 'c2_lA'], ['c2_lA', 'c2_mgmt'], ['c2_mgmt', 'c2_lB'],
  // lorong samping A & B menghubungkan lorong 1 dan lorong 2 (menggantikan jalur tembus lewat Research & Financial Statements)
  ['c1_lA', 'cA_t'], ['cA_t', 'c2_lA'], ['c1_lB', 'cB_t'], ['cB_t', 'c2_lB'],
  // Planning
  ['c2_plan', 'pl_pintu'], ['pl_pintu', 'pl_a'], ['pl_a', 'pl_b'], ['pl_b', 'pl_tengah'], ['pl_tengah', 'pl_e'], ['pl_e', 'pl_f'], ['pl_f', 'pm_p'],
  // Planning <-> Management (pintu samping)
  ['pm_p', 'pm_pintu'], ['pm_pintu', 'mg_a'], ['mg_a', 'mr11'],
  // Management: pintu lorong 2 -> cincin meja bundar
  ['c2_mgmt', 'mg_pintu'], ['mg_pintu', 'mr7'],
  ...Array.from({ length: 14 }, (_, k): [string, string] => [`mr${k}`, `mr${(k + 1) % 14}`]),
];

// Nama ruangan -> simpul tujuan di dalam ruangan itu (titik lantai kosong tepat di dalam pintu). Dipakai agen yang "berkunjung".
export const RUANG_TUJUAN: Record<string, string> = {
  transactions: 'pB', ar: 'ar_tengah', ap: 'ap_tengah', perpus: 'pe_t', santai: 'sa_tengah',
  aset: 'as_tengah', studio: 'st_t', planning: 'pl_tengah', management: 'mr7',
};
const ALIAS_RUANG: Record<string, string> = {
  kantor: 'transactions', transaksi: 'transactions', asset: 'aset', receivable: 'ar', 'account receivable': 'ar',
  payable: 'ap', 'account payable': 'ap', perpustakaan: 'perpus', research: 'perpus', 'financial statements': 'studio', 'financial statement': 'studio', lounge: 'santai', plan: 'planning', mgmt: 'management', direksi: 'management',
};
export function simpulRuang(nama: string): string | null {
  const k = nama.trim().toLowerCase();
  return RUANG_TUJUAN[ALIAS_RUANG[k] ?? k] ?? null;
}

// [BARU] TUGAS HALAMAN: peta jalur antar meja. Nomor meja = indeks DESKS (0 = Sales ... 4 = Other, lihat HALAMAN_MEJA di
// src/lib/tugasKantor.ts). Semua garis di bawah adalah lantai kosong (lorong z = -1.9, celah antar meja, jalur ke meja rapat),
// jadi agen bisa berjalan dari mana saja ke meja mana saja tanpa menembus perabot.
const NAV: Record<string, [number, number]> = {
  'c-5': [tx(-5), -1.9], 'c-3.25': [tx(-3.25), -1.9], 'c-1.5': [tx(-1.5), -1.9], 'c0.4': [tx(0.4), -1.9],
  c2: [tx(2), -1.9], 'c2.6': [tx(2.6), -1.9], 'c6.3': [tx(6.3), -1.9],
  d0: deskSeat(DESKS[0].p), d1: deskSeat(DESKS[1].p), d2: deskSeat(DESKS[2].p), d3: deskSeat(DESKS[3].p), d4: deskSeat(DESKS[4].p),
  f1: [tx(-5), 1.4], f2: [tx(-3.25), 1.4], f3: [tx(-1.5), 1.4], f4: [tx(0.4), 1.4], // jalur selatan untuk meja baris depan
  nNeo: [tx(2.7), 0.1], nAtlas: [tx(6.3), 0.0], nZeno: [tx(2.1), 3.14],
  mNeo: NEO_MEET, mAtlas: ATLAS_MEET, mZeno: ZENO_MEET,
  // [BARU] titik rutinitas santai: sofa biru (sA1/sA2 = jalur di depan sofa, sofa = tempat berbaring), rak buku, area joget
  sA1: [tx(-6.1 + TRX_DX), 1.4], sA2: [tx(-6.1 + TRX_DX), 3.8], sofa: [tx(-7.0 + TRX_DX), 3.8],
  rak: [tx(6.2), -4.45],
  pA: [tx(-3.3), 3.2], pB: [tx(0.0), 3.2],
  ...NAV_GEDUNG, // [BARU] jalur antar ruangan (lorong, pintu, jalur tembus)
};
const NAV_EDGES: [string, string][] = [
  ['c-5', 'c-3.25'], ['c-3.25', 'c-1.5'], ['c-1.5', 'c0.4'], ['c0.4', 'c2'], ['c2', 'c2.6'], ['c2.6', 'c6.3'],
  ['d0', 'c-5'], ['d1', 'c-1.5'], ['d2', 'c2'],
  ['d3', 'f1'], ['f1', 'f2'], ['f2', 'c-3.25'],
  ['d4', 'f3'], ['f3', 'f4'], ['f4', 'c0.4'],
  ['c2.6', 'nNeo'], ['nNeo', 'mNeo'],
  ['c6.3', 'nAtlas'], ['nAtlas', 'mAtlas'],
  ['c2', 'nZeno'], ['nZeno', 'mZeno'],
  ['f1', 'sA1'], ['sA1', 'sA2'], ['sA2', 'sofa'],
  ['c6.3', 'rak'],
  ['f2', 'pA'], ['pA', 'pB'], ['pB', 'f4'],
  ...NAV_EDGES_GEDUNG, // [BARU]
];

// Jalur terpendek dari posisi `dari` (titik mana pun di jalur agen) ke simpul `tujuan`.
// [PERBAIKAN] Titik awal = RUAS jalur terdekat (bukan simpul terdekat). Dengan banyak ruangan, simpul terdekat bisa saja berada
// di balik tembok; ruas terdekat selalu ruas yang sedang dilalui agen, jadi agen tidak pernah "melompat" menembus dinding.
function rencanaJalur(dari: [number, number], tujuan: string): [number, number][] {
  const names = Object.keys(NAV);
  const jarak = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ruas: [string, string] = NAV_EDGES[0];
  let terdekat = Infinity;
  for (const [a, b] of NAV_EDGES) {
    const A = NAV[a], B = NAV[b];
    const vx = B[0] - A[0], vz = B[1] - A[1];
    const t = Math.max(0, Math.min(1, ((dari[0] - A[0]) * vx + (dari[1] - A[1]) * vz) / (vx * vx + vz * vz || 1)));
    const d = jarak(dari, [A[0] + vx * t, A[1] + vz * t]);
    if (d < terdekat) { terdekat = d; ruas = [a, b]; }
  }
  const dist: Record<string, number> = {};
  const prev: Record<string, string | undefined> = {};
  names.forEach((n) => (dist[n] = Infinity));
  // dari titik agen, kedua ujung ruas itu bisa dituju
  ruas.forEach((n) => (dist[n] = jarak(dari, NAV[n])));
  const todo = new Set(names);
  while (todo.size) {
    let u = '';
    todo.forEach((n) => { if (!u || dist[n] < dist[u]) u = n; });
    todo.delete(u);
    if (u === tujuan || dist[u] === Infinity) break;
    for (const [a, b] of NAV_EDGES) {
      const v = a === u ? b : b === u ? a : null;
      if (v && todo.has(v) && dist[u] + jarak(NAV[u], NAV[v]) < dist[v]) { dist[v] = dist[u] + jarak(NAV[u], NAV[v]); prev[v] = u; }
    }
  }
  const out: [number, number][] = [];
  for (let n: string | undefined = tujuan; n; n = prev[n]) out.unshift(NAV[n]);
  return out;
}

// [BARU] Jalur khusus AI penghuni (agen Neo / Atlas / Zeno tetap memakai rencanaJalur di atas). Dua hal ditambahkan supaya rutenya banyak & tidak seragam:
//  1. Biaya tiap ruas diacak (+0..40%) tiap perjalanan, jadi AI memakai rute yang berbeda-beda bila ada lebih dari satu jalan
//     (mis. Planning <-> Management lewat pintu sekat di dalam ATAU lewat lorong 2; lorong samping A atau B).
//  2. Simpul lorong digeser ke kiri / kanan lebar lorong ("lajur" acak per perjalanan), jadi AI tidak semuanya berbaris di satu garis
//     dan bisa berpapasan di lorong 1 dan lorong 2 (depan Planning & Management). Geseran dibuat kecil agar tetap di lantai kosong
//     (perabot lorong 2 menempel di dinding: sisi utara z ~ 18.0, sisi selatan z ~ 20.7; jalan bebas ~ 18.3 .. 20.4).
function rencanaJalurPet(dari: [number, number], tujuan: string): [number, number][] {
  const names = Object.keys(NAV);
  const jarak = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ruas: [string, string] = NAV_EDGES[0];
  let terdekat = Infinity;
  for (const [a, b] of NAV_EDGES) {
    const A = NAV[a], B = NAV[b];
    const vx = B[0] - A[0], vz = B[1] - A[1];
    const t = Math.max(0, Math.min(1, ((dari[0] - A[0]) * vx + (dari[1] - A[1]) * vz) / (vx * vx + vz * vz || 1)));
    const d = jarak(dari, [A[0] + vx * t, A[1] + vz * t]);
    if (d < terdekat) { terdekat = d; ruas = [a, b]; }
  }
  const faktor: Record<string, number> = {};
  const bobot = (u: string, v: string) => {
    const k = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (faktor[k] === undefined) faktor[k] = 1 + Math.random() * 0.4;
    return jarak(NAV[u], NAV[v]) * faktor[k];
  };
  const dist: Record<string, number> = {};
  const prev: Record<string, string | undefined> = {};
  names.forEach((n) => (dist[n] = Infinity));
  ruas.forEach((n) => (dist[n] = jarak(dari, NAV[n])));
  const todo = new Set(names);
  while (todo.size) {
    let u = '';
    todo.forEach((n) => { if (!u || dist[n] < dist[u]) u = n; });
    todo.delete(u);
    if (u === tujuan || dist[u] === Infinity) break;
    for (const [a, b] of NAV_EDGES) {
      const v = a === u ? b : b === u ? a : null;
      if (v && todo.has(v)) { const w = dist[u] + bobot(u, v); if (w < dist[v]) { dist[v] = w; prev[v] = u; } }
    }
  }
  const lajur = Math.random() * 2 - 1; // -1 .. 1, sama untuk seluruh perjalanan supaya jalurnya tetap mulus
  const out: [number, number][] = [];
  for (let n: string | undefined = tujuan; n; n = prev[n]) {
    const p = NAV[n];
    if (n.startsWith('c2_')) out.unshift([p[0], p[1] + lajur * 0.45]);
    else if (n.startsWith('c1_')) out.unshift([p[0], p[1] + lajur * 0.3]);
    else if (n === 'cA_t' || n === 'cB_t') out.unshift([p[0] + lajur * 0.5, p[1]]);
    else out.unshift(p);
  }
  return out;
}

type Nav = {
  key: string; // 'k<meja>' = bekerja di meja halaman, 'r' = rapat, 's:<kegiatan>' = santai, 'j:<ruang>' = berkunjung ke ruangan lain
  path: [number, number][];
  i: number;
  phase: 'kerja' | 'rapat' | 'santai' | 'kunjung';
  meja: number;
  tiba: boolean;
  akhir: Wp; // posisi akhir (duduk di meja halaman / kursi rapat / tempat santai)
};

// [BARU] Semua perpindahan agen lewat satu fungsi ini: dari posisi `dari` ke tujuan sesuai kunci (tugas > rapat > santai).
function buatNav(key: string, dari: [number, number], name: string, route: Wp[]): Nav {
  if (key[0] === 'k') {
    const meja = Number(key.slice(1));
    const kursi = NAV[`d${meja}`];
    return {
      key, path: rencanaJalur(dari, `d${meja}`), i: 0, phase: 'kerja', meja, tiba: false,
      akhir: { p: kursi, face: Math.PI, sit: true, status: 'bekerja', seat: deskKey(DESKS[meja].p) },
    };
  }
  if (key === 'r') {
    return { key, path: rencanaJalur(dari, `m${name}`), i: 0, phase: 'rapat', meja: -1, tiba: false, akhir: route[0] };
  }
  if (key[0] === 'j') {
    // [BARU] berkunjung ke ruangan mana pun di gedung (AR, AP, Perpus, Santai, Asset, Studio, Planning, Management, Transactions)
    const simpul = simpulRuang(key.slice(2)) ?? 'pB';
    return { key, path: rencanaJalur(dari, simpul), i: 0, phase: 'kunjung', meja: -1, tiba: false, akhir: { p: NAV[simpul], status: 'santai' } };
  }
  const act = key.slice(2) as Act;
  const tujuan = act === 'sofa' ? 'sofa' : act === 'rak' ? 'rak' : 'pA';
  return {
    key, path: rencanaJalur(dari, tujuan), i: 0, phase: 'santai', meja: -1, tiba: false,
    akhir: { p: NAV[tujuan], face: act === 'sofa' ? 0 : act === 'rak' ? Math.PI : undefined, status: 'santai', act },
  };
}

// Posisi awal agen saat scene dibuka/di-refresh: langsung di tujuannya (meja tugas / kursi rapat / tempat santai), tanpa animasi jalan.
function bangunAwal(key: string, name: string, route: Wp[]): { pos: [number, number]; face: number; nav: Nav } {
  const nav = buatNav(key, route[0].p, name, route);
  nav.path = [nav.akhir.p];
  nav.i = 0;
  nav.tiba = true;
  return { pos: nav.akhir.p, face: nav.akhir.face ?? Math.PI, nav };
}

const SPEED = 1.7;
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const dotColor = (s: AgentStatus) => (s === 'bekerja' ? '#4ADE80' : s === 'rapat' ? '#38BDF8' : s === 'santai' ? '#C4B5FD' : '#FCD34D');

// Label nama di atas kepala (sprite dari canvas, selalu menghadap kamera & tidak tertutup benda lain).
// [BARU] Papan penanda di atas bangunan (selalu menghadap kamera, tidak tertutup apa pun).
function BuildingSign({ pos, text, accent = C.glow }: { pos: V3; text: string; accent?: string }) {
  const FONT = '800 88px Inter, system-ui, sans-serif';
  const { tex, width, height } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const padX = 70, H = 190, tip = 36;
    let tw = 700;
    if (ctx) {
      ctx.font = FONT;
      // jarak antar huruf sedikit dilebarkan
      (ctx as any).letterSpacing = '6px';
      tw = ctx.measureText(text).width;
    }
    canvas.width = Math.ceil(tw + padX * 2 + 16);
    canvas.height = H + tip;
    const g = canvas.getContext('2d');
    if (g) {
      (g as any).letterSpacing = '6px';
      const W = canvas.width;
      const bh = H - 16;
      // badan papan
      g.fillStyle = 'rgba(15,27,36,0.95)';
      g.beginPath();
      g.roundRect(8, 8, W - 16, bh, 40);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = accent;
      g.stroke();
      // segitiga penunjuk ke bawah
      g.fillStyle = 'rgba(15,27,36,0.95)';
      g.beginPath();
      g.moveTo(W / 2 - 30, 8 + bh - 2);
      g.lineTo(W / 2 + 30, 8 + bh - 2);
      g.lineTo(W / 2, 8 + bh + tip);
      g.closePath();
      g.fill();
      g.strokeStyle = accent;
      g.beginPath();
      g.moveTo(W / 2 - 30, 8 + bh);
      g.lineTo(W / 2, 8 + bh + tip);
      g.lineTo(W / 2 + 30, 8 + bh);
      g.stroke();
      // teks
      g.fillStyle = '#FFFFFF';
      g.font = FONT;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillText(text, W / 2, 8 + bh / 2 + 4);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const k = 1.1 / 512;
    return { tex, width: canvas.width * k, height: canvas.height * k };
  }, [text, accent]);
  return (
    <Billboard position={pos}>
      <mesh renderOrder={11} position={[0, height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={tex} transparent depthTest={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

function NameTag({ name, dot }: { name: string; dot: string }) {
  const FONT = '700 84px Inter, system-ui, sans-serif';
  const { canvas, tex, width } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let tw = 140;
    if (ctx) {
      ctx.font = FONT;
      tw = ctx.measureText(name).width;
    }
    canvas.width = Math.ceil(52 + tw + 44 + 18 + 36 + 16);
    canvas.height = 160;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex, width: (canvas.width * 1.3) / 512 };
  }, [name]);

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, 160);
    ctx.fillStyle = 'rgba(15,27,36,0.94)';
    ctx.beginPath();
    ctx.roundRect(8, 8, canvas.width - 16, 144, 36);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 52, 84);
    const w = ctx.measureText(name).width;
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(52 + w + 44, 80, 18, 0, Math.PI * 2);
    ctx.fill();
    tex.needsUpdate = true;
  }, [canvas, tex, name, dot]);

  return (
    <Billboard position={[0, 2.0, 0]}>
      <mesh renderOrder={10}>
        <planeGeometry args={[width, 0.41]} />
        <meshBasicMaterial map={tex} transparent depthTest={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

// ---- Bagian tubuh (bentuk membulat: kapsul, bola, silinder) ---------------------
type PartBase = { pos?: V3; rot?: V3; scale?: V3 | number; color: string; cast?: boolean; glow?: number };

function Mat({ color, glow }: { color: string; glow?: number }) {
  return glow ? (
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} />
  ) : (
    <meshLambertMaterial color={color} />
  );
}
function Cap({ pos, rot, scale, color, cast = true, glow, r, len }: PartBase & { r: number; len: number }) {
  return (
    <mesh position={pos} rotation={rot} scale={scale} castShadow={cast} receiveShadow>
      <capsuleGeometry args={[r, len, 6, 14]} />
      <Mat color={color} glow={glow} />
    </mesh>
  );
}
function Sph({ pos, rot, scale, color, cast = false, glow, r, seg = [18, 14] }: PartBase & { r: number; seg?: [number, number] }) {
  return (
    <mesh position={pos} rotation={rot} scale={scale} castShadow={cast} receiveShadow>
      <sphereGeometry args={[r, seg[0], seg[1]]} />
      <Mat color={color} glow={glow} />
    </mesh>
  );
}
function Cyl({ pos, rot, scale, color, cast = true, glow, r, rb, h, seg = 18 }: PartBase & { r: number; rb?: number; h: number; seg?: number }) {
  return (
    <mesh position={pos} rotation={rot} scale={scale} castShadow={cast} receiveShadow>
      <cylinderGeometry args={[r, rb ?? r, h, seg]} />
      <Mat color={color} glow={glow} />
    </mesh>
  );
}
function Torus({ pos, rot, scale, color, cast = false, r, tube }: PartBase & { r: number; tube: number }) {
  return (
    <mesh position={pos} rotation={rot} scale={scale} castShadow={cast}>
      <torusGeometry args={[r, tube, 8, 24]} />
      <Mat color={color} />
    </mesh>
  );
}
function RBox({ pos, rot, color, cast = true, glow, size, radius = 0.05 }: PartBase & { size: V3; radius?: number }) {
  return (
    <RoundedBox args={size} radius={radius} smoothness={3} position={pos} rotation={rot} castShadow={cast} receiveShadow>
      <Mat color={color} glow={glow} />
    </RoundedBox>
  );
}

type GRef = React.RefObject<THREE.Group | null>;
type Rig = {
  body: GRef; chest: GRef; legL: GRef; legR: GRef; shinL: GRef; shinR: GRef;
  armL: GRef; armR: GRef; head: GRef; eyeL: GRef; eyeR: GRef; mouth: GRef; core: GRef; tail: GRef;
};

// Hewan gemuk & lucu (chibi): badan telur besar, kaki pendek, kepala besar. Rakun (Atlas) = bulu abu perak, topeng mata gelap,
// pipi gembul, telinga bulat, ekor belang, ID card bertali teal. Rubah (Zeno) = bulu oranye, telinga lancip, pipi & dada krem,
// ekor lebat berujung putih, syal hijau. Memakai rig yang sama dengan robot (body/chest/leg/shin/arm/head/eye/mouth) + ekor,
// jadi semua animasi (jalan, duduk, ngetik, tiduran di sofa, baca buku, joget, bicara saat rapat) otomatis berlaku.
function AnimalBody({ look, rig }: { look: Look; rig: Rig }) {
  const rakun = look.kind === 'rakun';
  const belly = look.belly ?? '#F3E6D0';
  const dark = look.dark ?? '#2B2B2B';
  const accent = look.accent ?? '#2F7D5B';
  const lower = look.legs; // kaki bawah, telapak tangan & kaki

  // Ekor: rantai bola yang membesar di tengah lalu mengecil. Rakun = belang abu/gelap, rubah = oranye berujung putih.
  const tail = rakun
    ? { r: [0.085, 0.11, 0.122, 0.112, 0.08], z: [-0.1, -0.22, -0.35, -0.47, -0.57], y: [0.0, 0.02, 0.05, 0.09, 0.14], c: [look.torso, dark, look.torso, dark, dark] }
    : { r: [0.11, 0.15, 0.17, 0.15, 0.11], z: [-0.1, -0.25, -0.41, -0.57, -0.7], y: [0.0, 0.03, 0.07, 0.12, 0.19], c: [look.torso, look.torso, look.torso, look.torso, belly] };

  return (
    <group ref={rig.body}>
      {/* kaki pendek & gempal: paha, betis, telapak + jari */}
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? rig.legL : rig.legR} position={[side * 0.16, 0.42, 0]}>
          <Cap pos={[0, -0.08, 0]} r={0.105} len={0.05} color={look.torso} />
          <group ref={side < 0 ? rig.shinL : rig.shinR} position={[0, -0.17, 0]}>
            <Cap pos={[0, -0.04, 0]} r={0.088} len={0.06} color={lower} />
            <Sph pos={[0, -0.19, 0.035]} r={0.088} scale={[1, 0.62, 1.35]} color={lower} cast />
            {[-1, 0, 1].map((j) => (
              <Sph key={j} pos={[j * 0.04, -0.2, 0.135]} r={0.026} scale={[1, 0.7, 1]} color={lighten(lower, 0.07)} />
            ))}
          </group>
        </group>
      ))}

      {/* ekor (bergoyang, lihat Agent) */}
      <group ref={rig.tail} position={[0, 0.4, -0.2]} rotation={[0.6, 0, 0]}>
        {tail.r.map((r, i) => (
          <Sph key={i} pos={[0, tail.y[i], tail.z[i]]} r={r} scale={[1, 1, 1.15]} color={tail.c[i]} cast />
        ))}
      </group>

      {/* badan bulat gemuk (ikut "bernapas") + perut terang */}
      <group ref={rig.chest} position={[0, 0.66, 0]}>
        <Sph r={0.33} scale={[1.08, 1.0, 0.8]} color={look.torso} cast seg={[40, 30]} />
        <Sph pos={[0, -0.05, 0.1]} r={0.3} scale={[0.82, 0.92, 0.62]} color={belly} seg={[40, 30]} />
        {rakun ? (
          <>
            {/* ID card karyawan bertali teal */}
            <Box pos={[0.055, 0.15, 0.255]} size={[0.016, 0.15, 0.01]} rot={[-0.4, 0, -0.22]} color={accent} cast={false} />
            <Box pos={[0.085, 0.015, 0.295]} size={[0.1, 0.13, 0.012]} rot={[-0.12, 0.12, 0]} color="#FFFFFF" cast={false} />
            <Box pos={[0.085, 0.052, 0.302]} size={[0.1, 0.03, 0.006]} rot={[-0.12, 0.12, 0]} color={accent} cast={false} />
          </>
        ) : (
          <>
            {/* syal hijau + ujung yang menjuntai */}
            <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.3} tube={0.052} color={accent} cast />
            <Box pos={[0.13, 0.02, 0.29]} size={[0.1, 0.2, 0.03]} rot={[-0.22, 0, -0.12]} color={accent} cast={false} />
            <Box pos={[0.13, -0.055, 0.306]} size={[0.1, 0.03, 0.01]} rot={[-0.22, 0, -0.12]} color={lighten(accent, 0.18)} cast={false} />
          </>
        )}
      </group>

      {/* lengan pendek: bahu, lengan, telapak gelap */}
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? rig.armL : rig.armR} position={[side * 0.33, 0.84, 0.06]} rotation={[0, 0, side * 0.05]}>
          <Sph r={0.075} color={look.arms} cast />
          <Cap pos={[0, -0.1, 0]} r={0.07} len={0.1} color={look.arms} />
          <Sph pos={[0, -0.225, 0.01]} r={0.078} scale={[1, 0.95, 1]} color={lower} cast />
        </group>
      ))}

      {/* kepala besar */}
      <group ref={rig.head} position={[0, 1.05, 0]}>
        <Sph r={0.26} scale={[1.12, 0.9, 1.0]} color={look.head} cast />

        {rakun ? (
          <>
            {/* pipi gembul, telinga bulat */}
            {[-1, 1].map((sd) => (
              <Sph key={`pipi${sd}`} pos={[sd * 0.235, -0.075, 0.03]} r={0.1} scale={[0.75, 0.85, 0.95]} color={belly} />
            ))}
            {[-1, 1].map((sd) => (
              <group key={`telinga${sd}`} position={[sd * 0.19, 0.205, -0.02]} rotation={[0, 0, -sd * 0.3]}>
                <Sph r={0.088} scale={[1, 1.05, 0.62]} color={lighten(look.torso, -0.12)} cast />
                <Sph pos={[0, 0, 0.026]} r={0.058} scale={[0.9, 0.95, 0.4]} color="#EADBD5" />
              </group>
            ))}
            {/* topeng mata gelap + bintik alis putih */}
            {[-1, 1].map((sd) => (
              <Sph key={`topeng${sd}`} pos={[sd * 0.112, 0.03, 0.2]} rot={[0, sd * 0.35, -sd * 0.25]} r={0.095} scale={[1.35, 0.95, 0.55]} color={dark} />
            ))}
            {[-1, 1].map((sd) => (
              <Sph key={`alis${sd}`} pos={[sd * 0.115, 0.125, 0.205]} r={0.026} scale={[1.5, 0.7, 0.6]} color="#F2F4F5" />
            ))}
            {/* moncong putih + hidung */}
            <Sph pos={[0, -0.085, 0.2]} r={0.105} scale={[1.2, 0.85, 0.95]} color={belly} />
            <Sph pos={[0, -0.045, 0.295]} r={0.035} scale={[1.3, 0.9, 0.9]} color="#1B1E22" />
            {/* mata: putih + pupil + kilau (bisa berkedip) */}
            {[-1, 1].map((sd) => (
              <group key={`mata${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.112, 0.03, 0.256]}>
                <Sph r={0.036} scale={[1, 1.1, 0.5]} color="#FFFFFF" />
                <Sph pos={[0, 0, 0.012]} r={0.024} scale={[1, 1.05, 0.5]} color="#14161A" />
                <Sph pos={[0.008, 0.01, 0.02]} r={0.008} color="#FFFFFF" />
              </group>
            ))}
            <group ref={rig.mouth} position={[0, -0.128, 0.285]}>
              <Sph r={0.024} scale={[1.3, 0.3, 0.4]} color="#5C2B2B" />
            </group>
          </>
        ) : (
          <>
            {/* telinga lancip berujung gelap, pipi krem berbulu */}
            {[-1, 1].map((sd) => (
              <group key={`telinga${sd}`} position={[sd * 0.17, 0.285, -0.03]} rotation={[-0.1, 0, -sd * 0.3]}>
                <Cyl r={0.004} rb={0.105} h={0.3} scale={[1, 1, 0.5]} seg={16} color={look.head} />
                <Cyl pos={[0, -0.015, 0.03]} r={0.004} rb={0.075} h={0.22} scale={[1, 1, 0.4]} seg={16} color={belly} cast={false} />
                <Cyl pos={[0, 0.1, 0]} r={0.004} rb={0.041} h={0.1} scale={[1, 1, 0.54]} seg={16} color={dark} cast={false} />
              </group>
            ))}
            {[-1, 1].map((sd) => (
              <Sph key={`pipi${sd}`} pos={[sd * 0.165, -0.075, 0.11]} r={0.092} scale={[0.85, 0.72, 0.85]} color={belly} />
            ))}
            {/* moncong lancip, hidung hitam, pipi merona */}
            <Sph pos={[0, -0.045, 0.26]} r={0.085} scale={[0.85, 0.72, 1.25]} color={look.head} cast />
            <Sph pos={[0, -0.09, 0.25]} r={0.075} scale={[0.9, 0.6, 1.2]} color={belly} />
            <Sph pos={[0, -0.015, 0.355]} r={0.03} scale={[1.3, 0.9, 0.9]} color="#1B1B1B" />
            {[-1, 1].map((sd) => (
              <Sph key={`merona${sd}`} pos={[sd * 0.165, -0.035, 0.205]} r={0.03} scale={[1, 0.6, 0.35]} color="#F4A9A0" />
            ))}
            {/* mata hitam berkilau (bisa berkedip) */}
            {[-1, 1].map((sd) => (
              <group key={`mata${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.105, 0.04, 0.236]}>
                <Sph r={0.034} scale={[1, 1.25, 0.5]} color="#1A1210" />
                <Sph pos={[0.01, 0.014, 0.014]} r={0.01} color="#FFFFFF" />
              </group>
            ))}
            <group ref={rig.mouth} position={[0, -0.103, 0.31]}>
              <Sph r={0.022} scale={[1.3, 0.3, 0.4]} color="#5C2B2B" />
            </group>
          </>
        )}
      </group>
    </group>
  );
}

// Robot: bentuk humanoid membulat (RoundedBox + kapsul), visor gelap, mata & mulut LED, inti dada berdenyut.
function RobotBody({ look, rig, dot }: { look: Look; rig: Rig; dot: string }) {
  const dark = '#14283F';
  return (
    <group ref={rig.body}>
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? rig.legL : rig.legR} position={[side * 0.11, 0.5, 0]}>
          <Cap pos={[0, -0.125, 0]} r={0.07} len={0.11} color={look.legs} />
          <group ref={side < 0 ? rig.shinL : rig.shinR} position={[0, -0.25, 0]}>
            <Sph r={0.065} color={dark} cast />
            <Cap pos={[0, -0.125, 0]} r={0.06} len={0.13} color={look.legs} />
            <RBox pos={[0, -0.215, 0.04]} size={[0.14, 0.07, 0.25]} radius={0.03} color={dark} />
            <Box pos={[0, -0.215, 0.04]} size={[0.145, 0.012, 0.15]} color={C.glow} cast={false} />
          </group>
        </group>
      ))}
      <Cyl pos={[0, 0.54, 0]} r={0.17} h={0.07} scale={[1, 1, 0.7]} color={dark} />

      <group ref={rig.chest} position={[0, 0.78, 0]}>
        <RBox size={[0.46, 0.52, 0.3]} radius={0.1} color={look.torso} />
        <RBox pos={[0, 0.04, 0.147]} size={[0.28, 0.26, 0.03]} radius={0.05} color="#0A1620" cast={false} />
        <group ref={rig.core} position={[0, 0.04, 0.17]}>
          <Cyl rot={[Math.PI / 2, 0, 0]} r={0.065} h={0.02} color={C.glow} glow={1.4} cast={false} />
          <Torus r={0.085} tube={0.008} color={look.arms} />
        </group>
        <Box pos={[0, -0.17, 0.152]} size={[0.2, 0.025, 0.01]} color={look.arms} cast={false} />
      </group>

      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? rig.armL : rig.armR} position={[side * 0.3, 0.98, 0]}>
          <Sph r={0.09} color={look.arms} cast />
          <Cap pos={[0, -0.13, 0]} r={0.05} len={0.12} color={look.arms} />
          <Sph pos={[0, -0.215, 0]} r={0.055} color={dark} />
          <Cap pos={[0, -0.3, 0]} r={0.045} len={0.07} color={look.arms} />
          <RBox pos={[0, -0.39, 0]} size={[0.095, 0.09, 0.095]} radius={0.035} color={dark} />
        </group>
      ))}

      <Cyl pos={[0, 1.06, 0]} r={0.06} h={0.08} color={dark} />

      <group ref={rig.head} position={[0, 1.22, 0]}>
        <RBox size={[0.5, 0.4, 0.42]} radius={0.13} color={look.head} />
        <RBox pos={[0, 0, 0.19]} size={[0.4, 0.27, 0.06]} radius={0.1} color="#0A1620" cast={false} />
        {[-1, 1].map((sd) => (
          <group key={sd} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.09, 0.025, 0.225]}>
            <Cap r={0.028} len={0.05} color={C.glow} glow={1.4} cast={false} />
          </group>
        ))}
        <group ref={rig.mouth} position={[0, -0.07, 0.222]}>
          <Box pos={[0, 0, 0]} size={[0.07, 0.014, 0.01]} color={C.glow} cast={false} />
        </group>
        {[-1, 1].map((sd) => (
          <group key={sd} position={[sd * 0.27, 0, 0]}>
            <Cyl rot={[0, 0, Math.PI / 2]} r={0.075} h={0.05} color={dark} />
            <Cyl pos={[sd * 0.028, 0, 0]} rot={[0, 0, Math.PI / 2]} r={0.045} h={0.01} color={C.glow} glow={0.8} cast={false} />
          </group>
        ))}
        <Cyl pos={[0, 0.29, 0]} r={0.012} h={0.18} color={dark} />
        <Sph pos={[0, 0.4, 0]} r={0.05} color={dot} glow={1} />
      </group>
    </group>
  );
}

// Buku yang dibaca agen (ditempel di root agen; posisinya diatur tiap frame sesuai pose).
function ReadingBook({ gref, color }: { gref: GRef; color: string }) {
  return (
    <group ref={gref} visible={false}>
      <Box pos={[0, 0, 0]} size={[0.17, 0.03, 0.23]} color="#F4EFE0" cast={false} />
      <Box pos={[0, 0.019, 0]} size={[0.18, 0.012, 0.24]} color={color} cast={false} />
      <Box pos={[-0.09, 0, 0]} size={[0.012, 0.045, 0.24]} color={lighten(color, -0.08)} cast={false} />
    </group>
  );
}

// Penyesuaian pose per bentuk tubuh (robot / hewan gemuk): turunan badan saat duduk (negatif = badan terangkat karena kaki pendek),
// tinggi badan saat tiduran di sofa, tekukan betis saat duduk, geser maju saat duduk (perut gemuk tidak menabrak sandaran kursi),
// sudut lengan & posisi buku saat membaca.
const POSE = {
  robot: { sitDrop: 0.07, lieY: 0.72, shinSit: Math.PI / 2, fwdSit: 0, readZ: 0.5, lieReadZ: 0.35, bookY: 0.98, bookYLie: 1.15, bookZ: 0.5, bookZLie: -1.0 },
  hewan: { sitDrop: -0.05, lieY: 0.8, shinSit: Math.PI / 2 - 0.45, fwdSit: 0.09, readZ: 0.95, lieReadZ: 0.6, bookY: 0.86, bookYLie: 1.25, bookZ: 0.36, bookZLie: -0.8 },
};

function Agent({
  name,
  look,
  route,
  onStatus,
  still,
  meeting,
  tugas = null,
  kunjungan = null,
  actMs,
}: {
  name: string;
  look: Look;
  route: Wp[];
  onStatus?: (name: string, s: AgentStatus) => void;
  still: boolean;
  meeting: boolean;
  tugas?: number | null; // nomor meja halaman yang sedang dikerjakan (0..4), null = tidak ada tugas
  kunjungan?: string | null; // [BARU] nama ruangan yang sedang dikunjungi (lihat RUANG_TUJUAN), null = tidak berkunjung
  actMs: number; // lama tiap giliran kegiatan santai (default 20 menit)
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Group>(null);
  const eyeR = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const book = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Group>(null);
  const seed = useMemo(() => Array.from(name).reduce((a, ch) => a + ch.charCodeAt(0), 0) * 0.37, [name]);
  const rig: Rig = { body, chest, legL, legR, shinL, shinR, armL, armR, head, eyeL, eyeR, mouth, core, tail };
  const awal = useRef<ReturnType<typeof bangunAwal> | null>(null);
  if (!awal.current) {
    const keyAwal = tugas !== null && tugas !== undefined ? `k${tugas}` : meeting ? 'r' : `s:${aktivitasSaatIni(name, actMs)}`;
    awal.current = bangunAwal(keyAwal, name, route);
  }
  const akhirAwal = awal.current.nav.akhir;
  const st = useRef({
    sit: akhirAwal.sit ? 1 : 0,
    walk: 0,
    lie: akhirAwal.act === 'sofa' ? 1 : 0,
    read: akhirAwal.act === 'sofa' || akhirAwal.act === 'rak' ? 1 : 0,
    dance: akhirAwal.act === 'main' ? 1 : 0,
    lastStatus: '' as string,
    nav: awal.current.nav as Nav,
    seatNav: (awal.current.nav.phase === 'kerja' ? awal.current.nav.akhir.seat ?? null : null) as string | null,
    mainTimer: -1, // hitung mundur joget di ujung jalur (area main)
    mainEnd: 0, // 0 = ujung pA, 1 = ujung pB
  });
  // [PERBAIKAN BUG LAYAR MENYALA TERUS] SEAT adalah variabel level-modul, jadi nilainya TIDAK ikut hilang saat komponen
  // di-unmount (pindah halaman / hot reload). Bersihkan semua kursi milik agen ini saat unmount.
  useEffect(() => {
    const s = st.current;
    return () => {
      for (const w of route) if (w.seat) SEAT[w.seat] = 0;
      if (s.seatNav) SEAT[s.seatNav] = 0;
    };
  }, [route]);
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;
  const tugasRef = useRef(tugas);
  tugasRef.current = tugas;
  const kunjunganRef = useRef(kunjungan);
  kunjunganRef.current = kunjungan;
  const [label, setLabel] = React.useState<AgentStatus>(akhirAwal.status);
  const robot = look.kind === 'robot';
  const P = robot ? POSE.robot : POSE.hewan;

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = st.current;
    const g = root.current;
    if (!g) return;

    let moving = false;
    const posisi = (): [number, number] => [g.position.x, g.position.z];

    // Prioritas tujuan: tugas halaman (meja kerja) > rapat (meja rapat) > kunjungan ke ruangan lain > santai (sofa / rak buku / area joget).
    // [PENGECUALIAN RAPAT] Selama meeting, agen tetap di kursi rapat KECUALI ia punya tugas: ia berdiri, berjalan ke meja halaman,
    // bekerja, lalu otomatis kembali ke kursi rapatnya begitu tugas selesai (tugas null -> want = 'r' lagi).
    if (!still) {
      const mau = tugasRef.current;
      const want = mau !== null && mau !== undefined ? `k${mau}` : meetingRef.current ? 'r' : kunjunganRef.current ? `j:${kunjunganRef.current}` : `s:${aktivitasSaatIni(name, actMs)}`;
      if (s.nav.key !== want) {
        s.nav = buatNav(want, posisi(), name, route);
        s.mainTimer = -1;
        s.mainEnd = 0;
      }
    }

    const nv = s.nav;
    if (!nv.tiba) {
      const tujuan = nv.path[nv.i];
      const dx = tujuan[0] - g.position.x;
      const dz = tujuan[1] - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        if (nv.i >= nv.path.length - 1) nv.tiba = true;
        else nv.i += 1;
      } else {
        moving = true;
        const step = Math.min(SPEED * dt, dist);
        g.position.x += (dx / dist) * step;
        g.position.z += (dz / dist) * step;
        g.rotation.y += angleDiff(g.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      }
    } else if (!still && nv.phase === 'santai' && nv.akhir.act === 'main') {
      // area main: joget di satu ujung beberapa detik, lalu berjalan ke ujung satunya (mondar-mandir)
      if (s.mainTimer < 0) s.mainTimer = 4.5 + ((t * 7 + seed) % 2);
      s.mainTimer -= dt;
      if (s.mainTimer <= 0) {
        s.mainTimer = -1;
        s.mainEnd = 1 - s.mainEnd;
        const tujuan = s.mainEnd ? 'pB' : 'pA';
        nv.path = rencanaJalur(posisi(), tujuan);
        nv.i = 0;
        nv.tiba = false;
        nv.akhir = { ...nv.akhir, p: NAV[tujuan] };
      }
    }

    g.position.y = naikDi(g.position.x, g.position.z); // [BARU] ikut naik bila ruangannya sedang difokuskan
    POS_AGEN[name] = [g.position.x, g.position.z];

    const cur: Wp = nv.tiba ? nv.akhir : { p: nv.path[nv.i], status: nv.phase === 'santai' ? 'santai' : 'berjalan' };
    if (!moving && cur.face !== undefined) {
      g.rotation.y += angleDiff(g.rotation.y, cur.face) * Math.min(1, dt * 6);
    }

    const act = nv.tiba && !moving && nv.phase === 'santai' ? nv.akhir.act : undefined;
    const k = (v: number) => Math.min(1, dt * v);
    s.sit += ((!moving && nv.tiba && cur.sit ? 1 : 0) - s.sit) * k(6);
    s.walk += ((moving ? 1 : 0) - s.walk) * k(8);
    s.lie += ((act === 'sofa' ? 1 : 0) - s.lie) * k(3);
    s.read += ((act === 'sofa' || act === 'rak' ? 1 : 0) - s.read) * k(4);
    s.dance += ((act === 'main' ? 1 : 0) - s.dance) * k(5);

    for (const w of route) if (w.seat) SEAT[w.seat] = w === cur && !moving ? s.sit : 0;
    // layar meja halaman menyala selama agen duduk di situ
    const kunciNav = nv.phase === 'kerja' ? nv.akhir.seat ?? null : null;
    if (s.seatNav && s.seatNav !== kunciNav) SEAT[s.seatNav] = 0;
    if (kunciNav) SEAT[kunciNav] = nv.tiba && !moving ? s.sit : 0;
    s.seatNav = kunciNav;

    const { sit, walk, lie, read, dance } = s;
    const playful = nv.phase === 'santai' && nv.akhir.act === 'main' ? 1 : 0; // jalan sambil "bermain": ayunan & lompatan lebih besar
    const swing = Math.sin(t * 9) * (0.65 + 0.5 * playful) * walk;
    const mix = (a: number, b: number, w: number) => a + (b - a) * w;

    // joget: gerakan berganti tiap 5 detik (0 = goyang tangan ke atas, 1 = jingkrak, 2 = berputar)
    const move = Math.floor((t + seed * 3) / 5) % 3;
    const ds = Math.sin(t * 7);
    const jump = Math.abs(Math.sin(t * 5.5));
    if (move === 2 && dance > 0.3) g.rotation.y += dt * 3.2 * dance;

    // badan: duduk menurunkan badan; tiduran = badan diputar telentang & diangkat ke atas dudukan sofa
    let bodyY = -P.sitDrop * sit + Math.abs(Math.sin(t * 9)) * (0.04 + 0.05 * playful) * walk + P.lieY * lie;
    if (dance > 0.01) bodyY += (move === 1 ? jump * 0.2 : Math.abs(ds) * 0.05) * dance;
    if (body.current) {
      body.current.position.y = bodyY;
      body.current.position.z = P.fwdSit * sit * (1 - lie); // hewan gemuk duduk sedikit maju
      body.current.rotation.x = -(Math.PI / 2) * lie;
      body.current.rotation.y = move === 2 ? 0 : Math.sin(t * 3.5) * 0.3 * dance;
      body.current.rotation.z = Math.sin(t * 3.5) * 0.1 * dance + Math.sin(t * 0.6 + seed) * 0.025 * read * (1 - lie) + (robot ? 0 : Math.sin(t * 9) * 0.08 * walk); // hewan: jalan ala bebek (goyang kiri-kanan)
    }

    // kaki: tiduran = kaki kiri diangkat (lutut ditekuk, telapak kaki goyang pelan), kaki kanan lurus
    const stepL = (move === 1 ? -jump * 0.55 : ds * 0.45) * dance;
    const stepR = (move === 1 ? -jump * 0.55 : -ds * 0.45) * dance;
    const knee = (move === 1 ? jump * 0.9 : 0) * dance;
    if (legL.current) legL.current.rotation.x = mix(swing * (1 - sit) - (Math.PI / 2) * sit + stepL, -1.15, lie);
    if (legR.current) legR.current.rotation.x = mix(-swing * (1 - sit) - (Math.PI / 2) * sit + stepR, 0, lie);
    if (shinL.current) shinL.current.rotation.x = mix(P.shinSit * sit + knee, 2.15 + Math.sin(t * 1.3) * 0.1, lie);
    if (shinR.current) shinR.current.rotation.x = mix(P.shinSit * sit + knee, 0.12, lie);

    // lengan: mengetik / memegang buku / joget
    const typing = sit > 0.9 && cur.status === 'bekerja';
    const armBase = sit * (cur.status === 'bekerja' ? -1.15 : -0.5);
    const readX = mix(-1.15, -1.5, lie) + Math.sin(t * 0.7 + seed) * 0.03;
    const readZ = mix(P.readZ, P.lieReadZ, lie);
    let dXL: number, dXR: number, dZ: number;
    if (move === 0) { dXL = -2.6 + Math.sin(t * 7 + Math.PI) * 0.4; dXR = -2.6 + ds * 0.4; dZ = 0.35; }
    else if (move === 1) { dXL = -1.5 + Math.sin(t * 11) * 0.7; dXR = -1.5 - Math.sin(t * 11) * 0.7; dZ = 0.15; }
    else { dXL = -0.1; dXR = -0.1; dZ = 1.35; }
    const aLx = -swing * (1 - sit) + armBase + (typing ? Math.sin(t * 15) * 0.1 : 0);
    const aRx = swing * (1 - sit) + armBase + (typing ? Math.sin(t * 15 + 2) * 0.1 : 0);
    if (armL.current) {
      armL.current.rotation.x = mix(mix(aLx, readX, read), dXL, dance);
      armL.current.rotation.z = mix(mix(-0.05, readZ, read), -dZ, dance);
    }
    if (armR.current) {
      armR.current.rotation.x = mix(mix(aRx, readX, read), dXR, dance);
      armR.current.rotation.z = mix(mix(0.05, -readZ, read), dZ, dance);
    }
    if (head.current) {
      head.current.rotation.y = (cur.status === 'rapat' && sit > 0.9 ? Math.sin(t * 0.8) * 0.25 : 0) + Math.sin(t * 0.5 + seed) * 0.08 * read * (1 - lie);
      head.current.rotation.x = (typing ? 0.12 : 0) + 0.28 * read * (1 - lie);
      head.current.rotation.z = Math.sin(t * 7) * 0.1 * dance;
    }

    // buku: berdiri di depan dada (di rak) atau datar di atas wajah (tiduran)
    if (book.current) {
      book.current.visible = read > 0.05;
      book.current.position.set(0, mix(P.bookY, P.bookYLie, lie), mix(P.bookZ, P.bookZLie, lie));
      book.current.rotation.set(mix(Math.PI / 2 - 0.3, 0.2, lie), 0, 0);
    }
    // label nama ikut naik ke atas kepala saat tiduran
    if (tag.current) tag.current.position.set(0, -0.95 * lie, -1.25 * lie);

    // berkedip, bernapas, bicara saat rapat, inti robot berdenyut
    const blink = (t + seed) % 4.3 < 0.13 ? 0.1 : 1;
    if (eyeL.current) eyeL.current.scale.y = blink;
    if (eyeR.current) eyeR.current.scale.y = blink;
    if (chest.current) chest.current.scale.y = 1 + Math.sin(t * 1.8 + seed) * 0.012;
    const talking = cur.status === 'rapat' && sit > 0.9 && Math.sin(t * 0.55 + seed * 3) > -0.2;
    if (mouth.current) {
      const open = talking ? Math.abs(Math.sin(t * 11 + seed)) : 0;
      if (robot) mouth.current.scale.x = talking ? 0.5 + open * 0.9 : 1;
      else mouth.current.scale.y = 1 + open * 2.6;
    }
    if (core.current) core.current.scale.setScalar(1 + Math.sin(t * 3 + seed) * 0.08);
    // ekor hewan: bergoyang pelan saat diam, cepat saat jalan / joget; terkulai saat duduk
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * (2.2 + 7 * walk + 4 * dance) + seed) * (0.14 + 0.2 * walk + 0.3 * dance);
      tail.current.rotation.x = 0.6 - 0.8 * sit - 0.2 * lie;
      // duduk di kursi: ekor dipendekkan & ditarik ke depan supaya tertutup sandaran kursi (tidak menembus)
      tail.current.scale.z = 1 - 0.92 * sit * (1 - lie);
      tail.current.position.z = -0.2 + 0.1 * sit * (1 - lie);
    }

    if (s.lastStatus !== cur.status) {
      s.lastStatus = cur.status;
      setLabel(cur.status);
      onStatus?.(name, cur.status);
    }
  });

  const dot = dotColor(label);

  return (
    <group ref={root} userData={{ nolod: true }} position={[awal.current.pos[0], 0, awal.current.pos[1]]} rotation={[0, awal.current.face, 0]}>
      {robot ? <RobotBody look={look} rig={rig} dot={dot} /> : <AnimalBody look={look} rig={rig} />}
      <ReadingBook gref={book} color={BOOK_COLOR[name] ?? '#C9453B'} />
      <group ref={tag}>
        <NameTag name={name} dot={dot} />
      </group>
    </group>
  );
}

// ---- [BARU] 3 AI penghuni Perpustakaan (hanya tampilan): Nova = kucing, Aria = kelinci, Echo = panda ----
// [BARU] 9 AI penghuni baru: ruang Asset (Axiom = burung hantu, Byte = penguin, Cipher = beruang, Delta = kapibara)
//        dan ruang biru Studio (Flux = koala, Gamma = hamster, Helix = shiba, Ion = domba, Juno = bebek).
type PetKind = 'kucing' | 'kelinci' | 'panda' | 'hantu' | 'penguin' | 'beruang' | 'kapibara' | 'koala' | 'hamster' | 'shiba' | 'domba' | 'bebek' | 'singa' | 'gajah' | 'kodok' | 'babi' | 'sapi' | 'harimau' | 'berangberang' | 'landak' | 'monyet' | 'kuda' | 'tupai' | 'rusa' | 'alpaka' | 'axolotl' | 'kura';
type PetName = 'Nova' | 'Aria' | 'Echo' | 'Axiom' | 'Byte' | 'Cipher' | 'Delta' | 'Flux' | 'Gamma' | 'Helix' | 'Ion' | 'Juno' | 'Kilo' | 'Lumen' | 'Matrix' | 'Nexus' | 'Omni' | 'Pixel' | 'Quark' | 'Radian' | 'Sigma' | 'Tensor' | 'Vector' | 'Orion' | 'Theta' | 'Kappa' | 'Omega';
type PetLook = {
  kind: PetKind; fur: string; head: string; belly: string; dark: string; accent: string; inner: string;
  arms: string; legs: string; paws: string;
  hands?: string; // warna telapak tangan; kalau kosong = paws (paws juga dipakai untuk kaki)
};
const PET_LOOK: Record<PetName, PetLook> = {
  Nova: { kind: 'kucing', fur: '#3A3548', head: '#413B52', belly: '#6B6580', dark: '#1B1824', accent: '#F59E0B', inner: '#F4A9B8', arms: '#3A3548', legs: '#3A3548', paws: '#F3EFEA' },
  Aria: { kind: 'kelinci', fur: '#F6E8EE', head: '#F8ECF1', belly: '#FFFFFF', dark: '#2A1A22', accent: '#EC6FA5', inner: '#F9A8C9', arms: '#F6E8EE', legs: '#F6E8EE', paws: '#FFFFFF' },
  Echo: { kind: 'panda', fur: '#F4F4F1', head: '#F7F7F4', belly: '#FFFFFF', dark: '#22232B', accent: '#22C55E', inner: '#4B4D59', arms: '#22232B', legs: '#22232B', paws: '#2E3039' },
  // ---- ruang Asset ----
  Axiom: { kind: 'hantu', fur: '#8D6E4F', head: '#957554', belly: '#F0DFC2', dark: '#2B1F16', accent: '#2FA39A', inner: '#F4A93B', arms: '#7C5F43', legs: '#7C5F43', paws: '#F4A93B', hands: '#7C5F43' },
  Byte: { kind: 'penguin', fur: '#2A3552', head: '#2F3B5C', belly: '#FFFFFF', dark: '#11151F', accent: '#E5484D', inner: '#F5A524', arms: '#2A3552', legs: '#2A3552', paws: '#F5A524', hands: '#2A3552' },
  Cipher: { kind: 'beruang', fur: '#8A5A3C', head: '#93623F', belly: '#EBCBA3', dark: '#2B1B12', accent: '#D94F4F', inner: '#C98F6A', arms: '#8A5A3C', legs: '#6F452C', paws: '#6F452C' },
  Delta: { kind: 'kapibara', fur: '#B98B5E', head: '#C09266', belly: '#D9B88C', dark: '#2B1B12', accent: '#F28C28', inner: '#7A5233', arms: '#B98B5E', legs: '#9C7249', paws: '#9C7249' },
  // ---- ruang biru (Studio) ----
  Flux: { kind: 'koala', fur: '#9CA3AF', head: '#A5ACB8', belly: '#F1F2F5', dark: '#2B2F3A', accent: '#4CAF50', inner: '#EFE3E3', arms: '#9CA3AF', legs: '#8A919D', paws: '#7F8692' },
  Gamma: { kind: 'hamster', fur: '#EBC28B', head: '#EFC890', belly: '#FFF6E8', dark: '#D49A55', accent: '#B9792E', inner: '#F6A5B5', arms: '#EBC28B', legs: '#EBC28B', paws: '#FFF6E8' },
  Helix: { kind: 'shiba', fur: '#E0933F', head: '#E59B48', belly: '#FFF3E0', dark: '#4A2E1A', accent: '#D94F4F', inner: '#6A3F22', arms: '#E0933F', legs: '#C97F32', paws: '#FFF3E0' },
  Ion: { kind: 'domba', fur: '#F8F4EC', head: '#4B4350', belly: '#FFFDF8', dark: '#1E1A22', accent: '#F28CB1', inner: '#F4A9B8', arms: '#4B4350', legs: '#4B4350', paws: '#3A3340', hands: '#4B4350' },
  Juno: { kind: 'bebek', fur: '#FFD84D', head: '#FFDF5E', belly: '#FFF0A8', dark: '#2B2410', accent: '#4C8FBF', inner: '#FF9A2E', arms: '#FFD84D', legs: '#FFD84D', paws: '#FF9A2E', hands: '#FFD84D' },
  // ---- ruang Account Receivable ----
  Kilo: { kind: 'singa', fur: '#E3A640', head: '#E8AE48', belly: '#FBE7BF', dark: '#9A5B22', accent: '#D94F4F', inner: '#F4A9B8', arms: '#E3A640', legs: '#C98A2E', paws: '#FBE7BF' },
  Lumen: { kind: 'gajah', fur: '#9BA6B5', head: '#A3AEBD', belly: '#E4E9EF', dark: '#2B2F3A', accent: '#5B9BD5', inner: '#F4B6C2', arms: '#9BA6B5', legs: '#8995A6', paws: '#7F8A9B' },
  Matrix: { kind: 'kodok', fur: '#6FBF5F', head: '#78C766', belly: '#E6F4C8', dark: '#25401F', accent: '#F28CB1', inner: '#F58FA0', arms: '#6FBF5F', legs: '#5CA84D', paws: '#8ED17C' },
  // ---- ruang Account Payable ----
  Nexus: { kind: 'babi', fur: '#F6B1C0', head: '#F8B9C6', belly: '#FCD5DD', dark: '#7A3B4B', accent: '#F5C84C', inner: '#F18CA5', arms: '#F6B1C0', legs: '#F18CA5', paws: '#F18CA5' },
  Omni: { kind: 'sapi', fur: '#FAFAF7', head: '#FBFBF8', belly: '#FFFFFF', dark: '#2A2A30', accent: '#F5C84C', inner: '#F4A9B8', arms: '#FAFAF7', legs: '#2A2A30', paws: '#3A3A42', hands: '#FAFAF7' },
  // ---- ruang Planning ----
  Pixel: { kind: 'harimau', fur: '#F29A38', head: '#F5A340', belly: '#FFF1DC', dark: '#2B1B12', accent: '#2FA39A', inner: '#F4A9B8', arms: '#F29A38', legs: '#D9822A', paws: '#FFF1DC' },
  Quark: { kind: 'berangberang', fur: '#8B6A4F', head: '#94735A', belly: '#E8D3B8', dark: '#2B1B12', accent: '#4C8FBF', inner: '#6E513C', arms: '#8B6A4F', legs: '#6E513C', paws: '#6E513C' },
  Radian: { kind: 'landak', fur: '#D8B78E', head: '#E7CBA6', belly: '#FBEBD3', dark: '#6B4A33', accent: '#E5484D', inner: '#F4B6A0', arms: '#D8B78E', legs: '#B8956B', paws: '#B8956B' },
  Sigma: { kind: 'monyet', fur: '#8A5F3E', head: '#93664A', belly: '#F0D5B0', dark: '#2B1B12', accent: '#F5C84C', inner: '#F4B6A0', arms: '#8A5F3E', legs: '#6E4A30', paws: '#F0D5B0' },
  // ---- ruang Management ----
  Tensor: { kind: 'kuda', fur: '#F3EEFA', head: '#F6F1FC', belly: '#FFFFFF', dark: '#2B2140', accent: '#EC6FA5', inner: '#F9A8C9', arms: '#F3EEFA', legs: '#E4DBF2', paws: '#CFC3E8' },
  Vector: { kind: 'tupai', fur: '#C9824A', head: '#D08B54', belly: '#FFF0DC', dark: '#3A2316', accent: '#8B5A2B', inner: '#F4B6A0', arms: '#C9824A', legs: '#A96A38', paws: '#A96A38' },
  Orion: { kind: 'rusa', fur: '#C58B52', head: '#CC945C', belly: '#FBEBD3', dark: '#3A2316', accent: '#D94F4F', inner: '#F4B6A0', arms: '#C58B52', legs: '#8B5E3C', paws: '#5B3E28' },
  Theta: { kind: 'alpaka', fur: '#F1E4CF', head: '#F5E9D6', belly: '#FFF8EC', dark: '#3A2B22', accent: '#E5484D', inner: '#F4C6C6', arms: '#F1E4CF', legs: '#D8C6A8', paws: '#C9B492' },
  Kappa: { kind: 'axolotl', fur: '#F8B7C9', head: '#FAC0D0', belly: '#FFE3EB', dark: '#5A2E3D', accent: '#F0658C', inner: '#F58FA0', arms: '#F8B7C9', legs: '#F29DB5', paws: '#F29DB5' },
  Omega: { kind: 'kura', fur: '#7DBE6B', head: '#86C773', belly: '#F3E6B8', dark: '#2B3A22', accent: '#8B6B3A', inner: '#F58FA0', arms: '#7DBE6B', legs: '#6AAA58', paws: '#8ED17C' },
};

// Ekor tiap hewan (y, z, radius) di belakang kursi; telinga: kemiringan dasar + apakah berkedut.
const TAIL_PTS: Record<PetKind, [number, number, number][]> = {
  kucing: [[-0.02, -0.05, 0.06], [-0.07, -0.13, 0.058], [-0.08, -0.22, 0.056], [-0.03, -0.3, 0.055], [0.06, -0.35, 0.054], [0.17, -0.36, 0.052], [0.27, -0.35, 0.05]],
  kelinci: [[0.03, -0.05, 0.1]],
  panda: [[0.03, -0.04, 0.07]],
  hantu: [[-0.02, -0.05, 0.08], [-0.1, -0.07, 0.07]],
  penguin: [[0.0, -0.04, 0.07]],
  beruang: [[0.03, -0.05, 0.08]],
  kapibara: [[0.02, -0.04, 0.05]],
  koala: [[0.0, -0.04, 0.05]],
  hamster: [[0.0, -0.04, 0.04]],
  shiba: [[0.02, -0.05, 0.09], [0.09, -0.1, 0.095], [0.16, -0.1, 0.095], [0.21, -0.05, 0.085]],
  domba: [[0.02, -0.05, 0.11]],
  bebek: [[0.04, -0.05, 0.09], [0.1, -0.09, 0.07]],
  singa: [[-0.02, -0.05, 0.05], [-0.09, -0.12, 0.045], [-0.15, -0.2, 0.045], [-0.2, -0.28, 0.085]],
  gajah: [[-0.02, -0.05, 0.04], [-0.08, -0.08, 0.035], [-0.14, -0.08, 0.05]],
  kodok: [[0.0, -0.04, 0.04]],
  babi: [[0.03, -0.05, 0.04], [0.08, -0.09, 0.04], [0.1, -0.04, 0.04]],
  sapi: [[-0.02, -0.05, 0.04], [-0.09, -0.07, 0.035], [-0.16, -0.08, 0.06]],
  harimau: [[-0.02, -0.05, 0.05], [-0.1, -0.12, 0.05], [-0.17, -0.2, 0.05], [-0.2, -0.3, 0.05]],
  berangberang: [[-0.02, -0.06, 0.08], [-0.06, -0.14, 0.07], [-0.1, -0.22, 0.06], [-0.13, -0.3, 0.05]],
  landak: [[0.0, -0.04, 0.04]],
  monyet: [[-0.02, -0.05, 0.04], [-0.08, -0.1, 0.04], [-0.15, -0.15, 0.04], [-0.2, -0.22, 0.04], [-0.2, -0.3, 0.04], [-0.15, -0.35, 0.04]],
  kuda: [[-0.02, -0.06, 0.07], [-0.08, -0.12, 0.075], [-0.15, -0.17, 0.08], [-0.22, -0.2, 0.08]],
  tupai: [[0.04, -0.08, 0.1], [0.14, -0.12, 0.12], [0.26, -0.12, 0.13], [0.38, -0.08, 0.12]],
  rusa: [[0.03, -0.05, 0.06], [0.07, -0.08, 0.05]],
  alpaka: [[0.02, -0.05, 0.07]],
  axolotl: [[-0.02, -0.05, 0.05], [-0.06, -0.13, 0.06], [-0.1, -0.22, 0.07], [-0.12, -0.3, 0.06]],
  kura: [[0.0, -0.04, 0.04]],
};
const EAR_BASE: Record<PetKind, number> = {
  kucing: 0.3, kelinci: 0.14, panda: 0, hantu: 0.35, penguin: 0, beruang: 0, kapibara: 0, koala: 0, hamster: 0, shiba: 0.12, domba: 0, bebek: 0, singa: 0, gajah: 0.12, kodok: 0, babi: 0.45, sapi: 0, harimau: 0, berangberang: 0, landak: 0, monyet: 0, kuda: 0.1, tupai: 0.12, rusa: 0.2, alpaka: 0.15, axolotl: 0, kura: 0,
};
const EAR_TWITCH = new Set<PetKind>(['kucing', 'kelinci', 'hantu', 'shiba', 'babi', 'gajah', 'kuda', 'tupai', 'rusa', 'alpaka']);

type PetRig = {
  chest: GRef; armL: GRef; armR: GRef; head: GRef; eyeL: GRef; eyeR: GRef; earL: GRef; earR: GRef; tail: GRef;
  // [BARU] AI penghuni yang bisa berdiri / berjalan: paha, betis, dan bola-bola ekor (ekor dilebarkan saat berdiri)
  legL?: GRef; legR?: GRef; shinL?: GRef; shinR?: GRef; tailParts?: React.MutableRefObject<(THREE.Group | null)[]>;
};

// Mata bulat berkilau (ikut berkedip lewat rig) + pipi merah muda.
function PetEyes({ rig, x, y, z, r = 0.036, color = '#14161A' }: { rig: PetRig; x: number; y: number; z: number; r?: number; color?: string }) {
  return (
    <>
      {[-1, 1].map((sd) => (
        <group key={sd} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * x, y, z]}>
          <Sph r={r} scale={[1, 1.2, 0.5]} color={color} />
          <Sph pos={[r * 0.3, r * 0.4, r * 0.45]} r={r * 0.3} color="#FFFFFF" />
        </group>
      ))}
    </>
  );
}
function PetBlush({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <>
      {[-1, 1].map((sd) => (
        <Sph key={sd} pos={[sd * x, y, z]} r={0.035} scale={[1.2, 0.7, 0.3]} color="#FF9FB2" />
      ))}
    </>
  );
}

// Pose duduk tetap (kaki ditekuk di kursi). Menghadap +z lokal; pembungkus memutar sesuai arah kursi.
function PetBody({ look, rig }: { look: PetLook; rig: PetRig }) {
  const { kind, fur, belly, dark, accent, inner } = look;
  const SIT = Math.PI / 2 - 0.45;
  const tailPts = TAIL_PTS[kind];

  return (
    <>
      {/* ekor diselipkan di antara badan & sandaran kursi: tertutup kursi, tidak menembus sandaran */}
      <group ref={rig.tail} position={[0, 0.36, -0.1]}>
        {tailPts.map(([y, z, r], i) => (
          <group key={i} ref={(g) => { if (rig.tailParts) rig.tailParts.current[i] = g; }} position={[0, y, z * 0.12]}>
            <Sph pos={[0, 0, 0]} r={r} cast
              color={kind === 'kucing' ? (i === tailPts.length - 1 ? '#F3EFEA' : fur) : kind === 'kelinci' || kind === 'panda' ? belly : fur} />
          </group>
        ))}
      </group>

      <group position={[0, 0.05, 0.09]}>
        {/* kaki */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? rig.legL : rig.legR} position={[side * 0.16, 0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <Cap pos={[0, -0.08, 0]} r={0.105} len={0.05} color={look.legs} />
            <group ref={side < 0 ? rig.shinL : rig.shinR} position={[0, -0.17, 0]} rotation={[SIT, 0, 0]}>
              <Cap pos={[0, -0.04, 0]} r={0.088} len={0.06} color={look.paws} />
              <Sph pos={[0, -0.19, 0.035]} r={0.088} scale={[1, 0.62, 1.35]} color={look.paws} cast />
              {[-1, 0, 1].map((j) => (
                <Sph key={j} pos={[j * 0.04, -0.2, 0.135]} r={0.026} scale={[1, 0.7, 1]} color={lighten(look.paws, 0.07)} />
              ))}
            </group>
          </group>
        ))}

        {/* badan bulat gemuk + perut terang + aksesori */}
        <group ref={rig.chest} position={[0, 0.66, 0]}>
          <Sph r={0.33} scale={[1.08, 1.0, 0.8]} color={fur} cast seg={[40, 30]} />
          <Sph pos={[0, -0.05, 0.1]} r={0.3} scale={[0.82, 0.92, 0.62]} color={belly} seg={[40, 30]} />
          {kind === 'kucing' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.035} color={accent} cast />
              <Sph pos={[0, 0.1, 0.25]} r={0.04} color="#FBBF24" cast />
            </>
          )}
          {kind === 'kelinci' && (
            <>
              <Sph pos={[-0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0, 0.15, 0.275]} r={0.024} color={lighten(accent, 0.12)} />
            </>
          )}
          {kind === 'panda' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.3} tube={0.05} color={accent} cast />
              <Box pos={[0.13, 0.03, 0.29]} size={[0.1, 0.18, 0.03]} rot={[-0.22, 0, -0.12]} color={accent} cast={false} />
            </>
          )}

          {kind === 'hantu' && (
            <>
              {([[0, 0.03, 0.285], [-0.09, -0.04, 0.275], [0.09, -0.04, 0.275], [0, -0.1, 0.28], [-0.09, -0.16, 0.265], [0.09, -0.16, 0.265]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.03} scale={[1.6, 0.7, 0.4]} color={fur} />
              ))}
            </>
          )}
          {(kind === 'penguin' || kind === 'beruang') && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.04} color={accent} cast />
              <Box pos={[0.14, 0.03, 0.285]} size={[0.09, 0.2, 0.03]} rot={[-0.22, 0, -0.12]} color={accent} cast={false} />
            </>
          )}
          {kind === 'shiba' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.03} color={accent} cast />
              <Sph pos={[0, 0.09, 0.265]} r={0.04} color="#FBBF24" cast />
            </>
          )}
          {kind === 'koala' && (
            <Sph pos={[0.1, 0.02, 0.285]} r={0.05} rot={[0, 0, 0.6]} scale={[1.5, 0.55, 0.25]} color={accent} />
          )}
          {kind === 'hamster' && (
            <>
              <Sph pos={[0, -0.02, 0.29]} r={0.05} scale={[0.7, 1.2, 0.4]} color={accent} />
              <Box pos={[0, -0.02, 0.306]} size={[0.012, 0.08, 0.006]} color={look.dark} cast={false} />
            </>
          )}
          {kind === 'domba' && (
            <>
              {([[-0.2, 0.12, 0.12], [0.2, 0.12, 0.12], [-0.27, -0.05, 0.0], [0.27, -0.05, 0.0], [0, 0.2, 0.0]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.15} color={fur} cast />
              ))}
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.03} color={accent} cast />
              <Sph pos={[0, 0.08, 0.28]} r={0.045} color="#FBBF24" cast />
            </>
          )}
          {kind === 'bebek' && (
            <>
              <Sph pos={[-0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0, 0.15, 0.275]} r={0.024} color={lighten(accent, 0.12)} />
            </>
          )}

          {kind === 'singa' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.04} color={accent} cast />
              <Box pos={[0.14, 0.03, 0.285]} size={[0.09, 0.2, 0.03]} rot={[-0.22, 0, -0.12]} color={accent} cast={false} />
            </>
          )}
          {kind === 'gajah' && (
            <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.035} color={accent} cast />
          )}
          {kind === 'kodok' && (
            <>
              <Sph pos={[-0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0, 0.15, 0.275]} r={0.024} color={lighten(accent, 0.12)} />
            </>
          )}
          {kind === 'babi' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.025} color={accent} cast />
              <Cyl pos={[0, 0.08, 0.275]} rot={[Math.PI / 2, 0, 0]} r={0.06} h={0.015} color={accent} cast={false} glow={0.25} />
            </>
          )}
          {kind === 'sapi' && (
            <>
              <Sph pos={[-0.18, 0.1, 0.18]} r={0.1} scale={[1, 1, 0.5]} color={dark} />
              <Sph pos={[0.2, -0.12, 0.15]} r={0.08} scale={[1, 1, 0.5]} color={dark} />
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.03} color="#D94F4F" cast />
              <Sph pos={[0, 0.08, 0.28]} r={0.045} color={accent} cast />
            </>
          )}

          {kind === 'harimau' && (
            <>
              {[-1, 1].map((sd) =>
                [0, 1, 2].map((i) => (
                  <Sph key={`s${sd}${i}`} pos={[sd * 0.3, 0.15 - i * 0.12, 0.08]} r={0.05} scale={[0.4, 0.6, 1.1]} color={dark} />
                ))
              )}
            </>
          )}
          {kind === 'berangberang' && (
            <>
              <Sph pos={[-0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0.055, 0.15, 0.27]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
              <Sph pos={[0, 0.15, 0.275]} r={0.024} color={lighten(accent, 0.12)} />
            </>
          )}
          {kind === 'landak' && (
            <>
              <Sph pos={[0, 0.05, -0.13]} r={0.3} scale={[1.1, 1, 0.4]} color={dark} cast />
              <Sph pos={[0.12, -0.02, 0.29]} r={0.06} color={accent} cast />
              <Sph pos={[0.13, 0.04, 0.3]} r={0.02} rot={[0, 0, 0.5]} scale={[1.6, 0.6, 0.6]} color="#4CAF50" />
            </>
          )}
          {kind === 'monyet' && (
            <Sph pos={[0.1, 0.0, 0.29]} r={0.04} rot={[0, 0, 0.5]} scale={[2.2, 0.6, 0.5]} color={accent} />
          )}
          {kind === 'tupai' && (
            <>
              <Sph pos={[0, -0.03, 0.29]} r={0.05} scale={[0.9, 1.1, 0.6]} color={accent} />
              <Sph pos={[0, 0.01, 0.295]} r={0.045} scale={[1.1, 0.6, 0.6]} color={dark} />
            </>
          )}
          {kind === 'rusa' && (
            <>
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.04} color={accent} cast />
              <Box pos={[0.14, 0.03, 0.285]} size={[0.09, 0.2, 0.03]} rot={[-0.22, 0, -0.12]} color={accent} cast={false} />
              {([[-0.25, 0.15, 0.1], [0.25, 0.05, 0.1], [-0.2, -0.1, 0.15], [0.27, -0.15, 0.05]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.035} scale={[1, 1, 0.4]} color={belly} />
              ))}
            </>
          )}
          {kind === 'alpaka' && (
            <>
              {([[-0.25, -0.05, 0.0], [0.25, -0.05, 0.0], [-0.2, 0.12, 0.1], [0.2, 0.12, 0.1]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.14} color={fur} cast />
              ))}
              <Torus pos={[0, 0.17, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1, 0.75, 1]} r={0.29} tube={0.04} color={accent} cast />
            </>
          )}
          {kind === 'kura' && (
            <>
              <Sph pos={[0, 0.1, -0.12]} r={0.34} scale={[1.18, 1.1, 0.5]} color={accent} cast />
              {([[-0.25, 0.25, -0.18], [0.25, 0.25, -0.18], [0, 0.34, -0.14]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.07} scale={[1, 0.8, 0.5]} color={lighten(accent, -0.08)} />
              ))}
            </>
          )}
        </group>

        {/* lengan */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? rig.armL : rig.armR} position={[side * 0.33, 0.84, 0.06]}>
            <Sph r={0.075} color={look.arms} cast />
            <Cap pos={[0, -0.1, 0]} r={0.07} len={0.1} color={look.arms} />
            <Sph pos={[0, -0.225, 0.01]} r={0.078} color={look.hands ?? look.paws} cast />
          </group>
        ))}

        {/* kepala */}
        <group ref={rig.head} position={[0, 1.05, 0]}>
          <Sph r={0.26} scale={[1.14, 0.88, 1.0]} color={look.head} cast />

          {kind === 'kucing' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.17, 0.2, -0.02]}>
                  <Cyl pos={[0, 0.085, 0]} r={0.004} rb={0.1} h={0.2} scale={[1, 1, 0.5]} color={look.head} />
                  <Cyl pos={[0, 0.07, 0.025]} r={0.004} rb={0.062} h={0.15} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`p${sd}`} pos={[sd * 0.19, -0.06, 0.1]} r={0.09} scale={[1, 0.75, 0.85]} color={lighten(look.head, 0.04)} />
              ))}
              <Sph pos={[0, -0.075, 0.215]} r={0.07} scale={[1.2, 0.8, 0.9]} color={belly} />
              <Sph pos={[0, -0.04, 0.275]} r={0.025} scale={[1.3, 0.8, 0.8]} color={inner} />
              <Sph pos={[0, -0.095, 0.268]} r={0.018} scale={[1.6, 0.3, 0.4]} color="#7A3B3B" />
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.11, 0.03, 0.235]}>
                  <Sph r={0.045} scale={[1, 1.15, 0.5]} color="#FDE047" glow={0.35} />
                  <Sph pos={[0, 0, 0.016]} r={0.022} scale={[0.45, 1.3, 0.5]} color="#0B0A10" />
                  <Sph pos={[0.01, 0.018, 0.024]} r={0.008} color="#FFFFFF" />
                </group>
              ))}
              {[-1, 1].map((sd) =>
                [0, 1, 2].map((i) => (
                  <Box key={`w${sd}${i}`} pos={[sd * 0.27, -0.065 + (i - 1) * 0.025, 0.2]} size={[0.16, 0.005, 0.005]} rot={[0, 0, (i - 1) * sd * 0.15]} color="#E5E7EB" cast={false} />
                ))
              )}
            </>
          )}

          {kind === 'kelinci' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.1, 0.2, -0.02]}>
                  <Cap pos={[0, 0.25, 0]} r={0.05} len={0.3} scale={[1, 1, 0.5]} color={fur} />
                  <Cap pos={[0, 0.25, 0.02]} r={0.03} len={0.24} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`p${sd}`} pos={[sd * 0.15, -0.08, 0.13]} r={0.095} scale={[0.9, 0.8, 0.85]} color={belly} />
              ))}
              <Sph pos={[0, -0.07, 0.225]} r={0.06} scale={[1.2, 0.8, 0.8]} color={belly} />
              <Sph pos={[0, -0.04, 0.265]} r={0.025} scale={[1.3, 0.85, 0.8]} color={inner} />
              <Box pos={[0, -0.075, 0.262]} size={[0.012, 0.03, 0.008]} color={look.dark} cast={false} />
              <Box pos={[0, -0.115, 0.26]} size={[0.035, 0.04, 0.012]} color="#FFFFFF" cast={false} />
              {[-1, 1].map((sd) => (
                <Sph key={`b${sd}`} pos={[sd * 0.165, -0.04, 0.19]} r={0.03} scale={[1, 0.6, 0.35]} color={inner} />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.105, 0.04, 0.236]}>
                  <Sph r={0.035} scale={[1, 1.2, 0.5]} color={look.dark} />
                  <Sph pos={[0.01, 0.014, 0.014]} r={0.01} color="#FFFFFF" />
                </group>
              ))}
              {/* pita di dekat telinga kiri */}
              <group position={[-0.17, 0.2, 0.1]} rotation={[0, 0, 0.4]}>
                <Sph pos={[-0.04, 0, 0]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
                <Sph pos={[0.04, 0, 0]} r={0.04} scale={[1.2, 0.9, 0.6]} color={accent} />
                <Sph pos={[0, 0, 0.005]} r={0.022} color={lighten(accent, 0.12)} />
              </group>
            </>
          )}

          {kind === 'panda' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.2, 0.2, -0.02]}>
                  <Sph pos={[0, 0.03, 0]} r={0.08} scale={[1, 1, 0.7]} color={dark} cast />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`pt${sd}`} pos={[sd * 0.105, 0.025, 0.215]} rot={[0, 0, sd * 0.45]} r={0.08} scale={[0.85, 1.25, 0.5]} color={dark} />
              ))}
              <Sph pos={[0, -0.075, 0.2]} r={0.09} scale={[1.2, 0.8, 0.9]} color={belly} />
              <Sph pos={[0, -0.03, 0.262]} r={0.035} scale={[1.4, 0.8, 0.9]} color={dark} />
              <Box pos={[0, -0.1, 0.262]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.105, 0.03, 0.255]}>
                  <Sph r={0.024} scale={[1, 1.1, 0.5]} color="#FFFFFF" />
                  <Sph pos={[0, 0, 0.01]} r={0.014} color="#14161A" />
                </group>
              ))}
            </>
          )}

          {kind === 'hantu' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.17, 0.19, -0.02]}>
                  <Cyl pos={[0, 0.07, 0]} r={0.004} rb={0.075} h={0.17} scale={[1, 1, 0.6]} color={fur} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`f${sd}`} pos={[sd * 0.1, 0.025, 0.19]} r={0.115} scale={[1, 1, 0.5]} color={belly} />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.1, 0.03, 0.245]}>
                  <Sph r={0.062} scale={[1, 1, 0.5]} color="#FFFFFF" />
                  <Sph pos={[0, 0, 0.02]} r={0.035} color="#14161A" />
                  <Sph pos={[0.012, 0.016, 0.034]} r={0.011} color="#FFFFFF" />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Torus key={`g${sd}`} pos={[sd * 0.1, 0.03, 0.262]} r={0.075} tube={0.01} color={accent} />
              ))}
              <Box pos={[0, 0.04, 0.265]} size={[0.06, 0.012, 0.012]} color={accent} cast={false} />
              <Sph pos={[0, -0.05, 0.262]} r={0.04} scale={[0.9, 1.15, 0.7]} color={inner} />
            </>
          )}

          {kind === 'penguin' && (
            <>
              <Sph pos={[0, -0.03, 0.115]} r={0.21} scale={[1.05, 0.85, 0.7]} color={belly} />
              <Sph pos={[0, -0.045, 0.258]} r={0.045} scale={[1.1, 0.6, 1.0]} color={inner} />
              <PetEyes rig={rig} x={0.1} y={0.035} z={0.237} r={0.034} />
              <PetBlush x={0.17} y={-0.02} z={0.2} />
            </>
          )}

          {kind === 'beruang' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.2, 0.2, -0.02]}>
                  <Sph pos={[0, 0.03, 0]} r={0.085} scale={[1, 1, 0.7]} color={look.head} cast />
                  <Sph pos={[0, 0.03, 0.04]} r={0.05} scale={[1, 1, 0.5]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.075, 0.2]} r={0.1} scale={[1.2, 0.85, 0.9]} color={belly} />
              <Sph pos={[0, -0.04, 0.282]} r={0.036} scale={[1.4, 0.9, 0.8]} color={dark} />
              <Box pos={[0, -0.105, 0.285]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.105} y={0.045} z={0.235} r={0.033} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'kapibara' && (
            <>
              <Sph pos={[0, -0.05, 0.19]} r={0.15} scale={[1.0, 0.78, 0.9]} color={belly} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.045, -0.01, 0.31]} r={0.018} scale={[1, 1.2, 0.6]} color={dark} />
              ))}
              <Box pos={[0, -0.105, 0.31]} size={[0.06, 0.008, 0.008]} color={dark} cast={false} />
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.19, 0.17, -0.03]}>
                  <Sph pos={[0, 0.02, 0]} r={0.05} scale={[1, 1, 0.7]} color={look.legs} cast />
                </group>
              ))}
              <PetEyes rig={rig} x={0.13} y={0.07} z={0.212} r={0.03} />
              <PetBlush x={0.16} y={0.02} z={0.21} />
              {/* yuzu di atas kepala */}
              <Sph pos={[0, 0.235, 0.02]} r={0.075} color={accent} cast />
              <Sph pos={[0.02, 0.305, 0.02]} r={0.03} rot={[0, 0, 0.4]} scale={[1.5, 0.4, 0.8]} color="#4CAF50" />
            </>
          )}

          {kind === 'koala' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.235, 0.15, -0.02]}>
                  <Sph pos={[0, 0.03, 0]} r={0.125} scale={[1, 1, 0.65]} color={look.head} cast />
                  <Sph pos={[0, 0.03, 0.045]} r={0.08} scale={[1, 1, 0.45]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.06, 0.2]} r={0.07} scale={[1.4, 0.8, 0.8]} color={belly} />
              <Sph pos={[0, 0.0, 0.268]} r={0.055} scale={[0.95, 1.25, 0.8]} color={dark} />
              <Box pos={[0, -0.095, 0.258]} size={[0.025, 0.007, 0.006]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.115} y={0.045} z={0.233} r={0.03} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'hamster' && (
            <>
              {[-1, 1].map((sd) => (
                <Sph key={`c${sd}`} pos={[sd * 0.18, -0.06, 0.1]} r={0.13} scale={[1, 0.85, 0.95]} color={belly} />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.17, 0.19, 0]}>
                  <Sph pos={[0, 0.03, 0]} r={0.06} scale={[1, 1, 0.6]} color={look.head} cast />
                  <Sph pos={[0, 0.03, 0.03]} r={0.036} scale={[1, 1, 0.4]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, 0.14, 0.14]} r={0.1} scale={[1.3, 0.75, 0.8]} color={dark} />
              <Sph pos={[0, -0.05, 0.19]} r={0.08} scale={[1.3, 0.8, 0.8]} color={belly} />
              <Sph pos={[0, -0.025, 0.262]} r={0.025} scale={[1.2, 0.8, 0.8]} color={inner} />
              <Box pos={[0, -0.07, 0.252]} size={[0.03, 0.03, 0.008]} color="#FFFFFF" cast={false} />
              <PetEyes rig={rig} x={0.1} y={0.06} z={0.232} r={0.04} />
              <PetBlush x={0.19} y={-0.02} z={0.17} />
            </>
          )}

          {kind === 'shiba' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.15, 0.2, -0.02]}>
                  <Cyl pos={[0, 0.085, 0]} r={0.004} rb={0.1} h={0.2} scale={[1, 1, 0.5]} color={look.head} />
                  <Cyl pos={[0, 0.07, 0.025]} r={0.004} rb={0.06} h={0.15} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`c${sd}`} pos={[sd * 0.17, -0.06, 0.1]} r={0.1} scale={[1, 0.75, 0.85]} color={belly} />
              ))}
              <Sph pos={[0, -0.07, 0.2]} r={0.1} scale={[1.25, 0.8, 0.9]} color={belly} />
              <Sph pos={[0, -0.045, 0.287]} r={0.028} scale={[1.3, 0.8, 0.8]} color={dark} />
              <Sph pos={[0, -0.1, 0.282]} r={0.02} scale={[1.6, 0.3, 0.4]} color="#7A3B3B" />
              {[-1, 1].map((sd) => (
                <Sph key={`b${sd}`} pos={[sd * 0.1, 0.1, 0.205]} r={0.022} scale={[1.2, 0.8, 0.5]} color={belly} />
              ))}
              <PetEyes rig={rig} x={0.105} y={0.04} z={0.235} r={0.033} />
            </>
          )}

          {kind === 'domba' && (
            <>
              <Sph pos={[0, 0.19, 0.03]} r={0.15} scale={[1.35, 0.8, 1.05]} color={fur} cast />
              {[-1, 1].map((sd) => (
                <Sph key={`w${sd}`} pos={[sd * 0.13, 0.15, 0.06]} r={0.1} color={fur} cast />
              ))}
              <Sph pos={[0, 0.16, 0.14]} r={0.09} scale={[1.3, 0.8, 0.7]} color={fur} cast />
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.25, 0.02, 0]}>
                  <Sph pos={[sd * 0.07, -0.03, 0]} rot={[0, 0, sd * 0.5]} r={0.075} scale={[1.5, 0.55, 0.5]} color={look.head} cast />
                  <Sph pos={[sd * 0.07, -0.03, 0.02]} rot={[0, 0, sd * 0.5]} r={0.04} scale={[1.3, 0.45, 0.4]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.07, 0.2]} r={0.085} scale={[1.2, 0.8, 0.85]} color={lighten(look.head, 0.12)} />
              <Sph pos={[0, -0.045, 0.272]} r={0.025} scale={[1.3, 0.8, 0.8]} color={inner} />
              <Box pos={[0, -0.1, 0.268]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.105, 0.04, 0.235]}>
                  <Sph r={0.04} scale={[1, 1.15, 0.5]} color="#FFFFFF" />
                  <Sph pos={[0, 0, 0.014]} r={0.022} color="#14161A" />
                  <Sph pos={[0.008, 0.012, 0.024]} r={0.007} color="#FFFFFF" />
                </group>
              ))}
            </>
          )}

          {kind === 'bebek' && (
            <>
              <Sph pos={[0, -0.055, 0.262]} r={0.085} scale={[1.35, 0.4, 0.95]} color={inner} />
              <Sph pos={[0, -0.085, 0.248]} r={0.06} scale={[1.2, 0.35, 0.85]} color={lighten(inner, -0.06)} />
              <PetEyes rig={rig} x={0.11} y={0.065} z={0.228} r={0.034} />
              <PetBlush x={0.17} y={-0.03} z={0.17} />
              {([[-0.03, 0.232, 0.02], [0, 0.248, 0.02], [0.03, 0.232, 0.02]] as V3[]).map((q, i) => (
                <Sph key={i} pos={q} r={0.03} color={fur} />
              ))}
            </>
          )}

          {kind === 'singa' && (
            <>
              <Sph pos={[0, 0, -0.07]} r={0.31} scale={[1.12, 1.05, 0.55]} color={dark} cast />
              {Array.from({ length: 10 }, (_, i) => {
                const a = (i * 2 * Math.PI) / 10;
                return <Sph key={`m${i}`} pos={[Math.sin(a) * 0.27, Math.cos(a) * 0.21, 0.03]} r={0.085} color={dark} cast />;
              })}
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.17, 0.19, 0.0]}>
                  <Sph pos={[0, 0.02, 0.04]} r={0.06} scale={[1, 1, 0.7]} color={look.head} cast />
                  <Sph pos={[0, 0.02, 0.075]} r={0.035} scale={[1, 1, 0.4]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.075, 0.2]} r={0.1} scale={[1.2, 0.85, 0.9]} color={belly} />
              <Sph pos={[0, -0.04, 0.283]} r={0.034} scale={[1.4, 0.9, 0.8]} color={inner} />
              <Box pos={[0, -0.105, 0.285]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.105} y={0.045} z={0.235} r={0.033} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'gajah' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.28, 0.08, -0.02]}>
                  <Sph pos={[sd * 0.05, 0, 0]} r={0.15} scale={[1, 1.15, 0.3]} color={look.head} cast />
                  <Sph pos={[sd * 0.05, 0, 0.03]} r={0.1} scale={[0.9, 1.05, 0.2]} color={inner} />
                </group>
              ))}
              <Cyl pos={[0, -0.11, 0.272]} rot={[-0.3, 0, 0]} r={0.052} rb={0.072} h={0.2} color={look.head} cast />
              <Sph pos={[0, -0.21, 0.3]} r={0.055} color={look.head} cast />
              <PetEyes rig={rig} x={0.12} y={0.06} z={0.225} r={0.032} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'kodok' && (
            <>
              {[-1, 1].map((sd) => (
                <Sph key={`b${sd}`} pos={[sd * 0.12, 0.19, 0.08]} r={0.085} color={look.head} cast />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`m${sd}`} ref={sd < 0 ? rig.eyeL : rig.eyeR} position={[sd * 0.12, 0.2, 0.15]}>
                  <Sph r={0.055} scale={[1, 1, 0.6]} color="#FFFFFF" />
                  <Sph pos={[0, 0, 0.022]} r={0.03} color="#14161A" />
                  <Sph pos={[0.01, 0.014, 0.036]} r={0.009} color="#FFFFFF" />
                </group>
              ))}
              <Box pos={[0, -0.08, 0.243]} size={[0.28, 0.012, 0.01]} color={dark} cast={false} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.04, 0.0, 0.255]} r={0.012} color={dark} />
              ))}
              <PetBlush x={0.19} y={-0.05} z={0.15} />
            </>
          )}

          {kind === 'babi' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.15, 0.2, 0]}>
                  <Cyl pos={[0, 0.05, 0]} r={0.004} rb={0.085} h={0.15} scale={[1, 1, 0.5]} color={look.head} />
                  <Cyl pos={[0, 0.04, 0.02]} r={0.004} rb={0.05} h={0.11} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              <Sph pos={[0, -0.05, 0.24]} r={0.09} scale={[1.2, 0.9, 0.55]} color={inner} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.03, -0.05, 0.285]} r={0.016} scale={[0.8, 1.2, 0.5]} color={dark} />
              ))}
              <PetEyes rig={rig} x={0.11} y={0.06} z={0.232} r={0.032} />
              <PetBlush x={0.19} y={-0.03} z={0.15} />
            </>
          )}

          {kind === 'sapi' && (
            <>
              {[-1, 1].map((sd) => (
                <Cyl key={`h${sd}`} pos={[sd * 0.13, 0.25, 0]} rot={[0, 0, sd * -0.35]} r={0.012} rb={0.03} h={0.1} color="#F3E7C9" />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.27, 0.1, 0]}>
                  <Sph pos={[sd * 0.07, -0.03, 0]} rot={[0, 0, sd * 0.4]} r={0.075} scale={[1.5, 0.55, 0.5]} color={look.head} cast />
                  <Sph pos={[sd * 0.07, -0.03, 0.02]} rot={[0, 0, sd * 0.4]} r={0.04} scale={[1.3, 0.45, 0.4]} color={inner} />
                </group>
              ))}
              <Sph pos={[-0.1, 0.12, 0.17]} r={0.1} scale={[1.1, 0.8, 0.6]} color={dark} />
              <Sph pos={[0, -0.08, 0.19]} r={0.115} scale={[1.35, 0.8, 0.85]} color={inner} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.05, -0.07, 0.295]} r={0.016} scale={[0.8, 1.2, 0.5]} color={dark} />
              ))}
              <PetEyes rig={rig} x={0.115} y={0.05} z={0.232} r={0.033} />
            </>
          )}

          {kind === 'harimau' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.2, 0.2, -0.02]}>
                  <Sph pos={[0, 0.03, 0]} r={0.075} scale={[1, 1, 0.7]} color={look.head} cast />
                  <Sph pos={[0, 0.03, 0.035]} r={0.045} scale={[1, 1, 0.5]} color={belly} />
                </group>
              ))}
              <Sph pos={[0, 0.14, 0.2]} r={0.03} scale={[0.3, 1.2, 0.3]} color={dark} />
              {[-1, 1].map((sd) => (
                <Sph key={`f${sd}`} pos={[sd * 0.07, 0.13, 0.2]} r={0.03} rot={[0, 0, sd * 0.3]} scale={[0.3, 1.1, 0.3]} color={dark} />
              ))}
              {[-1, 1].map((sd) =>
                [0, 1].map((i) => (
                  <Sph key={`c${sd}${i}`} pos={[sd * 0.265, -0.01 - i * 0.05, 0.12]} r={0.03} scale={[1.8, 0.35, 0.5]} color={dark} />
                ))
              )}
              <Sph pos={[0, -0.075, 0.2]} r={0.1} scale={[1.2, 0.85, 0.9]} color={belly} />
              <Sph pos={[0, -0.04, 0.282]} r={0.032} scale={[1.4, 0.9, 0.8]} color={inner} />
              <Box pos={[0, -0.105, 0.285]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.105} y={0.045} z={0.235} r={0.033} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'berangberang' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.17, 0.18, 0]}>
                  <Sph pos={[0, 0.02, 0]} r={0.045} scale={[1, 1, 0.7]} color={look.head} cast />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`c${sd}`} pos={[sd * 0.17, -0.06, 0.11]} r={0.09} scale={[1, 0.8, 0.85]} color={belly} />
              ))}
              <Sph pos={[0, -0.07, 0.19]} r={0.11} scale={[1.4, 0.85, 0.85]} color={belly} />
              <Sph pos={[0, -0.035, 0.282]} r={0.035} scale={[1.4, 0.8, 0.8]} color={dark} />
              <Box pos={[0, -0.105, 0.272]} size={[0.03, 0.008, 0.008]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.09} y={0.05} z={0.238} r={0.033} />
              <PetBlush x={0.19} y={-0.03} z={0.14} />
            </>
          )}

          {kind === 'landak' && (
            <>
              <Sph pos={[0, 0.02, -0.1]} r={0.27} scale={[1.1, 0.9, 0.6]} color={dark} cast />
              {([[-0.2, 0.15, -0.05], [0, 0.2, -0.03], [0.2, 0.15, -0.05], [-0.24, 0.0, -0.08], [0.24, 0.0, -0.08], [-0.12, 0.22, -0.1], [0.12, 0.22, -0.1], [0, 0.1, -0.15]] as V3[]).map((q, i) => (
                <Sph key={`sp${i}`} pos={q} r={0.1} color={dark} cast />
              ))}
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.19, 0.14, 0]}>
                  <Sph pos={[0, 0.02, 0]} r={0.045} scale={[1, 1, 0.7]} color={look.head} cast />
                  <Sph pos={[0, 0.02, 0.03]} r={0.025} scale={[1, 1, 0.4]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.06, 0.2]} r={0.09} scale={[1.1, 0.8, 1.1]} color={belly} />
              <Sph pos={[0, -0.04, 0.3]} r={0.03} color="#14161A" />
              <PetEyes rig={rig} x={0.1} y={0.04} z={0.236} r={0.033} />
              <PetBlush x={0.18} y={-0.03} z={0.15} />
            </>
          )}

          {kind === 'monyet' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.285, 0.02, 0]}>
                  <Sph pos={[0, 0, 0]} r={0.075} scale={[0.8, 1, 0.8]} color={look.head} cast />
                  <Sph pos={[0, 0, 0.03]} r={0.045} scale={[0.7, 0.9, 0.5]} color={inner} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`m${sd}`} pos={[sd * 0.07, 0.03, 0.2]} r={0.1} scale={[1, 1, 0.5]} color={belly} />
              ))}
              <Sph pos={[0, -0.07, 0.2]} r={0.1} scale={[1.2, 0.85, 0.85]} color={belly} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.02, -0.04, 0.282]} r={0.012} color={dark} />
              ))}
              <Box pos={[0, -0.1, 0.285]} size={[0.06, 0.008, 0.008]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.09} y={0.05} z={0.235} r={0.034} />
              <PetBlush x={0.19} y={-0.03} z={0.14} />
            </>
          )}

          {kind === 'kuda' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.12, 0.2, -0.04]}>
                  <Cyl pos={[0, 0.06, 0]} r={0.004} rb={0.05} h={0.12} scale={[1, 1, 0.6]} color={look.head} />
                  <Cyl pos={[0, 0.05, 0.015]} r={0.004} rb={0.03} h={0.09} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              <Cyl pos={[0, 0.34, 0.09]} rot={[0.25, 0, 0]} r={0.004} rb={0.035} h={0.2} color="#F5C84C" glow={0.2} />
              <Sph pos={[0, 0.2, 0.14]} r={0.06} color={accent} />
              <Sph pos={[-0.06, 0.22, 0.08]} r={0.055} color="#A78BFA" />
              <Sph pos={[0.06, 0.22, 0.08]} r={0.055} color="#60A5FA" />
              <Sph pos={[0, 0.1, -0.17]} r={0.09} color="#A78BFA" cast />
              <Sph pos={[0, 0.0, -0.2]} r={0.09} color={accent} cast />
              <Sph pos={[0, -0.1, -0.2]} r={0.08} color="#60A5FA" cast />
              <Sph pos={[0, -0.07, 0.2]} r={0.1} scale={[1.1, 0.85, 1.0]} color={belly} />
              {[-1, 1].map((sd) => (
                <Sph key={`n${sd}`} pos={[sd * 0.035, -0.06, 0.295]} r={0.014} scale={[1, 1.2, 0.5]} color={dark} />
              ))}
              <PetEyes rig={rig} x={0.11} y={0.055} z={0.235} r={0.035} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'tupai' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.15, 0.2, -0.02]}>
                  <Cyl pos={[0, 0.07, 0]} r={0.004} rb={0.07} h={0.15} scale={[1, 1, 0.5]} color={look.head} />
                  <Cyl pos={[0, 0.06, 0.02]} r={0.004} rb={0.04} h={0.1} scale={[1, 1, 0.4]} color={inner} cast={false} />
                  <Sph pos={[0, 0.15, 0]} r={0.02} color={dark} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`c${sd}`} pos={[sd * 0.14, -0.07, 0.13]} r={0.08} color={belly} />
              ))}
              <Sph pos={[0, -0.06, 0.2]} r={0.07} scale={[1.2, 0.8, 0.85]} color={belly} />
              <Sph pos={[0, -0.035, 0.262]} r={0.022} scale={[1.2, 0.8, 0.8]} color={dark} />
              <Box pos={[0, -0.09, 0.258]} size={[0.025, 0.03, 0.008]} color="#FFFFFF" cast={false} />
              <PetEyes rig={rig} x={0.1} y={0.05} z={0.236} r={0.038} />
              <PetBlush x={0.19} y={-0.03} z={0.14} />
            </>
          )}

          {kind === 'rusa' && (
            <>
              {[-1, 1].map((sd) => (
                <group key={`a${sd}`} position={[sd * 0.1, 0.25, 0]} rotation={[0, 0, sd * -0.3]}>
                  <Cyl pos={[0, 0.1, 0]} r={0.008} rb={0.015} h={0.2} color="#8B5E3C" />
                  <Cyl pos={[sd * 0.04, 0.12, 0]} rot={[0, 0, sd * -0.8]} r={0.006} rb={0.011} h={0.1} color="#8B5E3C" />
                  <Cyl pos={[sd * 0.035, 0.2, 0]} rot={[0, 0, sd * -0.8]} r={0.005} rb={0.009} h={0.08} color="#8B5E3C" />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.24, 0.12, -0.02]}>
                  <Sph pos={[sd * 0.06, 0.02, 0]} rot={[0, 0, sd * -0.3]} r={0.09} scale={[1.5, 0.6, 0.35]} color={look.head} cast />
                  <Sph pos={[sd * 0.06, 0.02, 0.02]} rot={[0, 0, sd * -0.3]} r={0.05} scale={[1.4, 0.5, 0.3]} color={inner} />
                </group>
              ))}
              <Sph pos={[0, -0.07, 0.2]} r={0.1} scale={[1.05, 0.8, 1.0]} color={belly} />
              <Sph pos={[0, -0.04, 0.3]} r={0.03} color={dark} />
              <PetEyes rig={rig} x={0.115} y={0.05} z={0.232} r={0.035} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
            </>
          )}

          {kind === 'alpaka' && (
            <>
              <Sph pos={[0, 0.2, 0.04]} r={0.14} scale={[1.2, 1, 1]} color={fur} cast />
              <Sph pos={[-0.08, 0.18, 0.1]} r={0.08} color={fur} cast />
              <Sph pos={[0.08, 0.18, 0.1]} r={0.08} color={fur} cast />
              {[-1, 1].map((sd) => (
                <group key={`t${sd}`} ref={sd < 0 ? rig.earL : rig.earR} position={[sd * 0.15, 0.27, -0.02]}>
                  <Cap pos={[0, 0.06, 0]} r={0.035} len={0.1} scale={[1, 1, 0.6]} color={look.head} />
                  <Cap pos={[0, 0.06, 0.012]} r={0.02} len={0.07} scale={[1, 1, 0.4]} color={inner} cast={false} />
                </group>
              ))}
              {[-1, 1].map((sd) => (
                <Sph key={`c${sd}`} pos={[sd * 0.17, -0.05, 0.12]} r={0.11} color={fur} cast />
              ))}
              <Sph pos={[0, -0.07, 0.2]} r={0.08} scale={[1.2, 0.85, 0.9]} color={belly} />
              <Sph pos={[0, -0.045, 0.268]} r={0.024} scale={[1.3, 0.8, 0.8]} color={dark} />
              <Sph pos={[0, -0.1, 0.262]} r={0.018} scale={[1.6, 0.3, 0.4]} color="#7A3B3B" />
              <PetEyes rig={rig} x={0.105} y={0.05} z={0.236} r={0.04} />
              <PetBlush x={0.2} y={-0.04} z={0.12} />
            </>
          )}

          {kind === 'axolotl' && (
            <>
              {[-1, 1].map((sd) =>
                [0, 1, 2].map((i) => (
                  <group key={`g${sd}${i}`} position={[sd * 0.28, 0.1 - i * 0.07, 0]} rotation={[0, 0, sd * (-Math.PI / 2 + 0.45 * (1 - i))]}>
                    <Cyl pos={[0, 0.065, 0]} r={0.01} rb={0.014} h={0.13} color={accent} cast={false} />
                    <Sph pos={[0, 0.14, 0]} r={0.028} color={accent} />
                  </group>
                ))
              )}
              <Box pos={[-0.05, -0.07, 0.25]} size={[0.07, 0.01, 0.01]} rot={[0, 0, -0.25]} color={dark} cast={false} />
              <Box pos={[0.05, -0.07, 0.25]} size={[0.07, 0.01, 0.01]} rot={[0, 0, 0.25]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.13} y={0.03} z={0.22} r={0.03} />
              <PetBlush x={0.2} y={-0.04} z={0.13} />
            </>
          )}

          {kind === 'kura' && (
            <>
              <Box pos={[0, -0.07, 0.25]} size={[0.14, 0.01, 0.01]} color={dark} cast={false} />
              <PetEyes rig={rig} x={0.1} y={0.05} z={0.235} r={0.04} />
              <PetBlush x={0.18} y={-0.03} z={0.16} />
              <Sph pos={[0, 0.2, 0.0]} r={0.06} scale={[1.3, 0.5, 1]} color={belly} />
            </>
          )}
        </group>
      </group>
    </>
  );
}

// ---- [BARU] AI PENGHUNI HIDUP -------------------------------------------------------------------------------------------------
// 27 AI penghuni (Nova, Aria, Echo, ...) TIDAK lagi duduk terus di kursinya:
//  - mereka duduk di meja HANYA saat ada tugas (src/lib/tugasAi.ts: berikanTugasAI('Nova'); uji cepat: ?kerja=Nova,Aria),
//  - tanpa tugas mereka berdiri di dekat meja dan sesekali keluar ruangan (acak, siapa saja, ke ruangan mana saja) untuk
//    berkunjung & berpura-pura mengobrol, dengan syarat ruangan asalnya tidak pernah kosong (src/lib/penghuniOtak.ts).
// Tiap ruangan hanya memasang PENANDA KURSI (KursiPenghuni) supaya posisi kursi di koordinat dunia diketahui apa adanya (ikut
// semua geseran ruangan). Tubuh 3D-nya digambar <PenghuniKantor /> di luar ruangan supaya bisa berjalan keluar-masuk pintu.
// Peta lantai untuk pencari jalur diisi otomatis dari mesh yang sudah ada (perabot & dinding), jadi memindahkan perabot
// tidak perlu mengubah apa pun. Uji: ?petadebug=1 menggambar peta lantai (merah = terhalang) di atas lantai.

const KURSI_DUNIA: Record<string, KursiDunia> = {};
const _kursiP = new THREE.Vector3();
const _kursiD = new THREE.Vector3();
const RUANG_KE_ID: Record<string, RuangId> = {
  transactions: 'transaksi', ar: 'ar', ap: 'ap', perpus: 'perpus', santai: 'santai', aset: 'aset', studio: 'studio', planning: 'planning', management: 'management',
};

// Penanda kursi (tidak terlihat): mendaftarkan posisi & arah hadap duduk di koordinat dunia.
function KursiPenghuni({ name, ruang, pos, rotY }: { name: string; ruang: string; pos: V3; rotY: number }) {
  const g = useRef<THREE.Group>(null);
  const n = useRef(0);
  useEffect(() => () => { delete KURSI_DUNIA[name]; }, [name]);
  useFrame(() => {
    const o = g.current;
    if (!o || n.current >= 2) return;
    n.current += 1;
    o.updateWorldMatrix(true, false);
    o.getWorldPosition(_kursiP);
    o.getWorldDirection(_kursiD);
    KURSI_DUNIA[name] = { ruang, x: _kursiP.x, z: _kursiP.z, rot: Math.atan2(_kursiD.x, _kursiD.z) };
  });
  return (
    <group position={pos}>
      <group ref={g} rotation={[0, rotY + Math.PI, 0]} />
    </group>
  );
}

// 3 kursi di meja baca Perpustakaan (koordinat lokal PerpusArea, sama seperti 3 kursi yang sudah ada).
function PerpusPenghuni() {
  return (
    <>
      <Laptop pos={[-7.9, 0.8, 13.48]} rotY={0} seatKey="p:Nova" seed={21} />
      <Laptop pos={[-8.9, 0.8, 12.72]} rotY={Math.PI} seatKey="p:Aria" seed={34} />
      <KursiPenghuni name="Nova" ruang="perpus" pos={[-7.9, 0, 14.0]} rotY={0} />
      <KursiPenghuni name="Aria" ruang="perpus" pos={[-8.9, 0, 12.2]} rotY={Math.PI} />
      <KursiPenghuni name="Echo" ruang="perpus" pos={[-9.9, 0, 14.0]} rotY={0} />
    </>
  );
}

function PlanningPenghuni() {
  return (
    <>
      <KursiPenghuni name="Pixel" ruang="planning" pos={[-9.2, 0, -3.4 + 0.85]} rotY={0} />
      <KursiPenghuni name="Quark" ruang="planning" pos={[5.2 + PL_DX, 0, 0.4 + 0.85]} rotY={0} />
      <KursiPenghuni name="Radian" ruang="planning" pos={[5.2 + PL_DX, 0, -3.4 + 0.85]} rotY={0} />
      <KursiPenghuni name="Sigma" ruang="planning" pos={[-9.2, 0, 0.4 + 0.85]} rotY={0} />
    </>
  );
}

// 6 kursi melingkar rata di meja bundar Management (koordinat lokal RuangManagement).
const MG_PET: (PetName | null)[] = ['Tensor', 'Vector', 'Orion', 'Theta', 'Kappa', 'Omega'];
function ManagementPenghuni() {
  const N = HALAMAN_MG_DUDUK.length;
  const R = MG_R;
  return (
    <>
      {MG_PET.map((nm, i) =>
        nm ? (
          <group key={nm} rotation={[0, (i * 2 * Math.PI) / N, 0]}>
            <KursiPenghuni name={nm} ruang="management" pos={[0, 0, R]} rotY={0} />
          </group>
        ) : null
      )}
    </>
  );
}

function ArPenghuni() {
  return (
    <>
      <KursiPenghuni name="Kilo" ruang="ar" pos={[-8.0, 0, -3.4 + 0.85]} rotY={0} />
      <KursiPenghuni name="Lumen" ruang="ar" pos={[-4.4, 0, -3.4 + 0.85]} rotY={0} />
      <KursiPenghuni name="Matrix" ruang="ar" pos={[-8.0, 0, -0.5 + 0.85]} rotY={0} />
    </>
  );
}

function ApPenghuni() {
  return (
    <>
      <KursiPenghuni name="Nexus" ruang="ap" pos={[0 - AP_GS, 0, -3.1 + 0.85]} rotY={0} />
      <KursiPenghuni name="Omni" ruang="ap" pos={[AP_OMNI_X, 0, 0.6 + 0.85]} rotY={0} />
    </>
  );
}

function AsetPenghuni() {
  const { cx } = ASET;
  return (
    <>
      <KursiPenghuni name="Axiom" ruang="aset" pos={[cx + 3.0, 0, 22.6 + 0.85]} rotY={0} />
      <KursiPenghuni name="Byte" ruang="aset" pos={[cx + 3.0, 0, 24.7 + 0.85]} rotY={0} />
      <KursiPenghuni name="Cipher" ruang="aset" pos={[cx - 3.0, 0, 26.6 + 0.85]} rotY={0} />
      <KursiPenghuni name="Delta" ruang="aset" pos={[cx + 3.0, 0, 27.0 + 0.85]} rotY={0} />
    </>
  );
}

function StudioPenghuni() {
  return (
    <>
      <KursiPenghuni name="Flux" ruang="studio" pos={[13.0, 0, -2.6 + 0.85]} rotY={0} />
      <KursiPenghuni name="Gamma" ruang="studio" pos={[16.0, 0, -2.6 + 0.85]} rotY={0} />
      <KursiPenghuni name="Helix" ruang="studio" pos={[13.4, 0, 0.8 + 0.85]} rotY={0} />
      <KursiPenghuni name="Ion" ruang="studio" pos={[16.4, 0, 0.8 + 0.85]} rotY={0} />
      <KursiPenghuni name="Juno" ruang="studio" pos={[19.7, 0, 0.8 + 0.85]} rotY={0} />
    </>
  );
}

// ---- peta lantai otomatis dari mesh scene -------------------------------------------------------------------------------------
const _bxRintang = new THREE.Box3();
// Menandai perabot & dinding setinggi badan (0.28 .. 1.05 m dari lantai) sebagai kotak terhalang. Dilewati: karpet / ubin (terlalu rendah),
// benda gantung (terlalu tinggi), karakter (userData.nolod), daun pintu geser (userData.nopeta), area klik transparan, hasil gabungan BatchStatis.
function tandaiRintangan(scene: THREE.Scene, peta: PetaLantai): number {
  let n = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as any).isInstancedMesh || m.userData.batchHasil || m.userData.nodim) return;
    for (let a: THREE.Object3D | null = m; a; a = a.parent) if (a.userData && (a.userData.nolod || a.userData.nopeta)) return;
    const geo = m.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return;
    _bxRintang.copy(geo.boundingBox).applyMatrix4(m.matrixWorld);
    const lo = _bxRintang.min.y, hi = _bxRintang.max.y;
    if (hi < 0.28 || lo > 1.05) return;
    const w = _bxRintang.max.x - _bxRintang.min.x, d = _bxRintang.max.z - _bxRintang.min.z;
    if (w > 30 || d > 30) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as any;
    if (mat && (mat.visible === false || (mat.transparent && mat.opacity < 0.5))) {
      // cahaya / halo / kaca tipis tidak menghalangi; kecuali sekat kaca (tinggi, tipis, memanjang)
      const partisi = hi - lo >= 1.0 && Math.min(w, d) <= 0.3 && Math.max(w, d) >= 0.8 && mat.opacity >= 0.05;
      if (!partisi) return;
    }
    peta.tandaiKotak(_bxRintang.min.x, _bxRintang.min.z, _bxRintang.max.x, _bxRintang.max.z);
    n += 1;
  });
  return n;
}

function petaKosong(): PetaLantai {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const id of Object.keys(RUANG_BOX) as RuangId[]) {
    const b = RUANG_BOX[id];
    x0 = Math.min(x0, b.cx - b.w / 2); x1 = Math.max(x1, b.cx + b.w / 2);
    z0 = Math.min(z0, b.cz - b.d / 2); z1 = Math.max(z1, b.cz + b.d / 2);
  }
  return new PetaLantai(x0 - 2, z0 - 2, x1 + 2, z1 + 2, 0.2, 0.36);
}

// Membangun "dunia" AI penghuni. null = belum siap (kursi belum lengkap / perabot belum dimuat). aman = tanpa peta (AI hanya berdiri, tidak berkeliling).
function bangunDuniaPenghuni(scene: THREE.Scene, jumlahKursi: number, aman: boolean): { dunia: DuniaPenghuni; peta: PetaLantai; rintangan: number } | null {
  const kursi: Record<string, KursiDunia> = { ...KURSI_DUNIA };
  // [DIUBAH] isi ruangan dimuat bertahap: kursi & perabot hanya ada untuk ruangan yang sudah dimuat. AI tanpa kursi tetap tersembunyi (fase 'init')
  // dan baru muncul setelah ruangannya dimuat (peta dibangun ulang lewat EVENT_DETAIL). Kalau SEMUA ruangan dimuat, syarat lama (semua kursi) berlaku.
  const semuaDimuat = DETAIL_SEMUA || DETAIL.jumlah >= Object.keys(RUANG_BOX).length;
  if (Object.keys(kursi).length < (semuaDimuat ? jumlahKursi : 1) && !aman) return null;
  const peta = petaKosong();
  let n = 0;
  if (!aman) {
    n = tandaiRintangan(scene, peta);
    if (n < (semuaDimuat ? 150 : 20)) return null;
  }
  peta.selesai();
  const ruang: Record<string, KonfigRuang> = {};
  for (const [kunci, id] of Object.entries(RUANG_KE_ID)) {
    const b = RUANG_BOX[id];
    const simpul = NAV[RUANG_TUJUAN[kunci]];
    if (simpul) ruang[kunci] = { box: { cx: b.cx, cz: b.cz, w: b.w, d: b.d }, simpul };
  }
  const dunia = buatDunia(peta, ruang, kursi, (dari, tujuan) => rencanaJalurPet(dari, RUANG_TUJUAN[tujuan]));
  return { dunia: aman ? { ...dunia, bisaKeluar: () => false } : dunia, peta, rintangan: n };
}

function PetaDebug({ peta }: { peta: PetaLantai }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = peta.w;
    c.height = peta.h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(peta.w, peta.h);
    const b = peta.salinBlok();
    for (let i = 0; i < b.length; i++) {
      const o = i * 4;
      if (b[i]) { img.data[o] = 235; img.data[o + 1] = 60; img.data[o + 2] = 60; img.data[o + 3] = 120; }
      else { img.data[o] = 60; img.data[o + 1] = 220; img.data[o + 2] = 120; img.data[o + 3] = 28; }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }, [peta]);
  const W = peta.w * peta.sel, H = peta.h * peta.sel;
  return (
    <mesh position={[peta.x0 + W / 2, 0.07, peta.z0 + H / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[W, H]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

// Mode debug (?petadebug=1): garis biru muda = semua ruas jalur gedung (graf NAV) yang dipakai AI antar ruangan.
function JalurDebug() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (const [a, b] of NAV_EDGES) { pts.push(NAV[a][0], 0.12, NAV[a][1], NAV[b][0], 0.12, NAV[b][1]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#38BDF8" transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export type PenghuniInfo = { status: AgentStatus; teks: string; lokasi: string | null }; // teks & status dari pet-Direktur.ts (teksStatus)

// Tubuh 3D satu AI penghuni: membaca keadaan dari otak (duduk / berdiri / berjalan / mengobrol) lalu menganimasikannya.
function PetHidup({ pet, look, otak }: { pet: Penghuni; look: PetLook; otak: OtakPenghuni }) {
  const root = useRef<THREE.Group>(null);
  const drop = useRef<THREE.Group>(null);
  const bubble = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Group>(null);
  const eyeR = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const book = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const tailParts = useRef<(THREE.Group | null)[]>([]);
  const rig: PetRig = { chest, armL, armR, head, eyeL, eyeR, earL, earR, tail, legL, legR, shinL, shinR, tailParts };
  const seed = useMemo(() => Array.from(pet.nama).reduce((a, ch) => a + ch.charCodeAt(0), 0) * 0.37, [pet.nama]);
  const baca = pet.mode === 'baca';
  const earBase = EAR_BASE[look.kind];
  const tailPts = TAIL_PTS[look.kind];
  const S = useRef({ sit: 0, walk: 0, talk: 0, awal: true, label: 'santai' as AgentStatus });
  const [label, setLabel] = React.useState<AgentStatus>('santai');

  useEffect(() => () => {
    if (pet.seatKey) SEAT[pet.seatKey] = 0;
    delete POS_AGEN[pet.nama];
  }, [pet]);

  useFrame((state, dtRaw) => {
    const g = root.current;
    if (!g) return;
    const vis = pet.fase !== 'init';
    g.visible = vis;
    if (!vis) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = S.current;
    const duduk = pet.fase === 'duduk';
    if (s.awal) { s.awal = false; s.sit = duduk ? 1 : 0; g.rotation.y = pet.rot; }
    const k = (v: number) => Math.min(1, dt * v);
    const bicara = !pet.gerak && (pet.fase === 'ngobrol' || (pet.fase === 'tamu' && !!pet.lawan));
    s.sit += ((duduk && !pet.gerak ? 1 : 0) - s.sit) * k(7);
    s.walk += ((pet.gerak ? 1 : 0) - s.walk) * k(9);
    s.talk += ((bicara ? 1 : 0) - s.talk) * k(5);
    const { sit, walk, talk } = s;
    const mix = (a: number, b: number, w: number) => a + (b - a) * w;

    // posisi & arah (ikut naik bila ruangannya sedang difokuskan, seperti agen)
    g.position.set(pet.x, naikDi(pet.x, pet.z), pet.z);
    g.rotation.y += angleDiff(g.rotation.y, pet.rot) * k(pet.gerak ? 10 : 5);
    POS_AGEN[pet.nama] = [pet.x, pet.z]; // pintu otomatis ikut terbuka untuk AI penghuni
    if (pet.seatKey) SEAT[pet.seatKey] = duduk && sit > 0.8 ? 1 : 0; // layar menyala hanya saat benar-benar duduk bekerja

    const lab: AgentStatus = otak.tampilan(pet).status;
    if (s.label !== lab) { s.label = lab; setLabel(lab); }

    // badan: berdiri lebih rendah 5.5 cm dari pose duduk (kaki menapak lantai), naik-turun & goyang saat berjalan
    const ph = t * 8.5 + seed;
    if (drop.current) {
      drop.current.position.y = -0.055 * (1 - sit) + Math.abs(Math.sin(ph)) * 0.03 * walk;
      drop.current.rotation.z = Math.sin(ph) * 0.07 * walk;
    }
    if (chest.current) chest.current.scale.y = 1 + Math.sin(t * 1.8 + seed) * 0.012;

    // kaki: duduk = paha ke depan & betis turun; berdiri / berjalan = lurus, berayun bergantian
    const swing = Math.sin(ph) * 0.6 * walk;
    const SITR = Math.PI / 2 - 0.45;
    if (legL.current) legL.current.rotation.x = -(Math.PI / 2) * sit + swing * (1 - sit);
    if (legR.current) legR.current.rotation.x = -(Math.PI / 2) * sit - swing * (1 - sit);
    if (shinL.current) shinL.current.rotation.x = SITR * sit + Math.max(0, swing) * 0.8 * (1 - sit);
    if (shinR.current) shinR.current.rotation.x = SITR * sit + Math.max(0, -swing) * 0.8 * (1 - sit);

    // lengan: duduk = mengetik / memegang buku; berdiri = menggantung, berayun saat jalan, melambai saat mengobrol
    let sxL: number, sxR: number, szL: number, szR: number;
    if (!baca) {
      const aktif = 0.5 + 0.5 * Math.sin(t * 0.7 + seed * 3);
      const amp = 0.02 + 0.09 * aktif * aktif;
      sxL = -1.3 + Math.sin(t * 15 + seed) * amp; sxR = -1.3 + Math.sin(t * 15 + 2 + seed) * amp; szL = 0.35; szR = -0.35;
    } else {
      const f = (t + seed) % 7;
      const flip = f < 0.6 ? Math.sin((f / 0.6) * Math.PI) * 0.25 : 0;
      const bs = -1.15 + Math.sin(t * 0.7 + seed) * 0.03;
      sxL = bs; sxR = bs - flip; szL = 0.95; szR = -0.95;
    }
    const sw = Math.sin(ph) * 0.55 * walk;
    const gest = Math.sin(t * 4.2 + seed);
    const nxL = mix(sw, -0.25 + Math.sin(t * 3 + seed) * 0.1, talk);
    const nxR = mix(-sw, -0.95 + gest * 0.35, talk);
    const nzL = -0.1;
    const nzR = mix(0.1, 0.35, talk);
    if (armL.current) { armL.current.rotation.x = mix(nxL, sxL, sit); armL.current.rotation.z = mix(nzL, szL, sit); }
    if (armR.current) { armR.current.rotation.x = mix(nxR, sxR, sit); armR.current.rotation.z = mix(nzR, szR, sit); }
    if (book.current) {
      book.current.visible = baca && sit > 0.6;
      book.current.position.set(0, 0.9, 0.38);
      book.current.rotation.set(Math.PI / 2 - 0.3, 0, 0);
    }

    // kepala: duduk menunduk ke layar / buku; berdiri menoleh pelan ke sekeliling; mengobrol mengangguk
    const c = (t + seed * 2.1) % 10;
    const lk = c < 1.4 ? Math.sin((c / 1.4) * Math.PI) : 0;
    const dir = Math.sin(seed * 5) > 0 ? 1 : -1;
    if (head.current) {
      const hxSit = (baca ? 0.3 : 0.12) + Math.sin(t * 0.9 + seed) * 0.03;
      const hxStand = 0.03 + Math.sin(t * 0.9 + seed) * 0.02 + talk * Math.sin(t * 3.5 + seed) * 0.06;
      const hySit = Math.sin(t * 0.4 + seed) * 0.07 + lk * 0.45 * dir;
      const hyStand = (1 - talk) * Math.sin(t * 0.45 + seed * 2) * 0.4 + talk * Math.sin(t * 2.2 + seed) * 0.12;
      head.current.rotation.x = mix(hxStand, hxSit, sit);
      head.current.rotation.y = mix(hyStand, hySit, sit);
    }

    const blink = (t + seed) % 4.3 < 0.13 ? 0.1 : 1;
    if (eyeL.current) eyeL.current.scale.y = blink;
    if (eyeR.current) eyeR.current.scale.y = blink;
    const w = (t * 0.9 + seed) % 6;
    const tw = w < 0.3 ? Math.sin((w / 0.3) * Math.PI * 3) * 0.2 : 0;
    if (earL.current) earL.current.rotation.z = earBase + Math.sin(t * 1.1 + seed) * 0.02;
    if (earR.current) earR.current.rotation.z = -earBase + (EAR_TWITCH.has(look.kind) ? tw : 0);

    // ekor: duduk = diselipkan di balik sandaran kursi (dipipihkan); berdiri = dilebarkan penuh & mengibas (cepat saat jalan / mengobrol)
    if (tail.current) {
      const kibas = look.kind === 'kucing' || look.kind === 'shiba';
      tail.current.rotation.y = Math.sin(t * ((kibas ? 1.6 : 0.8) + 3 * walk + 2 * talk) + seed) * ((kibas ? 0.35 : 0.15) + 0.1 * walk);
    }
    const lebar = 0.12 + 0.88 * (1 - sit);
    for (let i = 0; i < tailPts.length; i++) {
      const tp = tailParts.current[i];
      if (tp) tp.position.z = tailPts[i][1] * lebar;
    }

    // gelembung obrolan "..." di samping kepala
    if (bubble.current) {
      bubble.current.visible = talk > 0.5;
      if (bubble.current.visible) {
        bubble.current.children.forEach((ch, i) => {
          ch.position.y = Math.sin(t * 6 - i * 0.9) * 0.025;
          ch.scale.setScalar(0.8 + 0.4 * Math.max(0, Math.sin(t * 6 - i * 0.9)));
        });
      }
    }
  });

  const dot = dotColor(label);
  return (
    <group ref={root} userData={{ nolod: true }} visible={false}>
      <group ref={drop}>
        <PetBody look={look} rig={rig} />
      </group>
      <ReadingBook gref={book} color={look.accent} />
      <group ref={bubble} position={[0.42, 1.45, 0.05]} visible={false}>
        {[-0.09, 0, 0.09].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group position={[0, look.kind === 'kelinci' ? 0 : -0.2, 0]}>
        <NameTag name={pet.nama} dot={dot} />
      </group>
    </group>
  );
}

// Menjalankan otak 27 AI penghuni dan menggambar tubuhnya. Dipasang di luar ruangan (koordinat dunia), seperti agen Neo / Atlas / Zeno.
function PenghuniKantor({ onPenghuni }: { onPenghuni?: (info: Record<string, PenghuniInfo>) => void }) {
  const scene = useThree((st) => st.scene);
  const otak = useMemo(() => new OtakPenghuni(), []);
  const dunia = useRef<DuniaPenghuni | null>(null);
  const tugas = useRef<Set<string>>(new Set());
  const [petaDebug, setPetaDebug] = React.useState<PetaLantai | null>(null);
  const debug = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('petadebug') === '1', []);
  const S = useRef({ t: 0, next: 2.5, dibangun: 0, darurat: false, acc: 0, last: '' });

  useEffect(() => {
    const baca = () => {
      const baru = new Set<string>();
      for (const n of tugasAISaatIni()) baru.add(n);
      for (const n of tugasAIDariUrl()) baru.add(n);
      tugas.current = baru;
    };
    baca();
    window.addEventListener(EVENT_TUGAS_AI, baca);
    // [BARU] AI penghuni yang diberi tugas -> isi ruangannya dimuat (mejanya harus ada)
    const paksaAI = () => {
      const p = new Set<string>();
      for (const pet of otak.pets) { if (tugas.current.has(pet.nama)) { const id = RUANG_KE_ID[pet.ruang]; if (id) p.add(id); } }
      DETAIL.paksaAI = p;
    };
    paksaAI();
    const iv2 = setInterval(paksaAI, 2000);
    // [BARU] isi ruangan baru dimuat -> bangun ulang peta lantai & kursi AI penghuni (AI di ruangan itu baru muncul sekarang)
    const ulang = () => { const s = S.current; s.next = Math.min(s.next, s.t + 0.4); if (s.dibangun >= 2) s.dibangun = 1; };
    window.addEventListener(EVENT_DETAIL, ulang);
    const iv = setInterval(baca, 2000);
    return () => { window.removeEventListener(EVENT_TUGAS_AI, baca); window.removeEventListener(EVENT_DETAIL, ulang); clearInterval(iv); clearInterval(iv2); DETAIL.paksaAI = new Set(); };
  }, [otak]);

  useFrame((_, dtRaw) => {
    const s = S.current;
    s.t += Math.min(dtRaw, 0.1);
    if (s.t >= s.next) {
      // percobaan 1 setelah ~2.5 dtk (kursi lengkap & perabot termuat), diulang di ~10 dtk untuk perabot yang muncul belakangan
      const hasil = DETAIL.jumlah === 0 ? null : bangunDuniaPenghuni(scene, otak.pets.length, false); // [BARU] belum ada isi ruangan dimuat -> belum ada yang bisa dipetakan
      if (hasil) {
        dunia.current = hasil.dunia;
        s.darurat = false;
        s.dibangun += 1;
        s.next = s.dibangun === 1 ? s.t + 7.5 : Infinity;
        if (debug) setPetaDebug(hasil.peta);
        const dg = hasil.dunia.diagnosa();
        console.info(`[Penghuni] peta lantai siap: ${hasil.rintangan} rintangan, ${dg.bisaKeluar.length} AI bisa berkeliling, terkurung: ${dg.terkurung.join(', ') || '-'}, spot darurat: ${dg.spotDarurat.join(', ') || '-'}, titik pintu bergeser: ${dg.simpulBergeser.join(', ') || '-'}`);
      } else {
        s.next = s.t + 1.5;
        if (s.t > 14 && !dunia.current && DETAIL.jumlah > 0) {
          // peta tidak berhasil dibuat: AI tetap berdiri di dekat meja dan duduk saat ada tugas, tapi tidak berkeliling
          const aman = bangunDuniaPenghuni(scene, otak.pets.length, true);
          if (aman) { dunia.current = aman.dunia; s.darurat = true; console.warn('[Penghuni] peta lantai gagal dibuat; AI tidak berkeliling'); }
        }
      }
    }
    if (dunia.current) otak.tick(dtRaw, dunia.current, (n) => tugas.current.has(n));

    // laporan ke bar profil: AI yang sedang berada di ruangan terfokus (tiap 0.3 dtk, hanya saat berubah)
    s.acc += dtRaw;
    if (s.acc < 0.3) return;
    s.acc = 0;
    const id = FOKUS.id;
    const info: Record<string, PenghuniInfo> = {};
    let key = id ?? '';
    if (id) {
      for (const p of otak.pets) {
        if (p.fase === 'init' || ruangDi(p.x, p.z) !== id) continue;
        const tp = otak.tampilan(p);
        info[p.nama] = { status: tp.status, teks: tp.teks, lokasi: RUANG_BOX[id].nama };
        key += `|${p.nama}:${tp.teks}`;
      }
    }
    if (key === s.last) return;
    s.last = key;
    onPenghuni?.(info);
  });

  useEffect(() => () => {
    for (const p of otak.pets) { if (p.seatKey) SEAT[p.seatKey] = 0; delete POS_AGEN[p.nama]; }
  }, [otak]);

  return (
    <>
      {otak.pets.map((p) => {
        const look = PET_LOOK[p.nama as PetName];
        return look ? <PetHidup key={p.nama} pet={p} look={look} otak={otak} /> : null;
      })}
      {debug && petaDebug && <PetaDebug peta={petaDebug} />}
      {debug && <JalurDebug />}
    </>
  );
}

// ---- Kamera & scene ----------------------------------------------------

// [DIUBAH] Lantai blueprint di bawah & sekeliling gedung: kisi tipis hijau-teal (garis kecil tiap 2 unit, garis besar tiap 10 unit) yang memudar ke tepi,
// plus garis tapak (outline) putus-putus mengelilingi denah. Tanpa slab hitam / halo. Bidang transparan, jadi gradasi latar di container tetap tembus.
const GRID_UKURAN = 170; // sisi bidang kisi (unit dunia)
function LantaiBlueprint() {
  const x0 = -22.4 - GESER_BARAT, x1 = X_TIMUR + 0.1;
  const z0 = -5.8, z1 = gz(30.7);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const tex = React.useMemo(() => {
    const N = 2048;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const g = c.getContext('2d')!;
    const px = N / GRID_UKURAN;
    const wx0 = cx - GRID_UKURAN / 2, wz0 = cz - GRID_UKURAN / 2; // sudut bidang di koordinat dunia
    const garis = (langkah: number, warna: string, lw: number) => {
      g.strokeStyle = warna;
      g.lineWidth = lw;
      g.beginPath();
      for (let X = Math.ceil(wx0 / langkah) * langkah; X <= wx0 + GRID_UKURAN; X += langkah) {
        g.moveTo((X - wx0) * px, 0);
        g.lineTo((X - wx0) * px, N);
      }
      for (let Z = Math.ceil(wz0 / langkah) * langkah; Z <= wz0 + GRID_UKURAN; Z += langkah) {
        g.moveTo(0, (Z - wz0) * px);
        g.lineTo(N, (Z - wz0) * px);
      }
      g.stroke();
    };
    garis(2, 'rgba(94,234,212,0.16)', 1);
    garis(10, 'rgba(94,234,212,0.34)', 1.6);
    // garis tapak gedung (putus-putus) + siku di empat sudut
    const m = 1.6; // jarak outline dari dinding luar
    const rx = (x0 - m - wx0) * px, rz = (z0 - m - wz0) * px, rw = (x1 - x0 + 2 * m) * px, rd = (z1 - z0 + 2 * m) * px;
    g.strokeStyle = 'rgba(110,231,183,0.75)';
    g.lineWidth = 2.5;
    g.setLineDash([18, 12]);
    g.strokeRect(rx, rz, rw, rd);
    g.setLineDash([]);
    g.lineWidth = 4;
    const L = 3.2 * px;
    ([[rx, rz, 1, 1], [rx + rw, rz, -1, 1], [rx, rz + rd, 1, -1], [rx + rw, rz + rd, -1, -1]] as [number, number, number, number][]).forEach(([x, y, sx, sy]) => {
      g.beginPath();
      g.moveTo(x + sx * L, y);
      g.lineTo(x, y);
      g.lineTo(x, y + sy * L);
      g.stroke();
    });
    // memudar ke tepi bidang: penuh di sekitar gedung, hilang di ujung
    g.globalCompositeOperation = 'destination-in';
    const f = g.createRadialGradient(N / 2, N / 2, N * 0.16, N / 2, N / 2, N / 2);
    f.addColorStop(0, 'rgba(0,0,0,1)');
    f.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = f;
    g.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [cx, cz, x0, x1, z0, z1]);
  return (
    <mesh position={[cx, -0.04, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} frustumCulled={false} renderOrder={-2}>
      <planeGeometry args={[GRID_UKURAN, GRID_UKURAN]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function FitCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    // Ruangan (16 x 11) terproyeksi isometrik ~ 20 unit lebar, ~ 14 unit tinggi.
    // Seluruh gedung (36 x 23) terproyeksi isometrik ~ 42 unit lebar, ~ 27 unit tinggi.
    (camera as THREE.OrthographicCamera).zoom = Math.max(10, Math.min(size.width / (52 + TAMBAH_TIMUR), size.height / 27));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

// [BARU] Batas sudut vertikal kamera (dihitung dari sumbu tegak): 0 = tampak atas lurus; MAKS_POLAR < 90° supaya tidak bisa melihat dari bawah lantai.
const MIN_POLAR = 0.03;
const MAKS_POLAR = THREE.MathUtils.degToRad(80);
// Jarak kamera ke titik fokus (kamera awal [16,15,21.5] -> target [0,0,5.5]). Kamera ortografis: jarak tidak mengubah ukuran gambar,
// hanya dijaga tetap supaya tidak melenceng (near/far).
const JARAK_KAMERA = Math.hypot(16, 15, 16);
const _arahPandang = new THREE.Vector3();

// [BARU] Batas geser peta: titik di lantai (y = 0) yang dilihat kamera dijaga di dalam kotak ini (seluruh peta).
const PAN_X: [number, number] = [-20 + TAMBAH_TIMUR / 2, 20 + TAMBAH_TIMUR / 2]; // [DIUBAH] gedung melebar ke timur (2 lorong samping): pusat peta ikut bergeser
const PAN_Z: [number, number] = [-3, 25 + GESER_BARIS_3]; // [DIUBAH] diperlebar sampai baris 3 (Planning & Management)
// [DIUBAH] Selain membatasi geser, titik fokus (pusat putaran) selalu diletakkan di LANTAI tepat di tengah layar. Menggeser di ruang layar
// (screenSpacePanning) bisa mengangkat target ke udara; kalau dibiarkan, memutar kamera akan "mengayun" peta. Kamera ortografis:
// menggeser target sepanjang arah pandang tidak mengubah gambar, jadi aman.
function clampPanTarget(controls: { target: THREE.Vector3; object: THREE.Camera }) {
  const t = controls.target;
  const cam = controls.object;
  const dir = _arahPandang.copy(t).sub(cam.position).normalize();
  if (dir.y > -0.05) return; // kamera selalu menghadap ke bawah (polar maks 80° -> dir.y <= -0.17)
  const s = -cam.position.y / dir.y; // jarak sepanjang arah pandang dari kamera sampai lantai
  const gx0 = cam.position.x + dir.x * s;
  const gz0 = cam.position.z + dir.z * s;
  const gx = Math.min(PAN_X[1], Math.max(PAN_X[0], gx0));
  const gz = Math.min(PAN_Z[1], Math.max(PAN_Z[0], gz0));
  const jarak = cam.position.distanceTo(t);
  if (gx === gx0 && gz === gz0 && Math.abs(t.y) < 1e-4 && Math.abs(jarak - JARAK_KAMERA) < 1e-3) return;
  const dx = dir.x, dy = dir.y, dz = dir.z; // _arahPandang dipakai ulang di bawah, salin dulu
  t.set(gx, 0, gz);
  cam.position.set(gx - dx * JARAK_KAMERA, -dy * JARAK_KAMERA, gz - dz * JARAK_KAMERA);
}

// [PERFORMA] Tanpa props -> React.memo membuat ribuan elemen scene TIDAK dirender ulang saat props OfficeScene berubah (tugas/rapat/status).
const RoomM = React.memo(Room);
const FurnitureM = React.memo(Furniture);
const PetaBesarM = React.memo(PetaBesar);

// ---- [PERFORMA] LOD ukuran-piksel (adaptif) ------------------------------------------------------------------------
// Masalah: ~9.000 draw call; GPU terintegrasi (Intel UHD) hanya nyaman di ~1-2 ribu. Banyak objek kecil (cangkir, kertas, buku,
// kancing, LED, uap) hanya berukuran beberapa piksel saat peta terlihat utuh, tapi tetap memakan satu draw call masing-masing.
// Solusi: mesh yang diameternya (diameter dunia x zoom kamera) di bawah ambang piksel disembunyikan dari kamera lewat LAYER
// (bukan .visible, jadi tidak bentrok dengan animasi/BatchStatis). Ambang MENYESUAIKAN DIRI: FPS < 28 -> ambang naik (lebih
// sedikit detail), FPS > 52 stabil beberapa detik -> ambang turun lagi. Di GPU kuat hasilnya hampir tak terlihat.
// Dikecualikan: mesh yang punya event klik dan mesh besar (diameter >= LOD_D_MAKS). Karakter (agen & hewan, userData.nolod):
// hanya bagian sangat kecil (mata/hidung/pipi, d < LOD_D_KAR) yang bisa hilang, dengan ambang dibatasi LOD_PX_KAR_MAKS.
// [BARU] PUNCAK DETAIL = zoom saat ruangan diklik (fokus). Ambang piksel dikali faktor k: k = 1 di zoom peta utuh, turun
// linear ke k = 0 di zoom fokus ruangan terbesar. Di zoom itu (dan lebih dekat) SEMUA komponen tampil, tanpa disembunyikan.
// Ruangan yang sedang difokuskan selalu tampil penuh. Pengaman: kalau di zoom penuh FPS < 22 terus-menerus, ruangan LAIN
// (yang sedang diredupkan) kembali memakai LOD ringan (LOD_PX_HEMAT) selama fokus itu; ruangan yang difokuskan tetap penuh.
// Saklar: ?lod=0 mati, ?lod=15 kunci ambang 15 piksel, ?perf=1 menampilkan ambang & jumlah mesh tersembunyi.
const LOD_PX_DASAR = 12; // [DIUBAH] dulu 6: di peta utuh sekarang lebih banyak komponen kecil yang disembunyikan
const LOD_PX_MAKS = 36; // [DIUBAH] dulu 22
const LOD_D_MAKS = 2.4; // [DIUBAH] dulu 1.0: mesh sedang (perabot) juga bisa disembunyikan
const LOD_D_BATCH = 1.0; // mesh di bawah ini tidak digabung BatchStatis; di atasnya tetap boleh digabung (1 draw call per kelompok)
const LOD_D_KAR = 0.6; // [BARU] bagian karakter (agen & hewan) yang sangat kecil (mata, hidung, pipi, kuku) ikut LOD
const LOD_PX_KAR_MAKS = 7; // ambang piksel karakter dibatasi supaya kepala/badan/anggota gerak tidak pernah hilang
const LOD_LAYER_SEMBUNYI = 1;
const LOD_PX_HEMAT = 14;
const LOD_INFO = { px: LOD_PX_DASAR, sembunyi: 0, total: 0, k: 1, zoom: 0, zPenuh: 0, hemat: false };

type LodItem = { mesh: THREE.Mesh; d: number; sembunyi: boolean; ruang: string | null; kar: boolean };

function LodManager() {
  const scene = useThree((s) => s.scene);
  const items = useRef<LodItem[]>([]);
  const size = useThree((s) => s.size);
  const st = useRef({ frame: 0, acc: 0, n: 0, worst: 0, aman: 0, px: LOD_PX_DASAR, zoomT: -1, pxT: -1, fokusT: '', hematT: false, lambat: 0, hemat: false });
  // Zoom saat sebuah ruangan difokuskan (rumus sama dengan FokusKamera). Diambil yang TERENDAH di antara semua ruangan
  // (ruangan terbesar), supaya begitu ruangan mana pun difokuskan, zoom-nya sudah >= nilai ini = puncak detail.
  const { zPenuh, zDasar } = useMemo(() => {
    let fitMin = 110;
    for (const k of Object.keys(RUANG_BOX) as RuangId[]) {
      const b = RUANG_BOX[k];
      const fit = Math.min(size.width / ((b.w + b.d) * 0.75 + 6), size.height / ((b.w + b.d) * 0.5 + 6));
      fitMin = Math.min(fitMin, fit);
    }
    const dasar = Math.max(10, Math.min(size.width / (52 + TAMBAH_TIMUR), size.height / 27)); // zoom peta utuh (FitCamera)
    return { zPenuh: Math.max(fitMin, dasar * 1.15) * 0.92, zDasar: dasar };
  }, [size.width, size.height]);
  const nonaktif = LOD_PARAM === '0';
  const pindaiRef = useRef<() => void>(() => {});
  useEffect(() => {
    // [BARU] isi ruangan yang dimuat belakangan juga diatur LOD
    const f = () => { setTimeout(() => pindaiRef.current(), 150); };
    window.addEventListener(EVENT_DETAIL, f);
    return () => window.removeEventListener(EVENT_DETAIL, f);
  }, []);
  const terkunci = LOD_PARAM !== null && Number(LOD_PARAM) > 0 ? Number(LOD_PARAM) : null;

  useEffect(() => () => {
    for (const it of items.current) { it.mesh.layers.set(0); it.mesh.userData.lodDaftar = false; }
    items.current = [];
    LOD_INFO.sembunyi = 0;
    LOD_INFO.total = 0;
  }, []);

  const pindai = () => {
    scene.updateMatrixWorld(true);
    const baru: LodItem[] = [];
    const kunjungi = (o: THREE.Object3D, ruang: string | null, kar: boolean) => {
      const k2 = kar || !!o.userData.nolod; // sub-pohon karakter: hanya bagian sangat kecil yang diatur LOD
      const r = (o.userData.ruang as string | undefined) ?? ruang;
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as any).isInstancedMesh && !(m as any).isSkinnedMesh && !m.userData.batchHasil && !m.userData.lodDaftar) {
        const geo = m.geometry as THREE.BufferGeometry | undefined;
        if (geo) {
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          const bs = geo.boundingSphere;
          if (bs) {
            const d = 2 * bs.radius * m.matrixWorld.getMaxScaleOnAxis();
            const inst = (m as any).__r3f;
            const punyaEvent = !!inst && (inst.eventCount > 0 || (inst.handlers && Object.keys(inst.handlers).length > 0));
            if (d > 1e-3 && d < (k2 ? LOD_D_KAR : LOD_D_MAKS) && !punyaEvent) {
              m.userData.lodDaftar = true;
              if (k2 || d < LOD_D_BATCH) m.userData.nobatch = true; // mesh kecil dikelola LOD, tidak digabung BatchStatis
              baru.push({ mesh: m, d, sembunyi: false, ruang: r, kar: k2 });
            }
          }
        }
      }
      for (const c of o.children) kunjungi(c, r, k2);
    };
    kunjungi(scene, null, false);
    if (baru.length) items.current = items.current.concat(baru);
    LOD_INFO.total = items.current.length;
    st.current.zoomT = -1; // paksa terapkan ulang
  };
  pindaiRef.current = pindai;

  useFrame((state, dt) => {
    if (nonaktif) return;
    const s = st.current;
    s.frame++;
    if (s.frame === 4 || s.frame === 90 || s.frame === 300) pindai();

    const zoom = (state.camera as THREE.OrthographicCamera).zoom;
    // k = 1 di peta utuh -> 0 di zoom fokus ruangan (puncak detail)
    const k = zoom >= zPenuh ? 0 : Math.min(1, (zPenuh - zoom) / Math.max(1, zPenuh - zDasar));
    const fokusId = (FOKUS.id as string | null) ?? '';

    // ---- adaptasi dari FPS nyata (jendela 1 detik; jendela dengan lonjakan >0,5 dtk = tab tertidur, diabaikan)
    s.acc += dt; s.n++; if (dt > s.worst) s.worst = dt;
    if (s.acc >= 1) {
      const fps = s.n / s.acc;
      const abaikan = s.worst > 0.5 || s.frame < 120;
      if (!abaikan) {
        if (k > 0) {
          s.hemat = false;
          s.lambat = 0;
          if (terkunci === null) {
            if (fps < 38 && s.px < LOD_PX_MAKS) { s.px = Math.min(LOD_PX_MAKS, s.px + 3); s.aman = 0; }
            else if (fps > 56) { if (++s.aman >= 5 && s.px > LOD_PX_DASAR) { s.px = Math.max(LOD_PX_DASAR, s.px - 1.5); s.aman = 0; } }
            else s.aman = 0;
          }
        } else if (fokusId && !s.hemat) {
          // di zoom penuh: pengaman FPS. Bertahan sampai fokus dilepas / zoom keluar dari puncak (tidak bolak-balik)
          s.lambat = fps < 22 ? s.lambat + 1 : 0;
          if (s.lambat >= 2) s.hemat = true;
        }
      }
      s.acc = 0; s.n = 0; s.worst = 0;
    }
    if (!fokusId) s.hemat = false;
    const px = terkunci ?? s.px;
    // [DIUBAH] kurva k^0,6: detail tetap sedikit lebih lama tersembunyi saat zoom-in, lalu penuh tepat di zoom fokus (k = 0)
    const kk = Math.pow(k, 0.6);
    // ambang piksel efektif: dikali kk; ruangan lain boleh memakai LOD ringan bila pengaman FPS aktif
    const pxUmum = s.hemat ? Math.max(px * kk, LOD_PX_HEMAT) : px * kk;

    if (Math.abs(zoom - s.zoomT) / zoom < 0.01 && px === s.pxT && fokusId === s.fokusT && s.hemat === s.hematT) return;
    s.zoomT = zoom; s.pxT = px; s.fokusT = fokusId; s.hematT = s.hemat;
    LOD_INFO.px = px; LOD_INFO.k = k; LOD_INFO.zoom = zoom; LOD_INFO.zPenuh = zPenuh; LOD_INFO.hemat = s.hemat;
    let tersembunyi = 0;
    for (const it of items.current) {
      let pxItem = fokusId && it.ruang === fokusId ? 0 : pxUmum; // ruangan yang difokuskan: selalu detail penuh
      if (it.kar && pxItem > 0) pxItem = Math.min(pxItem * 0.4, LOD_PX_KAR_MAKS);
      const dMin = pxItem / (zoom * 0.8); // diameter dunia minimum agar terlihat
      const harus = pxItem === 0 ? false : it.sembunyi ? it.d < dMin * 1.12 : it.d < dMin; // histeresis 12%
      if (harus !== it.sembunyi) { it.sembunyi = harus; it.mesh.layers.set(harus ? LOD_LAYER_SEMBUNYI : 0); }
      if (harus) tersembunyi++;
    }
    LOD_INFO.sembunyi = tersembunyi;
  });
  return null;
}

// [DIAGNOSA] Tambahkan ?perf=1 di URL halaman untuk menampilkan FPS, draw call, segitiga, DPR & nama GPU (pojok kiri bawah).
function PerfHud() {
  const gl = useThree((st) => st.gl);
  const el = useRef<HTMLDivElement | null>(null);
  const acc = useRef({ t: 0, n: 0, worst: 0 });
  const gpu = useMemo(() => {
    try {
      const c = gl.getContext();
      const e = c.getExtension('WEBGL_debug_renderer_info');
      return e ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'tidak diketahui';
    } catch {
      return 'tidak diketahui';
    }
  }, [gl]);
  useEffect(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;padding:6px 9px;font:11px/1.4 monospace;color:#9FFFE0;background:rgba(0,0,0,.72);border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(d);
    el.current = d;
    return () => { d.remove(); el.current = null; };
  }, []);
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt; a.n++; if (dt > a.worst) a.worst = dt;
    if (a.t >= 0.5 && el.current) {
      const i = gl.info;
      el.current.textContent =
        `FPS ${(a.n / a.t).toFixed(0)}  |  frame terburuk ${(a.worst * 1000).toFixed(0)} ms\n` +
        `draw call ${i.render.calls}  |  segitiga ${(i.render.triangles / 1000).toFixed(0)}k\n` +
        `geometri ${i.memory.geometries}  |  tekstur ${i.memory.textures}\n` +
        `DPR ${gl.getPixelRatio()}  |  kanvas ${gl.domElement.width}x${gl.domElement.height}\n` +
        `batch ${BATCH_AKTIF ? 'ON' : 'off'}  |  bayangan ${BAYANGAN_AKTIF ? 'ON' : 'off'}\n` +
        `LOD ${LOD_PARAM === '0' ? 'off' : `${LOD_INFO.px.toFixed(1)} px x k${LOD_INFO.k.toFixed(2)}${LOD_INFO.hemat ? ' HEMAT' : ''}  |  tersembunyi ${LOD_INFO.sembunyi}/${LOD_INFO.total}  |  zoom ${LOD_INFO.zoom.toFixed(0)}/${LOD_INFO.zPenuh.toFixed(0)}`}\n` +
        `GPU ${gpu}`;
      a.t = 0; a.n = 0; a.worst = 0;
    }
  });
  return null;
}

export default function OfficeScene({
  onAgentStatus,
  rapat = false,
  tugas,
  kunjungan,
  onFokusRuang,
  onAgenDiRuang,
  onPenghuni,
}: {
  onAgentStatus?: (name: string, s: AgentStatus) => void;
  rapat?: boolean; // true = semua agen duduk di meja rapat; false = kembali santai
  tugas?: Partial<Record<'Neo' | 'Atlas' | 'Zeno', number | null>>; // [BARU] meja halaman yang sedang dikerjakan tiap agen
  kunjungan?: Partial<Record<'Neo' | 'Atlas' | 'Zeno', string | null>>; // [BARU] ruangan yang sedang dikunjungi tiap agen (kunci RUANG_TUJUAN)
  onAgenDiRuang?: (nama: string[]) => void; // [BARU] agen (Neo/Atlas/Zeno) yang sedang berada di ruangan terfokus
  onFokusRuang?: (nama: string | null) => void; // [BARU] dipanggil saat pengguna memfokuskan / melepas fokus ruangan
  onPenghuni?: (info: Record<string, PenghuniInfo>) => void; // [BARU] AI penghuni yang sedang berada di ruangan terfokus (status + lokasi)
}) {
  // Meja rapat hanya dipakai saat pengguna meminta meeting; meja kerja hanya saat agen diberi tugas.
  // Selain itu agen santai (sofa / rak buku / joget), bergilir tiap 20 menit. Untuk uji cepat: buka halaman dengan ?santai=15 (detik).
  const actMs = useMemo(() => {
    if (typeof window === 'undefined') return ACT_MS_DEFAULT;
    const v = Number(new URLSearchParams(window.location.search).get('santai'));
    return v > 0 ? v * 1000 : ACT_MS_DEFAULT;
  }, []);
  // [BARU] Uji jalur tanpa backend: ?kunjungi=planning,management,aset mengirim Neo, Atlas, Zeno (urut) ke ruangan itu.
  // Nama ruangan: transactions, ar, ap, perpus, santai, aset, studio, planning, management. ?jalur=0 menyembunyikan garis jalur di lantai.
  const { kunjunganUrl } = useMemo(() => {
    if (typeof window === 'undefined') return { kunjunganUrl: [] as string[] };
    const q = new URLSearchParams(window.location.search);
    return { kunjunganUrl: (q.get('kunjungi') ?? '').split(',') };
  }, []);
  const perf = useMemo(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1', []);
  const still = useMemo(
    () => false, // animasi & efek selalu penuh di semua perangkat (tidak ada mode hemat / kurangi animasi)
    []
  );
  // [PERBAIKAN] Scene baru = semua kursi kosong. Layar hanya menyala setelah agen benar-benar duduk (SEAT diisi tiap frame).
  useEffect(() => {
    Object.keys(SEAT).forEach((k) => delete SEAT[k]);
  }, []);

  // [BARU] Fokus ruangan: klik ruangan = naik, lainnya redup. Klik area kosong / Esc = lepas.
  const onFokusRef = useRef(onFokusRuang);
  onFokusRef.current = onFokusRuang;
  useEffect(() => {
    FOKUS.pilih = (id) => {
      FOKUS.id = id;
      FOKUS.kamera(id);
      onFokusRef.current?.(id ? RUANG_BOX[id].nama : null);
    };
    FOKUS.cepat = still;
    const lepas = () => FOKUS.pilih(null);
    window.addEventListener(EVENT_LEPAS_FOKUS, lepas);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') FOKUS.pilih(null); };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener(EVENT_LEPAS_FOKUS, lepas);
      FOKUS.hover = null;
      FOKUS.id = null;
      FOKUS.naik = {};
      FOKUS.pilih = () => {};
      document.body.style.cursor = '';
    };
  }, [still]);

  // [BARU] Isi ruangan yang dibutuhkan agen dimuat walau kamera masih zoom-out: rapat / tugas halaman = meja & kursi di Transactions;
  // kunjungan = ruangan tujuan (nama atau alias, lihat simpulRuang / ALIAS_RUANG).
  const kunjNeo = kunjungan?.Neo ?? (kunjunganUrl[0] || null);
  const kunjAtlas = kunjungan?.Atlas ?? (kunjunganUrl[1] || null);
  const kunjZeno = kunjungan?.Zeno ?? (kunjunganUrl[2] || null);
  const tugasNeo = tugas?.Neo ?? null, tugasAtlas = tugas?.Atlas ?? null, tugasZeno = tugas?.Zeno ?? null;
  useEffect(() => {
    const p = new Set<string>();
    if (rapat || tugasNeo !== null || tugasAtlas !== null || tugasZeno !== null) p.add('transaksi');
    for (const v of [kunjNeo, kunjAtlas, kunjZeno]) {
      if (!v) continue;
      const k = String(v).trim().toLowerCase();
      const id = RUANG_KE_ID[ALIAS_RUANG[k] ?? k];
      if (id) p.add(id);
    }
    DETAIL.paksa = p;
    return () => { DETAIL.paksa = new Set(); };
  }, [rapat, tugasNeo, tugasAtlas, tugasZeno, kunjNeo, kunjAtlas, kunjZeno]);

  const controlsRef = useRef<any>(null);
  const clampPan = React.useCallback(() => {
    if (controlsRef.current) clampPanTarget(controlsRef.current);
  }, []);

  return (
    <Canvas
      orthographic
      shadows={BAYANGAN_AKTIF}
      dpr={[1, 1.5]}
      gl={{ powerPreference: 'high-performance' }}
      camera={{ position: [16 + TAMBAH_TIMUR / 2, 15, 21.5], zoom: 30, near: -60, far: 120 }}
      className="!absolute inset-0"
      onPointerMissed={() => FOKUS.pilih(null)}
    >
      {/* [DIUBAH] Latar kanvas transparan: gradasi hijau-hitam digambar di container (AgenticAIView.tsx), jadi gedung tidak tampak melayang di hitam polos. */}
      <FitCamera />
      <LodManager />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#FFFFFF', '#9DB8A8', 0.35]} />
      <SunLight />
      <RuangFokus id="transaksi" dasar={<group position={[TRX_OX, 0, 0]}><RoomM /></group>}>
        <group position={[TRX_OX, 0, 0]}>
          <FurnitureM />
        </group>
      </RuangFokus>
      <IkutNaik rooms={['transaksi']}><BuildingSign pos={[TRX_OX, 1.85, -5.6]} text="TRANSACTIONS" /></IkutNaik>
      <LantaiBlueprint />
      <PetaBesarM />
      {perf && <PerfHud />}
      <Agent name="Neo" look={LOOK_NEO} route={NEO_ROUTE} onStatus={onAgentStatus} still={still} meeting={rapat} tugas={tugas?.Neo ?? null} kunjungan={kunjungan?.Neo ?? (kunjunganUrl[0] || null)} actMs={actMs} />
      <Agent name="Atlas" look={LOOK_ATLAS} route={ATLAS_ROUTE} onStatus={onAgentStatus} still={still} meeting={rapat} tugas={tugas?.Atlas ?? null} kunjungan={kunjungan?.Atlas ?? (kunjunganUrl[1] || null)} actMs={actMs} />
      <Agent name="Zeno" look={LOOK_ZENO} route={ZENO_ROUTE} onStatus={onAgentStatus} still={still} meeting={rapat} tugas={tugas?.Zeno ?? null} kunjungan={kunjungan?.Zeno ?? (kunjunganUrl[2] || null)} actMs={actMs} />
      {/* [DIUBAH] Kamera bisa diputar 360° (azimuth bebas). Sudut vertikal dibatasi: dari tampak atas (polar ~0) sampai MAKS_POLAR,
          jadi tidak bisa memutar ke bawah lantai. Zoom (roda mouse / cubit) & geser tetap ada; batas geser dijaga supaya tidak keluar peta.
          Mouse: seret kiri = putar, seret kanan (atau Shift/Ctrl + seret kiri) = geser, roda = zoom.
          Sentuh: 1 jari = putar, 2 jari = zoom + geser. */}
      <OrbitControls
        ref={controlsRef}
        target={[TAMBAH_TIMUR / 2, 0, 5.5]}
        makeDefault
        enableRotate
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.8}
        screenSpacePanning
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAKS_POLAR}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        minZoom={8}
        maxZoom={110}
        onChange={clampPan}
      />
      <FokusKamera />
      <PenghuniKantor onPenghuni={onPenghuni} />
      <PantauAgen onAgen={onAgenDiRuang} />
    </Canvas>
  );
}